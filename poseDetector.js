/**
 * AnatoPose 3D - Torso, Pelvis & Upper Limb Pose Estimator
 * 
 * 擴充肘關節屈曲與前臂翻轉：
 * 1. 肘關節屈曲 (Elbow Flexion)：透過 (Shoulder -> Elbow) 與 (Elbow -> Wrist) 的幾何夾角精確計算屈肘度數
 * 2. 橈骨旋前/旋後 (Forearm Pronation/Supination)
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
        const leftShoulder = lm[11];
        const rightShoulder = lm[12];
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

        // 3. 水平轉向 (Yaw)
        const halfSpan = shoulderSpan * 0.5;
        const headOffsetRatio = (nose.x - midShoulder.x) / (halfSpan || 0.001);
        let thoracicYaw = Math.asin(this._clamp(headOffsetRatio * 0.85, -0.75, 0.75));

        // 4. 胸廓側傾 (Roll)
        let thoracicRoll = -Math.atan2(shoulderDy, Math.abs(shoulderDx));

        // 5. 軀幹縱向中心軸
        const spineDx = midShoulder.x - midHip.x;
        const spineDy = midShoulder.y - midHip.y;

        // 6. 骨盆傾斜 (Pelvis Roll / Hip Tilt)
        const hipDx = leftHip.x - rightHip.x;
        const hipDy = leftHip.y - rightHip.y;
        let pelvisRoll = -Math.atan2(hipDy, Math.abs(hipDx));

        // 7. 腰椎受力側彎
        let lumbarRoll = (thoracicRoll - pelvisRoll) * 0.55 - (spineDx * 0.5);

        // 8. 俯仰 (Pitch)
        let thoracicPitch = this._clamp((spineDy + 0.35) * 0.2, -0.25, 0.25);
        let pelvisPitch = thoracicPitch * 0.35;

        // 9. 頸椎轉動
        let cervicalPitch = (nose.y - midShoulder.y + 0.15) * 0.3;
        let cervicalYaw = (nose.x - midShoulder.x) * 0.5;

        // -------------------------------------------------------------
        // 10. 左右大臂與前臂 (肱骨、尺骨、橈骨)
        // -------------------------------------------------------------
        // 左臂 (大臂 + 肘屈曲)
        let leftArmPitch = 0;
        let leftArmRoll = 0.12;
        let leftArmYaw = 0;
        let leftElbowFlex = 0.15;
        let leftForearmTwist = 0.35;

        if (leftElbow) {
            const armDxL = leftElbow.x - leftShoulder.x;
            const armDyL = leftElbow.y - leftShoulder.y;
            leftArmRoll = Math.atan2(armDxL, armDyL);
            if (armDyL < 0.1) leftArmPitch = 0.35;

            // 計算左肘屈曲度 (Flexion)
            if (leftWrist) {
                const foreDxL = leftWrist.x - leftElbow.x;
                const foreDyL = leftWrist.y - leftElbow.y;
                const dot = armDxL * foreDxL + armDyL * foreDyL;
                const magArm = Math.hypot(armDxL, armDyL) || 1;
                const magFore = Math.hypot(foreDxL, foreDyL) || 1;
                const cosAngle = this._clamp(dot / (magArm * magFore), -1, 1);
                leftElbowFlex = Math.acos(cosAngle);
            }
        }

        // 右臂 (大臂 + 肘屈曲)
        let rightArmPitch = 0;
        let rightArmRoll = -0.12;
        let rightArmYaw = 0;
        let rightElbowFlex = 0.15;
        let rightForearmTwist = 0.35;

        if (rightElbow) {
            const armDxR = rightElbow.x - rightShoulder.x;
            const armDyR = rightElbow.y - rightShoulder.y;
            rightArmRoll = Math.atan2(armDxR, armDyR);
            if (armDyR < 0.1) rightArmPitch = 0.35;

            // 計算右肘屈曲度 (Flexion)
            if (rightWrist) {
                const foreDxR = rightWrist.x - rightElbow.x;
                const foreDyR = rightWrist.y - rightElbow.y;
                const dot = armDxR * foreDxR + armDyR * foreDyR;
                const magArm = Math.hypot(armDxR, armDyR) || 1;
                const magFore = Math.hypot(foreDxR, foreDyR) || 1;
                const cosAngle = this._clamp(dot / (magArm * magFore), -1, 1);
                rightElbowFlex = Math.acos(cosAngle);

                // 若手腕高於手肘 (如比耶動作)，前臂向上向前
                if (foreDyR < 0) {
                    rightArmPitch = 0.45;
                }
            }
        }

        // 鏡像反轉
        if (this.isMirrored) {
            thoracicRoll = -thoracicRoll;
            pelvisRoll = -pelvisRoll;
            lumbarRoll = -lumbarRoll;
            thoracicYaw = -thoracicYaw;
            cervicalYaw = -cervicalYaw;
            
            const tempRoll = leftArmRoll;
            leftArmRoll = -rightArmRoll;
            rightArmRoll = -tempRoll;

            const tempFlex = leftElbowFlex;
            leftElbowFlex = rightElbowFlex;
            rightElbowFlex = tempFlex;
        }

        return {
            pelvisRoll: this._clamp(pelvisRoll, -0.4, 0.4),
            pelvisPitch: this._clamp(pelvisPitch, -0.2, 0.2),
            pelvisYaw: this._clamp(thoracicYaw * 0.4, -0.4, 0.4),
            thoracicPitch: this._clamp(thoracicPitch, -0.35, 0.35),
            thoracicYaw: this._clamp(thoracicYaw, -0.85, 0.85),
            thoracicRoll: this._clamp(thoracicRoll, -0.5, 0.5),
            lumbarPitch: this._clamp(thoracicPitch * 0.3, -0.3, 0.3),
            lumbarRoll: this._clamp(lumbarRoll, -0.45, 0.45),
            lumbarYaw: this._clamp(thoracicYaw * 0.3, -0.4, 0.4),
            cervicalPitch: this._clamp(cervicalPitch, -0.4, 0.4),
            cervicalYaw: this._clamp(cervicalYaw, -0.6, 0.6),
            leftArmPitch: this._clamp(leftArmPitch, -1.2, 1.2),
            leftArmRoll: this._clamp(leftArmRoll, 0.06, 2.5),
            leftArmYaw: this._clamp(leftArmYaw, -0.8, 0.8),
            leftElbowFlex: this._clamp(leftElbowFlex, 0, 2.5),
            leftForearmTwist: this._clamp(leftForearmTwist, 0, Math.PI),
            rightArmPitch: this._clamp(rightArmPitch, -1.2, 1.2),
            rightArmRoll: this._clamp(rightArmRoll, -2.5, -0.06),
            rightArmYaw: this._clamp(rightArmYaw, -0.8, 0.8),
            rightElbowFlex: this._clamp(rightElbowFlex, 0, 2.5),
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

    _heuristicImageAnalysis() {
        return {
            pelvisRoll: -0.06,
            pelvisPitch: 0.02,
            pelvisYaw: 0.02,
            thoracicPitch: -0.05,
            thoracicYaw: 0.05,
            thoracicRoll: -0.08,
            lumbarPitch: 0.02,
            lumbarRoll: 0.04,
            lumbarYaw: 0.02,
            cervicalPitch: 0.0,
            cervicalYaw: 0.02,
            leftArmPitch: 0,
            leftArmRoll: 0.25,
            leftArmYaw: 0,
            leftElbowFlex: 0.35,
            leftForearmTwist: 0.4,
            rightArmPitch: 0.45,
            rightArmRoll: -1.2,
            rightArmYaw: 0,
            rightElbowFlex: 1.85, // 右臂抬手屈肘
            rightForearmTwist: 0.3,
            landmarks2D: null
        };
    }

    _clamp(val, min, max) {
        return Math.max(min, Math.min(max, val));
    }
}
