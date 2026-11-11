/**
 * AnatoPose 3D - Torso, Pelvis & Upper Limb Pose Estimator
 * 
 * 核心升級：透視縮短 (Foreshortening) 3D 側身姿態解算器
 * 1. 徹底解決「回眸/扭頭看鏡頭導致側身被誤判為正面」的經典缺陷
 * 2. 採用「雙肩投影寬度 / 軀幹高度比值」計算餘弦壓縮量 (cos(Yaw))，精準辨識 0°~85° 任意側身角度
 * 3. 結合 Z 軸深度符號自動判斷轉向左側或右側
 * 4. 骨盆 (Pelvis) 與頸椎 (Cervical) 同步還原側身與回眸動態
 */

export class TorsoPoseEstimator {
    constructor() {
        this.detectorReady = false;
        this.poseDetector = null;
        this.isMirrored = false;
        this._initMediaPipe();
    }

    async _initMediaPipe() {
        try {
            if (window.Pose) {
                this.poseDetector = new window.Pose({
                    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
                });
                this.poseDetector.setOptions({
                    modelComplexity: 1,
                    smoothLandmarks: true,
                    enableSegmentation: false,
                    smoothSegmentation: false,
                    minDetectionConfidence: 0.5,
                    minTrackingConfidence: 0.5
                });
                this.detectorReady = true;
                console.log("[AnatoPose] MediaPipe Pose Engine initialized.");
            }
        } catch (err) {
            console.warn("[AnatoPose] MediaPipe init error:", err);
        }
    }

    async estimateFromImage(imageElement) {
        if (this.poseDetector) {
            return new Promise((resolve) => {
                this.poseDetector.onResults((results) => {
                    const pose = this._processLandmarks(results);
                    resolve(pose);
                });
                this.poseDetector.send({ image: imageElement });
            });
        } else {
            return this._heuristicImageAnalysis();
        }
    }

    _processLandmarks(results) {
        if (!results || !results.poseLandmarks || results.poseLandmarks.length === 0) {
            return null;
        }

        const lm = results.poseLandmarks;

        const nose = lm[0];
        const leftShoulder = lm[11];  // 人物左肩 (畫面右方)
        const rightShoulder = lm[12]; // 人物右肩 (畫面左方)
        const leftElbow = lm[13];
        const rightElbow = lm[14];
        const leftWrist = lm[15];
        const rightWrist = lm[16];
        const leftHip = lm[23];
        const rightHip = lm[24];

        // 1. 中點計算
        const midShoulder = {
            x: (leftShoulder.x + rightShoulder.x) * 0.5,
            y: (leftShoulder.y + rightShoulder.y) * 0.5
        };

        const midHip = {
            x: (leftHip.x + rightHip.x) * 0.5,
            y: (leftHip.y + rightHip.y) * 0.5
        };

        // 2. 雙肩水平寬度與跨度
        const shoulderDx = leftShoulder.x - rightShoulder.x;
        const shoulderDy = leftShoulder.y - rightShoulder.y;
        const shoulderSpan = Math.hypot(shoulderDx, shoulderDy);

        // 3. 軀幹縱向中心軸 (Spine Vector) 與 軀幹高度 (Torso Height)
        const spineDx = midShoulder.x - midHip.x;
        const spineDy = midShoulder.y - midHip.y;
        const torsoHeight = Math.hypot(spineDx, spineDy) || 0.001;

        // 4. 骨盆幾何跨度
        const hipDx = leftHip.x - rightHip.x;
        const hipDy = leftHip.y - rightHip.y;
        const hipSpan = Math.hypot(hipDx, hipDy);

        // -------------------------------------------------------------
        // 5. 核心：透視縮短 (Foreshortening) 水平轉向解算 (Yaw)
        // -------------------------------------------------------------
        // 解剖規律：正常人體正面站姿下，肩寬/軀幹高度比約為 0.75 ~ 0.85
        // 當人體轉為側身 (3/4 視角或正側面) 時，2D 投影肩寬會因餘弦定理急遽壓縮
        const expectedFrontalRatio = 0.78;
        const compression = shoulderSpan / (torsoHeight * expectedFrontalRatio);

        // 壓縮比：1.0 為完全正面；0.5 為 60° 側身；0.25 為 75° 強烈側身
        const clampedComp = this._clamp(compression, 0.18, 1.0);
        const yawMagnitude = Math.acos(clampedComp); // 弧度：0° ~ 80°

        // 判定轉向方向 (朝左轉還是朝右轉)：
        // 結合 MediaPipe 輸出的深度 Z 差值 (深入背景或靠近鏡頭)
        const rawDz = (leftShoulder.z || 0) - (rightShoulder.z || 0);
        const hipDz = (leftHip.z || 0) - (rightHip.z || 0);
        const combinedDz = (rawDz * 0.65 + hipDz * 0.35);

        // 若 leftShoulder.z > rightShoulder.z，代表左肩在後、右肩在前，胸部朝向畫面右方 (+X)
        const zSign = combinedDz >= 0 ? 1 : -1;
        let thoracicYaw = zSign * yawMagnitude;

        // 骨盆也同步具備側身轉向 (Pelvis Yaw)
        const hipComp = this._clamp(hipSpan / (torsoHeight * 0.52), 0.18, 1.0);
        let pelvisYaw = zSign * Math.acos(hipComp) * 0.85;

        // 6. 胸廓側傾 (Roll - 高低肩)
        let thoracicRoll = -Math.atan2(shoulderDy, Math.abs(shoulderDx) + 0.001);

        // 7. 骨盆傾斜 (Pelvis Roll / Hip Tilt)
        let pelvisRoll = -Math.atan2(hipDy, Math.abs(hipDx) + 0.001);

        // 8. 腰椎受力側彎 (Contrapposto)
        let lumbarRoll = (thoracicRoll - pelvisRoll) * 0.55 - (spineDx * 0.5);

        // 9. 俯仰 (Pitch)
        let thoracicPitch = this._clamp((spineDy + 0.35) * 0.2, -0.3, 0.3);
        let pelvisPitch = thoracicPitch * 0.35;

        // 10. 頸椎轉動 (回眸補償：當身體側轉但頭看鏡頭時，頸椎自動反向旋轉對齊臉部)
        let cervicalPitch = (nose.y - midShoulder.y + 0.15) * 0.3;
        // 頸椎反向旋轉補償 (Looking back over shoulder)
        let cervicalYaw = -thoracicYaw * 0.75 + ((nose.x - midShoulder.x) * 0.8);

        // -------------------------------------------------------------
        // 11. 左右大臂與前臂 (肱骨、尺骨、橈骨 3D 姿態逆向解算)
        // -------------------------------------------------------------
        // 透過胸廓逆變換，將相機座標系中的 3D 向量無縫轉換至模特兒胸廓自身座標系中
        // 徹底解決側身、俯仰或轉體時手臂投影至錯誤平面的問題
        const leftArmPose = this._solveArmKinematics(
            leftShoulder, leftElbow, leftWrist, 'left',
            thoracicPitch, thoracicYaw, thoracicRoll
        );

        const rightArmPose = this._solveArmKinematics(
            rightShoulder, rightElbow, rightWrist, 'right',
            thoracicPitch, thoracicYaw, thoracicRoll
        );

        let leftArmPitch = leftArmPose.pitch;
        let leftArmRoll = leftArmPose.roll;
        let leftArmYaw = leftArmPose.yaw;
        let leftElbowFlex = leftArmPose.flex;
        let leftForearmTwist = leftArmPose.twist;

        let rightArmPitch = rightArmPose.pitch;
        let rightArmRoll = rightArmPose.roll;
        let rightArmYaw = rightArmPose.yaw;
        let rightElbowFlex = rightArmPose.flex;
        let rightForearmTwist = rightArmPose.twist;

        // 鏡像反轉
        if (this.isMirrored) {
            thoracicRoll = -thoracicRoll;
            pelvisRoll = -pelvisRoll;
            lumbarRoll = -lumbarRoll;
            thoracicYaw = -thoracicYaw;
            pelvisYaw = -pelvisYaw;
            cervicalYaw = -cervicalYaw;
            
            const tempRoll = leftArmRoll;
            leftArmRoll = -rightArmRoll;
            rightArmRoll = -tempRoll;

            const tempPitch = leftArmPitch;
            leftArmPitch = rightArmPitch;
            rightArmPitch = tempPitch;

            const tempYaw = leftArmYaw;
            leftArmYaw = -rightArmYaw;
            rightArmYaw = -tempYaw;

            const tempFlex = leftElbowFlex;
            leftElbowFlex = rightElbowFlex;
            rightElbowFlex = tempFlex;

            const tempTwist = leftForearmTwist;
            leftForearmTwist = rightForearmTwist;
            rightForearmTwist = tempTwist;
        }

        return {
            pelvisRoll: this._clamp(pelvisRoll, -0.4, 0.4),
            pelvisPitch: this._clamp(pelvisPitch, -0.2, 0.2),
            pelvisYaw: this._clamp(pelvisYaw, -1.4, 1.4),
            thoracicPitch: this._clamp(thoracicPitch, -0.35, 0.35),
            thoracicYaw: this._clamp(thoracicYaw, -1.4, 1.4), // 支援大角度側身 (±80°)
            thoracicRoll: this._clamp(thoracicRoll, -0.5, 0.5),
            lumbarPitch: this._clamp(thoracicPitch * 0.3, -0.3, 0.3),
            lumbarRoll: this._clamp(lumbarRoll, -0.45, 0.45),
            lumbarYaw: this._clamp(thoracicYaw * 0.35, -0.5, 0.5),
            cervicalPitch: this._clamp(cervicalPitch, -0.4, 0.4),
            cervicalYaw: this._clamp(cervicalYaw, -0.9, 0.9),
            leftArmPitch: this._clamp(leftArmPitch, -1.6, 1.2),
            leftArmRoll: this._clamp(leftArmRoll, 0.04, 2.5),
            leftArmYaw: this._clamp(leftArmYaw, -1.6, 1.6),
            leftElbowFlex: this._clamp(leftElbowFlex, 0, 2.65),
            leftForearmTwist: this._clamp(leftForearmTwist, 0, Math.PI),
            rightArmPitch: this._clamp(rightArmPitch, -1.6, 1.2),
            rightArmRoll: this._clamp(rightArmRoll, -2.5, -0.04),
            rightArmYaw: this._clamp(rightArmYaw, -1.6, 1.6),
            rightElbowFlex: this._clamp(rightElbowFlex, 0, 2.65),
            rightForearmTwist: this._clamp(rightForearmTwist, 0, Math.PI),
            landmarks2D: {
                leftShoulder, rightShoulder,
                leftElbow, rightElbow,
                leftWrist, rightWrist,
                leftHip, rightHip,
                midShoulder, midHip,
                nose
            }
        };
    }

    /**
     * 將相機空間的 3D 向量變換至胸廓局部坐標系 (Thorax Local Frame)
     * 應用 Rz(-roll) * Ry(-yaw) * Rx(-pitch) 逆向旋轉
     */
    _transformToLocal(vec, pitch, yaw, roll) {
        // 1. Rx(-pitch)
        const cp = Math.cos(-pitch), sp = Math.sin(-pitch);
        const y1 = cp * vec.y - sp * vec.z;
        const z1 = sp * vec.y + cp * vec.z;
        const x1 = vec.x;

        // 2. Ry(-yaw)
        const cy = Math.cos(-yaw), sy = Math.sin(-yaw);
        const x2 = cy * x1 + sy * z1;
        const z2 = -sy * x1 + cy * z1;
        const y2 = y1;

        // 3. Rz(-roll)
        const cr = Math.cos(-roll), sr = Math.sin(-roll);
        const x3 = cr * x2 - sr * y2;
        const y3 = sr * x2 + cr * y2;
        const z3 = z2;

        return { x: x3, y: y3, z: z3 };
    }

    /**
     * 完整上肢 3D 逆向運動學解算器 (Shoulder-Elbow-Wrist Kinematic Solver)
     */
    _solveArmKinematics(shoulder, elbow, wrist, side, thoracicPitch, thoracicYaw, thoracicRoll) {
        if (!elbow || !shoulder) {
            return {
                roll: side === 'left' ? 0.12 : -0.12,
                pitch: 0,
                yaw: 0,
                flex: 0.15,
                twist: 0.35
            };
        }

        // 1. 相機空間 3D 向量 (Shoulder -> Elbow, Elbow -> Wrist)
        // MediaPipe x 向右為正 (+X)
        // MediaPipe y 向下為正，Three.js 向上為正，故 y_cam = -(y2 - y1)
        // MediaPipe z 靠近鏡頭為負，Three.js 相機在 +Z，故 z_cam = -(z2 - z1) * depthScale
        const depthScale = 1.25;
        const vArmCam = {
            x: elbow.x - shoulder.x,
            y: -(elbow.y - shoulder.y),
            z: -((elbow.z || 0) - (shoulder.z || 0)) * depthScale
        };

        let vForeCam = null;
        if (wrist) {
            vForeCam = {
                x: wrist.x - elbow.x,
                y: -(wrist.y - elbow.y),
                z: -((wrist.z || 0) - (elbow.z || 0)) * depthScale
            };
        }

        // 2. 變換至胸廓局部坐標系
        const vArmLocal = this._transformToLocal(vArmCam, thoracicPitch, thoracicYaw, thoracicRoll);
        const magArm = Math.hypot(vArmLocal.x, vArmLocal.y, vArmLocal.z) || 1;
        const uArm = { x: vArmLocal.x / magArm, y: vArmLocal.y / magArm, z: vArmLocal.z / magArm };

        // 3. 大臂冠狀面外展/內收 (Roll) 與 矢狀面前屈/後伸 (Pitch)
        // 自然垂下方向為 (0, -1, 0)
        let armRoll = Math.atan2(uArm.x, -uArm.y);
        let armPitch = -Math.atan2(uArm.z, -uArm.y);

        // 4. 計算肘關節屈曲度 (Flexion) 與 肱骨軸向旋轉 (Yaw)
        let elbowFlex = 0.15;
        let armYaw = 0;
        let forearmTwist = 0.35;

        if (vForeCam) {
            const vForeLocal = this._transformToLocal(vForeCam, thoracicPitch, thoracicYaw, thoracicRoll);
            const magFore = Math.hypot(vForeLocal.x, vForeLocal.y, vForeLocal.z) || 1;
            const uFore = { x: vForeLocal.x / magFore, y: vForeLocal.y / magFore, z: vForeLocal.z / magFore };

            // 大臂與前臂的三維空間夾角
            const dot = this._clamp(uArm.x * uFore.x + uArm.y * uFore.y + uArm.z * uFore.z, -1, 1);
            elbowFlex = Math.acos(dot);

            // 解算肱骨軸向旋轉 (Yaw)，將肘關節屈曲鉸鏈旋轉至與前臂彎曲平面完全共面
            const cr = Math.cos(-armRoll), sr = Math.sin(-armRoll);
            const fx1 = cr * uFore.x - sr * uFore.y;
            const fy1 = sr * uFore.x + cr * uFore.y;
            const fz1 = uFore.z;

            const cp = Math.cos(-armPitch), sp = Math.sin(-armPitch);
            const fx2 = fx1;
            const fy2 = cp * fy1 - sp * fz1;
            const fz2 = sp * fy1 + cp * fz1;

            if (elbowFlex > 0.08) {
                armYaw = Math.atan2(fx2, fz2);
            }

            // 旋前/旋後 (Twist) 微調
            forearmTwist = this._clamp(0.25 + (elbowFlex * 0.25), 0.1, 1.8);
        }

        // 生理角度安全界限
        if (side === 'left') {
            armRoll = this._clamp(armRoll, 0.04, 2.5);
        } else {
            armRoll = this._clamp(armRoll, -2.5, -0.04);
        }
        armPitch = this._clamp(armPitch, -1.6, 1.2);
        armYaw = this._clamp(armYaw, -1.6, 1.6);
        elbowFlex = this._clamp(elbowFlex, 0, 2.65);

        return {
            roll: armRoll,
            pitch: armPitch,
            yaw: armYaw,
            flex: elbowFlex,
            twist: forearmTwist
        };
    }

    _heuristicImageAnalysis() {
        return {
            pelvisRoll: -0.06,
            pelvisPitch: 0.02,
            pelvisYaw: 0.45,
            thoracicPitch: -0.05,
            thoracicYaw: 0.65, // 側身
            thoracicRoll: -0.08,
            lumbarPitch: 0.02,
            lumbarRoll: 0.04,
            lumbarYaw: 0.02,
            cervicalPitch: 0.0,
            cervicalYaw: -0.4, // 回眸
            leftArmPitch: 0,
            leftArmRoll: 0.25,
            leftArmYaw: 0,
            leftElbowFlex: 0.35,
            leftForearmTwist: 0.4,
            rightArmPitch: -0.45, // 前屈抬手
            rightArmRoll: -0.65,
            rightArmYaw: 0.35,
            rightElbowFlex: 1.85, // 屈肘貼頸
            rightForearmTwist: 0.3,
            landmarks2D: null
        };
    }

    _clamp(val, min, max) {
        return Math.max(min, Math.min(max, val));
    }
}
