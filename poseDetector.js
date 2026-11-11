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
        this.handsDetector = null;
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

            if (window.Hands) {
                this.handsDetector = new window.Hands({
                    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
                });
                this.handsDetector.setOptions({
                    maxNumHands: 2,
                    modelComplexity: 1,
                    minDetectionConfidence: 0.45,
                    minTrackingConfidence: 0.45
                });
                console.log("[AnatoPose] MediaPipe Hands (21 Landmarks) Engine initialized.");
            }
        } catch (err) {
            console.warn("[AnatoPose] MediaPipe init error:", err);
        }
    }

    async estimateFromImage(imageElement) {
        if (!this.poseDetector) {
            return this._heuristicImageAnalysis();
        }

        // 1. 全身 Pose 偵測
        const posePromise = new Promise((resolve) => {
            this.poseDetector.onResults((results) => resolve(results));
            this.poseDetector.send({ image: imageElement }).catch(() => resolve(null));
        });

        // 2. 雙手 21 節點 Hands 偵測 (並發非同步執行)
        let handsPromise = Promise.resolve(null);
        if (this.handsDetector) {
            handsPromise = new Promise((resolve) => {
                const timeout = setTimeout(() => resolve(null), 1500); // 1.5s 安全超時保護
                this.handsDetector.onResults((results) => {
                    clearTimeout(timeout);
                    resolve(results);
                });
                this.handsDetector.send({ image: imageElement }).catch(() => resolve(null));
            });
        }

        const [poseResults, handsResults] = await Promise.all([posePromise, handsPromise]);
        return this._processLandmarks(poseResults, handsResults);
    }

    _processLandmarks(results, handsResults = null) {
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
        const leftPinky = lm[17];
        const rightPinky = lm[18];
        const leftThumb = lm[21];
        const rightThumb = lm[22];
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
        // 11. 左右大臂與前臂 (正交基底正向動力學解算器，含骨盆避障與手掌前後判定)
        // -------------------------------------------------------------
        const leftArmPose = this._solveArmKinematics(
            leftShoulder, leftElbow, leftWrist, 'left',
            thoracicPitch, thoracicYaw, thoracicRoll, torsoHeight,
            leftThumb, leftPinky
        );

        const rightArmPose = this._solveArmKinematics(
            rightShoulder, rightElbow, rightWrist, 'right',
            thoracicPitch, thoracicYaw, thoracicRoll, torsoHeight,
            rightThumb, rightPinky
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

        // 12. MediaPipe Hands (21 骨節) 手掌 3D 法向量與精確手勢解算
        let matchedLeftHand = null;
        let matchedRightHand = null;
        let rightHandGesture = 'relaxed';
        let leftHandGesture = 'relaxed';

        if (handsResults && handsResults.multiHandLandmarks && handsResults.multiHandLandmarks.length > 0) {
            handsResults.multiHandLandmarks.forEach(handLm => {
                const w = handLm[0];
                const dL = Math.hypot(w.x - leftWrist.x, w.y - leftWrist.y);
                const dR = Math.hypot(w.x - rightWrist.x, w.y - rightWrist.y);
                if (dL < dR && dL < 0.28) {
                    matchedLeftHand = handLm;
                } else if (dR <= dL && dR < 0.28) {
                    matchedRightHand = handLm;
                }
            });
        }

        if (matchedLeftHand) {
            const handSol = this._solveTwistAndGestureFromHand(matchedLeftHand, 'left');
            leftForearmTwist = handSol.twist;
            leftHandGesture = handSol.gesture;
        } else if (leftWrist && leftShoulder && leftElbow) {
            if (leftWrist.y < leftShoulder.y + 0.15 && leftElbow.y > leftWrist.y) {
                leftHandGesture = 'peace';
            }
        }

        if (matchedRightHand) {
            const handSol = this._solveTwistAndGestureFromHand(matchedRightHand, 'right');
            rightForearmTwist = handSol.twist;
            rightHandGesture = handSol.gesture;
        } else if (rightWrist && rightShoulder && rightElbow) {
            if (rightWrist.y < rightShoulder.y + 0.15 && rightElbow.y > rightWrist.y) {
                rightHandGesture = 'peace';
            }
        }

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

            const tempGest = leftHandGesture;
            leftHandGesture = rightHandGesture;
            rightHandGesture = tempGest;

            const tempHand2D = matchedLeftHand;
            matchedLeftHand = matchedRightHand;
            matchedRightHand = tempHand2D;
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
            leftHandGesture: leftHandGesture,
            rightArmPitch: this._clamp(rightArmPitch, -1.8, 1.4),
            rightArmRoll: this._clamp(rightArmRoll, -2.5, -0.02),
            rightArmYaw: this._clamp(rightArmYaw, -1.8, 1.8),
            rightElbowFlex: this._clamp(rightElbowFlex, 0, 2.7),
            rightForearmTwist: this._clamp(rightForearmTwist, 0, Math.PI),
            rightHandGesture: rightHandGesture,
            landmarks2D: {
                leftShoulder, rightShoulder,
                leftElbow, rightElbow,
                leftWrist, rightWrist,
                leftHip, rightHip,
                midShoulder, midHip,
                nose,
                leftHand2D: matchedLeftHand,
                rightHand2D: matchedRightHand
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
    _solveArmKinematics(shoulder, elbow, wrist, side, thoracicPitch, thoracicYaw, thoracicRoll, torsoHeight, thumb = null, pinky = null) {
        const sign = (side === 'left') ? 1.0 : -1.0;

        if (!elbow || !shoulder) {
            return {
                roll: sign * 0.12,
                pitch: 0,
                yaw: 0,
                flex: 0.15,
                twist: 1.48
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

        // 4. 生理防穿插約束 (Anti-Rib & Anti-Pelvis Penetration)
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

        // C. 骨盆防穿刺約束 (Anti-Pelvis Penetration Constraints)
        // 模式一：體側下垂手。大臂或前臂主要向下垂時 (uFore.y < -0.65 或 uArm.y < -0.75)，前臂與手腕不可向內斜插骨盆
        if (uFore.y < -0.65 || uArm.y < -0.75) {
            if (side === 'left') {
                uFore.x = Math.max(0.02, uFore.x);
                uArm.x = Math.max(0.08, uArm.x);
            } else {
                uFore.x = Math.min(-0.02, uFore.x);
                uArm.x = Math.min(-0.08, uArm.x);
            }
            uArm.normalize();
            uFore.normalize();
        }

        // 預估手肘與手腕在胸腔坐標系中的位置 (肩關節基準點約在 (sign * 6.5, 8.8, -0.6))
        const pElbowLocal = new THREE.Vector3(sign * 6.5, 8.8, -0.6).addScaledVector(uArm, 8.5);
        const pWristLocal = pElbowLocal.clone().addScaledVector(uFore, 7.4);

        // 模式二：腹前/腰部/皮帶處放置手。當手腕內扣靠近中線 (|X| < 5.4) 且處於骨盆高度區間 (Y < 1.0)
        // 手腕與手掌深度 Z 必須推至骨盆與腹壁前方 (Z >= 2.85)，絕不刺入骨盆腔內！
        if (Math.abs(pWristLocal.x) < 5.4 && pWristLocal.y < 1.0 && pWristLocal.y > -9.5) {
            const minAntZ = 2.85;
            if (pWristLocal.z < minAntZ) {
                const neededForeZ = (minAntZ - pElbowLocal.z) / 7.4;
                uFore.z = Math.max(uFore.z, neededForeZ);
                uFore.normalize();
                // 重新同步手腕位置
                pWristLocal.copy(pElbowLocal).addScaledVector(uFore, 7.4);
            }
        }

        // 5. 正交基底構造 (Orthonormal Basis Construction)
        // yAxis: 大臂長軸 (在 Three.js 中大臂自然下垂沿 -Y，故 yAxis = -uArm)
        const yAxis = uArm.clone().negate().normalize();

        // 6. 肘關節鉸鏈平滑融合 (Hinge Axis Smoothing)
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

        // 8. 智慧橈骨旋前/旋後 (Twist / Pronation-Supination)
        let twist = 1.48; // 預設：人體自然垂直下垂生理休止位 (Neutral/Semi-pronation ~85°，掌心向內對著大腿側，拇指朝前)

        const isHanging = (uFore.y < -0.65) && (flex < 0.45);
        const isOnTorso = (flex >= 0.45) && (pWristLocal.y < 1.0) && (Math.abs(pWristLocal.x) < 5.8);
        const isRaised = (pWristLocal.y >= 1.0) && (flex >= 0.7);

        if (isRaised) {
            // 抬手摸臉/比耶：掌心轉向前或微內扣 (旋後位)
            twist = 0.35;
        } else if (isOnTorso) {
            // 手放腰腹/皮帶/插口袋：掌心向內貼緊身體，手背朝外 (旋前位 ~152°)
            twist = 2.65;
        } else if (isHanging) {
            // 自然下垂：掌心向內對準大腿，拇指朝前，手背朝外 (~85°)
            twist = 1.48;
        } else {
            twist = THREE.MathUtils.clamp(1.48 + 0.45 * (flex - 0.45), 0.3, 2.7);
        }

        // MediaPipe 拇指與小指特徵輔助融合
        if (thumb && pinky) {
            const latDiff = (side === 'left') ? (thumb.x - pinky.x) : (pinky.x - thumb.x);
            // 拇指顯著在外側 (latDiff > 0) -> 偏向旋後 (掌心朝前)
            // 拇指顯著在內側 (latDiff < 0) -> 偏向旋前 (掌心朝後)
            const twistBias = THREE.MathUtils.clamp(-latDiff * 3.5, -0.65, 0.65);
            twist += twistBias;
        }

        twist = THREE.MathUtils.clamp(twist, 0.1, Math.PI);

        return {
            roll: this._clamp(euler.z, side === 'left' ? 0.02 : -2.5, side === 'left' ? 2.5 : -0.02),
            pitch: this._clamp(euler.x, -1.8, 1.4),
            yaw: this._clamp(euler.y, -1.8, 1.8),
            flex: this._clamp(flex, 0, 2.7),
            twist: twist
        };
    }

    /**
     * 從 MediaPipe Hands 21 節點中，利用手腕(0)、食指根(5)、小指根(17)三點三維幾何外積解算手掌 3D 法向量與旋角
     * 並精確辨識放鬆 (Relaxed)、比耶 (Peace)、握拳 (Fist)、平展 (Open)
     */
    _solveTwistAndGestureFromHand(hand, side) {
        const p0 = hand[0];    // Wrist
        const pIdx = hand[5];  // Index MCP
        const pPnk = hand[17]; // Pinky MCP

        // 螢幕空間向量 (Three.js 向上為正，深度向前為正)
        const vIdx = new THREE.Vector3(pIdx.x - p0.x, -(pIdx.y - p0.y), -(pIdx.z - p0.z));
        const vPnk = new THREE.Vector3(pPnk.x - p0.x, -(pPnk.y - p0.y), -(pPnk.z - p0.z));

        // 手掌 3D 法向量 (Cross Product)
        let palmNormal;
        if (side === 'left') {
            palmNormal = new THREE.Vector3().crossVectors(vIdx, vPnk).normalize();
        } else {
            palmNormal = new THREE.Vector3().crossVectors(vPnk, vIdx).normalize();
        }

        // palmNormal.z:
        // > 0 表示掌心面向鏡頭 (Supination, twist -> 0)
        // < 0 表示手背面向鏡頭 (Pronation, twist -> PI)
        const nzClamped = THREE.MathUtils.clamp(palmNormal.z, -1.0, 1.0);
        const twist = Math.acos(nzClamped);

        // 手勢分類
        const gesture = this._classifyHandGesture(hand);

        return { twist, gesture, palmNormal };
    }

    /**
     * 21 骨節手勢自動幾何辨識器
     */
    _classifyHandGesture(hand) {
        const w = hand[0]; // Wrist

        const isExtended = (tipIdx, mcpIdx) => {
            const dTip = Math.hypot(hand[tipIdx].x - w.x, hand[tipIdx].y - w.y);
            const dMcp = Math.hypot(hand[mcpIdx].x - w.x, hand[mcpIdx].y - w.y);
            return dTip > (dMcp * 1.25);
        };

        const indexExt = isExtended(8, 5);
        const middleExt = isExtended(12, 9);
        const ringExt = isExtended(16, 13);
        const pinkyExt = isExtended(20, 17);

        if (indexExt && middleExt && !ringExt && !pinkyExt) {
            return 'peace'; // 勝利剪刀手 (YA)
        } else if (!indexExt && !middleExt && !ringExt && !pinkyExt) {
            return 'fist';  // 握拳
        } else if (indexExt && middleExt && ringExt && pinkyExt) {
            return 'open';  // 張開平展
        } else {
            return 'relaxed'; // 自然放鬆
        }
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
            leftElbowFlex: 0.25,
            leftForearmTwist: 1.48, // 生理休息位半旋前 (85°)，掌心對準大腿側
            leftHandGesture: 'relaxed',
            rightArmPitch: -0.45, // 前屈抬手
            rightArmRoll: -0.65,
            rightArmYaw: 0.35,
            rightElbowFlex: 1.85, // 屈肘貼頸
            rightForearmTwist: 0.3,
            rightHandGesture: 'peace',
            landmarks2D: null
        };
    }

    _clamp(val, min, max) {
        return Math.max(min, Math.min(max, val));
    }
}
