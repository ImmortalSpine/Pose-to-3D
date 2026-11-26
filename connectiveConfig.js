/**
 * AnatoPose 3D - Curated Z-Anatomy Major Connective Tissue Catalog (CC BY-SA 4.0)
 *
 * 涵蓋關鍵全身關節囊、鎖骨／肩部韌帶、主要四肢關節韌帶、骨盆韌帶、肋間／脊椎韌帶與關節盤：
 * 全數對應 z-anatomy-joints.glb（原 Z-Anatomy `3: Joints` 集合），
 * 採純英文解剖名稱，並依所屬關節樞紐鏈做動態變形與性別骨架同步縮放。
 */

export const CONNECTIVE_TEMPLATES = [
    // ========================
    // 1. Clavicle & Sternoclavicular / Acromioclavicular / Shoulder
    // ========================
    { key: 'sc_capsule', meshBase: 'Articular capsule of sternoclavicular joint', name: 'Articular capsule of sternoclavicular joint', category: 'Joint Capsule', bilateral: true, chain: ['ribcage', 'clavicle'] },
    { key: 'sc_lig_ant', meshBase: 'Anterior sternoclavicular ligament', name: 'Anterior sternoclavicular ligament', category: 'Ligament', bilateral: true, chain: ['ribcage', 'clavicle'] },
    { key: 'sc_lig_post', meshBase: 'Posterior sternoclavicular ligament', name: 'Posterior sternoclavicular ligament', category: 'Ligament', bilateral: true, chain: ['ribcage', 'clavicle'] },
    { key: 'sc_disc', meshBase: 'Articular disc of sternoclavicular joint', name: 'Articular disc of sternoclavicular joint', category: 'Articular Disc', isCartilage: true, bilateral: true, chain: ['ribcage', 'clavicle'] },
    { key: 'interclav_lig', meshBase: 'Interclavicular ligament', name: 'Interclavicular ligament', category: 'Ligament', bilateral: true, chain: ['ribcage', 'clavicle'] },
    { key: 'costoclav_lig', meshBase: 'Costoclavicular ligament', name: 'Costoclavicular ligament', category: 'Ligament', bilateral: true, chain: ['ribcage', 'clavicle'] },

    { key: 'ac_capsule', meshBase: 'Articular capsule of acromioclavicular joint', name: 'Articular capsule of acromioclavicular joint', category: 'Joint Capsule', bilateral: true, chain: ['clavicle', 'scapula'] },
    { key: 'ac_lig', meshBase: 'Acromioclavicular ligament', name: 'Acromioclavicular ligament', category: 'Ligament', bilateral: true, chain: ['clavicle', 'scapula'] },
    { key: 'ac_disc', meshBase: 'Articular disc of acromioclavicular joint', name: 'Articular disc of acromioclavicular joint', category: 'Articular Disc', isCartilage: true, bilateral: true, chain: ['clavicle', 'scapula'] },
    { key: 'trapezoid_lig', meshBase: 'Trapezoid ligament', name: 'Trapezoid ligament', category: 'Ligament', bilateral: true, chain: ['clavicle', 'scapula'] },
    { key: 'conoid_lig', meshBase: 'Conoid ligament', name: 'Conoid ligament', category: 'Ligament', bilateral: true, chain: ['clavicle', 'scapula'] },
    { key: 'coracoacromial_lig', meshBase: 'Coraco-acromial ligament', name: 'Coracoacromial ligament', category: 'Ligament', bilateral: true, chain: ['scapula'] },
    { key: 'sup_trans_scap_lig', meshBase: 'Superior transverse scapular ligament', name: 'Superior transverse scapular ligament', category: 'Ligament', bilateral: true, chain: ['scapula'] },
    { key: 'inf_trans_scap_lig', meshBase: 'Inferior transverse scapular ligament', name: 'Inferior transverse scapular ligament', category: 'Ligament', bilateral: true, chain: ['scapula'] },

    { key: 'gh_capsule', meshBase: 'Articular capsule of glenohumeral joint', name: 'Articular capsule of glenohumeral joint', category: 'Joint Capsule', bilateral: true, chain: ['scapula', 'humerus'] },
    { key: 'coracohumeral_lig', meshBase: 'Coracohumeral ligament', name: 'Coracohumeral ligament', category: 'Ligament', bilateral: true, chain: ['scapula', 'humerus'] },
    { key: 'sghl', meshBase: 'Superior glenohumeral ligament', name: 'Superior glenohumeral ligament', category: 'Ligament', bilateral: true, chain: ['scapula', 'humerus'] },
    { key: 'mghl', meshBase: 'Middle glenohumeral ligament', name: 'Middle glenohumeral ligament', category: 'Ligament', bilateral: true, chain: ['scapula', 'humerus'] },
    { key: 'ighl', meshBase: 'Inferior glenohumeral ligament', name: 'Inferior glenohumeral ligament', category: 'Ligament', bilateral: true, chain: ['scapula', 'humerus'] },
    { key: 'trans_hum_lig', meshBase: 'Transverse humeral ligament', name: 'Transverse humeral ligament', category: 'Ligament', bilateral: true, chain: ['humerus'] },
    { key: 'glenoid_labrum', meshBase: 'Glenoid labrum', name: 'Glenoid labrum', category: 'Labrum / Cartilage', isCartilage: true, bilateral: true, chain: ['scapula'] },

    // ========================
    // 2. Elbow, Forearm & Wrist
    // ========================
    { key: 'elbow_capsule', meshBase: 'Articular capsule of elbow joint', name: 'Articular capsule of elbow joint', category: 'Joint Capsule', bilateral: true, chain: ['humerus', 'ulna'] },
    { key: 'ucl_elbow', meshBase: 'Ulnar collateral ligament', name: 'Ulnar collateral ligament of elbow', category: 'Ligament', bilateral: true, chain: ['humerus', 'ulna'] },
    { key: 'rcl_elbow', meshBase: 'Radial collateral ligament', name: 'Radial collateral ligament of elbow', category: 'Ligament', bilateral: true, chain: ['humerus', 'ulna'] },
    { key: 'annular_lig', meshBase: 'Annular ligament of radius', name: 'Annular ligament of radius', category: 'Ligament', bilateral: true, chain: ['ulna', 'radius'] },
    { key: 'quadrate_lig', meshBase: 'Quadrate ligament', name: 'Quadrate ligament', category: 'Ligament', bilateral: true, chain: ['ulna', 'radius'] },
    { key: 'oblique_cord', meshBase: 'Oblique cord', name: 'Oblique cord', category: 'Ligament', bilateral: true, chain: ['ulna', 'radius'] },
    { key: 'inteross_forearm', meshBase: 'Interosseous membrane of forearm', name: 'Interosseous membrane of forearm', category: 'Membrane', bilateral: true, chain: ['ulna', 'radius'] },
    { key: 'druj_disc', meshBase: 'Articular disc of distal radio-ulnar joint', name: 'Articular disc of distal radioulnar joint', category: 'Articular Disc', isCartilage: true, bilateral: true, chain: ['ulna', 'radius'] },
    { key: 'druj_dorsal', meshBase: 'Dorsal radio-ulnar ligament', name: 'Dorsal radioulnar ligament', category: 'Ligament', bilateral: true, chain: ['ulna', 'radius'] },
    { key: 'druj_palmar', meshBase: 'Palmar radio-ulnar ligament', name: 'Palmar radioulnar ligament', category: 'Ligament', bilateral: true, chain: ['ulna', 'radius'] },

    { key: 'wrist_capsule', meshBase: 'Articular capsule of radiocarpal joint', name: 'Articular capsule of radiocarpal joint', category: 'Joint Capsule', bilateral: true, chain: ['radius', 'hand'] },
    { key: 'wrist_dorsal', meshBase: 'Dorsal radiocarpal ligament', name: 'Dorsal radiocarpal ligament', category: 'Ligament', bilateral: true, chain: ['radius', 'hand'] },
    { key: 'wrist_palmar', meshBase: 'Palmar radiocarpal ligament', name: 'Palmar radiocarpal ligament', category: 'Ligament', bilateral: true, chain: ['radius', 'hand'] },
    { key: 'wrist_rcl', meshBase: 'Radial collateral ligament of wrist joint', name: 'Radial collateral ligament of wrist', category: 'Ligament', bilateral: true, chain: ['radius', 'hand'] },
    { key: 'wrist_ucl', meshBase: 'Ulnar collateral ligament of wrist joint', name: 'Ulnar collateral ligament of wrist', category: 'Ligament', bilateral: true, chain: ['ulna', 'hand'] },

    // ========================
    // 3. Pelvis & Hip
    // ========================
    { key: 'ant_si_lig', meshBase: 'Anterior sacro-iliac ligament', name: 'Anterior sacroiliac ligament', category: 'Ligament', bilateral: true, chain: ['pelvis'] },
    { key: 'post_si_lig', meshBase: 'Posterior sacro-iliac ligament', name: 'Posterior sacroiliac ligament', category: 'Ligament', bilateral: true, chain: ['pelvis'] },
    { key: 'inteross_si_lig', meshBase: 'Interosseous sacro-iliac ligament', name: 'Interosseous sacroiliac ligament', category: 'Ligament', bilateral: true, chain: ['pelvis'] },
    { key: 'sacrospinous_lig', meshBase: 'Sacrospinous ligament', name: 'Sacrospinous ligament', category: 'Ligament', bilateral: true, chain: ['pelvis'] },
    { key: 'sacrotuberous_lig', meshBase: 'Sacrotuberous ligament', name: 'Sacrotuberous ligament', category: 'Ligament', bilateral: true, chain: ['pelvis'] },
    { key: 'iliolumbar_lig', meshBase: 'Iliolumbar ligament', name: 'Iliolumbar ligament', category: 'Ligament', bilateral: true, chain: ['pelvis'] },
    { key: 'obturator_mem', meshBase: 'Obturator membrane', name: 'Obturator membrane', category: 'Membrane', bilateral: true, chain: ['pelvis'] },
    { key: 'sup_pubic_lig', meshBase: 'Superior pubic ligament', name: 'Superior pubic ligament', category: 'Ligament', bilateral: false, chain: ['pelvis'] },
    { key: 'inf_pubic_lig', meshBase: 'Inferior pubic ligament', name: 'Inferior pubic ligament', category: 'Ligament', bilateral: false, chain: ['pelvis'] },

    { key: 'hip_capsule', meshBase: 'Articular capsule of hip joint', name: 'Articular capsule of hip joint', category: 'Joint Capsule', bilateral: true, chain: ['pelvis', 'femur'] },
    { key: 'iliofemoral_desc', meshBase: 'Descending part of iliofemoral ligament', name: 'Descending part of iliofemoral ligament', category: 'Ligament', bilateral: true, chain: ['pelvis', 'femur'] },
    { key: 'iliofemoral_trans', meshBase: 'Transverse part of iliofemoral ligament', name: 'Transverse part of iliofemoral ligament', category: 'Ligament', bilateral: true, chain: ['pelvis', 'femur'] },
    { key: 'pubofemoral_lig', meshBase: 'Pubofemoral ligament', name: 'Pubofemoral ligament', category: 'Ligament', bilateral: true, chain: ['pelvis', 'femur'] },
    { key: 'ischiofemoral_lig', meshBase: 'Ischiofemoral ligament', name: 'Ischiofemoral ligament', category: 'Ligament', bilateral: true, chain: ['pelvis', 'femur'] },
    { key: 'zona_orbicularis', meshBase: 'Zona orbicularis', name: 'Zona orbicularis', category: 'Ligament', bilateral: true, chain: ['pelvis', 'femur'] },
    { key: 'acetabular_labrum', meshBase: 'Acetabular labrum', name: 'Acetabular labrum', category: 'Labrum / Cartilage', isCartilage: true, bilateral: true, chain: ['pelvis'] },
    { key: 'trans_acetab_lig', meshBase: 'Transverse acetabular ligament', name: 'Transverse acetabular ligament', category: 'Ligament', bilateral: true, chain: ['pelvis'] },

    // ========================
    // 4. Knee, Lower Leg & Ankle
    // ========================
    { key: 'knee_capsule', meshBase: 'Articular capsule of knee joint', name: 'Articular capsule of knee joint', category: 'Joint Capsule', bilateral: true, chain: ['femur', 'tibia'] },
    { key: 'mcl_sup', meshBase: 'Superficial part of tibial collateral ligament', name: 'Tibial collateral ligament (Superficial)', category: 'Ligament', bilateral: true, chain: ['femur', 'tibia'] },
    { key: 'mcl_deep', meshBase: 'Deep part of tibial collateral ligament', name: 'Tibial collateral ligament (Deep)', category: 'Ligament', bilateral: true, chain: ['femur', 'tibia'] },
    { key: 'lcl_knee', meshBase: 'Fibular collateral ligament', name: 'Fibular collateral ligament', category: 'Ligament', bilateral: true, chain: ['femur', 'tibia'] },
    { key: 'acl', meshBase: 'Anterior cruciate ligament', name: 'Anterior cruciate ligament', category: 'Ligament', bilateral: true, chain: ['femur', 'tibia'] },
    { key: 'pcl', meshBase: 'Posterior cruciate ligament', name: 'Posterior cruciate ligament', category: 'Ligament', bilateral: true, chain: ['femur', 'tibia'] },
    { key: 'lat_meniscus', meshBase: 'Lateral meniscus', name: 'Lateral meniscus', category: 'Meniscus / Cartilage', isCartilage: true, bilateral: true, chain: ['tibia'] },
    { key: 'med_meniscus', meshBase: 'Medial meniscus', name: 'Medial meniscus', category: 'Meniscus / Cartilage', isCartilage: true, bilateral: true, chain: ['tibia'] },
    { key: 'oblique_pop_lig', meshBase: 'Oblique popliteal ligament', name: 'Oblique popliteal ligament', category: 'Ligament', bilateral: true, chain: ['femur', 'tibia'] },
    { key: 'arcuate_pop_lig', meshBase: 'Arcuate popliteal ligament', name: 'Arcuate popliteal ligament', category: 'Ligament', bilateral: true, chain: ['femur', 'tibia'] },
    { key: 'trans_knee_lig', meshBase: 'Transverse ligament of knee', name: 'Transverse ligament of knee', category: 'Ligament', bilateral: true, chain: ['tibia'] },
    { key: 'meniscopatellar_lig', meshBase: 'Meniscopatellar ligament', name: 'Meniscopatellar ligament', category: 'Ligament', bilateral: true, chain: ['femur', 'tibia'] },

    { key: 'prox_tf_capsule', meshBase: 'Articular capsule of superior tibiofibular joint', name: 'Superior tibiofibular joint capsule', category: 'Joint Capsule', bilateral: true, chain: ['tibia'] },
    { key: 'ant_fib_head_lig', meshBase: 'Anterior ligament of fibular head', name: 'Anterior ligament of fibular head', category: 'Ligament', bilateral: true, chain: ['tibia'] },
    { key: 'post_fib_head_lig', meshBase: 'Posterior ligament of fibular head', name: 'Posterior ligament of fibular head', category: 'Ligament', bilateral: true, chain: ['tibia'] },
    { key: 'inteross_leg', meshBase: 'Interosseous membrane of leg', name: 'Interosseous membrane of leg', category: 'Membrane', bilateral: true, chain: ['tibia'] },
    { key: 'ant_tibfib_lig', meshBase: 'Anterior tibiofibular ligament', name: 'Anterior tibiofibular ligament', category: 'Ligament', bilateral: true, chain: ['tibia'] },
    { key: 'post_tibfib_lig', meshBase: 'Posterior tibiofibular ligament', name: 'Posterior tibiofibular ligament', category: 'Ligament', bilateral: true, chain: ['tibia'] },
    { key: 'trans_tibfib_lig', meshBase: 'Transverse tibiofibular ligament', name: 'Transverse tibiofibular ligament', category: 'Ligament', bilateral: true, chain: ['tibia'] },

    { key: 'atfl', meshBase: 'Anterior talofibular ligament', name: 'Anterior talofibular ligament', category: 'Ligament', bilateral: true, chain: ['tibia', 'foot'] },
    { key: 'ptfl', meshBase: 'Posterior talofibular ligament', name: 'Posterior talofibular ligament', category: 'Ligament', bilateral: true, chain: ['tibia', 'foot'] },
    { key: 'cfl', meshBase: 'Calcaneofibular ligament', name: 'Calcaneofibular ligament', category: 'Ligament', bilateral: true, chain: ['tibia', 'foot'] },
    { key: 'tibiocalc_lig', meshBase: 'Tibiocalcaneal ligament', name: 'Tibiocalcaneal ligament', category: 'Ligament', bilateral: true, chain: ['tibia', 'foot'] },
    { key: 'tibionav_lig', meshBase: 'Tibionavicular ligament', name: 'Tibionavicular ligament', category: 'Ligament', bilateral: true, chain: ['tibia', 'foot'] },
    { key: 'post_tibiotalar_lig', meshBase: 'Posterior tibiotalar ligament', name: 'Posterior tibiotalar ligament', category: 'Ligament', bilateral: true, chain: ['tibia', 'foot'] },
    { key: 'long_plantar_lig', meshBase: 'Long plantar ligament', name: 'Long plantar ligament', category: 'Ligament', bilateral: true, chain: ['foot'] },

    // ========================
    // 5. Spine, Thorax & Jaw (TMJ)
    // ========================
    { key: 'ext_intercost_mem', meshBase: 'External intercostal membrane', name: 'External intercostal membrane', category: 'Membrane', bilateral: true, chain: ['ribcage'] },
    { key: 'int_intercost_mem', meshBase: 'Internal intercostal membrane', name: 'Internal intercostal membrane', category: 'Membrane', bilateral: true, chain: ['ribcage'] },
    { key: 'costotrans_lig', meshBase: 'Costotransverse ligament', name: 'Costotransverse ligament', category: 'Ligament', bilateral: true, chain: ['ribcage'] },
    { key: 'radiate_rib_lig', meshBase: 'Radiate ligament of head of rib', name: 'Radiate ligament of head of rib', category: 'Ligament', bilateral: true, chain: ['ribcage'] },

    { key: 'tmj_capsule', meshBase: 'Articular capsule of temporomandibular joint', name: 'Temporomandibular joint capsule', category: 'Joint Capsule', bilateral: true, chain: ['skull'] },
    { key: 'lat_tmj_lig', meshBase: 'Lateral temporomandibular ligament', name: 'Lateral temporomandibular ligament', category: 'Ligament', bilateral: true, chain: ['skull'] },
    { key: 'sphenomandib_lig', meshBase: 'Sphenomandibular ligament', name: 'Sphenomandibular ligament', category: 'Ligament', bilateral: true, chain: ['skull'] },
    { key: 'stylomandib_lig', meshBase: 'Stylomandibular ligament', name: 'Stylomandibular ligament', category: 'Ligament', bilateral: true, chain: ['skull'] },

    { key: 'nuchal_lig', meshBase: 'Nuchal ligament', name: 'Nuchal ligament', category: 'Ligament', bilateral: false, chain: ['spine'] },
    { key: 'ant_long_lig', meshBase: 'Anterior longitudinal ligament', name: 'Anterior longitudinal ligament', category: 'Ligament', bilateral: false, chain: ['spine'] },
    { key: 'post_long_lig', meshBase: 'Posterior longitudinal ligament', name: 'Posterior longitudinal ligament', category: 'Ligament', bilateral: false, chain: ['spine'] },
    { key: 'supraspinous_lig', meshBase: 'Supraspinous ligament', name: 'Supraspinous ligament', category: 'Ligament', bilateral: false, chain: ['spine'] },
    { key: 'ligamenta_flava', meshBase: 'Ligamenta flava', name: 'Ligamenta flava', category: 'Ligament', bilateral: false, chain: ['spine'] }
];
