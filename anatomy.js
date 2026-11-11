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

        // 肩帶與上肢 (含大臂肱骨、前臂尺骨與橈骨)
        this.shoulderGirdle = {
            left: {
                clavicle: null, scapula: null, humerus: null, humerusJoint: null,
                elbowJoint: null, ulna: null, radiusGroup: null, radiusMesh: null
            },
            right: {
                clavicle: null, scapula: null, humerus: null, humerusJoint: null,
                elbowJoint: null, ulna: null, radiusGroup: null, radiusMesh: null
            }
        };

        // 頸椎骨節
        this.cervicalVertebrae = [];
        this.cervicalGroup = new THREE.Group();
        this.cervicalGroup.name = "CervicalSpine_Group";
        this.thoracicCageUnit.add(this.cervicalGroup);

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

        // 頸椎 (C7 -> C1)
        tParent.add(this.cervicalGroup);
        this.cervicalGroup.position.set(0, thoracicHeight, 0);

        let cParent = this.cervicalGroup;
        for (let i = 0; i < 7; i++) {
            const cIndex = 7 - i;
            const vert = this._createVertebraMesh(`C${cIndex}`, 1.4 - i * 0.03, 0.75, 'cervical');
            vert.position.set(0, (i === 0) ? 0 : 0.75, Math.sin((i / 6) * Math.PI) * 0.2);
            cParent.add(vert);
            this.cervicalVertebrae.push(vert);
            cParent = vert;
        }

        this._addLandmark("HeadBase", new THREE.Vector3(0, 0.8, 0), cParent);
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

        // 初始化平行旋後姿態的橈骨
        this._updateRadiusMesh(side, 0.2); // 預設微旋前

        // 標記關鍵解剖骨點
        this._addLandmark(`Olecranon_${side}`, new THREE.Vector3(sign * 6.2, 1.5, -1.6), this.thoracicCageUnit);
        this._addLandmark(`AcromionPoint_${side}`, new THREE.Vector3(sign * 6.2, 10.0, -0.8), this.thoracicCageUnit);
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
        rightForearmTwist = 0.3
    }) {
        // 1. 骨盆整體單元旋轉
        this.pelvisUnit.rotation.x = pelvisPitch;
        this.pelvisUnit.rotation.y = pelvisYaw;
        this.pelvisUnit.rotation.z = pelvisRoll;

        // 2. 腰椎 S 型曲度
        const lCount = this.lumbarVertebrae.length;
        this.lumbarVertebrae.forEach((vert, idx) => {
            const factor = Math.sin(((idx + 1) / lCount) * (Math.PI * 0.5));
            vert.rotation.x = lumbarPitch * factor * 0.25;
            vert.rotation.y = lumbarYaw * factor * 0.25;
            vert.rotation.z = lumbarRoll * factor * 0.25;
        });

        // 3. 胸椎與肋骨整體單元
        this.thoracicCageUnit.rotation.x = thoracicPitch;
        this.thoracicCageUnit.rotation.y = thoracicYaw;
        this.thoracicCageUnit.rotation.z = thoracicRoll;

        // 4. 頸椎
        const cCount = this.cervicalVertebrae.length;
        this.cervicalVertebrae.forEach((vert, idx) => {
            const factor = (idx + 1) / cCount;
            vert.rotation.x = cervicalPitch * factor * 0.2;
            vert.rotation.y = cervicalYaw * factor * 0.2;
        });

        // 5. 左大臂肱骨
        if (this.shoulderGirdle.left.humerusJoint) {
            const jL = this.shoulderGirdle.left.humerusJoint;
            const safeRollL = Math.max(0.08, leftArmRoll);
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
            const safeRollR = Math.min(-0.08, rightArmRoll);
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
    }

    toggleLandmarks(visible) {
        Object.values(this.landmarks).forEach(m => m.visible = visible);
    }

    toggleRibcage(visible) {
        this.ribsLeft.forEach(r => r.visible = visible);
        this.ribsRight.forEach(r => r.visible = visible);
        if (this.sternum) this.sternum.visible = visible;
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
            if (this.shoulderGirdle[side].elbowJoint) {
                this.shoulderGirdle[side].elbowJoint.visible = visible;
            }
        });
    }

    togglePelvis(visible) {
        if (this.pelvisUnit) {
            const bonyPelvis = this.pelvisUnit.getObjectByName("Bony_Pelvis");
            if (bonyPelvis) bonyPelvis.visible = visible;
        }
    }
}
