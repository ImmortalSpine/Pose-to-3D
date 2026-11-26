/**
 * AnatoPose 3D - Open-Source Medical 206-Bone Anatomical Skeleton Engine
 *
 * 採用 BodyParts3D / Z-Anatomy 醫學 CT 掃描開源骨骼模型 (skeleton.glb, 278 獨立解剖網格)：
 * 1. 包含完整成人 206 塊獨立骨骼 + 20 塊肋軟骨 + 23 塊椎間盤 + 恥骨聯合 + 28 顆牙齒。
 * 2. 每一塊骨頭精確掛載至多層級關節樞紐 (骨盆 -> 5 腰椎 -> 胸廓 -> 7 頸椎 -> 寰枕頭骨 -> 上下肢 -> 21 指節)。
 * 3. 真實剛體「尺骨 & 橈骨」斜軸旋前/旋後剪刀交叉機構：
 *    橈骨頭在肱骨小頭/尺骨橈切跡原地自轉，橈骨遠端繞尺骨頭做前向半圓弧跨越，帶動手掌同步旋動。
 * 4. 支援男女骨骼二態性形態變形、頭身比縮放、最低點地面自動吸附與 3D 滑鼠點擊英文名稱檢測。
 */

import * as THREE from 'three';
import {
    GLB_SCALE,
    GLB_PIVOTS_M,
    BONE_ENGLISH_NAMES,
    SKULL_NODE_NAMES,
    CARPAL_NAMES,
    FOOT_STATIC_NAMES,
    loadMedicalSkeletonGLB
} from './medicalSkeletonLoader.js?v=9.0';
import { AnatomicalMuscleSystem } from './muscleEngine.js?v=10.1';

function toVec3(arr) {
    return new THREE.Vector3(arr[0], arr[1], arr[2]);
}

function mirrorX(arr) {
    return [-arr[0], arr[1], arr[2]];
}

export class AnatomicalTorso {
    constructor(onReady = null) {
        this.onReady = onReady;
        this.isMedicalLoaded = false;

        this.rootGroup = new THREE.Group();
        this.rootGroup.name = 'AnatomicalTorsoRoot';

        // 骨盆單元 (採用 YXZ 歐拉順序：Yaw 先行，保證側身時矢狀面俯仰無畸變)
        this.pelvisUnit = new THREE.Group();
        this.pelvisUnit.name = 'Pelvis_Unit';
        this.pelvisUnit.rotation.order = 'YXZ';
        this.rootGroup.add(this.pelvisUnit);

        this.bonyPelvisGroup = new THREE.Group();
        this.bonyPelvisGroup.name = 'Bony_Pelvis';
        this.pelvisUnit.add(this.bonyPelvisGroup);

        // 地面自動吸附與接地高度
        this.autoGroundSnap = true;
        this.groundY = -25.5;

        // 腰椎骨節 (L5 -> L1)
        this.lumbarVertebrae = [];
        this.lumbarGroup = new THREE.Group();
        this.lumbarGroup.name = 'LumbarSpine_Group';
        this.pelvisUnit.add(this.lumbarGroup);

        // 胸椎與肋骨整體單元
        this.thoracicCageUnit = new THREE.Group();
        this.thoracicCageUnit.name = 'ThoracicCage_Unit';
        this.thoracicCageUnit.rotation.order = 'YXZ';

        this.ribcageGroup = new THREE.Group();
        this.ribcageGroup.name = 'Ribcage_Group';
        this.thoracicCageUnit.add(this.ribcageGroup);

        this.thoracicSpineGroup = new THREE.Group();
        this.thoracicSpineGroup.name = 'ThoracicSpine_Group';
        this.thoracicCageUnit.add(this.thoracicSpineGroup);

        this.ribsLeft = [];
        this.ribsRight = [];
        this.sternum = null;

        // 頸椎骨節 (C7 -> C1) 與舌骨、藝用頭骨系統
        this.cervicalVertebrae = [];
        this.cervicalGroup = new THREE.Group();
        this.cervicalGroup.name = 'CervicalSpine_Group';
        this.thoracicCageUnit.add(this.cervicalGroup);

        this.headJoint = null;
        this.skullGroup = null;
        this.hyoidMesh = null;

        // 肩帶與上肢
        this.shoulderGirdle = {
            left: this._createEmptyLimbRecord(),
            right: this._createEmptyLimbRecord()
        };

        // 下肢骨骼系統
        this.lowerLimbs = {
            left: {
                hipJoint: null, femurAlign: null, femurCaliber: null,
                femur: null, patella: null,
                kneeJoint: null, tibiaAlign: null, tibiaCaliber: null,
                tibia: null, fibula: null,
                ankleJoint: null, footGroup: null, footMesh: null
            },
            right: {
                hipJoint: null, femurAlign: null, femurCaliber: null,
                femur: null, patella: null,
                kneeJoint: null, tibiaAlign: null, tibiaCaliber: null,
                tibia: null, fibula: null,
                ankleJoint: null, footGroup: null, footMesh: null
            }
        };

        // 儲存各部位顯示狀態與最近一次姿態，供非同步載入完成後無縫套用
        this.visibilityState = {
            skull: true,
            ribcage: true,
            shoulderGirdle: true,
            arms: true,
            forearms: true,
            hands: true,
            pelvis: true,
            femurs: true,
            lowerLegs: true,
            feet: true
        };

        this.currentGender = 'female';
        this.currentHeadRatio = 7.1;
        this.headScale = (48.0 / this.currentHeadRatio) / 5.90;
        this.shoulderBaseX = 4.30;
        this.carryingAngle = 0.22;
        this.selectedBoneName = null;
        this._lastPose = null;

        // 材質庫
        this.materials = {
            bone: new THREE.MeshStandardMaterial({
                color: 0xede4d5,
                roughness: 0.40,
                metalness: 0.04
            }),
            cartilage: new THREE.MeshStandardMaterial({
                color: 0x82b2bd,
                roughness: 0.25,
                metalness: 0.08,
                transparent: true,
                opacity: 0.86
            }),
            disc: new THREE.MeshStandardMaterial({
                color: 0x5a554c,
                roughness: 0.78
            }),
            enamel: new THREE.MeshStandardMaterial({
                color: 0xfaf5ec,
                roughness: 0.22,
                metalness: 0.04
            }),
            selectedBone: new THREE.MeshStandardMaterial({
                color: 0xff925c,
                emissive: 0xe0531c,
                emissiveIntensity: 0.45,
                roughness: 0.26,
                metalness: 0.12
            })
        };

        // 建立關節拓撲骨架結構（立即可用，不阻塞同步初始化）
        this._buildJointRig();

        // 建立程式化動態肌肉系統 (Phase 1: 上肢與胸部，共用同一套關節層級)
        this.muscleSystem = new AnatomicalMuscleSystem(this);
        this.rootGroup.add(this.muscleSystem.muscleGroup);

        this.setGender('female');

        // 非同步載入開源醫學 CT 掃描 206 塊骨骼模型
        this.readyPromise = this._loadAndMountMedicalMeshes('./skeleton.glb');
    }

    _createEmptyLimbRecord() {
        return {
            clavicle: null, clavicleScaleGroup: null,
            scapula: null, scapulaMesh: null,
            humerusJoint: null, humerusAlign: null, humerusCaliber: null, humerus: null,
            elbowJoint: null, forearmAlign: null, ulnaCaliber: null, ulna: null,
            radiusGroup: null, radiusAlign: null, radiusCaliber: null, radiusMesh: null,
            radProxLocal: null, radDistRestLocal: null, ulnaDistLocal: null, wristRestLocal: null,
            pronationAxisLocal: null,
            handGroup: null, handAlign: null, handMesh: null, handJoints: null,
            currentGesture: 'relaxed', currentTwist: 1.48
        };
    }

    /**
     * 為網格與子網格賦予標準英文解剖學名稱 (English Bone Name) 與指定材質
     */
    _tagAndStyleMesh(mesh, boneName, mat = this.materials.bone) {
        if (!mesh) return mesh;
        mesh.material = mat;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.boneName = boneName;
        mesh.userData.origMaterial = mat;
        mesh.traverse(child => {
            if (child.isMesh) {
                child.material = mat;
                child.castShadow = true;
                child.receiveShadow = true;
                child.userData.boneName = boneName;
                child.userData.origMaterial = mat;
            }
        });
        return mesh;
    }

    /**
     * 將 GLB 網格依公尺樞紐平移並等比例縮放後，掛載至目標父群組
     */
    _mountMesh(mesh, parentGroup, pivotM, nodeName, materialOverride = null) {
        if (!mesh || !parentGroup) return null;
        const S = GLB_SCALE;
        mesh.position.set(
            (mesh.position.x - pivotM[0]) * S,
            (mesh.position.y - pivotM[1]) * S,
            (mesh.position.z - pivotM[2]) * S
        );
        mesh.scale.multiplyScalar(S);

        let mat = materialOverride;
        if (!mat) {
            if (nodeName.startsWith('cc') || nodeName === 'interpubic_disc') {
                mat = this.materials.cartilage;
            } else if (nodeName.startsWith('disc_')) {
                mat = this.materials.disc;
            } else if (nodeName.startsWith('tooth_')) {
                mat = this.materials.enamel;
            } else {
                mat = this.materials.bone;
            }
        }

        const engName = BONE_ENGLISH_NAMES[nodeName] || nodeName;
        this._tagAndStyleMesh(mesh, engName, mat);
        parentGroup.add(mesh);
        return mesh;
    }

    /**
     * 高光選中指定英文名稱的骨骼，或傳入 null 清除選取
     */
    selectBoneByName(boneName = null) {
        this.selectedBoneName = boneName;
        if (!this.rootGroup) return;
        this.rootGroup.traverse(child => {
            if (child.isMesh && !child.userData.isCavityHole) {
                if (!child.userData.origMaterial) {
                    child.userData.origMaterial = child.material;
                }
                if (boneName && child.userData.boneName === boneName) {
                    child.material = this.materials.selectedBone;
                } else {
                    child.material = child.userData.origMaterial;
                }
            }
        });
    }

    /**
     * 取得目前模型中所有已建立的獨立骨骼英文名稱清單
     */
    getBoneNamesList() {
        const names = new Set();
        if (this.rootGroup) {
            this.rootGroup.traverse(child => {
                if (child.isMesh && child.userData.boneName && !child.userData.isCavityHole) {
                    names.add(child.userData.boneName);
                }
            });
        }
        return Array.from(names);
    }

    /**
     * 建構精準對應 skeleton.glb 樞紐點的 3D 關節層級鏈
     */
    _buildJointRig() {
        const S = GLB_SCALE;
        const P = GLB_PIVOTS_M;

        // 1. 腰椎鏈 (L5 -> L1)
        let prevPivot = P.pelvisOrigin;
        let parentNode = this.lumbarGroup;
        this.lumbarGroup.position.set(0, 0, 0);

        for (const seg of P.lumbar) {
            const vert = new THREE.Group();
            vert.name = `Vertebra_${seg.name.toUpperCase()}`;
            vert.rotation.order = 'YXZ';
            vert.position.set(
                (seg.pivot[0] - prevPivot[0]) * S,
                (seg.pivot[1] - prevPivot[1]) * S,
                (seg.pivot[2] - prevPivot[2]) * S
            );
            parentNode.add(vert);
            this.lumbarVertebrae.push(vert);
            parentNode = vert;
            prevPivot = seg.pivot;
        }

        // 2. 胸廓單元 (T12-L1 交界處)
        parentNode.add(this.thoracicCageUnit);
        this.thoracicCageUnit.position.set(
            (P.thoraxOrigin[0] - prevPivot[0]) * S,
            (P.thoraxOrigin[1] - prevPivot[1]) * S,
            (P.thoraxOrigin[2] - prevPivot[2]) * S
        );

        // 3. 頸椎鏈 (C7 -> C1)
        this.thoracicCageUnit.add(this.cervicalGroup);
        this.cervicalGroup.position.set(
            (P.cervicalOrigin[0] - P.thoraxOrigin[0]) * S,
            (P.cervicalOrigin[1] - P.thoraxOrigin[1]) * S,
            (P.cervicalOrigin[2] - P.thoraxOrigin[2]) * S
        );

        let cPrev = P.cervicalOrigin;
        let cParent = this.cervicalGroup;
        for (const seg of P.cervical) {
            const vert = new THREE.Group();
            vert.name = `Vertebra_${seg.name.toUpperCase()}`;
            vert.rotation.order = 'YXZ';
            vert.position.set(
                (seg.pivot[0] - cPrev[0]) * S,
                (seg.pivot[1] - cPrev[1]) * S,
                (seg.pivot[2] - cPrev[2]) * S
            );
            cParent.add(vert);
            this.cervicalVertebrae.push(vert);
            cParent = vert;
            cPrev = seg.pivot;
        }

        // 4. 寰枕關節與頭骨系統
        this.headJoint = new THREE.Group();
        this.headJoint.name = 'AtlantoOccipital_Joint';
        this.headJoint.rotation.order = 'YXZ';
        this.headJoint.position.set(
            (P.headPivot[0] - cPrev[0]) * S,
            (P.headPivot[1] - cPrev[1]) * S,
            (P.headPivot[2] - cPrev[2]) * S
        );
        cParent.add(this.headJoint);

        this.skullGroup = new THREE.Group();
        this.skullGroup.name = 'Human_Skull';
        this.skullGroup.scale.setScalar(this.headScale);
        this.headJoint.add(this.skullGroup);

        // 5. 左右上肢關節鏈
        this._buildUpperLimbRig('left');
        this._buildUpperLimbRig('right');

        // 6. 左右下肢關節鏈
        this._buildLowerLimbRig('left');
        this._buildLowerLimbRig('right');
    }

    _buildUpperLimbRig(side) {
        const sign = (side === 'left') ? 1 : -1;
        const S = GLB_SCALE;
        const P = GLB_PIVOTS_M;
        const rec = this.shoulderGirdle[side];

        // 1. 胸鎖關節與鎖骨
        const scJoint = new THREE.Group();
        scJoint.name = `SC_Joint_${side}`;
        scJoint.position.set(
            (sign * P.claviclePivotX - P.thoraxOrigin[0]) * S,
            (P.claviclePivotY - P.thoraxOrigin[1]) * S,
            (P.claviclePivotZ - P.thoraxOrigin[2]) * S
        );
        this.thoracicCageUnit.add(scJoint);
        rec.clavicle = scJoint;

        const clavScaleGroup = new THREE.Group();
        clavScaleGroup.name = `Clavicle_${side}`;
        scJoint.add(clavScaleGroup);
        rec.clavicleScaleGroup = clavScaleGroup;

        // 2. 肩胛骨單元（原點設於肩關節中心 P_sh，便於男女寬肩同步定位）
        const restScapulaPos = {
            x: (sign * P.scapulaPivotX - P.thoraxOrigin[0]) * S,
            y: (P.scapulaPivotY - P.thoraxOrigin[1]) * S,
            z: (P.scapulaPivotZ - P.thoraxOrigin[2]) * S
        };
        rec.restScapulaPos = restScapulaPos;

        const scapulaUnit = new THREE.Group();
        scapulaUnit.name = `Scapula_Unit_${side}`;
        scapulaUnit.position.set(restScapulaPos.x, restScapulaPos.y, restScapulaPos.z);
        this.thoracicCageUnit.add(scapulaUnit);
        rec.scapula = scapulaUnit;

        const scapulaMeshGroup = new THREE.Group();
        scapulaMeshGroup.name = `Scapula_Mesh_${side}`;
        scapulaUnit.add(scapulaMeshGroup);
        rec.scapulaMesh = scapulaMeshGroup;

        // 3. 盂肱關節 (GH Joint)
        const ghJoint = new THREE.Group();
        ghJoint.name = `GH_Joint_${side}`;
        ghJoint.rotation.order = 'YXZ';
        ghJoint.rotation.z = sign * 0.12;
        scapulaUnit.add(ghJoint);
        rec.humerusJoint = ghJoint;

        // 計算大臂 rest 向量對齊至 -Y 軸
        const pSh = new THREE.Vector3(sign * P.shoulderPivotX, P.shoulderPivotY, P.shoulderPivotZ);
        const pEl = new THREE.Vector3(sign * P.elbowPivotX, P.elbowPivotY, P.elbowPivotZ);
        const vArm = pEl.clone().sub(pSh);
        const armLength = vArm.length() * S;
        const qAlignArm = new THREE.Quaternion().setFromUnitVectors(vArm.clone().normalize(), new THREE.Vector3(0, -1, 0));

        const humerusAlign = new THREE.Group();
        humerusAlign.name = `Humerus_Align_${side}`;
        humerusAlign.quaternion.copy(qAlignArm);
        ghJoint.add(humerusAlign);
        rec.humerusAlign = humerusAlign;

        const humerusCaliber = new THREE.Group();
        humerusCaliber.name = `Humerus_${side}`;
        humerusAlign.add(humerusCaliber);
        rec.humerusCaliber = humerusCaliber;
        rec.humerus = humerusCaliber;

        // 4. 肘關節 (位於大臂末端 (0, -armLength, 0))
        const elbowJoint = new THREE.Group();
        elbowJoint.name = `Elbow_Joint_${side}`;
        elbowJoint.position.set(0, -armLength, 0);
        ghJoint.add(elbowJoint);
        rec.elbowJoint = elbowJoint;

        // 計算前臂 rest 向量對齊至 -Y 軸
        const pWr = new THREE.Vector3(sign * P.wristPivotX, P.wristPivotY, P.wristPivotZ);
        const vFore = pWr.clone().sub(pEl);
        const qAlignFore = new THREE.Quaternion().setFromUnitVectors(vFore.clone().normalize(), new THREE.Vector3(0, -1, 0));
        rec.qAlignFore = qAlignFore;
        rec.pElM = pEl;
        rec.pWrM = pWr;

        const ulnaCaliber = new THREE.Group();
        ulnaCaliber.name = `Ulna_${side}`;
        elbowJoint.add(ulnaCaliber);
        rec.ulnaCaliber = ulnaCaliber;
        rec.ulna = ulnaCaliber;

        const forearmAlign = new THREE.Group();
        forearmAlign.name = `Forearm_Align_${side}`;
        forearmAlign.quaternion.copy(qAlignFore);
        ulnaCaliber.add(forearmAlign);
        rec.forearmAlign = forearmAlign;

        // 5. 橈骨剛體旋轉機構 (繞真正解剖學旋前/旋後軸：近端橈骨頭 <-> 遠端尺骨頭連線旋轉)
        const pRadProx = new THREE.Vector3(sign * P.radProxX, P.radProxY, P.radProxZ);
        const pRadDist = new THREE.Vector3(sign * P.radDistX, P.radDistY, P.radDistZ);
        const pUlnaDist = new THREE.Vector3(sign * P.ulnaDistX, P.ulnaDistY, P.ulnaDistZ);

        const toElbowAligned = (pt) => pt.clone().sub(pEl).multiplyScalar(S).applyQuaternion(qAlignFore);
        rec.radProxLocal = toElbowAligned(pRadProx);
        rec.radDistRestLocal = toElbowAligned(pRadDist);
        rec.ulnaDistLocal = toElbowAligned(pUlnaDist);
        rec.wristRestLocal = toElbowAligned(pWr);
        rec.pronationAxisLocal = rec.radProxLocal.clone().sub(rec.ulnaDistLocal).normalize();

        const radiusGroup = new THREE.Group();
        radiusGroup.name = `Radius_Group_${side}`;
        radiusGroup.position.copy(rec.radProxLocal);
        elbowJoint.add(radiusGroup);
        rec.radiusGroup = radiusGroup;

        const radiusCaliber = new THREE.Group();
        radiusCaliber.name = `Radius_Caliber_${side}`;
        radiusGroup.add(radiusCaliber);
        rec.radiusCaliber = radiusCaliber;

        const radiusAlign = new THREE.Group();
        radiusAlign.name = `Radius_Align_${side}`;
        radiusAlign.quaternion.copy(qAlignFore);
        radiusCaliber.add(radiusAlign);
        rec.radiusAlign = radiusAlign;

        // 6. 手部關節鏈 (Carpals -> Metacarpals -> 5 指 MCP / PIP / DIP)
        const handGroup = new THREE.Group();
        handGroup.name = `Hand_Group_${side}`;
        handGroup.position.copy(rec.wristRestLocal);
        elbowJoint.add(handGroup);
        rec.handGroup = handGroup;

        const handAlign = new THREE.Group();
        handAlign.name = `Hand_Align_${side}`;
        handAlign.quaternion.copy(qAlignFore);
        handGroup.add(handAlign);
        rec.handAlign = handAlign;

        // 建立 5 根手指的關節樞紐鏈
        const joints = {};
        for (const [fName, cfg] of Object.entries(P.fingers)) {
            const pMcp = toVec3(side === 'left' ? cfg.mcp : mirrorX(cfg.mcp));
            const pPip = toVec3(side === 'left' ? cfg.pip : mirrorX(cfg.pip));

            const mcpJoint = new THREE.Group();
            mcpJoint.name = `MCP_Joint_${fName}_${side}`;
            mcpJoint.position.copy(pMcp.clone().sub(pWr).multiplyScalar(S));
            handAlign.add(mcpJoint);

            const pipJoint = new THREE.Group();
            pipJoint.name = `PIP_Joint_${fName}_${side}`;
            pipJoint.position.copy(pPip.clone().sub(pMcp).multiplyScalar(S));
            mcpJoint.add(pipJoint);

            let dipJoint = null;
            if (cfg.dip) {
                const pDip = toVec3(side === 'left' ? cfg.dip : mirrorX(cfg.dip));
                dipJoint = new THREE.Group();
                dipJoint.name = `DIP_Joint_${fName}_${side}`;
                dipJoint.position.copy(pDip.clone().sub(pPip).multiplyScalar(S));
                pipJoint.add(dipJoint);
            }

            joints[fName] = { mcpJoint, pipJoint, dipJoint, name: fName, pMcp, pPip, pDip: cfg.dip ? toVec3(side === 'left' ? cfg.dip : mirrorX(cfg.dip)) : null };
        }
        rec.handJoints = joints;
    }

    _buildLowerLimbRig(side) {
        const sign = (side === 'left') ? 1 : -1;
        const S = GLB_SCALE;
        const P = GLB_PIVOTS_M;
        const rec = this.lowerLimbs[side];

        // 1. 髖關節 (位於骨盆髖臼中心)
        const pHip = new THREE.Vector3(sign * P.hipPivotX, P.hipPivotY, P.hipPivotZ);
        const pPelvis = toVec3(P.pelvisOrigin);
        rec.restHipPos = {
            x: (pHip.x - pPelvis.x) * S,
            y: (pHip.y - pPelvis.y) * S,
            z: (pHip.z - pPelvis.z) * S
        };

        const hipJoint = new THREE.Group();
        hipJoint.name = `Hip_Joint_${side}`;
        hipJoint.rotation.order = 'YXZ';
        hipJoint.position.set(rec.restHipPos.x, rec.restHipPos.y, rec.restHipPos.z);
        this.pelvisUnit.add(hipJoint);
        rec.hipJoint = hipJoint;

        // 2. 股骨對齊至 -Y 軸
        const pKnee = new THREE.Vector3(sign * P.kneePivotX, P.kneePivotY, P.kneePivotZ);
        const vFemur = pKnee.clone().sub(pHip);
        const femurLen = vFemur.length() * S;
        const qAlignFemur = new THREE.Quaternion().setFromUnitVectors(vFemur.clone().normalize(), new THREE.Vector3(0, -1, 0));

        const femurAlign = new THREE.Group();
        femurAlign.name = `Femur_Align_${side}`;
        femurAlign.quaternion.copy(qAlignFemur);
        hipJoint.add(femurAlign);
        rec.femurAlign = femurAlign;

        const femurCaliber = new THREE.Group();
        femurCaliber.name = `Femur_${side}`;
        femurAlign.add(femurCaliber);
        rec.femurCaliber = femurCaliber;
        rec.femur = femurCaliber;

        const patellaGroup = new THREE.Group();
        patellaGroup.name = `Patella_${side}`;
        femurAlign.add(patellaGroup);
        rec.patella = patellaGroup;

        // 3. 膝關節
        const kneeJoint = new THREE.Group();
        kneeJoint.name = `Knee_Joint_${side}`;
        kneeJoint.position.set(0, -femurLen, 0);
        hipJoint.add(kneeJoint);
        rec.kneeJoint = kneeJoint;

        // 4. 小腿雙骨對齊至 -Y 軸
        const pAnkle = new THREE.Vector3(sign * P.anklePivotX, P.anklePivotY, P.anklePivotZ);
        const vTibia = pAnkle.clone().sub(pKnee);
        const tibiaLen = vTibia.length() * S;
        const qAlignTibia = new THREE.Quaternion().setFromUnitVectors(vTibia.clone().normalize(), new THREE.Vector3(0, -1, 0));

        const tibiaAlign = new THREE.Group();
        tibiaAlign.name = `Tibia_Align_${side}`;
        tibiaAlign.quaternion.copy(qAlignTibia);
        kneeJoint.add(tibiaAlign);
        rec.tibiaAlign = tibiaAlign;

        const tibiaCaliber = new THREE.Group();
        tibiaCaliber.name = `Tibia_${side}`;
        tibiaAlign.add(tibiaCaliber);
        rec.tibiaCaliber = tibiaCaliber;
        rec.tibia = tibiaCaliber;

        const fibulaCaliber = new THREE.Group();
        fibulaCaliber.name = `Fibula_${side}`;
        tibiaAlign.add(fibulaCaliber);
        rec.fibula = fibulaCaliber;

        // 5. 踝關節與足部群組
        const ankleJoint = new THREE.Group();
        ankleJoint.name = `Ankle_Joint_${side}`;
        ankleJoint.rotation.order = 'YXZ';
        ankleJoint.position.set(0, -tibiaLen, 0);
        kneeJoint.add(ankleJoint);
        rec.ankleJoint = ankleJoint;

        const footGroup = new THREE.Group();
        footGroup.name = `Foot_${side}`;
        ankleJoint.add(footGroup);
        rec.footGroup = footGroup;
        rec.footMesh = footGroup;
    }

    /**
     * 非同步載入開源醫學 skeleton.glb 並將全部 278 塊網格掛載至關節層級
     */
    async _loadAndMountMedicalMeshes(url) {
        try {
            const meshMap = await loadMedicalSkeletonGLB(url);
            const P = GLB_PIVOTS_M;

            // 1. 骨盆 (Sacrum, Coccyx, Hip_L/R, Interpubic Disc)
            for (const name of ['sacrum', 'coccyx', 'hip_l', 'hip_r', 'interpubic_disc']) {
                this._mountMesh(meshMap[name], this.bonyPelvisGroup, P.pelvisOrigin, name);
            }

            // 2. 腰椎 (L5 -> L1) 與對應椎間盤
            P.lumbar.forEach((seg, idx) => {
                const vertGroup = this.lumbarVertebrae[idx];
                this._mountMesh(meshMap[seg.name], vertGroup, seg.pivot, seg.name);
                if (seg.disc && meshMap[seg.disc]) {
                    this._mountMesh(meshMap[seg.disc], vertGroup, seg.pivot, seg.disc);
                }
            });

            // 3. 胸椎 (T1-T12 + 椎間盤) 與 胸廓籠 (Sternum + 24 Ribs + 20 Costal Cartilages)
            for (let i = 1; i <= 12; i++) {
                this._mountMesh(meshMap[`t${i}`], this.thoracicSpineGroup, P.thoraxOrigin, `t${i}`);
                if (i < 12) {
                    const discName = `disc_t${i}_t${i + 1}`;
                    this._mountMesh(meshMap[discName], this.thoracicSpineGroup, P.thoraxOrigin, discName);
                }
                const ribL = this._mountMesh(meshMap[`rib${i}_l`], this.ribcageGroup, P.thoraxOrigin, `rib${i}_l`);
                const ribR = this._mountMesh(meshMap[`rib${i}_r`], this.ribcageGroup, P.thoraxOrigin, `rib${i}_r`);
                if (ribL) this.ribsLeft.push(ribL);
                if (ribR) this.ribsRight.push(ribR);

                if (i <= 10) {
                    this._mountMesh(meshMap[`cc${i}_l`], this.ribcageGroup, P.thoraxOrigin, `cc${i}_l`);
                    this._mountMesh(meshMap[`cc${i}_r`], this.ribcageGroup, P.thoraxOrigin, `cc${i}_r`);
                }
            }
            this._mountMesh(meshMap.disc_t12_l1, this.thoracicSpineGroup, P.thoraxOrigin, 'disc_t12_l1');
            this.sternum = this._mountMesh(meshMap.sternum, this.ribcageGroup, P.thoraxOrigin, 'sternum');

            // 4. 頸椎 (C7 -> C1 + 椎間盤) 與 舌骨 (C3 前方)
            P.cervical.forEach((seg, idx) => {
                const vertGroup = this.cervicalVertebrae[idx];
                this._mountMesh(meshMap[seg.name], vertGroup, seg.pivot, seg.name);
                if (seg.disc && meshMap[seg.disc]) {
                    this._mountMesh(meshMap[seg.disc], vertGroup, seg.pivot, seg.disc);
                }
                if (seg.name === 'c3' && meshMap.hyoid) {
                    this.hyoidMesh = this._mountMesh(meshMap.hyoid, vertGroup, seg.pivot, 'hyoid');
                }
            });

            // 5. 頭顱 (22 塊頭骨 + 6 塊中耳聽小骨 + 28 顆牙齒)
            for (const name of SKULL_NODE_NAMES) {
                if (meshMap[name]) {
                    this._mountMesh(meshMap[name], this.skullGroup, P.headPivot, name);
                }
            }

            // 6. 上肢 (鎖骨、肩胛骨、肱骨、尺骨、橈骨、手腕掌指骨 27 塊/側)
            for (const side of ['left', 'right']) {
                const s = (side === 'left') ? 'l' : 'r';
                const sign = (side === 'left') ? 1 : -1;
                const rec = this.shoulderGirdle[side];

                this._mountMesh(
                    meshMap[`clavicle_${s}`],
                    rec.clavicleScaleGroup,
                    [sign * P.claviclePivotX, P.claviclePivotY, P.claviclePivotZ],
                    `clavicle_${s}`
                );
                this._mountMesh(
                    meshMap[`scapula_${s}`],
                    rec.scapulaMesh,
                    [sign * P.scapulaPivotX, P.scapulaPivotY, P.scapulaPivotZ],
                    `scapula_${s}`
                );
                this._mountMesh(
                    meshMap[`humerus_${s}`],
                    rec.humerusCaliber,
                    [sign * P.shoulderPivotX, P.shoulderPivotY, P.shoulderPivotZ],
                    `humerus_${s}`
                );
                this._mountMesh(
                    meshMap[`ulna_${s}`],
                    rec.forearmAlign,
                    [sign * P.elbowPivotX, P.elbowPivotY, P.elbowPivotZ],
                    `ulna_${s}`
                );
                rec.radiusMesh = this._mountMesh(
                    meshMap[`radius_${s}`],
                    rec.radiusAlign,
                    [sign * P.radProxX, P.radProxY, P.radProxZ],
                    `radius_${s}`
                );

                // 手部腕骨與掌骨
                const wrPivot = [sign * P.wristPivotX, P.wristPivotY, P.wristPivotZ];
                for (const cName of CARPAL_NAMES) {
                    this._mountMesh(meshMap[`${cName}_${s}`], rec.handAlign, wrPivot, `${cName}_${s}`);
                }
                for (let i = 1; i <= 5; i++) {
                    this._mountMesh(meshMap[`mc${i}_${s}`], rec.handAlign, wrPivot, `mc${i}_${s}`);
                }

                // 5 指 14 節可動指骨
                for (const [fName, fJoint] of Object.entries(rec.handJoints)) {
                    const idx = P.fingers[fName].idx;
                    const pMcpArr = [fJoint.pMcp.x, fJoint.pMcp.y, fJoint.pMcp.z];
                    const pPipArr = [fJoint.pPip.x, fJoint.pPip.y, fJoint.pPip.z];

                    this._mountMesh(meshMap[`pph${idx}_hand_${s}`], fJoint.mcpJoint, pMcpArr, `pph${idx}_hand_${s}`);
                    if (idx >= 2 && fJoint.dipJoint) {
                        const pDipArr = [fJoint.pDip.x, fJoint.pDip.y, fJoint.pDip.z];
                        this._mountMesh(meshMap[`mph${idx}_hand_${s}`], fJoint.pipJoint, pPipArr, `mph${idx}_hand_${s}`);
                        this._mountMesh(meshMap[`dph${idx}_hand_${s}`], fJoint.dipJoint, pDipArr, `dph${idx}_hand_${s}`);
                    } else {
                        this._mountMesh(meshMap[`dph${idx}_hand_${s}`], fJoint.pipJoint, pPipArr, `dph${idx}_hand_${s}`);
                    }
                }
                rec.handMesh = rec.handAlign;
                this._applyHandGestureDirect(rec.handJoints, side, rec.currentGesture);
                this._updateRadiusMesh(side, rec.currentTwist);
            }

            // 7. 下肢 (股骨、髕骨、脛骨、腓骨與 26 塊足骨/側)
            for (const side of ['left', 'right']) {
                const s = (side === 'left') ? 'l' : 'r';
                const sign = (side === 'left') ? 1 : -1;
                const rec = this.lowerLimbs[side];

                this._mountMesh(
                    meshMap[`femur_${s}`],
                    rec.femurCaliber,
                    [sign * P.hipPivotX, P.hipPivotY, P.hipPivotZ],
                    `femur_${s}`
                );
                this._mountMesh(
                    meshMap[`patella_${s}`],
                    rec.patella,
                    [sign * P.hipPivotX, P.hipPivotY, P.hipPivotZ],
                    `patella_${s}`
                );
                this._mountMesh(
                    meshMap[`tibia_${s}`],
                    rec.tibiaCaliber,
                    [sign * P.kneePivotX, P.kneePivotY, P.kneePivotZ],
                    `tibia_${s}`
                );
                this._mountMesh(
                    meshMap[`fibula_${s}`],
                    rec.fibula,
                    [sign * P.kneePivotX, P.kneePivotY, P.kneePivotZ],
                    `fibula_${s}`
                );

                const ankPivot = [sign * P.anklePivotX, P.anklePivotY, P.anklePivotZ];
                for (const fName of FOOT_STATIC_NAMES) {
                    const node = `${fName}_${s}`;
                    if (meshMap[node]) {
                        this._mountMesh(meshMap[node], rec.footGroup, ankPivot, node);
                    }
                }
            }

            this.isMedicalLoaded = true;

            // 重新套用目前性別、頭身比、顯示開關與姿態
            this.setGender(this.currentGender);
            this.setHeadRatio(this.currentHeadRatio);
            this._applyAllVisibilityStates();
            if (this._lastPose) {
                this.setTorsoPose(this._lastPose);
            } else if (this.autoGroundSnap) {
                this.snapToGround(this.groundY);
            }

            console.log(`[AnatoPose] Open-source medical skeleton loaded (${Object.keys(meshMap).length} anatomical meshes, 206 bones).`);
            if (this.muscleSystem) {
                this.muscleSystem.update();
            }
            if (typeof this.onReady === 'function') {
                this.onReady(this);
            }
        } catch (err) {
            console.error('[AnatoPose] Failed to load skeleton.glb:', err);
        }
    }

    _applyAllVisibilityStates() {
        this.toggleSkull(this.visibilityState.skull);
        this.toggleRibcage(this.visibilityState.ribcage);
        this.toggleShoulderGirdle(this.visibilityState.shoulderGirdle);
        this.toggleArms(this.visibilityState.arms);
        this.toggleForearms(this.visibilityState.forearms);
        this.toggleHands(this.visibilityState.hands);
        this.togglePelvis(this.visibilityState.pelvis);
        this.toggleFemurs(this.visibilityState.femurs);
        this.toggleLowerLegs(this.visibilityState.lowerLegs);
        this.toggleFeet(this.visibilityState.feet);
    }

    /**
     * 獲取性別形態配置參數 (Gender Morphometrics)
     */
    getGenderMorphConfig(gender = 'female') {
        if (gender === 'female') {
            return {
                name: 'female',
                pelvisScale: [1.06, 0.94, 0.96],
                ribScale: [0.88, 1.0, 0.90],
                shoulderScaleX: 0.94,
                boneRadiusScale: 0.88,
                carryingAngle: 0.22,
                qAngle: 0.08,
                headAspect: [0.95, 0.98, 0.96]
            };
        } else if (gender === 'male') {
            return {
                name: 'male',
                pelvisScale: [0.96, 1.02, 1.02],
                ribScale: [1.04, 1.0, 1.04],
                shoulderScaleX: 1.06,
                boneRadiusScale: 1.04,
                carryingAngle: 0.12,
                qAngle: 0.03,
                headAspect: [1.02, 1.0, 1.02]
            };
        } else {
            return {
                name: 'neutral',
                pelvisScale: [1.0, 1.0, 1.0],
                ribScale: [1.0, 1.0, 1.0],
                shoulderScaleX: 1.0,
                boneRadiusScale: 1.0,
                carryingAngle: 0.14,
                qAngle: 0.05,
                headAspect: [1.0, 1.0, 1.0]
            };
        }
    }

    /**
     * 設定性別骨骼形態 (Gender Skeletal Dimorphism)
     */
    setGender(gender = 'female') {
        const config = this.getGenderMorphConfig(gender);
        this.currentGender = config.name;
        this.carryingAngle = config.carryingAngle;

        // 1. 骨盆寬度與形態動態調整
        if (this.bonyPelvisGroup) {
            this.bonyPelvisGroup.scale.set(config.pelvisScale[0], config.pelvisScale[1], config.pelvisScale[2]);
        }

        // 2. 髖關節跟隨髖臼窩寬度同步對齊
        ['left', 'right'].forEach(side => {
            const rec = this.lowerLimbs[side];
            if (rec && rec.hipJoint && rec.restHipPos) {
                rec.hipJoint.position.set(
                    rec.restHipPos.x * config.pelvisScale[0],
                    rec.restHipPos.y * config.pelvisScale[1],
                    rec.restHipPos.z * config.pelvisScale[2]
                );
            }
        });

        // 3. 胸廓籠寬厚比例
        if (this.ribcageGroup) {
            this.ribcageGroup.scale.set(config.ribScale[0], config.ribScale[1], config.ribScale[2]);
        }

        // 4. 肩帶寬度與鎖骨縮放同步
        const baseShoulderX = (GLB_PIVOTS_M.scapulaPivotX - GLB_PIVOTS_M.thoraxOrigin[0]) * GLB_SCALE;
        this.shoulderBaseX = baseShoulderX * config.shoulderScaleX;

        ['left', 'right'].forEach(side => {
            const sign = (side === 'left') ? 1 : -1;
            const rec = this.shoulderGirdle[side];
            if (rec) {
                if (rec.clavicleScaleGroup) {
                    rec.clavicleScaleGroup.scale.set(config.shoulderScaleX, 1.0, config.ribScale[2]);
                }
                if (rec.scapula && rec.restScapulaPos) {
                    rec.scapula.position.set(
                        sign * this.shoulderBaseX,
                        rec.restScapulaPos.y,
                        rec.restScapulaPos.z * config.ribScale[2]
                    );
                }
            }
        });

        // 5. 四肢長骨粗細度 (女性纖細 vs 男性粗壯)
        const r = config.boneRadiusScale;
        ['left', 'right'].forEach(side => {
            const sg = this.shoulderGirdle[side];
            if (sg) {
                if (sg.humerusCaliber) sg.humerusCaliber.scale.set(r, 1.0, r);
                if (sg.ulnaCaliber) sg.ulnaCaliber.scale.set(r, 1.0, r);
                if (sg.radiusCaliber) sg.radiusCaliber.scale.set(r, 1.0, r);
                if (sg.handGroup) sg.handGroup.scale.set(r, r, r);
            }
            const ll = this.lowerLimbs[side];
            if (ll) {
                if (ll.femurCaliber) ll.femurCaliber.scale.set(r, 1.0, r);
                if (ll.tibiaCaliber) ll.tibiaCaliber.scale.set(r, 1.0, r);
                if (ll.fibula) ll.fibula.scale.set(r, 1.0, r);
                if (ll.footGroup) ll.footGroup.scale.set(r, 1.0, r);
            }
        });

        // 6. 頭骨比例微調
        if (this.skullGroup) {
            const s = this.headScale || 1.15;
            this.skullGroup.scale.set(
                s * config.headAspect[0],
                s * config.headAspect[1],
                s * config.headAspect[2]
            );
        }

        if (this.muscleSystem) {
            this.muscleSystem.update();
        }

        return this.currentGender;
    }

    /**
     * 設定頭身比縮放率 (支援 6.5 ~ 8.5 頭身)
     */
    setHeadRatio(ratio = 7.1) {
        const safeRatio = THREE.MathUtils.clamp(ratio, 6.2, 8.8);
        this.currentHeadRatio = safeRatio;
        // 醫學模型身高約 48 單位，基礎頭骨高 ~5.90 單位
        const targetHeadHeight = 48.0 / safeRatio;
        this.headScale = targetHeadHeight / 5.90;
        if (this.skullGroup) {
            const config = this.getGenderMorphConfig(this.currentGender);
            this.skullGroup.scale.set(
                this.headScale * config.headAspect[0],
                this.headScale * config.headAspect[1],
                this.headScale * config.headAspect[2]
            );
        }
        return this.headScale;
    }

    /**
     * 剛體橈骨斜軸旋前/旋後交叉解算 (Rigid-Body Anatomical Pronation/Supination)
     * 0 為完全旋後 (掌心朝前 +Z，橈尺骨平行)；PI 為完全旋前 (掌心朝後 -Z，橈骨斜跨尺骨前方)
     */
    _updateRadiusMesh(side, twistAngle = 0) {
        const sign = (side === 'left') ? 1 : -1;
        const rec = this.shoulderGirdle[side];
        if (!rec) return;
        rec.currentTwist = twistAngle;

        if (!rec.radiusGroup || !rec.radProxLocal || !rec.wristRestLocal || !rec.pronationAxisLocal) {
            return;
        }

        // 沿著真實解剖學旋前/旋後斜軸 (遠端尺骨頭 -> 近端橈骨頭) 進行單一剛體旋轉
        // 確保近端橈骨頭於肘關節內原位自轉，且遠端橈骨與腕骨/手掌維持剛體貼合、絕不脫臼或產生間隙
        const rotAngle = -sign * twistAngle;
        const qPron = new THREE.Quaternion().setFromAxisAngle(rec.pronationAxisLocal, rotAngle);
        rec.radiusGroup.quaternion.copy(qPron);

        if (rec.handGroup) {
            const wristOffset = rec.wristRestLocal.clone().sub(rec.radProxLocal).applyQuaternion(qPron);
            rec.handGroup.position.copy(rec.radProxLocal).add(wristOffset);
            rec.handGroup.quaternion.copy(qPron);
        }
    }

    /**
     * 驅動手部 14 節可動指骨達成預設計手勢或 MediaPipe 21 節點連續指角
     */
    _applyHandGestureDirect(joints, side, gesture = 'relaxed') {
        if (!joints) return;
        const sign = (side === 'left') ? 1 : -1;
        const GESTURES = {
            relaxed: {
                Thumb:  { mcp: 0.18, pip: 0.25, dip: 0.15, spread: 0 },
                Index:  { mcp: 0.18, pip: 0.30, dip: 0.20, spread: 0 },
                Middle: { mcp: 0.20, pip: 0.34, dip: 0.22, spread: 0 },
                Ring:   { mcp: 0.24, pip: 0.38, dip: 0.24, spread: 0 },
                Little: { mcp: 0.28, pip: 0.42, dip: 0.26, spread: 0 }
            },
            point: {
                Thumb:  { mcp: 0.65, pip: 0.95, dip: 0.55, spread: sign * 0.10 },
                Index:  { mcp: 0.02, pip: 0.03, dip: 0.02, spread: sign * 0.04 },
                Middle: { mcp: 1.45, pip: 1.65, dip: 1.10, spread: 0 },
                Ring:   { mcp: 1.50, pip: 1.70, dip: 1.15, spread: 0 },
                Little: { mcp: 1.50, pip: 1.70, dip: 1.15, spread: 0 }
            },
            peace: {
                Thumb:  { mcp: 0.70, pip: 1.05, dip: 0.60, spread: 0 },
                Index:  { mcp: 0.02, pip: 0.04, dip: 0.02, spread: sign * 0.12 },
                Middle: { mcp: 0.02, pip: 0.04, dip: 0.02, spread: -sign * 0.12 },
                Ring:   { mcp: 1.45, pip: 1.65, dip: 1.10, spread: 0 },
                Little: { mcp: 1.50, pip: 1.70, dip: 1.15, spread: 0 }
            },
            thumbsUp: {
                Thumb:  { mcp: 0.05, pip: 0.05, dip: 0.05, spread: sign * 0.25 },
                Index:  { mcp: 1.45, pip: 1.65, dip: 1.10, spread: 0 },
                Middle: { mcp: 1.50, pip: 1.70, dip: 1.15, spread: 0 },
                Ring:   { mcp: 1.50, pip: 1.70, dip: 1.15, spread: 0 },
                Little: { mcp: 1.50, pip: 1.70, dip: 1.15, spread: 0 }
            },
            ok: {
                Thumb:  { mcp: 0.65, pip: 0.85, dip: 0.50, spread: sign * 0.05 },
                Index:  { mcp: 0.75, pip: 1.05, dip: 0.65, spread: 0 },
                Middle: { mcp: 0.05, pip: 0.05, dip: 0.05, spread: 0 },
                Ring:   { mcp: 0.05, pip: 0.05, dip: 0.05, spread: -sign * 0.06 },
                Little: { mcp: 0.05, pip: 0.05, dip: 0.05, spread: -sign * 0.12 }
            },
            open: {
                Thumb:  { mcp: 0.02, pip: 0.02, dip: 0.02, spread: sign * 0.15 },
                Index:  { mcp: 0.00, pip: 0.00, dip: 0.00, spread: sign * 0.08 },
                Middle: { mcp: 0.00, pip: 0.00, dip: 0.00, spread: 0 },
                Ring:   { mcp: 0.00, pip: 0.00, dip: 0.00, spread: -sign * 0.08 },
                Little: { mcp: 0.00, pip: 0.00, dip: 0.00, spread: -sign * 0.15 }
            },
            fist: {
                Thumb:  { mcp: 0.95, pip: 1.35, dip: 0.90, spread: 0 },
                Index:  { mcp: 1.45, pip: 1.65, dip: 1.10, spread: 0 },
                Middle: { mcp: 1.50, pip: 1.70, dip: 1.15, spread: 0 },
                Ring:   { mcp: 1.50, pip: 1.70, dip: 1.15, spread: 0 },
                Little: { mcp: 1.50, pip: 1.70, dip: 1.15, spread: 0 }
            }
        };

        const config = (typeof gesture === 'object' && gesture !== null)
            ? gesture
            : (GESTURES[gesture] || GESTURES.relaxed);

        // GLB 原始手部已帶有自然放鬆微屈弧度，扣除此基準偏移量讓各手勢完美貼合
        const REST_MCP = 0.18;
        const REST_PIP = 0.30;
        const REST_DIP = 0.22;

        Object.keys(joints).forEach(fingerName => {
            const j = joints[fingerName];
            const angles = config[fingerName] || { mcp: REST_MCP, pip: REST_PIP, dip: REST_DIP, spread: 0 };

            const targetMcp = THREE.MathUtils.clamp(angles.mcp || 0, 0, 1.70);
            const targetPip = THREE.MathUtils.clamp(angles.pip || 0, 0, 1.85);
            const targetDip = THREE.MathUtils.clamp(angles.dip || 0, 0, 1.55);

            const dMcp = targetMcp - REST_MCP;
            const dPip = targetPip - REST_PIP;
            const dDip = targetDip - REST_DIP;

            if (fingerName === 'Thumb') {
                if (j.mcpJoint) {
                    j.mcpJoint.rotation.x = -(dMcp * 0.65);
                    j.mcpJoint.rotation.z = sign * (dMcp * 0.78) + THREE.MathUtils.clamp(angles.spread || 0, -0.35, 0.35);
                }
                if (j.pipJoint) {
                    j.pipJoint.rotation.x = -(dPip * 0.55);
                    j.pipJoint.rotation.z = sign * (dPip * 0.65);
                }
            } else {
                if (j.mcpJoint) {
                    j.mcpJoint.rotation.x = -dMcp;
                    if (angles.spread !== undefined) {
                        j.mcpJoint.rotation.z = THREE.MathUtils.clamp(angles.spread || 0, -0.35, 0.35);
                    }
                }
                if (j.pipJoint) {
                    j.pipJoint.rotation.x = -dPip;
                }
                if (j.dipJoint) {
                    j.dipJoint.rotation.x = -dDip;
                }
            }
        });
    }

    setHandGesture(side, gesture) {
        if (!this.shoulderGirdle[side]) return;
        this.shoulderGirdle[side].currentGesture = gesture;
        if (this.shoulderGirdle[side].handJoints) {
            this._applyHandGestureDirect(this.shoulderGirdle[side].handJoints, side, gesture);
        }
    }

    setFingerAngles(side, fingerAngles) {
        if (!this.shoulderGirdle[side]) return;
        this.shoulderGirdle[side].currentGesture = fingerAngles;
        if (this.shoulderGirdle[side].handJoints) {
            this._applyHandGestureDirect(this.shoulderGirdle[side].handJoints, side, fingerAngles);
        }
    }

    /**
     * 完整姿態驅動（含骨盆、腰椎、胸廓、肩帶、肱骨與前臂雙骨屈伸翻轉、下肢關節）
     */
    setTorsoPose(poseParams) {
        this._lastPose = { ...poseParams };
        let {
            pelvisRoll = 0,
            pelvisPitch = 0,
            pelvisYaw = 0,
            thoracicPitch = 0,
            thoracicYaw = 0,
            thoracicRoll = 0,
            lumbarPitch = 0,
            lumbarYaw = 0,
            lumbarRoll = 0,
            cervicalPitch = 0,
            cervicalYaw = 0,
            headPitch = 0,
            headYaw = 0,
            headRoll = 0,
            leftArmPitch = 0,
            leftArmRoll = 0.12,
            leftArmYaw = 0,
            rightArmPitch = 0,
            rightArmRoll = -0.12,
            rightArmYaw = 0,
            leftElbowFlex = 0.15,
            leftForearmTwist = 1.48,
            rightElbowFlex = 0.15,
            rightForearmTwist = 1.48,
            leftHandGesture = null,
            rightHandGesture = null,
            leftHandAngles = null,
            rightHandAngles = null,
            leftHipPitch = 0,
            leftHipRoll = 0.08,
            leftHipYaw = 0,
            rightHipPitch = 0,
            rightHipRoll = -0.08,
            rightHipYaw = 0,
            leftKneeFlex = 0.08,
            rightKneeFlex = 0.08,
            leftAnklePitch = -0.04,
            leftAnkleYaw = 0.12,
            leftAnkleRoll = 0,
            rightAnklePitch = -0.04,
            rightAnkleYaw = -0.12,
            rightAnkleRoll = 0,
            headToBodyRatio = null,
            skullScale = null
        } = poseParams;

        if (headToBodyRatio) {
            this.setHeadRatio(headToBodyRatio);
        } else if (skullScale) {
            this.headScale = skullScale;
            if (this.skullGroup) this.skullGroup.scale.setScalar(this.headScale);
        }

        // 1. 骨盆整體單元旋轉
        this.pelvisUnit.rotation.order = 'YXZ';
        this.pelvisUnit.rotation.x = pelvisPitch;
        this.pelvisUnit.rotation.y = pelvisYaw;
        this.pelvisUnit.rotation.z = pelvisRoll;

        // 2. 胸腔與骨盆相對轉角生理極限硬體約束 + 腰椎 5 節連續曲度分配
        let rawDiffYaw = thoracicYaw - pelvisYaw;
        while (rawDiffYaw > Math.PI) rawDiffYaw -= 2 * Math.PI;
        while (rawDiffYaw < -Math.PI) rawDiffYaw += 2 * Math.PI;

        const safeDiffPitch = THREE.MathUtils.clamp(thoracicPitch - pelvisPitch, -0.40, 0.40);
        const safeDiffYaw = THREE.MathUtils.clamp(rawDiffYaw, -0.45, 0.45);
        const safeDiffRoll = THREE.MathUtils.clamp(thoracicRoll - pelvisRoll, -0.35, 0.35);

        thoracicPitch = pelvisPitch + safeDiffPitch;
        thoracicYaw = pelvisYaw + safeDiffYaw;
        thoracicRoll = pelvisRoll + safeDiffRoll;

        const lCount = this.lumbarVertebrae.length;
        let accumPitch = pelvisPitch;
        let accumYaw = pelvisYaw;
        let accumRoll = pelvisRoll;

        const safeLumbarPitch = THREE.MathUtils.clamp(lumbarPitch || (safeDiffPitch * 0.65), -0.35, 0.35);
        const safeLumbarYaw = THREE.MathUtils.clamp(lumbarYaw || (safeDiffYaw * 0.65), -0.28, 0.28);
        const safeLumbarRoll = THREE.MathUtils.clamp(lumbarRoll || (safeDiffRoll * 0.65), -0.30, 0.30);

        this.lumbarVertebrae.forEach((vert) => {
            const rotX = safeLumbarPitch / lCount;
            const rotY = safeLumbarYaw / lCount;
            const rotZ = safeLumbarRoll / lCount;
            vert.rotation.x = rotX;
            vert.rotation.y = rotY;
            vert.rotation.z = rotZ;
            accumPitch += rotX;
            accumYaw += rotY;
            accumRoll += rotZ;
        });

        // 3. 胸椎與肋骨整體單元
        this.thoracicCageUnit.rotation.order = 'YXZ';
        this.thoracicCageUnit.rotation.x = thoracicPitch - accumPitch;
        this.thoracicCageUnit.rotation.y = thoracicYaw - accumYaw;
        this.thoracicCageUnit.rotation.z = thoracicRoll - accumRoll;

        // 4. 頸椎與寰枕關節頭骨旋轉
        const cCount = this.cervicalVertebrae.length;
        let accumCervicalRoll = 0;

        let diffNeckYaw = headYaw - thoracicYaw;
        while (diffNeckYaw > Math.PI) diffNeckYaw -= 2 * Math.PI;
        while (diffNeckYaw < -Math.PI) diffNeckYaw += 2 * Math.PI;
        const safeRelativeYaw = THREE.MathUtils.clamp(diffNeckYaw, -1.35, 1.35);
        const cervicalPartYaw = safeRelativeYaw * 0.65;
        const cranialPartYaw = safeRelativeYaw - cervicalPartYaw;

        let diffNeckRoll = headRoll - thoracicRoll;
        while (diffNeckRoll > Math.PI) diffNeckRoll -= 2 * Math.PI;
        while (diffNeckRoll < -Math.PI) diffNeckRoll += 2 * Math.PI;
        const safeRelativeRoll = THREE.MathUtils.clamp(diffNeckRoll, -0.75, 0.75);

        this.cervicalVertebrae.forEach((vert) => {
            vert.rotation.order = 'YXZ';
            const rotX = cervicalPitch / cCount;
            const rotY = cervicalPartYaw / cCount;
            const rotZ = safeRelativeRoll / cCount * 0.4;
            vert.rotation.x = rotX;
            vert.rotation.y = rotY;
            vert.rotation.z = rotZ;
            accumCervicalRoll += rotZ;
        });

        if (this.headJoint) {
            this.headJoint.rotation.order = 'YXZ';
            this.headJoint.rotation.x = headPitch;
            this.headJoint.rotation.y = cranialPartYaw;
            this.headJoint.rotation.z = safeRelativeRoll - accumCervicalRoll;
        }

        // 5. 左右大臂肱骨與肩胛胸壁 2:1 滑動節律
        const baseX = this.shoulderBaseX || 4.30;
        ['left', 'right'].forEach(side => {
            const sign = (side === 'left') ? 1 : -1;
            const armPitch = (side === 'left') ? leftArmPitch : rightArmPitch;
            const armRoll = (side === 'left') ? leftArmRoll : rightArmRoll;
            const armYaw = (side === 'left') ? leftArmYaw : rightArmYaw;
            const rec = this.shoulderGirdle[side];

            if (rec && rec.humerusJoint) {
                const j = rec.humerusJoint;
                j.rotation.order = 'YXZ';
                j.rotation.x = armPitch;
                j.rotation.y = armYaw;
                j.rotation.z = armRoll;

                const elev = Math.max(0, Math.hypot(armPitch, armRoll) - 0.35);
                const scapRot = Math.min(0.55, elev * 0.32);
                const scapElev = scapRot * 0.75;

                if (rec.scapula && rec.restScapulaPos) {
                    const ribZScale = this.ribcageGroup ? this.ribcageGroup.scale.z : 1.0;
                    rec.scapula.rotation.set(0, 0, 0);
                    rec.scapula.position.set(
                        sign * (baseX + scapRot * 0.20),
                        rec.restScapulaPos.y + scapElev,
                        rec.restScapulaPos.z * ribZScale + scapRot * 0.15
                    );
                    if (rec.scapulaMesh) {
                        rec.scapulaMesh.rotation.z = -sign * scapRot;
                        rec.scapulaMesh.rotation.y = -sign * scapRot * 0.15;
                    }
                }

                if (rec.clavicle) {
                    rec.clavicle.rotation.z = sign * scapRot * 0.65;
                    rec.clavicle.rotation.y = -sign * scapRot * 0.18;
                }
            }
        });

        // 6. 左右前臂肘關節屈曲與剛體橈骨旋前/旋後交叉
        if (this.shoulderGirdle.left.elbowJoint) {
            this.shoulderGirdle.left.elbowJoint.rotation.x = -leftElbowFlex;
            this._updateRadiusMesh('left', leftForearmTwist);
        }
        if (this.shoulderGirdle.right.elbowJoint) {
            this.shoulderGirdle.right.elbowJoint.rotation.x = -rightElbowFlex;
            this._updateRadiusMesh('right', rightForearmTwist);
        }

        // 7. 手部手勢與指骨連續角度更新
        if (leftHandGesture && leftHandGesture !== 'auto') {
            this.setHandGesture('left', leftHandGesture);
        } else if (leftHandAngles) {
            this.setFingerAngles('left', leftHandAngles);
        } else if (leftHandGesture) {
            this.setHandGesture('left', leftHandGesture);
        }

        if (rightHandGesture && rightHandGesture !== 'auto') {
            this.setHandGesture('right', rightHandGesture);
        } else if (rightHandAngles) {
            this.setFingerAngles('right', rightHandAngles);
        } else if (rightHandGesture) {
            this.setHandGesture('right', rightHandGesture);
        }

        // 8. 左右下肢 (髖、膝、踝)
        if (this.lowerLimbs.left.hipJoint) {
            const hL = this.lowerLimbs.left.hipJoint;
            hL.rotation.order = 'YXZ';
            hL.rotation.x = leftHipPitch;
            hL.rotation.y = leftHipYaw;
            hL.rotation.z = leftHipRoll;
        }
        if (this.lowerLimbs.left.kneeJoint) {
            this.lowerLimbs.left.kneeJoint.rotation.x = leftKneeFlex;
        }
        if (this.lowerLimbs.left.ankleJoint) {
            const aL = this.lowerLimbs.left.ankleJoint;
            aL.rotation.order = 'YXZ';
            aL.rotation.x = leftAnklePitch;
            aL.rotation.y = leftAnkleYaw;
            aL.rotation.z = leftAnkleRoll;
        }

        if (this.lowerLimbs.right.hipJoint) {
            const hR = this.lowerLimbs.right.hipJoint;
            hR.rotation.order = 'YXZ';
            hR.rotation.x = rightHipPitch;
            hR.rotation.y = rightHipYaw;
            hR.rotation.z = rightHipRoll;
        }
        if (this.lowerLimbs.right.kneeJoint) {
            this.lowerLimbs.right.kneeJoint.rotation.x = rightKneeFlex;
        }
        if (this.lowerLimbs.right.ankleJoint) {
            const aR = this.lowerLimbs.right.ankleJoint;
            aR.rotation.order = 'YXZ';
            aR.rotation.x = rightAnklePitch;
            aR.rotation.y = rightAnkleYaw;
            aR.rotation.z = rightAnkleRoll;
        }

        // 9. 同步更新附著肌肉幾何形態 (於接地前依局部關節矩陣重算)
        if (this.muscleSystem) {
            this.muscleSystem.update();
        }

        // 10. 地面自動吸附 (Auto Ground Snap)
        if (this.autoGroundSnap) {
            this.snapToGround(this.groundY);
        }
    }

    snapToGround(groundY = -25.5) {
        if (!this.rootGroup || !this.isMedicalLoaded) return 0;

        const prevY = this.rootGroup.position.y;
        this.rootGroup.position.y = 0;
        this.rootGroup.updateMatrixWorld(true);

        const bbox = new THREE.Box3().setFromObject(this.rootGroup);
        if (bbox.isEmpty()) {
            this.rootGroup.position.y = prevY;
            return prevY;
        }

        const targetOffsetY = groundY - bbox.min.y;
        this.rootGroup.position.y = targetOffsetY;
        this.rootGroup.updateMatrixWorld(true);
        return targetOffsetY;
    }

    toggleSkull(visible) {
        this.visibilityState.skull = visible;
        if (this.skullGroup) this.skullGroup.visible = visible;
        if (this.hyoidMesh) this.hyoidMesh.visible = visible;
    }

    toggleMuscles(visible) {
        if (this.muscleSystem) {
            this.muscleSystem.setVisible(visible);
        }
    }

    toggleRibcage(visible) {
        this.visibilityState.ribcage = visible;
        if (this.ribcageGroup) this.ribcageGroup.visible = visible;
    }

    toggleShoulderGirdle(visible) {
        this.visibilityState.shoulderGirdle = visible;
        ['left', 'right'].forEach(side => {
            if (this.shoulderGirdle[side].clavicle) {
                this.shoulderGirdle[side].clavicle.visible = visible;
            }
            if (this.shoulderGirdle[side].scapulaMesh) {
                this.shoulderGirdle[side].scapulaMesh.visible = visible;
            }
        });
    }

    toggleArms(visible) {
        this.visibilityState.arms = visible;
        ['left', 'right'].forEach(side => {
            if (this.shoulderGirdle[side].humerus) {
                this.shoulderGirdle[side].humerus.visible = visible;
            }
        });
    }

    toggleForearms(visible) {
        this.visibilityState.forearms = visible;
        ['left', 'right'].forEach(side => {
            if (this.shoulderGirdle[side].ulna) {
                this.shoulderGirdle[side].ulna.visible = visible;
            }
            if (this.shoulderGirdle[side].radiusGroup) {
                this.shoulderGirdle[side].radiusGroup.visible = visible;
            }
        });
    }

    toggleHands(visible) {
        this.visibilityState.hands = visible;
        ['left', 'right'].forEach(side => {
            if (this.shoulderGirdle[side].handGroup) {
                this.shoulderGirdle[side].handGroup.visible = visible;
            }
        });
    }

    togglePelvis(visible) {
        this.visibilityState.pelvis = visible;
        if (this.bonyPelvisGroup) {
            this.bonyPelvisGroup.visible = visible;
        }
    }

    toggleFemurs(visible) {
        this.visibilityState.femurs = visible;
        ['left', 'right'].forEach(side => {
            if (this.lowerLimbs[side].femur) {
                this.lowerLimbs[side].femur.visible = visible;
            }
            if (this.lowerLimbs[side].patella) {
                this.lowerLimbs[side].patella.visible = visible;
            }
        });
    }

    toggleLowerLegs(visible) {
        this.visibilityState.lowerLegs = visible;
        ['left', 'right'].forEach(side => {
            if (this.lowerLimbs[side].tibia) {
                this.lowerLimbs[side].tibia.visible = visible;
            }
            if (this.lowerLimbs[side].fibula) {
                this.lowerLimbs[side].fibula.visible = visible;
            }
        });
    }

    toggleFeet(visible) {
        this.visibilityState.feet = visible;
        ['left', 'right'].forEach(side => {
            if (this.lowerLimbs[side].footGroup) {
                this.lowerLimbs[side].footGroup.visible = visible;
            }
        });
    }
}
