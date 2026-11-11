/**
 * AnatoPose 3D - Anatomical Skeleton Engine with Complete Pelvic Girdle
 * 
 * 擴充骨盆結構（Pelvic Girdle）：
 * 1. 薦骨 (Sacrum)：5 節癒合之倒三角形中軸骨，承載 L5 腰椎，向兩側以薦髂關節 (SI Joint) 連接髂骨
 * 2. 尾骨 (Coccyx)：銜接於薦骨尖端向內微勾
 * 3. 髂骨 (Ilium)：骨盆兩側大扇形翼，具備髂嵴 (Iliac Crest) 與最關鍵藝用骨點「髂前上棘 (ASIS)」
 * 4. 坐骨 (Ischium)：骨盆後下方承重基底，具備坐骨粗隆 (Ischial Tuberosity)
 * 5. 恥骨 (Pubis)：前下方骨架，左右於中央藉由恥骨聯合 (Pubic Symphysis) 閉合
 * 6. 閉孔 (Obturator Foramen) 與 髖臼 (Acetabulum)：形成完整的骨盆盆腔環與股骨關節窩
 */

import * as THREE from 'three';

export class AnatomicalTorso {
    constructor() {
        this.rootGroup = new THREE.Group();
        this.rootGroup.name = "AnatomicalTorsoRoot";

        // 骨盆核心單元 (Pelvic Girdle) - 做為人體軸心底座
        this.pelvisUnit = new THREE.Group();
        this.pelvisUnit.name = "Pelvis_Unit";
        this.rootGroup.add(this.pelvisUnit);

        this.pelvisBones = {
            sacrum: null,
            coccyx: null,
            iliumL: null,
            iliumR: null,
            ischiumL: null,
            ischiumR: null,
            pubisL: null,
            pubisR: null,
            pubicSymphysis: null
        };

        // 腰椎骨節 (起於薦骨基底 Sacral Promontory)
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

        // 肩帶與上肢骨 (鎖骨、肩胛骨、肩胛岡、肱骨)
        this.shoulderGirdle = {
            left: { clavicle: null, scapula: null, humerus: null, humerusJoint: null },
            right: { clavicle: null, scapula: null, humerus: null, humerusJoint: null }
        };

        // 頸椎骨節
        this.cervicalVertebrae = [];
        this.cervicalGroup = new THREE.Group();
        this.cervicalGroup.name = "CervicalSpine_Group";
        this.thoracicCageUnit.add(this.cervicalGroup);

        this.landmarks = {};

        // 藝用解剖材質
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
        // -------------------------------------------------------------
        // 1. 建立骨盆系統 (Pelvic Girdle: 薦骨、尾骨、髂骨、坐骨、恥骨)
        // -------------------------------------------------------------
        this._buildPelvis();

        // -------------------------------------------------------------
        // 2. 建立腰椎 (L5 -> L1) - 起自薦骨上端 (Y = 0)
        // -------------------------------------------------------------
        const lumbarHeight = 1.35;
        let parentNode = this.lumbarGroup;
        // 薦骨岬 (Sacral Promontory) 位於 Y = 0, Z = -0.6
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

        // -------------------------------------------------------------
        // 3. 建立胸廓 (Thoracic Cage: T1-T12, 12對肋骨, 胸骨)
        // -------------------------------------------------------------
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

        // -------------------------------------------------------------
        // 4. 建立肩帶系統 (鎖骨、肩胛骨、肩胛岡、肱骨)
        // -------------------------------------------------------------
        this._buildShoulderGirdle('left');
        this._buildShoulderGirdle('right');

        // -------------------------------------------------------------
        // 5. 建立頸椎 (C7 -> C1)
        // -------------------------------------------------------------
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
     * 建立真實人體解剖骨盆環 (Pelvic Girdle)
     */
    _buildPelvis() {
        const pelvisGroup = new THREE.Group();
        pelvisGroup.name = "Bony_Pelvis";
        this.pelvisUnit.add(pelvisGroup);

        // 1. 薦骨 (Sacrum)
        const sacrumMesh = this._createSacrumMesh();
        sacrumMesh.position.set(0, 0, -0.6);
        pelvisGroup.add(sacrumMesh);
        this.pelvisBones.sacrum = sacrumMesh;

        // 2. 尾骨 (Coccyx) - 接於薦骨尖端下方
        const coccyxMesh = this._createCoccyxMesh();
        coccyxMesh.position.set(0, -4.5, -1.8);
        pelvisGroup.add(coccyxMesh);
        this.pelvisBones.coccyx = coccyxMesh;

        // 3. 左右兩側髖骨複合體 (Ilium, Ischium, Pubis, Acetabulum)
        ['left', 'right'].forEach(side => {
            const hipBone = this._createInnominateBone(side);
            pelvisGroup.add(hipBone);
        });

        // 4. 恥骨聯合纖維軟骨 (Pubic Symphysis Disc)
        const symphysisGeo = new THREE.CylinderGeometry(0.35, 0.35, 1.2, 12);
        const symphysisMesh = new THREE.Mesh(symphysisGeo, this.materials.cartilage);
        symphysisMesh.name = "PubicSymphysis";
        symphysisMesh.rotation.z = Math.PI * 0.5;
        symphysisMesh.position.set(0, -3.8, 2.7);
        pelvisGroup.add(symphysisMesh);
        this.pelvisBones.pubicSymphysis = symphysisMesh;

        // 標記關鍵骨點：恥骨聯合前緣
        this._addLandmark("PubicSymphysisPoint", new THREE.Vector3(0, -3.8, 2.9), this.pelvisUnit);
    }

    /**
     * 建立薦骨 (Sacrum: 倒三角形凹弧曲面，帶薦脊與薦孔)
     */
    _createSacrumMesh() {
        const group = new THREE.Group();
        group.name = "Sacrum";

        // 薦骨本體 (三角形楔形塊，自然向後微拱曲)
        const sacrumShape = new THREE.Shape();
        sacrumShape.moveTo(-2.2, 0); // 薦骨翼左側 (Ala)
        sacrumShape.lineTo(2.2, 0);  // 薦骨翼右側
        sacrumShape.lineTo(1.5, -2.2);
        sacrumShape.lineTo(0.6, -4.2); // 薦骨尖端 (Apex)
        sacrumShape.lineTo(-0.6, -4.2);
        sacrumShape.lineTo(-1.5, -2.2);
        sacrumShape.closePath();

        const extrudeSettings = { depth: 0.9, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: 0.15, bevelThickness: 0.15 };
        const sacrumGeo = new THREE.ExtrudeGeometry(sacrumShape, extrudeSettings);
        const sacrumMesh = new THREE.Mesh(sacrumGeo, this.materials.bone);
        sacrumMesh.rotation.x = -0.22; // 薦骨自然傾斜
        sacrumMesh.position.set(0, 0, -0.5);
        sacrumMesh.castShadow = true;
        group.add(sacrumMesh);

        // 薦骨中線隆起 (Median Sacral Crest - 棘突癒合脊)
        const crestGeo = new THREE.BoxGeometry(0.35, 3.8, 0.45);
        const crestMesh = new THREE.Mesh(crestGeo, this.materials.boneHighlight);
        crestMesh.rotation.x = -0.22;
        crestMesh.position.set(0, -2.0, -0.6);
        group.add(crestMesh);

        return group;
    }

    /**
     * 建立尾骨 (Coccyx: 小型分節三角形向內彎曲)
     */
    _createCoccyxMesh() {
        const group = new THREE.Group();
        group.name = "Coccyx";

        const points = [
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0, -0.6, 0.15),
            new THREE.Vector3(0, -1.2, 0.4) // 尾端向前微鉤
        ];
        const curve = new THREE.CatmullRomCurve3(points);
        const geo = new THREE.TubeGeometry(curve, 8, 0.24, 6, false);
        const mesh = new THREE.Mesh(geo, this.materials.bone);
        group.add(mesh);

        return group;
    }

    /**
     * 建立一側的髖骨 (Innominate Bone: 髂骨、坐骨、恥骨、閉孔、髖臼)
     */
    _createInnominateBone(side) {
        const sign = (side === 'left') ? 1 : -1;
        const hipGroup = new THREE.Group();
        hipGroup.name = `HipBone_${side}`;

        // -------------------------------------------------------------
        // A. 髂骨 (Ilium) - 大扇面骨盆翼與髂嵴
        // -------------------------------------------------------------
        const iliumGroup = new THREE.Group();
        iliumGroup.name = `Ilium_${side}`;

        // 1. 髂嵴 (Iliac Crest) - 3D 空間優美 S 弧線 (繪師腰部核心基準線)
        // 從背側 PSIS (薦髂關節外側) 弧形展開至前側 ASIS
        const pPSIS = new THREE.Vector3(sign * 2.0, 0.2, -1.2);  // 髂後上棘 (維納斯之眼凹陷處)
        const pSummit = new THREE.Vector3(sign * 4.6, 0.8, 0.2); // 髂嵴最高點 (腰窩分界線)
        const pASIS = new THREE.Vector3(sign * 3.8, -1.4, 2.6);  // 髂前上棘 (腹股溝起點)

        const crestCurve = new THREE.CatmullRomCurve3([pPSIS, pSummit, pASIS]);
        const crestGeo = new THREE.TubeGeometry(crestCurve, 16, 0.25, 8, false);
        const crestMesh = new THREE.Mesh(crestGeo, this.materials.boneHighlight);
        crestMesh.castShadow = true;
        iliumGroup.add(crestMesh);

        // 2. 髂骨翼扇面 (Iliac Fossa & Ala) - 凹面骨板，朝向前內側
        const iliumShape = new THREE.Shape();
        iliumShape.moveTo(sign * 2.0, 0.0);
        iliumShape.lineTo(sign * 4.5, 0.6);
        iliumShape.lineTo(sign * 3.8, -1.4); // ASIS
        iliumShape.lineTo(sign * 3.2, -3.2); // 髖臼上緣
        iliumShape.lineTo(sign * 1.8, -2.5); // 薦髂耳狀面
        iliumShape.closePath();

        const wingGeo = new THREE.ExtrudeGeometry(iliumShape, { depth: 0.18, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08 });
        const wingMesh = new THREE.Mesh(wingGeo, this.materials.pelvisWing);
        wingMesh.position.set(0, 0, 0.2);
        wingMesh.rotation.y = -sign * 0.15; // 順應骨盆漏斗形向內收攏
        iliumGroup.add(wingMesh);

        hipGroup.add(iliumGroup);
        if (side === 'left') this.pelvisBones.iliumL = iliumGroup;
        else this.pelvisBones.iliumR = iliumGroup;

        // 標記最重要的藝用骨點：髂前上棘 (ASIS)
        this._addLandmark(`ASIS_${side}`, new THREE.Vector3(sign * 3.8, -1.4, 2.6), this.pelvisUnit);

        // -------------------------------------------------------------
        // B. 坐骨 (Ischium) - 骨盆後下方坐骨結節
        // -------------------------------------------------------------
        const ischiumGroup = new THREE.Group();
        ischiumGroup.name = `Ischium_${side}`;

        // 坐骨結節 (Ischial Tuberosity - 坐姿承重點)
        const tuberosityGeo = new THREE.SphereGeometry(0.7, 10, 10);
        const tuberosityMesh = new THREE.Mesh(tuberosityGeo, this.materials.boneHighlight);
        tuberosityMesh.scale.set(1.0, 1.4, 0.8);
        tuberosityMesh.position.set(sign * 2.6, -5.4, -0.6);
        ischiumGroup.add(tuberosityMesh);

        // 坐骨支 (Ischial Ramus - 向上向前延伸銜接恥骨)
        const ischialRamusP0 = new THREE.Vector3(sign * 2.6, -5.4, -0.6);
        const ischialRamusP1 = new THREE.Vector3(sign * 1.6, -5.2, 1.2);
        const ischialCurve = new THREE.CatmullRomCurve3([ischialRamusP0, ischialRamusP1]);
        const ramusGeo = new THREE.TubeGeometry(ischialCurve, 8, 0.25, 6, false);
        const ramusMesh = new THREE.Mesh(ramusGeo, this.materials.bone);
        ischiumGroup.add(ramusMesh);

        hipGroup.add(ischiumGroup);
        if (side === 'left') this.pelvisBones.ischiumL = ischiumGroup;
        else this.pelvisBones.ischiumR = ischiumGroup;

        // -------------------------------------------------------------
        // C. 恥骨 (Pubis) - 骨盆前下方恥骨體與恥骨支
        // -------------------------------------------------------------
        const pubisGroup = new THREE.Group();
        pubisGroup.name = `Pubis_${side}`;

        // 恥骨上支 (Superior Pubic Ramus: 髖臼延伸至中線恥骨聯合)
        const pubicP0 = new THREE.Vector3(sign * 3.0, -3.2, 1.2); // 髖臼內側
        const pubicP1 = new THREE.Vector3(sign * 1.5, -3.6, 2.4);
        const pubicP2 = new THREE.Vector3(sign * 0.45, -3.8, 2.7); // 恥骨聯合處

        const pubicCurve = new THREE.CatmullRomCurve3([pubicP0, pubicP1, pubicP2]);
        const pubicGeo = new THREE.TubeGeometry(pubicCurve, 10, 0.25, 6, false);
        const pubicMesh = new THREE.Mesh(pubicGeo, this.materials.bone);
        pubisGroup.add(pubicMesh);

        // 恥骨下支 (Inferior Pubic Ramus: 與坐骨支閉合成恥骨弓)
        const infP0 = pubicP2;
        const infP1 = ischialRamusP1;
        const infCurve = new THREE.CatmullRomCurve3([infP0, infP1]);
        const infGeo = new THREE.TubeGeometry(infCurve, 8, 0.22, 6, false);
        const infMesh = new THREE.Mesh(infGeo, this.materials.bone);
        pubisGroup.add(infMesh);

        hipGroup.add(pubisGroup);
        if (side === 'left') this.pelvisBones.pubisL = pubisGroup;
        else this.pelvisBones.pubisR = pubisGroup;

        // -------------------------------------------------------------
        // D. 髖臼 (Acetabulum) - 容納未來股骨頭的外向深凹關節窩
        // -------------------------------------------------------------
        const acetabulumGeo = new THREE.CylinderGeometry(0.75, 0.85, 0.45, 14);
        const acetabulumMesh = new THREE.Mesh(acetabulumGeo, this.materials.bone);
        acetabulumMesh.name = `Acetabulum_${side}`;
        acetabulumMesh.rotation.z = Math.PI * 0.5;
        acetabulumMesh.position.set(sign * 3.6, -3.4, 0.6);
        hipGroup.add(acetabulumMesh);

        return hipGroup;
    }

    _buildShoulderGirdle(side) {
        const sign = (side === 'left') ? 1 : -1;

        const scJoint = new THREE.Group();
        scJoint.name = `SC_Joint_${side}`;
        scJoint.position.set(sign * 1.15, 10.2, 4.6);
        this.thoracicCageUnit.add(scJoint);

        const clavicleMesh = this._createClavicleMesh(side);
        scJoint.add(clavicleMesh);
        this.shoulderGirdle[side].clavicle = scJoint;

        const acromialRelative = new THREE.Vector3(sign * 5.0, -0.2, -5.4);

        const scapulaUnit = new THREE.Group();
        scapulaUnit.name = `Scapula_Unit_${side}`;
        scapulaUnit.position.copy(acromialRelative);
        scJoint.add(scapulaUnit);

        const scapulaMesh = this._createScapulaMesh(side);
        scapulaUnit.add(scapulaMesh);
        this.shoulderGirdle[side].scapula = scapulaUnit;

        const ghJoint = new THREE.Group();
        ghJoint.name = `GH_Joint_${side}`;
        ghJoint.position.set(sign * 0.35, -1.2, 0.2);
        scapulaUnit.add(ghJoint);

        const humerusMesh = this._createHumerusMesh(side);
        ghJoint.add(humerusMesh);
        this.shoulderGirdle[side].humerus = humerusMesh;
        this.shoulderGirdle[side].humerusJoint = ghJoint;

        ghJoint.rotation.z = sign * 0.12;

        this._addLandmark(`AcromionPoint_${side}`, new THREE.Vector3(sign * 6.2, 10.0, -0.8), this.thoracicCageUnit);
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
     * 完整姿態驅動（含骨盆、腰椎、胸廓、肩帶與雙臂）
     */
    setTorsoPose({
        // 骨盆旋轉 (Pelvis Tilt & Twist)
        pelvisRoll = 0,
        pelvisPitch = 0,
        pelvisYaw = 0,
        // 胸廓與脊椎
        thoracicPitch = 0,
        thoracicYaw = 0,
        thoracicRoll = 0,
        lumbarPitch = 0,
        lumbarYaw = 0,
        lumbarRoll = 0,
        cervicalPitch = 0,
        cervicalYaw = 0,
        // 雙臂肱骨
        leftArmPitch = 0,
        leftArmRoll = 0.12,
        leftArmYaw = 0,
        rightArmPitch = 0,
        rightArmRoll = -0.12,
        rightArmYaw = 0
    }) {
        // 1. 骨盆整體單元旋轉 (做為人體下身底座，展現 Contrapposto 傾斜對抗)
        this.pelvisUnit.rotation.x = pelvisPitch;
        this.pelvisUnit.rotation.y = pelvisYaw;
        this.pelvisUnit.rotation.z = pelvisRoll;

        // 2. 腰椎 S 型曲度 (連接骨盆與胸廓)
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

        // 5. 左臂肱骨 (防穿模約束)
        if (this.shoulderGirdle.left.humerusJoint) {
            const jL = this.shoulderGirdle.left.humerusJoint;
            const safeRollL = Math.max(0.06, leftArmRoll);
            jL.rotation.x = leftArmPitch;
            jL.rotation.y = leftArmYaw;
            jL.rotation.z = safeRollL;

            if (this.shoulderGirdle.left.clavicle) {
                this.shoulderGirdle.left.clavicle.rotation.z = -safeRollL * 0.15;
            }
        }

        // 6. 右臂肱骨 (防穿模約束)
        if (this.shoulderGirdle.right.humerusJoint) {
            const jR = this.shoulderGirdle.right.humerusJoint;
            const safeRollR = Math.min(-0.06, rightArmRoll);
            jR.rotation.x = rightArmPitch;
            jR.rotation.y = rightArmYaw;
            jR.rotation.z = safeRollR;

            if (this.shoulderGirdle.right.clavicle) {
                this.shoulderGirdle.right.clavicle.rotation.z = -safeRollR * 0.15;
            }
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

    togglePelvis(visible) {
        if (this.pelvisUnit) {
            const bonyPelvis = this.pelvisUnit.getObjectByName("Bony_Pelvis");
            if (bonyPelvis) bonyPelvis.visible = visible;
        }
    }
}
