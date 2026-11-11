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
        this.readyPromise = this._initMediaPipe();
    }

    async _initMediaPipe() {
        try {
            if (window.Holistic) {
                this.holistic = new window.Holistic({
                    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/holistic/${file}`
                });
                this.holistic.setOptions({
                    modelComplexity: 1,
                    smoothLandmarks: false, // 關鍵：單張靜態照片切勿開啟跨影格平滑，否則首次推論會被初始預設值拉扯失真！
                    enableSegmentation: false,
                    smoothSegmentation: false,
                    refineFaceLandmarks: false,
                    minDetectionConfidence: 0.5,
                    minTrackingConfidence: 0.5
                });
                if (this.holistic.initialize) {
                    await this.holistic.initialize();
                }
                this.detectorReady = true;
                console.log("[AnatoPose] MediaPipe Holistic (Unified Full-body & Hands) Engine initialized.");
            } else if (window.Pose) {
                this.poseDetector = new window.Pose({
                    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
                });
                this.poseDetector.setOptions({
                    modelComplexity: 1,
                    smoothLandmarks: false, // 靜態照片關閉跨影格平滑
                    enableSegmentation: false,
                    smoothSegmentation: false,
                    minDetectionConfidence: 0.5,
                    minTrackingConfidence: 0.5
                });
                if (this.poseDetector.initialize) {
                    await this.poseDetector.initialize();
                }
                this.detectorReady = true;
                console.log("[AnatoPose] MediaPipe Pose Engine initialized.");
            }
        } catch (err) {
            console.warn("[AnatoPose] MediaPipe init error:", err);
        }
    }

    async estimateFromImage(imageElement) {
        if (!imageElement) return null;
        const imgW = imageElement.naturalWidth || imageElement.videoWidth || imageElement.width || 1;
        const imgH = imageElement.naturalHeight || imageElement.videoHeight || imageElement.height || 1;
        this.aspectRatio = imgW / imgH;

        // 確保 MediaPipe 底層 WASM 與模型已完全加載就緒
        if (this.readyPromise) {
            await this.readyPromise;
        }

        // 1. 若 Holistic 整合引擎就緒，使用單一安全推論管線 (零並發衝突，原子化同時返回軀幹 33 點與雙手各 21 點)
        if (this.holistic) {
            // 重置上一張圖片的殘留追蹤快取，保證每一張獨立圖片均以全新高精度檢測出發
            if (this.holistic.reset) {
                try { this.holistic.reset(); } catch (_) {}
            }

            return new Promise((resolve) => {
                let finished = false;
                const timeout = setTimeout(() => {
                    if (!finished) {
                        finished = true;
                        console.warn("[AnatoPose] Holistic detection timeout (15s), falling back.");
                        resolve(null);
                    }
                }, 15000);

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
            if (this.poseDetector.reset) {
                try { this.poseDetector.reset(); } catch (_) {}
            }

            return new Promise((resolve) => {
                let finished = false;
                const timeout = setTimeout(() => {
                    if (!finished) {
                        finished = true;
                        resolve(null);
                    }
                }, 12000);

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
        const leftKnee = lm[25];
        const rightKnee = lm[26];
        const leftAnkle = lm[27];
        const rightAnkle = lm[28];
        const leftHeel = lm[29];
        const rightHeel = lm[30];
        const leftFootIndex = lm[31];
        const rightFootIndex = lm[32];

        const ar = this.aspectRatio || 1.0;

        // 1. 中點計算
        const midShoulder = {
            x: (leftShoulder.x + rightShoulder.x) * 0.5,
            y: (leftShoulder.y + rightShoulder.y) * 0.5
        };

        const midHip = {
            x: (leftHip.x + rightHip.x) * 0.5,
            y: (leftHip.y + rightHip.y) * 0.5
        };

        // 2. 雙肩水平寬度與跨度 (經影像長寬比各向同性修正)
        const shoulderDx = (leftShoulder.x - rightShoulder.x) * ar;
        const shoulderDy = leftShoulder.y - rightShoulder.y;
        const shoulderSpan = Math.hypot(shoulderDx, shoulderDy);

        // 3. 軀幹縱向中心軸 (Spine Vector) 與 軀幹高度 (Torso Height)
        const spineDx = (midShoulder.x - midHip.x) * ar;
        const spineDy = midShoulder.y - midHip.y;
        const torsoHeight = Math.hypot(spineDx, spineDy) || 0.001;

        // 4. 骨盆幾何跨度
        const hipDx = (leftHip.x - rightHip.x) * ar;
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

        // 解剖學生理防呆校正：衣袖遮擋 / 偽陽性反向折返過濾 (Sleeve Occlusion Sanity Filter)
        // 當大臂自然下垂 (elbow.y > shoulder.y + 0.08)，但 MediaPipe 因外套/褶皺誤將手腕抓在手肘上方 (wrist.y < elbow.y - 0.04)
        // 且未檢測到手掌 21 節點 (手被衣服或腰胯遮擋) 時，手腕必然插在腰際/口袋/骨盆處，絕不可能在腋下折疊倒插
        const sanitizeWristOcclusion = (s, e, w, h, matchedHand, side) => {
            if (!s || !e || !w || !h) return w;
            const sign = (side === 'left') ? 1.0 : -1.0;
            const uArmDown = (e.y - s.y) > 0.08;
            const foreUp = (w.y - e.y) < -0.04;
            const closeToTorso = Math.abs(w.x - s.x) < 0.14;
            if (!matchedHand && uArmDown && foreUp && closeToTorso) {
                return {
                    x: h.x + sign * 0.05,
                    y: h.y - 0.03 * torsoHeight,
                    z: e.z || 0,
                    visibility: 0.5
                };
            }
            return w;
        };

        const activeLeftWrist = sanitizeWristOcclusion(leftShoulder, leftElbow, leftWrist, leftHip, matchedLeftHand, 'left');
        const activeRightWrist = sanitizeWristOcclusion(rightShoulder, rightElbow, rightWrist, rightHip, matchedRightHand, 'right');

        // 判定手部姿態類型 (前置手 / 插腰手 / 體側垂手)
        const checkFrontOfPelvis = (w) => {
            if (!w || !leftHip || !rightHip) return false;
            const minX = Math.min(leftHip.x, rightHip.x) - 0.05 / ar;
            const maxX = Math.max(leftHip.x, rightHip.x) + 0.05 / ar;
            const midY = (leftHip.y + rightHip.y) * 0.5;
            return (w.x >= minX && w.x <= maxX && w.y >= (midY - 0.38 * torsoHeight));
        };

        const checkHandOnHip = (s, e, w, side) => {
            if (!s || !e || !w) return false;
            const elbowFlared = (side === 'left') ? ((e.x - s.x) * ar) : ((s.x - e.x) * ar);
            const wristInward = (side === 'left') ? ((e.x - w.x) * ar) : ((w.x - e.x) * ar);
            const armDx = (e.x - s.x) * ar;
            const armDy = e.y - s.y;
            const foreDx = (w.x - e.x) * ar;
            const foreDy = w.y - e.y;
            const dot = armDx * foreDx + armDy * foreDy;
            const lA = Math.hypot(armDx, armDy);
            const lF = Math.hypot(foreDx, foreDy);
            const flexAngle = Math.acos(Math.max(-1, Math.min(1, dot / (lA * lF + 1e-5))));
            const atWaistHeight = (w.y >= s.y + 0.25 * torsoHeight && w.y <= (leftHip ? leftHip.y + 0.20 * torsoHeight : s.y + 0.95 * torsoHeight));
            return (elbowFlared > 0.045 && wristInward > 0.04 && flexAngle > 0.65 && atWaistHeight);
        };

        const isLeftHandOnHip = checkHandOnHip(leftShoulder, leftElbow, activeLeftWrist, 'left');
        const isRightHandOnHip = checkHandOnHip(rightShoulder, rightElbow, activeRightWrist, 'right');

        const isLeftFrontOfPelvis = !isLeftHandOnHip && checkFrontOfPelvis(activeLeftWrist);
        const isRightFrontOfPelvis = !isRightHandOnHip && checkFrontOfPelvis(activeRightWrist);

        // 12. 左右大臂與前臂解算 (含肌肉包絡面避障、插腰側腰定位與相機真實投影傾角保真)
        const leftArmPose = this._solveArmKinematics(
            leftShoulder, leftElbow, activeLeftWrist, 'left',
            thoracicPitch, thoracicYaw, thoracicRoll, torsoHeight,
            leftThumb, leftPinky,
            leftHip, rightHip, isLeftFrontOfPelvis, isLeftHandOnHip
        );

        const rightArmPose = this._solveArmKinematics(
            rightShoulder, rightElbow, activeRightWrist, 'right',
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

        // 14. 左右下肢解算 (股骨、大轉子、膝關節屈曲、脛骨、腓骨與足踝)
        const leftLegPose = this._solveLegKinematics(
            leftHip, leftKnee, leftAnkle, leftFootIndex, leftHeel, 'left',
            pelvisPitch, pelvisYaw, pelvisRoll, torsoHeight
        );

        const rightLegPose = this._solveLegKinematics(
            rightHip, rightKnee, rightAnkle, rightFootIndex, rightHeel, 'right',
            pelvisPitch, pelvisYaw, pelvisRoll, torsoHeight
        );

        let leftHipPitch = leftLegPose.pitch;
        let leftHipRoll = leftLegPose.roll;
        let leftHipYaw = leftLegPose.yaw;
        let leftKneeFlex = leftLegPose.kneeFlex;
        let leftAnklePitch = leftLegPose.anklePitch;
        let leftAnkleYaw = leftLegPose.ankleYaw;
        let leftAnkleRoll = leftLegPose.ankleRoll;

        let rightHipPitch = rightLegPose.pitch;
        let rightHipRoll = rightLegPose.roll;
        let rightHipYaw = rightLegPose.yaw;
        let rightKneeFlex = rightLegPose.kneeFlex;
        let rightAnklePitch = rightLegPose.anklePitch;
        let rightAnkleYaw = rightLegPose.ankleYaw;
        let rightAnkleRoll = rightLegPose.ankleRoll;

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

            const tempHipRoll = leftHipRoll;
            leftHipRoll = -rightHipRoll;
            rightHipRoll = -tempHipRoll;

            const tempHipPitch = leftHipPitch;
            leftHipPitch = rightHipPitch;
            rightHipPitch = tempHipPitch;

            const tempHipYaw = leftHipYaw;
            leftHipYaw = -rightHipYaw;
            rightHipYaw = -tempHipYaw;

            const tempKneeFlex = leftKneeFlex;
            leftKneeFlex = rightKneeFlex;
            rightKneeFlex = tempKneeFlex;

            const tempAnkPitch = leftAnklePitch;
            leftAnklePitch = rightAnklePitch;
            rightAnklePitch = tempAnkPitch;

            const tempAnkYaw = leftAnkleYaw;
            leftAnkleYaw = -rightAnkleYaw;
            rightAnkleYaw = -tempAnkYaw;

            const tempAnkRoll = leftAnkleRoll;
            leftAnkleRoll = -rightAnkleRoll;
            rightAnkleRoll = -tempAnkRoll;
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
            leftArmPitch: this._clamp(leftArmPitch, -2.2, 2.2),
            leftArmRoll: this._clamp(leftArmRoll, -0.85, 3.23),
            leftArmYaw: this._clamp(leftArmYaw, -2.2, 2.2),
            leftElbowFlex: this._clamp(leftElbowFlex, 0, 2.7),
            leftForearmTwist: this._clamp(leftForearmTwist, 0, Math.PI),
            leftHandGesture: leftHandGesture,
            rightArmPitch: this._clamp(rightArmPitch, -2.2, 2.2),
            rightArmRoll: this._clamp(rightArmRoll, -3.23, 0.85),
            rightArmYaw: this._clamp(rightArmYaw, -2.2, 2.2),
            rightElbowFlex: this._clamp(rightElbowFlex, 0, 2.7),
            rightForearmTwist: this._clamp(rightForearmTwist, 0, Math.PI),
            rightHandGesture: rightHandGesture,
            leftHipPitch: this._clamp(leftHipPitch, -0.65, 0.95),
            leftHipRoll: this._clamp(leftHipRoll, -0.30, 0.65),
            leftHipYaw: this._clamp(leftHipYaw, -0.65, 0.65),
            leftKneeFlex: this._clamp(leftKneeFlex, 0, 2.4),
            leftAnklePitch: this._clamp(leftAnklePitch, -0.50, 0.75),
            leftAnkleYaw: this._clamp(leftAnkleYaw, -0.60, 0.60),
            leftAnkleRoll: this._clamp(leftAnkleRoll, -0.25, 0.25),
            rightHipPitch: this._clamp(rightHipPitch, -0.65, 0.95),
            rightHipRoll: this._clamp(rightHipRoll, -0.65, 0.30),
            rightHipYaw: this._clamp(rightHipYaw, -0.65, 0.65),
            rightKneeFlex: this._clamp(rightKneeFlex, 0, 2.4),
            rightAnklePitch: this._clamp(rightAnklePitch, -0.50, 0.75),
            rightAnkleYaw: this._clamp(rightAnkleYaw, -0.60, 0.60),
            rightAnkleRoll: this._clamp(rightAnkleRoll, -0.25, 0.25),
            landmarks2D: {
                leftShoulder, rightShoulder,
                leftElbow, rightElbow,
                leftWrist: activeLeftWrist, rightWrist: activeRightWrist,
                leftHip, rightHip,
                leftKnee, rightKnee,
                leftAnkle, rightAnkle,
                leftHeel, rightHeel,
                leftFootIndex, rightFootIndex,
                midShoulder, midHip,
                nose,
                leftHand2D: matchedLeftHand,
                rightHand2D: matchedRightHand
            }
        };
    }

    /**
     * 完整上肢 3D 正交基底逆向運動學解算器 (Two-Bone Orthonormal IK Solver)
     * 1. 忠實保持相機 2D 骨骼傾角 (Screen-Space Fidelity)，絕不暴力竄改肘、腕關節 2D 坐標
     * 2. 嚴格 [X_hinge, Y_shaft, Z_flex] 正交基底：
     *    - 大臂沿 -Y_local
     *    - 肘關節屈曲向前臂彎折平面投影，驅動 elbowJoint.rotation.x = -flex 100% 精確對齊手腕
     *    - 消除軸向耦合與 180° 翻轉奇異性
     * 3. 人體肌肉與服裝外輪廓防穿插 (Biomechanical Clearance)：
     *    - 僅在胸腹骨盆區域推進深度 (Z 軸)，保持相機視角下的手臂角度
     *    - 大臂後壁與側肋防穿插限制
     * 4. 歐拉角相位解包僅於真正過頂抬手 (uArm.y > 0.15) 啟用，徹底消除下垂手/插腰手翻轉為衝天翅膀之 Bug
     */
    _solveArmKinematics(
        shoulder, elbow, wrist, side,
        thoracicPitch, thoracicYaw, thoracicRoll, torsoHeight,
        thumb = null, pinky = null,
        leftHip = null, rightHip = null,
        isFrontOfPelvis = false, isHandOnHip = false
    ) {
        const sign = (side === 'left') ? 1.0 : -1.0;
        const ar = this.aspectRatio || 1.0;

        if (!elbow || !shoulder) {
            return {
                roll: sign * 0.12,
                pitch: 0,
                yaw: 0,
                flex: 0.15,
                twist: isFrontOfPelvis || isHandOnHip ? 2.60 : 1.48
            };
        }

        // 1. 相機平面投影向量 (Screen X-Y，經各向同性修正)
        const dxArm = (elbow.x - shoulder.x) * ar;
        const dyArm = -(elbow.y - shoulder.y); // Three.js 向上為正
        const lArm2D = Math.hypot(dxArm, dyArm);

        const scale = torsoHeight || 0.45;
        const LArm = scale * 0.58;
        const LFore = scale * 0.52;

        // 2. 解剖深度推估 (Pythagorean Depth)
        const rawDzArm = Math.sqrt(Math.max(0, LArm * LArm - lArm2D * lArm2D));
        const mpDz = -((elbow.z || 0) - (shoulder.z || 0));
        let zSignArm = isFrontOfPelvis ? 0.30 : (mpDz < -0.05 ? -0.15 : 0.40);
        if (isHandOnHip) zSignArm = 0.25;
        const dzArm = (lArm2D < LArm * 0.95) ? (rawDzArm * zSignArm) : 0.02 * LArm;

        const vArmCam = new THREE.Vector3(dxArm, dyArm, dzArm);

        // 前臂相機向量 (保留相機平面的真實投影傾角)
        let vForeCam;
        if (wrist) {
            const dxFore = (wrist.x - elbow.x) * ar;
            const dyFore = -(wrist.y - elbow.y);
            const lFore2D = Math.hypot(dxFore, dyFore);
            const rawDzFore = Math.sqrt(Math.max(0, LFore * LFore - lFore2D * lFore2D));
            const mpDzFore = -((wrist.z || 0) - (elbow.z || 0));
            let zSignFore = isFrontOfPelvis ? 0.45 : (mpDzFore < -0.05 ? -0.15 : 0.45);
            if (isHandOnHip) zSignFore = 0.30;
            const dzFore = (lFore2D < LFore * 0.95) ? (rawDzFore * zSignFore) : 0.02 * LFore;

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

        // 4. 生理防穿插約束與人體肌肉外輪廓包絡面 (Biomechanical Clearance)
        // A. 後背壁防穿透：大臂在胸腔坐標系中 Z 軸不可向後過度延伸
        if (uArm.z < -0.22) {
            uArm.z = -0.22;
            uArm.normalize();
        }

        // B. 肋骨防穿插約束：僅在手臂下垂且在軀幹高度時維持側向安全間距
        const pShoulderLocal = new THREE.Vector3(sign * 6.5, 8.8, -0.6);
        let pElbowLocal = pShoulderLocal.clone().addScaledVector(uArm, 8.5);

        if (uArm.y < 0 && pElbowLocal.y < 8.5 && pElbowLocal.y > 0.0 && sign * pElbowLocal.x < 4.8 && uArm.z < 0.5) {
            pElbowLocal.x = sign * 4.8;
            uArm = pElbowLocal.clone().sub(pShoulderLocal).normalize();
            pElbowLocal = pShoulderLocal.clone().addScaledVector(uArm, 8.5);
        }

        // C. 前臂與手腕人體肌肉防穿插 (純向前推進深度 Z，100% 保證相機正視角的 2D 傾角不變形)
        let pWristLocal = pElbowLocal.clone().addScaledVector(uFore, 7.4);

        if (pWristLocal.y < -1.5 && Math.abs(pWristLocal.x) < 5.2) {
            // 骨盆、大腿肌肉與裙面前側深度防線 (Z >= 1.8)
            if (pWristLocal.z < 1.8) {
                pWristLocal.z = 1.8;
                uFore = pWristLocal.clone().sub(pElbowLocal).normalize();
            }
        } else if (pWristLocal.y >= -1.5 && pWristLocal.y <= 3.0) {
            // 腰側與腹前區
            if (Math.abs(pWristLocal.x) < 4.8) {
                if (pWristLocal.z < 2.0) {
                    pWristLocal.z = 2.0;
                    uFore = pWristLocal.clone().sub(pElbowLocal).normalize();
                }
            } else if (Math.abs(pWristLocal.x) <= 5.8) {
                if (pWristLocal.z < 1.2) {
                    pWristLocal.z = 1.4;
                    uFore = pWristLocal.clone().sub(pElbowLocal).normalize();
                }
            }
        } else if (pWristLocal.y > 3.0 && Math.abs(pWristLocal.x) < 4.5) {
            // 胸大肌前側防線
            if (pWristLocal.z < 2.2 && pWristLocal.z > -0.5) {
                pWristLocal.z = 2.2;
                uFore = pWristLocal.clone().sub(pElbowLocal).normalize();
            }
        }

        // 5. 嚴密正交基底構造 (Two-Bone Orthonormal Basis)
        // yAxis: 大臂反向長軸 (在 Three.js 中大臂自然下垂沿 -Y，故 yAxis = -uArm)
        const yAxis = uArm.clone().negate().normalize();

        // 肘關節屈曲角度 (Flexion)
        const dotFlex = THREE.MathUtils.clamp(uArm.dot(uFore), -1.0, 1.0);
        const flex = Math.acos(dotFlex);

        // 前臂屈曲垂直向量 (uFore 在垂直於 uArm 切平面上的正交分量)
        const uForePerp = uFore.clone().sub(uArm.clone().multiplyScalar(dotFlex));
        const lPerp = uForePerp.length();

        // 正向法線預設 zDef (手臂筆直時，肘窩 cubital fossa 面向身體正前方 +Z)
        let zDef = new THREE.Vector3(0, 0, 1);
        const dotZY = zDef.dot(yAxis);
        zDef.sub(yAxis.clone().multiplyScalar(dotZY)).normalize();
        if (zDef.lengthSq() < 1e-4) {
            zDef = new THREE.Vector3(0, 1, 0);
        }

        // 當肘關節屈曲時，zAxis 嚴格對準前臂屈曲方向，使 elbowJoint.rotation.x = -flex 精確導引前臂指向手腕
        let zAxis;
        if (lPerp > 0.05 && flex > 0.08) {
            const zFlex = uForePerp.clone().normalize();
            const t = THREE.MathUtils.clamp((flex - 0.08) / 0.15, 0.0, 1.0);
            zAxis = zDef.clone().multiplyScalar(1.0 - t).addScaledVector(zFlex, t).normalize();
        } else {
            zAxis = zDef;
        }

        // xAxis: 肘關節鉸鏈橫軸 (保證右手法則正交基底)
        const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
        zAxis.crossVectors(xAxis, yAxis).normalize();

        // 構造旋轉矩陣並提取 'YXZ' 歐拉角
        const basisMat = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
        const euler = new THREE.Euler().setFromRotationMatrix(basisMat, 'YXZ');

        // 6. 智慧橈骨旋前/旋後 (Twist / Pronation-Supination)
        let twist = 1.48; // 預設：人體自然生理休止位 (Neutral/Semi-pronation ~85°)

        const isHanging = (uFore.y < -0.65) && (flex < 0.45);
        const isOnTorso = (flex >= 0.45) && (pWristLocal.y < 1.0) && (Math.abs(pWristLocal.x) < 5.8);
        const isRaised = (pWristLocal.y >= 1.0) && (flex >= 0.7);

        if (isHandOnHip) {
            twist = 2.65;
        } else if (isFrontOfPelvis) {
            twist = 2.60;
        } else if (isRaised) {
            twist = 0.35;
        } else if (isOnTorso) {
            twist = 2.65;
        } else if (isHanging) {
            twist = 1.48;
        } else {
            twist = THREE.MathUtils.clamp(1.48 + 0.45 * (flex - 0.45), 0.3, 2.7);
        }

        if (!isFrontOfPelvis && !isHandOnHip && thumb && pinky) {
            const latDiff = (side === 'left') ? ((thumb.x - pinky.x) * ar) : ((pinky.x - thumb.x) * ar);
            const twistBias = THREE.MathUtils.clamp(-latDiff * 3.5, -0.65, 0.65);
            twist += twistBias;
        }

        twist = THREE.MathUtils.clamp(twist, 0.1, Math.PI);

        // 7. 歐拉角相位解包與生理極限約束 (Phase Unwrapping & Anatomical Clamping)
        let roll = euler.z;
        const isArmRaisedOverhead = (uArm.y > 0.15); // 僅在大臂真正抬過肩膀水準線時才需解包過頂角
        if (isArmRaisedOverhead) {
            if (side === 'right' && roll > Math.PI * 0.5) {
                roll -= 2 * Math.PI;
            }
            if (side === 'left' && roll < -Math.PI * 0.5) {
                roll += 2 * Math.PI;
            }
            roll = this._clamp(roll, side === 'right' ? -3.23 : -0.85, side === 'right' ? 0.85 : 3.23);
        } else {
            // 正常下垂、橫擺、側身或插腰姿態：維持解剖學自然角度範圍，絕不反向解包翻轉
            roll = this._clamp(roll, side === 'right' ? -1.85 : -0.75, side === 'right' ? 0.75 : 1.85);
        }

        return {
            roll: roll,
            pitch: this._clamp(euler.x, -2.2, 2.2),
            yaw: this._clamp(euler.y, -2.2, 2.2),
            flex: this._clamp(flex, 0, 2.7),
            twist: twist
        };
    }

    /**
     * 完整下肢 3D 正交基底逆向運動學解算器 (Two-Bone Orthonormal IK Solver for Lower Limbs)
     * 1. 骨盆髖臼連接 (Acetabular Socket Alignment)
     * 2. 忠實保持相機 2D 投影角度 (Screen-Space Vector Tracking)
     * 3. 嚴格人體生理約束：
     *    - 膝關節鉸鏈單向後折 (Knee Flexion >= 0，絕不向前反折/脫臼)
     *    - 髕骨面朝膝關節屈曲反向 (+Z_local)，消除膝蓋側面外擴畸變
     * 4. 踝關節 3D 空間姿態解算：
     *    - 腳尖朝向 (Ankle Yaw / 內外八 / 側向轉向)
     *    - 腳背屈曲 (Ankle Pitch / 踮腳 / 垂足 / 貼地)
     *    - 距下關節接地翻轉 (Subtalar Ground-Leveling Roll / 內翻/外翻平貼地面，約束於 ±12.5°)
     */
    _solveLegKinematics(
        hip, knee, ankle, footIndex, heel, side,
        pelvisPitch, pelvisYaw, pelvisRoll, torsoHeight
    ) {
        const sign = (side === 'left') ? 1.0 : -1.0;
        const ar = this.aspectRatio || 1.0;

        if (!hip || !knee) {
            return {
                pitch: 0,
                roll: sign * 0.06,
                yaw: 0,
                kneeFlex: 0.05,
                anklePitch: -0.02,
                ankleYaw: sign * 0.12,
                ankleRoll: 0
            };
        }

        // 1. 相機平面投影向量 (Screen X-Y，經各向同性修正)
        const dxFemur = (knee.x - hip.x) * ar;
        const dyFemur = -(knee.y - hip.y); // Three.js 向上為正
        const lFemur2D = Math.hypot(dxFemur, dyFemur);

        const scale = torsoHeight || 0.45;
        const LFemur = scale * 0.65;
        const LTibia = scale * 0.60;

        // 2. 解剖深度推估 (Pythagorean Depth)
        const rawDzFemur = Math.sqrt(Math.max(0, LFemur * LFemur - lFemur2D * lFemur2D));
        const mpDzFemur = -((knee.z || 0) - (hip.z || 0));
        const dzFemur = (lFemur2D < LFemur * 0.95)
            ? this._clamp(rawDzFemur * mpDzFemur * 0.5, -0.35 * LFemur, 0.35 * LFemur)
            : 0.0;

        const vFemurCam = new THREE.Vector3(dxFemur, dyFemur, dzFemur);

        // 小腿 (Tibia & Fibula) 相機向量
        let vTibiaCam;
        if (ankle) {
            const dxShin = (ankle.x - knee.x) * ar;
            const dyShin = -(ankle.y - knee.y);
            const lShin2D = Math.hypot(dxShin, dyShin);
            const rawDzShin = Math.sqrt(Math.max(0, LTibia * LTibia - lShin2D * lShin2D));
            const mpDzShin = -((ankle.z || 0) - (knee.z || 0));
            // 人體小腿彎曲必然向後 (-Z)，絕不允許向前反折
            const zShinMag = Math.max(0.15, Math.min(0.85, Math.abs(mpDzShin)));
            const dzShin = (lShin2D < LTibia * 0.95) ? (-rawDzShin * zShinMag) : -0.05 * LTibia;

            vTibiaCam = new THREE.Vector3(dxShin, dyShin, dzShin);
        } else {
            vTibiaCam = new THREE.Vector3(sign * 0.02, -LTibia, -0.05 * LTibia);
        }

        // 3. 逆變換至骨盆局部坐標系 (Pelvis Local Frame)
        const qPelvis = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(pelvisPitch, pelvisYaw, pelvisRoll, 'XYZ')
        );
        const qPelvisInv = qPelvis.clone().invert();

        let uFemur = vFemurCam.clone().applyQuaternion(qPelvisInv).normalize();
        let uTibia = vTibiaCam.clone().applyQuaternion(qPelvisInv).normalize();

        // 4. 生理防穿插與正常站立角度約束
        // 股骨在骨盆坐標系中下垂長軸 (Three.js 股骨自然下垂沿 -Y)
        const yAxis = uFemur.clone().negate().normalize();

        // 膝關節屈曲角度 (Flexion)
        const dotFlex = THREE.MathUtils.clamp(uFemur.dot(uTibia), -1.0, 1.0);
        let flex = Math.acos(dotFlex);
        flex = this._clamp(flex, 0.02, 2.4);

        // 脛骨垂直分量 (uTibia 在垂直於 uFemur 切平面上的正交分量)
        const uTibiaPerp = uTibia.clone().sub(uFemur.clone().multiplyScalar(dotFlex));
        const lTibiaPerp = uTibiaPerp.length();

        // 髕骨預設法向 (站立時面朝前方，微帶約 4° 生理外展)
        let zDef = new THREE.Vector3(sign * 0.08, 0.0, 0.99).normalize();
        const dotZY = zDef.dot(yAxis);
        zDef.sub(yAxis.clone().multiplyScalar(dotZY)).normalize();
        if (zDef.lengthSq() < 1e-4) {
            zDef = new THREE.Vector3(0, 0, 1);
        }

        // 髕骨方向：膝蓋向後折疊 (-Z)，故髕骨 (+Z_local) 指向脛骨屈曲反方向
        let zAxis;
        if (lTibiaPerp > 0.05 && flex > 0.08) {
            const zKnee = uTibiaPerp.clone().negate().normalize();
            if (zKnee.z < 0) {
                // 若檢測噪聲導致髕骨倒插骨盆內部，回退至預設前向
                zAxis = zDef;
            } else {
                const t = THREE.MathUtils.clamp((flex - 0.08) / 0.18, 0.0, 1.0);
                zAxis = zDef.clone().multiplyScalar(1.0 - t).addScaledVector(zKnee, t).normalize();
            }
        } else {
            zAxis = zDef;
        }

        const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
        zAxis.crossVectors(xAxis, yAxis).normalize();

        const basisMat = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
        const euler = new THREE.Euler().setFromRotationMatrix(basisMat, 'YXZ');

        // 5. 踝關節與足部三維運動學 (Ankle & Foot 3D Kinematics)
        let ankleYaw = sign * 0.12; // 預設微外八 ~7°
        let anklePitch = -0.02;
        let ankleRoll = 0;

        if (ankle && (footIndex || heel)) {
            // A. 相機平面投影向量 (Screen X-Y，經各向同性修正)
            const toePt = footIndex || ankle;
            const refPt = heel || ankle;
            const dxFoot = (toePt.x - refPt.x) * ar;
            const dyFoot = -(toePt.y - refPt.y); // Three.js 向上為正
            const lFoot2D = Math.hypot(dxFoot, dyFoot);

            const LFoot = scale * 0.42; // 足部長度約為軀幹高度的 42%

            // B. 深度推估 (Pythagorean Depth)
            const rawDzFoot = Math.sqrt(Math.max(0, LFoot * LFoot - lFoot2D * lFoot2D));
            const mpDzFoot = -((toePt.z || 0) - (refPt.z || 0));
            const zSignFoot = (mpDzFoot < -0.06) ? -0.3 : 0.85;
            const dzFoot = (lFoot2D < LFoot * 0.95) ? (rawDzFoot * zSignFoot) : 0.10 * LFoot;

            const vFootCam = new THREE.Vector3(dxFoot, dyFoot, dzFoot);

            // C. 變換至骨盆局部坐標系
            const vFootPelvis = vFootCam.clone().applyQuaternion(qPelvisInv).normalize();

            // D. 計算脛骨在骨盆坐標系中的三維旋轉 (qTibia)
            const qHip = new THREE.Quaternion().setFromEuler(
                new THREE.Euler(euler.x, euler.y, euler.z, 'YXZ')
            );
            const qKnee = new THREE.Quaternion().setFromAxisAngle(
                new THREE.Vector3(1, 0, 0), flex
            );
            const qTibia = qHip.clone().multiply(qKnee);
            const qTibiaInv = qTibia.clone().invert();

            // E. 將足部向量逆變換至踝關節 (小腿脛骨下端) 局部坐標系
            const uFootLocal = vFootPelvis.clone().applyQuaternion(qTibiaInv).normalize();

            // F. 解算踝關節 Yaw (腳尖內八/外八) 與 Pitch (腳背屈曲/踮腳/垂足)
            ankleYaw = Math.atan2(uFootLocal.x, uFootLocal.z);
            const horiz = Math.hypot(uFootLocal.x, uFootLocal.z);
            anklePitch = Math.atan2(-uFootLocal.y, horiz);

            // G. 腳底平貼地面補償 (Ground Leveling Roll for Subtalar Joint)
            const qPreRoll = qTibia.clone()
                .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ankleYaw))
                .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), anklePitch));

            // 足底橫軸 (Local X) 與垂直軸 (Local Y) 在骨盆/世界空間中的朝向
            const vLateral = new THREE.Vector3(1, 0, 0).applyQuaternion(qPreRoll);
            const vUp = new THREE.Vector3(0, 1, 0).applyQuaternion(qPreRoll);

            // 計算使足底橫軸平貼水平地面 (Y=0) 的旋前/旋後 (Roll)
            let groundRoll = Math.atan2(-vLateral.y, vUp.y);
            // 嚴格人體距下關節生理內翻/外翻極限 (不超過 ±12.5°)
            groundRoll = this._clamp(groundRoll, -0.22, 0.22);

            // 當腳離地高抬或大角度踮腳時，平滑衰減貼地補償，維持生理自然休止位
            const isGrounded = (anklePitch < 0.45) && (flex < 0.7);
            const groundWeight = isGrounded ? THREE.MathUtils.clamp(1.0 - (anklePitch - 0.15) / 0.3, 0.0, 1.0) : 0.0;
            ankleRoll = groundRoll * groundWeight;
        }

        return {
            pitch: this._clamp(euler.x, -0.55, 0.85),
            roll: this._clamp(euler.z, side === 'left' ? -0.30 : -0.65, side === 'left' ? 0.65 : 0.30),
            yaw: this._clamp(euler.y, -0.65, 0.65),
            kneeFlex: this._clamp(flex, 0.02, 2.4),
            anklePitch: this._clamp(anklePitch, -0.50, 0.75),
            ankleYaw: this._clamp(ankleYaw, -0.60, 0.60),
            ankleRoll: this._clamp(ankleRoll, -0.25, 0.25)
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
            leftHipPitch: 0.05,
            leftHipRoll: 0.08,
            leftHipYaw: 0,
            leftKneeFlex: 0.12,
            leftAnklePitch: -0.06,
            leftAnkleYaw: 0.12,
            leftAnkleRoll: 0,
            rightHipPitch: -0.08,
            rightHipRoll: -0.08,
            rightHipYaw: 0,
            rightKneeFlex: 0.08,
            rightAnklePitch: -0.04,
            rightAnkleYaw: -0.12,
            rightAnkleRoll: 0,
            landmarks2D: null
        };
    }

    _clamp(val, min, max) {
        return Math.max(min, Math.min(max, val));
    }
}
