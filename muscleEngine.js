/**
 * AnatoPose 3D - Z-Anatomy Medical Muscle Engine (v11.0: Phase 1 Chest & Upper Limb)
 *
 * 混合架構 (Hybrid Z-Anatomy Mesh + Multi-Bone Joint-Localized Deformation)：
 * 1. 載入開源 Z-Anatomy 醫學解剖肌肉網格 (z-anatomy-muscles.glb, CC BY-SA 4.0)，
 *    精準對齊 206 塊醫學骨骼座標系 (1000 mm -> GLB_SCALE 28.0)。
 * 2. 依解剖關節樞紐鏈 (Ribcage / Clavicle / Scapula / Humerus / Ulna / Radius / Hand)
 *    執行關節局部過渡帶雙骨／三骨權重變形，讓兩端肌腱緊鎖骨面、肌腹緊貼骨幹不脫落、
 *    過關節處平滑滑動並加上骨幹防穿插半徑保護。
 * 3. 即時量測起止骨錨點弦長變化 L0 / L，對肌腹施加背離骨面的各向異性等體積膨脹，
 *    並配合依男女體態調整的表面厚度偏置 (不拉偏起止點)。
 * 4. 自動生成順應肌纖維走向（含胸大肌／三角肌放射狀扇形）之 UV 與程式化三合一肌束貼圖
 *    (Albedo + Bump + Roughness) 及肌腱乳白漸層頂點色。
 * 5. 支援單塊點擊剝除／還原／檢視純英文解剖學名稱。
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLB_SCALE, GLB_PIVOTS_M } from './medicalSkeletonLoader.js?v=9.0';
import { PHASE1_MUSCLE_TEMPLATES } from './medicalMuscleConfig.js?v=11.0';

const MM_TO_SCENE = GLB_SCALE * 0.001;

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

function mirrorM(pt, sign) {
    return [sign * pt[0], pt[1], pt[2]];
}

function mToScene(ptM) {
    const P = GLB_PIVOTS_M.pelvisOrigin;
    return new THREE.Vector3(
        (ptM[0] - P[0]) * GLB_SCALE,
        (ptM[1] - P[1]) * GLB_SCALE,
        (ptM[2] - P[2]) * GLB_SCALE
    );
}

/**
 * 程式化生成 512x512 無縫肌束纖維紋理組 (Albedo Map / Bump Map / Roughness Map)
 */
function createProceduralMuscleTextures() {
    const W = 512;
    const H = 512;
    const bundleCount = 14;

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

    const hash = (x, y) => {
        const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
        return s - Math.floor(s);
    };

    for (let y = 0; y < H; y++) {
        const v = y / H;
        const waveV = Math.sin(v * Math.PI * 2.0) * 0.5 + Math.cos(v * Math.PI * 6.0) * 0.5;

        for (let x = 0; x < W; x++) {
            const u = x / W;
            const warpU = u + 0.004 * waveV;

            const bundlePhase = warpU * bundleCount * Math.PI;
            const bundleArch = Math.pow(Math.abs(Math.sin(bundlePhase)), 0.55);

            const subPhase = warpU * (bundleCount * 5) * Math.PI;
            const subFiber = Math.pow(Math.abs(Math.sin(subPhase)), 0.68);

            const nFine = hash(Math.floor(warpU * 256), Math.floor(v * 32));
            const fasciaGlow = Math.pow(bundleArch, 2.4) * (0.05 + 0.08 * nFine);

            const lum = clamp(0.50 + 0.34 * bundleArch + 0.12 * subFiber + fasciaGlow, 0.34, 1.0);
            const rVal = Math.round(clamp(lum * 255, 0, 255));
            const gVal = Math.round(clamp((lum * 0.91 - (1.0 - bundleArch) * 0.07) * 255, 0, 255));
            const bVal = Math.round(clamp((lum * 0.91 - (1.0 - bundleArch) * 0.05) * 255, 0, 255));

            const bumpH = clamp(0.14 + 0.64 * bundleArch + 0.18 * subFiber + 0.04 * nFine, 0, 1);
            const bByte = Math.round(bumpH * 255);

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

/**
 * 點 p 到線段 ab 之間的最短向量 (fromClosestToP) 與最近距離
 */
function closestPointOnSegment(px, py, pz, ax, ay, az, bx, by, bz, outVec) {
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const lenSq = abx * abx + aby * aby + abz * abz;
    let u = 0;
    if (lenSq > 1e-8) {
        u = clamp(((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / lenSq, 0, 1);
    }
    const cx = ax + abx * u, cy = ay + aby * u, cz = az + abz * u;
    const dx = px - cx, dy = py - cy, dz = pz - cz;
    outVec.x = dx;
    outVec.y = dy;
    outVec.z = dz;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export class AnatomicalMuscleSystem {
    constructor(anatomicalTorso) {
        this.torso = anatomicalTorso;
        this.muscleGroup = new THREE.Group();
        this.muscleGroup.name = 'AnatomicalMuscles_Group';

        this.visible = true;
        this.opacity = 0.96;
        this.selectedMuscleId = null;
        this.isLoaded = false;

        this.muscles = [];
        this.muscleById = new Map();
        this.peeledHistory = [];

        this.textures = createProceduralMuscleTextures();

        this.baseMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            map: this.textures.albedoMap,
            bumpMap: this.textures.bumpMap,
            bumpScale: 0.16,
            roughnessMap: this.textures.roughnessMap,
            roughness: 0.85,
            metalness: 0.04,
            vertexColors: true,
            transparent: true,
            opacity: this.opacity,
            side: THREE.DoubleSide
        });

        this.selectedMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            map: this.textures.albedoMap,
            bumpMap: this.textures.bumpMap,
            bumpScale: 0.18,
            roughnessMap: this.textures.roughnessMap,
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
        this._colorTendon = new THREE.Color(0xf0e7da);

        this._onReadyCallbacks = [];

        this.readyPromise = this._loadMedicalMusclesGLB('./z-anatomy-muscles.glb');
    }

    onLoaded(cb) {
        if (this.isLoaded) {
            cb(this);
        } else if (typeof cb === 'function') {
            this._onReadyCallbacks.push(cb);
        }
    }

    _getBoneNode(role, side) {
        const sg = this.torso.shoulderGirdle[side];
        if (!sg) return null;
        switch (role) {
            case 'ribcage': return this.torso.ribcageGroup;
            case 'clavicle': return sg.clavicleScaleGroup;
            case 'scapula': return sg.scapulaMesh;
            case 'humerus': return sg.humerusCaliber;
            case 'ulna': return sg.forearmAlign;
            case 'radius': return sg.radiusAlign;
            case 'hand': return sg.handAlign;
            default: return null;
        }
    }

    /**
     * 取得與 anatomy.js _mountMesh() 100% 一致的原始公尺樞紐點 (含 qAlignArm / qAlignFore 未拉直前的原生空間)
     */
    _getBonePivotM(role, side) {
        const sign = (side === 'left') ? 1 : -1;
        const P = GLB_PIVOTS_M;
        switch (role) {
            case 'ribcage': return P.thoraxOrigin;
            case 'clavicle': return [sign * P.claviclePivotX, P.claviclePivotY, P.claviclePivotZ];
            case 'scapula': return [sign * P.scapulaPivotX, P.scapulaPivotY, P.scapulaPivotZ];
            case 'humerus': return [sign * P.shoulderPivotX, P.shoulderPivotY, P.shoulderPivotZ];
            case 'ulna': return [sign * P.elbowPivotX, P.elbowPivotY, P.elbowPivotZ];
            case 'radius': return [sign * P.radProxX, P.radProxY, P.radProxZ];
            case 'hand': return [sign * P.wristPivotX, P.wristPivotY, P.wristPivotZ];
            default: return P.pelvisOrigin;
        }
    }

    async _loadMedicalMusclesGLB(url) {
        try {
            const loader = new GLTFLoader();
            loader.setMeshoptDecoder(MeshoptDecoder);
            const gltf = await loader.loadAsync(url);
            gltf.scene.updateMatrixWorld(true);

            const nodeByName = new Map();
            gltf.scene.traverse(obj => {
                if (obj.isMesh && obj.name) {
                    nodeByName.set(obj.name, obj);
                }
            });

            for (const tmpl of PHASE1_MUSCLE_TEMPLATES) {
                this._mountZAnatomyMuscle(tmpl, 'left', nodeByName.get(tmpl.idLeft));
                this._mountZAnatomyMuscle(tmpl, 'right', nodeByName.get(tmpl.idRight));
            }

            this.isLoaded = true;
            this.update();

            console.log(`[AnatoPose] Z-Anatomy medical muscles loaded (${this.muscles.length} Phase-1 anatomical muscle heads).`);
            for (const cb of this._onReadyCallbacks) {
                try { cb(this); } catch (_) {}
            }
            this._onReadyCallbacks = [];
        } catch (err) {
            console.error('[AnatoPose] Failed to load z-anatomy-muscles.glb:', err);
        }
    }

    _mountZAnatomyMuscle(tmpl, side, srcMesh) {
        if (!srcMesh || !srcMesh.geometry) return;

        const sign = (side === 'left') ? 1 : -1;
        const sideLabel = (side === 'left') ? 'Left' : 'Right';
        const P = GLB_PIVOTS_M;

        const geom = srcMesh.geometry.clone();
        const posAttr = geom.getAttribute('position');
        const normAttr = geom.getAttribute('normal');
        if (!posAttr) return;

        const vertCount = posAttr.count;
        const mWorld = srcMesh.matrixWorld;
        const normalMat = new THREE.Matrix3().getNormalMatrix(mWorld);

        const pOrig = mToScene(mirrorM(tmpl.originM, sign));
        const pIns = mToScene(mirrorM(tmpl.insertM, sign));
        const vAxis = pIns.clone().sub(pOrig);
        const axisLen = Math.max(0.01, vAxis.length());
        vAxis.divideScalar(axisLen);

        // 先將毫米網格轉換為公尺座標與系統世界靜止座標系 (Scene Units, 以 pelvisOrigin 為零點)
        const restMeters = new Float32Array(vertCount * 3);
        const restPos = new Float32Array(vertCount * 3);
        const restNorm = new Float32Array(vertCount * 3);
        const projArr = new Float32Array(vertCount);
        const vTmp = new THREE.Vector3();
        const nTmp = new THREE.Vector3();

        let projMin = Infinity;
        let projMax = -Infinity;

        for (let i = 0; i < vertCount; i++) {
            vTmp.fromBufferAttribute(posAttr, i).applyMatrix4(mWorld);
            const mx = vTmp.x * 0.001;
            const my = vTmp.y * 0.001;
            const mz = vTmp.z * 0.001;
            restMeters[i * 3] = mx;
            restMeters[i * 3 + 1] = my;
            restMeters[i * 3 + 2] = mz;

            const sx = (mx - P.pelvisOrigin[0]) * GLB_SCALE;
            const sy = (my - P.pelvisOrigin[1]) * GLB_SCALE;
            const sz = (mz - P.pelvisOrigin[2]) * GLB_SCALE;
            restPos[i * 3] = sx;
            restPos[i * 3 + 1] = sy;
            restPos[i * 3 + 2] = sz;

            if (normAttr) {
                nTmp.fromBufferAttribute(normAttr, i).applyMatrix3(normalMat).normalize();
            } else {
                nTmp.set(0, 0, 1);
            }
            restNorm[i * 3] = nTmp.x;
            restNorm[i * 3 + 1] = nTmp.y;
            restNorm[i * 3 + 2] = nTmp.z;

            const d = (sx - pOrig.x) * vAxis.x + (sy - pOrig.y) * vAxis.y + (sz - pOrig.z) * vAxis.z;
            projArr[i] = d;
            if (d < projMin) projMin = d;
            if (d > projMax) projMax = d;
        }
        const projSpan = Math.max(0.05, projMax - projMin);

        // 幾何質心與骨骼軸線，用來判斷外鼓方向與生成順應纖維方向的 UV
        const tArr = new Float32Array(vertCount);
        const uvs = new Float32Array(vertCount * 2);
        const colors = new Float32Array(vertCount * 3);
        const outwardWeights = new Float32Array(vertCount);

        const refUp = (Math.abs(vAxis.z) < 0.85) ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
        const perpA = new THREE.Vector3().crossVectors(vAxis, refUp).normalize();
        const perpB = new THREE.Vector3().crossVectors(vAxis, perpA).normalize();

        // 找出骨心參考點（上臂 vs 前臂分別相對於各自骨幹線段判定外鼓方向）
        const boneRefStart = (tmpl.region === 'forearm')
            ? mToScene(mirrorM([P.elbowPivotX, P.elbowPivotY, P.elbowPivotZ], sign))
            : mToScene(mirrorM([P.shoulderPivotX, P.shoulderPivotY, P.shoulderPivotZ], sign));
        const boneRefEnd = (tmpl.region === 'forearm')
            ? mToScene(mirrorM([P.wristPivotX, P.wristPivotY, P.wristPivotZ], sign))
            : mToScene(mirrorM([P.elbowPivotX, P.elbowPivotY, P.elbowPivotZ], sign));
        const chestCenter = mToScene([0, 1.30, 0.0]);
        const vTmpOut = { x: 0, y: 0, z: 0 };

        // 為扇形肌 (如胸大肌/三角肌) 尋找止點端平均點作為放射圓心，並記錄起止點公尺中心
        let insCx = 0, insCy = 0, insCz = 0, insCnt = 0;
        let origCx = 0, origCy = 0, origCz = 0, origCnt = 0;
        let insMx = 0, insMy = 0, insMz = 0;
        let origMx = 0, origMy = 0, origMz = 0;
        for (let i = 0; i < vertCount; i++) {
            const t = (projArr[i] - projMin) / projSpan;
            tArr[i] = t;
            if (t < 0.14) {
                origCx += restPos[i * 3]; origCy += restPos[i * 3 + 1]; origCz += restPos[i * 3 + 2];
                origMx += restMeters[i * 3]; origMy += restMeters[i * 3 + 1]; origMz += restMeters[i * 3 + 2];
                origCnt++;
            } else if (t > 0.86) {
                insCx += restPos[i * 3]; insCy += restPos[i * 3 + 1]; insCz += restPos[i * 3 + 2];
                insMx += restMeters[i * 3]; insMy += restMeters[i * 3 + 1]; insMz += restMeters[i * 3 + 2];
                insCnt++;
            }
        }
        const anchorOrigWorld = origCnt > 0
            ? new THREE.Vector3(origCx / origCnt, origCy / origCnt, origCz / origCnt)
            : pOrig.clone();
        const anchorInsWorld = insCnt > 0
            ? new THREE.Vector3(insCx / insCnt, insCy / insCnt, insCz / insCnt)
            : pIns.clone();
        const anchorOrigM = origCnt > 0
            ? [origMx / origCnt, origMy / origCnt, origMz / origCnt]
            : mirrorM(tmpl.originM, sign);
        const anchorInsM = insCnt > 0
            ? [insMx / insCnt, insMy / insCnt, insMz / insCnt]
            : mirrorM(tmpl.insertM, sign);

        const restChordLen = Math.max(0.4, anchorInsWorld.distanceTo(anchorOrigWorld));

        let maxFanDist = 0.01;
        if (tmpl.isFan) {
            for (let i = 0; i < vertCount; i++) {
                const d = Math.hypot(
                    restPos[i * 3] - anchorInsWorld.x,
                    restPos[i * 3 + 1] - anchorInsWorld.y,
                    restPos[i * 3 + 2] - anchorInsWorld.z
                );
                if (d > maxFanDist) maxFanDist = d;
            }
        }

        // 建置與 anatomy.js _mountMesh() 完全一致的多骨骼局部座標與法線快取
        const chainLen = tmpl.chain.length;
        const bones = tmpl.chain.map((link, idx) => {
            const node = this._getBoneNode(link.role, side);
            const pivotM = this._getBonePivotM(link.role, side);
            return {
                role: link.role,
                node,
                pivotM,
                localPos: new Float32Array(vertCount * 3),
                localNorm: new Float32Array(vertCount * 3),
                jointPivot: link.jointPivotM ? mToScene(mirrorM(link.jointPivotM, sign)) : null,
                bandScene: (link.bandM || 0.036) * GLB_SCALE,
                isFirst: idx === 0
            };
        });

        const weights = new Float32Array(vertCount * chainLen);
        const bellyEnv = new Float32Array(vertCount);
        const colTmp = new THREE.Color();

        for (let i = 0; i < vertCount; i++) {
            const mx = restMeters[i * 3], my = restMeters[i * 3 + 1], mz = restMeters[i * 3 + 2];
            const px = restPos[i * 3], py = restPos[i * 3 + 1], pz = restPos[i * 3 + 2];
            const nx = restNorm[i * 3], ny = restNorm[i * 3 + 1], nz = restNorm[i * 3 + 2];
            const t = tArr[i];

            // 1. 直接依目標骨頭樞紐平移並縮放至該骨節的局部座標 (與 skeleton.glb 骨頭掛載公式 100% 同構)
            for (let b = 0; b < chainLen; b++) {
                const bn = bones[b];
                const pm = bn.pivotM;
                bn.localPos[i * 3] = (mx - pm[0]) * GLB_SCALE;
                bn.localPos[i * 3 + 1] = (my - pm[1]) * GLB_SCALE;
                bn.localPos[i * 3 + 2] = (mz - pm[2]) * GLB_SCALE;

                bn.localNorm[i * 3] = nx;
                bn.localNorm[i * 3 + 1] = ny;
                bn.localNorm[i * 3 + 2] = nz;
            }

            // 2. 關節過渡帶權重 (Joint-Localized Blend Weights)
            if (chainLen === 2) {
                const jp = bones[1].jointPivot;
                const band = bones[1].bandScene;
                const s = (px - jp.x) * vAxis.x + (py - jp.y) * vAxis.y + (pz - jp.z) * vAxis.z;
                const w1 = THREE.MathUtils.smoothstep(s, -band, band);
                weights[i * 2] = 1.0 - w1;
                weights[i * 2 + 1] = w1;
            } else if (chainLen === 3) {
                const jp1 = bones[1].jointPivot, b1 = bones[1].bandScene;
                const jp2 = bones[2].jointPivot, b2 = bones[2].bandScene;
                const s1 = (px - jp1.x) * vAxis.x + (py - jp1.y) * vAxis.y + (pz - jp1.z) * vAxis.z;
                const s2 = (px - jp2.x) * vAxis.x + (py - jp2.y) * vAxis.y + (pz - jp2.z) * vAxis.z;
                const pass1 = THREE.MathUtils.smoothstep(s1, -b1, b1);
                const pass2 = THREE.MathUtils.smoothstep(s2, -b2, b2);
                weights[i * 3] = 1.0 - pass1;
                weights[i * 3 + 1] = pass1 * (1.0 - pass2);
                weights[i * 3 + 2] = pass1 * pass2;
            } else {
                weights[i] = 1.0;
            }

            // 3. 順應肌束走向之 UV 座標 (扇形肌使用以止點為圓心的極座標放射角度；管狀肌使用柱面角度)
            if (tmpl.isFan) {
                const dx = (px - anchorInsWorld.x) * sign;
                const dy = py - anchorInsWorld.y;
                const dz = pz - anchorInsWorld.z;
                const ang = Math.atan2(dy, Math.hypot(dx, dz)); // -PI/2 .. +PI/2
                const rad = Math.hypot(dx, dy, dz) / maxFanDist;
                uvs[i * 2] = (ang / Math.PI + 0.5) * 1.4;
                uvs[i * 2 + 1] = rad;
            } else {
                const cx = pOrig.x + vAxis.x * projArr[i];
                const cy = pOrig.y + vAxis.y * projArr[i];
                const cz = pOrig.z + vAxis.z * projArr[i];
                const rx = px - cx, ry = py - cy, rz = pz - cz;
                const uProj = rx * perpA.x + ry * perpA.y + rz * perpA.z;
                const vProj = rx * perpB.x + ry * perpB.y + rz * perpB.z;
                const theta = Math.atan2(vProj, uProj);
                uvs[i * 2] = theta / (Math.PI * 2.0) + 0.5;
                uvs[i * 2 + 1] = t;
            }

            // 4. 肌腹 (紅棕) vs 兩端肌腱 (乳白) 頂點漸層
            let muscleBlend = 1.0;
            if (t < 0.14) {
                muscleBlend = THREE.MathUtils.smoothstep(t, 0.0, 0.14);
            } else if (t > 0.84) {
                muscleBlend = 1.0 - THREE.MathUtils.smoothstep(t, 0.84, 1.0);
            }
            colTmp.copy(this._colorTendon).lerp(this._colorBelly, muscleBlend);
            colors[i * 3] = colTmp.r;
            colors[i * 3 + 1] = colTmp.g;
            colors[i * 3 + 2] = colTmp.b;

            // 5. 各向異性外鼓遮罩：只讓背離骨心的外表面在收縮時膨脹，貼骨內側面固定不吃穿骨頭
            let outDot = 0.7;
            if (tmpl.region === 'chest' || tmpl.region === 'shoulder') {
                const ox = px - chestCenter.x, oy = py - chestCenter.y, oz = pz - chestCenter.z;
                const ol = Math.hypot(ox, oy, oz) || 1;
                outDot = (nx * ox + ny * oy + nz * oz) / ol;
            } else {
                closestPointOnSegment(px, py, pz, boneRefStart.x, boneRefStart.y, boneRefStart.z, boneRefEnd.x, boneRefEnd.y, boneRefEnd.z, vTmpOut);
                const ol = Math.hypot(vTmpOut.x, vTmpOut.y, vTmpOut.z) || 1;
                outDot = (nx * vTmpOut.x + ny * vTmpOut.y + nz * vTmpOut.z) / ol;
            }
            outwardWeights[i] = clamp(0.10 + 0.90 * Math.max(0, outDot), 0.08, 1.0);
            bellyEnv[i] = Math.pow(Math.max(0, Math.sin(Math.PI * clamp(t, 0.0, 1.0))), 0.85);
        }

        // 原點錨點與止點錨點直接依起止骨樞紐轉換為局部座標，供即時量測距離變化 L
        const pOrig0 = bones[0].pivotM;
        const pInsL = bones[chainLen - 1].pivotM;
        const originAnchorLocal = new THREE.Vector3(
            (anchorOrigM[0] - pOrig0[0]) * GLB_SCALE,
            (anchorOrigM[1] - pOrig0[1]) * GLB_SCALE,
            (anchorOrigM[2] - pOrig0[2]) * GLB_SCALE
        );
        const insertAnchorLocal = new THREE.Vector3(
            (anchorInsM[0] - pInsL[0]) * GLB_SCALE,
            (anchorInsM[1] - pInsL[1]) * GLB_SCALE,
            (anchorInsM[2] - pInsL[2]) * GLB_SCALE
        );

        geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        // 若位置 attribute 原先為 quantized Int16，重建為標準 Float32Array 供即時寫入，並清除舊的 quantized 包圍盒
        const dynPos = new Float32Array(restPos);
        const dynNorm = new Float32Array(restNorm);
        geom.setAttribute('position', new THREE.BufferAttribute(dynPos, 3));
        geom.setAttribute('normal', new THREE.BufferAttribute(dynNorm, 3));
        geom.boundingBox = null;
        geom.boundingSphere = null;

        const fullId = `${tmpl.key}_${side}`;
        const fullName = `${tmpl.name} (${sideLabel})`;

        const mesh = new THREE.Mesh(geom, this.baseMaterial);
        mesh.name = `Muscle_${fullId}`;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.muscleId = fullId;
        mesh.userData.muscleName = fullName;
        mesh.userData.muscleLayer = tmpl.layer;
        mesh.userData.muscleRegion = tmpl.region;

        this.muscleGroup.add(mesh);

        const entry = {
            id: fullId,
            name: fullName,
            tmpl,
            side,
            mesh,
            geom,
            vertCount,
            dynPos,
            dynNorm,
            bones,
            chainLen,
            weights,
            bellyEnv,
            outwardWeights,
            originAnchorLocal,
            insertAnchorLocal,
            restChordLen,
            peeled: false
        };

        this.muscles.push(entry);
        this.muscleById.set(fullId, entry);
    }

    update() {
        if (!this.visible || !this.isLoaded) return;
        this.torso.rootGroup.updateMatrixWorld(true);
        this.muscleGroup.updateMatrixWorld(true);

        const muscleRootInv = this.muscleGroup.matrixWorld.clone().invert();
        const genderNormShift = (this.torso.currentGender === 'male')
            ? 0.032
            : (this.torso.currentGender === 'female' ? -0.042 : 0.0);

        const P = GLB_PIVOTS_M;
        // 取得當前雙側大臂與前臂的實際骨幹線段（供防止極端屈肘/高舉穿插）
        const armSegs = {};
        for (const side of ['left', 'right']) {
            const sign = (side === 'left') ? 1 : -1;
            const sg = this.torso.shoulderGirdle[side];
            if (!sg) continue;
            const sh = new THREE.Vector3(0, 0, 0);
            const el = new THREE.Vector3(0, 0, 0);
            const wr = new THREE.Vector3(0, 0, 0);
            if (sg.humerusJoint && sg.elbowJoint && sg.handGroup) {
                sg.humerusJoint.localToWorld(sh);
                this.muscleGroup.worldToLocal(sh);
                sg.elbowJoint.localToWorld(el);
                this.muscleGroup.worldToLocal(el);
                sg.handGroup.localToWorld(wr);
                this.muscleGroup.worldToLocal(wr);
            }
            const rCal = (this.torso.currentGender === 'female') ? 0.88 : (this.torso.currentGender === 'male' ? 1.04 : 1.0);
            armSegs[side] = { sh, el, wr, armR: 0.44 * rCal, foreR: 0.34 * rCal, sign };
        }

        const pOrigW = new THREE.Vector3();
        const pInsW = new THREE.Vector3();
        const boneMats = [];
        const tmpOut = { x: 0, y: 0, z: 0 };

        for (const m of this.muscles) {
            if (m.peeled || !m.mesh.visible) continue;

            const { vertCount, dynPos, dynNorm, bones, chainLen, weights, bellyEnv, outwardWeights, tmpl } = m;

            // 1. 計算本幀各綁定骨骼相對於 muscleGroup 的變換矩陣
            boneMats.length = chainLen;
            for (let b = 0; b < chainLen; b++) {
                boneMats[b] = new THREE.Matrix4().multiplyMatrices(muscleRootInv, bones[b].node.matrixWorld).elements;
            }

            // 2. 量測即時肌長度 L 並換算體積守恆膨脹係數 sqrt(L0 / L)
            pOrigW.copy(m.originAnchorLocal).applyMatrix4(bones[0].node.matrixWorld);
            this.muscleGroup.worldToLocal(pOrigW);
            pInsW.copy(m.insertAnchorLocal).applyMatrix4(bones[chainLen - 1].node.matrixWorld);
            this.muscleGroup.worldToLocal(pInsW);

            const curChord = Math.max(m.restChordLen * 0.48, pOrigW.distanceTo(pInsW));
            const bulgeRatio = Math.sqrt(clamp(m.restChordLen / curChord, 0.68, 1.50));
            const bulgeAmp = (bulgeRatio - 1.0) * (tmpl.bellyScale || 0.35);

            // 3. 零配置密集頂點變形迴圈
            for (let i = 0; i < vertCount; i++) {
                let px = 0, py = 0, pz = 0;
                let nx = 0, ny = 0, nz = 0;

                for (let b = 0; b < chainLen; b++) {
                    const w = weights[i * chainLen + b];
                    if (w < 1e-4) continue;
                    const e = boneMats[b];
                    const lp = bones[b].localPos;
                    const ln = bones[b].localNorm;
                    const lx = lp[i * 3], ly = lp[i * 3 + 1], lz = lp[i * 3 + 2];
                    const lnx = ln[i * 3], lny = ln[i * 3 + 1], lnz = ln[i * 3 + 2];

                    px += (e[0] * lx + e[4] * ly + e[8] * lz + e[12]) * w;
                    py += (e[1] * lx + e[5] * ly + e[9] * lz + e[13]) * w;
                    pz += (e[2] * lx + e[6] * ly + e[10] * lz + e[14]) * w;

                    nx += (e[0] * lnx + e[4] * lny + e[8] * lnz) * w;
                    ny += (e[1] * lnx + e[5] * lny + e[9] * lnz) * w;
                    nz += (e[2] * lnx + e[6] * lny + e[10] * lnz) * w;
                }

                const nl = Math.hypot(nx, ny, nz) || 1.0;
                nx /= nl; ny /= nl; nz /= nl;

                // 施加只朝向骨面外側的等體積肌腹隆起與性別厚度微調
                const shift = (bulgeAmp * bellyEnv[i] + genderNormShift * bellyEnv[i]) * outwardWeights[i];
                px += nx * shift;
                py += ny * shift;
                pz += nz * shift;

                // 骨幹防穿插推離 (arm / forearm 跨越關節防吃進骨心)
                const seg = armSegs[m.side];
                if (seg && tmpl.boneClearance) {
                    if (tmpl.boneClearance === 'arm' || tmpl.boneClearance === 'arm_posterior') {
                        const d = closestPointOnSegment(px, py, pz, seg.sh.x, seg.sh.y, seg.sh.z, seg.el.x, seg.el.y, seg.el.z, tmpOut);
                        const minR = seg.armR;
                        if (d < minR && d > 1e-5) {
                            const push = (minR - d) / d;
                            px += tmpOut.x * push;
                            py += tmpOut.y * push;
                            pz += tmpOut.z * push;
                        }
                    } else if (tmpl.boneClearance === 'forearm') {
                        const d = closestPointOnSegment(px, py, pz, seg.el.x, seg.el.y, seg.el.z, seg.wr.x, seg.wr.y, seg.wr.z, tmpOut);
                        const minR = seg.foreR;
                        if (d < minR && d > 1e-5) {
                            const push = (minR - d) / d;
                            px += tmpOut.x * push;
                            py += tmpOut.y * push;
                            pz += tmpOut.z * push;
                        }
                    }
                }

                dynPos[i * 3] = px;
                dynPos[i * 3 + 1] = py;
                dynPos[i * 3 + 2] = pz;

                dynNorm[i * 3] = nx;
                dynNorm[i * 3 + 1] = ny;
                dynNorm[i * 3 + 2] = nz;
            }

            m.geom.attributes.position.needsUpdate = true;
            m.geom.attributes.normal.needsUpdate = true;
            m.geom.computeBoundingBox();
            m.geom.computeBoundingSphere();
        }
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
            m.mesh.material = (muscleId && m.id === muscleId)
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
        return entry.name;
    }

    undoPeel() {
        while (this.peeledHistory.length > 0) {
            const id = this.peeledHistory.pop();
            const entry = this.muscleById.get(id);
            if (entry && entry.peeled) {
                entry.peeled = false;
                entry.mesh.visible = true;
                this.update();
                return entry.name;
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
            if (m.tmpl.layer === 'superficial' && !m.peeled) {
                m.peeled = true;
                m.mesh.visible = false;
                this.peeledHistory.push(m.id);
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
