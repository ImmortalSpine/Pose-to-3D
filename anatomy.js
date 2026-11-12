/**
 * AnatoPose 3D - Anatomical Skeleton Engine with Forearm Dual-Bone System (Ulna & Radius)
 * 
 * 核心前臂解剖自然結構：
 * 1. 尺骨 (Ulna - 內側固定軸)：
 *    - 近端具備特徵性「鷹嘴突 (Olecranon)」與冠突形成滑車切跡，與肱骨滑車形成純屈伸鉸鏈關節 (Humeroulnar Joint)
 *    - 遠端為尺骨頭與尺骨莖突 (小指側腕部重要骨點)
 * 2. 橈骨 (Radius - 外側旋轉骨)：
 *    - 近端為扁圓盤狀「橈骨頭 (Radial Head)」，在尺骨橈切跡與肱骨小頭上原地自轉
 *    - 橈骨幹呈現向外側之自然弧形弓 (Lateral Bow)
 *    - 遠端粗大扁平，具備橈骨莖突 (拇指側腕部重要骨點)
 * 3. 旋前與旋後剪刀交叉運動 (Pronation / Supination)：
 *    - 旋後 (Supination): 橈骨與尺骨平行並列
 *    - 旋前 (Pronation): 橈骨遠端以橈骨頭為軸心向前內側翻轉，斜向跨越 (Cross Over) 尺骨前方
 */

import * as THREE from 'three';

export class AnatomicalTorso {
    constructor() {
        this.rootGroup = new THREE.Group();
        this.rootGroup.name = "AnatomicalTorsoRoot";

        // 骨盆單元
        this.pelvisUnit = new THREE.Group();
        this.pelvisUnit.name = "Pelvis_Unit";
        this.rootGroup.add(this.pelvisUnit);

        this.pelvisBones = {
            sacrum: null, coccyx: null, iliumL: null, iliumR: null,
            ischiumL: null, ischiumR: null, pubisL: null, pubisR: null,
            pubicSymphysis: null
        };

        // 腰椎骨節
        this.lumbarVertebrae = [];
        this.lumbarGroup = new THREE.Group();
        this.lumbarGroup.name = "LumbarSpine_Group";
        this.pelvisUnit.add(this.lumbarGroup);

        // 胸椎與肋骨整體單元
        this.thoracicCageUnit = new THREE.Group();
        this.thoracicCageUnit.name = "ThoracicCage_Unit";
        this.lumbarGroup.add(this.thoracicCageUnit);

        this.thoracicVertebrae = [];
        this.ribsLeft = [];
        this.ribsRight = [];
        this.sternum = null;

        // 肩帶與上肢 (含大臂肱骨、前臂尺骨與橈骨、手腕與掌指骨)
        this.shoulderGirdle = {
            left: {
                clavicle: null, scapula: null, humerus: null, humerusJoint: null,
                elbowJoint: null, ulna: null, radiusGroup: null, radiusMesh: null,
                handGroup: null, handMesh: null, handJoints: null, currentGesture: 'relaxed'
            },
            right: {
                clavicle: null, scapula: null, humerus: null, humerusJoint: null,
                elbowJoint: null, ulna: null, radiusGroup: null, radiusMesh: null,
                handGroup: null, handMesh: null, handJoints: null, currentGesture: 'relaxed'
            }
        };

        // 下肢骨骼系統 (含股骨、大轉子、髕骨、脛骨、腓骨、足部骨骼)
        this.lowerLimbs = {
            left: {
                hipJoint: null, femur: null, patella: null,
                kneeJoint: null, tibia: null, fibula: null,
                ankleJoint: null, footGroup: null, footMesh: null
            },
            right: {
                hipJoint: null, femur: null, patella: null,
                kneeJoint: null, tibia: null, fibula: null,
                ankleJoint: null, footGroup: null, footMesh: null
            }
        };

        // 頸椎骨節與藝用解剖頭骨系統
        this.cervicalVertebrae = [];
        this.cervicalGroup = new THREE.Group();
        this.cervicalGroup.name = "CervicalSpine_Group";
        this.thoracicCageUnit.add(this.cervicalGroup);
        this.headJoint = null;
        this.skullGroup = null;

        this.landmarks = {};

        // 材質
        this.materials = {
            bone: new THREE.MeshStandardMaterial({
                color: 0xede4d5,
                roughness: 0.38,
                metalness: 0.05
            }),
            boneHighlight: new THREE.MeshStandardMaterial({
                color: 0xf5eedb,
                roughness: 0.32,
                metalness: 0.08
            }),
            pelvisWing: new THREE.MeshStandardMaterial({
                color: 0xe8ddcb,
                roughness: 0.35,
                metalness: 0.06
            }),
            cartilage: new THREE.MeshStandardMaterial({
                color: 0x82b2bd,
                roughness: 0.25,
                metalness: 0.1,
                transparent: true,
                opacity: 0.88
            }),
            disc: new THREE.MeshStandardMaterial({
                color: 0x5a554c,
                roughness: 0.8
            }),
            landmark: new THREE.MeshBasicMaterial({
                color: 0xff3366
            })
        };

        this._buildAnatomy();
    }

    _buildAnatomy() {
        this._buildPelvis();

        // 腰椎 (L5 -> L1)
        const lumbarHeight = 1.35;
        let parentNode = this.lumbarGroup;
        this.lumbarGroup.position.set(0, 0.4, -0.6);

        for (let i = 0; i < 5; i++) {
            const lIndex = 5 - i;
            const vert = this._createVertebraMesh(`L${lIndex}`, 2.3 - i * 0.08, lumbarHeight, 'lumbar');
            vert.position.set(0, (i === 0) ? 0 : lumbarHeight, Math.sin((i / 4) * Math.PI) * 0.25);
            parentNode.add(vert);
            this.lumbarVertebrae.push(vert);
            parentNode = vert;
        }

        parentNode.add(this.thoracicCageUnit);
        this.thoracicCageUnit.position.set(0, lumbarHeight, 0);

        // 胸廓 (T1-T12, 12對肋骨, 胸骨)
        const thoracicHeight = 1.05;
        const totalThoracic = 12;

        this.sternum = this._createSternumMesh();
        this.sternum.position.set(0, 7.8, 5.0);
        this.sternum.rotation.x = -0.12;
        this.thoracicCageUnit.add(this.sternum);

        this._addLandmark("SuprasternalNotch", new THREE.Vector3(0, 11.2, 4.3), this.thoracicCageUnit);
        this._addLandmark("XiphoidProcess", new THREE.Vector3(0, 4.4, 5.5), this.thoracicCageUnit);

        const ribWidths = [
            2.0, 2.6, 3.2, 3.8, 4.3, 4.6, 4.8, 4.7, 4.4, 3.8, 3.0, 2.2
        ];

        let tParent = this.thoracicCageUnit;
        for (let i = 0; i < totalThoracic; i++) {
            const tIndex = 12 - i;
            const vert = this._createVertebraMesh(`T${tIndex}`, 1.9 - i * 0.05, thoracicHeight, 'thoracic');
            
            const kyphosisZ = -Math.sin((i / 11) * Math.PI) * 0.9;
            vert.position.set(0, (i === 0) ? 0 : thoracicHeight, kyphosisZ * 0.15);
            tParent.add(vert);
            this.thoracicVertebrae.push(vert);

            const ribNum = tIndex;
            const w = ribWidths[ribNum - 1];

            const ribL = this._createRibWithSternumAttachment(ribNum, w, 'left');
            vert.add(ribL);
            this.ribsLeft.push(ribL);

            const ribR = this._createRibWithSternumAttachment(ribNum, w, 'right');
            vert.add(ribR);
            this.ribsRight.push(ribR);

            tParent = vert;
        }

        // 上肢系統 (鎖骨、肩胛骨、肩胛岡、肱骨、尺骨、橈骨)
        this._buildUpperLimb('left');
        this._buildUpperLimb('right');

        // 下肢系統 (髖關節、股骨、大轉子、髕骨、脛骨、腓骨、足骨)
        this._buildLowerLimb('left');
        this._buildLowerLimb('right');

        // 頸椎 (C7 -> C1) - 標準人體解剖學黃金比例 (長度約 4.6~4.8 單位，佔胸椎之 40%)
        const cervicalHeight = 0.58;
        tParent.add(this.cervicalGroup);
        this.cervicalGroup.position.set(0, 0.80, 0);

        let cParent = this.cervicalGroup;
        for (let i = 0; i < 7; i++) {
            const cIndex = 7 - i;
            const vert = this._createVertebraMesh(`C${cIndex}`, 1.30 - i * 0.02, cervicalHeight, 'cervical');
            vert.position.set(0, (i === 0) ? 0 : cervicalHeight, Math.sin((i / 6) * Math.PI) * 0.12);
            cParent.add(vert);
            this.cervicalVertebrae.push(vert);
            cParent = vert;
        }

        // 寰枕關節與藝用解剖頭骨系統 (Atlanto-Occipital Joint & Skull)
        this.headJoint = new THREE.Group();
        this.headJoint.name = "AtlantoOccipital_Joint";
        this.headJoint.position.set(0, 0.55, 0.08);
        cParent.add(this.headJoint);

        this.skullGroup = this._createSkullMesh();
        this.headJoint.add(this.skullGroup);

        this._addLandmark("HeadBase", new THREE.Vector3(0, 0, 0), this.headJoint);
        this._addLandmark("SkullCrown", new THREE.Vector3(0, 3.8, -0.2), this.headJoint);
        this._addLandmark("Glabella", new THREE.Vector3(0, 1.65, 1.30), this.headJoint);
        this._addLandmark("ChinPoint", new THREE.Vector3(0, -0.68, 1.25), this.headJoint);
        this._addLandmark("Zygomatic_L", new THREE.Vector3(1.45, 0.90, 0.95), this.headJoint);
        this._addLandmark("Zygomatic_R", new THREE.Vector3(-1.45, 0.90, 0.95), this.headJoint);
    }

    /**
     * 建立一側的上肢骨骼鏈 (胸鎖 -> 鎖骨 -> 肩胛/肩胛岡 -> 盂肱 -> 肱骨 -> 肘關節 -> 尺骨 & 橈骨)
     */
    _buildUpperLimb(side) {
        const sign = (side === 'left') ? 1 : -1;

        // 1. 胸鎖關節 (SC Joint)
        const scJoint = new THREE.Group();
        scJoint.name = `SC_Joint_${side}`;
        scJoint.position.set(sign * 1.15, 10.2, 4.6);
        this.thoracicCageUnit.add(scJoint);

        const clavicleMesh = this._createClavicleMesh(side);
        scJoint.add(clavicleMesh);
        this.shoulderGirdle[side].clavicle = scJoint;

        // 2. 肩胛骨 (背側 Z <= -0.8)
        const acromialRelative = new THREE.Vector3(sign * 5.0, -0.2, -5.4);
        const scapulaUnit = new THREE.Group();
        scapulaUnit.name = `Scapula_Unit_${side}`;
        scapulaUnit.position.copy(acromialRelative);
        scJoint.add(scapulaUnit);

        const scapulaMesh = this._createScapulaMesh(side);
        scapulaUnit.add(scapulaMesh);
        this.shoulderGirdle[side].scapula = scapulaUnit;

        // 3. 盂肱關節 (GH Joint)
        const ghJoint = new THREE.Group();
        ghJoint.name = `GH_Joint_${side}`;
        ghJoint.position.set(sign * 0.35, -1.2, 0.2);
        scapulaUnit.add(ghJoint);

        // 4. 肱骨 (Humerus)
        const humerusMesh = this._createHumerusMesh(side);
        ghJoint.add(humerusMesh);
        this.shoulderGirdle[side].humerus = humerusMesh;
        this.shoulderGirdle[side].humerusJoint = ghJoint;
        ghJoint.rotation.order = 'YXZ';
        ghJoint.rotation.z = sign * 0.12; // 預設自然微提攜角

        // 5. 肘關節 (Elbow / Humeroulnar Hinge Joint)
        // 位於肱骨下端 (armLength = 8.5)
        const armLength = 8.5;
        const elbowJoint = new THREE.Group();
        elbowJoint.name = `Elbow_Joint_${side}`;
        elbowJoint.position.set(0, -armLength, 0);
        ghJoint.add(elbowJoint);
        this.shoulderGirdle[side].elbowJoint = elbowJoint;

        // 6. 尺骨 (Ulna) - 內側固定軸，後方帶鷹嘴突
        const ulnaMesh = this._createUlnaMesh(side);
        elbowJoint.add(ulnaMesh);
        this.shoulderGirdle[side].ulna = ulnaMesh;

        // 7. 橈骨組件 (Radius Unit) - 外側旋轉骨，支援剪刀交叉
        const radiusGroup = new THREE.Group();
        radiusGroup.name = `Radius_Group_${side}`;
        elbowJoint.add(radiusGroup);
        this.shoulderGirdle[side].radiusGroup = radiusGroup;

        // 8. 手掌骨骼系統 (Carpals, Metacarpals, Phalanges)
        // 依附於肘關節坐標系，並於 _updateRadiusMesh 中與橈骨遠端 pEnd 動態旋轉翻轉緊密鎖定
        const handGroup = new THREE.Group();
        handGroup.name = `Hand_Group_${side}`;
        elbowJoint.add(handGroup);
        this.shoulderGirdle[side].handGroup = handGroup;

        // 建立完整手部骨骼結構與指節關節鏈
        const handData = this._buildHandMesh(side, 'relaxed');
        handGroup.add(handData.mesh);
        this.shoulderGirdle[side].handMesh = handData.mesh;
        this.shoulderGirdle[side].handJoints = handData.joints;

        // 初始化平行旋後姿態的橈骨與手掌
        this._updateRadiusMesh(side, 0.2); // 預設微旋前

        // 標記關鍵解剖骨點
        this._addLandmark(`Olecranon_${side}`, new THREE.Vector3(sign * 6.2, 1.5, -1.6), this.thoracicCageUnit);
        this._addLandmark(`AcromionPoint_${side}`, new THREE.Vector3(sign * 6.2, 10.0, -0.8), this.thoracicCageUnit);
    }

    /**
     * 建立一側下肢骨骼鏈 (髖關節 -> 股骨/大轉子 -> 膝關節/髕骨 -> 脛骨/腓骨 -> 踝關節 -> 完整足骨)
     */
    _buildLowerLimb(side) {
        const sign = (side === 'left') ? 1 : -1;

        // 1. 髖關節 (Hip Joint / Acetabulofemoral Joint) - 坐標緊扣骨盆髖臼窩 (sign * 3.6, -3.4, 0.6)
        const hipJoint = new THREE.Group();
        hipJoint.name = `Hip_Joint_${side}`;
        hipJoint.position.set(sign * 3.6, -3.4, 0.6);
        this.pelvisUnit.add(hipJoint);
        this.lowerLimbs[side].hipJoint = hipJoint;
        hipJoint.rotation.order = 'YXZ';

        // 2. 股骨總成 (Femur: 股骨頭、股骨頸、大轉子、小轉子、股骨幹、股骨內外側髁)
        const femurMesh = this._createFemurMesh(side);
        hipJoint.add(femurMesh);
        this.lowerLimbs[side].femur = femurMesh;

        // 3. 髕骨 (Patella - 膝蓋骨，位於股骨下端滑車面)
        const femurLen = 10.5;
        const patellaMesh = this._createPatellaMesh(side);
        patellaMesh.position.set(0, -femurLen + 0.35, 0.72);
        hipJoint.add(patellaMesh);
        this.lowerLimbs[side].patella = patellaMesh;

        // 4. 膝關節 (Knee Joint) - 單向橫軸鉸鏈 (屈曲向後折疊)
        const kneeJoint = new THREE.Group();
        kneeJoint.name = `Knee_Joint_${side}`;
        kneeJoint.position.set(0, -femurLen, 0);
        hipJoint.add(kneeJoint);
        this.lowerLimbs[side].kneeJoint = kneeJoint;

        // 5. 脛骨 (Tibia: 內側承重粗骨、脛骨粗隆、迎面骨前脊、內踝)
        const tibiaMesh = this._createTibiaMesh(side);
        kneeJoint.add(tibiaMesh);
        this.lowerLimbs[side].tibia = tibiaMesh;

        // 6. 腓骨 (Fibula: 外側細骨、腓骨頭、外踝)
        const fibulaMesh = this._createFibulaMesh(side);
        kneeJoint.add(fibulaMesh);
        this.lowerLimbs[side].fibula = fibulaMesh;

        // 7. 踝關節 (Ankle Joint / Mortise)
        const tibiaLen = 9.6;
        const ankleJoint = new THREE.Group();
        ankleJoint.name = `Ankle_Joint_${side}`;
        ankleJoint.position.set(-sign * 0.15, -tibiaLen, 0);
        kneeJoint.add(ankleJoint);
        this.lowerLimbs[side].ankleJoint = ankleJoint;
        ankleJoint.rotation.order = 'YXZ';

        // 8. 足部骨骼系統 (Foot: 距骨、跟骨結節、跗骨、5根蹠骨、14節趾骨)
        const footData = this._buildFootMesh(side);
        ankleJoint.add(footData.mesh);
        this.lowerLimbs[side].footGroup = footData.mesh;
        this.lowerLimbs[side].footMesh = footData.mesh;

        // 關鍵解剖骨點標記 (Landmarks)
        this._addLandmark(`GreaterTrochanter_${side}`, new THREE.Vector3(sign * 5.2, -4.2, 0.4), this.pelvisUnit);
        this._addLandmark(`PatellaPoint_${side}`, new THREE.Vector3(sign * 3.6, -13.5, 1.3), this.pelvisUnit);
        this._addLandmark(`FibulaHead_${side}`, new THREE.Vector3(sign * 4.6, -14.2, 0.1), this.pelvisUnit);
        this._addLandmark(`MedialMalleolus_${side}`, new THREE.Vector3(sign * 3.1, -23.5, 0.3), this.pelvisUnit);
        this._addLandmark(`LateralMalleolus_${side}`, new THREE.Vector3(sign * 4.5, -23.9, -0.1), this.pelvisUnit);
    }

    /**
     * 建立股骨 (Femur: 大腿骨)
     * 含股骨頭、股骨頸、大轉子 (Greater Trochanter)、小轉子、微前凸骨幹與雙髁
     */
    _createFemurMesh(side) {
        const sign = (side === 'left') ? 1 : -1;
        const group = new THREE.Group();
        group.name = `Femur_${side}`;

        const femurLen = 10.5;

        // 1. 股骨頭 (Femoral Head: 球體嵌合於髖臼)
        const headGeo = new THREE.SphereGeometry(0.78, 16, 16);
        const headMesh = new THREE.Mesh(headGeo, this.materials.bone);
        headMesh.position.set(0, 0, 0);
        group.add(headMesh);

        // 2. 股骨頸 (Femoral Neck: 解剖頸幹角 ~126°，由股骨頭向外下方延伸)
        const neckCurve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(sign * 0.7, -0.45, 0),
            new THREE.Vector3(sign * 1.35, -0.9, 0)
        ]);
        const neckGeo = new THREE.TubeGeometry(neckCurve, 10, 0.46, 8, false);
        const neckMesh = new THREE.Mesh(neckGeo, this.materials.bone);
        neckMesh.castShadow = true;
        group.add(neckMesh);

        // 3. 大轉子 (Greater Trochanter - 關鍵藝用骨標誌)
        // 位於股骨頸末端外側頂部，形成髖部最寬體表骨點
        const trochanterGeo = new THREE.BoxGeometry(0.95, 1.35, 1.1);
        const trochanterMesh = new THREE.Mesh(trochanterGeo, this.materials.boneHighlight);
        trochanterMesh.position.set(sign * 1.7, -0.8, 0.05);
        trochanterMesh.rotation.z = -sign * 0.15;
        group.add(trochanterMesh);

        // 轉子窩 (Trochanteric Fossa - 內側面凹窩)
        const fossaGeo = new THREE.BoxGeometry(0.4, 0.6, 0.5);
        const fossaMesh = new THREE.Mesh(fossaGeo, this.materials.bone);
        fossaMesh.position.set(sign * 1.25, -1.0, -0.2);
        group.add(fossaMesh);

        // 4. 小轉子 (Lesser Trochanter - 內後側圓錐突起)
        const lesserGeo = new THREE.ConeGeometry(0.35, 0.55, 8);
        const lesserMesh = new THREE.Mesh(lesserGeo, this.materials.boneHighlight);
        lesserMesh.rotation.z = sign * Math.PI * 0.45;
        lesserMesh.rotation.x = -Math.PI * 0.35;
        lesserMesh.position.set(sign * 0.7, -1.75, -0.45);
        group.add(lesserMesh);

        // 5. 股骨幹 (Femoral Shaft)
        // 帶有生理前凸 (Anterior Bow) 與向內收斜向膝蓋的提攜角 (Q-angle)
        const p0 = new THREE.Vector3(sign * 1.4, -1.2, 0);
        const p1 = new THREE.Vector3(sign * 0.9, -femurLen * 0.35, 0.35);
        const p2 = new THREE.Vector3(sign * 0.45, -femurLen * 0.68, 0.38);
        const p3 = new THREE.Vector3(0, -femurLen + 0.85, 0);

        const shaftCurve = new THREE.CatmullRomCurve3([p0, p1, p2, p3]);
        const shaftGeo = new THREE.TubeGeometry(shaftCurve, 20, 0.42, 10, false);
        const shaftMesh = new THREE.Mesh(shaftGeo, this.materials.bone);
        shaftMesh.castShadow = true;
        group.add(shaftMesh);

        // 6. 股骨遠端膨大部與雙髁 (Femoral Distal Condyles)
        // 內側髁 (Medial Condyle)
        const medialCondyleGeo = new THREE.SphereGeometry(0.68, 12, 12);
        const medialCondyleMesh = new THREE.Mesh(medialCondyleGeo, this.materials.bone);
        medialCondyleMesh.scale.set(0.75, 1.0, 1.25);
        medialCondyleMesh.position.set(-sign * 0.55, -femurLen, -0.15);
        group.add(medialCondyleMesh);

        // 外側髁 (Lateral Condyle)
        const lateralCondyleGeo = new THREE.SphereGeometry(0.65, 12, 12);
        const lateralCondyleMesh = new THREE.Mesh(lateralCondyleGeo, this.materials.bone);
        lateralCondyleMesh.scale.set(0.72, 1.0, 1.2);
        lateralCondyleMesh.position.set(sign * 0.55, -femurLen, -0.15);
        group.add(lateralCondyleMesh);

        // 髕骨滑車槽 (Patellar Surface - 前側凹槽)
        const trochleaGeo = new THREE.CylinderGeometry(0.55, 0.65, 0.95, 10);
        const trochleaMesh = new THREE.Mesh(trochleaGeo, this.materials.bone);
        trochleaMesh.rotation.z = Math.PI * 0.5;
        trochleaMesh.position.set(0, -femurLen + 0.35, 0.25);
        group.add(trochleaMesh);

        return group;
    }

    /**
     * 建立髕骨 (Patella - 倒心形膝蓋骨籽骨)
     */
    _createPatellaMesh(side) {
        const group = new THREE.Group();
        group.name = `Patella_${side}`;

        const patellaShape = new THREE.Shape();
        patellaShape.moveTo(-0.45, 0.55);
        patellaShape.lineTo(0.45, 0.55);
        patellaShape.lineTo(0.40, 0.0);
        patellaShape.lineTo(0.0, -0.6); // 髕骨尖 (Apex) 朝下
        patellaShape.lineTo(-0.40, 0.0);
        patellaShape.closePath();

        const extrudeSettings = { depth: 0.32, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.1, bevelThickness: 0.1 };
        const patellaGeo = new THREE.ExtrudeGeometry(patellaShape, extrudeSettings);
        const patellaMesh = new THREE.Mesh(patellaGeo, this.materials.boneHighlight);
        patellaMesh.position.set(0, 0, -0.15);
        patellaMesh.castShadow = true;
        group.add(patellaMesh);

        return group;
    }

    /**
     * 建立脛骨 (Tibia - 內側粗大承重骨)
     * 含脛骨平台、脛骨粗隆、前脊迎面骨與內踝 (Medial Malleolus)
     */
    _createTibiaMesh(side) {
        const sign = (side === 'left') ? 1 : -1;
        const group = new THREE.Group();
        group.name = `Tibia_${side}`;

        const tibiaLen = 9.6;

        // 1. 脛骨平台 (Tibial Plateau: 承接股骨雙髁)
        const plateauGeo = new THREE.CylinderGeometry(0.85, 0.78, 0.65, 14);
        const plateauMesh = new THREE.Mesh(plateauGeo, this.materials.bone);
        plateauMesh.scale.set(1.25, 1.0, 1.0);
        plateauMesh.position.set(-sign * 0.1, -0.32, 0);
        group.add(plateauMesh);

        // 髁間隆起 (Intercondylar Eminence - 中央棘)
        const spineGeo = new THREE.ConeGeometry(0.2, 0.45, 6);
        const spineMesh = new THREE.Mesh(spineGeo, this.materials.boneHighlight);
        spineMesh.position.set(-sign * 0.1, 0.15, 0);
        group.add(spineMesh);

        // 2. 脛骨粗隆 (Tibial Tuberosity - 髕韌帶附著點，前側凸起)
        const tuberosityGeo = new THREE.BoxGeometry(0.55, 0.75, 0.65);
        const tuberosityMesh = new THREE.Mesh(tuberosityGeo, this.materials.boneHighlight);
        tuberosityMesh.position.set(-sign * 0.1, -0.85, 0.55);
        group.add(tuberosityMesh);

        // 3. 脛骨幹 (Shaft) 與前脊迎面骨 (Anterior Crest)
        const p0 = new THREE.Vector3(-sign * 0.1, -0.65, 0.1);
        const p1 = new THREE.Vector3(-sign * 0.08, -tibiaLen * 0.45, 0.22);
        const p2 = new THREE.Vector3(-sign * 0.15, -tibiaLen, 0.05);

        const curve = new THREE.CatmullRomCurve3([p0, p1, p2]);
        const shaftGeo = new THREE.TubeGeometry(curve, 18, 0.40, 8, false);
        const shaftMesh = new THREE.Mesh(shaftGeo, this.materials.bone);
        shaftMesh.castShadow = true;
        group.add(shaftMesh);

        // 脛骨前脊骨線 (迎面骨銳利前緣)
        const crestP0 = new THREE.Vector3(-sign * 0.1, -1.0, 0.55);
        const crestP1 = new THREE.Vector3(-sign * 0.08, -tibiaLen * 0.5, 0.42);
        const crestP2 = new THREE.Vector3(-sign * 0.22, -tibiaLen * 0.88, 0.25);
        const crestCurve = new THREE.CatmullRomCurve3([crestP0, crestP1, crestP2]);
        const crestGeo = new THREE.TubeGeometry(crestCurve, 12, 0.12, 6, false);
        const crestMesh = new THREE.Mesh(crestGeo, this.materials.boneHighlight);
        group.add(crestMesh);

        // 4. 內踝 (Medial Malleolus - 內側腳踝凸起)
        const malleolusGeo = new THREE.BoxGeometry(0.52, 0.85, 0.75);
        const malleolusMesh = new THREE.Mesh(malleolusGeo, this.materials.boneHighlight);
        malleolusMesh.position.set(-sign * 0.6, -tibiaLen - 0.25, 0.05);
        group.add(malleolusMesh);

        // 下關節面 (Inferior Articular Surface)
        const articularGeo = new THREE.BoxGeometry(0.85, 0.35, 0.85);
        const articularMesh = new THREE.Mesh(articularGeo, this.materials.bone);
        articularMesh.position.set(-sign * 0.15, -tibiaLen - 0.15, 0.05);
        group.add(articularMesh);

        return group;
    }

    /**
     * 建立腓骨 (Fibula - 外側細長輔助骨)
     * 含腓骨頭 (Fibular Head) 與外踝 (Lateral Malleolus)
     */
    _createFibulaMesh(side) {
        const sign = (side === 'left') ? 1 : -1;
        const group = new THREE.Group();
        group.name = `Fibula_${side}`;

        const tibiaLen = 9.6;

        // 1. 腓骨頭 (Fibular Head - 膝蓋外下方圓球狀骨點)
        const headGeo = new THREE.SphereGeometry(0.38, 10, 10);
        const headMesh = new THREE.Mesh(headGeo, this.materials.boneHighlight);
        headMesh.position.set(sign * 0.95, -0.65, -0.2);
        group.add(headMesh);

        // 2. 腓骨幹 (Shaft - 細長管狀骨)
        const p0 = new THREE.Vector3(sign * 0.95, -0.85, -0.2);
        const p1 = new THREE.Vector3(sign * 0.92, -tibiaLen * 0.5, -0.15);
        const p2 = new THREE.Vector3(sign * 0.85, -tibiaLen * 0.92, -0.18);

        const curve = new THREE.CatmullRomCurve3([p0, p1, p2]);
        const shaftGeo = new THREE.TubeGeometry(curve, 16, 0.18, 6, false);
        const shaftMesh = new THREE.Mesh(shaftGeo, this.materials.bone);
        shaftMesh.castShadow = true;
        group.add(shaftMesh);

        // 3. 外踝 (Lateral Malleolus - 外側腳踝凸起，比內踝更低、更靠後)
        const malleolusGeo = new THREE.BoxGeometry(0.48, 0.95, 0.72);
        const malleolusMesh = new THREE.Mesh(malleolusGeo, this.materials.boneHighlight);
        malleolusMesh.position.set(sign * 0.85, -tibiaLen - 0.55, -0.15);
        group.add(malleolusMesh);

        return group;
    }

    /**
     * 建立完整足部骨骼系統 (Foot Skeleton)
     * 含距骨 (Talus)、跟骨結節 (Calcaneus)、跗骨群 (Tarsals)、5 根蹠骨 (Metatarsals) 與 14 節趾骨 (Phalanges)
     */
    _buildFootMesh(side) {
        const sign = (side === 'left') ? 1 : -1;
        const group = new THREE.Group();
        group.name = `Foot_${side}`;

        // 1. 距骨 (Talus - 鞍狀滑車，嵌合於內外踝之間)
        const talusGeo = new THREE.BoxGeometry(0.9, 0.7, 1.1);
        const talusMesh = new THREE.Mesh(talusGeo, this.materials.bone);
        talusMesh.position.set(0, -0.35, 0.1);
        group.add(talusMesh);

        // 2. 跟骨 (Calcaneus - 足跟結節，向後突出承受體重)
        const heelGeo = new THREE.BoxGeometry(0.95, 0.9, 1.9);
        const heelMesh = new THREE.Mesh(heelGeo, this.materials.boneHighlight);
        heelMesh.position.set(-sign * 0.05, -0.95, -0.85);
        heelMesh.castShadow = true;
        group.add(heelMesh);

        // 3. 跗骨群 (Tarsals - 舟狀骨、骰骨、三塊楔狀骨形成足縱弓)
        const tarsalGeo = new THREE.BoxGeometry(1.25, 0.65, 1.2);
        const tarsalMesh = new THREE.Mesh(tarsalGeo, this.materials.bone);
        tarsalMesh.position.set(0, -0.65, 1.15);
        group.add(tarsalMesh);

        // 4. 蹠骨 (5 Metatarsal Bones - 呈弧形放射狀分佈)
        const metatarsalWidths = [0.22, 0.18, 0.17, 0.16, 0.18];
        const metatarsalLengths = [1.8, 2.05, 1.95, 1.85, 1.75];

        for (let i = 0; i < 5; i++) {
            const rayX = -sign * 0.45 + (sign * i * 0.22);
            const w = metatarsalWidths[i];
            const len = metatarsalLengths[i];

            const p0 = new THREE.Vector3(rayX * 0.85, -0.65, 1.6);
            const p1 = new THREE.Vector3(rayX, -0.85, 1.6 + len);

            const mCurve = new THREE.CatmullRomCurve3([p0, p1]);
            const mGeo = new THREE.TubeGeometry(mCurve, 6, w, 6, false);
            const mMesh = new THREE.Mesh(mGeo, this.materials.bone);
            group.add(mMesh);

            // 蹠骨頭 (Metatarsal Head - 蹠趾關節)
            const headGeo = new THREE.SphereGeometry(w * 1.25, 8, 8);
            const headMesh = new THREE.Mesh(headGeo, this.materials.boneHighlight);
            headMesh.position.copy(p1);
            group.add(headMesh);

            // 5. 趾骨群 (Phalanges - 大拇趾 2 節，其餘各 3 節)
            const phalanCount = (i === 0) ? 2 : 3;
            let pPrev = p1.clone();
            const segLen = (i === 0) ? 0.48 : 0.32;

            for (let ph = 0; ph < phalanCount; ph++) {
                const pNext = pPrev.clone().add(new THREE.Vector3(0, -0.05, segLen));
                const pCurv = new THREE.CatmullRomCurve3([pPrev, pNext]);
                const pGeo = new THREE.TubeGeometry(pCurv, 4, w * 0.85, 6, false);
                const pMesh = new THREE.Mesh(pGeo, this.materials.bone);
                group.add(pMesh);
                pPrev = pNext;
            }
        }

        // 第五蹠骨粗隆 (Tuberosity of 5th Metatarsal - 腳外側體表骨點)
        const tub5Geo = new THREE.SphereGeometry(0.25, 6, 6);
        const tub5Mesh = new THREE.Mesh(tub5Geo, this.materials.boneHighlight);
        tub5Mesh.position.set(sign * 0.65, -0.8, 1.7);
        group.add(tub5Mesh);

        return { mesh: group };
    }

    /**
     * 建立尺骨 (Ulna: 內側軸心骨，近端帶鷹嘴突，遠端帶尺骨頭與莖突)
     */
    _createUlnaMesh(side) {
        const sign = (side === 'left') ? 1 : -1;
        const group = new THREE.Group();
        group.name = `Ulna_${side}`;

        const ulnaLen = 7.6; // 前臂標準解剖長度
        const medialOffsetX = -sign * 0.38; // 尺骨位於前臂內側 (小指側)

        // 1. 鷹嘴突 (Olecranon Process - 肘後尖銳骨點，屈肘時最突出)
        const olecranonGeo = new THREE.BoxGeometry(0.55, 0.75, 0.75);
        const olecranonMesh = new THREE.Mesh(olecranonGeo, this.materials.boneHighlight);
        olecranonMesh.position.set(medialOffsetX, 0.15, -0.32);
        group.add(olecranonMesh);

        // 滑車切跡 (Trochlear Notch)
        const notchGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.5, 8);
        const notchMesh = new THREE.Mesh(notchGeo, this.materials.bone);
        notchMesh.rotation.z = Math.PI * 0.5;
        notchMesh.position.set(medialOffsetX, 0.0, 0.0);
        group.add(notchMesh);

        // 2. 尺骨幹 (Ulna Shaft - 近端粗、遠端細，微帶 S 弧)
        const p0 = new THREE.Vector3(medialOffsetX, 0, 0);
        const p1 = new THREE.Vector3(medialOffsetX - sign * 0.08, -ulnaLen * 0.45, -0.05);
        const p2 = new THREE.Vector3(medialOffsetX, -ulnaLen, 0);

        const curve = new THREE.CatmullRomCurve3([p0, p1, p2]);
        const shaftGeo = new THREE.TubeGeometry(curve, 16, 0.26, 8, false);
        const shaftMesh = new THREE.Mesh(shaftGeo, this.materials.bone);
        shaftMesh.castShadow = true;
        group.add(shaftMesh);

        // 3. 遠端尺骨頭與尺骨莖突 (Ulna Head & Styloid Process - 小指側手腕突起骨點)
        const headGeo = new THREE.SphereGeometry(0.32, 10, 10);
        const headMesh = new THREE.Mesh(headGeo, this.materials.boneHighlight);
        headMesh.position.set(medialOffsetX, -ulnaLen, 0);
        group.add(headMesh);

        const styloidGeo = new THREE.ConeGeometry(0.12, 0.45, 6);
        const styloidMesh = new THREE.Mesh(styloidGeo, this.materials.boneHighlight);
        styloidMesh.rotation.x = Math.PI;
        styloidMesh.position.set(medialOffsetX - sign * 0.1, -ulnaLen - 0.25, -0.05);
        group.add(styloidMesh);

        return group;
    }

    /**
     * 動態生成橈骨 (Radius) 並還原旋前/旋後剪刀交叉形變 (Pronation/Supination)
     * @param {string} side - 'left' 或 'right'
     * @param {number} twistAngle - 0 為完全旋後平行；PI 為完全旋前交叉
     */
    _updateRadiusMesh(side, twistAngle = 0) {
        const sign = (side === 'left') ? 1 : -1;
        const radiusGroup = this.shoulderGirdle[side].radiusGroup;
        if (!radiusGroup) return;

        // 清除先前的橈骨網格
        while (radiusGroup.children.length > 0) {
            const obj = radiusGroup.children[0];
            radiusGroup.remove(obj);
            if (obj.geometry) obj.geometry.dispose();
        }

        const group = new THREE.Group();
        group.name = `Radius_Dynamic_${side}`;

        const radiusLen = 7.4;
        const lateralOffsetX = sign * 0.45; // 近端橈骨頭位於外側 (拇指側)

        // 1. 橈骨頭 (Radial Head - 圓盤狀扁圓柱，在肱骨小頭與尺骨切跡處原地自轉)
        const headGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.35, 12);
        const headMesh = new THREE.Mesh(headGeo, this.materials.boneHighlight);
        headMesh.position.set(lateralOffsetX, 0.05, 0);
        group.add(headMesh);

        // 橈骨頸與橈骨粗隆 (Biceps Tuberosity)
        const tuberosityGeo = new THREE.BoxGeometry(0.25, 0.45, 0.35);
        const tuberosityMesh = new THREE.Mesh(tuberosityGeo, this.materials.bone);
        tuberosityMesh.position.set(lateralOffsetX - sign * 0.12, -0.55, 0.08);
        group.add(tuberosityMesh);

        // 2. 橈骨遠端 (Distal Radius) 空間位置解算：
        // 旋後 (twistAngle = 0)：橈骨遠端在平行外側 (X = lateral, Z = 0)
        // 旋前 (twistAngle = PI)：橈骨遠端以手肘為軸向前內側翻轉，交叉跨過尺骨前方！
        // 尺骨遠端位於 (-sign * 0.38, -radiusLen, 0)
        const radiusArc = 0.88; // 翻轉半徑
        const ulnarDistalX = -sign * 0.38;

        // 遠端目標座標：繞尺骨做半圓弧翻轉
        const distalX = ulnarDistalX + sign * (radiusArc * Math.cos(twistAngle));
        const distalZ = radiusArc * Math.sin(twistAngle);

        // 3. 橈骨幹三維空間弧形 (Lateral Bow)
        // 即使交叉時，橈骨外弧也能避開尺骨骨幹，形成優美的剪刀弧度
        const p0 = new THREE.Vector3(lateralOffsetX, -0.4, 0);
        const midBowX = (lateralOffsetX + distalX) * 0.5 + sign * 0.35 * Math.cos(twistAngle * 0.5);
        const midBowZ = (distalZ * 0.5) + 0.35 * Math.sin(twistAngle * 0.5);
        const pMid = new THREE.Vector3(midBowX, -radiusLen * 0.48, midBowZ);
        const pEnd = new THREE.Vector3(distalX, -radiusLen, distalZ);

        const curve = new THREE.CatmullRomCurve3([p0, pMid, pEnd]);
        const shaftGeo = new THREE.TubeGeometry(curve, 18, 0.28, 8, false);
        const shaftMesh = new THREE.Mesh(shaftGeo, this.materials.bone);
        shaftMesh.castShadow = true;
        group.add(shaftMesh);

        // 4. 橈骨遠端骨板與橈骨莖突 (Distal Radius Head & Radial Styloid)
        const distalHeadGeo = new THREE.BoxGeometry(0.75, 0.65, 0.5);
        const distalHeadMesh = new THREE.Mesh(distalHeadGeo, this.materials.boneHighlight);
        distalHeadMesh.position.copy(pEnd);
        distalHeadMesh.rotation.y = twistAngle;
        group.add(distalHeadMesh);

        const styloidGeo = new THREE.ConeGeometry(0.14, 0.5, 6);
        const styloidMesh = new THREE.Mesh(styloidGeo, this.materials.boneHighlight);
        styloidMesh.rotation.x = Math.PI;
        styloidMesh.position.set(distalX + sign * 0.35 * Math.cos(twistAngle), -radiusLen - 0.3, distalZ + 0.35 * Math.sin(twistAngle));
        group.add(styloidMesh);

        radiusGroup.add(group);
        this.shoulderGirdle[side].radiusMesh = group;

        // 5. 手掌系統動態定位與前旋/後旋同步 (Hand Dynamic Coupling)
        // 手腕關節面直接緊扣橈骨遠端 (Radiocarpal Joint)，掌心與五指隨橈骨旋前/旋後動態翻轉！
        const handGroup = this.shoulderGirdle[side].handGroup;
        if (handGroup) {
            // 手腕關節線位於橈骨遠端下緣，留 0.35 單位生理關節間隙
            handGroup.position.set(distalX, -radiusLen - 0.35, distalZ);
            // 手掌沿前臂長軸隨橈骨遠端旋轉角完全同步旋轉 (旋後 twist=0: 掌心向前; 旋前 twist=PI: 掌心向後)
            handGroup.rotation.y = twistAngle;
        }
    }

    /**
     * 建立完整手部骨骼系統 (8塊腕骨 Carpals、5根掌骨 Metacarpals、14節指骨 Phalanges)
     * 並構建關節鏈以支援自然放鬆 (Relaxed)、勝利剪刀手 (Peace)、握拳 (Fist)、平展 (Open) 等藝用手勢姿態
     */
    _buildHandMesh(side, gesture = 'relaxed') {
        const sign = (side === 'left') ? 1 : -1;
        const group = new THREE.Group();
        group.name = `Hand_${side}`;

        // -------------------------------------------------------------
        // 1. 腕骨群 (Carpal Bones - 8塊腕骨構成的穹窿腕弓 Carpal Arch)
        // -------------------------------------------------------------
        const carpalGroup = new THREE.Group();
        carpalGroup.name = `Carpals_${side}`;
        group.add(carpalGroup);

        // 近側列 (Proximal row): 舟狀骨、月狀骨、三角骨、豆狀骨
        // (1) 舟狀骨 (Scaphoid): 橈側承重主力，呈彎舟狀
        const scaphoidGeo = new THREE.CylinderGeometry(0.20, 0.23, 0.58, 8);
        const scaphoidMesh = new THREE.Mesh(scaphoidGeo, this.materials.bone);
        scaphoidMesh.rotation.z = sign * 0.35;
        scaphoidMesh.rotation.y = 0.2;
        scaphoidMesh.position.set(sign * 0.38, -0.38, 0.0);
        carpalGroup.add(scaphoidMesh);

        // 舟狀骨粗隆 (Scaphoid Tubercle - 大魚際肌起點，掌側骨點)
        const scaphoidTubercleGeo = new THREE.SphereGeometry(0.16, 8, 8);
        const scaphoidTubercleMesh = new THREE.Mesh(scaphoidTubercleGeo, this.materials.boneHighlight);
        scaphoidTubercleMesh.position.set(sign * 0.46, -0.48, 0.26);
        carpalGroup.add(scaphoidTubercleMesh);

        // (2) 月狀骨 (Lunate): 位於橈腕關節正中切凹處，呈半月形
        const lunateGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.50, 8);
        const lunateMesh = new THREE.Mesh(lunateGeo, this.materials.bone);
        lunateMesh.rotation.x = Math.PI * 0.5;
        lunateMesh.position.set(sign * 0.02, -0.34, -0.02);
        carpalGroup.add(lunateMesh);

        // (3) 三角骨 (Triquetrum): 位於尺側，呈錐形
        const triquetrumGeo = new THREE.BoxGeometry(0.35, 0.44, 0.38);
        const triquetrumMesh = new THREE.Mesh(triquetrumGeo, this.materials.bone);
        triquetrumMesh.position.set(-sign * 0.38, -0.38, -0.05);
        carpalGroup.add(triquetrumMesh);

        // (4) 豆狀骨 (Pisiform - 極其重要的藝用表面骨點，位於手腕尺側掌面最突出處！)
        const pisiformGeo = new THREE.SphereGeometry(0.20, 10, 10);
        const pisiformMesh = new THREE.Mesh(pisiformGeo, this.materials.boneHighlight);
        pisiformMesh.scale.set(1.0, 1.25, 0.9);
        pisiformMesh.position.set(-sign * 0.44, -0.52, 0.30);
        carpalGroup.add(pisiformMesh);
        this._addLandmark(`Pisiform_${side}`, pisiformMesh.position.clone(), group);

        // 遠側列 (Distal row): 大多角骨、小多角骨、頭狀骨、鉤骨
        // (5) 大多角骨 (Trapezium): 具備馬鞍狀關節面，連接第一掌骨實現拇指對掌
        const trapeziumGeo = new THREE.BoxGeometry(0.38, 0.40, 0.40);
        const trapeziumMesh = new THREE.Mesh(trapeziumGeo, this.materials.bone);
        trapeziumMesh.position.set(sign * 0.48, -0.72, 0.12);
        carpalGroup.add(trapeziumMesh);

        // (6) 小多角骨 (Trapezoid): 楔形嵌入第二掌骨底
        const trapezoidGeo = new THREE.BoxGeometry(0.30, 0.40, 0.34);
        const trapezoidMesh = new THREE.Mesh(trapezoidGeo, this.materials.bone);
        trapezoidMesh.position.set(sign * 0.24, -0.75, 0.02);
        carpalGroup.add(trapezoidMesh);

        // (7) 頭狀骨 (Capitate - 最大的腕骨，腕弓拱頂石，支撐第三掌骨)
        const capitateGeo = new THREE.BoxGeometry(0.42, 0.50, 0.42);
        const capitateMesh = new THREE.Mesh(capitateGeo, this.materials.bone);
        capitateMesh.position.set(sign * 0.02, -0.78, 0.04);
        carpalGroup.add(capitateMesh);

        // (8) 鉤骨 (Hamate): 支撐第四、五掌骨
        const hamateGeo = new THREE.BoxGeometry(0.38, 0.44, 0.38);
        const hamateMesh = new THREE.Mesh(hamateGeo, this.materials.bone);
        hamateMesh.position.set(-sign * 0.30, -0.75, 0.0);
        carpalGroup.add(hamateMesh);

        // 鉤骨鉤 (Hook of Hamate - 掌側突出骨鉤)
        const hamateHookGeo = new THREE.ConeGeometry(0.10, 0.30, 6);
        const hamateHookMesh = new THREE.Mesh(hamateHookGeo, this.materials.boneHighlight);
        hamateHookMesh.rotation.x = Math.PI * 0.5;
        hamateHookMesh.position.set(-sign * 0.30, -0.80, 0.25);
        carpalGroup.add(hamateHookMesh);

        // -------------------------------------------------------------
        // 2. 掌骨群 (Metacarpals 1 to 5)
        // -------------------------------------------------------------
        const mcGroup = new THREE.Group();
        mcGroup.name = `Metacarpals_${side}`;
        group.add(mcGroup);

        const mcConfigs = [
            { name: 'Thumb',  base: new THREE.Vector3(sign * 0.48, -0.75, 0.14),  len: 1.60, latDeg: sign * 36, palmarDeg: 22, radShaft: 0.16, headScale: 0.22 },
            { name: 'Index',  base: new THREE.Vector3(sign * 0.26, -0.82, 0.02),  len: 2.10, latDeg: sign * 6,  palmarDeg: 4,  radShaft: 0.14, headScale: 0.22 },
            { name: 'Middle', base: new THREE.Vector3(sign * 0.02, -0.85, 0.04),  len: 2.25, latDeg: 0,         palmarDeg: 2,  radShaft: 0.15, headScale: 0.24 },
            { name: 'Ring',   base: new THREE.Vector3(-sign * 0.18, -0.82, 0.02), len: 2.05, latDeg: -sign * 5, palmarDeg: 4,  radShaft: 0.13, headScale: 0.21 },
            { name: 'Little', base: new THREE.Vector3(-sign * 0.36, -0.75, -0.02),len: 1.75, latDeg: -sign * 12,palmarDeg: 6,  radShaft: 0.12, headScale: 0.20 },
        ];

        const mcpJoints = {};

        mcConfigs.forEach(mc => {
            const sRad = THREE.MathUtils.degToRad(mc.latDeg);
            const pRad = THREE.MathUtils.degToRad(mc.palmarDeg);
            const dx = Math.sin(sRad);
            const dz = Math.sin(pRad);
            const dy = -Math.sqrt(Math.max(0.001, 1.0 - dx * dx - dz * dz));
            const dir = new THREE.Vector3(dx, dy, dz).normalize();

            const mcpPos = new THREE.Vector3().copy(mc.base).addScaledVector(dir, mc.len);
            mcpJoints[mc.name] = { mcpPos, dir, mc };

            // 掌骨骨幹 (Metacarpal Shaft: 微具掌側凹曲度的管狀骨)
            const midP = new THREE.Vector3().copy(mc.base).addScaledVector(dir, mc.len * 0.5);
            midP.z += (mc.name === 'Thumb' ? 0.08 : 0.04); // 掌側生理弧度
            const mcCurve = new THREE.CatmullRomCurve3([mc.base, midP, mcpPos]);
            const shaftGeo = new THREE.TubeGeometry(mcCurve, 8, mc.radShaft, 8, false);
            const shaftMesh = new THREE.Mesh(shaftGeo, this.materials.bone);
            shaftMesh.castShadow = true;
            mcGroup.add(shaftMesh);

            // 掌骨頭 (MCP Knuckle: 拳頭握緊時突出的指節骨點)
            const knuckleGeo = new THREE.SphereGeometry(mc.headScale, 10, 10);
            const knuckleMesh = new THREE.Mesh(knuckleGeo, this.materials.boneHighlight);
            knuckleMesh.position.copy(mcpPos);
            mcGroup.add(knuckleMesh);

            if (mc.name === 'Thumb' || mc.name === 'Index' || mc.name === 'Middle') {
                this._addLandmark(`MCP_${mc.name}_${side}`, mcpPos.clone(), group);
            }
        });

        // -------------------------------------------------------------
        // 3. 指骨群 (Phalanges - 拇指2節，食/中/無名/小指各3節，共14節)
        // 構建層級旋轉關節鏈 (MCP -> PIP -> DIP)，支援動態曲折手勢
        // -------------------------------------------------------------
        const phalangesGroup = new THREE.Group();
        phalangesGroup.name = `Phalanges_${side}`;
        group.add(phalangesGroup);

        const fingerConfigs = [
            { name: 'Thumb',  pLen: 1.05, mLen: 0,    dLen: 0.80, pRad: 0.14, dRad: 0.12, tuft: [0.22, 0.18, 0.12] },
            { name: 'Index',  pLen: 1.05, mLen: 0.68, dLen: 0.50, pRad: 0.13, mRad: 0.11, dRad: 0.09, tuft: [0.18, 0.14, 0.08] },
            { name: 'Middle', pLen: 1.15, mLen: 0.75, dLen: 0.55, pRad: 0.14, mRad: 0.12, dRad: 0.10, tuft: [0.19, 0.15, 0.09] },
            { name: 'Ring',   pLen: 1.05, mLen: 0.68, dLen: 0.50, pRad: 0.13, mRad: 0.11, dRad: 0.09, tuft: [0.18, 0.14, 0.08] },
            { name: 'Little', pLen: 0.80, mLen: 0.52, dLen: 0.40, pRad: 0.11, mRad: 0.09, dRad: 0.07, tuft: [0.15, 0.12, 0.07] },
        ];

        const joints = {};

        fingerConfigs.forEach(fc => {
            const { mcpPos, dir } = mcpJoints[fc.name];

            // 掌指關節 (MCP Joint Group)
            const mcpJoint = new THREE.Group();
            mcpJoint.name = `MCP_Joint_${fc.name}_${side}`;
            mcpJoint.position.copy(mcpPos);
            // 朝向指骨延伸向量
            mcpJoint.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);

            if (fc.name === 'Thumb') {
                // 拇指對掌生理偏轉角 (Opposition)
                mcpJoint.rotation.y += sign * 0.55;
                mcpJoint.rotation.z += sign * 0.45;
            }

            phalangesGroup.add(mcpJoint);

            // 近節指骨 (Proximal Phalanx)
            const pShaftGeo = new THREE.CylinderGeometry(fc.pRad * 0.85, fc.pRad, fc.pLen, 8);
            const pShaftMesh = new THREE.Mesh(pShaftGeo, this.materials.bone);
            pShaftMesh.position.set(0, -fc.pLen * 0.5, 0);
            mcpJoint.add(pShaftMesh);

            // 近端指間關節 (PIP Joint Group / 拇指為 IP 關節)
            const pipJoint = new THREE.Group();
            pipJoint.name = `PIP_Joint_${fc.name}_${side}`;
            pipJoint.position.set(0, -fc.pLen, 0);
            mcpJoint.add(pipJoint);

            const pipKnuckleGeo = new THREE.SphereGeometry(fc.pRad * 1.1, 8, 8);
            const pipKnuckleMesh = new THREE.Mesh(pipKnuckleGeo, this.materials.boneHighlight);
            pipJoint.add(pipKnuckleMesh);

            let dipJoint = null;

            if (fc.mLen > 0) {
                // 2-5 指具備中節指骨 (Middle Phalanx)
                const mShaftGeo = new THREE.CylinderGeometry(fc.mRad * 0.85, fc.mRad, fc.mLen, 8);
                const mShaftMesh = new THREE.Mesh(mShaftGeo, this.materials.bone);
                mShaftMesh.position.set(0, -fc.mLen * 0.5, 0);
                pipJoint.add(mShaftMesh);

                // 遠端指間關節 (DIP Joint Group)
                dipJoint = new THREE.Group();
                dipJoint.name = `DIP_Joint_${fc.name}_${side}`;
                dipJoint.position.set(0, -fc.mLen, 0);
                pipJoint.add(dipJoint);

                const dipKnuckleGeo = new THREE.SphereGeometry(fc.mRad * 1.05, 8, 8);
                const dipKnuckleMesh = new THREE.Mesh(dipKnuckleGeo, this.materials.boneHighlight);
                dipJoint.add(dipKnuckleMesh);

                // 遠節指骨 (Distal Phalanx)
                const dShaftGeo = new THREE.CylinderGeometry(fc.dRad * 0.8, fc.dRad, fc.dLen, 8);
                const dShaftMesh = new THREE.Mesh(dShaftGeo, this.materials.bone);
                dShaftMesh.position.set(0, -fc.dLen * 0.5, 0);
                dipJoint.add(dShaftMesh);

                // 指甲粗隆 / 指尖膨大部 (Ungual Tuberosity)
                const tuftGeo = new THREE.BoxGeometry(...fc.tuft);
                const tuftMesh = new THREE.Mesh(tuftGeo, this.materials.boneHighlight);
                tuftMesh.position.set(0, -fc.dLen, 0);
                dipJoint.add(tuftMesh);
            } else {
                // 拇指僅有遠節指骨
                const dShaftGeo = new THREE.CylinderGeometry(fc.dRad * 0.85, fc.dRad, fc.dLen, 8);
                const dShaftMesh = new THREE.Mesh(dShaftGeo, this.materials.bone);
                dShaftMesh.position.set(0, -fc.dLen * 0.5, 0);
                pipJoint.add(dShaftMesh);

                const tuftGeo = new THREE.BoxGeometry(...fc.tuft);
                const tuftMesh = new THREE.Mesh(tuftGeo, this.materials.boneHighlight);
                tuftMesh.position.set(0, -fc.dLen, 0);
                pipJoint.add(tuftMesh);
            }

            joints[fc.name] = { mcpJoint, pipJoint, dipJoint, name: fc.name };
        });

        // 應用手勢初始姿態
        this._applyHandGestureDirect(joints, side, gesture);

        return { mesh: group, joints };
    }

    /**
     * 驅動手部關節鏈達成各種藝用姿態 (Relaxed, Peace/Victory, Fist, Open)
     */
    _applyHandGestureDirect(joints, side, gesture = 'relaxed') {
        const sign = (side === 'left') ? 1 : -1;
        const GESTURES = {
            relaxed: { // 自然放鬆微屈曲手勢
                Thumb:  { mcp: 0.15, pip: 0.22, dip: 0.15, spread: 0 },
                Index:  { mcp: 0.15, pip: 0.25, dip: 0.15, spread: 0 },
                Middle: { mcp: 0.20, pip: 0.32, dip: 0.18, spread: 0 },
                Ring:   { mcp: 0.25, pip: 0.38, dip: 0.20, spread: 0 },
                Little: { mcp: 0.30, pip: 0.45, dip: 0.22, spread: 0 }
            },
            peace: { // 剪刀手 / 勝利手勢 (食指與中指伸直呈V字張開，拇指與無名指小指彎曲緊握)
                Thumb:  { mcp: 0.70, pip: 1.05, dip: 0.60, spread: 0 },
                Index:  { mcp: 0.02, pip: 0.04, dip: 0.02, spread: sign * 0.10 },  // 伸直微外張
                Middle: { mcp: 0.02, pip: 0.04, dip: 0.02, spread: -sign * 0.10 }, // 伸直微內張
                Ring:   { mcp: 1.45, pip: 1.65, dip: 1.10, spread: 0 },             // 緊密屈曲
                Little: { mcp: 1.50, pip: 1.70, dip: 1.15, spread: 0 }              // 緊密屈曲
            },
            open: { // 五指伸展張開
                Thumb:  { mcp: 0.05, pip: 0.05, dip: 0.05, spread: sign * 0.15 },
                Index:  { mcp: 0.00, pip: 0.00, dip: 0.00, spread: sign * 0.08 },
                Middle: { mcp: 0.00, pip: 0.00, dip: 0.00, spread: 0 },
                Ring:   { mcp: 0.00, pip: 0.00, dip: 0.00, spread: -sign * 0.08 },
                Little: { mcp: 0.00, pip: 0.00, dip: 0.00, spread: -sign * 0.15 }
            },
            fist: { // 緊密握拳 (拳頭姿態)
                Thumb:  { mcp: 0.95, pip: 1.35, dip: 0.90, spread: 0 },
                Index:  { mcp: 1.45, pip: 1.65, dip: 1.10, spread: 0 },
                Middle: { mcp: 1.50, pip: 1.70, dip: 1.15, spread: 0 },
                Ring:   { mcp: 1.50, pip: 1.70, dip: 1.15, spread: 0 },
                Little: { mcp: 1.50, pip: 1.70, dip: 1.15, spread: 0 }
            }
        };

        const config = GESTURES[gesture] || GESTURES.relaxed;

        Object.keys(joints).forEach(fingerName => {
            const j = joints[fingerName];
            const angles = config[fingerName] || { mcp: 0, pip: 0, dip: 0, spread: 0 };

            if (j.mcpJoint) {
                // X 軸負向旋轉即為掌側屈曲 (Flexion)
                j.mcpJoint.rotation.x = -angles.mcp;
                if (angles.spread !== undefined) {
                    j.mcpJoint.rotation.z = angles.spread;
                }
            }
            if (j.pipJoint) {
                j.pipJoint.rotation.x = -angles.pip;
            }
            if (j.dipJoint) {
                j.dipJoint.rotation.x = -angles.dip;
            }
        });
    }

    setHandGesture(side, gesture) {
        if (!this.shoulderGirdle[side] || !this.shoulderGirdle[side].handJoints) return;
        this.shoulderGirdle[side].currentGesture = gesture;
        this._applyHandGestureDirect(this.shoulderGirdle[side].handJoints, side, gesture);
    }

    _buildPelvis() {
        const pelvisGroup = new THREE.Group();
        pelvisGroup.name = "Bony_Pelvis";
        this.pelvisUnit.add(pelvisGroup);

        const sacrumMesh = this._createSacrumMesh();
        sacrumMesh.position.set(0, 0, -0.6);
        pelvisGroup.add(sacrumMesh);
        this.pelvisBones.sacrum = sacrumMesh;

        const coccyxMesh = this._createCoccyxMesh();
        coccyxMesh.position.set(0, -4.5, -1.8);
        pelvisGroup.add(coccyxMesh);
        this.pelvisBones.coccyx = coccyxMesh;

        ['left', 'right'].forEach(side => {
            const hipBone = this._createInnominateBone(side);
            pelvisGroup.add(hipBone);
        });

        const symphysisGeo = new THREE.CylinderGeometry(0.35, 0.35, 1.2, 12);
        const symphysisMesh = new THREE.Mesh(symphysisGeo, this.materials.cartilage);
        symphysisMesh.name = "PubicSymphysis";
        symphysisMesh.rotation.z = Math.PI * 0.5;
        symphysisMesh.position.set(0, -3.8, 2.7);
        pelvisGroup.add(symphysisMesh);
        this.pelvisBones.pubicSymphysis = symphysisMesh;

        this._addLandmark("PubicSymphysisPoint", new THREE.Vector3(0, -3.8, 2.9), this.pelvisUnit);
    }

    _createSacrumMesh() {
        const group = new THREE.Group();
        group.name = "Sacrum";

        const sacrumShape = new THREE.Shape();
        sacrumShape.moveTo(-2.2, 0);
        sacrumShape.lineTo(2.2, 0);
        sacrumShape.lineTo(1.5, -2.2);
        sacrumShape.lineTo(0.6, -4.2);
        sacrumShape.lineTo(-0.6, -4.2);
        sacrumShape.lineTo(-1.5, -2.2);
        sacrumShape.closePath();

        const extrudeSettings = { depth: 0.9, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: 0.15, bevelThickness: 0.15 };
        const sacrumGeo = new THREE.ExtrudeGeometry(sacrumShape, extrudeSettings);
        const sacrumMesh = new THREE.Mesh(sacrumGeo, this.materials.bone);
        sacrumMesh.rotation.x = -0.22;
        sacrumMesh.position.set(0, 0, -0.5);
        sacrumMesh.castShadow = true;
        group.add(sacrumMesh);

        const crestGeo = new THREE.BoxGeometry(0.35, 3.8, 0.45);
        const crestMesh = new THREE.Mesh(crestGeo, this.materials.boneHighlight);
        crestMesh.rotation.x = -0.22;
        crestMesh.position.set(0, -2.0, -0.6);
        group.add(crestMesh);

        return group;
    }

    _createCoccyxMesh() {
        const group = new THREE.Group();
        group.name = "Coccyx";

        const points = [
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0, -0.6, 0.15),
            new THREE.Vector3(0, -1.2, 0.4)
        ];
        const curve = new THREE.CatmullRomCurve3(points);
        const geo = new THREE.TubeGeometry(curve, 8, 0.24, 6, false);
        const mesh = new THREE.Mesh(geo, this.materials.bone);
        group.add(mesh);

        return group;
    }

    _createInnominateBone(side) {
        const sign = (side === 'left') ? 1 : -1;
        const hipGroup = new THREE.Group();
        hipGroup.name = `HipBone_${side}`;

        const iliumGroup = new THREE.Group();
        iliumGroup.name = `Ilium_${side}`;

        const pPSIS = new THREE.Vector3(sign * 2.0, 0.2, -1.2);
        const pSummit = new THREE.Vector3(sign * 4.6, 0.8, 0.2);
        const pASIS = new THREE.Vector3(sign * 3.8, -1.4, 2.6);

        const crestCurve = new THREE.CatmullRomCurve3([pPSIS, pSummit, pASIS]);
        const crestGeo = new THREE.TubeGeometry(crestCurve, 16, 0.25, 8, false);
        const crestMesh = new THREE.Mesh(crestGeo, this.materials.boneHighlight);
        crestMesh.castShadow = true;
        iliumGroup.add(crestMesh);

        const iliumShape = new THREE.Shape();
        iliumShape.moveTo(sign * 2.0, 0.0);
        iliumShape.lineTo(sign * 4.5, 0.6);
        iliumShape.lineTo(sign * 3.8, -1.4);
        iliumShape.lineTo(sign * 3.2, -3.2);
        iliumShape.lineTo(sign * 1.8, -2.5);
        iliumShape.closePath();

        const wingGeo = new THREE.ExtrudeGeometry(iliumShape, { depth: 0.18, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08 });
        const wingMesh = new THREE.Mesh(wingGeo, this.materials.pelvisWing);
        wingMesh.position.set(0, 0, 0.2);
        wingMesh.rotation.y = -sign * 0.15;
        iliumGroup.add(wingMesh);

        hipGroup.add(iliumGroup);
        if (side === 'left') this.pelvisBones.iliumL = iliumGroup;
        else this.pelvisBones.iliumR = iliumGroup;

        this._addLandmark(`ASIS_${side}`, new THREE.Vector3(sign * 3.8, -1.4, 2.6), this.pelvisUnit);

        const ischiumGroup = new THREE.Group();
        ischiumGroup.name = `Ischium_${side}`;

        const tuberosityGeo = new THREE.SphereGeometry(0.7, 10, 10);
        const tuberosityMesh = new THREE.Mesh(tuberosityGeo, this.materials.boneHighlight);
        tuberosityMesh.scale.set(1.0, 1.4, 0.8);
        tuberosityMesh.position.set(sign * 2.6, -5.4, -0.6);
        ischiumGroup.add(tuberosityMesh);

        const ischialRamusP0 = new THREE.Vector3(sign * 2.6, -5.4, -0.6);
        const ischialRamusP1 = new THREE.Vector3(sign * 1.6, -5.2, 1.2);
        const ischialCurve = new THREE.CatmullRomCurve3([ischialRamusP0, ischialRamusP1]);
        const ramusGeo = new THREE.TubeGeometry(ischialCurve, 8, 0.25, 6, false);
        const ramusMesh = new THREE.Mesh(ramusGeo, this.materials.bone);
        ischiumGroup.add(ramusMesh);

        hipGroup.add(ischiumGroup);
        if (side === 'left') this.pelvisBones.ischiumL = ischiumGroup;
        else this.pelvisBones.ischiumR = ischiumGroup;

        const pubisGroup = new THREE.Group();
        pubisGroup.name = `Pubis_${side}`;

        const pubicP0 = new THREE.Vector3(sign * 3.0, -3.2, 1.2);
        const pubicP1 = new THREE.Vector3(sign * 1.5, -3.6, 2.4);
        const pubicP2 = new THREE.Vector3(sign * 0.45, -3.8, 2.7);

        const pubicCurve = new THREE.CatmullRomCurve3([pubicP0, pubicP1, pubicP2]);
        const pubicGeo = new THREE.TubeGeometry(pubicCurve, 10, 0.25, 6, false);
        const pubicMesh = new THREE.Mesh(pubicGeo, this.materials.bone);
        pubisGroup.add(pubicMesh);

        const infP0 = pubicP2;
        const infP1 = ischialRamusP1;
        const infCurve = new THREE.CatmullRomCurve3([infP0, infP1]);
        const infGeo = new THREE.TubeGeometry(infCurve, 8, 0.22, 6, false);
        const infMesh = new THREE.Mesh(infGeo, this.materials.bone);
        pubisGroup.add(infMesh);

        hipGroup.add(pubisGroup);
        if (side === 'left') this.pelvisBones.pubisL = pubisGroup;
        else this.pelvisBones.pubisR = pubisGroup;

        const acetabulumGeo = new THREE.CylinderGeometry(0.75, 0.85, 0.45, 14);
        const acetabulumMesh = new THREE.Mesh(acetabulumGeo, this.materials.bone);
        acetabulumMesh.name = `Acetabulum_${side}`;
        acetabulumMesh.rotation.z = Math.PI * 0.5;
        acetabulumMesh.position.set(sign * 3.6, -3.4, 0.6);
        hipGroup.add(acetabulumMesh);

        return hipGroup;
    }

    _createClavicleMesh(side) {
        const sign = (side === 'left') ? 1 : -1;
        const group = new THREE.Group();
        group.name = `Clavicle_${side}`;

        const p0 = new THREE.Vector3(0, 0, 0);
        const p1 = new THREE.Vector3(sign * 1.8, 0.12, 0.45);
        const p2 = new THREE.Vector3(sign * 3.6, -0.05, -2.4);
        const p3 = new THREE.Vector3(sign * 5.0, -0.2, -5.4);

        const curve = new THREE.CatmullRomCurve3([p0, p1, p2, p3]);
        const tubeGeo = new THREE.TubeGeometry(curve, 22, 0.22, 10, false);
        const mesh = new THREE.Mesh(tubeGeo, this.materials.boneHighlight);
        mesh.castShadow = true;
        group.add(mesh);

        const headGeo = new THREE.SphereGeometry(0.35, 10, 10);
        const headMesh = new THREE.Mesh(headGeo, this.materials.boneHighlight);
        headMesh.scale.set(1.1, 1.2, 1.1);
        group.add(headMesh);

        return group;
    }

    _createScapulaMesh(side) {
        const sign = (side === 'left') ? 1 : -1;
        const group = new THREE.Group();
        group.name = `Scapula_${side}`;

        const acromionGeo = new THREE.BoxGeometry(0.9, 0.35, 1.3);
        const acromionMesh = new THREE.Mesh(acromionGeo, this.materials.boneHighlight);
        acromionMesh.position.set(0, 0, 0.3);
        group.add(acromionMesh);

        const spineP0 = new THREE.Vector3(0, 0, 0.2);
        const spineP1 = new THREE.Vector3(-sign * 1.6, -0.4, -0.2);
        const spineP2 = new THREE.Vector3(-sign * 3.4, -1.0, -0.5);

        const spineCurve = new THREE.CatmullRomCurve3([spineP0, spineP1, spineP2]);
        const spineGeo = new THREE.TubeGeometry(spineCurve, 14, 0.22, 8, false);
        const spineMesh = new THREE.Mesh(spineGeo, this.materials.boneHighlight);
        spineMesh.castShadow = true;
        group.add(spineMesh);

        const scapulaShape = new THREE.Shape();
        scapulaShape.moveTo(0, 0);
        scapulaShape.lineTo(-sign * 3.6, -0.8);
        scapulaShape.lineTo(-sign * 3.0, -5.2);
        scapulaShape.lineTo(0.3, -2.4);
        scapulaShape.closePath();

        const extrudeSettings = { depth: 0.16, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.06, bevelThickness: 0.06 };
        const bladeGeo = new THREE.ExtrudeGeometry(scapulaShape, extrudeSettings);
        const bladeMesh = new THREE.Mesh(bladeGeo, this.materials.bone);
        bladeMesh.position.set(0, -0.3, -0.2);
        group.add(bladeMesh);

        const glenoidGeo = new THREE.CylinderGeometry(0.55, 0.62, 0.4, 12);
        const glenoidMesh = new THREE.Mesh(glenoidGeo, this.materials.bone);
        glenoidMesh.rotation.z = Math.PI * 0.5;
        glenoidMesh.position.set(sign * 0.3, -1.1, 0.2);
        group.add(glenoidMesh);

        return group;
    }

    _createHumerusMesh(side) {
        const sign = (side === 'left') ? 1 : -1;
        const group = new THREE.Group();
        group.name = `Humerus_${side}`;

        const headGeo = new THREE.SphereGeometry(0.68, 16, 16);
        const headMesh = new THREE.Mesh(headGeo, this.materials.bone);
        headMesh.position.set(-sign * 0.15, 0.15, 0);
        group.add(headMesh);

        const tuberGeo = new THREE.BoxGeometry(0.65, 0.7, 0.7);
        const tuberMesh = new THREE.Mesh(tuberGeo, this.materials.bone);
        tuberMesh.position.set(sign * 0.42, 0.1, 0);
        group.add(tuberMesh);

        const armLength = 8.5;
        const shaftGeo = new THREE.CylinderGeometry(0.36, 0.4, armLength, 12);
        const shaftMesh = new THREE.Mesh(shaftGeo, this.materials.bone);
        shaftMesh.position.set(0, -armLength * 0.5, 0);
        shaftMesh.castShadow = true;
        group.add(shaftMesh);

        const elbowGeo = new THREE.BoxGeometry(1.3, 0.7, 0.8);
        const elbowMesh = new THREE.Mesh(elbowGeo, this.materials.bone);
        elbowMesh.position.set(0, -armLength, 0);
        group.add(elbowMesh);

        return group;
    }

    _createVertebraMesh(name, width, height, type) {
        const group = new THREE.Group();
        group.name = `Vertebra_${name}`;

        const bodyGeo = new THREE.CylinderGeometry(width * 0.48, width * 0.5, height * 0.72, 16);
        const bodyMesh = new THREE.Mesh(bodyGeo, this.materials.bone);
        bodyMesh.castShadow = true;
        group.add(bodyMesh);

        const discGeo = new THREE.CylinderGeometry(width * 0.49, width * 0.49, height * 0.25, 16);
        const discMesh = new THREE.Mesh(discGeo, this.materials.disc);
        discMesh.position.y = -height * 0.46;
        group.add(discMesh);

        const transGeo = new THREE.BoxGeometry(width * 1.5, height * 0.3, width * 0.4);
        const transMesh = new THREE.Mesh(transGeo, this.materials.bone);
        transMesh.position.set(0, 0, -width * 0.32);
        group.add(transMesh);

        const spinousLen = (type === 'thoracic') ? width * 1.2 : width * 0.8;
        const spinousGeo = new THREE.ConeGeometry(width * 0.2, spinousLen, 8);
        const spinousMesh = new THREE.Mesh(spinousGeo, this.materials.bone);
        
        if (type === 'thoracic') {
            spinousMesh.rotation.x = Math.PI * 0.68;
            spinousMesh.position.set(0, -height * 0.35, -width * 0.65 - spinousLen * 0.35);
        } else {
            spinousMesh.rotation.x = Math.PI * 0.5;
            spinousMesh.position.set(0, 0, -width * 0.5 - spinousLen * 0.35);
        }
        group.add(spinousMesh);

        return group;
    }

    _createRibWithSternumAttachment(ribNum, width, side) {
        const sign = (side === 'left') ? 1 : -1;
        const group = new THREE.Group();
        group.name = `Rib_${ribNum}_${side}`;

        const isFloating = (ribNum >= 11);
        const isFalse = (ribNum >= 8 && ribNum <= 10);

        const pStart = new THREE.Vector3(sign * 0.85, 0, -0.4);
        const pAngle = new THREE.Vector3(sign * (width * 0.7), -0.2, -1.1);

        const dropY = Math.min(ribNum * 0.35, 2.4);
        const pLateral = new THREE.Vector3(sign * width, -dropY * 0.6, 1.2);

        let pAnterior;
        if (isFloating) {
            pAnterior = new THREE.Vector3(sign * (width * 0.75), -dropY * 0.85, 2.4);
        } else if (isFalse) {
            const subcostalX = sign * (1.8 + (10 - ribNum) * 0.5);
            pAnterior = new THREE.Vector3(subcostalX, -dropY, 4.4);
        } else {
            const sternumY = -dropY + (8 - ribNum) * 0.25;
            pAnterior = new THREE.Vector3(sign * 0.85, sternumY, 4.9);
        }

        const curve = new THREE.CatmullRomCurve3([pStart, pAngle, pLateral, pAnterior]);
        const tubeRadius = (ribNum <= 2) ? 0.16 : 0.13;
        const ribGeo = new THREE.TubeGeometry(curve, 18, tubeRadius, 8, false);
        const ribMesh = new THREE.Mesh(ribGeo, this.materials.bone);
        ribMesh.castShadow = true;
        group.add(ribMesh);

        if (!isFloating) {
            let targetX = sign * 0.85;
            let targetY = pAnterior.y + 0.2;
            let targetZ = 5.0;

            if (isFalse) {
                targetX = sign * 1.0;
                targetY = pAnterior.y + 0.6;
                targetZ = 4.8;
            }

            const cartCurve = new THREE.CatmullRomCurve3([
                pAnterior,
                new THREE.Vector3((pAnterior.x + targetX) * 0.5, (pAnterior.y + targetY) * 0.5, 4.95),
                new THREE.Vector3(targetX, targetY, targetZ)
            ]);
            const cartGeo = new THREE.TubeGeometry(cartCurve, 8, tubeRadius * 1.05, 8, false);
            const cartMesh = new THREE.Mesh(cartGeo, this.materials.cartilage);
            group.add(cartMesh);
        }

        return group;
    }

    _createSternumMesh() {
        const group = new THREE.Group();
        group.name = "Sternum";

        const manuGeo = new THREE.BoxGeometry(2.2, 1.8, 0.4);
        const manuMesh = new THREE.Mesh(manuGeo, this.materials.bone);
        manuMesh.position.y = 2.4;
        group.add(manuMesh);

        const bodyGeo = new THREE.BoxGeometry(1.6, 4.2, 0.35);
        const bodyMesh = new THREE.Mesh(bodyGeo, this.materials.bone);
        bodyMesh.position.y = -0.6;
        group.add(bodyMesh);

        const xiphGeo = new THREE.ConeGeometry(0.35, 1.0, 4);
        const xiphMesh = new THREE.Mesh(xiphGeo, this.materials.cartilage);
        xiphMesh.rotation.z = Math.PI;
        xiphMesh.position.set(0, -3.2, 0);
        group.add(xiphMesh);

        return group;
    }

    /**
     * 建立完整藝用解剖頭骨系統 (Skull & Mandible)
     * 含腦顱骨穹隆 (Calvaria)、額骨眉弓 (Brow Ridge)、雙側眼眶 (Orbits)、
     * 顴骨與顴弓 (Zygomatic Bones & Arches)、鼻骨梨狀孔 (Nasal Bone & Aperture)、
     * 上頜骨牙列 (Maxilla & Upper Teeth)、以及完整下頜骨與下巴頦結節 (Mandible & Mental Protuberance)
     */
    _createSkullMesh() {
        const group = new THREE.Group();
        group.name = "Human_Skull";

        // 1. 腦顱骨穹隆 (Cranial Vault / Calvaria) - 頂骨、枕骨、額骨
        const craniumGeo = new THREE.SphereGeometry(1.85, 16, 16);
        const craniumMesh = new THREE.Mesh(craniumGeo, this.materials.bone);
        craniumMesh.scale.set(1.0, 1.12, 1.22);
        craniumMesh.position.set(0, 1.85, -0.35);
        craniumMesh.castShadow = true;
        group.add(craniumMesh);

        // 枕外隆凸 (External Occipital Protuberance - 後腦勺骨點)
        const occiputGeo = new THREE.SphereGeometry(0.5, 8, 8);
        const occiputMesh = new THREE.Mesh(occiputGeo, this.materials.boneHighlight);
        occiputMesh.scale.set(1.1, 0.8, 0.9);
        occiputMesh.position.set(0, 0.85, -1.65);
        group.add(occiputMesh);

        // 2. 額骨前壁與眉弓隆起 (Frontal Bone & Superciliary Arches / Glabella)
        const browGeo = new THREE.BoxGeometry(2.25, 0.42, 0.65);
        const browMesh = new THREE.Mesh(browGeo, this.materials.boneHighlight);
        browMesh.position.set(0, 1.65, 1.30);
        group.add(browMesh);

        // 3. 雙側眼眶骨架 (Orbital Cavities & Rims)
        [-1, 1].forEach(sign => {
            const orbitRimGeo = new THREE.TorusGeometry(0.52, 0.15, 8, 14);
            const orbitRimMesh = new THREE.Mesh(orbitRimGeo, this.materials.boneHighlight);
            orbitRimMesh.position.set(sign * 0.82, 1.15, 1.35);
            group.add(orbitRimMesh);

            const darkOrbitGeo = new THREE.CylinderGeometry(0.46, 0.35, 0.4, 10);
            const darkOrbitMat = new THREE.MeshBasicMaterial({ color: 0x1a1512 });
            const darkOrbitMesh = new THREE.Mesh(darkOrbitGeo, darkOrbitMat);
            darkOrbitMesh.rotation.x = Math.PI * 0.5;
            darkOrbitMesh.position.set(sign * 0.82, 1.15, 1.25);
            group.add(darkOrbitMesh);
        });

        // 4. 顴骨與顴弓 (Zygomatic Bones & Zygomatic Arches - 臉部最寬藝用骨點)
        [-1, 1].forEach(sign => {
            const zygoGeo = new THREE.BoxGeometry(0.65, 0.72, 0.75);
            const zygoMesh = new THREE.Mesh(zygoGeo, this.materials.boneHighlight);
            zygoMesh.position.set(sign * 1.45, 0.90, 0.95);
            group.add(zygoMesh);

            const archP0 = new THREE.Vector3(sign * 1.45, 0.90, 0.95);
            const archP1 = new THREE.Vector3(sign * 1.75, 0.85, 0.1);
            const archP2 = new THREE.Vector3(sign * 1.65, 0.80, -0.65);
            const archCurve = new THREE.CatmullRomCurve3([archP0, archP1, archP2]);
            const archGeo = new THREE.TubeGeometry(archCurve, 8, 0.14, 6, false);
            const archMesh = new THREE.Mesh(archGeo, this.materials.boneHighlight);
            group.add(archMesh);
        });

        // 5. 鼻骨與梨狀孔 (Nasal Bone & Piriform Aperture)
        const nasalBridgeGeo = new THREE.ConeGeometry(0.28, 0.90, 5);
        const nasalBridgeMesh = new THREE.Mesh(nasalBridgeGeo, this.materials.boneHighlight);
        nasalBridgeMesh.rotation.x = -0.32;
        nasalBridgeMesh.position.set(0, 1.15, 1.65);
        group.add(nasalBridgeMesh);

        const piriformGeo = new THREE.BoxGeometry(0.42, 0.70, 0.4);
        const piriformMat = new THREE.MeshBasicMaterial({ color: 0x151110 });
        const piriformMesh = new THREE.Mesh(piriformGeo, piriformMat);
        piriformMesh.position.set(0, 0.65, 1.35);
        group.add(piriformMesh);

        // 6. 上頜骨與上牙弓 (Maxilla & Upper Dentition)
        const maxillaGeo = new THREE.BoxGeometry(1.55, 0.80, 1.05);
        const maxillaMesh = new THREE.Mesh(maxillaGeo, this.materials.bone);
        maxillaMesh.position.set(0, 0.15, 1.05);
        group.add(maxillaMesh);

        const upperTeethGeo = new THREE.CylinderGeometry(0.62, 0.68, 0.32, 10, 1, false, -Math.PI * 0.45, Math.PI * 0.9);
        const teethMat = new THREE.MeshStandardMaterial({ color: 0xfaf5ec, roughness: 0.25 });
        const upperTeethMesh = new THREE.Mesh(upperTeethGeo, teethMat);
        upperTeethMesh.position.set(0, -0.20, 1.05);
        group.add(upperTeethMesh);

        // 7. 下頜骨系統 (Mandible: 下頜體、下頜角、下頜支與下巴頦結節)
        const mandibleGroup = new THREE.Group();
        mandibleGroup.name = "Mandible";

        const chinGeo = new THREE.BoxGeometry(0.82, 0.62, 0.72);
        const chinMesh = new THREE.Mesh(chinGeo, this.materials.boneHighlight);
        chinMesh.position.set(0, -0.68, 1.25);
        mandibleGroup.add(chinMesh);

        const lowerTeethGeo = new THREE.CylinderGeometry(0.58, 0.63, 0.30, 10, 1, false, -Math.PI * 0.45, Math.PI * 0.9);
        const lowerTeethMesh = new THREE.Mesh(lowerTeethGeo, teethMat);
        lowerTeethMesh.position.set(0, -0.45, 1.02);
        mandibleGroup.add(lowerTeethMesh);

        [-1, 1].forEach(sign => {
            const jawP0 = new THREE.Vector3(0, -0.68, 1.25);
            const jawP1 = new THREE.Vector3(sign * 1.05, -0.60, 0.75);
            const jawP2 = new THREE.Vector3(sign * 1.40, -0.25, -0.05);
            const jawP3 = new THREE.Vector3(sign * 1.35, 0.55, -0.20);

            const jawCurve = new THREE.CatmullRomCurve3([jawP0, jawP1, jawP2, jawP3]);
            const jawGeo = new THREE.TubeGeometry(jawCurve, 12, 0.22, 6, false);
            const jawMesh = new THREE.Mesh(jawGeo, this.materials.bone);
            jawMesh.castShadow = true;
            mandibleGroup.add(jawMesh);

            const gonionGeo = new THREE.SphereGeometry(0.26, 6, 6);
            const gonionMesh = new THREE.Mesh(gonionGeo, this.materials.boneHighlight);
            gonionMesh.position.copy(jawP2);
            mandibleGroup.add(gonionMesh);
        });

        group.add(mandibleGroup);
        return group;
    }

    _addLandmark(name, localPos, parent) {
        const geo = new THREE.SphereGeometry(0.24, 12, 12);
        const mesh = new THREE.Mesh(geo, this.materials.landmark);
        mesh.name = `Landmark_${name}`;
        mesh.position.copy(localPos);
        mesh.visible = false;
        parent.add(mesh);
        this.landmarks[name] = mesh;
    }

    /**
     * 完整姿態驅動（含骨盆、腰椎、胸廓、肩帶、肱骨與前臂雙骨屈伸翻轉）
     */
    setTorsoPose({
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
        // 頭部與顱骨姿態 (Head Pose)
        headPitch = 0,
        headYaw = 0,
        headRoll = 0,
        leftArmPitch = 0,
        leftArmRoll = 0.12,
        leftArmYaw = 0,
        rightArmPitch = 0,
        rightArmRoll = -0.12,
        rightArmYaw = 0,
        // 前臂肘關節屈曲 (Flexion) 與 旋前/旋後 (Twist)
        leftElbowFlex = 0.2,
        leftForearmTwist = 0.3,
        rightElbowFlex = 0.2,
        rightForearmTwist = 0.3,
        // 手部姿態手勢 (Relaxed, Peace, Fist, Open)
        leftHandGesture = null,
        rightHandGesture = null,
        // 下肢骨骼姿態 (髖關節、膝關節屈曲、踝關節)
        leftHipPitch = 0,
        leftHipRoll = 0,
        leftHipYaw = 0,
        rightHipPitch = 0,
        rightHipRoll = 0,
        rightHipYaw = 0,
        leftKneeFlex = 0,
        rightKneeFlex = 0,
        leftAnklePitch = 0,
        leftAnkleYaw = 0,
        leftAnkleRoll = 0,
        rightAnklePitch = 0,
        rightAnkleYaw = 0,
        rightAnkleRoll = 0
    }) {
        // 1. 骨盆整體單元旋轉
        this.pelvisUnit.rotation.x = pelvisPitch;
        this.pelvisUnit.rotation.y = pelvisYaw;
        this.pelvisUnit.rotation.z = pelvisRoll;

        // 2. 腰椎 S 型曲度 (累加脊椎曲度)
        const lCount = this.lumbarVertebrae.length;
        let accumPitch = pelvisPitch;
        let accumYaw = pelvisYaw;
        let accumRoll = pelvisRoll;

        this.lumbarVertebrae.forEach((vert, idx) => {
            const factor = Math.sin(((idx + 1) / lCount) * (Math.PI * 0.5));
            const rotX = lumbarPitch * factor * 0.25;
            const rotY = lumbarYaw * factor * 0.25;
            const rotZ = lumbarRoll * factor * 0.25;
            vert.rotation.x = rotX;
            vert.rotation.y = rotY;
            vert.rotation.z = rotZ;
            accumPitch += rotX;
            accumYaw += rotY;
            accumRoll += rotZ;
        });

        // 3. 胸椎與肋骨整體單元 (精確補足剩餘轉角，使胸廓在世界/相機空間之姿態 100% 精確等於 thoracicPitch/Yaw/Roll)
        this.thoracicCageUnit.rotation.x = thoracicPitch - accumPitch;
        this.thoracicCageUnit.rotation.y = thoracicYaw - accumYaw;
        this.thoracicCageUnit.rotation.z = thoracicRoll - accumRoll;

        // 4. 頸椎與寰枕關節頭骨旋轉 (Cervical Spine & Skull Rotation)
        const cCount = this.cervicalVertebrae.length;
        let accumCervicalPitch = thoracicPitch;
        let accumCervicalYaw = thoracicYaw;
        let accumCervicalRoll = thoracicRoll;

        this.cervicalVertebrae.forEach((vert, idx) => {
            const factor = (idx + 1) / cCount;
            const rotX = (headPitch - thoracicPitch) * factor * 0.10;
            const rotY = (headYaw - thoracicYaw) * factor * 0.10;
            const rotZ = (headRoll - thoracicRoll) * factor * 0.10;
            vert.rotation.x = rotX;
            vert.rotation.y = rotY;
            vert.rotation.z = rotZ;
            accumCervicalPitch += rotX;
            accumCervicalYaw += rotY;
            accumCervicalRoll += rotZ;
        });

        if (this.headJoint) {
            this.headJoint.rotation.order = 'YXZ';
            this.headJoint.rotation.x = headPitch - accumCervicalPitch;
            this.headJoint.rotation.y = headYaw - accumCervicalYaw;
            this.headJoint.rotation.z = headRoll - accumCervicalRoll;
        }

        // 5. 左大臂肱骨
        if (this.shoulderGirdle.left.humerusJoint) {
            const jL = this.shoulderGirdle.left.humerusJoint;
            const safeRollL = leftArmRoll;
            jL.rotation.order = 'YXZ';
            jL.rotation.x = leftArmPitch;
            jL.rotation.y = leftArmYaw;
            jL.rotation.z = safeRollL;

            if (this.shoulderGirdle.left.clavicle) {
                // 生理肩肱節律 (Scapulohumeral Rhythm: 只有在外展超過 ~45° 時鎖骨才自然微抬)
                const elevL = Math.max(0, safeRollL - 0.75) * 0.12;
                this.shoulderGirdle.left.clavicle.rotation.z = elevL;
                this.shoulderGirdle.left.clavicle.rotation.y = -leftArmPitch * 0.05;
            }
        }

        // 6. 右大臂肱骨
        if (this.shoulderGirdle.right.humerusJoint) {
            const jR = this.shoulderGirdle.right.humerusJoint;
            const safeRollR = rightArmRoll;
            jR.rotation.order = 'YXZ';
            jR.rotation.x = rightArmPitch;
            jR.rotation.y = rightArmYaw;
            jR.rotation.z = safeRollR;

            if (this.shoulderGirdle.right.clavicle) {
                const elevR = Math.min(0, safeRollR + 0.75) * 0.12;
                this.shoulderGirdle.right.clavicle.rotation.z = elevR;
                this.shoulderGirdle.right.clavicle.rotation.y = -rightArmPitch * 0.05;
            }
        }

        // 7. 左前臂肘關節屈曲與橈骨翻轉交叉 (向前屈曲，X軸負向旋轉)
        if (this.shoulderGirdle.left.elbowJoint) {
            this.shoulderGirdle.left.elbowJoint.rotation.x = -leftElbowFlex;
            this._updateRadiusMesh('left', leftForearmTwist);
        }

        // 8. 右前臂肘關節屈曲與橈骨翻轉交叉 (向前屈曲，X軸負向旋轉)
        if (this.shoulderGirdle.right.elbowJoint) {
            this.shoulderGirdle.right.elbowJoint.rotation.x = -rightElbowFlex;
            this._updateRadiusMesh('right', rightForearmTwist);
        }

        // 9. 手部手勢更新
        if (leftHandGesture) {
            this.setHandGesture('left', leftHandGesture);
        }
        if (rightHandGesture) {
            this.setHandGesture('right', rightHandGesture);
        }

        // 10. 左下肢 (髖關節、膝關節屈曲、踝關節)
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
            this.lowerLimbs.left.ankleJoint.rotation.order = 'YXZ';
            this.lowerLimbs.left.ankleJoint.rotation.x = leftAnklePitch;
            this.lowerLimbs.left.ankleJoint.rotation.y = leftAnkleYaw;
            this.lowerLimbs.left.ankleJoint.rotation.z = leftAnkleRoll;
        }

        // 11. 右下肢 (髖關節、膝關節屈曲、踝關節)
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
            this.lowerLimbs.right.ankleJoint.rotation.order = 'YXZ';
            this.lowerLimbs.right.ankleJoint.rotation.x = rightAnklePitch;
            this.lowerLimbs.right.ankleJoint.rotation.y = rightAnkleYaw;
            this.lowerLimbs.right.ankleJoint.rotation.z = rightAnkleRoll;
        }
    }

    toggleLandmarks(visible) {
        Object.values(this.landmarks).forEach(m => m.visible = visible);
    }

    toggleRibcage(visible) {
        this.ribsLeft.forEach(r => r.visible = visible);
        this.ribsRight.forEach(r => r.visible = visible);
        if (this.sternum) this.sternum.visible = visible;
    }

    toggleSkull(visible) {
        if (this.skullGroup) this.skullGroup.visible = visible;
    }

    toggleShoulderGirdle(visible) {
        ['left', 'right'].forEach(side => {
            if (this.shoulderGirdle[side].clavicle) {
                this.shoulderGirdle[side].clavicle.visible = visible;
            }
        });
    }

    toggleArms(visible) {
        ['left', 'right'].forEach(side => {
            if (this.shoulderGirdle[side].humerus) {
                this.shoulderGirdle[side].humerus.visible = visible;
            }
        });
    }

    toggleForearms(visible) {
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
        ['left', 'right'].forEach(side => {
            if (this.shoulderGirdle[side].handGroup) {
                this.shoulderGirdle[side].handGroup.visible = visible;
            }
        });
    }

    togglePelvis(visible) {
        if (this.pelvisUnit) {
            const bonyPelvis = this.pelvisUnit.getObjectByName("Bony_Pelvis");
            if (bonyPelvis) bonyPelvis.visible = visible;
        }
    }

    toggleFemurs(visible) {
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
        ['left', 'right'].forEach(side => {
            if (this.lowerLimbs[side].footGroup) {
                this.lowerLimbs[side].footGroup.visible = visible;
            }
        });
    }
}
