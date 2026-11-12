import * as THREE from 'three';
import { ConfidenceEvaluator, ThoracoPelvicCoupler, HierarchicalArmSolver } from './kinematicSolver.js?v=7.0';

/**
 * AnatoPose 3D - Torso, Pelvis & Upper Limb Pose Estimator
 * 
 * 核心升級：透視縮短 (Foreshortening) 3D 側身姿態解算器
 * 1. 徹底解決「回眸/扭頭看鏡頭導致側身被誤判為正面」的經典缺陷
 * 2. 採用「雙肩投影寬度 / 軀幹高度比值」計算餘弦壓縮量 (cos(Yaw))，精準辨識 0°~85° 任意側身角度
 * 3. 結合 Z 軸深度符號自動判斷轉向左側或右側
 * 4. 骨盆 (Pelvis) 與頸椎 (Cervical) 同步還原側身與回眸動態
 */

/**
 * 解剖學軀幹與脊椎 3D 碰撞防護常數 (Anatomical Torso Collision Config)
 * 參數化模組設計：未來更換高精細醫學模型或加入肌肉/皮膚層時，只需微調此配置表！
 */
export const ANATOMICAL_COLLISION_CONFIG = {
    // 1. 脊椎剛性禁區 (Spine Shield Core) - 嚴禁任何上肢骨骼穿透
    spineShield: {
        radiusX: 2.8,       // 脊椎與橫突/棘突禁區橫向半徑 (|X| < 2.8)
        radiusZ: 2.2,       // 脊椎柱後壁至前縱韌帶矢狀深度 (Z < 2.2)
        yMin: -3.0,         // 薦骨/骨盆上緣
        yMax: 8.5           // 胸椎上口 (T1)
    },
    // 2. 腹壁與胸腹橢圓包絡面 (Abdominal & Torso Ellipsoid Clearance)
    torsoEnvelope: {
        radiusX: 4.4,       // 側腰/髂脊外緣半徑 (插腰時的側向極限)
        radiusZ: 2.8,       // 腹壁前凸矢狀半徑 (腹前置手的前向支撐面)
        centerZ: 0.8,       // 腹腔中心相對於脊椎前移量
        waistYMin: -2.5,    // 骨盆髂脊高度
        waistYMax: 3.5      // 肋弓與劍突高度
    },
    // 3. 手部與指骨末端幾何常數
    handClearance: {
        armLen: 8.5,        // 肱骨大臂長度
        foreLen: 7.4,       // 前臂尺骨橈骨長度
        handLen: 3.5        // 掌骨與指骨延伸等效長度
    }
};

export class TorsoPoseEstimator {
    constructor() {
        this.detectorReady = false;
        this.holistic = null;
        this.poseDetector = null;
        this.isMirrored = false;
        this.lastRawResults = null;
        this.lastPose = null;
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
                    minDetectionConfidence: 0.35,
                    minTrackingConfidence: 0.35
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
                    minDetectionConfidence: 0.35,
                    minTrackingConfidence: 0.35
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

    async _runInference(imageSource) {
        if (this.holistic) {
            if (this.holistic.reset) {
                try { this.holistic.reset(); } catch (_) {}
            }
            return new Promise((resolve) => {
                let finished = false;
                const timeout = setTimeout(() => {
                    if (!finished) {
                        finished = true;
                        resolve(null);
                    }
                }, 8000);

                this.holistic.onResults((results) => {
                    if (!finished) {
                        finished = true;
                        clearTimeout(timeout);
                        resolve(results);
                    }
                });

                this.holistic.send({ image: imageSource }).catch(() => {
                    if (!finished) {
                        finished = true;
                        clearTimeout(timeout);
                        resolve(null);
                    }
                });
            });
        }

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
                }, 6000);

                this.poseDetector.onResults((results) => {
                    if (!finished) {
                        finished = true;
                        clearTimeout(timeout);
                        resolve(results);
                    }
                });

                this.poseDetector.send({ image: imageSource }).catch(() => {
                    if (!finished) {
                        finished = true;
                        clearTimeout(timeout);
                        resolve(null);
                    }
                });
            });
        }

        return null;
    }

    _createEnhancedCanvas(imageElement, contrast = 1.35, brightness = 1.08) {
        const origW = imageElement.naturalWidth || imageElement.videoWidth || imageElement.width || 1;
        const origH = imageElement.naturalHeight || imageElement.videoHeight || imageElement.height || 1;
        const canvas = document.createElement('canvas');
        canvas.width = origW;
        canvas.height = origH;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        ctx.filter = `contrast(${contrast}) brightness(${brightness})`;
        ctx.drawImage(imageElement, 0, 0, origW, origH);
        return canvas;
    }

    _createRotatedCanvas(imageElement, angleDeg) {
        const origW = imageElement.naturalWidth || imageElement.videoWidth || imageElement.width || 1;
        const origH = imageElement.naturalHeight || imageElement.videoHeight || imageElement.height || 1;
        const rad = angleDeg * Math.PI / 180;
        const sin = Math.abs(Math.sin(rad));
        const cos = Math.abs(Math.cos(rad));
        const newW = Math.round(origW * cos + origH * sin);
        const newH = Math.round(origW * sin + origH * cos);

        const canvas = document.createElement('canvas');
        canvas.width = newW;
        canvas.height = newH;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        ctx.translate(newW * 0.5, newH * 0.5);
        ctx.rotate(rad);
        ctx.drawImage(imageElement, -origW * 0.5, -origH * 0.5);
        return canvas;
    }

    _inverseRotateLandmarks(landmarks, angleDeg, origW, origH, newW, newH) {
        if (!landmarks || !Array.isArray(landmarks)) return landmarks;
        const rad = angleDeg * Math.PI / 180;
        const cosNeg = Math.cos(-rad);
        const sinNeg = Math.sin(-rad);

        return landmarks.map(lm => {
            if (!lm) return lm;
            const Xr = lm.x * newW - newW * 0.5;
            const Yr = lm.y * newH - newH * 0.5;

            const Xorig = Xr * cosNeg - Yr * sinNeg;
            const Yorig = Xr * sinNeg + Yr * cosNeg;

            return {
                ...lm,
                x: (Xorig + origW * 0.5) / origW,
                y: (Yorig + origH * 0.5) / origH
            };
        });
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

        // 1. 優先以原生影像方向進行單次推理
        const rawResults = await this._runInference(imageElement);
        if (rawResults && rawResults.poseLandmarks && rawResults.poseLandmarks.length > 0) {
            try {
                const pose = this._processLandmarks(rawResults);
                if (pose) {
                    this.lastRawResults = rawResults;
                    this.lastPose = pose;
                    return pose;
                }
            } catch (err) {
                console.error("[AnatoPose] Landmark processing error:", err);
            }
        }

        // 2. 自適應對比度與靈敏度探測 (針對深色寬鬆大衣/夾克、低對比灰調全身棚拍照)
        const enhCanvas = this._createEnhancedCanvas(imageElement, 1.35, 1.08);
        if (enhCanvas) {
            if (this.holistic && this.holistic.setOptions) {
                this.holistic.setOptions({ minDetectionConfidence: 0.32, minTrackingConfidence: 0.32 });
            }
            const enhResults = await this._runInference(enhCanvas);
            if (this.holistic && this.holistic.setOptions) {
                this.holistic.setOptions({ minDetectionConfidence: 0.35, minTrackingConfidence: 0.35 });
            }
            if (enhResults && enhResults.poseLandmarks && enhResults.poseLandmarks.length > 0) {
                try {
                    const pose = this._processLandmarks(enhResults);
                    if (pose) {
                        this.lastRawResults = enhResults;
                        this.lastPose = pose;
                        return pose;
                    }
                } catch (err) {
                    console.error("[AnatoPose] Enhanced contrast processing error:", err);
                }
            }
        }

        // 3. 旋轉探索 TTA (Test-Time Augmentation) 機制：
        // 針對排球空翻扣殺、高空飛躍、舞蹈、體操等非垂直傾斜姿態，依次旋轉影像尋找人體拓撲
        const ttaAngles = [-45, 45, -30, 30, -90, 90];
        for (const angle of ttaAngles) {
            const rotCanvas = this._createRotatedCanvas(imageElement, angle);
            if (!rotCanvas) continue;
            const rotResults = await this._runInference(rotCanvas);
            if (rotResults && rotResults.poseLandmarks && rotResults.poseLandmarks.length > 0) {
                try {
                    const invResults = {
                        ...rotResults,
                        poseLandmarks: this._inverseRotateLandmarks(rotResults.poseLandmarks, angle, imgW, imgH, rotCanvas.width, rotCanvas.height),
                        leftHandLandmarks: this._inverseRotateLandmarks(rotResults.leftHandLandmarks, angle, imgW, imgH, rotCanvas.width, rotCanvas.height),
                        rightHandLandmarks: this._inverseRotateLandmarks(rotResults.rightHandLandmarks, angle, imgW, imgH, rotCanvas.width, rotCanvas.height)
                    };
                    const pose = this._processLandmarks(invResults);
                    if (pose) {
                        this.lastRawResults = invResults;
                        this.lastPose = pose;
                        return pose;
                    }
                } catch (err) {
                    console.error(`[AnatoPose] TTA ${angle}° processing error:`, err);
                }
            }
        }

        return null;
    }

    /**
     * 手動重算當前影像姿態 (支援正面、純背身、背身回眸即時切換)
     */
    reprocessWithStance(mode = 'toggle') {
        if (!this.lastRawResults) return null;
        let targetMode = mode;
        if (mode === 'toggle') {
            targetMode = (this.lastPose && this.lastPose.isBackStance) ? 'front' : 'over_shoulder';
        }
        const pose = this._processLandmarks(this.lastRawResults, targetMode);
        if (pose) {
            this.lastPose = pose;
        }
        return pose;
    }

    _processLandmarks(results, forceStanceMode = null) {
        if (!results || !results.poseLandmarks || results.poseLandmarks.length === 0) {
            return null;
        }

        const lm = results.poseLandmarks;

        const nose = lm[0];
        const leftEyeInner = lm[1];
        const leftEye = lm[2];
        const leftEyeOuter = lm[3];
        const rightEyeInner = lm[4];
        const rightEye = lm[5];
        const rightEyeOuter = lm[6];
        const leftEar = lm[7];
        const rightEar = lm[8];
        const leftMouth = lm[9];
        const rightMouth = lm[10];
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

        // 雙眼中點 (Mid-Eye 2D Center - 全域五官幾何基準)
        const midEyeX = (leftEye && rightEye) ? (leftEye.x + rightEye.x) * 0.5 : (nose ? nose.x : 0.5);
        const midEyeY = (leftEye && rightEye) ? (leftEye.y + rightEye.y) * 0.5 : (nose ? nose.y - 0.045 : 0.2);

        // -------------------------------------------------------------
        // 藝用解剖頭部姿態解算 (Head Yaw, Pitch, Roll)
        // 核心：純 2D 幾何五官比例與兩側投影面積 (Eye & Facial Area Symmetry)
        // 徹底杜絕單圖 3D z 深度噪聲與單臂舉天造成的假性旋轉
        // -------------------------------------------------------------
        let headRoll = 0;
        if (leftEye && rightEye) {
            const eyeDx = (leftEye.x - rightEye.x) * ar;
            const eyeDy = leftEye.y - rightEye.y;
            headRoll = -Math.atan2(eyeDy, Math.max(0.01, eyeDx));
        }

        // 1. 眼睛投影寬度/面積縮小率 (Eye Width / Area Foreshortening)
        let eyeWidthAsym = 0;
        if (leftEyeInner && leftEyeOuter && rightEyeInner && rightEyeOuter) {
            const leftEyeW = Math.hypot((leftEyeOuter.x - leftEyeInner.x) * ar, leftEyeOuter.y - leftEyeInner.y);
            const rightEyeW = Math.hypot((rightEyeOuter.x - rightEyeInner.x) * ar, rightEyeOuter.y - rightEyeInner.y);
            eyeWidthAsym = (rightEyeW - leftEyeW) / Math.max(0.005, rightEyeW + leftEyeW);
        }

        // 2. 鼻樑正中線與眼距比例解算純 2D Head Yaw (零單圖深度噪聲干擾)
        let headYaw = 0;
        if (leftEye && rightEye && nose) {
            const midEyeX = (leftEye.x + rightEye.x) * 0.5;
            const eyeDist = Math.max(0.015, Math.abs(leftEye.x - rightEye.x) * ar);
            // 鼻尖相對雙眼中點之水平偏移量 (在 2D 影像上，鼻子偏向哪一側即代表臉部朝向該側)
            const noseOffset = (nose.x - midEyeX) * ar;
            const eyeYawRatio = noseOffset / (eyeDist * 0.5);

            let earYawRatio = 0;
            let hasValidEars = false;
            if (leftEar && rightEar && (leftEar.visibility === undefined || leftEar.visibility > 0.45) &&
                (rightEar.visibility === undefined || rightEar.visibility > 0.45)) {
                const midEarX = (leftEar.x + rightEar.x) * 0.5;
                const earDist = Math.max(0.025, Math.abs(leftEar.x - rightEar.x) * ar);
                earYawRatio = (nose.x - midEarX) * ar / (earDist * 0.5);
                hasValidEars = true;
            }

            if (hasValidEars) {
                headYaw = (earYawRatio * 0.60 + eyeYawRatio * 0.40) * 0.85;
            } else {
                headYaw = (eyeYawRatio * 0.75 + eyeWidthAsym * 0.25) * 0.90;
            }
        }
        headYaw = this._clamp(headYaw, -1.2, 1.2);

        let headPitch = 0;
        if (leftEye && rightEye && nose) {
            const midEyeY = (leftEye.y + rightEye.y) * 0.5;
            const eyeNoseDy = nose.y - midEyeY;

            // 1. 口-鼻-眼垂直投影比例 (Mouth Ratio)
            let mouthPitch = null;
            if (leftMouth && rightMouth &&
                (leftMouth.visibility === undefined || leftMouth.visibility > 0.30) &&
                (rightMouth.visibility === undefined || rightMouth.visibility > 0.30)) {
                const midMouthY = (leftMouth.y + rightMouth.y) * 0.5;
                const eyeMouthDy = Math.max(0.02, midMouthY - midEyeY);
                // 解剖五官黃金比例：正面平視仰角 0° 時，眼鼻垂直距佔眼口距約 50%
                // 低頭 (Flexion) 時鼻尖相對眼睛下移、更靠近唇口，投影比例增高 (>0.50)，產生正向 pitch (>0)
                // 仰頭 (Extension) 時鼻尖相對眼睛上移、遠離唇口，投影比例縮小 (<0.50)，產生負向 pitch (<0)
                const normRatio = eyeNoseDy / eyeMouthDy;
                const pitchOffset = normRatio - 0.50;
                mouthPitch = THREE.MathUtils.clamp(pitchOffset * 2.8, -0.42, 0.42);
            }

            // 2. 雙耳-雙眼高度差 (Ear-Eye Offset)
            let earPitch = null;
            if (leftEar && rightEar &&
                (leftEar.visibility === undefined || leftEar.visibility > 0.40) &&
                (rightEar.visibility === undefined || rightEar.visibility > 0.40)) {
                const midEarY = (leftEar.y + rightEar.y) * 0.5;
                const faceScale = Math.max(0.02, eyeNoseDy);
                // 影像座標向下為正：低頭時雙耳相對眼睛上升 (midEarY < midEyeY)，midEyeY - midEarY > 0 -> pitch > 0
                // 仰頭時雙耳相對眼睛下降 (midEarY > midEyeY)，midEyeY - midEarY < 0 -> pitch < 0
                const earEyeOffset = (midEyeY - midEarY) / faceScale;
                earPitch = THREE.MathUtils.clamp(earEyeOffset * 0.85, -0.42, 0.42);
            }

            // 3. 雙眼-鼻距水平比基準校正 (Fallback when ears/mouth occluded)
            const eyeDx = Math.max(0.02, Math.abs(leftEye.x - rightEye.x) * ar);
            const normNose = eyeNoseDy / eyeDx;
            // 解剖五官常態：眼鼻垂直距約為雙眼間距之 52% (非 72%)
            const fallbackFacePitch = THREE.MathUtils.clamp((normNose - 0.52) * 2.0, -0.38, 0.38);

            let facePitch = fallbackFacePitch;
            if (mouthPitch !== null && earPitch !== null) {
                facePitch = mouthPitch * 0.65 + earPitch * 0.35;
            } else if (mouthPitch !== null) {
                facePitch = mouthPitch;
            } else if (earPitch !== null) {
                facePitch = earPitch;
            }

            // 4. 眼-肩垂直距離壓縮比 (Eye-to-Shoulder Compression Ratio) - 極其抗毛髮/手部遮擋
            let pitchFromShoulder = null;
            if (leftShoulder && rightShoulder) {
                const midShoulderY = (leftShoulder.y + rightShoulder.y) * 0.5;
                const eyeShoulderDy = midShoulderY - midEyeY;
                const normEyeShoulder = eyeShoulderDy / Math.max(0.1, torsoHeight || 0.45);
                // 平視常態約 0.245~0.27；低頭下巴貼胸時眼肩距顯著壓縮 (< 0.22)；仰頭伸頸時顯著拉長 (> 0.28)
                const shoulderOffset = 0.245 - normEyeShoulder;
                pitchFromShoulder = THREE.MathUtils.clamp(shoulderOffset * 2.4, -0.42, 0.42);
            }

            // 5. MediaPipe 3D 深度傾向 (Z-depth Trend)
            let pitchFromZ = null;
            if (leftMouth && rightMouth) {
                const midMouthZ = ((leftMouth.z || 0) + (rightMouth.z || 0)) * 0.5;
                const midEyeZ = ((leftEye.z || 0) + (rightEye.z || 0)) * 0.5;
                // 低頭時下巴與嘴巴向後內收 (Z 變大)、額眼向前 (Z 變小)
                const dzMouthEye = midMouthZ - midEyeZ;
                pitchFromZ = THREE.MathUtils.clamp(dzMouthEye * 2.0, -0.35, 0.35);
            }

            // 多特徵加權融合 (Multi-cue Fusion)
            if (pitchFromShoulder !== null) {
                headPitch = facePitch * 0.55 + pitchFromShoulder * 0.45;
            } else {
                headPitch = facePitch;
            }

            if (pitchFromZ !== null) {
                headPitch = headPitch * 0.80 + pitchFromZ * 0.20;
            }
        }
        headPitch = this._clamp(headPitch, -0.42, 0.42);

        // 4b. 2D 頭部幾何跨度與頂點位置預估 (Head Span & Crown Top)
        let headSpan2D = 0;
        let headTopY = (leftEye && rightEye) ? (leftEye.y + rightEye.y) * 0.5 - 0.05 : 0.1;
        if (leftEye && rightEye && nose) {
            const midEyeY = (leftEye.y + rightEye.y) * 0.5;

            // 1. 優先使用五官解剖黃金比例 (眼-口垂直軸佔全頭骨垂直高度約 35.5%)
            if (leftMouth && rightMouth) {
                const midMouthY = (leftMouth.y + rightMouth.y) * 0.5;
                const eyeMouthDy = Math.abs(midMouthY - midEyeY);
                if (eyeMouthDy > 0.015) {
                    headSpan2D = eyeMouthDy / 0.355;
                    headTopY = midEyeY - headSpan2D * 0.50;
                }
            }

            // 2. 次選使用眼-鼻軸推算 (眼-鼻垂直軸佔全頭高約 22%)
            if (headSpan2D <= 0 && nose) {
                const eyeNoseDy = Math.abs(nose.y - midEyeY);
                if (eyeNoseDy > 0.01) {
                    headSpan2D = eyeNoseDy / 0.22;
                    headTopY = midEyeY - headSpan2D * 0.50;
                }
            }

            // 3. 次選使用雙耳橫向跨度推算 (頭寬佔全頭高約 64%)
            if (headSpan2D <= 0 && leftEar && rightEar) {
                const earDist = Math.abs(leftEar.x - rightEar.x) * ar;
                if (earDist > 0.02) {
                    headSpan2D = earDist / 0.64;
                    headTopY = midEyeY - headSpan2D * 0.50;
                }
            }

            // 4. 最後備援：使用眼肩距折算
            if (headSpan2D <= 0 && leftShoulder && rightShoulder) {
                const midShoulderY = (leftShoulder.y + rightShoulder.y) * 0.5;
                const eyeShoulderDy = Math.max(0.04, midShoulderY - midEyeY);
                headSpan2D = eyeShoulderDy * 1.18;
                headTopY = midEyeY - headSpan2D * 0.50;
            }
        }

        // -------------------------------------------------------------
        // 5. 核心：3D 解剖肩帶與骨盆水平轉向解算 (Yaw & 側身狀態機)
        // -------------------------------------------------------------
        const normShoulderSpan = shoulderSpan / Math.max(0.1, torsoHeight);
        const normHipSpan = Math.abs(hipDx) / Math.max(0.1, torsoHeight);

        // A. 側身狀態機特徵指標 (Profile Stance Cues: 75° ~ 90° View)
        const eyeDx = (leftEye && rightEye) ? Math.abs(leftEye.x - rightEye.x) * ar : 0.05;
        const normEyeSpan = eyeDx / Math.max(0.03, headSpan2D || 0.15); // 正面常態約 0.35~0.55，側面 < 0.22

        const leftEarVis = leftEar ? (leftEar.visibility ?? 0.5) : 0;
        const rightEarVis = rightEar ? (rightEar.visibility ?? 0.5) : 0;
        const hasSingleEar = (leftEarVis > 0.40 && rightEarVis < 0.32) || (rightEarVis > 0.40 && leftEarVis < 0.32);

        const noseOffset = nose ? (nose.x - midEyeX) * ar : 0;
        const isNoseExtruding = Math.abs(noseOffset) > Math.max(0.012, eyeDx * 0.45);

        // 雙肩與雙髖水平投影壓縮 (橫向寬度相對軀幹高度之比例)
        const normShoulderX = Math.abs(shoulderDx) / Math.max(0.1, torsoHeight); // 正面 > 0.46，側面 < 0.30
        const normHipX = Math.abs(hipDx) / Math.max(0.1, torsoHeight); // 正面 > 0.20，側面 < 0.18

        const isTorsoUltraNarrow = normShoulderX < 0.22;
        const isTorsoNarrow = normShoulderX < 0.32 && normHipX < 0.22;
        const isFaceProfile = (eyeDx < 0.032) || (normEyeSpan < 0.22) || (hasSingleEar && isNoseExtruding) || Math.abs(headYaw) > 0.45;

        // -------------------------------------------------------------
        // C. 背身狀態機判定 (Back Stance Machine / BSM Trigger)
        // -------------------------------------------------------------
        // 1. 面部五官整體隱匿度分析 (純背身時五官信賴度極低或完全缺失)
        const faceVisList = [
            nose?.visibility,
            leftEye?.visibility,
            rightEye?.visibility,
            leftMouth?.visibility,
            rightMouth?.visibility
        ].filter(v => v !== null && v !== undefined && !isNaN(v));

        const avgFaceVis = faceVisList.length > 0
            ? (faceVisList.reduce((a, b) => a + b, 0) / faceVisList.length)
            : 0.0;

        // 2. 雙耳拓撲交叉 (人體背對相機時，左耳出現在畫面左側，右耳出現在畫面右側)
        let isEarInverted = false;
        if (leftEar && rightEar && (leftEar.visibility ?? 1.0) > 0.25 && (rightEar.visibility ?? 1.0) > 0.25) {
            isEarInverted = (leftEar.x < rightEar.x - 0.015);
        }

        // 3. 雙肩水平拓撲顛倒 (若 MediaPipe 內建模型已識別背面並將 11/12 標籤對調)
        const isShoulderInverted = !!(leftShoulder && rightShoulder && leftShoulder.x < rightShoulder.x - 0.02);

        // 4. 雙髖水平拓撲顛倒
        const isHipInverted = !!(leftHip && rightHip && leftHip.x < rightHip.x - 0.02);

        // 5. 正面明確特徵評分 (正面保護，杜絕正臉誤判為背身)
        const hasClearFrontFace = (leftEye && rightEye && nose) &&
                                  (leftEye.visibility ?? 0) > 0.65 &&
                                  (rightEye.visibility ?? 0) > 0.65 &&
                                  (nose.visibility ?? 0) > 0.65 &&
                                  !isEarInverted;

        let isBackStance = false;
        let isOverShoulderLook = false;

        if (forceStanceMode === 'back') {
            isBackStance = true;
            isOverShoulderLook = false;
        } else if (forceStanceMode === 'over_shoulder') {
            isBackStance = true;
            isOverShoulderLook = true;
        } else if (forceStanceMode === 'front') {
            isBackStance = false;
            isOverShoulderLook = false;
        } else {
            // 6. 腳後跟與腳尖前後深度 (Heel vs Foot Index Depth)
            let heelInFrontCount = 0;
            if (leftHeel && leftFootIndex && (leftHeel.visibility ?? 0) > 0.35 && (leftFootIndex.visibility ?? 0) > 0.35) {
                if ((leftHeel.z || 0) < (leftFootIndex.z || 0) - 0.015) heelInFrontCount++;
            }
            if (rightHeel && rightFootIndex && (rightHeel.visibility ?? 0) > 0.35 && (rightFootIndex.visibility ?? 0) > 0.35) {
                if ((rightHeel.z || 0) < (rightFootIndex.z || 0) - 0.015) heelInFrontCount++;
            }

            // 7. 手臂觸摸對側後肩/後頸 (如紅裙撫肩背身姿勢)
            const isRightHandNearLeftNeck = rightWrist && leftShoulder && Math.hypot((rightWrist.x - leftShoulder.x) * ar, rightWrist.y - leftShoulder.y) < 0.22;
            const isLeftHandNearRightNeck = leftWrist && rightShoulder && Math.hypot((leftWrist.x - rightShoulder.x) * ar, leftWrist.y - rightShoulder.y) < 0.22;

            // 背身綜合特徵評分
            let backScore = 0;
            if (isEarInverted) backScore += 4.5;
            if (isShoulderInverted) backScore += 4.0;
            if (isHipInverted) backScore += 3.0;
            if (avgFaceVis < 0.28) backScore += 3.5;
            else if (avgFaceVis < 0.45) backScore += 1.5;

            if (heelInFrontCount >= 1) backScore += (heelInFrontCount * 2.5);

            // 側顏特徵 (isFaceProfile 或單耳或 noseExtruding 或 |headYaw| > 0.45) 配合寬軀幹 (normShoulderSpan > 0.38)
            if (!hasClearFrontFace && (isFaceProfile || hasSingleEar || isNoseExtruding || Math.abs(headYaw) > 0.45)) {
                if (normShoulderSpan > 0.38) {
                    backScore += 2.0;
                }
            }

            if ((isRightHandNearLeftNeck || isLeftHandNearRightNeck) && !hasClearFrontFace) {
                backScore += 2.5;
            }

            if (hasClearFrontFace) backScore -= 6.0;

            // 是否為純背身或背身回眸 (Back Stance Active)
            isBackStance = (backScore >= 3.5) && !hasClearFrontFace;
            isOverShoulderLook = isBackStance && (avgFaceVis > 0.30 || eyeDx > 0.02 || hasSingleEar || Math.abs(headYaw) > 0.40);
        }

        // 側身狀態機觸發條件 (Profile Stance Active)
        const isProfileStance = !isBackStance && (isTorsoUltraNarrow || (isTorsoNarrow && isFaceProfile));

        // B. 正面姿態特徵判定 (Frontal Stance Protection)
        const isFaceFrontal = Math.abs(headYaw) < 0.35;
        const isShouldersFrontal = normShoulderSpan > 0.46;
        const isHipsFrontal = normHipSpan > 0.20;
        const isOverallFrontal = !isBackStance && !isProfileStance && isFaceFrontal && isShouldersFrontal && isHipsFrontal;

        let pelvisYaw = 0;
        let thoracicYaw = 0;
        let thoracicPitch = 0;
        let pelvisPitch = 0;
        let lumbarPitch = 0;
        let thoracicRoll = 0;
        let pelvisRoll = 0;
        let lumbarRoll = 0;
        let lumbarYaw = 0;
        let profileSign = 0;

        let rawDz = (leftShoulder.z || 0) - (rightShoulder.z || 0);
        const hipDz = (leftHip.z || 0) - (rightHip.z || 0);

        if (isBackStance) {
            // ---------------------------------------------------------
            // 1. 背身狀態機啟動 (Back Stance Mode Active: ~180°)
            // ---------------------------------------------------------
            // 後背基礎朝向 Yaw = Math.PI (180°)
            // 結合雙肩在 2D 畫面的微傾斜與深度推估微幅後背扭轉 (Yaw 微調 ±25°)
            const shoulderTwist = Math.atan2(rawDz * 0.5, Math.max(0.04, Math.abs(shoulderDx)));
            const backBaseYaw = Math.PI;

            pelvisYaw = backBaseYaw + this._clamp(shoulderTwist * 0.4, -0.45, 0.45);
            thoracicYaw = backBaseYaw + this._clamp(shoulderTwist * 0.8, -0.55, 0.55);

            thoracicRoll = Math.atan2(shoulderDy, Math.abs(shoulderDx) + 0.001);
            pelvisRoll = Math.atan2(hipDy, Math.abs(hipDx) + 0.001);
            lumbarRoll = (thoracicRoll - pelvisRoll) * 0.40;
            lumbarYaw = (thoracicYaw - pelvisYaw) * 0.40;

            const midShoulderZ = ((leftShoulder.z || 0) + (rightShoulder.z || 0)) * 0.5;
            const midHipZ = ((leftHip.z || 0) + (rightHip.z || 0)) * 0.5;
            const spineDz = midShoulderZ - midHipZ;
            thoracicPitch = -Math.atan2(spineDz * 0.6, Math.max(0.05, Math.abs(spineDy)));
            thoracicPitch = this._clamp(thoracicPitch, -0.35, 0.35);
            pelvisPitch = thoracicPitch * 0.35;
            lumbarPitch = thoracicPitch * 0.35;

            // 頭部朝向解算
            if (isOverShoulderLook) {
                // 背身回眸模式：雙眼或單眼側顏可見
                // 判斷回眸朝向：看畫面左側或右側 (以 midEyeX 或 nose.x 與雙肩中心比較)
                const faceCenterX = (midEyeX || (nose ? nose.x : midShoulder.x));
                const lookOverRightSide = faceCenterX > midShoulder.x;
                // 注意：背身 Yaw = 180° 下，局部座標系與相機 X 軸反向，轉向畫面右側 (lookOverRightSide) 需為負轉向角！
                const turnSign = lookOverRightSide ? -1.0 : 1.0;
                headYaw = thoracicYaw + turnSign * 1.25;

                // 回眸平視/微收下巴姿態 (-0.02 ~ 0.08 rad)，消除五官側向投影失真造成的假性仰天
                const safeMidEyeY = midEyeY;
                const eyeNoseDy = (nose && (leftEye || rightEye)) ? (nose.y - safeMidEyeY) : 0.045;
                const lookPitchOffset = THREE.MathUtils.clamp(eyeNoseDy - 0.045, -0.06, 0.12);
                headPitch = lookPitchOffset * 1.0 + 0.03; // 優雅微低頭平視
            } else {
                // 純背身：頭骨跟隨胸廓轉向 180° 後背
                headYaw = thoracicYaw;
            }
        } else if (isProfileStance) {
            // ---------------------------------------------------------
            // 側身狀態機啟動 (Profile Stance Mode Active: 75° ~ 90°)
            // ---------------------------------------------------------
            // 1. 決定人物面朝方向：面朝左 (profileSign = -1) 或 面朝右 (profileSign = +1)
            let leftScore = 0;
            let rightScore = 0;
            if (noseOffset < -0.008) leftScore += 2.0;
            if (noseOffset > 0.008) rightScore += 2.0;
            if (rightEarVis > leftEarVis + 0.10) leftScore += 2.5; // 右耳面向鏡頭 -> 人物面朝左
            if (leftEarVis > rightEarVis + 0.10) rightScore += 2.5; // 左耳面向鏡頭 -> 人物面朝右
            if (headYaw < -0.20) leftScore += 1.5;
            if (headYaw > 0.20) rightScore += 1.5;
            if (rawDz > 0.02) leftScore += 1.0;
            if (rawDz < -0.02) rightScore += 1.0;

            profileSign = (leftScore >= rightScore) ? -1 : 1;

            // 2. 依雙肩展開度賦予解剖側身/斜側身轉向角 (70° ~ 83°)，兼顧立體透視與穩定度
            const profileYawMag = (normShoulderSpan > 0.22) ? 1.25 : 1.44;
            const profileTargetYaw = profileSign * profileYawMag;
            pelvisYaw = profileTargetYaw;
            thoracicYaw = profileTargetYaw;

            // 側身回眸與頭身解耦機制 (Head-Torso Decoupling for Profile View)
            // 檢查五官特徵：若雙眼均被清晰檢測且橫向展開 (如側身看鏡頭回眸)，保留真實相機平面 2D headYaw！
            // 僅在面部五官亦處於純側面剪影 (eyeDx < 0.025 或單耳顯著可見) 時，才將頭部朝向與軀幹同步
            const hasVisibleEyes = leftEye && rightEye && (leftEye.visibility ?? 1.0) > 0.35 && (rightEye.visibility ?? 1.0) > 0.35;
            if (hasVisibleEyes && eyeDx > 0.025) {
                // 側身回眸姿態：雙眼清晰可見，保留 2D 五官解算的 headYaw (面向相機)
            } else if (normEyeSpan < 0.18 || hasSingleEar) {
                // 純側面五官：頭骨朝向與軀幹同向
                headYaw = profileTargetYaw;
            }

            // 3. 側身矢狀面俯仰解算 (Profile Sagittal Pitch Mapping)
            // 2D 畫面上的水平脊椎軸位移 (midShoulder.x - midHip.x) 直接對應身體矢狀面的前後傾倒！
            const profileLean2D = (midShoulder.x - midHip.x) * ar;
            // 在 YXZ 歐拉旋轉階層下：
            // profileSign = -1 (面朝左): 往右 (profileLean2D > 0) 代表後仰 (pitch < 0)
            // profileSign = +1 (面朝右): 往左 (profileLean2D < 0) 代表後仰 (pitch < 0)
            const sagittalLean = profileSign * profileLean2D;
            thoracicPitch = THREE.MathUtils.clamp(Math.atan2(sagittalLean, Math.max(0.1, Math.abs(spineDy))) * 0.95, -0.65, 0.65);
            pelvisPitch = thoracicPitch * 0.40;
            lumbarPitch = thoracicPitch * 0.35;

            // 4. 側身模式側傾防護 (避免因一肩略高產生假性高低肩扭曲)
            thoracicRoll = THREE.MathUtils.clamp(-Math.atan2(shoulderDy, Math.abs(shoulderDx) + 0.001) * 0.2, -0.08, 0.08);
            pelvisRoll = THREE.MathUtils.clamp(-Math.atan2(hipDy, Math.abs(hipDx) + 0.001) * 0.2, -0.08, 0.08);
            lumbarRoll = 0.0;
            lumbarYaw = 0.0;
        } else {
            // ---------------------------------------------------------
            // 正面與斜正面解算模式 (Frontal & Three-Quarter Mode)
            // ---------------------------------------------------------
            const hipDzMag = Math.abs(hipDz);
            const deadzoneThreshold = isOverallFrontal ? 0.08 : 0.055;
            let effHipDz = 0.0;
            if (hipDzMag > deadzoneThreshold) {
                effHipDz = Math.sign(hipDz) * (hipDzMag - deadzoneThreshold);
            }

            if (isOverallFrontal) {
                effHipDz = THREE.MathUtils.clamp(effHipDz, -0.04, 0.04);
            }

            pelvisYaw = Math.atan2(effHipDz, Math.max(0.02, Math.abs(hipDx)));
            if (isOverallFrontal) {
                pelvisYaw = this._clamp(pelvisYaw, -0.22, 0.22);
            } else {
                pelvisYaw = this._clamp(pelvisYaw, -1.0, 1.0);
            }

            const isRightArmElevated = (rightWrist && rightWrist.y < rightShoulder.y - 0.05) ||
                                       (rightElbow && rightElbow.y < rightShoulder.y - 0.05);
            const isLeftArmElevated = (leftWrist && leftWrist.y < leftShoulder.y - 0.05) ||
                                      (leftElbow && leftElbow.y < leftShoulder.y - 0.05);
            const hasElevatedArm = isRightArmElevated || isLeftArmElevated;

            const spineBaselineYaw = headYaw * 0.65 + pelvisYaw * 0.35;

            if (isOverallFrontal) {
                const combinedDz = (rawDz * 0.40 + hipDz * 0.60);
                const clampedDz = THREE.MathUtils.clamp(combinedDz, -0.06, 0.06);
                let effDz = 0.0;
                if (Math.abs(clampedDz) > deadzoneThreshold) {
                    effDz = Math.sign(clampedDz) * (Math.abs(clampedDz) - deadzoneThreshold);
                }
                thoracicYaw = Math.atan2(effDz, Math.max(0.02, Math.abs(shoulderDx)));
                thoracicYaw = this._clamp(thoracicYaw, -0.20, 0.20);
            } else if (hasElevatedArm && Math.abs(headYaw) < 0.38 && Math.abs(pelvisYaw) < 0.38) {
                const dampenedDz = rawDz * 0.15 * 0.30 + effHipDz * 0.70;
                let effDz = 0.0;
                if (Math.abs(dampenedDz) > deadzoneThreshold) {
                    effDz = Math.sign(dampenedDz) * (Math.abs(dampenedDz) - deadzoneThreshold);
                }
                thoracicYaw = Math.atan2(effDz, Math.max(0.02, Math.abs(shoulderDx)));
                thoracicYaw = this._clamp(thoracicYaw, spineBaselineYaw - 0.14, spineBaselineYaw + 0.14);
            } else {
                const combinedDz = (rawDz * 0.65 + hipDz * 0.35);
                const dzMag = Math.abs(combinedDz);
                let effDz = 0.0;
                if (dzMag > deadzoneThreshold) {
                    effDz = Math.sign(combinedDz) * (dzMag - deadzoneThreshold);
                }
                thoracicYaw = Math.atan2(effDz, Math.max(0.02, Math.abs(shoulderDx)));

                const maxSpineTwist = 0.32; // 約 18°
                const minThoracicYaw = Math.max(pelvisYaw - maxSpineTwist, headYaw - maxSpineTwist);
                const maxThoracicYaw = Math.min(pelvisYaw + maxSpineTwist, headYaw + maxSpineTwist);

                if (minThoracicYaw <= maxThoracicYaw) {
                    thoracicYaw = this._clamp(thoracicYaw, minThoracicYaw, maxThoracicYaw);
                } else {
                    const midYaw = (pelvisYaw + headYaw) * 0.5;
                    thoracicYaw = this._clamp(thoracicYaw, midYaw - 0.28, midYaw + 0.28);
                }
            }

            thoracicRoll = -Math.atan2(shoulderDy, Math.abs(shoulderDx) + 0.001);
            pelvisRoll = -Math.atan2(hipDy, Math.abs(hipDx) + 0.001);

            lumbarRoll = (thoracicRoll - pelvisRoll) * 0.45 - (spineDx * 0.4);
            lumbarYaw = (thoracicYaw - pelvisYaw) * 0.30;
            lumbarYaw = this._clamp(lumbarYaw, -0.12, 0.12);
            lumbarRoll = this._clamp(lumbarRoll, -0.32, 0.32);

            const midShoulderZ = ((leftShoulder.z || 0) + (rightShoulder.z || 0)) * 0.5;
            const midHipZ = ((leftHip.z || 0) + (rightHip.z || 0)) * 0.5;
            const spineDz = midShoulderZ - midHipZ;
            thoracicPitch = Math.atan2(spineDz * 0.6, Math.max(0.05, Math.abs(spineDy)));
            thoracicPitch = this._clamp(thoracicPitch, -0.35, 0.35);
            pelvisPitch = thoracicPitch * 0.35;
            lumbarPitch = thoracicPitch * 0.35;
        }

        // 10. MediaPipe Holistic 雙手 21 骨節特徵提取與預處理
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

        // 10b. 信心分層評估與「胸腔—骨盆」相對轉角雙向約束 (Confidence Evaluation & Thoraco-Pelvic Coupling)
        const confidences = ConfidenceEvaluator.evaluate(landmarks, matchedLeftHand, matchedRightHand, {
            isProfileStance,
            isBackStance
        });
        this.lastConfidences = confidences;

        const coupledTorso = ThoracoPelvicCoupler.couple({
            thoracicPitch, thoracicYaw, thoracicRoll,
            pelvisPitch, pelvisYaw, pelvisRoll
        }, confidences, spineDx);

        thoracicPitch = coupledTorso.thoracicPitch;
        thoracicYaw = coupledTorso.thoracicYaw;
        thoracicRoll = coupledTorso.thoracicRoll;
        pelvisPitch = coupledTorso.pelvisPitch;
        pelvisYaw = coupledTorso.pelvisYaw;
        pelvisRoll = coupledTorso.pelvisRoll;
        lumbarPitch = coupledTorso.lumbarPitch;
        lumbarYaw = coupledTorso.lumbarYaw;
        lumbarRoll = coupledTorso.lumbarRoll;

        // 11. 頸椎與寰枕關節仰俯協同分配 (Biomechanical Head/Neck Coupling)
        // 人體生理生物力學：頭部相對於胸廓之仰俯角，由頸椎 (60%) 與寰枕關節 (40%) 協同承擔
        // 生理活動度極限約束 (ROM Guardrail)：仰頭極限 -0.45 rad (~-26°)，低頭極限 +0.65 rad (~+37°)
        const safeRelativePitch = THREE.MathUtils.clamp(headPitch - thoracicPitch, -0.45, 0.65);
        let cervicalPitch = safeRelativePitch * 0.60;
        let cranialPitch = safeRelativePitch * 0.40;

        // 頸椎軸向旋轉 (Cervical Axial Rotation)：
        // 頸椎生理極限約 ±77° (±1.35 rad)，其中 65% 由 7 節頸椎承擔，35% 由寰枕/寰樞關節承擔
        let diffNeckYaw = headYaw - thoracicYaw;
        while (diffNeckYaw > Math.PI) diffNeckYaw -= 2 * Math.PI;
        while (diffNeckYaw < -Math.PI) diffNeckYaw += 2 * Math.PI;
        const safeRelativeYaw = THREE.MathUtils.clamp(diffNeckYaw, -1.35, 1.35);
        let cervicalYaw = safeRelativeYaw * 0.65;

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

        let activeLeftWrist = sanitizeWristOcclusion(leftShoulder, leftElbow, leftWrist, leftHip, matchedLeftHand, 'left');
        let activeRightWrist = sanitizeWristOcclusion(rightShoulder, rightElbow, rightWrist, rightHip, matchedRightHand, 'right');

        // 側身遮擋手臂防畸變與雙臂支撐鏡像 (Profile Occluded Arm Sanity & Support Alignment):
        // 嚴格限定：僅在「近側手臂處於地面支撐姿態 (如跪地雙手後撐，wrist 在 hip 下方)」
        // 且「遠側手臂沒有檢測到手掌 21 節點、未在摸頭/摸頸、且手腕缺失或異常」時，才進行向下支撐鏡像！
        if (isProfileStance && profileSign !== 0) {
            const nearWrist = (profileSign === 1) ? activeRightWrist : activeLeftWrist;
            const nearElbow = (profileSign === 1) ? rightElbow : leftElbow;
            const nearHip = (profileSign === 1) ? rightHip : leftHip;
            const farWrist = (profileSign === 1) ? activeLeftWrist : activeRightWrist;
            const farElbow = (profileSign === 1) ? leftElbow : rightElbow;
            const farHand = (profileSign === 1) ? matchedLeftHand : matchedRightHand;

            const nearIsGroundSupport = nearWrist && nearElbow && nearHip && (nearWrist.y > nearElbow.y + 0.08) && (nearWrist.y > nearHip.y - 0.05);
            const farHasHand = farHand && farHand.length >= 21;
            const farIsUpperPose = farWrist && (farWrist.y < midShoulder.y + 0.15 * torsoHeight);

            if (nearIsGroundSupport && farElbow && !farHasHand && !farIsUpperPose) {
                const farIsErratic = !farWrist || (farWrist.y < farElbow.y + 0.04);
                if (farIsErratic) {
                    const correctedFarWrist = {
                        x: farElbow.x + (nearWrist.x - nearElbow.x),
                        y: farElbow.y + Math.abs(nearWrist.y - nearElbow.y),
                        z: farElbow.z || 0,
                        visibility: 0.5
                    };
                    if (profileSign === 1) {
                        activeLeftWrist = correctedFarWrist;
                    } else {
                        activeRightWrist = correctedFarWrist;
                    }
                }
            }
        }

        // 判定手部姿態類型 (摸頭撫面手 / 插腰手 / 前置手 / 體側垂手)
        const checkTouchingHead = (s, e, w, handLandmarks, side) => {
            if (!s || !e || !w || !nose) return false;

            // 1. 手肘必須顯著屈曲 (伸直的手臂絕不可能摸頭，徹底排除指天、跳舞、招手)
            const armDx = (e.x - s.x) * ar;
            const armDy = e.y - s.y;
            const foreDx = (w.x - e.x) * ar;
            const foreDy = w.y - e.y;
            const dot = armDx * foreDx + armDy * foreDy;
            const lA = Math.hypot(armDx, armDy);
            const lF = Math.hypot(foreDx, foreDy);
            const flex2D = Math.acos(Math.max(-1, Math.min(1, dot / (lA * lF + 1e-5))));
            if (flex2D < 0.85) return false; // 屈曲小於 ~49° 直接排除

            // 2. 特殊外展手勢排除 (如指天 point、比耶 peace、比讚 thumbsUp)
            if (handLandmarks && handLandmarks.length >= 21) {
                const g = this._classifyHandGesture(handLandmarks);
                if (g === 'point' || g === 'peace' || g === 'thumbsUp') {
                    return false;
                }
            }

            // 3. 垂直高度檢測：手腕必須在頭顱與頸部範圍內 (支援摸額、摸耳、撫面、托腮、摸頸圈/喉結)
            const hSpan = headSpan2D > 0.02 ? headSpan2D : torsoHeight * 0.48;
            const topY = midEyeY - hSpan * 0.48;
            const btmY = Math.max(nose.y + hSpan * 0.42, s.y + 0.08 * torsoHeight);

            const testPt = (handLandmarks && handLandmarks.length >= 21) ? handLandmarks[0] : w;
            if (testPt.y < (topY - 0.05 * torsoHeight)) return false; // 空中高舉手
            if (testPt.y > (btmY + 0.16 * torsoHeight)) return false; // 低於頸下胸腹手

            // 4. 頭顱外輪廓鄰域檢測
            const headCenterY = (midEyeY + nose.y) * 0.5;
            const headRadX = Math.max(0.06, hSpan * 0.42);
            const headRadY = Math.max(0.08, hSpan * 0.58);

            // 若手腕/手掌位於下巴/頸圈處 (testPt.y > nose.y + 0.04) 且手肘下垂 (e.y > s.y + 0.03)，
            // 屬於自然下垂摸頸/持花/整理衣領動作，回歸精確 2D 向量投影解算，避免誤觸摸頭兩段式 IK
            if (testPt.y > (nose.y + 0.04) && e.y > (s.y + 0.03)) {
                return false;
            }

            const normWx = Math.abs(testPt.x - nose.x) * ar / headRadX;
            const normWy = Math.abs(testPt.y - headCenterY) / headRadY;
            const distWristSq = normWx * normWx + normWy * normWy;

            // 檢查食指與中指尖
            let minTipDistSq = 999;
            if (handLandmarks && handLandmarks.length >= 21) {
                const tip8 = handLandmarks[8];
                const tip12 = handLandmarks[12];
                if (tip8) {
                    const tx = Math.abs(tip8.x - nose.x) * ar / headRadX;
                    const ty = Math.abs(tip8.y - headCenterY) / headRadY;
                    minTipDistSq = Math.min(minTipDistSq, tx * tx + ty * ty);
                }
                if (tip12) {
                    const tx = Math.abs(tip12.x - nose.x) * ar / headRadX;
                    const ty = Math.abs(tip12.y - headCenterY) / headRadY;
                    minTipDistSq = Math.min(minTipDistSq, tx * tx + ty * ty);
                }
            }

            const bestDistSq = Math.min(distWristSq, minTipDistSq);
            return (bestDistSq <= 2.8);
        };

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

        const isLeftTouchingHead = checkTouchingHead(leftShoulder, leftElbow, activeLeftWrist, matchedLeftHand, 'left');
        const isRightTouchingHead = checkTouchingHead(rightShoulder, rightElbow, activeRightWrist, matchedRightHand, 'right');

        // 判定是否為過頂拱手 / 芭蕾五位手閉環姿態 (Overhead Clasped / Arched Arms IK)
        const checkOverheadClasped = () => {
            if (!activeLeftWrist || !activeRightWrist || !leftShoulder || !rightShoulder) return false;
            const refHeadY = headTopY || (leftEye && rightEye ? (leftEye.y + rightEye.y) * 0.5 - 0.08 : leftShoulder.y - 0.15);
            // 雙手手腕均在頭頂高度或附近
            const bothWristsHigh = (activeLeftWrist.y < refHeadY + 0.06) && (activeRightWrist.y < refHeadY + 0.06);
            // 雙腕水平間距在頭頂上方接近
            const wristDx = Math.abs(activeLeftWrist.x - activeRightWrist.x) * ar;
            const isWristClose = wristDx < 0.22;
            return bothWristsHigh && isWristClose;
        };

        const isOverheadClasped = checkOverheadClasped();
        const overheadClaspedInfo = isOverheadClasped ? {
            isClasped: true,
            midWristX: (activeLeftWrist.x + activeRightWrist.x) * 0.5,
            topWristY: Math.min(activeLeftWrist.y, activeRightWrist.y),
            headTopY: headTopY
        } : null;

        const isLeftHandOnHip = !isLeftTouchingHead && !isOverheadClasped && checkHandOnHip(leftShoulder, leftElbow, activeLeftWrist, 'left');
        const isRightHandOnHip = !isRightTouchingHead && !isOverheadClasped && checkHandOnHip(rightShoulder, rightElbow, activeRightWrist, 'right');

        const isLeftFrontOfPelvis = !isLeftHandOnHip && !isLeftTouchingHead && !isOverheadClasped && checkFrontOfPelvis(activeLeftWrist);
        const isRightFrontOfPelvis = !isRightHandOnHip && !isRightTouchingHead && !isOverheadClasped && checkFrontOfPelvis(activeRightWrist);

        const headTargetInfo = (nose && leftEye && rightEye) ? {
            nose: nose,
            midEyeY: (leftEye.y + rightEye.y) * 0.5
        } : null;

        // -------------------------------------------------------------
        // 11. 肢體節點拓撲對調映射 (Left-Right Limb Topology Alignment for Back Stance)
        // -------------------------------------------------------------
        let limbLeftShoulder = leftShoulder;
        let limbRightShoulder = rightShoulder;
        let limbLeftElbow = leftElbow;
        let limbRightElbow = rightElbow;
        let limbLeftWrist = activeLeftWrist;
        let limbRightWrist = activeRightWrist;
        let limbLeftHip = leftHip;
        let limbRightHip = rightHip;
        let limbLeftKnee = leftKnee;
        let limbRightKnee = rightKnee;
        let limbLeftAnkle = leftAnkle;
        let limbRightAnkle = rightAnkle;
        let limbLeftHeel = leftHeel;
        let limbRightHeel = rightHeel;
        let limbLeftFootIndex = leftFootIndex;
        let limbRightFootIndex = rightFootIndex;
        let limbLeftThumb = leftThumb;
        let limbRightThumb = rightThumb;
        let limbLeftPinky = leftPinky;
        let limbRightPinky = rightPinky;
        let limbLeftHand = matchedLeftHand;
        let limbRightHand = matchedRightHand;

        // 當人物背對鏡頭，若 MediaPipe 未對調左右標籤 (leftShoulder.x > rightShoulder.x)，
        // 畫面右側實為人物的右肢、畫面左側為左肢，必須將雙側特徵點完全對調！
        if (isBackStance && !isShoulderInverted) {
            limbLeftShoulder = rightShoulder;
            limbRightShoulder = leftShoulder;
            limbLeftElbow = rightElbow;
            limbRightElbow = leftElbow;
            limbLeftWrist = activeRightWrist;
            limbRightWrist = activeLeftWrist;
            limbLeftHip = rightHip;
            limbRightHip = leftHip;
            limbLeftKnee = rightKnee;
            limbRightKnee = leftKnee;
            limbLeftAnkle = rightAnkle;
            limbRightAnkle = leftAnkle;
            limbLeftHeel = rightHeel;
            limbRightHeel = leftHeel;
            limbLeftFootIndex = rightFootIndex;
            limbRightFootIndex = leftFootIndex;
            limbLeftThumb = rightThumb;
            limbRightThumb = leftThumb;
            limbLeftPinky = rightPinky;
            limbRightPinky = leftPinky;
            limbLeftHand = matchedRightHand;
            limbRightHand = matchedLeftHand;
        }

        // 12. 左右大臂與前臂解算 (含摸頭/撫面、過頂芭蕾拱手閉環、側身狀態機支持、背身狀態機支持、肌肉包絡面避障與真實相機投影)
        const leftArmPose = this._solveArmKinematics(
            limbLeftShoulder, limbLeftElbow, limbLeftWrist, 'left',
            thoracicPitch, thoracicYaw, thoracicRoll, torsoHeight,
            limbLeftThumb, limbLeftPinky,
            limbLeftHip, limbRightHip, isLeftFrontOfPelvis, isLeftHandOnHip,
            isLeftTouchingHead, headTargetInfo, limbLeftHand,
            overheadClaspedInfo, isProfileStance, profileSign, isBackStance
        );

        const rightArmPose = this._solveArmKinematics(
            limbRightShoulder, limbRightElbow, limbRightWrist, 'right',
            thoracicPitch, thoracicYaw, thoracicRoll, torsoHeight,
            limbRightThumb, limbRightPinky,
            limbLeftHip, limbRightHip, isRightFrontOfPelvis, isRightHandOnHip,
            isRightTouchingHead, headTargetInfo, limbRightHand,
            overheadClaspedInfo, isProfileStance, profileSign, isBackStance
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

        // 13. 手掌前後旋 (Twist) 與 21 骨節連續指骨姿態解算
        let leftHandAngles = null;
        let rightHandAngles = null;
        let leftHandDetectedPreset = 'relaxed';
        let rightHandDetectedPreset = 'relaxed';

        if (matchedLeftHand) {
            const handSol = this._solveTwistAndGestureFromHand(matchedLeftHand, 'left', isLeftFrontOfPelvis, isLeftHandOnHip, isLeftTouchingHead);
            leftForearmTwist = handSol.twist;
            leftHandDetectedPreset = handSol.gesture;
            leftHandGesture = 'auto';
            leftHandAngles = handSol.fingerAngles;
        } else if (leftWrist && leftShoulder && leftElbow) {
            if (isLeftTouchingHead) {
                leftHandGesture = 'open';
                leftHandDetectedPreset = 'open';
            } else if (isOverheadClasped) {
                leftHandGesture = 'open';
                leftHandDetectedPreset = 'open';
            } else if (leftWrist.y < leftShoulder.y + 0.15 && leftElbow.y > leftWrist.y) {
                leftHandGesture = 'peace';
                leftHandDetectedPreset = 'peace';
            }
        }

        if (matchedRightHand) {
            const handSol = this._solveTwistAndGestureFromHand(matchedRightHand, 'right', isRightFrontOfPelvis, isRightHandOnHip, isRightTouchingHead);
            rightForearmTwist = handSol.twist;
            rightHandDetectedPreset = handSol.gesture;
            rightHandGesture = 'auto';
            rightHandAngles = handSol.fingerAngles;
        } else if (rightWrist && rightShoulder && rightElbow) {
            if (isRightTouchingHead) {
                rightHandGesture = 'open';
                rightHandDetectedPreset = 'open';
            } else if (isOverheadClasped) {
                rightHandGesture = 'open';
                rightHandDetectedPreset = 'open';
            } else if (rightWrist.y < rightShoulder.y + 0.15 && rightElbow.y > rightWrist.y) {
                rightHandGesture = 'peace';
                rightHandDetectedPreset = 'peace';
            }
        }

        // -------------------------------------------------------------
        // 14. 下肢截斷裁切照片安全防護 (Lower Limb Truncation Guard)
        // -------------------------------------------------------------
        // 當照片為半身照或裁切至大腿 (膝/踝出鏡或被模型擠壓在畫布邊緣，如經典長裙半身照) 時，
        // 鎖定下肢為自然筆直站立姿態，徹底防止假性屈曲與誤觸地面跪姿吸附！

        // 收集所有下肢與足部節點在畫面 2D 空間中的最低點
        const footYList = [
            leftAnkle ? leftAnkle.y : null,
            rightAnkle ? rightAnkle.y : null,
            leftHeel ? leftHeel.y : null,
            rightHeel ? rightHeel.y : null,
            leftFootIndex ? leftFootIndex.y : null,
            rightFootIndex ? rightFootIndex.y : null,
            leftKnee ? leftKnee.y : null,
            rightKnee ? rightKnee.y : null
        ].filter(v => v !== null && !isNaN(v));

        const lowestFootY = footYList.length > 0 ? Math.max(...footYList) : 0;
        const totalLowerSpan = (midHip && lowestFootY > 0) ? (lowestFootY - midHip.y) : 0;

        const lLegSpan = (leftHip && leftAnkle) ? (leftAnkle.y - leftHip.y) : (leftHip && leftKnee ? (leftKnee.y - leftHip.y) : 0);
        const rLegSpan = (rightHip && rightAnkle) ? (rightAnkle.y - rightHip.y) : (rightHip && rightKnee ? (rightKnee.y - rightHip.y) : 0);
        const maxLegSpan = Math.max(lLegSpan, rLegSpan, totalLowerSpan);

        const lFemurDy = (leftHip && leftKnee) ? (leftKnee.y - leftHip.y) : 0;
        const lFemurDx = (leftHip && leftKnee) ? Math.abs((leftKnee.x - leftHip.x) * ar) : 0;
        const rFemurDy = (rightHip && rightKnee) ? (rightKnee.y - rightHip.y) : 0;
        const rFemurDx = (rightHip && rightKnee) ? Math.abs((rightKnee.x - rightHip.x) * ar) : 0;

        // 股骨長度異常坍縮：MediaPipe 在長裙/半身照常因未見雙足，將膝蓋與髖骨擠在同一高度 (ΔY < 0.12 * torsoHeight)
        const isFemurCollapsed = (lFemurDy < 0.12 * torsoHeight) || (rFemurDy < 0.12 * torsoHeight);

        const isLeftFemurVertical = lFemurDy > 0.08 * torsoHeight && lFemurDx < 0.65 * lFemurDy;
        const isRightFemurVertical = rFemurDy > 0.08 * torsoHeight && rFemurDx < 0.65 * rFemurDy;
        const isAnyFemurVertical = isLeftFemurVertical || isRightFemurVertical;

        const lShinDy = (leftKnee && leftAnkle) ? (leftAnkle.y - leftKnee.y) : 0;
        const rShinDy = (rightKnee && rightAnkle) ? (rightAnkle.y - rightKnee.y) : 0;
        const isLeftShinTruncated = lFemurDy > 0.08 && lShinDy < 0.60 * lFemurDy;
        const isRightShinTruncated = rFemurDy > 0.08 && rShinDy < 0.60 * rFemurDy;
        const isShinTruncated = isLeftShinTruncated || isRightShinTruncated;

        // 小腿水平展開判定 (真人地面跪姿特徵，如芭蕾/體操動作)
        const isShinHorizontal = (leftAnkle && leftKnee && Math.abs((leftAnkle.x - leftKnee.x) * ar) > 0.10) ||
                                 (rightAnkle && rightKnee && Math.abs((rightAnkle.x - rightKnee.x) * ar) > 0.10);

        const isSpineUpright = Math.abs(spineDy) > 0.65 * torsoHeight && Math.abs(spineDx) < 0.60 * torsoHeight;

        // 下肢總跨度判定：正常人體站姿骨盆至腳底必然 ≥ 1.45 ~ 1.85 倍軀幹高度
        // 凡是小於 1.25 倍軀幹高度者，生理上絕無可能是完整站姿全身照！
        const isLowerSpanSeverelyTruncated = totalLowerSpan > 0 && totalLowerSpan < 1.15 * torsoHeight;
        const isLowerSpanTruncated = totalLowerSpan > 0 && totalLowerSpan < 1.35 * torsoHeight;

        const isFootNearBottom = lowestFootY > 0.72;
        const isHipNearBottom = (midHip && midHip.y > 0.62);

        // 綜合判定
        const isLegsTruncated = !isProfileStance && !isShinHorizontal && (
            // A. 股骨坍縮 (MediaPipe 把膝蓋標在髖骨高度) 且身軀直立
            (isSpineUpright && isFemurCollapsed && (isFootNearBottom || isLowerSpanTruncated)) ||
            // B. 骨盆至最低足點垂直落差 < 1.15 倍軀幹 (物理上必然是裁切照)
            (isSpineUpright && isLowerSpanSeverelyTruncated) ||
            // C. 骨盆至最低足點落差 < 1.35 倍軀幹 且 足部/骨盆靠近畫面下半部
            (isSpineUpright && isLowerSpanTruncated && (isFootNearBottom || isHipNearBottom)) ||
            // D. 直立軀幹 + 大腿垂直但小腿嚴重截斷
            (isSpineUpright && isAnyFemurVertical && isShinTruncated) ||
            // E. 骨盆直接被裁切在畫面下半部 (胸像/大頭照/腰部裁切)
            (midHip && midHip.y > 0.70)
        );

        // 15. 左右下肢解算 (股骨、大轉子、膝關節屈曲、脛骨、腓骨與足踝，支援側身矢狀投影與背身狀態機)
        const leftLegPose = this._solveLegKinematics(
            limbLeftHip, limbLeftKnee, limbLeftAnkle, limbLeftFootIndex, limbLeftHeel, 'left',
            pelvisPitch, pelvisYaw, pelvisRoll, torsoHeight, isProfileStance, profileSign, isBackStance
        );

        const rightLegPose = this._solveLegKinematics(
            limbRightHip, limbRightKnee, limbRightAnkle, limbRightFootIndex, limbRightHeel, 'right',
            pelvisPitch, pelvisYaw, pelvisRoll, torsoHeight, isProfileStance, profileSign, isBackStance
        );

        let leftHipPitch = isLegsTruncated ? 0.0 : leftLegPose.pitch;
        let leftHipRoll = isLegsTruncated ? 0.04 : leftLegPose.roll;
        let leftHipYaw = isLegsTruncated ? 0.0 : leftLegPose.yaw;
        let leftKneeFlex = isLegsTruncated ? 0.03 : leftLegPose.kneeFlex;
        let leftAnklePitch = isLegsTruncated ? 0.0 : leftLegPose.anklePitch;
        let leftAnkleYaw = isLegsTruncated ? 0.06 : leftLegPose.ankleYaw;
        let leftAnkleRoll = isLegsTruncated ? 0.0 : leftLegPose.ankleRoll;

        let rightHipPitch = isLegsTruncated ? 0.0 : rightLegPose.pitch;
        let rightHipRoll = isLegsTruncated ? -0.04 : rightLegPose.roll;
        let rightHipYaw = isLegsTruncated ? 0.0 : rightLegPose.yaw;
        let rightKneeFlex = isLegsTruncated ? 0.03 : rightLegPose.kneeFlex;
        let rightAnklePitch = isLegsTruncated ? 0.0 : rightLegPose.anklePitch;
        let rightAnkleYaw = isLegsTruncated ? -0.06 : rightLegPose.ankleYaw;
        let rightAnkleRoll = isLegsTruncated ? 0.0 : rightLegPose.ankleRoll;

        // 鏡像反轉
        if (this.isMirrored) {
            thoracicRoll = -thoracicRoll;
            pelvisRoll = -pelvisRoll;
            lumbarRoll = -lumbarRoll;
            thoracicYaw = -thoracicYaw;
            pelvisYaw = -pelvisYaw;
            lumbarYaw = -lumbarYaw;
            cervicalYaw = -cervicalYaw;
            headYaw = -headYaw;
            headRoll = -headRoll;
            
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

            const tempAngles = leftHandAngles;
            leftHandAngles = rightHandAngles;
            rightHandAngles = tempAngles;

            const tempPreset = leftHandDetectedPreset;
            leftHandDetectedPreset = rightHandDetectedPreset;
            rightHandDetectedPreset = tempPreset;

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

        // -------------------------------------------------------------
        // 12. 人體真實 2D 頭身比動態估算 (Dynamic Head-to-Body Ratio)
        // -------------------------------------------------------------
        let headToBodyRatio = 7.3; // 預設亞洲大眾寫實體型
        if (leftEye && rightEye && nose) {
            if (isLegsTruncated) {
                // 下肢裁切半身照防護：不可使用被截斷之假腳踝計算身軀全高！
                // 改以人體黃金比例由軀幹高度 (torsoHeight) 與頭部長度 (headSpan2D) 推估真實生理頭身比
                if (headSpan2D > 0.02 && torsoHeight > 0.05) {
                    const estimatedTotalBodySpan = torsoHeight * 3.12;
                    const rawRatio = estimatedTotalBodySpan / headSpan2D;
                    headToBodyRatio = THREE.MathUtils.clamp(rawRatio, 7.1, 7.6);
                } else {
                    headToBodyRatio = 7.3;
                }
            } else {
                // 尋找雙腳在 2D 影像中的最低點 (Foot / Ankle / Heel / FootIndex)
                const footYValues = [
                    leftAnkle ? leftAnkle.y : null,
                    rightAnkle ? rightAnkle.y : null,
                    leftHeel ? leftHeel.y : null,
                    rightHeel ? rightHeel.y : null,
                    leftFootIndex ? leftFootIndex.y : null,
                    rightFootIndex ? rightFootIndex.y : null
                ].filter(v => v !== null && !isNaN(v));

                if (footYValues.length > 0 && midHip && headSpan2D > 0.02) {
                    const bottomY = Math.max(...footYValues);
                    if (bottomY > midHip.y + 0.15) {
                        const totalBodySpan2D = bottomY - headTopY;
                        const rawRatio = totalBodySpan2D / headSpan2D;
                        headToBodyRatio = THREE.MathUtils.clamp(rawRatio, 6.7, 8.4);
                    }
                }
            }
        }
        headToBodyRatio = parseFloat(headToBodyRatio.toFixed(1));
        const skullScale = parseFloat(((48.0 / headToBodyRatio) / 4.60).toFixed(2));

        // -------------------------------------------------------------
        // 13. 性別骨骼形態自適應判定 (Gender Skeletal Dimorphism)
        // -------------------------------------------------------------
        let suggestedGender = 'female';
        let genderConfidence = 0.5;
        let shoulderToHipRatio = 1.75;

        if (leftShoulder && rightShoulder && leftHip && rightHip) {
            const dxShoulders = Math.abs(rightShoulder.x - leftShoulder.x) * ar;
            const dyShoulders = Math.abs(rightShoulder.y - leftShoulder.y);
            const shoulderWidth2D = Math.hypot(dxShoulders, dyShoulders);

            const dxHips = Math.abs(rightHip.x - leftHip.x) * ar;
            const dyHips = Math.abs(rightHip.y - leftHip.y);
            const hipWidth2D = Math.hypot(dxHips, dyHips);

            shoulderToHipRatio = parseFloat((shoulderWidth2D / (hipWidth2D + 1e-5)).toFixed(2));

            // MediaPipe Pose 的 Landmark 23/24 為體內股骨頭關節中心 (Acetabulum)，
            // 其解剖距離本就遠窄於外部骨盆/側腰輪廓，故男女基準比值通常在 1.65 ~ 2.40 之間。
            // 判斷是否為跪姿或下肢折疊姿態 (Kneeling / Folded Legs Detection)
            const isKneelingOrFolded = (leftKneeFlex > 1.0 || rightKneeFlex > 1.0) ||
                (leftKnee && leftAnkle && Math.abs(leftAnkle.y - leftKnee.y) < 0.20 * torsoHeight);

            // 結合肩寬軀幹比 (Shoulder-to-Torso Ratio) 進行綜合形態打分：
            const shoulderToTorsoRatio = shoulderWidth2D / Math.max(0.1, torsoHeight);
            let maleScore = 0;

            if (isKneelingOrFolded) {
                // 跪姿/坐姿模式：下肢折疊嚴重扭曲骨盆 2D 投影，優先信賴「肩寬軀幹比 (女性常態 < 0.68, 男性常態 > 0.72)」
                maleScore = (shoulderToTorsoRatio - 0.71) * 3.5 + (shoulderToHipRatio - 2.15) * 0.8 - 0.45;
            } else {
                // 正常站姿模式：結合肩臀比與肩寬軀幹比
                maleScore = (shoulderToHipRatio - 1.88) * 2.2 + (shoulderToTorsoRatio - 0.71) * 2.0;

                // 寬鬆外套/西裝抗干擾補償 (Suit / Coat Compensation):
                // 成人男士身形高大 (頭身比 >= 7.6) 且肩線展開 (shoulderToTorsoRatio >= 0.72) 時，
                // 外套下擺撐大臀圍不扣分為女性
                if (headToBodyRatio >= 7.6 && shoulderToTorsoRatio >= 0.72) {
                    maleScore += 0.85;
                }
            }

            if (maleScore >= 0) {
                suggestedGender = 'male';
                genderConfidence = Math.min(0.95, 0.55 + Math.abs(maleScore) * 0.25);
            } else {
                suggestedGender = 'female';
                genderConfidence = Math.min(0.95, 0.55 + Math.abs(maleScore) * 0.25);
            }
        }

        return {
            suggestedGender,
            genderConfidence,
            shoulderToHipRatio,
            headToBodyRatio,
            skullScale,
            isProfileStance,
            profileSign,
            isBackStance: !!isBackStance,
            isOverShoulderLook: !!isOverShoulderLook,
            isOverheadClasped,
            isLegsTruncated: !!isLegsTruncated,
            pelvisRoll: this._clamp(pelvisRoll, -0.4, 0.4),
            pelvisPitch: this._clamp(pelvisPitch, -0.45, 0.45),
            pelvisYaw: isBackStance ? this._clamp(pelvisYaw, Math.PI - 0.75, Math.PI + 0.75) : this._clamp(pelvisYaw, -1.57, 1.57),
            thoracicPitch: this._clamp(thoracicPitch, -0.65, 0.65),
            thoracicYaw: isBackStance ? this._clamp(thoracicYaw, Math.PI - 0.75, Math.PI + 0.75) : this._clamp(thoracicYaw, -1.57, 1.57), // 支援純正側面 90° 與背身 180°
            thoracicRoll: this._clamp(thoracicRoll, -0.5, 0.5),
            lumbarPitch: this._clamp(lumbarPitch, -0.45, 0.45),
            lumbarRoll: this._clamp(lumbarRoll, -0.45, 0.45),
            lumbarYaw: this._clamp(lumbarYaw, -0.5, 0.5),
            cervicalPitch: this._clamp(cervicalPitch, -0.55, 0.55),
            cervicalYaw: this._clamp(cervicalYaw, -1.2, 1.2),
            headPitch: this._clamp(cranialPitch, -0.45, 0.45),
            headYaw: isBackStance ? this._clamp(headYaw, -Math.PI, Math.PI) : this._clamp(headYaw, -1.57, 1.57),
            headRoll: this._clamp(headRoll, -0.6, 0.6),
            leftArmPitch: this._clamp(leftArmPitch, -2.2, 2.2),
            leftArmRoll: this._clamp(leftArmRoll, -0.85, 3.23),
            leftArmYaw: this._clamp(leftArmYaw, -2.2, 2.2),
            leftElbowFlex: this._clamp(leftElbowFlex, 0, 2.7),
            leftForearmTwist: this._clamp(leftForearmTwist, 0, Math.PI),
            leftHandGesture: leftHandGesture,
            leftHandAngles: leftHandAngles,
            leftHandDetectedPreset: leftHandDetectedPreset,
            rightArmPitch: this._clamp(rightArmPitch, -2.2, 2.2),
            rightArmRoll: this._clamp(rightArmRoll, -3.23, 0.85),
            rightArmYaw: this._clamp(rightArmYaw, -2.2, 2.2),
            rightElbowFlex: this._clamp(rightElbowFlex, 0, 2.7),
            rightForearmTwist: this._clamp(rightForearmTwist, 0, Math.PI),
            rightHandGesture: rightHandGesture,
            rightHandAngles: rightHandAngles,
            rightHandDetectedPreset: rightHandDetectedPreset,
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
                leftEye, rightEye,
                leftEyeInner, leftEyeOuter,
                rightEyeInner, rightEyeOuter,
                leftEar, rightEar,
                leftHand2D: matchedLeftHand,
                rightHand2D: matchedRightHand
            }
        };
    }

    /**
     * 完整上肢 3D 正交基底逆向運動學解算器 (Two-Bone Orthonormal IK Solver)
     * 1. 忠實保持相機 2D 骨骼傾角 (Screen-Space Fidelity)，絕不暴力竄改肘、腕關節 2D 坐標
     * 2. 摸頭/撫面/手觸臉部 專屬解剖解析逆向幾何求解器 (Analytical Two-Bone IK)：
     *    - 將手腕精準錨定於顱骨/前額/顳骨表面，以肩肘腕三點解算極向量與屈曲角，徹底根除單目深度坍縮
     * 3. 嚴格 [X_hinge, Y_shaft, Z_flex] 正交基底：
     *    - 大臂沿 -Y_local
     *    - 肘關節屈曲向前臂彎折平面投影，驅動 elbowJoint.rotation.x = -flex 100% 精確對齊手腕
     *    - 消除軸向耦合與 180° 翻轉奇異性
     * 4. 人體肌肉與服裝外輪廓防穿插 (Biomechanical Clearance)：
     *    - 脊椎解剖防護禁區與腹壁橢圓包絡面動態前推
     *    - 大臂後壁與側肋防穿插限制
     * 5. 歐拉角相位解包於過頂抬手 (uArm.y > 0.15) 或摸頭姿態啟用
     */
    _solveArmKinematics(
        shoulder, elbow, wrist, side,
        thoracicPitch, thoracicYaw, thoracicRoll, torsoHeight,
        thumb = null, pinky = null,
        leftHip = null, rightHip = null,
        isFrontOfPelvis = false, isHandOnHip = false,
        isTouchingHead = false, headTargetInfo = null,
        handLandmarks = null,
        overheadTargetInfo = null,
        isProfileStance = false,
        profileSign = 0,
        isBackStance = false
    ) {
        const conf = this.lastConfidences || {};
        return HierarchicalArmSolver.solve({
            shoulder,
            elbow,
            wrist,
            side,
            thoracicPitch,
            thoracicYaw,
            thoracicRoll,
            torsoHeight,
            aspectRatio: this.aspectRatio || 1.0,
            thumb,
            pinky,
            isFrontOfPelvis,
            isHandOnHip,
            isTouchingHead,
            headTargetInfo,
            handLandmarks,
            overheadTargetInfo,
            isProfileStance,
            profileSign,
            isBackStance,
            collisionConfig: ANATOMICAL_COLLISION_CONFIG,
            confidences: {
                arm: side === 'left' ? (conf.leftArm ?? 0.8) : (conf.rightArm ?? 0.8),
                hand: side === 'left' ? (conf.leftHand ?? 0.8) : (conf.rightHand ?? 0.8)
            }
        });
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
        pelvisPitch, pelvisYaw, pelvisRoll, torsoHeight,
        isProfileStance = false,
        profileSign = 0,
        isBackStance = false
    ) {
        const sign = (side === 'left') ? 1.0 : -1.0;
        const ar = this.aspectRatio || 1.0;

        const isNearLeg = isProfileStance && profileSign !== 0 && (
            (profileSign === 1 && side === 'right') || (profileSign === -1 && side === 'left')
        );
        const isFarLeg = isProfileStance && profileSign !== 0 && !isNearLeg;

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
        let dxFemur = (knee.x - hip.x) * ar;
        let dyFemur = -(knee.y - hip.y); // Three.js 向上為正
        let lFemur2D = Math.hypot(dxFemur, dyFemur);

        const scale = torsoHeight || 0.45;
        const LFemur = scale * 0.65;
        const LTibia = scale * 0.60;

        // 解剖防禦：若股骨 2D 投影嚴重坍縮 (膝蓋落在髖部附近，常為長裙或裁切照假特徵)
        // 絕不可將微小的 dzFemur 歸一化為指向相機的 90° 坐姿向前向量！
        if (lFemur2D < 0.28 * LFemur && !isProfileStance) {
            dxFemur = sign * 0.02 * LFemur;
            dyFemur = -LFemur;
            lFemur2D = LFemur;
        }

        // 2. 解剖深度推估 (Pythagorean Depth)
        const rawDzFemur = Math.sqrt(Math.max(0, LFemur * LFemur - lFemur2D * lFemur2D));
        const mpDzFemur = -((knee.z || 0) - (hip.z || 0));
        let dzFemur = 0.0;
        if (isProfileStance && profileSign !== 0) {
            // 側身模式下，近側腿面向鏡頭微正向偏移，遠側腿背對鏡頭微負向偏移
            dzFemur = isNearLeg ? (0.05 * LFemur) : (-0.05 * LFemur);
        } else if (lFemur2D < LFemur * 0.95) {
            dzFemur = this._clamp(rawDzFemur * mpDzFemur * 0.5, -0.35 * LFemur, 0.35 * LFemur);
            if (isBackStance) {
                dzFemur = -dzFemur;
            }
        }

        const vFemurCam = new THREE.Vector3(dxFemur, dyFemur, dzFemur);

        // 小腿 (Tibia & Fibula) 相機向量
        let vTibiaCam;
        if (ankle) {
            const dxShin = (ankle.x - knee.x) * ar;
            const dyShin = -(ankle.y - knee.y);
            const lShin2D = Math.hypot(dxShin, dyShin);
            const rawDzShin = Math.sqrt(Math.max(0, LTibia * LTibia - lShin2D * lShin2D));
            const mpDzShin = -((ankle.z || 0) - (knee.z || 0));
            let dzShin = isBackStance ? (0.05 * LTibia) : (-0.05 * LTibia);
            if (isProfileStance && profileSign !== 0) {
                dzShin = isNearLeg ? (0.04 * LTibia) : (-0.04 * LTibia);
            } else if (lShin2D < LTibia * 0.95) {
                // 若大腿垂直下垂但小腿嚴重短縮 (常為裁切照或裙襬假特徵)，不可推估過深深度避免假性屈膝跪姿
                const isFemurDown = dyFemur < -0.08 && Math.abs(dxFemur) < 0.65 * Math.abs(dyFemur);
                if (isFemurDown && lShin2D < 0.60 * lFemur2D) {
                    dzShin = isBackStance ? (0.04 * LTibia) : (-0.04 * LTibia);
                } else {
                    // 人體小腿彎曲必然向後 (相對於人體背側)，在背身模式下朝向相機 (+Z)，正面模式下背向相機 (-Z)
                    const zShinMag = Math.max(0.15, Math.min(0.85, Math.abs(mpDzShin)));
                    const backShinSign = isBackStance ? 1.0 : -1.0;
                    dzShin = backShinSign * rawDzShin * zShinMag;
                }
            }

            vTibiaCam = new THREE.Vector3(dxShin, dyShin, dzShin);
        } else {
            vTibiaCam = new THREE.Vector3(sign * 0.02, -LTibia, isBackStance ? (0.05 * LTibia) : (-0.05 * LTibia));
        }

        // 3. 逆變換至骨盆局部坐標系 (Pelvis Local Frame: 採用 YXZ 旋轉順序保持嚴密一致性)
        const qPelvis = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(pelvisPitch, pelvisYaw, pelvisRoll, 'YXZ')
        );
        const qPelvisInv = qPelvis.clone().invert();

        let uFemur = vFemurCam.clone().applyQuaternion(qPelvisInv).normalize();
        let uTibia = vTibiaCam.clone().applyQuaternion(qPelvisInv).normalize();

        // 4. 下肢雙骨單自由度鉸鏈 IK (Two-Bone Planar Hinge IK for Lower Limb)
        // 股骨長軸 (Three.js 股骨在局部坐標系中沿 -Y 下垂，故局部 +Y 軸對應 -uFemur)
        const yAxis = uFemur.clone().negate().normalize();

        // 膝關節屈曲角度 (Flexion)
        const dotFlex = THREE.MathUtils.clamp(uFemur.dot(uTibia), -1.0, 1.0);
        let flex = Math.acos(dotFlex);
        flex = this._clamp(flex, 0.02, 2.4);

        // 基準前方向量 zDef (面朝骨盆前方 +Z，帶微自然外旋 ~6°)
        let zDef = new THREE.Vector3(sign * 0.10, 0.0, 0.99).normalize();
        const dotZY = zDef.dot(yAxis);
        zDef.sub(yAxis.clone().multiplyScalar(dotZY)).normalize();
        if (zDef.lengthSq() < 1e-4) {
            zDef = new THREE.Vector3(0, 0, 1);
        }

        // 小腿屈曲垂直分量 (uTibia 在垂直於 uFemur 切平面上的正交投影)
        const uTibiaPerp = uTibia.clone().sub(uFemur.clone().multiplyScalar(uFemur.dot(uTibia)));
        const lTibiaPerp = uTibiaPerp.length();

        // 髕骨正前法向 (zAxis):
        // 解剖學原理：膝關節為單向鉸鏈 (kneeJoint.rotation.x = flex)，小腿恆向後方 popliteal fossa 彎折
        // 因此正前側髕骨方向 zFlex 必然指向 -uTibiaPerp！
        let zAxis;
        if (lTibiaPerp > 0.04 && flex > 0.06) {
            let zFlex = uTibiaPerp.clone().negate().normalize();
            // 髖關節旋轉極限約束：髕骨法向不可與人體前方相背，杜絕單視角深度噪聲導致關節逆向折斷
            if (zFlex.dot(zDef) < 0.15) {
                zFlex.lerp(zDef, 0.70).normalize();
            }
            const t = THREE.MathUtils.clamp((flex - 0.06) / 0.15, 0.0, 1.0);
            zAxis = zDef.clone().multiplyScalar(1.0 - t).addScaledVector(zFlex, t).normalize();
        } else {
            zAxis = zDef.clone();
        }

        // xAxis: 膝關節橫向鉸鏈軸 (由 yAxis 與 zAxis 外積嚴格保證右手正交系)
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
            // 補償足部網格自身的幾何自然休止傾角 (~0.15 rad / 8.5°)，站立時足底平貼地面
            ankleYaw = Math.atan2(uFootLocal.x, uFootLocal.z);
            const horiz = Math.hypot(uFootLocal.x, uFootLocal.z);
            anklePitch = Math.atan2(-uFootLocal.y, horiz) - 0.15;

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
     * 並提取 14 節指骨的真實連續空間夾角與藝用手勢分類
     */
    _solveTwistAndGestureFromHand(hand, side, isFrontOfPelvis = false, isHandOnHip = false, isTouchingHead = false) {
        const p0 = hand[0];    // Wrist
        const pIdx = hand[5];  // Index MCP
        const pPnk = hand[17]; // Pinky MCP
        const pMid = hand[9];  // Middle MCP

        // 1. 手部縱向指向 (dy > 0 表示手指朝下，dy < 0 表示手指朝上)
        const dy = pMid.y - p0.y;

        // 2. 食指與小指橫向空間關係 (解剖內外側)
        const lateralDiff = (side === 'left') ? (pIdx.x - pPnk.x) : (pPnk.x - pIdx.x);
        const lateralSpan = Math.abs(pIdx.x - pPnk.x);

        let twist = 1.48; // 預設半旋前 (85°)

        if (isTouchingHead) {
            // 摸頭/撫面：掌心向內貼顱骨
            twist = 0.40;
        } else if (isHandOnHip) {
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
            if (gesture === 'peace' || gesture === 'point' || lateralDiff > -0.015 || lateralSpan < 0.04) {
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

        // 3. 連續型 21 節點指骨角度解算 (Continuous Finger Kinematics)
        const fingerAngles = this._solveContinuousFingerAngles(hand, side);

        // 4. 手勢幾何自動分類 (用於 UI 標籤展示與預設對照)
        const gesture = this._classifyHandGesture(hand);

        return { twist, gesture, fingerAngles };
    }

    /**
     * 從 MediaPipe 21 節點計算 5 根手指各關節之連續屈曲與外展角度
     */
    _solveContinuousFingerAngles(hand, side) {
        if (!hand || hand.length < 21) return null;
        const sign = (side === 'left') ? 1.0 : -1.0;
        const ar = this.aspectRatio || 1.0;

        const getAngle = (v1, v2) => {
            const l1 = v1.length();
            const l2 = v2.length();
            if (l1 < 1e-4 || l2 < 1e-4) return 0;
            const dot = v1.dot(v2) / (l1 * l2);
            return Math.acos(THREE.MathUtils.clamp(dot, -1.0, 1.0));
        };

        const getPt = (i) => new THREE.Vector3(hand[i].x * ar, -hand[i].y, (hand[i].z || 0) * 0.85);

        const vWrist = getPt(0);
        const vIdxMcp = getPt(5);
        const vPnkMcp = getPt(17);
        const vMidMcp = getPt(9);

        // 掌面法向與基準軸
        const vPalmAxis = vMidMcp.clone().sub(vWrist).normalize();
        const vPalmWidth = vIdxMcp.clone().sub(vPnkMcp).normalize();
        const vPalmNormal = new THREE.Vector3().crossVectors(vPalmAxis, vPalmWidth).normalize();

        const solveFinger = (mcpIdx, pipIdx, dipIdx, tipIdx, baseSpread = 0) => {
            const pM = getPt(mcpIdx);
            const pP = getPt(pipIdx);
            const pD = getPt(dipIdx);
            const pT = getPt(tipIdx);

            const vMeta = pM.clone().sub(vWrist);
            const vProx = pP.clone().sub(pM);
            const vMid = pD.clone().sub(pP);
            const vDist = pT.clone().sub(pD);

            // 掌指關節 MCP 屈曲角
            const rawMcp = getAngle(vMeta, vProx);
            const mcp = THREE.MathUtils.clamp(rawMcp - 0.08, 0.0, 1.65);

            // 近端指間關節 PIP 屈曲角
            const rawPip = getAngle(vProx, vMid);
            const pip = THREE.MathUtils.clamp(rawPip - 0.05, 0.0, 1.80);

            // 遠端指間關節 DIP 屈曲角
            const rawDip = getAngle(vMid, vDist);
            const dip = THREE.MathUtils.clamp(rawDip - 0.05, 0.0, 1.45);

            // 外展分開角 (Spread)
            const vProxPlane = vProx.clone().sub(vPalmNormal.clone().multiplyScalar(vProx.dot(vPalmNormal)));
            const spreadDot = vProxPlane.dot(vPalmWidth);
            const spread = THREE.MathUtils.clamp(baseSpread + spreadDot * sign * 0.25, -0.25, 0.25);

            return { mcp, pip, dip, spread };
        };

        // 拇指獨立解算 (Thumb: 1 CMC, 2 MCP, 3 IP, 4 TIP)
        const pCmc = getPt(1);
        const pMcpT = getPt(2);
        const pIpT = getPt(3);
        const pTipT = getPt(4);

        const vMetaT = pMcpT.clone().sub(pCmc);
        const vProxT = pIpT.clone().sub(pMcpT);
        const vDistT = pTipT.clone().sub(pIpT);

        const rawMcpT = getAngle(vMetaT, vProxT);
        const rawIpT = getAngle(vProxT, vDistT);

        const thumbMcp = THREE.MathUtils.clamp(rawMcpT - 0.12, 0.05, 1.45);
        const thumbPip = THREE.MathUtils.clamp(rawIpT - 0.08, 0.05, 1.60);
        const thumbDip = thumbPip * 0.65;
        const thumbSpread = sign * 0.15;

        return {
            Thumb:  { mcp: thumbMcp, pip: thumbPip, dip: thumbDip, spread: thumbSpread },
            Index:  solveFinger(5, 6, 7, 8, sign * 0.05),
            Middle: solveFinger(9, 10, 11, 12, 0),
            Ring:   solveFinger(13, 14, 15, 16, -sign * 0.05),
            Little: solveFinger(17, 18, 19, 20, -sign * 0.12)
        };
    }

    /**
     * 21 骨節手勢幾何辨識器 (支援食指指向、比耶、比讚、OK、握拳、張開、放鬆)
     */
    _classifyHandGesture(hand) {
        const w = hand[0]; // Wrist

        const isExtended = (tipIdx, mcpIdx) => {
            const dTip = Math.hypot(hand[tipIdx].x - w.x, hand[tipIdx].y - w.y);
            const dMcp = Math.hypot(hand[mcpIdx].x - w.x, hand[mcpIdx].y - w.y);
            return dTip > (dMcp * 1.25);
        };

        const thumbExt = isExtended(4, 2);
        const indexExt = isExtended(8, 5);
        const middleExt = isExtended(12, 9);
        const ringExt = isExtended(16, 13);
        const pinkyExt = isExtended(20, 17);

        // 1. 食指單獨指向 / 手槍姿態 (Point)
        if (indexExt && !middleExt && !ringExt && !pinkyExt) {
            return 'point';
        }
        // 2. 勝利剪刀手 (Peace / YA)
        if (indexExt && middleExt && !ringExt && !pinkyExt) {
            return 'peace';
        }
        // 3. 大拇指比讚 (Thumbs Up)
        if (thumbExt && !indexExt && !middleExt && !ringExt && !pinkyExt) {
            return 'thumbsUp';
        }
        // 4. OK 手勢 (拇指與食指指尖相接，中指與無名指伸展)
        const dThumbIndex = Math.hypot(hand[4].x - hand[8].x, hand[4].y - hand[8].y);
        if (dThumbIndex < 0.06 && middleExt && ringExt) {
            return 'ok';
        }
        // 5. 握拳 (Fist)
        if (!indexExt && !middleExt && !ringExt && !pinkyExt) {
            return 'fist';
        }
        // 6. 張開平展 (Open Palm)
        if (indexExt && middleExt && ringExt && pinkyExt) {
            return 'open';
        }
        // 7. 自然放鬆微屈 (Relaxed)
        return 'relaxed';
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
            headPitch: 0.0,
            headYaw: 0.25,
            headRoll: 0.05,
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
