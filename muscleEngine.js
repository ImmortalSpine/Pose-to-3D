/**
 * AnatoPose 3D - Procedural Anatomical Muscle Engine (Phase 1: Upper Limb & Chest)
 *
 * 附著於 206 塊醫學級骨骼系統之程式化動態肌肉系統：
 * 1. 每塊肌肉透過骨骼起止點 (Origin / Insertion) 與繞行點 (Via-Points) 直接錨定至對應關節群組，
 *    在擺姿、男女體態切換與前臂旋前/旋後時與骨骼即時連動、不穿模。
 * 2. 採用體積守恆伸縮形變 (Volume-Preserving Bulge: radius ∝ sqrt(L0 / L))：
 *    關節屈曲縮短時肌腹自然膨脹隆起，伸展拉長時自然收細貼骨。
 * 3. 支援表層 (superficial) / 深層 (deep) 分層、滑鼠單塊點擊剝除、還原與半透明檢視。
 * 4. 依規範全數採用純英文解剖學名稱 (English Anatomical Nomenclature)。
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

        this.baseMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            vertexColors: true,
            roughness: 0.42,
            metalness: 0.05,
            transparent: true,
            opacity: this.opacity,
            side: THREE.DoubleSide
        });

        this.selectedMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            vertexColors: true,
            emissive: 0xff8c42,
            emissiveIntensity: 0.45,
            roughness: 0.30,
            metalness: 0.08,
            transparent: true,
            opacity: this.opacity,
            side: THREE.DoubleSide
        });

        this._colorBelly = new THREE.Color(0xa9383c);
        this._colorBellyDeep = new THREE.Color(0x88292d);
        this._colorTendon = new THREE.Color(0xeae2d6);
        this._tmpColor = new THREE.Color();
        this._tmpVecA = new THREE.Vector3();
        this._tmpVecB = new THREE.Vector3();
        this._tmpVecC = new THREE.Vector3();

        this._buildUpperLimbAndChestMuscles();
    }

    /**
     * 將某個以左側 (+X) 定義的公尺座標，映射到指定側別與關節群組的局部座標
     */
    _anchor(node, ptLeftM, pivotLeftM, side, radiusHint = 1.0) {
        const sign = (side === 'left') ? 1 : -1;
        const ptM = mirrorX(ptLeftM, sign);
        const pivotM = mirrorX(pivotLeftM, sign);
        return {
            node,
            localPos: toLocalOffset(ptM, pivotM),
            radiusHint
        };
    }

    /**
     * 胸廓中軸點專用錨點 (Thorax origin X=0，依側別鏡像 X)
     */
    _thoraxAnchor(node, ptLeftM, side, radiusHint = 1.0) {
        const sign = (side === 'left') ? 1 : -1;
        const P = GLB_PIVOTS_M;
        return {
            node,
            localPos: toLocalOffset([sign * ptLeftM[0], ptLeftM[1], ptLeftM[2]], P.thoraxOrigin),
            radiusHint
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

            // 1. Deltoid - Anterior
            this._registerTubeMuscle({
                id: `deltoid_anterior_${side}`,
                name: `Deltoid - Anterior (${sideTitle})`,
                region: 'shoulder',
                layer: 'superficial',
                side,
                anchors: [
                    this._anchor(clavNode, [0.118, 1.412, -0.010], pClav, side),
                    this._anchor(humNode, [0.184, 1.385, 0.012], pHum, side),
                    this._anchor(humNode, [0.198, 1.320, 0.002], pHum, side),
                    this._anchor(humNode, [0.203, 1.267, -0.022], pHum, side)
                ],
                baseRadius: 0.44,
                aspectX: 1.25,
                aspectZ: 0.72,
                tendonStart: 0.14,
                tendonEnd: 0.22,
                bellyPower: 0.80,
                maxBulge: 1.30
            });

            // 2. Deltoid - Lateral
            this._registerTubeMuscle({
                id: `deltoid_lateral_${side}`,
                name: `Deltoid - Lateral (${sideTitle})`,
                region: 'shoulder',
                layer: 'superficial',
                side,
                anchors: [
                    this._anchor(scapNode, [0.166, 1.409, -0.044], pScap, side),
                    this._anchor(humNode, [0.205, 1.378, -0.025], pHum, side),
                    this._anchor(humNode, [0.208, 1.318, -0.028], pHum, side),
                    this._anchor(humNode, [0.205, 1.267, -0.032], pHum, side)
                ],
                baseRadius: 0.48,
                aspectX: 0.85,
                aspectZ: 1.28,
                tendonStart: 0.14,
                tendonEnd: 0.24,
                bellyPower: 0.78,
                maxBulge: 1.32
            });

            // 3. Deltoid - Posterior
            this._registerTubeMuscle({
                id: `deltoid_posterior_${side}`,
                name: `Deltoid - Posterior (${sideTitle})`,
                region: 'shoulder',
                layer: 'superficial',
                side,
                anchors: [
                    this._anchor(scapNode, [0.095, 1.382, -0.088], pScap, side),
                    this._anchor(humNode, [0.184, 1.378, -0.056], pHum, side),
                    this._anchor(humNode, [0.202, 1.315, -0.046], pHum, side),
                    this._anchor(humNode, [0.205, 1.267, -0.038], pHum, side)
                ],
                baseRadius: 0.44,
                aspectX: 1.20,
                aspectZ: 0.74,
                tendonStart: 0.16,
                tendonEnd: 0.22,
                bellyPower: 0.82,
                maxBulge: 1.30
            });

            // 4. Pectoralis Major - Clavicular
            this._registerSheetMuscle({
                id: `pectoralis_major_clavicular_${side}`,
                name: `Pectoralis Major - Clavicular (${sideTitle})`,
                region: 'chest',
                layer: 'superficial',
                side,
                strips: [
                    [
                        this._anchor(clavNode, [0.028, 1.402, 0.042], pClav, side),
                        this._thoraxAnchor(ribNode, [0.075, 1.378, 0.068], side),
                        this._anchor(humNode, [0.165, 1.340, 0.015], pHum, side),
                        this._anchor(humNode, [0.195, 1.305, -0.010], pHum, side)
                    ],
                    [
                        this._anchor(clavNode, [0.058, 1.398, 0.036], pClav, side),
                        this._thoraxAnchor(ribNode, [0.102, 1.372, 0.058], side),
                        this._anchor(humNode, [0.172, 1.342, 0.014], pHum, side),
                        this._anchor(humNode, [0.195, 1.312, -0.010], pHum, side)
                    ],
                    [
                        this._anchor(clavNode, [0.088, 1.398, 0.018], pClav, side),
                        this._thoraxAnchor(ribNode, [0.125, 1.368, 0.042], side),
                        this._anchor(humNode, [0.178, 1.344, 0.012], pHum, side),
                        this._anchor(humNode, [0.196, 1.318, -0.010], pHum, side)
                    ]
                ],
                thickness: 0.34,
                tendonEnd: 0.22,
                maxBulge: 1.26
            });

            // 5. Pectoralis Major - Sternocostal (Broad Contoured Chest Fan)
            this._registerSheetMuscle({
                id: `pectoralis_major_sternocostal_${side}`,
                name: `Pectoralis Major - Sternocostal (${sideTitle})`,
                region: 'chest',
                layer: 'superficial',
                side,
                strips: [
                    [
                        this._thoraxAnchor(ribNode, [0.014, 1.365, 0.090], side),
                        this._thoraxAnchor(ribNode, [0.088, 1.352, 0.082], side),
                        this._anchor(humNode, [0.155, 1.335, 0.022], pHum, side),
                        this._anchor(humNode, [0.195, 1.306, -0.011], pHum, side)
                    ],
                    [
                        this._thoraxAnchor(ribNode, [0.012, 1.320, 0.098], side),
                        this._thoraxAnchor(ribNode, [0.095, 1.315, 0.092], side),
                        this._anchor(humNode, [0.158, 1.328, 0.018], pHum, side),
                        this._anchor(humNode, [0.195, 1.312, -0.011], pHum, side)
                    ],
                    [
                        this._thoraxAnchor(ribNode, [0.012, 1.275, 0.106], side),
                        this._thoraxAnchor(ribNode, [0.098, 1.278, 0.096], side),
                        this._anchor(humNode, [0.160, 1.324, 0.015], pHum, side),
                        this._anchor(humNode, [0.195, 1.318, -0.011], pHum, side)
                    ],
                    [
                        this._thoraxAnchor(ribNode, [0.026, 1.234, 0.102], side),
                        this._thoraxAnchor(ribNode, [0.104, 1.248, 0.088], side),
                        this._anchor(humNode, [0.164, 1.320, 0.012], pHum, side),
                        this._anchor(humNode, [0.195, 1.324, -0.011], pHum, side)
                    ]
                ],
                thickness: 0.42,
                tendonEnd: 0.24,
                maxBulge: 1.28
            });

            // 6. Biceps Brachii (Superficial anterior arm, inserts on rotating radius)
            this._registerTubeMuscle({
                id: `biceps_brachii_${side}`,
                name: `Biceps Brachii (${sideTitle})`,
                region: 'arm',
                layer: 'superficial',
                side,
                anchors: [
                    this._anchor(scapNode, [0.146, 1.392, -0.012], pScap, side),
                    this._anchor(humNode, [0.182, 1.335, 0.002], pHum, side),
                    this._anchor(humNode, [0.200, 1.235, 0.006], pHum, side),
                    this._anchor(humNode, [0.214, 1.135, -0.006], pHum, side),
                    this._anchor(radNode, [0.238, 1.064, -0.019], pRad, side)
                ],
                baseRadius: 0.50,
                aspectX: 1.08,
                aspectZ: 0.90,
                tendonStart: 0.22,
                tendonEnd: 0.18,
                bellyPower: 0.85,
                maxBulge: 1.48
            });

            // 7. Brachialis (Deep layer beneath Biceps Brachii, inserts on ulna)
            this._registerTubeMuscle({
                id: `brachialis_${side}`,
                name: `Brachialis (${sideTitle})`,
                region: 'arm',
                layer: 'deep',
                side,
                anchors: [
                    this._anchor(humNode, [0.198, 1.240, -0.022], pHum, side),
                    this._anchor(humNode, [0.208, 1.175, -0.016], pHum, side),
                    this._anchor(humNode, [0.212, 1.120, -0.020], pHum, side),
                    this._anchor(ulnNode, [0.216, 1.078, -0.024], pUln, side)
                ],
                baseRadius: 0.42,
                aspectX: 1.16,
                aspectZ: 0.72,
                tendonStart: 0.14,
                tendonEnd: 0.20,
                bellyPower: 0.80,
                maxBulge: 1.38
            });

            // 8. Triceps Brachii (Superficial posterior arm, inserts on olecranon)
            this._registerTubeMuscle({
                id: `triceps_brachii_${side}`,
                name: `Triceps Brachii (${sideTitle})`,
                region: 'arm',
                layer: 'superficial',
                side,
                anchors: [
                    this._anchor(scapNode, [0.144, 1.348, -0.052], pScap, side),
                    this._anchor(humNode, [0.190, 1.295, -0.054], pHum, side),
                    this._anchor(humNode, [0.204, 1.220, -0.058], pHum, side),
                    this._anchor(humNode, [0.211, 1.145, -0.056], pHum, side),
                    this._anchor(ulnNode, [0.213, 1.102, -0.053], pUln, side)
                ],
                baseRadius: 0.54,
                aspectX: 1.12,
                aspectZ: 0.88,
                tendonStart: 0.16,
                tendonEnd: 0.24,
                bellyPower: 0.78,
                maxBulge: 1.38
            });

            // 9. Brachioradialis (Superficial lateral forearm, tracks radius rotation)
            this._registerTubeMuscle({
                id: `brachioradialis_${side}`,
                name: `Brachioradialis (${sideTitle})`,
                region: 'forearm',
                layer: 'superficial',
                side,
                anchors: [
                    this._anchor(humNode, [0.232, 1.140, -0.032], pHum, side),
                    this._anchor(radNode, [0.248, 1.080, -0.012], pRad, side),
                    this._anchor(radNode, [0.264, 1.005, 0.004], pRad, side),
                    this._anchor(radNode, [0.275, 0.928, 0.012], pRad, side),
                    this._anchor(radNode, [0.284, 0.866, 0.015], pRad, side)
                ],
                baseRadius: 0.34,
                aspectX: 0.90,
                aspectZ: 1.12,
                tendonStart: 0.14,
                tendonEnd: 0.36,
                bellyPower: 1.05,
                bellyBias: 0.34,
                maxBulge: 1.32
            });

            // 10. Flexor Carpi Radialis (Superficial anterior forearm flexor)
            this._registerTubeMuscle({
                id: `flexor_carpi_radialis_${side}`,
                name: `Flexor Carpi Radialis (${sideTitle})`,
                region: 'forearm',
                layer: 'superficial',
                side,
                anchors: [
                    this._anchor(humNode, [0.188, 1.104, -0.034], pHum, side),
                    this._anchor(ulnNode, [0.222, 1.050, -0.012], pUln, side),
                    this._anchor(radNode, [0.248, 0.975, 0.014], pRad, side),
                    this._anchor(handNode, [0.270, 0.855, 0.022], pWr, side)
                ],
                baseRadius: 0.28,
                aspectX: 1.08,
                aspectZ: 0.82,
                tendonStart: 0.14,
                tendonEnd: 0.38,
                bellyPower: 1.05,
                bellyBias: 0.34,
                maxBulge: 1.28
            });
        }

        // 在初始靜止姿態採集所有肌肉的解剖靜止長度 L0，並建構幾何體
        this.torso.rootGroup.updateMatrixWorld(true);
        this.initializeRestLengths();
        this.update();
    }

    _registerTubeMuscle(cfg) {
        const radialSegs = 14;
        const lengthSegs = 22;
        const ringStride = radialSegs + 1;
        const vertCount = (lengthSegs + 1) * ringStride;

        const positions = new Float32Array(vertCount * 3);
        const colors = new Float32Array(vertCount * 3);
        const indices = [];

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
        const stripCount = cfg.strips.length;
        const lengthSegs = 16;
        // 上下兩面封閉帶狀曲面 (前表面 + 深層背表面)
        const cols = stripCount;
        const rows = lengthSegs + 1;
        const halfVerts = rows * cols;
        const vertCount = halfVerts * 2;

        const positions = new Float32Array(vertCount * 3);
        const colors = new Float32Array(vertCount * 3);
        const indices = [];

        // 前表面 (front: 0 .. halfVerts-1) & 深層面 (back: halfVerts .. vertCount-1)
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
        // 左右側邊封口
        for (let r = 0; r < rows - 1; r++) {
            const l0 = r * cols, l1 = (r + 1) * cols;
            indices.push(l0, halfVerts + l0, l1, l1, halfVerts + l0, halfVerts + l1);

            const r0 = r * cols + (cols - 1), r1 = (r + 1) * cols + (cols - 1);
            indices.push(r0, r1, halfVerts + r0, r1, halfVerts + r1, halfVerts + r0);
        }
        // 起止兩端封口
        for (let c = 0; c < cols - 1; c++) {
            indices.push(c, c + 1, halfVerts + c, c + 1, halfVerts + c + 1, halfVerts + c);
            const lr = (rows - 1) * cols + c;
            indices.push(lr, halfVerts + lr, lr + 1, lr + 1, halfVerts + lr, halfVerts + lr + 1);
        }

        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
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
            stripCount,
            lengthSegs,
            restLengths: new Array(stripCount).fill(null),
            peeled: false,
            stripPts: cfg.strips.map(strip => strip.map(() => new THREE.Vector3()))
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

        for (const m of this.muscles) {
            if (m.peeled || !m.mesh.visible) continue;
            if (m.kind === 'tube') {
                this._updateTubeMuscle(m, genderRadiusGain);
            } else {
                this._updateSheetMuscle(m, genderRadiusGain);
            }
        }
    }

    _updateTubeMuscle(m, genderRadiusGain) {
        const { cfg, worldPts, positions, colors, radialSegs, lengthSegs } = m;
        for (let i = 0; i < cfg.anchors.length; i++) {
            this._resolveAnchorInGroupSpace(cfg.anchors[i], worldPts[i]);
        }

        const curve = new THREE.CatmullRomCurve3(worldPts, false, 'centripetal', 0.45);
        const curLen = Math.max(0.3, curve.getLength());
        const restLen = m.restLength || curLen;

        // 體積守恆伸縮膨脹：縮短時隆起 (sqrt(L0 / L))，拉長時變細
        const rawVolumeBulge = Math.sqrt(clamp(restLen / curLen, 0.58, cfg.maxBulge * cfg.maxBulge));
        const contractionGlow = clamp((rawVolumeBulge - 1.0) * 1.4, 0, 0.35);

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

            // 偏移重心使其呈現自然肌腹偏峰（例如前臂近端飽滿、遠端肌腱細長）
            const uShaped = (t <= bellyBias)
                ? (0.5 * (t / Math.max(0.05, bellyBias)))
                : (0.5 + 0.5 * ((t - bellyBias) / Math.max(0.05, 1.0 - bellyBias)));
            const env = Math.pow(Math.max(0.001, Math.sin(Math.PI * clamp(uShaped, 0.001, 0.999))), bellyPow);

            // 肌腱漸變遮罩 (0 = 純肌腱端點, 1 = 純肌腹)
            let muscleBlend = 1.0;
            if (t < tStart) {
                muscleBlend = THREE.MathUtils.smoothstep(t, 0.0, tStart);
            } else if (t > 1.0 - tEnd) {
                muscleBlend = 1.0 - THREE.MathUtils.smoothstep(t, 1.0 - tEnd, 1.0);
            }

            // 肌肉中段吃滿體積膨脹，兩端肌腱收窄貼緊骨點
            const dynamicBulge = 1.0 + (rawVolumeBulge - 1.0) * env;
            const rBase = cfg.baseRadius * genderRadiusGain * (0.24 + 0.76 * env) * dynamicBulge;
            const rx = rBase * (cfg.aspectX ?? 1.0);
            const rz = rBase * (cfg.aspectZ ?? 1.0);

            // 肌腹紅棕 vs 肌腱乳白漸層
            this._tmpColor.copy(this._colorTendon).lerp(this._colorBelly, muscleBlend);
            if (contractionGlow > 0.01 && muscleBlend > 0.3) {
                this._tmpColor.offsetHSL(0.0, contractionGlow * 0.15, contractionGlow * 0.10);
            }

            for (let j = 0; j <= radialSegs; j++) {
                const theta = (j / radialSegs) * Math.PI * 2;
                // 輕微肌纖維縱向條紋凹凸感
                const striation = 1.0 + 0.035 * muscleBlend * Math.sin(theta * 5.0);
                const cx = Math.cos(theta) * rx * striation;
                const cz = Math.sin(theta) * rz * striation;

                const vx = center.x + normal.x * cx + binormal.x * cz;
                const vy = center.y + normal.y * cx + binormal.y * cz;
                const vz = center.z + normal.z * cx + binormal.z * cz;

                const idx = i * ringStride + j;
                positions[idx * 3] = vx;
                positions[idx * 3 + 1] = vy;
                positions[idx * 3 + 2] = vz;

                const shade = 0.90 + 0.10 * Math.cos(theta * 5.0);
                colors[idx * 3] = clamp(this._tmpColor.r * shade, 0, 1);
                colors[idx * 3 + 1] = clamp(this._tmpColor.g * shade, 0, 1);
                colors[idx * 3 + 2] = clamp(this._tmpColor.b * shade, 0, 1);
            }
        }

        m.geom.attributes.position.needsUpdate = true;
        m.geom.attributes.color.needsUpdate = true;
        m.geom.computeVertexNormals();
        m.geom.computeBoundingSphere();
    }

    _updateSheetMuscle(m, genderRadiusGain) {
        const { cfg, stripPts, positions, colors, stripCount, lengthSegs } = m;
        const rows = lengthSegs + 1;
        const cols = stripCount;
        const halfVerts = rows * cols;
        const tEnd = cfg.tendonEnd ?? 0.22;

        // 先取樣每一條肌束曲線座標與伸縮比
        const sampled = [];
        for (let c = 0; c < cols; c++) {
            const pts = stripPts[c];
            for (let k = 0; k < cfg.strips[c].length; k++) {
                this._resolveAnchorInGroupSpace(cfg.strips[c][k], pts[k]);
            }
            const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.45);
            const curLen = Math.max(0.3, curve.getLength());
            const restLen = m.restLengths[c] || curLen;
            const bulge = Math.sqrt(clamp(restLen / curLen, 0.62, cfg.maxBulge * cfg.maxBulge));

            const line = [];
            for (let r = 0; r < rows; r++) {
                const t = r / lengthSegs;
                line.push(curve.getPointAt(t));
            }
            sampled.push({ line, bulge });
        }

        const dirU = new THREE.Vector3();
        const dirV = new THREE.Vector3();
        const surfN = new THREE.Vector3();

        for (let r = 0; r < rows; r++) {
            const t = r / lengthSegs;
            const env = Math.pow(Math.max(0.01, Math.sin(Math.PI * clamp(t, 0.01, 0.99))), 0.65);

            let muscleBlend = 1.0;
            if (t < 0.08) {
                muscleBlend = THREE.MathUtils.smoothstep(t, 0.0, 0.08);
            } else if (t > 1.0 - tEnd) {
                muscleBlend = 1.0 - THREE.MathUtils.smoothstep(t, 1.0 - tEnd, 1.0);
            }

            for (let c = 0; c < cols; c++) {
                const pt = sampled[c].line[r];
                const bulge = 1.0 + (sampled[c].bulge - 1.0) * env;
                const halfThick = cfg.thickness * 0.5 * genderRadiusGain * (0.28 + 0.72 * env) * bulge;

                // 計算局部曲面法向量，讓前層往外凸、深層緊貼骨面
                const ptPrevU = sampled[c].line[Math.max(0, r - 1)];
                const ptNextU = sampled[c].line[Math.min(rows - 1, r + 1)];
                dirU.subVectors(ptNextU, ptPrevU).normalize();

                const ptPrevV = sampled[Math.max(0, c - 1)].line[r];
                const ptNextV = sampled[Math.min(cols - 1, c + 1)].line[r];
                dirV.subVectors(ptNextV, ptPrevV).normalize();

                surfN.crossVectors(dirU, dirV);
                if (surfN.lengthSq() < 1e-6) {
                    surfN.set(0, 0, 1);
                } else {
                    surfN.normalize();
                    // 確保法線主要朝向胸前 (+Z) 方向對齊左右一致性
                    if (surfN.z < 0 && cfg.side === 'left') surfN.negate();
                    if (surfN.z < 0 && cfg.side === 'right') surfN.negate();
                }

                const idxF = r * cols + c;
                const idxB = halfVerts + idxF;

                positions[idxF * 3] = pt.x + surfN.x * halfThick * 1.15;
                positions[idxF * 3 + 1] = pt.y + surfN.y * halfThick * 1.15;
                positions[idxF * 3 + 2] = pt.z + surfN.z * halfThick * 1.15;

                positions[idxB * 3] = pt.x - surfN.x * halfThick * 0.45;
                positions[idxB * 3 + 1] = pt.y - surfN.y * halfThick * 0.45;
                positions[idxB * 3 + 2] = pt.z - surfN.z * halfThick * 0.45;

                // 束狀肌纖維微色差
                const fiberVar = 0.94 + 0.06 * Math.sin(c * 2.1);
                this._tmpColor.copy(this._colorTendon).lerp(this._colorBelly, muscleBlend);
                colors[idxF * 3] = clamp(this._tmpColor.r * fiberVar, 0, 1);
                colors[idxF * 3 + 1] = clamp(this._tmpColor.g * fiberVar, 0, 1);
                colors[idxF * 3 + 2] = clamp(this._tmpColor.b * fiberVar, 0, 1);

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
