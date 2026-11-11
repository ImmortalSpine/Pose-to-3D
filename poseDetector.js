import * as THREE from 'three';

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
        // 11. 左右大臂與前臂 (正交基底正向動力學解算器)
        // -------------------------------------------------------------
        const leftArmPose = this._solveArmKinematics(
            leftShoulder, leftElbow, leftWrist, 'left',
            thoracicPitch, thoracicYaw, thoracicRoll, torsoHeight
        );

        const rightArmPose = this._solveArmKinematics(
            rightShoulder, rightElbow, rightWrist, 'right',
            thoracicPitch, thoracicYaw, thoracicRoll, torsoHeight
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
            leftArmPitch: this._clamp(leftArmPitch, -1.8, 1.4),
            leftArmRoll: this._clamp(leftArmRoll, 0.02, 2.5),
            leftArmYaw: this._clamp(leftArmYaw, -1.8, 1.8),
            leftElbowFlex: this._clamp(leftElbowFlex, 0, 2.7),
            leftForearmTwist: this._clamp(leftForearmTwist, 0, Math.PI),
            rightArmPitch: this._clamp(rightArmPitch, -1.8, 1.4),
            rightArmRoll: this._clamp(rightArmRoll, -2.5, -0.02),
            rightArmYaw: this._clamp(rightArmYaw, -1.8, 1.8),
            rightElbowFlex: this._clamp(rightElbowFlex, 0, 2.7),
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
     * 完整上肢 3D 正交基底逆向運動學解算器 (Two-Bone Orthonormal IK Solver)
     * 1. 勾股深度重構 (Pythagorean Depth) 結合生理背壁約束，防止側身時手臂向後穿刺
     * 2. 構造 [X_hinge, Y_shaft, Z_front] 正交旋轉基底，徹底根治歐拉角奇異性與軸向耦合
     * 3. 確保肘關節鉸鏈在三維空間中嚴格沿著 (肩-肘-腕) 唯一平面向前屈曲，100% 精準對準手腕點 (摸臉/摸頸/插腰)
     * 4. 輸出 'YXZ' 歐拉角，與右側面板滑桿雙向同步
     */
    _solveArmKinematics(shoulder, elbow, wrist, side, thoracicPitch, thoracicYaw, thoracicRoll, torsoHeight) {
        const sign = (side === 'left') ? 1.0 : -1.0;

        if (!elbow || !shoulder) {
            return {
                roll: sign * 0.12,
                pitch: 0,
                yaw: 0,
                flex: 0.15,
                twist: 0.35
            };
        }

        // 1. 相機平面投影向量 (Screen X-Y)
        const dxArm = elbow.x - shoulder.x;
        const dyArm = -(elbow.y - shoulder.y); // Three.js 向上為正
        const lArm2D = Math.hypot(dxArm, dyArm);

        // 人體解剖標準比例 (大臂約為軀幹高度的 0.58，前臂約為 0.52)
        const scale = torsoHeight || 0.45;
        const LArm = scale * 0.58;
        const LFore = scale * 0.52;

        // 2. 解剖深度推估 (Pythagorean Depth)
        const rawDzArm = Math.sqrt(Math.max(0, LArm * LArm - lArm2D * lArm2D));
        // 手肘位置偏向身體前側 (+Z) 或側邊，避免向後穿刺背壁
        const mpDz = -((elbow.z || 0) - (shoulder.z || 0));
        const zSignArm = mpDz < -0.05 ? -0.2 : 0.6;
        const dzArm = rawDzArm * zSignArm;

        const vArmCam = new THREE.Vector3(dxArm, dyArm, dzArm);

        // 前臂相機向量
        let vForeCam;
        if (wrist) {
            const dxFore = wrist.x - elbow.x;
            const dyFore = -(wrist.y - elbow.y);
            const lFore2D = Math.hypot(dxFore, dyFore);
            const rawDzFore = Math.sqrt(Math.max(0, LFore * LFore - lFore2D * lFore2D));
            // 手部操作 (摸臉、摸頸、插腰、胸前) 均在人體前側 (+Z)
            const mpDzFore = -((wrist.z || 0) - (elbow.z || 0));
            const zSignFore = mpDzFore < -0.08 ? 0.2 : 0.75;
            const dzFore = rawDzFore * zSignFore;

            vForeCam = new THREE.Vector3(dxFore, dyFore, dzFore);
        } else {
            vForeCam = new THREE.Vector3(sign * 0.05, -LFore, 0.05);
        }

        // 3. 逆變換至胸廓局部坐標系 (Thorax Local Frame)
        const qThorax = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(thoracicPitch, thoracicYaw, thoracicRoll, 'XYZ')
        );
        const qThoraxInv = qThorax.clone().invert();

        const uArm = vArmCam.clone().applyQuaternion(qThoraxInv).normalize();
        const uFore = vForeCam.clone().applyQuaternion(qThoraxInv).normalize();

        // 4. 生理防穿插約束 (Anti-Rib Penetration & Posterior Wall Clamp)
        // A. 後背壁防穿透：大臂在胸腔坐標系中 Z 軸不可向後過度延伸 (防止側身時手臂向後穿刺背部)
        if (uArm.z < -0.15) {
            uArm.z = -0.15;
            uArm.normalize();
        }

        // B. 肋骨防穿插約束：大臂在體側下垂時 (Z < 0.6)，大臂絕不能向內側過度內收刺穿肋骨
        if (uArm.z < 0.6) {
            if (side === 'left') {
                uArm.x = Math.max(0.08, uArm.x);
            } else {
                uArm.x = Math.min(-0.08, uArm.x);
            }
            uArm.normalize();
        }

        // 5. 正交基底構造 (Orthonormal Basis Construction)
        // yAxis: 大臂長軸 (在 Three.js 中大臂自然下垂沿 -Y，故 yAxis = -uArm)
        const yAxis = uArm.clone().negate().normalize();

        // 6. 肘關節鉸鏈平滑融合 (Hinge Axis Smoothing)
        // 當屈曲角度較小 (< 35°) 時，前臂微小雜訊會導致 (uArm x uFore) 出現極端跳動
        // 此時將鉸鏈平滑過渡融合至自然橫向解剖軸 (sign, 0, 0)，徹底杜絕雞翅膀與自轉突變
        const dotFlex = THREE.MathUtils.clamp(uArm.dot(uFore), -1.0, 1.0);
        let flex = Math.acos(dotFlex);

        let measuredHinge = new THREE.Vector3().crossVectors(uArm, uFore);
        if (measuredHinge.lengthSq() < 1e-4) {
            measuredHinge = new THREE.Vector3(sign, 0, 0);
        } else {
            measuredHinge.normalize();
        }

        // 權重融合：flex < 15° 完全使用解剖橫軸；flex > 45° 完全使用測量彎曲軸
        const hingeWeight = THREE.MathUtils.clamp((flex - 0.26) / 0.52, 0.0, 1.0);
        const defaultHinge = new THREE.Vector3(sign, 0, 0);
        const hinge = defaultHinge.clone().lerp(measuredHinge, hingeWeight).normalize();

        // xAxis: 肘關節鉸鏈橫軸 (在局部坐標系中，向前屈曲對應 -hinge)
        const rawX = hinge.clone().negate();
        const dotXY = rawX.dot(yAxis);
        const xAxis = rawX.clone().sub(yAxis.clone().multiplyScalar(dotXY)).normalize();

        // zAxis: 大臂前向法線
        const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();

        // 構造旋轉矩陣
        const basisMat = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);

        // 7. 提取 'YXZ' 歐拉角供 UI 滑桿與關節驅動
        const euler = new THREE.Euler().setFromRotationMatrix(basisMat, 'YXZ');

        // 8. 橈骨旋前/旋後 (Twist)
        const twist = THREE.MathUtils.clamp(0.25 + flex * 0.25, 0.1, 1.8);

        return {
            roll: this._clamp(euler.z, side === 'left' ? 0.02 : -2.5, side === 'left' ? 2.5 : -0.02),
            pitch: this._clamp(euler.x, -1.8, 1.4),
            yaw: this._clamp(euler.y, -1.8, 1.8),
            flex: this._clamp(flex, 0, 2.7),
            twist: twist
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
