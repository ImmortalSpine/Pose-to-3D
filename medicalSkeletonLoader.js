/**
 * AnatoPose 3D - Open-Source Medical Skeleton Loader (BodyParts3D / Z-Anatomy 206-Bone Dataset)
 *
 * 載入開源醫學 CT 掃描 3D 骨骼模型 (skeleton.glb, 278 獨立解剖網格 = 206 塊成人骨 + 肋軟骨 + 椎間盤 + 牙列)
 * 並提供標準英文解剖學命名字典與高精度關節樞紐座標表。
 */

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const GLB_SCALE = 28.0; // 將真實公尺尺度 (~1.71m) 等比映射至系統約 48.0 單位身高

/**
 * 醫學模型原始公尺座標系之關節樞紐基準點 (Meters, Y-up, +Z Anterior, +X Left)
 */
export const GLB_PIVOTS_M = {
    pelvisOrigin: [0, 0.960, -0.028],
    lumbar: [
        { name: 'l5', pivot: [0, 0.962, -0.015], disc: 'disc_l5_s1' },
        { name: 'l4', pivot: [0, 0.996, -0.005], disc: 'disc_l4_l5' },
        { name: 'l3', pivot: [0, 1.030, -0.001], disc: 'disc_l3_l4' },
        { name: 'l2', pivot: [0, 1.066, -0.001], disc: 'disc_l2_l3' },
        { name: 'l1', pivot: [0, 1.100, -0.005], disc: 'disc_l1_l2' }
    ],
    thoraxOrigin: [0, 1.132, -0.013],
    cervicalOrigin: [0, 1.442, -0.019],
    cervical: [
        { name: 'c7', pivot: [0, 1.442, -0.019], disc: 'disc_c7_t1' },
        { name: 'c6', pivot: [0, 1.456, -0.014], disc: 'disc_c6_c7' },
        { name: 'c5', pivot: [0, 1.470, -0.010], disc: 'disc_c5_c6' },
        { name: 'c4', pivot: [0, 1.486, -0.009], disc: 'disc_c4_c5' },
        { name: 'c3', pivot: [0, 1.503, -0.008], disc: 'disc_c3_c4' },
        { name: 'c2', pivot: [0, 1.518, -0.009], disc: 'disc_c2_c3' },
        { name: 'c1', pivot: [0, 1.535, -0.015], disc: null }
    ],
    headPivot: [0, 1.548, -0.020],
    claviclePivotX: 0.016,
    claviclePivotY: 1.391,
    claviclePivotZ: 0.034,
    scapulaPivotX: 0.160,
    scapulaPivotY: 1.380,
    scapulaPivotZ: -0.022,
    shoulderPivotX: 0.160,
    shoulderPivotY: 1.380,
    shoulderPivotZ: -0.022,
    elbowPivotX: 0.214,
    elbowPivotY: 1.104,
    elbowPivotZ: -0.038,
    radProxX: 0.240,
    radProxY: 1.092,
    radProxZ: -0.025,
    radDistX: 0.283,
    radDistY: 0.858,
    radDistZ: 0.016,
    ulnaDistX: 0.245,
    ulnaDistY: 0.858,
    ulnaDistZ: 0.011,
    wristPivotX: 0.264,
    wristPivotY: 0.858,
    wristPivotZ: 0.0135,
    hipPivotX: 0.0705,
    hipPivotY: 0.864,
    hipPivotZ: -0.0073,
    kneePivotX: 0.072,
    kneePivotY: 0.4335,
    kneePivotZ: -0.030,
    anklePivotX: 0.074,
    anklePivotY: 0.080,
    anklePivotZ: -0.038,
    fingers: {
        Thumb:  { idx: 1, mcp: [0.3181, 0.8156, 0.0508], pip: [0.3232, 0.7852, 0.0572], dip: null,                    tip: [0.3328, 0.7673, 0.0706] },
        Index:  { idx: 2, mcp: [0.3008, 0.7704, 0.0397], pip: [0.3070, 0.7336, 0.0532], dip: [0.3144, 0.7181, 0.0707], tip: [0.3178, 0.7088, 0.0869] },
        Middle: { idx: 3, mcp: [0.2759, 0.7716, 0.0423], pip: [0.2801, 0.7317, 0.0614], dip: [0.2846, 0.7092, 0.0795], tip: [0.2861, 0.6997, 0.0953] },
        Ring:   { idx: 4, mcp: [0.2547, 0.7768, 0.0436], pip: [0.2568, 0.7374, 0.0575], dip: [0.2591, 0.7164, 0.0791], tip: [0.2588, 0.7113, 0.0938] },
        Little: { idx: 5, mcp: [0.2345, 0.7840, 0.0451], pip: [0.2345, 0.7512, 0.0561], dip: [0.2304, 0.7351, 0.0700], tip: [0.2294, 0.7234, 0.0816] }
    }
};

const ORDINALS = ['First', 'Second', 'Third', 'Fourth', 'Fifth'];
const FINGER_FULL = ['Thumb', 'Index Finger', 'Middle Finger', 'Ring Finger', 'Little Finger'];
const TOE_FULL = ['Hallux (Big Toe)', 'Second Toe', 'Third Toe', 'Fourth Toe', 'Fifth Toe'];

function buildEnglishNameMap() {
    const map = {
        // 顱骨與耳聽小骨、舌骨 (29)
        frontal: 'Frontal Bone',
        occipital: 'Occipital Bone',
        sphenoid: 'Sphenoid Bone',
        ethmoid: 'Ethmoid Bone',
        vomer: 'Vomer',
        mandible: 'Mandible',
        hyoid: 'Hyoid Bone',
        parietal_l: 'Left Parietal Bone',
        parietal_r: 'Right Parietal Bone',
        temporal_l: 'Left Temporal Bone',
        temporal_r: 'Right Temporal Bone',
        nasal_l: 'Left Nasal Bone',
        nasal_r: 'Right Nasal Bone',
        maxilla_l: 'Left Maxilla',
        maxilla_r: 'Right Maxilla',
        lacrimal_l: 'Left Lacrimal Bone',
        lacrimal_r: 'Right Lacrimal Bone',
        zygomatic_l: 'Left Zygomatic Bone',
        zygomatic_r: 'Right Zygomatic Bone',
        palatine_l: 'Left Palatine Bone',
        palatine_r: 'Right Palatine Bone',
        inf_concha_l: 'Left Inferior Nasal Concha',
        inf_concha_r: 'Right Inferior Nasal Concha',
        malleus_l: 'Left Malleus',
        malleus_r: 'Right Malleus',
        incus_l: 'Left Incus',
        incus_r: 'Right Incus',
        stapes_l: 'Left Stapes',
        stapes_r: 'Right Stapes',

        // 脊椎與骨盆 (28)
        c1: 'Cervical Vertebra C1 (Atlas)',
        c2: 'Cervical Vertebra C2 (Axis)',
        sacrum: 'Sacrum',
        coccyx: 'Coccyx',
        sternum: 'Sternum',
        hip_l: 'Left Hip Bone (Os Coxae)',
        hip_r: 'Right Hip Bone (Os Coxae)',
        interpubic_disc: 'Pubic Symphysis (Interpubic Disc)'
    };

    for (let i = 3; i <= 7; i++) map[`c${i}`] = `Cervical Vertebra C${i}`;
    for (let i = 1; i <= 12; i++) map[`t${i}`] = `Thoracic Vertebra T${i}`;
    for (let i = 1; i <= 5; i++) map[`l${i}`] = `Lumbar Vertebra L${i}`;

    // 肋骨與肋軟骨
    for (let i = 1; i <= 12; i++) {
        map[`rib${i}_l`] = `Left Rib ${i}`;
        map[`rib${i}_r`] = `Right Rib ${i}`;
        if (i <= 10) {
            map[`cc${i}_l`] = `Left Costal Cartilage ${i}`;
            map[`cc${i}_r`] = `Right Costal Cartilage ${i}`;
        }
    }

    // 椎間盤
    const discPairs = [
        ['c2', 'c3'], ['c3', 'c4'], ['c4', 'c5'], ['c5', 'c6'], ['c6', 'c7'],
        ['c7', 't1'], ['t1', 't2'], ['t2', 't3'], ['t3', 't4'], ['t4', 't5'],
        ['t5', 't6'], ['t6', 't7'], ['t7', 't8'], ['t8', 't9'], ['t9', 't10'],
        ['t10', 't11'], ['t11', 't12'], ['t12', 'l1'], ['l1', 'l2'], ['l2', 'l3'],
        ['l3', 'l4'], ['l4', 'l5'], ['l5', 's1']
    ];
    for (const [a, b] of discPairs) {
        map[`disc_${a}_${b}`] = `Intervertebral Disc ${a.toUpperCase()}-${b.toUpperCase()}`;
    }

    // 左右對稱四肢、手部、足部骨骼
    for (const s of ['l', 'r']) {
        const side = s === 'l' ? 'Left' : 'Right';
        map[`clavicle_${s}`] = `${side} Clavicle`;
        map[`scapula_${s}`] = `${side} Scapula`;
        map[`humerus_${s}`] = `${side} Humerus`;
        map[`radius_${s}`] = `${side} Radius`;
        map[`ulna_${s}`] = `${side} Ulna`;

        map[`scaphoid_${s}`] = `${side} Scaphoid`;
        map[`lunate_${s}`] = `${side} Lunate`;
        map[`triquetrum_${s}`] = `${side} Triquetrum`;
        map[`pisiform_${s}`] = `${side} Pisiform`;
        map[`trapezium_${s}`] = `${side} Trapezium`;
        map[`trapezoid_${s}`] = `${side} Trapezoid`;
        map[`capitate_${s}`] = `${side} Capitate`;
        map[`hamate_${s}`] = `${side} Hamate`;

        map[`femur_${s}`] = `${side} Femur`;
        map[`patella_${s}`] = `${side} Patella`;
        map[`tibia_${s}`] = `${side} Tibia`;
        map[`fibula_${s}`] = `${side} Fibula`;

        map[`talus_${s}`] = `${side} Talus`;
        map[`calcaneus_${s}`] = `${side} Calcaneus`;
        map[`navicular_${s}`] = `${side} Navicular`;
        map[`cuboid_${s}`] = `${side} Cuboid`;
        map[`med_cuneiform_${s}`] = `${side} Medial Cuneiform`;
        map[`int_cuneiform_${s}`] = `${side} Intermediate Cuneiform`;
        map[`lat_cuneiform_${s}`] = `${side} Lateral Cuneiform`;

        for (let i = 1; i <= 5; i++) {
            map[`mc${i}_${s}`] = `${side} ${ORDINALS[i - 1]} Metacarpal`;
            map[`pph${i}_hand_${s}`] = `${side} Proximal Phalanx of ${FINGER_FULL[i - 1]}`;
            if (i >= 2) {
                map[`mph${i}_hand_${s}`] = `${side} Middle Phalanx of ${FINGER_FULL[i - 1]}`;
            }
            map[`dph${i}_hand_${s}`] = `${side} Distal Phalanx of ${FINGER_FULL[i - 1]}`;

            map[`mt${i}_${s}`] = `${side} ${ORDINALS[i - 1]} Metatarsal`;
            map[`pph${i}_foot_${s}`] = `${side} Proximal Phalanx of ${TOE_FULL[i - 1]}`;
            if (i >= 2) {
                map[`mph${i}_foot_${s}`] = `${side} Middle Phalanx of ${TOE_FULL[i - 1]}`;
            }
            map[`dph${i}_foot_${s}`] = `${side} Distal Phalanx of ${TOE_FULL[i - 1]}`;
        }

        // 牙列 28 顆
        map[`tooth_upper_medial_incisor_${s}`] = `Upper ${side} Central Incisor`;
        map[`tooth_upper_lateral_incisor_${s}`] = `Upper ${side} Lateral Incisor`;
        map[`tooth_upper_canine_${s}`] = `Upper ${side} Canine`;
        map[`tooth_upper_first_premolar_${s}`] = `Upper ${side} First Premolar`;
        map[`tooth_upper_second_premolar_${s}`] = `Upper ${side} Second Premolar`;
        map[`tooth_upper_first_molar_tooth_${s}`] = `Upper ${side} First Molar`;
        map[`tooth_upper_second_molar_tooth_${s}`] = `Upper ${side} Second Molar`;

        map[`tooth_lower_medial_incisor_${s}`] = `Lower ${side} Central Incisor`;
        map[`tooth_lower_lateral_incisor_${s}`] = `Lower ${side} Lateral Incisor`;
        map[`tooth_lower_canine_${s}`] = `Lower ${side} Canine`;
        map[`tooth_lower_first_premolar_${s}`] = `Lower ${side} First Premolar`;
        map[`tooth_lower_second_premolar_${s}`] = `Lower ${side} Second Premolar`;
        map[`tooth_lower_first_molar_tooth_${s}`] = `Lower ${side} First Molar`;
        map[`tooth_lower_second_molar_tooth_${s}`] = `Lower ${side} Second Molar`;
    }

    return map;
}

export const BONE_ENGLISH_NAMES = buildEnglishNameMap();

export const SKULL_NODE_NAMES = [
    'frontal', 'occipital', 'sphenoid', 'ethmoid', 'vomer', 'mandible',
    'parietal_l', 'parietal_r', 'temporal_l', 'temporal_r', 'nasal_l', 'nasal_r',
    'maxilla_l', 'maxilla_r', 'lacrimal_l', 'lacrimal_r', 'zygomatic_l', 'zygomatic_r',
    'palatine_l', 'palatine_r', 'inf_concha_l', 'inf_concha_r',
    'malleus_l', 'malleus_r', 'incus_l', 'incus_r', 'stapes_l', 'stapes_r',
    'tooth_upper_medial_incisor_l', 'tooth_upper_medial_incisor_r',
    'tooth_upper_lateral_incisor_l', 'tooth_upper_lateral_incisor_r',
    'tooth_upper_canine_l', 'tooth_upper_canine_r',
    'tooth_upper_first_premolar_l', 'tooth_upper_first_premolar_r',
    'tooth_upper_second_premolar_l', 'tooth_upper_second_premolar_r',
    'tooth_upper_first_molar_tooth_l', 'tooth_upper_first_molar_tooth_r',
    'tooth_upper_second_molar_tooth_l', 'tooth_upper_second_molar_tooth_r',
    'tooth_lower_medial_incisor_l', 'tooth_lower_medial_incisor_r',
    'tooth_lower_lateral_incisor_l', 'tooth_lower_lateral_incisor_r',
    'tooth_lower_canine_l', 'tooth_lower_canine_r',
    'tooth_lower_first_premolar_l', 'tooth_lower_first_premolar_r',
    'tooth_lower_second_premolar_l', 'tooth_lower_second_premolar_r',
    'tooth_lower_first_molar_tooth_l', 'tooth_lower_first_molar_tooth_r',
    'tooth_lower_second_molar_tooth_l', 'tooth_lower_second_molar_tooth_r'
];

export const CARPAL_NAMES = [
    'scaphoid', 'lunate', 'triquetrum', 'pisiform',
    'trapezium', 'trapezoid', 'capitate', 'hamate'
];

export const FOOT_STATIC_NAMES = [
    'talus', 'calcaneus', 'navicular', 'cuboid',
    'med_cuneiform', 'int_cuneiform', 'lat_cuneiform',
    'mt1', 'mt2', 'mt3', 'mt4', 'mt5',
    'pph1_foot', 'pph2_foot', 'pph3_foot', 'pph4_foot', 'pph5_foot',
    'mph2_foot', 'mph3_foot', 'mph4_foot', 'mph5_foot',
    'dph1_foot', 'dph2_foot', 'dph3_foot', 'dph4_foot', 'dph5_foot'
];

/**
 * 載入 skeleton.glb 並將 278 個解剖網格轉為字典 { nodeName: THREE.Mesh }
 */
export async function loadMedicalSkeletonGLB(url = './skeleton.glb') {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(url);
    const meshMap = {};

    gltf.scene.traverse((obj) => {
        if (obj.isMesh && obj.name) {
            meshMap[obj.name] = obj;
        }
    });

    return meshMap;
}
