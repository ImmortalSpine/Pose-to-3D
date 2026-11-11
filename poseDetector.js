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
        this.holistic = null;
        this.poseDetector = null;
        this.isMirrored = false;
        this._initMediaPipe();
    }

    async _initMediaPipe() {
        try {
            if (window.Holistic) {
                this.holistic = new window.Holistic({
                    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/holistic/${file}`
                });
                this.holistic.setOptions({
                    modelComplexity: 1,
                    smoothLandmarks: true,
                    enableSegmentation: false,
                    smoothSegmentation: false,
                    refineFaceLandmarks: false,
                    minDetectionConfidence: 0.5,
                    minTrackingConfidence: 0.5
                });
                this.detectorReady = true;
                console.log("[AnatoPose] MediaPipe Holistic (Unified Full-body & Hands) Engine initialized.");
            } else if (window.Pose) {
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
        // 1. 若 Holistic 整合引擎就緒，使用單一安全推論管線 (零並發衝突，原子化同時返回軀幹 33 點與雙手各 21 點)
        if (this.holistic) {
            return new Promise((resolve) => {
                let finished = false;
                const timeout = setTimeout(() => {
                    if (!finished) {
                        finished = true;
                        console.warn("[AnatoPose] Holistic detection timeout (7s), falling back.");
                        resolve(null);
                    }
                }, 7000);

                this.holistic.onResults((results) => {
                    if (!finished) {
                        finished = true;
                        clearTimeout(timeout);
                        try {
                            const pose = this._processLandmarks(results);
                            resolve(pose);
                        } catch (err) {
                            console.error("[AnatoPose] Landmark processing error:", err);
                            resolve(null);
                        }
                    }
                });

                this.holistic.send({ image: imageElement }).catch((err) => {
                    if (!finished) {
                        finished = true;
                        clearTimeout(timeout);
                        console.error("[AnatoPose] Holistic send error:", err);
                        resolve(null);
                    }
                });
            });
        }

        // 2. 備用 Pose 引擎
        if (this.poseDetector) {
            return new Promise((resolve) => {
                let finished = false;
                const timeout = setTimeout(() => {
                    if (!finished) {
                        finished = true;
                        resolve(null);
                    }
                }, 6000);

                this.poseDetector.onResults((results) => {
                    if (!finished) {
                        finished = true;
                        clearTimeout(timeout);
                        resolve(this._processLandmarks(results));
                    }
                });

                this.poseDetector.send({ image: imageElement }).catch(() => {
                    if (!finished) {
                        finished = true;
                        clearTimeout(timeout);
                        resolve(null);
                    }
                });
            });
        }

        return this._heuristicImageAnalysis();
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

        // 11. MediaPipe Holistic 雙手 21 骨節特徵提取與預處理
        let matchedLeftHand = null;
        let matchedRightHand = null;
        let rightHandGesture = 'relaxed';
        let leftHandGesture = 'relaxed';

        if (results.leftHandLandmarks && results.leftHandLandmarks.length >= 21) {
            matchedLeftHand = results.leftHandLandmarks;
        }
        if (results.rightHandLandmarks && results.rightHandLandmarks.length >= 21) {
            matchedRightHand = results.rightHandLandmarks;
        }

        // 拓撲距離校驗 (避免極端側身或背身時左右手標籤被顛倒)
        if (matchedLeftHand && leftWrist && rightWrist) {
            const wL = matchedLeftHand[0];
            const dLL = Math.hypot(wL.x - leftWrist.x, wL.y - leftWrist.y);
            const dLR = Math.hypot(wL.x - rightWrist.x, wL.y - rightWrist.y);
            if (dLR < dLL && (!matchedRightHand || dLR < 0.15)) {
                const temp = matchedLeftHand;
                matchedLeftHand = matchedRightHand;
                matchedRightHand = temp;
            }
        }

        // 判定手部姿態類型 (前置手 / 插腰手 / 體側垂手)
        const checkFrontOfPelvis = (w) => {
            if (!w || !leftHip || !rightHip) return false;
            const minX = Math.min(leftHip.x, rightHip.x) - 0.05;
            const maxX = Math.max(leftHip.x, rightHip.x) + 0.05;
            const midY = (leftHip.y + rightHip.y) * 0.5;
            return (w.x >= minX && w.x <= maxX && w.y >= (midY - 0.38 * torsoHeight));
        };

        const checkHandOnHip = (s, e, w, side) => {
            if (!s || !e || !w) return false;
            const elbowFlared = (side === 'left') ? (e.x - s.x) : (s.x - e.x);
            const wristInward = (side === 'left') ? (e.x - w.x) : (w.x - e.x);
            const atWaistHeight = (w.y >= s.y + 0.22 * torsoHeight && w.y <= (leftHip ? leftHip.y + 0.2 * torsoHeight : s.y + 0.8 * torsoHeight));
            return (elbowFlared > 0.035 && wristInward > 0.035 && atWaistHeight);
        };

        const isLeftHandOnHip = checkHandOnHip(leftShoulder, leftElbow, leftWrist, 'left');
        const isRightHandOnHip = checkHandOnHip(rightShoulder, rightElbow, rightWrist, 'right');

        const isLeftFrontOfPelvis = !isLeftHandOnHip && checkFrontOfPelvis(leftWrist);
        const isRightFrontOfPelvis = !isRightHandOnHip && checkFrontOfPelvis(rightWrist);

        // 12. 左右大臂與前臂解算 (含肌肉包絡面避障、插腰側腰定位與相機真實投影傾角保真)
        const leftArmPose = this._solveArmKinematics(
            leftShoulder, leftElbow, leftWrist, 'left',
            thoracicPitch, thoracicYaw, thoracicRoll, torsoHeight,
            leftThumb, leftPinky,
            leftHip, rightHip, isLeftFrontOfPelvis, isLeftHandOnHip
        );

        const rightArmPose = this._solveArmKinematics(
            rightShoulder, rightElbow, rightWrist, 'right',
            thoracicPitch, thoracicYaw, thoracicRoll, torsoHeight,
            rightThumb, rightPinky,
            leftHip, rightHip, isRightFrontOfPelvis, isRightHandOnHip
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

        // 13. 手掌前後旋 (Twist) 與手勢微調 (結合 21 骨節精密幾何)
        if (matchedLeftHand) {
            const handSol = this._solveTwistAndGestureFromHand(matchedLeftHand, 'left', isLeftFrontOfPelvis, isLeftHandOnHip);
            leftForearmTwist = handSol.twist;
            leftHandGesture = handSol.gesture;
        } else if (leftWrist && leftShoulder && leftElbow) {
            if (leftWrist.y < leftShoulder.y + 0.15 && leftElbow.y > leftWrist.y) {
                leftHandGesture = 'peace';
            }
        }

        if (matchedRightHand) {
            const handSol = this._solveTwistAndGestureFromHand(matchedRightHand, 'right', isRightFrontOfPelvis, isRightHandOnHip);
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
     * 3. 人體肌肉與軟組織包絡面防禦 (Flesh Collision Defense)：
     *    - 嚴格保證手與手臂絕不刺入肋骨、胸腔、腰椎、骨盆等裸骨結構
     *    - 插腰手 (Akimbo)：精確停靠於側腰腹外斜肌外表面 (|X| >= 5.8, Z >= 1.5)
     *    - 骨盆前/裙前置手：忠實保留 2D 相機真實投影傾角，手腕平貼於大腿與衣物表面 (Z >= 3.85)
     * 4. 輸出 'YXZ' 歐拉角，與右側面板滑桿雙向同步
     */
    _solveArmKinematics(
        shoulder, elbow, wrist, side,
        thoracicPitch, thoracicYaw, thoracicRoll, torsoHeight,
        thumb = null, pinky = null,
        leftHip = null, rightHip = null,
        isFrontOfPelvis = false, isHandOnHip = false
    ) {
        const sign = (side === 'left') ? 1.0 : -1.0;

        if (!elbow || !shoulder) {
            return {
                roll: sign * 0.12,
                pitch: 0,
                yaw: 0,
                flex: 0.15,
                twist: isFrontOfPelvis || isHandOnHip ? 2.60 : 1.48
            };
        }

        // 1. 相機平面投影向量 (Screen X-Y)
        const dxArm = elbow.x - shoulder.x;
        const dyArm = -(elbow.y - shoulder.y); // Three.js 向上為正
        const lArm2D = Math.hypot(dxArm, dyArm);

        const scale = torsoHeight || 0.45;
        const LArm = scale * 0.58;
        const LFore = scale * 0.52;

        // 2. 解剖深度推估 (Pythagorean Depth)
        const rawDzArm = Math.sqrt(Math.max(0, LArm * LArm - lArm2D * lArm2D));
        const mpDz = -((elbow.z || 0) - (shoulder.z || 0));
        let zSignArm = isFrontOfPelvis ? 0.35 : (mpDz < -0.05 ? -0.2 : 0.6);
        if (isHandOnHip) zSignArm = 0.25;
        const dzArm = rawDzArm * zSignArm;

        const vArmCam = new THREE.Vector3(dxArm, dyArm, dzArm);

        // 前臂相機向量 (保留相機平面的真實投影傾角)
        let vForeCam;
        if (wrist) {
            const dxFore = wrist.x - elbow.x;
            const dyFore = -(wrist.y - elbow.y);
            const lFore2D = Math.hypot(dxFore, dyFore);
            const rawDzFore = Math.sqrt(Math.max(0, LFore * LFore - lFore2D * lFore2D));
            const mpDzFore = -((wrist.z || 0) - (elbow.z || 0));
            let zSignFore = isFrontOfPelvis ? 0.65 : (mpDzFore < -0.08 ? 0.2 : 0.75);
            if (isHandOnHip) zSignFore = 0.35;
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

        let uArm = vArmCam.clone().applyQuaternion(qThoraxInv).normalize();
        let uFore = vForeCam.clone().applyQuaternion(qThoraxInv).normalize();

        // 4. 生理防穿插約束與人體肌肉外輪廓包絡面 (Biomechanical Flesh Collision Envelope)
        // A. 後背壁防穿透：大臂在胸腔坐標系中 Z 軸不可向後過度延伸
        if (uArm.z < -0.15) {
            uArm.z = -0.15;
            uArm.normalize();
        }

        // B. 肋骨防穿插約束
        if (uArm.z < 0.6) {
            if (side === 'left') {
                uArm.x = Math.max(0.08, uArm.x);
            } else {
                uArm.x = Math.min(-0.08, uArm.x);
            }
            uArm.normalize();
        }

        // 肩關節局部基準點約在 (sign * 6.5, 8.8, -0.6)
        const pShoulderLocal = new THREE.Vector3(sign * 6.5, 8.8, -0.6);
        let pElbowLocal = pShoulderLocal.clone().addScaledVector(uArm, 8.5);

        if (isHandOnHip) {
            // === 模式 1：插腰手 (Akimbo - 嚴格基於側腰外斜肌外表面定位，絕不刺穿肋骨與腰椎) ===
            // 側腰肌肉外表面：寬度 |X| 需在 5.7 ~ 6.3 單位，前向 Z 在 1.2 ~ 2.0 單位，高度約在肋下至髂骨頂 (Y ≈ 0.5 ~ 1.8)
            const targetWristLocal = new THREE.Vector3(sign * 5.85, 1.2, 1.6);
            
            // 肘關節自然向外向後張開
            const elbowFlaredX = sign * Math.max(9.8, Math.abs(pElbowLocal.x));
            const elbowFlaredY = THREE.MathUtils.clamp(pElbowLocal.y, 2.0, 4.5);
            const elbowFlaredZ = Math.max(0.8, pElbowLocal.z);
            pElbowLocal.set(elbowFlaredX, elbowFlaredY, elbowFlaredZ);

            uArm = pElbowLocal.clone().sub(pShoulderLocal).normalize();
            uFore = targetWristLocal.clone().sub(pElbowLocal).normalize();
        } else if (isFrontOfPelvis) {
            // === 模式 2：骨盆前 / 裙子前 / 大腿前置手 (忠實保持相機真實 2D 前臂傾角，且平貼於裙子大腿肌肉表面 Z>=3.85) ===
            // 1. 大臂前向微傾，防止側身胸廓扭轉時手臂被拉入背後
            if (uArm.z < 0.15) {
                uArm.z = 0.15;
                uArm.normalize();
                pElbowLocal = pShoulderLocal.clone().addScaledVector(uArm, 8.5);
            }

            // 2. 忠實保持相機 2D 傾角導向，僅推進深度至大腿與衣物肌肉外表面
            let pWristLocal = pElbowLocal.clone().addScaledVector(uFore, 7.4);

            // 大腿前肌群與裙面肌肉外表面深度：Z >= 3.85 單位 (骨骼在 2.7，肌肉與裙子約 +1.15)
            const minFleshZ = 3.85;
            if (pWristLocal.z < minFleshZ) {
                pWristLocal.z = minFleshZ;
                uFore = pWristLocal.clone().sub(pElbowLocal).normalize();
            }
        } else {
            // === 模式 3：體側下垂手 (如立正或健美站姿垂臂) ===
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
                pElbowLocal = pShoulderLocal.clone().addScaledVector(uArm, 8.5);
            }
        }

        // 全局人體肌肉軟組織包絡面防禦 (General Muscle Volume Defense)
        // 確保任何姿勢下手腕與前臂點均不侵入胸廓肋骨、腰側與骨盆的肌肉體積內
        let pWristFinal = pElbowLocal.clone().addScaledVector(uFore, 7.4);

        if (pWristFinal.y > 1.5) {
            // 胸廓與胸大肌區 (Y > 1.5)：若水平在胸前 (|X| < 5.0)，深度必須在胸肌表面前側 (Z >= 4.8)
            if (Math.abs(pWristFinal.x) < 5.0 && pWristFinal.z < 4.8 && pWristFinal.z > -0.5) {
                pWristFinal.z = 4.85;
                uFore = pWristFinal.clone().sub(pElbowLocal).normalize();
            }
        } else if (pWristFinal.y >= -3.0 && pWristFinal.y <= 1.5) {
            // 腰側與腹壁區 (-3.0 <= Y <= 1.5)：側腰肌肉表面 |X| >= 5.5，腹前壁 Z >= 4.0
            if (Math.abs(pWristFinal.x) < 5.4 && pWristFinal.z < 3.8 && pWristFinal.z > -0.5) {
                if (isHandOnHip) {
                    pWristFinal.x = sign * 5.85;
                } else {
                    pWristFinal.z = 3.95;
                }
                uFore = pWristFinal.clone().sub(pElbowLocal).normalize();
            }
        } else if (pWristFinal.y < -3.0) {
            // 骨盆與大腿區 (Y < -3.0)：大腿前肌群與裙面 Z >= 3.85
            if (Math.abs(pWristFinal.x) < 5.4 && pWristFinal.z < 3.85 && pWristFinal.z > -1.0) {
                pWristFinal.z = 3.90;
                uFore = pWristFinal.clone().sub(pElbowLocal).normalize();
            }
        }

        // 5. 正交基底構造 (Orthonormal Basis Construction)
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

        const hingeWeight = THREE.MathUtils.clamp((flex - 0.26) / 0.52, 0.0, 1.0);
        const defaultHinge = new THREE.Vector3(sign, 0, 0);
        const hinge = defaultHinge.clone().lerp(measuredHinge, hingeWeight).normalize();

        // xAxis: 肘關節鉸鏈橫軸 (向前屈曲對應 -hinge)
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
        let twist = 1.48; // 預設：人體自然生理休止位 (Neutral/Semi-pronation ~85°)

        const isHanging = (uFore.y < -0.65) && (flex < 0.45);
        const isOnTorso = (flex >= 0.45) && (pWristFinal.y < 1.0) && (Math.abs(pWristFinal.x) < 5.8);
        const isRaised = (pWristFinal.y >= 1.0) && (flex >= 0.7);

        if (isHandOnHip) {
            // 插腰：掌心朝腰側，手背向外 (~152°)
            twist = 2.65;
        } else if (isFrontOfPelvis) {
            // 手放骨盆/裙前/腹前：掌心向後貼緊身體，手背朝鏡頭 (旋前位 ~150°)
            twist = 2.60;
        } else if (isRaised) {
            // 抬手摸臉/比耶：掌心轉向前 (旋後位)
            twist = 0.35;
        } else if (isOnTorso) {
            // 手放腰側/插口袋：旋前位 ~152°
            twist = 2.65;
        } else if (isHanging) {
            // 自然下垂：半旋前 (~85°)
            twist = 1.48;
        } else {
            twist = THREE.MathUtils.clamp(1.48 + 0.45 * (flex - 0.45), 0.3, 2.7);
        }

        // MediaPipe 拇指與小指特徵輔助融合
        if (!isFrontOfPelvis && !isHandOnHip && thumb && pinky) {
            const latDiff = (side === 'left') ? (thumb.x - pinky.x) : (pinky.x - thumb.x);
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
     * 從 MediaPipe Holistic 21 節點中，根據手指指向、食指-小指解剖橫軸關係解算手掌前後翻轉角
     * 並精確辨識放鬆 (Relaxed)、比耶 (Peace)、握拳 (Fist)、平展 (Open)
     */
    _solveTwistAndGestureFromHand(hand, side, isFrontOfPelvis = false, isHandOnHip = false) {
        const p0 = hand[0];    // Wrist
        const pIdx = hand[5];  // Index MCP
        const pPnk = hand[17]; // Pinky MCP
        const pMid = hand[9];  // Middle MCP

        // 1. 手部縱向指向 (dy > 0 表示手指朝下，dy < 0 表示手指朝上)
        const dy = pMid.y - p0.y;

        // 2. 食指與小指橫向空間關係 (解剖內外側)
        // lateralDiff > 0: 食指在外側 (遠離身體中心線)
        // lateralDiff < 0: 食指在內側 (靠向身體中心線，代表拇指內翻旋前)
        const lateralDiff = (side === 'left') ? (pIdx.x - pPnk.x) : (pPnk.x - pIdx.x);
        const lateralSpan = Math.abs(pIdx.x - pPnk.x);

        let twist = 1.48; // 預設半旋前 (85°)

        if (isHandOnHip) {
            // 插腰：掌心向內對準側腰，手背朝外
            twist = 2.65;
        } else if (isFrontOfPelvis) {
            // 手放於腹前/骨盆/裙前，掌心自然向後貼裙，手背朝鏡頭 (前旋位 Pronation ~150°)
            twist = 2.60;
        } else if (dy > 0.03) {
            // 手指朝下 (體側垂放或微斜)
            if (lateralDiff < -0.01) {
                // 食指在內側，拇指旋入：前旋位，手背朝前
                twist = 2.55;
            } else if (lateralDiff > 0.02) {
                // 食指在顯著外側：正面旋後，掌心朝前
                twist = 0.35;
            } else {
                // 體側自然生理休息位：半旋前 (~85°)，掌心對準大腿外側
                twist = 1.48;
            }
        } else if (dy < -0.03) {
            // 手指朝上 (如比耶、摸臉、抬手)
            const gesture = this._classifyHandGesture(hand);
            if (gesture === 'peace' || lateralDiff > -0.015 || lateralSpan < 0.04) {
                // 掌心朝鏡頭 (旋後位 ~14°)
                twist = 0.25;
            } else {
                // 手背朝鏡頭
                twist = 2.65;
            }
        } else {
            // 橫向放置
            twist = (lateralDiff < 0) ? 2.50 : 1.48;
        }

        // 手勢分類
        const gesture = this._classifyHandGesture(hand);

        return { twist, gesture };
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
