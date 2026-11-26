/**
 * AnatoPose 3D - Z-Anatomy Medical Muscle Catalog & Joint Rigging Map (Phase 1: Chest & Upper Limb)
 *
 * 資料來源：Z-Anatomy (衍生自 BodyParts3D, CC BY-SA 4.0) 獨立解剖肌肉網格 z-anatomy-muscles.glb
 * 包含 37 對（共 74 塊）胸部、肩胛旋轉袖、上臂與前臂的淺層／深層獨立肌肉，
 * 全數採標準純英文解剖學名稱，並配置對應之起止骨骼鏈與關節過渡帶參數。
 */

export const PHASE1_MUSCLE_TEMPLATES = [
    // ========================
    // 1. Chest (Pectoral Region)
    // ========================
    {
        key: 'pectoralis_major_clavicular',
        name: 'Clavicular head of pectoralis major muscle',
        idLeft: 'STR-MUS-0039',
        idRight: 'STR-MUS-0040',
        region: 'chest',
        layer: 'superficial',
        isFan: true,
        originM: [0.045, 1.395, 0.045],
        insertM: [0.192, 1.312, -0.010],
        chain: [
            { role: 'clavicle' },
            { role: 'humerus', jointPivotM: [0.160, 1.380, -0.022], bandM: 0.048 }
        ],
        bellyScale: 0.36
    },
    {
        key: 'pectoralis_major_sternocostal',
        name: 'Sternocostal head of pectoralis major muscle',
        idLeft: 'STR-MUS-0382',
        idRight: 'STR-MUS-0383',
        region: 'chest',
        layer: 'superficial',
        isFan: true,
        originM: [0.020, 1.310, 0.100],
        insertM: [0.192, 1.315, -0.010],
        chain: [
            { role: 'ribcage' },
            { role: 'humerus', jointPivotM: [0.160, 1.380, -0.022], bandM: 0.055 }
        ],
        bellyScale: 0.42
    },
    {
        key: 'pectoralis_major_abdominal',
        name: 'Abdominal part of pectoralis major muscle',
        idLeft: 'STR-MUS-0001',
        idRight: 'STR-MUS-0002',
        region: 'chest',
        layer: 'superficial',
        isFan: true,
        originM: [0.065, 1.195, 0.095],
        insertM: [0.188, 1.320, -0.012],
        chain: [
            { role: 'ribcage' },
            { role: 'humerus', jointPivotM: [0.160, 1.380, -0.022], bandM: 0.055 }
        ],
        bellyScale: 0.34
    },
    {
        key: 'pectoralis_minor',
        name: 'Pectoralis minor muscle',
        idLeft: 'STR-MUS-0284',
        idRight: 'STR-MUS-0285',
        region: 'chest',
        layer: 'deep',
        isFan: true,
        originM: [0.085, 1.270, 0.070],
        insertM: [0.135, 1.394, -0.008],
        chain: [
            { role: 'ribcage' },
            { role: 'scapula', jointPivotM: [0.115, 1.350, 0.020], bandM: 0.045 }
        ],
        bellyScale: 0.25
    },
    {
        key: 'subclavius',
        name: 'Subclavius muscle',
        idLeft: 'STR-MUS-0394',
        idRight: 'STR-MUS-0395',
        region: 'chest',
        layer: 'deep',
        originM: [0.032, 1.380, 0.035],
        insertM: [0.110, 1.402, -0.012],
        chain: [
            { role: 'ribcage' },
            { role: 'clavicle', jointPivotM: [0.016, 1.391, 0.034], bandM: 0.040 }
        ],
        bellyScale: 0.14
    },

    // ========================
    // 2. Shoulder & Rotator Cuff
    // ========================
    {
        key: 'deltoid_clavicular',
        name: 'Clavicular part of deltoid muscle',
        idLeft: 'STR-MUS-0041',
        idRight: 'STR-MUS-0042',
        region: 'shoulder',
        layer: 'superficial',
        isFan: true,
        fanNormalM: [0.45, 0.15, 0.88],
        origTendonBand: 0.05,
        insTendonBand: 0.18,
        originM: [0.120, 1.410, -0.015],
        insertM: [0.203, 1.268, -0.028],
        chain: [
            { role: 'clavicle' },
            { role: 'humerus', jointPivotM: [0.160, 1.380, -0.022], bandM: 0.045 }
        ],
        bellyScale: 0.36
    },
    {
        key: 'deltoid_acromial',
        name: 'Acromial part of deltoid muscle',
        idLeft: 'STR-MUS-0017',
        idRight: 'STR-MUS-0018',
        region: 'shoulder',
        layer: 'superficial',
        isFan: true,
        fanNormalM: [0.98, 0.15, 0.0],
        origTendonBand: 0.05,
        insTendonBand: 0.18,
        originM: [0.167, 1.408, -0.045],
        insertM: [0.205, 1.268, -0.032],
        chain: [
            { role: 'scapula' },
            { role: 'humerus', jointPivotM: [0.160, 1.380, -0.022], bandM: 0.042 }
        ],
        bellyScale: 0.40
    },
    {
        key: 'deltoid_spinal',
        name: 'Scapular spinal part of deltoid muscle',
        idLeft: 'STR-MUS-0348',
        idRight: 'STR-MUS-0349',
        region: 'shoulder',
        layer: 'superficial',
        isFan: true,
        fanNormalM: [0.45, 0.15, -0.88],
        origTendonBand: 0.05,
        insTendonBand: 0.18,
        originM: [0.105, 1.380, -0.090],
        insertM: [0.203, 1.268, -0.036],
        chain: [
            { role: 'scapula' },
            { role: 'humerus', jointPivotM: [0.160, 1.380, -0.022], bandM: 0.045 }
        ],
        bellyScale: 0.36
    },
    {
        key: 'supraspinatus',
        name: 'Supraspinatus muscle',
        idLeft: 'STR-MUS-0416',
        idRight: 'STR-MUS-0417',
        region: 'shoulder',
        layer: 'deep',
        originM: [0.095, 1.390, -0.068],
        insertM: [0.185, 1.392, -0.025],
        chain: [
            { role: 'scapula' },
            { role: 'humerus', jointPivotM: [0.160, 1.380, -0.022], bandM: 0.028 }
        ],
        bellyScale: 0.22
    },
    {
        key: 'infraspinatus',
        name: 'Infraspinatus muscle',
        idLeft: 'STR-MUS-0164',
        idRight: 'STR-MUS-0165',
        region: 'shoulder',
        layer: 'deep',
        isFan: true,
        originM: [0.085, 1.320, -0.095],
        insertM: [0.188, 1.382, -0.035],
        chain: [
            { role: 'scapula' },
            { role: 'humerus', jointPivotM: [0.160, 1.380, -0.022], bandM: 0.030 }
        ],
        bellyScale: 0.28
    },
    {
        key: 'subscapularis',
        name: 'Subscapularis muscle',
        idLeft: 'STR-MUS-0396',
        idRight: 'STR-MUS-0397',
        region: 'shoulder',
        layer: 'deep',
        isFan: true,
        originM: [0.085, 1.320, -0.065],
        insertM: [0.172, 1.375, -0.012],
        chain: [
            { role: 'scapula' },
            { role: 'humerus', jointPivotM: [0.160, 1.380, -0.022], bandM: 0.028 }
        ],
        bellyScale: 0.26
    },
    {
        key: 'teres_minor',
        name: 'Teres minor muscle',
        idLeft: 'STR-MUS-0428',
        idRight: 'STR-MUS-0429',
        region: 'shoulder',
        layer: 'deep',
        originM: [0.115, 1.300, -0.075],
        insertM: [0.190, 1.372, -0.042],
        chain: [
            { role: 'scapula' },
            { role: 'humerus', jointPivotM: [0.160, 1.380, -0.022], bandM: 0.030 }
        ],
        bellyScale: 0.22
    },
    {
        key: 'teres_major',
        name: 'Teres major muscle',
        idLeft: 'STR-MUS-0426',
        idRight: 'STR-MUS-0427',
        region: 'shoulder',
        layer: 'deep',
        originM: [0.105, 1.275, -0.078],
        insertM: [0.185, 1.325, -0.018],
        chain: [
            { role: 'scapula' },
            { role: 'humerus', jointPivotM: [0.160, 1.380, -0.022], bandM: 0.036 }
        ],
        bellyScale: 0.28
    },

    // ========================
    // 3. Upper Arm
    // ========================
    {
        key: 'biceps_long_head',
        name: 'Long head of biceps brachii',
        idLeft: 'STR-MUS-0204',
        idRight: 'STR-MUS-0205',
        region: 'arm',
        layer: 'superficial',
        boneClearance: 'arm',
        originM: [0.158, 1.392, -0.020],
        insertM: [0.238, 1.064, -0.019],
        chain: [
            { role: 'scapula' },
            { role: 'humerus', jointPivotM: [0.160, 1.380, -0.022], bandM: 0.038 },
            { role: 'radius', jointPivotM: [0.214, 1.104, -0.038], bandM: 0.036 }
        ],
        bellyScale: 0.42
    },
    {
        key: 'biceps_short_head',
        name: 'Short head of biceps brachii',
        idLeft: 'STR-MUS-0364',
        idRight: 'STR-MUS-0365',
        region: 'arm',
        layer: 'superficial',
        boneClearance: 'arm',
        originM: [0.135, 1.394, -0.008],
        insertM: [0.238, 1.064, -0.019],
        chain: [
            { role: 'scapula' },
            { role: 'humerus', jointPivotM: [0.160, 1.380, -0.022], bandM: 0.038 },
            { role: 'radius', jointPivotM: [0.214, 1.104, -0.038], bandM: 0.036 }
        ],
        bellyScale: 0.40
    },
    {
        key: 'coracobrachialis',
        name: 'Coracobrachialis muscle',
        idLeft: 'STR-MUS-0045',
        idRight: 'STR-MUS-0046',
        region: 'arm',
        layer: 'deep',
        originM: [0.135, 1.392, -0.008],
        insertM: [0.192, 1.250, -0.022],
        chain: [
            { role: 'scapula' },
            { role: 'humerus', jointPivotM: [0.160, 1.380, -0.022], bandM: 0.036 }
        ],
        bellyScale: 0.25
    },
    {
        key: 'brachialis',
        name: 'Brachialis muscle',
        idLeft: 'STR-MUS-0033',
        idRight: 'STR-MUS-0034',
        region: 'arm',
        layer: 'deep',
        boneClearance: 'arm',
        originM: [0.200, 1.260, -0.025],
        insertM: [0.216, 1.076, -0.024],
        chain: [
            { role: 'humerus' },
            { role: 'ulna', jointPivotM: [0.214, 1.104, -0.038], bandM: 0.035 }
        ],
        bellyScale: 0.34
    },
    {
        key: 'triceps_long_head',
        name: 'Long head of triceps brachii',
        idLeft: 'STR-MUS-0208',
        idRight: 'STR-MUS-0209',
        region: 'arm',
        layer: 'superficial',
        boneClearance: 'arm_posterior',
        originM: [0.142, 1.348, -0.052],
        insertM: [0.213, 1.102, -0.052],
        chain: [
            { role: 'scapula' },
            { role: 'humerus', jointPivotM: [0.160, 1.380, -0.022], bandM: 0.040 },
            { role: 'ulna', jointPivotM: [0.214, 1.104, -0.038], bandM: 0.034 }
        ],
        bellyScale: 0.42
    },
    {
        key: 'triceps_lateral_head',
        name: 'Lateral head of triceps brachii',
        idLeft: 'STR-MUS-0184',
        idRight: 'STR-MUS-0185',
        region: 'arm',
        layer: 'superficial',
        boneClearance: 'arm_posterior',
        originM: [0.194, 1.335, -0.045],
        insertM: [0.213, 1.102, -0.052],
        chain: [
            { role: 'humerus' },
            { role: 'ulna', jointPivotM: [0.214, 1.104, -0.038], bandM: 0.034 }
        ],
        bellyScale: 0.38
    },
    {
        key: 'triceps_medial_head',
        name: 'Medial head of triceps brachii',
        idLeft: 'STR-MUS-0228',
        idRight: 'STR-MUS-0229',
        region: 'arm',
        layer: 'deep',
        boneClearance: 'arm_posterior',
        originM: [0.200, 1.240, -0.045],
        insertM: [0.213, 1.102, -0.052],
        chain: [
            { role: 'humerus' },
            { role: 'ulna', jointPivotM: [0.214, 1.104, -0.038], bandM: 0.032 }
        ],
        bellyScale: 0.32
    },
    {
        key: 'anconeus',
        name: 'Anconeus muscle',
        idLeft: 'STR-MUS-0025',
        idRight: 'STR-MUS-0026',
        region: 'arm',
        layer: 'superficial',
        originM: [0.233, 1.102, -0.040],
        insertM: [0.220, 1.055, -0.042],
        chain: [
            { role: 'humerus' },
            { role: 'ulna', jointPivotM: [0.214, 1.104, -0.038], bandM: 0.025 }
        ],
        bellyScale: 0.18
    },

    // ========================
    // 4. Forearm
    // ========================
    {
        key: 'brachioradialis',
        name: 'Brachioradialis muscle',
        idLeft: 'STR-MUS-0035',
        idRight: 'STR-MUS-0036',
        region: 'forearm',
        layer: 'superficial',
        boneClearance: 'forearm',
        originM: [0.232, 1.170, -0.030],
        insertM: [0.283, 0.864, 0.016],
        chain: [
            { role: 'humerus' },
            { role: 'radius', jointPivotM: [0.214, 1.104, -0.038], bandM: 0.038 }
        ],
        bellyScale: 0.32
    },
    {
        key: 'ecrl',
        name: 'Extensor carpi radialis longus',
        idLeft: 'STR-MUS-0072',
        idRight: 'STR-MUS-0073',
        region: 'forearm',
        layer: 'superficial',
        boneClearance: 'forearm',
        originM: [0.234, 1.140, -0.035],
        insertM: [0.278, 0.830, 0.018],
        chain: [
            { role: 'humerus' },
            { role: 'radius', jointPivotM: [0.214, 1.104, -0.038], bandM: 0.035 },
            { role: 'hand', jointPivotM: [0.264, 0.858, 0.0135], bandM: 0.022 }
        ],
        bellyScale: 0.26
    },
    {
        key: 'ecrb',
        name: 'Extensor carpi radialis brevis',
        idLeft: 'STR-MUS-0070',
        idRight: 'STR-MUS-0071',
        region: 'forearm',
        layer: 'superficial',
        boneClearance: 'forearm',
        originM: [0.235, 1.102, -0.037],
        insertM: [0.270, 0.830, 0.016],
        chain: [
            { role: 'humerus' },
            { role: 'radius', jointPivotM: [0.214, 1.104, -0.038], bandM: 0.032 },
            { role: 'hand', jointPivotM: [0.264, 0.858, 0.0135], bandM: 0.022 }
        ],
        bellyScale: 0.24
    },
    {
        key: 'extensor_digitorum',
        name: 'Extensor digitorum',
        idLeft: 'STR-MUS-0076',
        idRight: 'STR-MUS-0077',
        region: 'forearm',
        layer: 'superficial',
        boneClearance: 'forearm',
        originM: [0.235, 1.102, -0.038],
        insertM: [0.265, 0.820, 0.008],
        chain: [
            { role: 'humerus' },
            { role: 'ulna', jointPivotM: [0.214, 1.104, -0.038], bandM: 0.032 },
            { role: 'hand', jointPivotM: [0.264, 0.858, 0.0135], bandM: 0.024 }
        ],
        bellyScale: 0.26
    },
    {
        key: 'ecu_humeral',
        name: 'Humeral head of extensor carpi ulnaris',
        idLeft: 'STR-MUS-0136',
        idRight: 'STR-MUS-0137',
        region: 'forearm',
        layer: 'superficial',
        originM: [0.235, 1.102, -0.040],
        insertM: [0.246, 0.832, 0.008],
        chain: [
            { role: 'humerus' },
            { role: 'ulna', jointPivotM: [0.214, 1.104, -0.038], bandM: 0.030 },
            { role: 'hand', jointPivotM: [0.264, 0.858, 0.0135], bandM: 0.022 }
        ],
        bellyScale: 0.22
    },
    {
        key: 'ecu_ulnar',
        name: 'Ulnar head of extensor carpi ulnaris',
        idLeft: 'STR-MUS-0449',
        idRight: 'STR-MUS-0450',
        region: 'forearm',
        layer: 'deep',
        originM: [0.225, 1.020, -0.030],
        insertM: [0.246, 0.832, 0.008],
        chain: [
            { role: 'ulna' },
            { role: 'hand', jointPivotM: [0.264, 0.858, 0.0135], bandM: 0.022 }
        ],
        bellyScale: 0.18
    },
    {
        key: 'pronator_teres_superficial',
        name: 'Superficial head of pronator teres',
        idLeft: 'STR-MUS-0400',
        idRight: 'STR-MUS-0401',
        region: 'forearm',
        layer: 'superficial',
        originM: [0.188, 1.112, -0.032],
        insertM: [0.262, 0.975, -0.002],
        chain: [
            { role: 'humerus' },
            { role: 'radius', jointPivotM: [0.214, 1.104, -0.038], bandM: 0.032 }
        ],
        bellyScale: 0.25
    },
    {
        key: 'pronator_teres_deep',
        name: 'Deep head of pronator teres',
        idLeft: 'STR-MUS-0051',
        idRight: 'STR-MUS-0052',
        region: 'forearm',
        layer: 'deep',
        originM: [0.212, 1.072, -0.024],
        insertM: [0.258, 0.978, -0.004],
        chain: [
            { role: 'ulna' },
            { role: 'radius', jointPivotM: [0.235, 1.025, -0.015], bandM: 0.028 }
        ],
        bellyScale: 0.18
    },
    {
        key: 'flexor_carpi_radialis',
        name: 'Flexor carpi radialis',
        idLeft: 'STR-MUS-0106',
        idRight: 'STR-MUS-0107',
        region: 'forearm',
        layer: 'superficial',
        boneClearance: 'forearm',
        originM: [0.188, 1.104, -0.032],
        insertM: [0.272, 0.835, 0.024],
        chain: [
            { role: 'humerus' },
            { role: 'radius', jointPivotM: [0.214, 1.104, -0.038], bandM: 0.032 },
            { role: 'hand', jointPivotM: [0.264, 0.858, 0.0135], bandM: 0.022 }
        ],
        bellyScale: 0.24
    },
    {
        key: 'palmaris_longus',
        name: 'Palmaris longus muscle',
        idLeft: 'STR-MUS-0278',
        idRight: 'STR-MUS-0279',
        region: 'forearm',
        layer: 'superficial',
        originM: [0.188, 1.104, -0.032],
        insertM: [0.262, 0.840, 0.025],
        chain: [
            { role: 'humerus' },
            { role: 'ulna', jointPivotM: [0.214, 1.104, -0.038], bandM: 0.032 },
            { role: 'hand', jointPivotM: [0.264, 0.858, 0.0135], bandM: 0.022 }
        ],
        bellyScale: 0.18
    },
    {
        key: 'fcu_humeral',
        name: 'Humeral head of flexor carpi ulnaris',
        idLeft: 'STR-MUS-0138',
        idRight: 'STR-MUS-0139',
        region: 'forearm',
        layer: 'superficial',
        originM: [0.188, 1.104, -0.036],
        insertM: [0.244, 0.844, 0.020],
        chain: [
            { role: 'humerus' },
            { role: 'ulna', jointPivotM: [0.214, 1.104, -0.038], bandM: 0.032 },
            { role: 'hand', jointPivotM: [0.264, 0.858, 0.0135], bandM: 0.022 }
        ],
        bellyScale: 0.24
    },
    {
        key: 'fcu_ulnar',
        name: 'Ulnar head of flexor carpi ulnaris',
        idLeft: 'STR-MUS-0451',
        idRight: 'STR-MUS-0452',
        region: 'forearm',
        layer: 'deep',
        originM: [0.214, 1.070, -0.042],
        insertM: [0.244, 0.844, 0.020],
        chain: [
            { role: 'ulna' },
            { role: 'hand', jointPivotM: [0.264, 0.858, 0.0135], bandM: 0.022 }
        ],
        bellyScale: 0.20
    },
    {
        key: 'fds_humero_ulnar',
        name: 'Humero-ulnar head of flexor digitorum superficialis',
        idLeft: 'STR-MUS-0140',
        idRight: 'STR-MUS-0141',
        region: 'forearm',
        layer: 'deep',
        originM: [0.195, 1.095, -0.030],
        insertM: [0.260, 0.840, 0.022],
        chain: [
            { role: 'humerus' },
            { role: 'ulna', jointPivotM: [0.214, 1.104, -0.038], bandM: 0.034 },
            { role: 'hand', jointPivotM: [0.264, 0.858, 0.0135], bandM: 0.024 }
        ],
        bellyScale: 0.26
    },
    {
        key: 'fds_radial',
        name: 'Radial head of flexor digitorum superficialis',
        idLeft: 'STR-MUS-0318',
        idRight: 'STR-MUS-0319',
        region: 'forearm',
        layer: 'deep',
        originM: [0.248, 1.015, 0.002],
        insertM: [0.265, 0.842, 0.022],
        chain: [
            { role: 'radius' },
            { role: 'hand', jointPivotM: [0.264, 0.858, 0.0135], bandM: 0.024 }
        ],
        bellyScale: 0.20
    },
    {
        key: 'supinator',
        name: 'Supinator',
        idLeft: 'STR-MUS-0414',
        idRight: 'STR-MUS-0415',
        region: 'forearm',
        layer: 'deep',
        originM: [0.228, 1.092, -0.042],
        insertM: [0.252, 1.020, -0.012],
        chain: [
            { role: 'ulna' },
            { role: 'radius', jointPivotM: [0.238, 1.055, -0.025], bandM: 0.030 }
        ],
        bellyScale: 0.20
    },
    {
        key: 'pronator_quadratus',
        name: 'Pronator quadratus',
        idLeft: 'STR-MUS-0302',
        idRight: 'STR-MUS-0303',
        region: 'forearm',
        layer: 'deep',
        originM: [0.244, 0.885, 0.010],
        insertM: [0.278, 0.885, 0.014],
        chain: [
            { role: 'ulna' },
            { role: 'radius', jointPivotM: [0.262, 0.885, 0.012], bandM: 0.024 }
        ],
        bellyScale: 0.14
    }
];
