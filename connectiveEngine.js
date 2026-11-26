/**
 * AnatoPose 3D - Z-Anatomy Medical Connective Tissue Engine (v12.1)
 *
 * 載入 Z-Anatomy 關節囊、韌帶、關節盤、盂唇/半月板與骨間膜網格 (z-anatomy-joints.glb, CC BY-SA 4.0)，
 * 依對應骨骼樞紐鏈執行平滑雙骨 DQS / Swing-Twist 變形，並支援單一結締組織的獨立 Hide / Fade 透明度調整。
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLB_SCALE, GLB_PIVOTS_M } from './medicalSkeletonLoader.js?v=9.0';
import { CONNECTIVE_TEMPLATES } from './connectiveConfig.js?v=12.1';

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

function normalizeLookupKey(s) {
    return String(s || '')
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[[\].:/]/g, '')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
}

const _qConj = new THREE.Quaternion();
function decomposeSwingTwist(q, axis, outSwing, outTwist) {
    const dot = q.x * axis.x + q.y * axis.y + q.z * axis.z;
    outTwist.set(axis.x * dot, axis.y * dot, axis.z * dot, q.w);
    if (outTwist.lengthSq() < 1e-10) {
        outTwist.identity();
    } else {
        outTwist.normalize();
        if (outTwist.w < 0) outTwist.set(-outTwist.x, -outTwist.y, -outTwist.z, -outTwist.w);
    }
    _qConj.copy(outTwist).conjugate();
    outSwing.copy(q).multiply(_qConj).normalize();
    if (outSwing.w < 0) outSwing.set(-outSwing.x, -outSwing.y, -outSwing.z, -outSwing.w);
}

export class AnatomicalConnectiveSystem {
    constructor(anatomicalTorso) {
        this.torso = anatomicalTorso;
        this.connectiveGroup = new THREE.Group();
        this.connectiveGroup.name = 'AnatomicalConnective_Group';

        this.visible = true;
        this.isLoaded = false;
        this.selectedId = null;

        this.parts = [];
        this.partById = new Map();
        this._onReadyCallbacks = [];

        this.baseLigamentMat = new THREE.MeshStandardMaterial({
            color: 0xedeaf4,
            roughness: 0.44,
            metalness: 0.04,
            transparent: true,
            opacity: 0.92,
            depthWrite: true,
            side: THREE.DoubleSide
        });

        this.baseCartilageMat = new THREE.MeshStandardMaterial({
            color: 0x9ed0e6,
            roughness: 0.36,
            metalness: 0.03,
            transparent: true,
            opacity: 0.90,
            depthWrite: true,
            side: THREE.DoubleSide
        });

        this.selectedMaterial = new THREE.MeshStandardMaterial({
            color: 0x38bdf8,
            emissive: 0x0ea5e9,
            emissiveIntensity: 0.36,
            roughness: 0.35,
            metalness: 0.06,
            transparent: true,
            opacity: 0.95,
            depthWrite: true,
            side: THREE.DoubleSide
        });

        this.readyPromise = this._loadJointsGLB('./z-anatomy-joints.glb');
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
        const ll = this.torso.lowerLimbs[side];
        switch (role) {
            case 'pelvis': return this.torso.pelvisUnit;
            case 'ribcage': return this.torso.ribcageGroup;
            case 'skull': return this.torso.skullGroup;
            case 'clavicle': return sg?.clavicleScaleGroup || null;
            case 'scapula': return sg?.scapulaMesh || null;
            case 'humerus': return sg?.humerusCaliber || null;
            case 'ulna': return sg?.forearmAlign || null;
            case 'radius': return sg?.radiusAlign || null;
            case 'hand': return sg?.handAlign || null;
            case 'femur': return ll?.femurCaliber || null;
            case 'tibia': return ll?.tibiaCaliber || null;
            case 'foot': return ll?.footGroup || null;
            default: return null;
        }
    }

    _getBonePivotM(role, side) {
        const sign = (side === 'left') ? 1 : -1;
        const P = GLB_PIVOTS_M;
        switch (role) {
            case 'pelvis': return P.pelvisOrigin;
            case 'ribcage': return P.thoraxOrigin;
            case 'skull': return P.headPivot;
            case 'clavicle': return [sign * P.claviclePivotX, P.claviclePivotY, P.claviclePivotZ];
            case 'scapula': return [sign * P.scapulaPivotX, P.scapulaPivotY, P.scapulaPivotZ];
            case 'humerus': return [sign * P.shoulderPivotX, P.shoulderPivotY, P.shoulderPivotZ];
            case 'ulna': return [sign * P.elbowPivotX, P.elbowPivotY, P.elbowPivotZ];
            case 'radius': return [sign * P.radProxX, P.radProxY, P.radProxZ];
            case 'hand': return [sign * P.wristPivotX, P.wristPivotY, P.wristPivotZ];
            case 'femur': return [sign * P.hipPivotX, P.hipPivotY, P.hipPivotZ];
            case 'tibia': return [sign * P.kneePivotX, P.kneePivotY, P.kneePivotZ];
            case 'foot': return [sign * P.anklePivotX, P.anklePivotY, P.anklePivotZ];
            default: return P.pelvisOrigin;
        }
    }

    _getBoneTwistAxis(role, side) {
        const sign = (side === 'left') ? 1 : -1;
        const P = GLB_PIVOTS_M;
        const m = (pt) => [sign * pt[0], pt[1], pt[2]];
        let a = null, b = null;
        if (role === 'humerus') {
            a = m([P.shoulderPivotX, P.shoulderPivotY, P.shoulderPivotZ]);
            b = m([P.elbowPivotX, P.elbowPivotY, P.elbowPivotZ]);
        } else if (role === 'radius' || role === 'ulna') {
            a = m([P.elbowPivotX, P.elbowPivotY, P.elbowPivotZ]);
            b = m([P.wristPivotX, P.wristPivotY, P.wristPivotZ]);
        } else if (role === 'femur') {
            a = m([P.hipPivotX, P.hipPivotY, P.hipPivotZ]);
            b = m([P.kneePivotX, P.kneePivotY, P.kneePivotZ]);
        } else if (role === 'tibia') {
            a = m([P.kneePivotX, P.kneePivotY, P.kneePivotZ]);
            b = m([P.anklePivotX, P.anklePivotY, P.anklePivotZ]);
        }
        if (!a || !b) return null;
        return new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    }

    _buildSpineNodes() {
        const P = GLB_PIVOTS_M;
        const list = [{ node: this.torso.pelvisUnit, pivotM: P.pelvisOrigin }];
        for (let i = 0; i < P.lumbar.length; i++) {
            list.push({ node: this.torso.lumbarVertebrae[i], pivotM: P.lumbar[i].pivot });
        }
        list.push({ node: this.torso.thoracicSpineGroup, pivotM: P.thoraxOrigin });
        for (let i = 0; i < P.cervical.length; i++) {
            list.push({ node: this.torso.cervicalVertebrae[i], pivotM: P.cervical[i].pivot });
        }
        list.push({ node: this.torso.headJoint, pivotM: P.headPivot });
        return list.filter(x => x.node);
    }

    async _loadJointsGLB(url) {
        try {
            const dracoLoader = new DRACOLoader();
            dracoLoader.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/gltf/');

            const loader = new GLTFLoader();
            loader.setDRACOLoader(dracoLoader);

            const gltf = await loader.loadAsync(url);
            gltf.scene.updateMatrixWorld(true);

            const nodeByRaw = new Map();
            const nodeByNorm = new Map();
            gltf.scene.traverse(obj => {
                if (obj.isMesh && obj.name) {
                    nodeByRaw.set(obj.name, obj);
                    nodeByNorm.set(normalizeLookupKey(obj.name), obj);
                }
            });

            const findMesh = (rawCandidate) => {
                return nodeByRaw.get(rawCandidate) || nodeByNorm.get(normalizeLookupKey(rawCandidate)) || null;
            };

            for (const tmpl of CONNECTIVE_TEMPLATES) {
                if (tmpl.bilateral) {
                    const srcL = findMesh(`${tmpl.meshBase}.l`);
                    const srcR = findMesh(`${tmpl.meshBase}.r`);
                    if (srcL) this._mountPart(tmpl, 'left', srcL);
                    if (srcR) this._mountPart(tmpl, 'right', srcR);
                } else {
                    const src = findMesh(tmpl.meshBase);
                    if (src) this._mountPart(tmpl, 'mid', src);
                }
            }

            this.isLoaded = true;
            this.update();
            dracoLoader.dispose();

            console.log(`[AnatoPose] Z-Anatomy connective tissue loaded (${this.parts.length} capsules & ligaments).`);
            for (const cb of this._onReadyCallbacks) {
                try { cb(this); } catch (_) {}
            }
            this._onReadyCallbacks = [];
        } catch (err) {
            console.error('[AnatoPose] Failed to load z-anatomy-joints.glb:', err);
        }
    }

    _mountPart(tmpl, side, srcMesh) {
        if (!srcMesh || !srcMesh.geometry) return;

        const geom = srcMesh.geometry.clone();
        const posAttr = geom.getAttribute('position');
        if (!posAttr) return;

        const P = GLB_PIVOTS_M;
        const vertCount = posAttr.count;
        const mWorld = srcMesh.matrixWorld;
        const det = mWorld.determinant();

        // 若原始節點帶有負縮放鏡像 (-1,-1,-1)，翻轉三角形纏繞序確保法線朝外
        if (det < 0) {
            const idx = geom.getIndex();
            if (idx) {
                const arr = idx.array;
                for (let k = 0; k + 2 < arr.length; k += 3) {
                    const tmp = arr[k + 1];
                    arr[k + 1] = arr[k + 2];
                    arr[k + 2] = tmp;
                }
                idx.needsUpdate = true;
            }
        }

        const restMeters = new Float32Array(vertCount * 3);
        const restPos = new Float32Array(vertCount * 3);
        const vTmp = new THREE.Vector3();

        for (let i = 0; i < vertCount; i++) {
            vTmp.fromBufferAttribute(posAttr, i).applyMatrix4(mWorld);
            restMeters[i * 3] = vTmp.x;
            restMeters[i * 3 + 1] = vTmp.y;
            restMeters[i * 3 + 2] = vTmp.z;

            restPos[i * 3] = (vTmp.x - P.pelvisOrigin[0]) * GLB_SCALE;
            restPos[i * 3 + 1] = (vTmp.y - P.pelvisOrigin[1]) * GLB_SCALE;
            restPos[i * 3 + 2] = (vTmp.z - P.pelvisOrigin[2]) * GLB_SCALE;
        }

        const dynPos = new Float32Array(restPos);
        geom.setAttribute('position', new THREE.BufferAttribute(dynPos, 3));
        geom.computeVertexNormals();
        const normAttr = geom.getAttribute('normal');
        const restNorm = new Float32Array(normAttr.array);
        const dynNorm = new Float32Array(restNorm);
        geom.setAttribute('normal', new THREE.BufferAttribute(dynNorm, 3));
        geom.boundingBox = null;
        geom.boundingSphere = null;

        const isSpineChain = tmpl.chain[0] === 'spine';
        const bones = [];
        let weights = null;
        let twistWeights = null;
        let spinePairIdx = null;
        let spinePairW = null;

        if (isSpineChain) {
            const spineList = this._buildSpineNodes();
            for (const s of spineList) {
                bones.push({
                    role: 'spine',
                    node: s.node,
                    pivotM: s.pivotM,
                    restOffset: [
                        (s.pivotM[0] - P.pelvisOrigin[0]) * GLB_SCALE,
                        (s.pivotM[1] - P.pelvisOrigin[1]) * GLB_SCALE,
                        (s.pivotM[2] - P.pelvisOrigin[2]) * GLB_SCALE
                    ],
                    localPos: new Float32Array(vertCount * 3),
                    twistAxis: null
                });
            }
            spinePairIdx = new Uint16Array(vertCount * 2);
            spinePairW = new Float32Array(vertCount);
            for (let i = 0; i < vertCount; i++) {
                const mx = restMeters[i * 3], my = restMeters[i * 3 + 1], mz = restMeters[i * 3 + 2];
                for (let b = 0; b < bones.length; b++) {
                    const pm = bones[b].pivotM;
                    bones[b].localPos[i * 3] = (mx - pm[0]) * GLB_SCALE;
                    bones[b].localPos[i * 3 + 1] = (my - pm[1]) * GLB_SCALE;
                    bones[b].localPos[i * 3 + 2] = (mz - pm[2]) * GLB_SCALE;
                }
                let idx0 = 0, idx1 = Math.min(1, bones.length - 1), frac = 0;
                for (let b = 0; b < bones.length - 1; b++) {
                    const y0 = bones[b].pivotM[1];
                    const y1 = bones[b + 1].pivotM[1];
                    if (my >= y0 && my <= y1) {
                        idx0 = b;
                        idx1 = b + 1;
                        frac = clamp((my - y0) / Math.max(1e-4, y1 - y0), 0, 1);
                        break;
                    }
                    if (my > y1) {
                        idx0 = b + 1;
                        idx1 = b + 1;
                        frac = 0;
                    }
                }
                spinePairIdx[i * 2] = idx0;
                spinePairIdx[i * 2 + 1] = idx1;
                spinePairW[i] = frac;
            }
        } else {
            const effSide = (side === 'mid') ? 'left' : side;
            for (const role of tmpl.chain) {
                const node = this._getBoneNode(role, effSide);
                const pivotM = this._getBonePivotM(role, effSide);
                if (!node) continue;
                bones.push({
                    role,
                    node,
                    pivotM,
                    restOffset: [
                        (pivotM[0] - P.pelvisOrigin[0]) * GLB_SCALE,
                        (pivotM[1] - P.pelvisOrigin[1]) * GLB_SCALE,
                        (pivotM[2] - P.pelvisOrigin[2]) * GLB_SCALE
                    ],
                    localPos: new Float32Array(vertCount * 3),
                    twistAxis: this._getBoneTwistAxis(role, effSide)
                });
            }
            if (bones.length === 0) return;

            for (let i = 0; i < vertCount; i++) {
                const mx = restMeters[i * 3], my = restMeters[i * 3 + 1], mz = restMeters[i * 3 + 2];
                for (let b = 0; b < bones.length; b++) {
                    const pm = bones[b].pivotM;
                    bones[b].localPos[i * 3] = (mx - pm[0]) * GLB_SCALE;
                    bones[b].localPos[i * 3 + 1] = (my - pm[1]) * GLB_SCALE;
                    bones[b].localPos[i * 3 + 2] = (mz - pm[2]) * GLB_SCALE;
                }
            }

            if (bones.length === 2) {
                weights = new Float32Array(vertCount * 2);
                twistWeights = new Float32Array(vertCount);
                const p0 = new THREE.Vector3(...bones[0].restOffset);
                const p1 = new THREE.Vector3(...bones[1].restOffset);
                let axis = p1.clone().sub(p0);
                if (axis.lengthSq() < 1e-4) {
                    axis.set(0, 1, 0);
                } else {
                    axis.normalize();
                }

                let minD = Infinity, maxD = -Infinity;
                const dArr = new Float32Array(vertCount);
                for (let i = 0; i < vertCount; i++) {
                    const d = restPos[i * 3] * axis.x + restPos[i * 3 + 1] * axis.y + restPos[i * 3 + 2] * axis.z;
                    dArr[i] = d;
                    if (d < minD) minD = d;
                    if (d > maxD) maxD = d;
                }
                const span = Math.max(0.05, maxD - minD);
                for (let i = 0; i < vertCount; i++) {
                    const t = clamp((dArr[i] - minD) / span, 0, 1);
                    const w1 = THREE.MathUtils.smoothstep(t, 0.14, 0.86);
                    weights[i * 2] = 1.0 - w1;
                    weights[i * 2 + 1] = w1;
                    twistWeights[i] = bones[1].twistAxis ? THREE.MathUtils.smoothstep(t, 0.45, 0.96) : w1;
                }
            }
        }

        const fullId = `CONN_${tmpl.key}_${side}`;
        const fullName = tmpl.name;
        const defaultMat = tmpl.isCartilage ? this.baseCartilageMat : this.baseLigamentMat;

        const mesh = new THREE.Mesh(geom, defaultMat);
        mesh.name = fullId;
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        mesh.userData.connectiveId = fullId;
        mesh.userData.connectiveName = fullName;
        mesh.userData.connectiveCategory = tmpl.category || 'Connective Tissue';
        mesh.userData.defaultMaterial = defaultMat;
        mesh.userData.partOpacity = defaultMat.opacity;

        this.connectiveGroup.add(mesh);

        const entry = {
            id: fullId,
            name: fullName,
            category: tmpl.category || 'Connective Tissue',
            tmpl,
            side,
            mesh,
            geom,
            vertCount,
            restPos,
            restNorm,
            dynPos,
            dynNorm,
            bones,
            isSpineChain,
            weights,
            twistWeights,
            spinePairIdx,
            spinePairW,
            defaultMat,
            opacity: defaultMat.opacity,
            hidden: false
        };

        this.parts.push(entry);
        this.partById.set(fullId, entry);
    }

    update() {
        if (!this.visible || !this.isLoaded) return;
        this.torso.rootGroup.updateMatrixWorld(true);
        this.connectiveGroup.updateMatrixWorld(true);

        const rootInv = this.connectiveGroup.matrixWorld.clone().invert();
        const mTmp = new THREE.Matrix4();
        const posA = new THREE.Vector3();
        const quatA = new THREE.Quaternion();
        const scaleA = new THREE.Vector3();
        const posB = new THREE.Vector3();
        const quatB = new THREE.Quaternion();
        const scaleB = new THREE.Vector3();
        const qRel = new THREE.Quaternion();
        const qInvA = new THREE.Quaternion();
        const qSwing = new THREE.Quaternion();
        const qTwist = new THREE.Quaternion();
        const qTwistInterp = new THREE.Quaternion();
        const qEff = new THREE.Quaternion();
        const qId = new THREE.Quaternion();
        const vA = new THREE.Vector3();
        const vB = new THREE.Vector3();
        const nTmp = new THREE.Vector3();
        const bMats = [];

        for (const p of this.parts) {
            if (p.hidden || !p.mesh.visible) continue;
            const { vertCount, restNorm, dynPos, dynNorm, bones } = p;

            if (p.isSpineChain) {
                bMats.length = bones.length;
                for (let b = 0; b < bones.length; b++) {
                    if (!bMats[b]) bMats[b] = new THREE.Matrix4();
                    bMats[b].multiplyMatrices(rootInv, bones[b].node.matrixWorld);
                }
                for (let i = 0; i < vertCount; i++) {
                    const i0 = p.spinePairIdx[i * 2], i1 = p.spinePairIdx[i * 2 + 1], w1 = p.spinePairW[i], w0 = 1.0 - w1;
                    const e0 = bMats[i0].elements, l0 = bones[i0].localPos;
                    const lx0 = l0[i * 3], ly0 = l0[i * 3 + 1], lz0 = l0[i * 3 + 2];
                    let px = (e0[0] * lx0 + e0[4] * ly0 + e0[8] * lz0 + e0[12]) * w0;
                    let py = (e0[1] * lx0 + e0[5] * ly0 + e0[9] * lz0 + e0[13]) * w0;
                    let pz = (e0[2] * lx0 + e0[6] * ly0 + e0[10] * lz0 + e0[14]) * w0;

                    if (w1 > 1e-4) {
                        const e1 = bMats[i1].elements, l1 = bones[i1].localPos;
                        const lx1 = l1[i * 3], ly1 = l1[i * 3 + 1], lz1 = l1[i * 3 + 2];
                        px += (e1[0] * lx1 + e1[4] * ly1 + e1[8] * lz1 + e1[12]) * w1;
                        py += (e1[1] * lx1 + e1[5] * ly1 + e1[9] * lz1 + e1[13]) * w1;
                        pz += (e1[2] * lx1 + e1[6] * ly1 + e1[10] * lz1 + e1[14]) * w1;
                    }
                    dynPos[i * 3] = px; dynPos[i * 3 + 1] = py; dynPos[i * 3 + 2] = pz;

                    const nx0 = restNorm[i * 3], ny0 = restNorm[i * 3 + 1], nz0 = restNorm[i * 3 + 2];
                    const nx = e0[0] * nx0 + e0[4] * ny0 + e0[8] * nz0;
                    const ny = e0[1] * nx0 + e0[5] * ny0 + e0[9] * nz0;
                    const nz = e0[2] * nx0 + e0[6] * ny0 + e0[10] * nz0;
                    const nl = Math.hypot(nx, ny, nz) || 1;
                    dynNorm[i * 3] = nx / nl; dynNorm[i * 3 + 1] = ny / nl; dynNorm[i * 3 + 2] = nz / nl;
                }
            } else if (bones.length === 1) {
                mTmp.multiplyMatrices(rootInv, bones[0].node.matrixWorld);
                const e = mTmp.elements;
                const lp = bones[0].localPos;
                for (let i = 0; i < vertCount; i++) {
                    const lx = lp[i * 3], ly = lp[i * 3 + 1], lz = lp[i * 3 + 2];
                    dynPos[i * 3] = e[0] * lx + e[4] * ly + e[8] * lz + e[12];
                    dynPos[i * 3 + 1] = e[1] * lx + e[5] * ly + e[9] * lz + e[13];
                    dynPos[i * 3 + 2] = e[2] * lx + e[6] * ly + e[10] * lz + e[14];

                    const nx0 = restNorm[i * 3], ny0 = restNorm[i * 3 + 1], nz0 = restNorm[i * 3 + 2];
                    const nx = e[0] * nx0 + e[4] * ny0 + e[8] * nz0;
                    const ny = e[1] * nx0 + e[5] * ny0 + e[9] * nz0;
                    const nz = e[2] * nx0 + e[6] * ny0 + e[10] * nz0;
                    const nl = Math.hypot(nx, ny, nz) || 1;
                    dynNorm[i * 3] = nx / nl; dynNorm[i * 3 + 1] = ny / nl; dynNorm[i * 3 + 2] = nz / nl;
                }
            } else {
                // 2-bone Swing-Twist + smooth interpolation for capsules & ligaments
                mTmp.multiplyMatrices(rootInv, bones[0].node.matrixWorld);
                mTmp.decompose(posA, quatA, scaleA);
                mTmp.multiplyMatrices(rootInv, bones[1].node.matrixWorld);
                mTmp.decompose(posB, quatB, scaleB);

                qInvA.copy(quatA).conjugate();
                qRel.copy(qInvA).multiply(quatB).normalize();
                if (bones[1].twistAxis) {
                    decomposeSwingTwist(qRel, bones[1].twistAxis, qSwing, qTwist);
                } else {
                    qSwing.copy(qRel);
                    qTwist.identity();
                }

                const lp0 = bones[0].localPos;
                const lp1 = bones[1].localPos;
                const wArr = p.weights;
                const wtArr = p.twistWeights;

                for (let i = 0; i < vertCount; i++) {
                    const w0 = wArr[i * 2], w1 = wArr[i * 2 + 1];
                    const wt = wtArr[i];

                    vA.set(lp0[i * 3] * scaleA.x, lp0[i * 3 + 1] * scaleA.y, lp0[i * 3 + 2] * scaleA.z)
                        .applyQuaternion(quatA).add(posA);

                    qTwistInterp.copy(qId).slerp(qTwist, wt);
                    qEff.copy(quatA).multiply(qSwing).multiply(qTwistInterp);
                    vB.set(lp1[i * 3] * scaleB.x, lp1[i * 3 + 1] * scaleB.y, lp1[i * 3 + 2] * scaleB.z)
                        .applyQuaternion(qEff).add(posB);

                    dynPos[i * 3] = vA.x * w0 + vB.x * w1;
                    dynPos[i * 3 + 1] = vA.y * w0 + vB.y * w1;
                    dynPos[i * 3 + 2] = vA.z * w0 + vB.z * w1;

                    qEff.copy(quatA).slerp(quatB, w1);
                    nTmp.set(restNorm[i * 3], restNorm[i * 3 + 1], restNorm[i * 3 + 2]).applyQuaternion(qEff).normalize();
                    dynNorm[i * 3] = nTmp.x; dynNorm[i * 3 + 1] = nTmp.y; dynNorm[i * 3 + 2] = nTmp.z;
                }
            }

            p.geom.attributes.position.needsUpdate = true;
            p.geom.attributes.normal.needsUpdate = true;
            p.geom.computeBoundingBox();
            p.geom.computeBoundingSphere();
        }
    }

    _syncMaterial(entry) {
        const isSel = (this.selectedId && entry.id === this.selectedId);
        const defaultOp = entry.defaultMat.opacity;
        const customOp = entry.opacity;
        const hasCustomFade = Math.abs(customOp - defaultOp) > 0.015 || customOp < 0.99;

        if (!hasCustomFade && !isSel) {
            entry.mesh.material = entry.defaultMat;
            return;
        }

        if (isSel && Math.abs(customOp - defaultOp) <= 0.015) {
            entry.mesh.material = this.selectedMaterial;
            return;
        }

        if (!entry.customMat) {
            entry.customMat = entry.defaultMat.clone();
        }
        if (isSel) {
            entry.customMat.color.setHex(0x38bdf8);
            entry.customMat.emissive.setHex(0x0ea5e9);
            entry.customMat.emissiveIntensity = 0.36;
        } else {
            entry.customMat.color.copy(entry.defaultMat.color);
            entry.customMat.emissive.setHex(0x000000);
            entry.customMat.emissiveIntensity = 0;
        }
        entry.customMat.opacity = customOp;
        entry.customMat.transparent = customOp < 0.99;
        entry.customMat.depthWrite = customOp >= 0.99;
        entry.customMat.needsUpdate = true;
        entry.mesh.material = entry.customMat;
    }

    setVisible(visible) {
        this.visible = Boolean(visible);
        this.connectiveGroup.visible = this.visible;
        if (this.visible) {
            this.update();
        }
    }

    selectById(id = null) {
        const prev = this.selectedId;
        this.selectedId = id;
        if (prev && this.partById.has(prev)) {
            this._syncMaterial(this.partById.get(prev));
        }
        if (id && this.partById.has(id)) {
            this._syncMaterial(this.partById.get(id));
        }
    }

    hideById(id) {
        const entry = this.partById.get(id);
        if (!entry || entry.hidden) return null;
        entry.hidden = true;
        entry.mesh.visible = false;
        if (this.selectedId === id) {
            this.selectById(null);
        }
        return entry.name;
    }

    showById(id) {
        const entry = this.partById.get(id);
        if (!entry) return;
        entry.hidden = false;
        entry.mesh.visible = true;
        this.update();
    }

    setPartOpacity(id, opacity) {
        const entry = this.partById.get(id);
        if (!entry) return;
        entry.opacity = clamp(opacity, 0.10, 1.0);
        entry.mesh.userData.partOpacity = entry.opacity;
        this._syncMaterial(entry);
    }

    getPartOpacity(id) {
        return this.partById.get(id)?.opacity ?? 0.92;
    }

    restoreAll() {
        this.selectedId = null;
        for (const p of this.parts) {
            p.hidden = false;
            p.mesh.visible = true;
            p.opacity = p.defaultMat.opacity;
            p.mesh.userData.partOpacity = p.opacity;
            this._syncMaterial(p);
        }
        this.update();
    }

    getStats() {
        const total = this.parts.length;
        const hidden = this.parts.filter(p => p.hidden).length;
        return { total, hidden, visibleCount: total - hidden };
    }
}
