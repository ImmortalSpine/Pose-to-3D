import * as THREE from 'three';

/**
 * AnatoPose 3D - Confidence-Weighted Hierarchical Kinematic Solver (v7.0)
 * 
 * 信心分層一環扣一環生物力學推算引擎 (Confidence-Weighted Hierarchical Kinematic Chain)：
 * 1. ConfidenceEvaluator：量化評估各部位（頭、胸腔、骨盆、上臂、手掌 21 節點、下肢）之辨識信賴度 [0.1, 1.0]。
 * 2. ThoracoPelvicCoupler：嚴格限制胸腔與骨盆之相對轉角（Yaw / Pitch / Roll），依信賴度加權雙向約束，並平滑分配至腰椎。
 * 3. HierarchicalArmSolver：統一閉環雙骨逆向運動學 (Closed-Loop Two-Bone IK) 與相機投影生理向量約束，
 *    在構造正交基底 (makeBasis) 前完成所有三維向量與肘部鉸鏈極限約束，徹底根除歐拉角後置截斷造成的基底軸向畸變。
 */

const clamp = THREE.MathUtils.clamp;

export class ConfidenceEvaluator {
    /**
     * 評估全身各解剖模組之辨識信賴值 (0.10 ~ 1.00)
     */
    static evaluate(landmarks, matchedLeftHand, matchedRightHand, stanceInfo = {}) {
        const vis = (idx) => {
            const pt = landmarks && landmarks[idx];
            if (!pt) return 0.0;
            return clamp(pt.visibility ?? 0.85, 0.0, 1.0);
        };

        // 1. 頭部信賴值 (五官特徵點密集，通常為最高信賴度錨點之一)
        const noseV = vis(0);
        const lEyeV = vis(2);
        const rEyeV = vis(5);
        const lEarV = vis(7);
        const rEarV = vis(8);
        const faceRaw = (noseV * 0.40 + Math.max(lEyeV, rEyeV) * 0.35 + Math.max(lEarV, rEarV) * 0.25);
        const headConf = clamp(faceRaw * 1.05, 0.20, 0.98);

        // 2. 胸腔信賴值 (雙肩為全身最穩定的骨架剛體橫軸)
        const lShV = vis(11);
        const rShV = vis(12);
        let thoraxConf = clamp((lShV + rShV) * 0.5, 0.25, 0.96);
        if (stanceInfo.isProfileStance) {
            // 側身時遠側肩可能微遮擋，但近側肩與軀幹軸線仍高度可靠
            thoraxConf = clamp(Math.max(lShV, rShV) * 0.92, 0.45, 0.92);
        }

        // 3. 骨盆信賴值 (常受裙擺、外套或半身裁切影響)
        const lHipV = vis(23);
        const rHipV = vis(24);
        let pelvisConf = clamp((lHipV + rHipV) * 0.5, 0.15, 0.90);
        const midHipY = (landmarks[23] && landmarks[24]) ? (landmarks[23].y + landmarks[24].y) * 0.5 : 0.5;
        if (midHipY > 0.72) {
            // 接近畫面底邊裁切時降低骨盆權重，由胸腔主導帶動骨盆
            pelvisConf *= 0.65;
        }

        // 4. 左右上肢信賴值 (肩 + 肘 + 腕)
        const lElbV = vis(13);
        const rElbV = vis(14);
        const lWriV = vis(15);
        const rWriV = vis(16);
        const leftArmConf = clamp(lShV * 0.25 + lElbV * 0.45 + lWriV * 0.30, 0.15, 0.95);
        const rightArmConf = clamp(rShV * 0.25 + rElbV * 0.45 + rWriV * 0.30, 0.15, 0.95);

        // 5. 左右手掌信賴值 (一旦觸發 MediaPipe Holistic 21 節點手部模型，賦予 0.95 最高末端錨定信賴度！)
        const hasLHand21 = Boolean(matchedLeftHand && matchedLeftHand.length >= 21);
        const hasRHand21 = Boolean(matchedRightHand && matchedRightHand.length >= 21);
        const leftHandConf = hasLHand21 ? 0.95 : clamp(lWriV * 0.75, 0.10, 0.75);
        const rightHandConf = hasRHand21 ? 0.95 : clamp(rWriV * 0.75, 0.10, 0.75);

        // 6. 左右下肢信賴值
        const lKneeV = vis(25);
        const rKneeV = vis(26);
        const lAnkV = vis(27);
        const rAnkV = vis(28);
        const leftLegConf = clamp(lHipV * 0.2 + lKneeV * 0.4 + lAnkV * 0.4, 0.10, 0.92);
        const rightLegConf = clamp(rHipV * 0.2 + rKneeV * 0.4 + rAnkV * 0.4, 0.10, 0.92);

        return {
            head: headConf,
            thorax: thoraxConf,
            pelvis: pelvisConf,
            leftArm: leftArmConf,
            rightArm: rightArmConf,
            leftHand: leftHandConf,
            rightHand: rightHandConf,
            leftLeg: leftLegConf,
            rightLeg: rightLegConf
        };
    }
}

export class ThoracoPelvicCoupler {
    /**
     * 人體胸腰椎與骨盆相對運動生理極限常數 (Anatomical Thoraco-Pelvic ROM Limits)
     * - 軸向旋轉 (Yaw)：胸腰椎相對於骨盆之最大生理扭轉約 ±25° (0.45 rad)
     * - 冠狀面側彎 (Roll)：胸廓相對於骨盆之最大側傾約 ±20° (0.35 rad)
     * - 矢狀面屈伸 (Pitch)：胸廓相對於骨盆之最大前後俯仰差約 ±23° (0.40 rad)
     */
    static LIMITS = {
        maxDeltaYaw: 0.45,
        maxDeltaRoll: 0.35,
        maxDeltaPitch: 0.40
    };

    static _wrapPi(angle) {
        let a = angle;
        while (a > Math.PI) a -= 2 * Math.PI;
        while (a < -Math.PI) a += 2 * Math.PI;
        return a;
    }

    /**
     * 依胸腔與骨盆之信賴值執行雙向耦合約束，並計算平滑連續之腰椎過渡轉角
     */
    static couple(pose, confidences = { thorax: 0.85, pelvis: 0.65 }, spineDx = 0) {
        let {
            thoracicPitch, thoracicYaw, thoracicRoll,
            pelvisPitch, pelvisYaw, pelvisRoll
        } = pose;

        const cT = clamp(confidences.thorax ?? 0.85, 0.1, 1.0);
        const cP = clamp(confidences.pelvis ?? 0.65, 0.1, 1.0);
        // 胸腔權重 wT：信賴值越高者，在雙向拉扯中越穩固（移動量越小）
        const wT = cT / (cT + cP);
        const wP = 1.0 - wT;

        const { maxDeltaYaw, maxDeltaRoll, maxDeltaPitch } = ThoracoPelvicCoupler.LIMITS;

        // 1. 軸向旋轉耦合 (Yaw Coupling)
        const rawDeltaYaw = ThoracoPelvicCoupler._wrapPi(thoracicYaw - pelvisYaw);
        const clampedDeltaYaw = clamp(rawDeltaYaw, -maxDeltaYaw, maxDeltaYaw);
        const excessYaw = rawDeltaYaw - clampedDeltaYaw;
        if (Math.abs(excessYaw) > 1e-4) {
            thoracicYaw -= wP * excessYaw;
            pelvisYaw += wT * excessYaw;
        }

        // 2. 冠狀面側傾耦合 (Roll Coupling)
        const rawDeltaRoll = thoracicRoll - pelvisRoll;
        const clampedDeltaRoll = clamp(rawDeltaRoll, -maxDeltaRoll, maxDeltaRoll);
        const excessRoll = rawDeltaRoll - clampedDeltaRoll;
        if (Math.abs(excessRoll) > 1e-4) {
            thoracicRoll -= wP * excessRoll;
            pelvisRoll += wT * excessRoll;
        }

        // 3. 矢狀面俯仰耦合 (Pitch Coupling)
        const rawDeltaPitch = thoracicPitch - pelvisPitch;
        const clampedDeltaPitch = clamp(rawDeltaPitch, -maxDeltaPitch, maxDeltaPitch);
        const excessPitch = rawDeltaPitch - clampedDeltaPitch;
        if (Math.abs(excessPitch) > 1e-4) {
            thoracicPitch -= wP * excessPitch;
            pelvisPitch += wT * excessPitch;
        }

        // 4. 腰椎 5 節連續平滑弧線分配 (由 L5-L1 分擔 65% 胸盆相對差值，T12-L1 分擔 35%)
        const finalDeltaPitch = clamp(thoracicPitch - pelvisPitch, -maxDeltaPitch, maxDeltaPitch);
        const finalDeltaYaw = clamp(ThoracoPelvicCoupler._wrapPi(thoracicYaw - pelvisYaw), -maxDeltaYaw, maxDeltaYaw);
        const finalDeltaRoll = clamp(thoracicRoll - pelvisRoll, -maxDeltaRoll, maxDeltaRoll);

        const lumbarPitch = clamp(finalDeltaPitch * 0.65, -0.35, 0.35);
        const lumbarYaw = clamp(finalDeltaYaw * 0.65, -0.28, 0.28);
        const lumbarRoll = clamp(finalDeltaRoll * 0.65 - (spineDx * 0.20), -0.30, 0.30);

        return {
            thoracicPitch,
            thoracicYaw,
            thoracicRoll,
            pelvisPitch,
            pelvisYaw,
            pelvisRoll,
            lumbarPitch,
            lumbarYaw,
            lumbarRoll
        };
    }
}

export class HierarchicalArmSolver {
    /**
     * 階層式信賴度與雙向閉環上肢運動學求解器
     */
    static solve({
        shoulder, elbow, wrist, side,
        thoracicPitch, thoracicYaw, thoracicRoll, torsoHeight,
        aspectRatio = 1.0,
        thumb = null, pinky = null,
        isFrontOfPelvis = false, isHandOnHip = false,
        isTouchingHead = false, headTargetInfo = null,
        handLandmarks = null,
        overheadTargetInfo = null,
        isProfileStance = false,
        profileSign = 0,
        isBackStance = false,
        collisionConfig,
        confidences = { arm: 0.8, hand: 0.8 }
    }) {
        const sign = (side === 'left') ? 1.0 : -1.0;
        const ar = aspectRatio || 1.0;

        const isNearArm = isProfileStance && profileSign !== 0 && (
            (profileSign === 1 && side === 'right') || (profileSign === -1 && side === 'left')
        );
        const isFarArm = isProfileStance && profileSign !== 0 && !isNearArm;

        if (!elbow || !shoulder) {
            return {
                roll: sign * 0.12,
                pitch: 0,
                yaw: 0,
                flex: 0.15,
                twist: isFrontOfPelvis || isHandOnHip ? 2.60 : (isTouchingHead ? 0.40 : 1.48)
            };
        }

        const cfg = collisionConfig;
        const pShoulderLocal = new THREE.Vector3(sign * 5.35, 8.6, -1.0);
        const L1 = cfg.handClearance.armLen;  // 8.5
        const L2 = cfg.handClearance.foreLen; // 7.4

        let uArm, uFore;
        let pElbowLocal, pWristLocal, pHandTip;
        let isHeadSolve = false;
        let isReachingBehind = false;
        let isUpperTorsoHand = false;

        // 判定是否屬於「手肘在下、前臂向上反折觸摸頸圈/鎖骨/下頜」之 V 字形高信賴末端閉環姿態
        // 嚴格排除高舉向天空的伸直手臂（如 Disco 指向天空姿態，此時手肘高於肩膀且肘關節接近伸直）
        if (shoulder && elbow && wrist) {
            const scaleH = torsoHeight || 0.45;
            const elbowBelowShoulder = (elbow.y >= shoulder.y - 0.02 * scaleH);
            const forearmGoingUp = ((elbow.y - wrist.y) > 0.05 * scaleH);
            const topNeckBound = headTargetInfo ? (headTargetInfo.midEyeY - 0.04 * scaleH) : (shoulder.y - 0.32 * scaleH);
            const bottomNeckBound = shoulder.y + 0.14 * scaleH;
            const wristInNeckBand = (wrist.y >= topNeckBound && wrist.y <= bottomNeckBound);
            const wristNearNeckX = (Math.abs(wrist.x - shoulder.x) * ar < 0.26 * scaleH);

            // 計算 2D 肘部彎曲夾角，必須呈現顯著 V 字形彎折 (flex2D > 1.20 rad / ~69°)
            const vA2x = (elbow.x - shoulder.x) * ar, vA2y = elbow.y - shoulder.y;
            const vF2x = (wrist.x - elbow.x) * ar, vF2y = wrist.y - elbow.y;
            const lA2 = Math.hypot(vA2x, vA2y), lF2 = Math.hypot(vF2x, vF2y);
            const flex2D = (lA2 > 1e-4 && lF2 > 1e-4)
                ? Math.acos(clamp((vA2x * vF2x + vA2y * vF2y) / (lA2 * lF2), -1.0, 1.0))
                : 0;

            isUpperTorsoHand = Boolean(
                elbowBelowShoulder &&
                forearmGoingUp &&
                wristInNeckBand &&
                wristNearNeckX &&
                flex2D > 1.20
            );
        }

        if (overheadTargetInfo && overheadTargetInfo.isClasped) {
            // -------------------------------------------------------------
            // 模式 1：過頂合攏手 / 芭蕾五位手閉環 IK (Clasped Overhead Arched IK)
            // -------------------------------------------------------------
            const pWristTarget = new THREE.Vector3(sign * 0.70, 22.8, 1.05);

            const vST = pWristTarget.clone().sub(pShoulderLocal);
            const dST = vST.length();
            const maxD = (L1 + L2) * 0.96;
            const minD = Math.abs(L1 - L2) * 1.05;
            const safeD = clamp(dST, minD, maxD);
            const uST = vST.clone().normalize();

            const cosAlpha = (L1 * L1 + safeD * safeD - L2 * L2) / (2 * L1 * safeD);
            const alpha = Math.acos(clamp(cosAlpha, -1.0, 1.0));
            const dProj = L1 * Math.cos(alpha);
            const rCircle = L1 * Math.sin(alpha);

            const poleVec = new THREE.Vector3(sign * 1.85, 0.65, 0.40);
            const dotP = poleVec.dot(uST);
            const polePerp = poleVec.clone().sub(uST.clone().multiplyScalar(dotP)).normalize();

            pElbowLocal = pShoulderLocal.clone().addScaledVector(uST, dProj).addScaledVector(polePerp, rCircle);
            pWristLocal = pWristTarget;
            pHandTip = pWristLocal.clone().addScaledVector(pWristLocal.clone().sub(pElbowLocal).normalize(), cfg.handClearance.handLen);

            uArm = pElbowLocal.clone().sub(pShoulderLocal).normalize();
            uFore = pWristLocal.clone().sub(pElbowLocal).normalize();
            isHeadSolve = true;
        } else if (!isProfileStance && isTouchingHead && headTargetInfo && wrist && (elbow ? elbow.y <= shoulder.y + 0.05 : true)) {
            // -------------------------------------------------------------
            // 模式 2：正面/斜正面摸頭/撫面 專屬解析雙骨 IK (Analytical Two-Bone IK)
            // -------------------------------------------------------------
            const testPt = (handLandmarks && handLandmarks.length >= 21) ? handLandmarks[0] : wrist;
            const nosePt = headTargetInfo.nose;
            const midEyeY = headTargetInfo.midEyeY;

            const rawDx = (testPt.x - nosePt.x) * ar;
            const isCrossBody = (sign > 0 && rawDx < -0.04) || (sign < 0 && rawDx > 0.04);
            const targetSign = isCrossBody ? -sign : sign;
            const normX = clamp(Math.abs(rawDx) / 0.16, 0.40, 1.20);
            let targetX = targetSign * (1.30 + normX * 0.85);

            const scaleH = torsoHeight || 0.45;
            const dyHead = (midEyeY - testPt.y) / scaleH;
            const targetY = clamp(17.8 + dyHead * 4.8, 13.0, 20.2);

            let targetZ;
            if (targetY < 15.5) {
                targetX = targetSign * clamp(Math.abs(rawDx) / 0.16 * 1.4, 0.7, 1.8);
                targetZ = 2.1;
            } else {
                const rxRatio = Math.min(1.0, Math.abs(targetX) / 2.3);
                const ryRatio = Math.min(1.0, Math.abs(targetY - 17.8) / 2.5);
                const rRemain = Math.max(0.0, 1.0 - rxRatio * rxRatio - ryRatio * ryRatio);
                targetZ = 0.8 + 2.2 * Math.sqrt(rRemain) + 0.35;
            }

            const pWristTarget = new THREE.Vector3(targetX, targetY, targetZ);

            const vST = pWristTarget.clone().sub(pShoulderLocal);
            const dST = vST.length();
            const maxD = (L1 + L2) * 0.98;
            const minD = Math.abs(L1 - L2) * 1.05;
            const safeD = clamp(dST, minD, maxD);
            const uST = vST.clone().normalize();

            const cosAlpha = (L1 * L1 + safeD * safeD - L2 * L2) / (2 * L1 * safeD);
            const alpha = Math.acos(clamp(cosAlpha, -1.0, 1.0));
            const dProj = L1 * Math.cos(alpha);
            const rCircle = L1 * Math.sin(alpha);

            const dxElb2D = elbow ? (elbow.x - shoulder.x) * sign * ar : 0.15;
            const dyElb2D = elbow ? -(elbow.y - shoulder.y) : 0.10;
            const poleVec = new THREE.Vector3(
                sign * Math.max(0.7, 1.0 + dxElb2D * 1.8),
                Math.max(0.15, 0.35 + dyElb2D * 1.8),
                0.75
            );
            const dotP = poleVec.dot(uST);
            const polePerp = poleVec.clone().sub(uST.clone().multiplyScalar(dotP)).normalize();

            pElbowLocal = pShoulderLocal.clone().addScaledVector(uST, dProj).addScaledVector(polePerp, rCircle);
            pWristLocal = pWristTarget;
            pHandTip = pWristLocal.clone().addScaledVector(pWristLocal.clone().sub(pElbowLocal).normalize(), cfg.handClearance.handLen);

            uArm = pElbowLocal.clone().sub(pShoulderLocal).normalize();
            uFore = pWristLocal.clone().sub(pElbowLocal).normalize();
            isHeadSolve = true;
        } else {
            // -------------------------------------------------------------
            // 模式 3：相機平面投影 + 信賴度階層生物力學約束 (Camera-Consistent Hierarchical Kinematics)
            // -------------------------------------------------------------
            const dxArm = (elbow.x - shoulder.x) * ar;
            const dyArm = -(elbow.y - shoulder.y);
            const lArm2D = Math.hypot(dxArm, dyArm);

            const scale = torsoHeight || 0.45;
            const LArm = scale * 0.58;
            const LFore = scale * 0.52;

            // 動態自適應參考臂長：防止修長或健美體型因 2D 投影長度 >= LArm 而使 rawDzArm 歸零，
            // 導致整條手臂退化停留在後背肩胛平面 (pShoulderLocal.z = -1.0)
            const effLArm = Math.max(LArm, lArm2D * 1.06);
            const rawDzArm = Math.sqrt(Math.max(0, effLArm * effLArm - lArm2D * lArm2D));
            const mpDz = -((elbow.z || 0) - (shoulder.z || 0));
            let zSignArm = isFrontOfPelvis ? 0.32 : (mpDz < -0.08 ? -0.10 : 0.25);
            if (isHandOnHip) zSignArm = 0.25;
            let dzArm = rawDzArm * zSignArm;

            if (isProfileStance && profileSign !== 0) {
                // 側身模式：近側手摸頸/抬起時，手肘顯著朝向鏡頭外展 (+Z_cam)，避免大臂往後背深處穿刺
                const depthSignArm = isNearArm ? (isUpperTorsoHand ? 0.45 : 0.22) : -0.08;
                dzArm = depthSignArm * effLArm;
            } else if (isBackStance) {
                dzArm = -dzArm;
            }

            const vArmCam = new THREE.Vector3(dxArm, dyArm, dzArm);

            let vForeCam;
            if (wrist) {
                const dxFore = (wrist.x - elbow.x) * ar;
                const dyFore = -(wrist.y - elbow.y);
                const lFore2D = Math.hypot(dxFore, dyFore);
                const effLFore = Math.max(LFore, lFore2D * 1.08);
                const rawDzFore = Math.sqrt(Math.max(0, effLFore * effLFore - lFore2D * lFore2D));
                const mpDzFore = -((wrist.z || 0) - (elbow.z || 0));
                let zSignFore = 0.32;
                if (isFrontOfPelvis) {
                    zSignFore = 0.48;
                } else if (isHandOnHip) {
                    zSignFore = 0.30;
                } else if (mpDzFore < -0.08) {
                    zSignFore = (wrist.y > elbow.y + 0.1) ? 0.12 : -0.12;
                }
                let dzFore = rawDzFore * zSignFore;
                if (isProfileStance && profileSign !== 0) {
                    const depthSignFore = isNearArm ? 0.08 : -0.04;
                    dzFore = depthSignFore * effLFore;
                } else if (isBackStance) {
                    dzFore = -dzFore;
                }

                vForeCam = new THREE.Vector3(dxFore, dyFore, dzFore);
            } else {
                vForeCam = new THREE.Vector3(sign * 0.05, -LFore, 0.05);
            }

            // 逆變換至胸廓局部坐標系 (Thorax Local Frame: 'YXZ')
            const qThorax = new THREE.Quaternion().setFromEuler(
                new THREE.Euler(thoracicPitch, thoracicYaw, thoracicRoll, 'YXZ')
            );
            const qThoraxInv = qThorax.clone().invert();

            uArm = vArmCam.clone().applyQuaternion(qThoraxInv).normalize();
            uFore = vForeCam.clone().applyQuaternion(qThoraxInv).normalize();

            // 【關鍵階層約束 A：手觸摸頸圈/下頜/鎖骨時之雙向閉環幾何校正】
            if (isUpperTorsoHand) {
                // 1. 保持大臂縱向仰俯角 uy 不變（防止手肘掉到腰部導致前臂夠不到脖子），
                //    同時限制大臂後伸極限 uz >= -0.32 (~18.5°)，將多餘分量導向側向外展 ux (朝向鏡頭外展)！
                const uy = clamp(uArm.y, -0.52, 0.65);
                const uz = Math.max(-0.32, uArm.z);
                const uxMag = Math.sqrt(Math.max(0.08, 1.0 - uy * uy - uz * uz));
                uArm.set(sign * uxMag, uy, uz).normalize();

                pElbowLocal = pShoulderLocal.clone().addScaledVector(uArm, L1);

                // 2. 前臂方向：融合相機 2D 仰角向量與頸圈/鎖骨解剖目標點，
                //    既確保相機視角下「前臂 100% 位於大臂上方呈自然 V 字形」，又引導手掌落在頸圈旁
                const pNeckTarget = new THREE.Vector3(sign * 1.6, 12.6, 1.2);
                const uToNeck = pNeckTarget.clone().sub(pElbowLocal).normalize();
                const handWeight = (confidences.hand >= 0.85) ? 0.42 : 0.30;
                uFore.multiplyScalar(1.0 - handWeight).addScaledVector(uToNeck, handWeight).normalize();
                // 確保前臂必然向上指往頸部
                if (uFore.y < 0.55) {
                    uFore.y = 0.65;
                    uFore.normalize();
                }
            } else {
                // 由於盂肱關節起點位於胸廓後外側肩胛骨 (pShoulderLocal.z = -1.0)：
                // 1) 當手置於骨盆/口袋前方 (isFrontOfPelvis) 時，大臂必須微向前傾 (uArm.z >= 0.16)，使手肘推進至冠狀面中線前方 (Z >= +0.36)
                // 2) 正面自然下垂手臂 (uArm.y < -0.20) 亦需 uArm.z >= 0.08，防止因胸腔微轉向 (thoracicYaw) 逆變換將手臂推往背後
                const isGroundSupport = isProfileStance && wrist && elbow && (wrist.y > elbow.y + 0.06);
                let minZLimit = isGroundSupport ? -0.75 : -0.38;
                if (isFrontOfPelvis) {
                    minZLimit = 0.16;
                } else if (!isProfileStance && !isBackStance && uArm.y < -0.20 && mpDz >= -0.10) {
                    minZLimit = 0.08;
                }

                if (uArm.z < minZLimit) {
                    // 等比例縮放 (uArm.x, uArm.y)，100% 保持 2D 投影夾角不變
                    const xyLen = Math.hypot(uArm.x, uArm.y);
                    if (xyLen > 1e-4) {
                        const sXY = Math.sqrt(Math.max(0.08, 1.0 - minZLimit * minZLimit)) / xyLen;
                        uArm.set(uArm.x * sXY, uArm.y * sXY, minZLimit).normalize();
                    } else {
                        uArm.z = minZLimit;
                        uArm.normalize();
                    }
                }
                pElbowLocal = pShoulderLocal.clone().addScaledVector(uArm, L1);

                // 側身模式遠側下垂手臂（如持花手）：維持自然前下延伸，避免無故橫向突刺
                if (isFarArm && uFore.y < -0.55) {
                    uFore.z = clamp(uFore.z, -0.25, 0.25);
                    uFore.normalize();
                }
            }

            // B. 肋骨與側胸防穿插 (Lateral Ribcage Clearance)
            if (uArm.y < 0 && pElbowLocal.y < 8.5 && pElbowLocal.y > 0.0 && sign * pElbowLocal.x < 4.4 && uArm.z < 0.5) {
                pElbowLocal.x = sign * 4.4;
                uArm = pElbowLocal.clone().sub(pShoulderLocal).normalize();
                pElbowLocal = pShoulderLocal.clone().addScaledVector(uArm, L1);
            }

            // C. 插腰手肘外展三角幾何鎖定 (Akimbo Flared Elbow Anchor)
            if (isHandOnHip) {
                pElbowLocal.x = sign * Math.max(6.6, Math.abs(pElbowLocal.x));
                pElbowLocal.z = clamp(pElbowLocal.z, -0.1, 0.8);
                uArm = pElbowLocal.clone().sub(pShoulderLocal).normalize();
                pElbowLocal = pShoulderLocal.clone().addScaledVector(uArm, L1);
            }

            // D. 骨骼鏈端點與全軀幹-腰椎-骨盆前表面包絡檢測
            // 注意：在 thoracicCageUnit 局部坐標中：
            // - 胸廓 (T1..T12) 為 Y ∈ [0, 8.5]
            // - 腰椎 (L1..L5) 為 Y ∈ [-6.75, 0]
            // - 骨盆 (Ilium / ASIS Z=2.6 / Pubis Z=2.7) 為 Y ∈ [-12.5, -5.0]
            pWristLocal = pElbowLocal.clone().addScaledVector(uFore, L2);
            pHandTip = pElbowLocal.clone().addScaledVector(uFore, L2 + cfg.handClearance.handLen);

            const testPenetration = (pt) => {
                const inY = (pt.y >= -12.5 && pt.y <= cfg.spineShield.yMax);
                if (!inY) return { penetrates: false, zSurface: 0 };

                const zBack = -1.5;
                if (pt.z < zBack) return { penetrates: false, zSurface: 0 };

                const inSpineShield = (Math.abs(pt.x) < cfg.spineShield.radiusX && pt.z < cfg.spineShield.radiusZ);
                const effRadX = 5.2;
                const normX = Math.min(1.0, Math.abs(pt.x) / effRadX);
                let zSurface = cfg.torsoEnvelope.centerZ + cfg.torsoEnvelope.radiusZ * Math.sqrt(Math.max(0.0, 1.0 - normX * normX));

                // 骨盆髂前上棘 (ASIS: |X|=3.8, Z=2.6) 與恥骨聯合 (Pubis: X=0, Z=2.7) 前緣包絡保護
                if (pt.y >= -12.5 && pt.y <= -4.5 && Math.abs(pt.x) <= 5.0) {
                    const zPelvis = 2.75 - 0.22 * (Math.abs(pt.x) / 5.0);
                    zSurface = Math.max(zSurface, zPelvis);
                }

                const inTorsoViscera = (Math.abs(pt.x) < effRadX && pt.z < zSurface);

                return {
                    penetrates: inSpineShield || inTorsoViscera,
                    zSurface
                };
            };

            const resWrist = testPenetration(pWristLocal);
            const resTip = testPenetration(pHandTip);

            // 僅當非骨盆前側置手且大臂顯著後伸時，才判定為背後背手
            isReachingBehind = !isFrontOfPelvis && !isHandOnHip && ((uArm.z < -0.32) || (pWristLocal.z < -1.6 && isProfileStance));

            if (isHandOnHip) {
                pWristLocal.x = sign * Math.max(4.2, Math.abs(pWristLocal.x));
                pWristLocal.z = clamp(pWristLocal.z, 0.8, 1.6);

                uFore = pWristLocal.clone().sub(pElbowLocal).normalize();
                pHandTip = pElbowLocal.clone().addScaledVector(uFore, L2 + cfg.handClearance.handLen);
            } else if (!isReachingBehind && !isUpperTorsoHand && (resWrist.penetrates || resTip.penetrates || isFrontOfPelvis)) {
                // 計算跨越骨盆前緣 (ASIS Z=2.6 / 恥骨 Z=2.7) 所需之安全前方 Z 座標 (Z >= 2.90)
                const reqZ = Math.max(
                    pWristLocal.z,
                    resWrist.penetrates ? (resWrist.zSurface + 0.40) : -99.0,
                    resTip.penetrates ? (resTip.zSurface + 0.25) : -99.0,
                    isFrontOfPelvis ? 2.90 : -99.0
                );

                if (pWristLocal.z < reqZ) {
                    // 1) 若手肘偏後 (Z < 0.36)，先將手肘推至冠狀面微前方，分擔前臂前移量
                    if (pElbowLocal.z < 0.36) {
                        const targetArmUz = clamp((0.36 - pShoulderLocal.z) / L1, -0.30, 0.45);
                        const xyA = Math.hypot(uArm.x, uArm.y);
                        if (xyA > 1e-4) {
                            const sA = Math.sqrt(Math.max(0.10, 1.0 - targetArmUz * targetArmUz)) / xyA;
                            uArm.set(uArm.x * sA, uArm.y * sA, targetArmUz).normalize();
                            pElbowLocal = pShoulderLocal.clone().addScaledVector(uArm, L1);
                        }
                    }

                    // 2) 以等比例縮放 (uFore.x, uFore.y) 的方式設定前臂前向分量 targetForeUz，
                    //    100% 保留 2D 畫面中的前臂斜向口袋角度與手腕下探高度，徹底杜絕手掌穿入骨盆後方或被拉高至腰部！
                    const targetForeUz = clamp((reqZ - pElbowLocal.z) / L2, uFore.z, 0.52);
                    const xyF = Math.hypot(uFore.x, uFore.y);
                    if (xyF > 1e-4) {
                        const sF = Math.sqrt(Math.max(0.10, 1.0 - targetForeUz * targetForeUz)) / xyF;
                        uFore.set(uFore.x * sF, uFore.y * sF, targetForeUz).normalize();
                    } else {
                        uFore.z = targetForeUz;
                        uFore.normalize();
                    }

                    pWristLocal = pElbowLocal.clone().addScaledVector(uFore, L2);
                    pHandTip = pElbowLocal.clone().addScaledVector(uFore, L2 + cfg.handClearance.handLen);
                }
            }
        }

        // -------------------------------------------------------------
        // 5. 嚴密正交基底構造 (Two-Bone Orthonormal Basis)
        // 注意：所有生理限制均已於上方 3D 向量階段完成，此處提取之歐拉角嚴禁後置截斷，
        // 以確保 elbowJoint 的本地 X 鉸鏈軸 100% 對準前臂屈曲平面！
        // -------------------------------------------------------------
        const yAxis = uArm.clone().negate().normalize();

        const dotFlex = clamp(uArm.dot(uFore), -1.0, 1.0);
        let flex = Math.acos(dotFlex);

        // 肘關節鉸鏈生理屈曲極限：0.05 rad (~3°) 至 2.40 rad (~137.5°)，禁止超量反折
        flex = clamp(flex, 0.05, 2.40);

        if (isFarArm && isReachingBehind && uFore.y < 0) {
            flex = Math.min(flex, 1.25);
        }

        const uForePerp = uFore.clone().sub(uArm.clone().multiplyScalar(dotFlex));
        const lPerp = uForePerp.length();

        let zDef = new THREE.Vector3(0, 0, 1);
        const dotZY = zDef.dot(yAxis);
        zDef.sub(yAxis.clone().multiplyScalar(dotZY)).normalize();
        if (zDef.lengthSq() < 1e-4) {
            zDef = new THREE.Vector3(0, 1, 0);
        }

        let zAxis;
        if (lPerp > 0.05 && flex > 0.08) {
            const zFlex = uForePerp.clone().normalize();
            const t = clamp((flex - 0.08) / 0.15, 0.0, 1.0);
            zAxis = zDef.clone().multiplyScalar(1.0 - t).addScaledVector(zFlex, t).normalize();
        } else {
            zAxis = zDef;
        }

        const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
        zAxis.crossVectors(xAxis, yAxis).normalize();

        const basisMat = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
        const euler = new THREE.Euler().setFromRotationMatrix(basisMat, 'YXZ');

        // 6. 智慧橈骨旋前/旋後 (Twist / Pronation-Supination)
        let twist = 1.48;

        const isHanging = (uFore.y < -0.65) && (flex < 0.45);
        const isOnTorso = (flex >= 0.45) && (pWristLocal.y < 1.0) && (Math.abs(pWristLocal.x) < 5.8);
        const isRaised = (pWristLocal.y >= 1.0) && (flex >= 0.7);

        if (isHeadSolve) {
            twist = (overheadTargetInfo && overheadTargetInfo.isClasped) ? 1.15 : 0.40;
        } else if (isUpperTorsoHand) {
            twist = 0.35;
        } else if (isHandOnHip) {
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
            twist = clamp(1.48 + 0.45 * (flex - 0.45), 0.3, 2.7);
        }

        if (!isFrontOfPelvis && !isHandOnHip && !isHeadSolve && thumb && pinky) {
            const latDiff = (side === 'left') ? ((thumb.x - pinky.x) * ar) : ((pinky.x - thumb.x) * ar);
            const twistBias = clamp(-latDiff * 3.5, -0.65, 0.65);
            twist += twistBias;
        }

        twist = clamp(twist, 0.1, Math.PI);

        // 7. 歐拉角相位連續化解包（僅做 ±2π 等價同構平移供 UI 滑桿顯示，絕不改變旋轉矩陣本身！）
        let roll = euler.z;
        const isArmRaisedOverhead = (uArm.y > 0.15) || isHeadSolve;
        if (isArmRaisedOverhead) {
            if (side === 'right' && roll > Math.PI * 0.5) {
                roll -= 2 * Math.PI;
            }
            if (side === 'left' && roll < -Math.PI * 0.5) {
                roll += 2 * Math.PI;
            }
        }

        return {
            roll,
            pitch: euler.x,
            yaw: euler.y,
            flex,
            twist
        };
    }
}

