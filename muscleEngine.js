/**
 * AnatoPose 3D - Procedural Anatomical Muscle Engine (v10.1: High-Detail Fascicles & Textures)
 *
 * 附著於 206 塊醫學級骨骼系統之程式化動態肌肉系統：
 * 1. 每塊肌肉透過骨骼起止點 (Origin / Insertion) 與繞行點 (Via-Points) 錨定至對應關節群組，
 *    在擺姿、男女體態切換與前臂旋前/旋後時與骨骼即時連動。
 * 2. 3D 幾何層級肌束浮雕：
 *    - 管狀/紡錘肌採用 28 段高細分剖面，搭配真實解剖肌頭分隔凹溝 (如二頭肌長短頭、三頭肌頭溝)
 *      與徑向肌束拱起，並對接縫法線做無縫平滑融合。
 *    - 扇形闊肌 (如胸大肌) 先做 22 列三次曲線細分貼合胸廓弧面，再疊加放射狀 3D 肌束拱脊。
 * 3. 動態 UV 搭配程式化無縫肌纖維貼圖 (Albedo Striation + Bump Relief + Fascia Roughness)。
 * 4. 體積守恆伸縮形變 (Volume-Preserving Bulge: radius ∝ sqrt(L0 / L))，純英文解剖名稱。
 */

import * as THREE from 'three';
import { GLB_SCALE, GLB_PIVOTS_M } from './medicalSkeletonLoader.js?v=9.0';

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

function mirrorX(pt, sign) {
    return [sign * pt[0], pt[1], pt[2]];
}

function toLocalOffset(ptM, pivotM) {
    return new THREE.Vector3(
        (ptM[0] - pivotM[0]) * GLB_SCALE,
        (ptM[1] - pivotM[1]) * GLB_SCALE,
        (ptM[2] - pivotM[2]) * GLB_SCALE
    );
}

/**
 * 程式化生成無縫肌束纖維紋理組 (Albedo Map / Bump Map / Roughness Map)
 * U 軸橫跨多條平行肌束，V 軸沿肌肉起止點纖維方向延伸
 */
function createProceduralMuscleTextures() {
    const W = 512;
    const H = 512;
    const bundleCount = 12;

    const albedoCanvas = document.createElement('canvas');
    albedoCanvas.width = W;
    albedoCanvas.height = H;
    const aCtx = albedoCanvas.getContext('2d');

    const bumpCanvas = document.createElement('canvas');
    bumpCanvas.width = W;
    bumpCanvas.height = H;
    const bCtx = bumpCanvas.getContext('2d');

    const roughCanvas = document.createElement('canvas');
    roughCanvas.width = W;
    roughCanvas.height = H;
    const rCtx = roughCanvas.getContext('2d');

    const aImg = aCtx.createImageData(W, H);
    const bImg = bCtx.createImageData(W, H);
    const rImg = rCtx.createImageData(W, H);

    // 確定性偽隨機雜訊，營造真實有機肌纖維縱向微變化，避免機械條碼感
    const hash = (x, y) => {
        const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
        return s - Math.floor(s);
    };

    for (let y = 0; y < H; y++) {
        const v = y / H;
        // 縱向緩變波紋 (周期在 2π 倍數上，確保 V 向也無縫)
        const waveV = Math.sin(v * Math.PI * 2.0) * 0.5 + Math.cos(v * Math.PI * 6.0) * 0.5;

        for (let x = 0; x < W; x++) {
            const u = x / W;
            const warpU = u + 0.004 * waveV;

            // 大肌束圓拱輪廓 (每束中間飽滿、束間肌外膜溝槽深)
            const bundlePhase = warpU * bundleCount * Math.PI;
            const bundleArch = Math.pow(Math.abs(Math.sin(bundlePhase)), 0.52);

            // 細部次級肌纖維 (每個大肌束內含 ~5 條細肌原纖維)
            const subPhase = warpU * (bundleCount * 5) * Math.PI;
            const subFiber = Math.pow(Math.abs(Math.sin(subPhase)), 0.65);

            // 微細雜點與絲狀肌膜高光
            const nFine = hash(Math.floor(warpU * 240), Math.floor(v * 28));
            const fasciaHighlight = Math.pow(bundleArch, 2.2) * (0.06 + 0.08 * nFine);

            // 1. Albedo (維持高亮度中性偏暖基底，與 vertexColor 相乘才不會發黑，溝槽呈深紫紅陰影)
            const lum = clamp(0.46 + 0.36 * bundleArch + 0.14 * subFiber + fasciaHighlight, 0.32, 1.0);
            const rVal = Math.round(clamp(lum * 255, 0, 255));
            const gVal = Math.round(clamp((lum * 0.90 - (1.0 - bundleArch) * 0.08) * 255, 0, 255));
            const bVal = Math.round(clamp((lum * 0.90 - (1.0 - bundleArch) * 0.06) * 255, 0, 255));

            // 2. Bump height (肌束中央凸起 235，束間凹溝下沉 30)
            const bumpH = clamp(0.14 + 0.64 * bundleArch + 0.18 * subFiber + 0.04 * nFine, 0, 1);
            const bByte = Math.round(bumpH * 255);

            // 3. Roughness (溝槽偏霧面 0.72，肌束表面濕潤肌膜微亮 0.32)
            const rough = clamp(0.72 - 0.36 * bundleArch - 0.06 * subFiber, 0.25, 0.85);
            const rByte = Math.round(rough * 255);

            const p = (y * W + x) * 4;
            aImg.data[p] = rVal; aImg.data[p + 1] = gVal; aImg.data[p + 2] = bVal; aImg.data[p + 3] = 255;
            bImg.data[p] = bByte; bImg.data[p + 1] = bByte; bImg.data[p + 2] = bByte; bImg.data[p + 3] = 255;
            rImg.data[p] = rByte; rImg.data[p + 1] = rByte; rImg.data[p + 2] = rByte; rImg.data[p + 3] = 255;
        }
    }

    aCtx.putImageData(aImg, 0, 0);
    bCtx.putImageData(bImg, 0, 0);
    rCtx.putImageData(rImg, 0, 0);

    const albedoMap = new THREE.CanvasTexture(albedoCanvas);
    albedoMap.colorSpace = THREE.SRGBColorSpace;
    albedoMap.wrapS = THREE.RepeatWrapping;
    albedoMap.wrapT = THREE.RepeatWrapping;
    albedoMap.anisotropy = 4;

    const bumpMap = new THREE.CanvasTexture(bumpCanvas);
    bumpMap.wrapS = THREE.RepeatWrapping;
    bumpMap.wrapT = THREE.RepeatWrapping;
    bumpMap.anisotropy = 4;

    const roughnessMap = new THREE.CanvasTexture(roughCanvas);
    roughnessMap.wrapS = THREE.RepeatWrapping;
    roughnessMap.wrapT = THREE.RepeatWrapping;
    roughnessMap.anisotropy = 4;

    return { albedoMap, bumpMap, roughnessMap };
}

export class AnatomicalMuscleSystem {
    constructor(anatomicalTorso) {
        this.torso = anatomicalTorso;
        this.muscleGroup = new THREE.Group();
        this.muscleGroup.name = 'AnatomicalMuscles_Group';

        this.visible = true;
        this.opacity = 0.96;
        this.selectedMuscleId = null;

        this.muscles = [];
        this.muscleById = new Map();
        this.peeledHistory = [];

        const textures = createProceduralMuscleTextures();
        this.textures = textures;

        this.baseMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            map: textures.albedoMap,
            bumpMap: textures.bumpMap,
            bumpScale: 0.24,
            roughnessMap: textures.roughnessMap,
            roughness: 0.85,
            metalness: 0.04,
            vertexColors: true,
            transparent: true,
            opacity: this.opacity,
            side: THREE.DoubleSide
        });

        this.selectedMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            map: textures.albedoMap,
            bumpMap: textures.bumpMap,
            bumpScale: 0.26,
            roughnessMap: textures.roughnessMap,
            roughness: 0.72,
            metalness: 0.08,
            emissive: 0xff8c42,
            emissiveIntensity: 0.42,
            vertexColors: true,
            transparent: true,
            opacity: this.opacity,
            side: THREE.DoubleSide
        });

        this._colorBelly = new THREE.Color(0xc24044);
        this._colorBellyDeep = new THREE.Color(0x91292d);
        this._colorTendon = new THREE.Color(0xf0e8dc);
        this._tmpColor = new THREE.Color();
        this._tmpVecA = new THREE.Vector3();

        this._buildUpperLimbAndChestMuscles();
    }

    _anchor(node, ptLeftM, pivotLeftM, side) {
        const sign = (side === 'left') ? 1 : -1;
        const ptM = mirrorX(ptLeftM, sign);
        const pivotM = mirrorX(pivotLeftM, sign);
        return {
            node,
            localPos: toLocalOffset(ptM, pivotM)
        };
    }

    _thoraxAnchor(node, ptLeftM, side) {
        const sign = (side === 'left') ? 1 : -1;
        return {
            node,
            localPos: toLocalOffset([sign * ptLeftM[0], ptLeftM[1], ptLeftM[2]], GLB_PIVOTS_M.thoraxOrigin)
        };
    }

    _buildUpperLimbAndChestMuscles() {
        const P = GLB_PIVOTS_M;

        for (const side of ['left', 'right']) {
            const sideTitle = (side === 'left') ? 'Left' : 'Right';
            const sg = this.torso.shoulderGirdle[side];
            if (!sg) continue;

            const pClav = [P.claviclePivotX, P.claviclePivotY, P.claviclePivotZ];
            const pScap = [P.scapulaPivotX, P.scapulaPivotY, P.scapulaPivotZ];
            const pHum = [P.shoulderPivotX, P.shoulderPivotY, P.shoulderPivotZ];
            const pUln = [P.elbowPivotX, P.elbowPivotY, P.elbowPivotZ];
            const pRad = [P.radProxX, P.radProxY, P.radProxZ];
            const pWr = [P.wristPivotX, P.wristPivotY, P.wristPivotZ];

            const ribNode = this.torso.ribcageGroup;
            const clavNode = sg.clavicleScaleGroup;
            const scapNode = sg.scapulaMesh;
            const humNode = sg.humerusCaliber;
            const ulnNode = sg.forearmAlign;
            const radNode = sg.radiusAlign;
            const handNode = sg.handAlign;

            // 1. Deltoid - Anterior (Multi-fascicle dome over anterior humeral head)
            this._registerTubeMuscle({
                id: `deltoid_anterior_${side}`,
                name: `Deltoid - Anterior (${sideTitle})`,
                region: 'shoulder',
                layer: 'superficial',
                side,
                anchors: [
                    this._anchor(clavNode, [0.108, 1.410, -0.004], pClav, side),
                    this._anchor(clavNode, [0.140, 1.404, -0.014], pClav, side),
                    this._anchor(humNode, [0.184, 1.376, 0.008], pHum, side),
                    this._anchor(humNode, [0.197, 1.320, 0.000], pHum, side),
                    this._anchor(humNode, [0.203, 1.268, -0.024], pHum, side)
                ],
                baseRadius: 0.48,
                aspectX: 1.34,
                aspectZ: 0.72,
                tendonStart: 0.14,
                tendonEnd: 0.22,
                bellyPower: 0.76,
                bellyBias: 0.42,
                maxBulge: 1.30,
                fascicleCount: 6,
                fascicleDepth: 0.055,
                uvU: 1
            });

            // 2. Deltoid - Lateral (Multipennate central shoulder cap)
            this._registerTubeMuscle({
                id: `deltoid_lateral_${side}`,
                name: `Deltoid - Lateral (${sideTitle})`,
                region: 'shoulder',
                layer: 'superficial',
                side,
                anchors: [
                    this._anchor(scapNode, [0.165, 1.410, -0.040], pScap, side),
                    this._anchor(humNode, [0.201, 1.376, -0.024], pHum, side),
                    this._anchor(humNode, [0.208, 1.320, -0.026], pHum, side),
                    this._anchor(humNode, [0.205, 1.268, -0.032], pHum, side)
                ],
                baseRadius: 0.52,
                aspectX: 0.90,
                aspectZ: 1.44,
                tendonStart: 0.14,
                tendonEnd: 0.22,
                bellyPower: 0.74,
                bellyBias: 0.44,
                maxBulge: 1.32,
                fascicleCount: 7,
                fascicleDepth: 0.060,
                uvU: 1
            });

            // 3. Deltoid - Posterior
            this._registerTubeMuscle({
                id: `deltoid_posterior_${side}`,
                name: `Deltoid - Posterior (${sideTitle})`,
                region: 'shoulder',
                layer: 'superficial',
                side,
                anchors: [
                    this._anchor(scapNode, [0.095, 1.380, -0.088], pScap, side),
                    this._anchor(scapNode, [0.152, 1.384, -0.068], pScap, side),
                    this._anchor(humNode, [0.186, 1.370, -0.052], pHum, side),
                    this._anchor(humNode, [0.201, 1.318, -0.044], pHum, side),
                    this._anchor(humNode, [0.204, 1.268, -0.038], pHum, side)
                ],
                baseRadius: 0.48,
                aspectX: 1.32,
                aspectZ: 0.72,
                tendonStart: 0.16,
                tendonEnd: 0.22,
                bellyPower: 0.78,
                bellyBias: 0.44,
                maxBulge: 1.30,
                fascicleCount: 6,
                fascicleDepth: 0.055,
                uvU: 1
            });

            // 4. Pectoralis Major - Clavicular (Smooth contoured clavicular head bridging to humeral crest)
            this._registerSheetMuscle({
                id: `pectoralis_major_clavicular_${side}`,
                name: `Pectoralis Major - Clavicular (${sideTitle})`,
                region: 'chest',
                layer: 'superficial',
                side,
                strips: [
                    [
                        this._anchor(clavNode, [0.025, 1.402, 0.044], pClav, side),
                        this._thoraxAnchor(ribNode, [0.072, 1.382, 0.070], side),
                        this._anchor(humNode, [0.160, 1.338, 0.016], pHum, side),
                        this._anchor(humNode, [0.192, 1.304, -0.011], pHum, side)
                    ],
                    [
                        this._anchor(clavNode, [0.055, 1.399, 0.038], pClav, side),
                        this._thoraxAnchor(ribNode, [0.096, 1.376, 0.060], side),
                        this._anchor(humNode, [0.168, 1.342, 0.014], pHum, side),
                        this._anchor(humNode, [0.193, 1.310, -0.011], pHum, side)
                    ],
                    [
                        this._anchor(clavNode, [0.084, 1.398, 0.022], pClav, side),
                        this._thoraxAnchor(ribNode, [0.118, 1.370, 0.046], side),
                        this._anchor(humNode, [0.175, 1.344, 0.012], pHum, side),
                        this._anchor(humNode, [0.194, 1.316, -0.011], pHum, side)
                    ]
                ],
                subCols: 12,
                fascicleRidges: 3,
                ridgeDepth: 0.09,
                thickness: 0.34,
                tendonEnd: 0.22,
                maxBulge: 1.24,
                uvU: 0.65
            });

            // 5. Pectoralis Major - Sternocostal (Hugs curved ribcage barrel, sweeps up into anterior axillary fold)
            this._registerSheetMuscle({
                id: `pectoralis_major_sternocostal_${side}`,
                name: `Pectoralis Major - Sternocostal (${sideTitle})`,
                region: 'chest',
                layer: 'superficial',
                side,
                strips: [
                    [
                        this._thoraxAnchor(ribNode, [0.014, 1.368, 0.088], side),
                        this._thoraxAnchor(ribNode, [0.084, 1.356, 0.080], side),
                        this._thoraxAnchor(ribNode, [0.132, 1.340, 0.048], side),
                        this._anchor(humNode, [0.192, 1.305, -0.011], pHum, side)
                    ],
                    [
                        this._thoraxAnchor(ribNode, [0.012, 1.326, 0.096], side),
                        this._thoraxAnchor(ribNode, [0.088, 1.320, 0.086], side),
                        this._thoraxAnchor(ribNode, [0.136, 1.324, 0.044], side),
                        this._anchor(humNode, [0.193, 1.311, -0.011], pHum, side)
                    ],
                    [
                        this._thoraxAnchor(ribNode, [0.012, 1.284, 0.102], side),
                        this._thoraxAnchor(ribNode, [0.092, 1.286, 0.088], side),
                        this._thoraxAnchor(ribNode, [0.138, 1.312, 0.036], side),
                        this._anchor(humNode, [0.193, 1.317, -0.011], pHum, side)
                    ],
                    [
                        this._thoraxAnchor(ribNode, [0.022, 1.242, 0.098], side),
                        this._thoraxAnchor(ribNode, [0.095, 1.256, 0.078], side),
                        this._thoraxAnchor(ribNode, [0.142, 1.302, 0.026], side),
                        this._anchor(humNode, [0.194, 1.323, -0.011], pHum, side)
                    ]
                ],
                subCols: 22,
                fascicleRidges: 6,
                ridgeDepth: 0.12,
                thickness: 0.42,
                tendonEnd: 0.24,
                maxBulge: 1.28,
                uvU: 1.25
            });

            // 6. Biceps Brachii (Long/Short head intermuscular cleft + fascicle ridges)
            this._registerTubeMuscle({
                id: `biceps_brachii_${side}`,
                name: `Biceps Brachii (${sideTitle})`,
                region: 'arm',
                layer: 'superficial',
                side,
                anchors: [
                    this._anchor(scapNode, [0.146, 1.390, -0.012], pScap, side),
                    this._anchor(humNode, [0.184, 1.335, -0.005], pHum, side),
                    this._anchor(humNode, [0.200, 1.235, -0.004], pHum, side),
                    this._anchor(humNode, [0.214, 1.135, -0.012], pHum, side),
                    this._anchor(radNode, [0.238, 1.064, -0.019], pRad, side)
                ],
                baseRadius: 0.56,
                aspectX: 1.14,
                aspectZ: 0.96,
                tendonStart: 0.22,
                tendonEnd: 0.18,
                bellyPower: 0.82,
                bellyBias: 0.50,
                maxBulge: 1.48,
                fascicleCount: 8,
                fascicleDepth: 0.045,
                headCleft: 0.22,
                uvU: 1
            });

            // 7. Brachialis (Deep layer beneath Biceps Brachii)
            this._registerTubeMuscle({
                id: `brachialis_${side}`,
                name: `Brachialis (${sideTitle})`,
                region: 'arm',
                layer: 'deep',
                side,
                anchors: [
                    this._anchor(humNode, [0.198, 1.240, -0.024], pHum, side),
                    this._anchor(humNode, [0.208, 1.175, -0.018], pHum, side),
                    this._anchor(humNode, [0.212, 1.120, -0.022], pHum, side),
                    this._anchor(ulnNode, [0.216, 1.078, -0.024], pUln, side)
                ],
                baseRadius: 0.45,
                aspectX: 1.20,
                aspectZ: 0.72,
                tendonStart: 0.14,
                tendonEnd: 0.20,
                bellyPower: 0.80,
                maxBulge: 1.38,
                fascicleCount: 6,
                fascicleDepth: 0.040,
                uvU: 1
            });

            // 8. Triceps Brachii (Long + Lateral head posterior cleft)
            this._registerTubeMuscle({
                id: `triceps_brachii_${side}`,
                name: `Triceps Brachii (${sideTitle})`,
                region: 'arm',
                layer: 'superficial',
                side,
                anchors: [
                    this._anchor(scapNode, [0.146, 1.348, -0.050], pScap, side),
                    this._anchor(humNode, [0.191, 1.295, -0.048], pHum, side),
                    this._anchor(humNode, [0.205, 1.220, -0.052], pHum, side),
                    this._anchor(humNode, [0.211, 1.145, -0.054], pHum, side),
                    this._anchor(ulnNode, [0.213, 1.102, -0.052], pUln, side)
                ],
                baseRadius: 0.60,
                aspectX: 1.16,
                aspectZ: 0.90,
                tendonStart: 0.16,
                tendonEnd: 0.24,
                bellyPower: 0.76,
                bellyBias: 0.46,
                maxBulge: 1.38,
                fascicleCount: 8,
                fascicleDepth: 0.050,
                headCleft: 0.24,
                uvU: 1
            });

            // 9. Brachioradialis (Prominent lateral forearm contour hugging radius)
            this._registerTubeMuscle({
                id: `brachioradialis_${side}`,
                name: `Brachioradialis (${sideTitle})`,
                region: 'forearm',
                layer: 'superficial',
                side,
                anchors: [
                    this._anchor(humNode, [0.232, 1.142, -0.030], pHum, side),
                    this._anchor(radNode, [0.248, 1.078, -0.010], pRad, side),
                    this._anchor(radNode, [0.262, 1.005, 0.004], pRad, side),
                    this._anchor(radNode, [0.274, 0.928, 0.011], pRad, side),
                    this._anchor(radNode, [0.283, 0.866, 0.015], pRad, side)
                ],
                baseRadius: 0.42,
                aspectX: 0.94,
                aspectZ: 1.18,
                tendonStart: 0.12,
                tendonEnd: 0.42,
                bellyPower: 1.02,
                bellyBias: 0.30,
                maxBulge: 1.32,
                fascicleCount: 6,
                fascicleDepth: 0.042,
                uvU: 1
            });

            // 10. Flexor Carpi Radialis (Superficial medial-to-radial forearm flexor)
            this._registerTubeMuscle({
                id: `flexor_carpi_radialis_${side}`,
                name: `Flexor Carpi Radialis (${sideTitle})`,
                region: 'forearm',
                layer: 'superficial',
                side,
                anchors: [
                    this._anchor(humNode, [0.188, 1.104, -0.032], pHum, side),
                    this._anchor(ulnNode, [0.218, 1.045, -0.010], pUln, side),
                    this._anchor(radNode, [0.248, 0.975, 0.013], pRad, side),
                    this._anchor(handNode, [0.270, 0.855, 0.022], pWr, side)
                ],
                baseRadius: 0.38,
                aspectX: 1.12,
                aspectZ: 0.86,
                tendonStart: 0.12,
                tendonEnd: 0.44,
                bellyPower: 1.04,
                bellyBias: 0.30,
                maxBulge: 1.28,
                fascicleCount: 6,
                fascicleDepth: 0.040,
                uvU: 1
            });

            // 11. Pronator Teres (Bridges medial epicondyle obliquely across anterior proximal radius)
            this._registerTubeMuscle({
                id: `pronator_teres_${side}`,
                name: `Pronator Teres (${sideTitle})`,
                region: 'forearm',
                layer: 'superficial',
                side,
                anchors: [
                    this._anchor(humNode, [0.188, 1.112, -0.030], pHum, side),
                    this._anchor(ulnNode, [0.215, 1.060, -0.014], pUln, side),
                    this._anchor(radNode, [0.244, 0.998, -0.002], pRad, side)
                ],
                baseRadius: 0.36,
                aspectX: 1.18,
                aspectZ: 0.78,
                tendonStart: 0.16,
                tendonEnd: 0.22,
                bellyPower: 0.85,
                bellyBias: 0.46,
                maxBulge: 1.30,
                fascicleCount: 5,
                fascicleDepth: 0.038,
                uvU: 1
            });
        }

        this.torso.rootGroup.updateMatrixWorld(true);
        this.initializeRestLengths();
        this.update();
    }

    _registerTubeMuscle(cfg) {
        const radialSegs = 28;
        const lengthSegs = 26;
        const ringStride = radialSegs + 1;
        const vertCount = (lengthSegs + 1) * ringStride;

        const positions = new Float32Array(vertCount * 3);
        const colors = new Float32Array(vertCount * 3);
        const uvs = new Float32Array(vertCount * 2);
        const indices = [];

        const uvRepeatU = cfg.uvU ?? 1;
        for (let i = 0; i <= lengthSegs; i++) {
            const v = i / lengthSegs;
            for (let j = 0; j <= radialSegs; j++) {
                const u = (j / radialSegs) * uvRepeatU;
                const idx = i * ringStride + j;
                uvs[idx * 2] = u;
                uvs[idx * 2 + 1] = v;
            }
        }

        for (let i = 0; i < lengthSegs; i++) {
            for (let j = 0; j < radialSegs; j++) {
                const a = i * ringStride + j;
                const b = (i + 1) * ringStride + j;
                const c = (i + 1) * ringStride + (j + 1);
                const d = i * ringStride + (j + 1);
                indices.push(a, b, d);
                indices.push(b, c, d);
            }
        }

        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        geom.setIndex(indices);

        const mesh = new THREE.Mesh(geom, this.baseMaterial);
        mesh.name = `Muscle_${cfg.id}`;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.muscleId = cfg.id;
        mesh.userData.muscleName = cfg.name;
        mesh.userData.muscleLayer = cfg.layer;
        mesh.userData.muscleRegion = cfg.region;

        this.muscleGroup.add(mesh);

        const entry = {
            kind: 'tube',
            cfg,
            mesh,
            geom,
            positions,
            colors,
            radialSegs,
            lengthSegs,
            restLength: null,
            peeled: false,
            worldPts: cfg.anchors.map(() => new THREE.Vector3())
        };
        this.muscles.push(entry);
        this.muscleById.set(cfg.id, entry);
    }

    _registerSheetMuscle(cfg) {
        const cols = cfg.subCols || 18;
        const lengthSegs = 18;
        const rows = lengthSegs + 1;
        const halfVerts = rows * cols;
        const vertCount = halfVerts * 2;

        const positions = new Float32Array(vertCount * 3);
        const colors = new Float32Array(vertCount * 3);
        const uvs = new Float32Array(vertCount * 2);
        const indices = [];

        const uvRepeatU = cfg.uvU ?? 1.0;
        for (let r = 0; r < rows; r++) {
            const v = r / lengthSegs;
            for (let c = 0; c < cols; c++) {
                const u = (c / (cols - 1)) * uvRepeatU;
                const idxF = r * cols + c;
                const idxB = halfVerts + idxF;
                uvs[idxF * 2] = u;
                uvs[idxF * 2 + 1] = v;
                uvs[idxB * 2] = u;
                uvs[idxB * 2 + 1] = v;
            }
        }

        for (let r = 0; r < rows - 1; r++) {
            for (let c = 0; c < cols - 1; c++) {
                const a = r * cols + c;
                const b = (r + 1) * cols + c;
                const d = r * cols + (c + 1);
                const e = (r + 1) * cols + (c + 1);
                indices.push(a, b, d, b, e, d);

                const ab = halfVerts + a;
                const bb = halfVerts + b;
                const db = halfVerts + d;
                const eb = halfVerts + e;
                indices.push(ab, db, bb, bb, db, eb);
            }
        }
        for (let r = 0; r < rows - 1; r++) {
            const l0 = r * cols, l1 = (r + 1) * cols;
            indices.push(l0, halfVerts + l0, l1, l1, halfVerts + l0, halfVerts + l1);

            const r0 = r * cols + (cols - 1), r1 = (r + 1) * cols + (cols - 1);
            indices.push(r0, r1, halfVerts + r0, r1, halfVerts + r1, halfVerts + r0);
        }
        for (let c = 0; c < cols - 1; c++) {
            indices.push(c, c + 1, halfVerts + c, c + 1, halfVerts + c + 1, halfVerts + c);
            const lr = (rows - 1) * cols + c;
            indices.push(lr, halfVerts + lr, lr + 1, lr + 1, halfVerts + lr, halfVerts + lr + 1);
        }

        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        geom.setIndex(indices);

        const mesh = new THREE.Mesh(geom, this.baseMaterial);
        mesh.name = `Muscle_${cfg.id}`;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.muscleId = cfg.id;
        mesh.userData.muscleName = cfg.name;
        mesh.userData.muscleLayer = cfg.layer;
        mesh.userData.muscleRegion = cfg.region;

        this.muscleGroup.add(mesh);

        const entry = {
            kind: 'sheet',
            cfg,
            mesh,
            geom,
            positions,
            colors,
            stripCount: cfg.strips.length,
            subCols: cols,
            lengthSegs,
            restLengths: new Array(cfg.strips.length).fill(null),
            peeled: false,
            stripPts: cfg.strips.map(strip => strip.map(() => new THREE.Vector3())),
            transversePts: new Array(cols).fill(null).map(() => new THREE.Vector3())
        };
        this.muscles.push(entry);
        this.muscleById.set(cfg.id, entry);
    }

    _resolveAnchorInGroupSpace(anchor, targetVec) {
        if (!anchor.node) return targetVec.set(0, 0, 0);
        targetVec.copy(anchor.localPos);
        anchor.node.localToWorld(targetVec);
        this.muscleGroup.worldToLocal(targetVec);
        return targetVec;
    }

    initializeRestLengths() {
        for (const m of this.muscles) {
            if (m.kind === 'tube') {
                const pts = m.worldPts;
                m.cfg.anchors.forEach((a, i) => this._resolveAnchorInGroupSpace(a, pts[i]));
                const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.45);
                m.restLength = Math.max(0.5, curve.getLength());
            } else {
                for (let s = 0; s < m.stripCount; s++) {
                    const pts = m.stripPts[s];
                    m.cfg.strips[s].forEach((a, i) => this._resolveAnchorInGroupSpace(a, pts[i]));
                    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.45);
                    m.restLengths[s] = Math.max(0.5, curve.getLength());
                }
            }
        }
    }

    update() {
        if (!this.visible) return;
        this.torso.rootGroup.updateMatrixWorld(true);

        const genderRadiusGain = (this.torso.currentGender === 'male')
            ? 1.12
            : (this.torso.currentGender === 'female' ? 0.90 : 1.0);
        const genderGrooveGain = (this.torso.currentGender === 'male') ? 1.18 : 0.92;

        for (const m of this.muscles) {
            if (m.peeled || !m.mesh.visible) continue;
            if (m.kind === 'tube') {
                this._updateTubeMuscle(m, genderRadiusGain, genderGrooveGain);
            } else {
                this._updateSheetMuscle(m, genderRadiusGain, genderGrooveGain);
            }
        }
    }

    _updateTubeMuscle(m, genderRadiusGain, genderGrooveGain) {
        const { cfg, worldPts, positions, colors, radialSegs, lengthSegs } = m;
        for (let i = 0; i < cfg.anchors.length; i++) {
            this._resolveAnchorInGroupSpace(cfg.anchors[i], worldPts[i]);
        }

        const curve = new THREE.CatmullRomCurve3(worldPts, false, 'centripetal', 0.45);
        const curLen = Math.max(0.3, curve.getLength());
        const restLen = m.restLength || curLen;

        const rawVolumeBulge = Math.sqrt(clamp(restLen / curLen, 0.58, cfg.maxBulge * cfg.maxBulge));
        const contractionGlow = clamp((rawVolumeBulge - 1.0) * 1.35, 0, 0.30);

        const ringStride = radialSegs + 1;
        const tangent = new THREE.Vector3();
        const normal = new THREE.Vector3();
        const binormal = new THREE.Vector3();
        const prevTangent = new THREE.Vector3();
        const qAlign = new THREE.Quaternion();

        const tStart = cfg.tendonStart ?? 0.16;
        const tEnd = cfg.tendonEnd ?? 0.20;
        const bellyBias = cfg.bellyBias ?? 0.50;
        const bellyPow = cfg.bellyPower ?? 0.85;
        const fascicleCount = cfg.fascicleCount ?? 6;
        const fascicleDepth = (cfg.fascicleDepth ?? 0.045) * genderGrooveGain;
        const headCleft = (cfg.headCleft ?? 0.0) * genderGrooveGain;

        for (let i = 0; i <= lengthSegs; i++) {
            const t = i / lengthSegs;
            const center = curve.getPointAt(t, this._tmpVecA);
            curve.getTangentAt(t, tangent).normalize();

            if (i === 0) {
                const refUp = (Math.abs(tangent.z) < 0.85) ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
                binormal.crossVectors(tangent, refUp).normalize();
                normal.crossVectors(binormal, tangent).normalize();
            } else {
                qAlign.setFromUnitVectors(prevTangent, tangent);
                normal.applyQuaternion(qAlign).normalize();
                binormal.crossVectors(tangent, normal).normalize();
            }
            prevTangent.copy(tangent);

            const uShaped = (t <= bellyBias)
                ? (0.5 * (t / Math.max(0.05, bellyBias)))
                : (0.5 + 0.5 * ((t - bellyBias) / Math.max(0.05, 1.0 - bellyBias)));
            const env = Math.pow(Math.max(0.001, Math.sin(Math.PI * clamp(uShaped, 0.001, 0.999))), bellyPow);

            let muscleBlend = 1.0;
            if (t < tStart) {
                muscleBlend = THREE.MathUtils.smoothstep(t, 0.0, tStart);
            } else if (t > 1.0 - tEnd) {
                muscleBlend = 1.0 - THREE.MathUtils.smoothstep(t, 1.0 - tEnd, 1.0);
            }

            const dynamicBulge = 1.0 + (rawVolumeBulge - 1.0) * env;
            const rBase = cfg.baseRadius * genderRadiusGain * (0.24 + 0.76 * env) * dynamicBulge;
            const rx = rBase * (cfg.aspectX ?? 1.0);
            const rz = rBase * (cfg.aspectZ ?? 1.0);

            this._tmpColor.copy(this._colorTendon).lerp(this._colorBelly, muscleBlend);
            if (contractionGlow > 0.01 && muscleBlend > 0.3) {
                this._tmpColor.offsetHSL(0.0, contractionGlow * 0.12, contractionGlow * 0.08);
            }

            for (let j = 0; j <= radialSegs; j++) {
                const theta = (j / radialSegs) * Math.PI * 2;

                // 3D 立體肌束圓拱凹溝 (從剖面幾何直接刻出平行肌束起伏)
                const fascicleArch = Math.pow(Math.abs(Math.sin(theta * fascicleCount * 0.5)), 0.55);
                let profileMod = 1.0 + fascicleDepth * muscleBlend * (fascicleArch - 0.55);

                // 若為雙頭肌 (如 Biceps / Triceps)，在前後中線刻出深層肌頭分界溝
                if (headCleft > 0.001) {
                    const cleftFactor = Math.exp(-Math.pow(Math.sin(theta), 2) * 14.0);
                    profileMod *= (1.0 - headCleft * muscleBlend * cleftFactor);
                }

                const cx = Math.cos(theta) * rx * profileMod;
                const cz = Math.sin(theta) * rz * profileMod;

                const idx = i * ringStride + j;
                positions[idx * 3] = center.x + normal.x * cx + binormal.x * cz;
                positions[idx * 3 + 1] = center.y + normal.y * cx + binormal.y * cz;
                positions[idx * 3 + 2] = center.z + normal.z * cx + binormal.z * cz;

                // 束間微環境光遮蔽 (AO)，深化溝槽立體感
                const aoShade = 0.86 + 0.14 * fascicleArch;
                const cleftAO = (headCleft > 0.001)
                    ? (1.0 - 0.22 * headCleft * muscleBlend * Math.exp(-Math.pow(Math.sin(theta), 2) * 14.0))
                    : 1.0;
                const shade = aoShade * cleftAO;
                colors[idx * 3] = clamp(this._tmpColor.r * shade, 0, 1);
                colors[idx * 3 + 1] = clamp(this._tmpColor.g * shade, 0, 1);
                colors[idx * 3 + 2] = clamp(this._tmpColor.b * shade, 0, 1);
            }
        }

        m.geom.attributes.position.needsUpdate = true;
        m.geom.attributes.color.needsUpdate = true;
        m.geom.computeVertexNormals();

        // 縫合圓柱 UV 接縫處 (j=0 與 j=radialSegs) 的頂點法線，消除背後接縫線
        const normAttr = m.geom.attributes.normal;
        for (let i = 0; i <= lengthSegs; i++) {
            const i0 = i * ringStride;
            const iN = i0 + radialSegs;
            const nx = normAttr.array[i0 * 3] + normAttr.array[iN * 3];
            const ny = normAttr.array[i0 * 3 + 1] + normAttr.array[iN * 3 + 1];
            const nz = normAttr.array[i0 * 3 + 2] + normAttr.array[iN * 3 + 2];
            const nl = Math.hypot(nx, ny, nz) || 1.0;
            normAttr.array[i0 * 3] = normAttr.array[iN * 3] = nx / nl;
            normAttr.array[i0 * 3 + 1] = normAttr.array[iN * 3 + 1] = ny / nl;
            normAttr.array[i0 * 3 + 2] = normAttr.array[iN * 3 + 2] = nz / nl;
        }
        normAttr.needsUpdate = true;
        m.geom.computeBoundingSphere();
    }

    _updateSheetMuscle(m, genderRadiusGain, genderGrooveGain) {
        const { cfg, stripPts, positions, colors, stripCount, subCols, lengthSegs } = m;
        const rows = lengthSegs + 1;
        const cols = subCols;
        const halfVerts = rows * cols;
        const tEnd = cfg.tendonEnd ?? 0.22;
        const fascicleRidges = cfg.fascicleRidges ?? 5;
        const ridgeDepth = (cfg.ridgeDepth ?? 0.11) * genderGrooveGain;

        const stripLines = [];
        const stripBulges = [];
        for (let s = 0; s < stripCount; s++) {
            const pts = stripPts[s];
            for (let k = 0; k < cfg.strips[s].length; k++) {
                this._resolveAnchorInGroupSpace(cfg.strips[s][k], pts[k]);
            }
            const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.45);
            const curLen = Math.max(0.3, curve.getLength());
            const restLen = m.restLengths[s] || curLen;
            stripBulges.push(Math.sqrt(clamp(restLen / curLen, 0.62, cfg.maxBulge * cfg.maxBulge)));

            const line = [];
            for (let r = 0; r < rows; r++) {
                line.push(curve.getPointAt(r / lengthSegs));
            }
            stripLines.push(line);
        }

        // 每個縱向分段 r 都先橫向三次樣條細分成 subCols 列，使胸大肌平滑包覆胸廓弧面並刻出放射狀肌束脊
        const gridPts = [];
        for (let r = 0; r < rows; r++) {
            const ctrl = stripLines.map(line => line[r]);
            const transCurve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal', 0.45);
            const rowPts = [];
            for (let c = 0; c < cols; c++) {
                rowPts.push(transCurve.getPointAt(c / (cols - 1)));
            }
            gridPts.push(rowPts);
        }

        const avgBulge = stripBulges.reduce((a, b) => a + b, 0) / stripBulges.length;
        const dirU = new THREE.Vector3();
        const dirV = new THREE.Vector3();
        const surfN = new THREE.Vector3();

        for (let r = 0; r < rows; r++) {
            const t = r / lengthSegs;
            const env = Math.pow(Math.max(0.01, Math.sin(Math.PI * clamp(t, 0.01, 0.99))), 0.62);

            let muscleBlend = 1.0;
            if (t < 0.08) {
                muscleBlend = THREE.MathUtils.smoothstep(t, 0.0, 0.08);
            } else if (t > 1.0 - tEnd) {
                muscleBlend = 1.0 - THREE.MathUtils.smoothstep(t, 1.0 - tEnd, 1.0);
            }

            for (let c = 0; c < cols; c++) {
                const uNorm = c / (cols - 1);
                const pt = gridPts[r][c];

                // 扇形放射肌束立體拱起：在胸肌表面刻出明顯一束束的圓拱肌束與束間溝槽
                const fascicleArch = Math.pow(Math.abs(Math.sin(uNorm * fascicleRidges * Math.PI)), 0.55);
                // 邊緣微收斂柔和化，避免生硬切邊
                const edgeTaper = 0.72 + 0.28 * Math.sin(uNorm * Math.PI);

                const bulge = 1.0 + (avgBulge - 1.0) * env;
                const baseThick = cfg.thickness * 0.5 * genderRadiusGain * (0.28 + 0.72 * env) * bulge * edgeTaper;
                const ridgeOffset = baseThick * (1.0 + ridgeDepth * muscleBlend * (fascicleArch - 0.35));

                const ptPrevU = gridPts[Math.max(0, r - 1)][c];
                const ptNextU = gridPts[Math.min(rows - 1, r + 1)][c];
                dirU.subVectors(ptNextU, ptPrevU).normalize();

                const ptPrevV = gridPts[r][Math.max(0, c - 1)];
                const ptNextV = gridPts[r][Math.min(cols - 1, c + 1)];
                dirV.subVectors(ptNextV, ptPrevV).normalize();

                surfN.crossVectors(dirU, dirV);
                if (surfN.lengthSq() < 1e-6) {
                    surfN.set(0, 0, 1);
                } else {
                    surfN.normalize();
                    if (surfN.z < 0) surfN.negate();
                }

                const idxF = r * cols + c;
                const idxB = halfVerts + idxF;

                positions[idxF * 3] = pt.x + surfN.x * ridgeOffset * 1.18;
                positions[idxF * 3 + 1] = pt.y + surfN.y * ridgeOffset * 1.18;
                positions[idxF * 3 + 2] = pt.z + surfN.z * ridgeOffset * 1.18;

                positions[idxB * 3] = pt.x - surfN.x * baseThick * 0.42;
                positions[idxB * 3 + 1] = pt.y - surfN.y * baseThick * 0.42;
                positions[idxB * 3 + 2] = pt.z - surfN.z * baseThick * 0.42;

                const aoShade = 0.84 + 0.16 * fascicleArch;
                this._tmpColor.copy(this._colorTendon).lerp(this._colorBelly, muscleBlend);
                colors[idxF * 3] = clamp(this._tmpColor.r * aoShade, 0, 1);
                colors[idxF * 3 + 1] = clamp(this._tmpColor.g * aoShade, 0, 1);
                colors[idxF * 3 + 2] = clamp(this._tmpColor.b * aoShade, 0, 1);

                this._tmpColor.copy(this._colorTendon).lerp(this._colorBellyDeep, muscleBlend);
                colors[idxB * 3] = this._tmpColor.r;
                colors[idxB * 3 + 1] = this._tmpColor.g;
                colors[idxB * 3 + 2] = this._tmpColor.b;
            }
        }

        m.geom.attributes.position.needsUpdate = true;
        m.geom.attributes.color.needsUpdate = true;
        m.geom.computeVertexNormals();
        m.geom.computeBoundingSphere();
    }

    setVisible(visible) {
        this.visible = Boolean(visible);
        this.muscleGroup.visible = this.visible;
        if (this.visible) {
            this.update();
        }
    }

    setOpacity(opacity) {
        this.opacity = clamp(opacity, 0.08, 1.0);
        this.baseMaterial.opacity = this.opacity;
        this.selectedMaterial.opacity = this.opacity;
    }

    selectMuscleById(muscleId = null) {
        this.selectedMuscleId = muscleId;
        for (const m of this.muscles) {
            m.mesh.material = (muscleId && m.cfg.id === muscleId)
                ? this.selectedMaterial
                : this.baseMaterial;
        }
    }

    peelMuscle(muscleId) {
        const entry = this.muscleById.get(muscleId);
        if (!entry || entry.peeled) return null;
        entry.peeled = true;
        entry.mesh.visible = false;
        this.peeledHistory.push(muscleId);
        if (this.selectedMuscleId === muscleId) {
            this.selectMuscleById(null);
        }
        return entry.cfg.name;
    }

    undoPeel() {
        while (this.peeledHistory.length > 0) {
            const id = this.peeledHistory.pop();
            const entry = this.muscleById.get(id);
            if (entry && entry.peeled) {
                entry.peeled = false;
                entry.mesh.visible = true;
                this.update();
                return entry.cfg.name;
            }
        }
        return null;
    }

    restoreAll() {
        this.peeledHistory = [];
        for (const m of this.muscles) {
            m.peeled = false;
            m.mesh.visible = true;
        }
        this.selectMuscleById(null);
        this.update();
    }

    peelSuperficial() {
        for (const m of this.muscles) {
            if (m.cfg.layer === 'superficial' && !m.peeled) {
                m.peeled = true;
                m.mesh.visible = false;
                this.peeledHistory.push(m.cfg.id);
            }
        }
        this.selectMuscleById(null);
    }

    getStats() {
        const total = this.muscles.length;
        const peeled = this.muscles.filter(m => m.peeled).length;
        return { total, peeled, remaining: total - peeled };
    }
}
