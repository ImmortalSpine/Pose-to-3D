/**
 * AnatoPose 3D - Main Application Controller (Upper Limb & Shoulder Girdle Edition)
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { AnatomicalTorso } from './anatomy.js?v=11.2';
import { TorsoPoseEstimator } from './poseDetector.js?v=9.2';

class App {
    constructor() {
        this.canvas = document.getElementById('canvas3d');
        this.viewportArea = document.getElementById('viewportArea');
        this.referenceImage = document.getElementById('referenceImage');
        this.emptyPlaceholder = document.getElementById('emptyPlaceholder');
        this.landmarkCanvas = document.getElementById('landmarkOverlayCanvas');
        this.btnToggle2D = document.getElementById('btnToggle2DLandmarks');
        this.statusText = document.getElementById('statusText');
        this.statusPill = document.getElementById('statusPill');

        this.show2DLandmarks = true;
        this.lastLandmarks2D = null;
        this.originalImageElement = null;

        // 性別形態控制 ('auto' | 'female' | 'male')
        this.genderMode = 'auto';
        this.currentGender = 'female';

        // 肌肉點擊模式 (true: 點擊直接剝除露出底下結構 | false: 點擊高光顯示英文名稱)
        this.musclePeelMode = true;
        this._peelToastTimer = null;

        // 人體面向狀態 ('front' | 'back' | 'over_shoulder')
        this.currentStance = 'front';

        // 當前姿態狀態 (含骨盆、脊椎、胸廓、左右肱骨、前臂雙骨與下肢骨骼)
        this.currentPose = {
            pelvisRoll: 0,
            pelvisPitch: 0,
            pelvisYaw: 0,
            thoracicPitch: 0,
            thoracicYaw: 0,
            thoracicRoll: 0,
            lumbarPitch: 0,
            lumbarRoll: 0,
            lumbarYaw: 0,
            cervicalPitch: 0,
            cervicalYaw: 0,
            // 藝用解剖頭部姿態與頭身比例 (Head Pose & Proportions)
            headPitch: 0,
            headYaw: 0,
            headRoll: 0,
            headToBodyRatio: 7.1,
            skullScale: 1.15,
            leftArmPitch: 0,
            leftArmRoll: 0.12,
            leftArmYaw: 0,
            leftElbowFlex: 0.15,
            leftForearmTwist: 1.48, // 生理休息位半旋前 (85°)，掌心對準大腿
            leftHandGesture: 'auto',
            leftHandAngles: null,
            rightArmPitch: 0,
            rightArmRoll: -0.12,
            rightArmYaw: 0,
            rightElbowFlex: 0.15,
            rightForearmTwist: 1.48, // 生理休息位半旋前 (85°)，掌心對準大腿
            rightHandGesture: 'auto',
            rightHandAngles: null,
            // 下肢骨骼系統姿態
            leftHipPitch: 0,
            leftHipRoll: 0.08,
            leftHipYaw: 0,
            leftKneeFlex: 0.08,
            leftAnklePitch: -0.04,
            leftAnkleYaw: 0.12,
            leftAnkleRoll: 0,
            rightHipPitch: 0,
            rightHipRoll: -0.08,
            rightHipYaw: 0,
            rightKneeFlex: 0.08,
            rightAnklePitch: -0.04,
            rightAnkleYaw: -0.12,
            rightAnkleRoll: 0
        };
        this.aiPoseBackup = { ...this.currentPose };

        this._initThree();
        this._initAnatomy();
        this._initPoseEstimator();
        this._initUI();

        window.addEventListener('resize', () => this._onResize());
        
        const resizeObserver = new ResizeObserver(() => this._onResize());
        resizeObserver.observe(this.viewportArea);

        this._animate();
    }

    _initThree() {
        this.scene = new THREE.Scene();

        const width = Math.max(this.viewportArea.clientWidth, 300);
        const height = Math.max(this.viewportArea.clientHeight, 300);
        const aspect = width / height;
        this.camera = new THREE.PerspectiveCamera(38, aspect, 0.1, 1000);

        const targetY = 2.0;
        const initialDist = this._calculateIdealCameraDistance();
        this.camera.position.set(0, targetY, initialDist);

        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            alpha: true
        });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.target.set(0, targetY, 0); // 居中聚焦在全人體骨骼中心 (腰椎與骨盆上方)
        this.controls.maxDistance = 350;         // 允許大幅度縮小以綜覽全景與地面
        this.controls.minDistance = 3;           // 允許大幅度放大以觀察手掌、頭骨與脊椎骨節特寫
        this.controls.enableZoom = true;
        this.controls.zoomSpeed = 1.0;

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
        this.scene.add(ambientLight);

        // 主光
        const keyLight = new THREE.DirectionalLight(0xfff5ea, 1.3);
        keyLight.position.set(16, 25, 22);
        keyLight.castShadow = true;
        keyLight.shadow.mapSize.width = 2048;
        keyLight.shadow.mapSize.height = 2048;
        this.scene.add(keyLight);

        // 輪廓光 (背光強調肩胛岡與棘突)
        const rimLight = new THREE.DirectionalLight(0x90b0e0, 0.85);
        rimLight.position.set(-16, 18, -16);
        this.scene.add(rimLight);

        // 輔光
        const fillLight = new THREE.DirectionalLight(0xffffff, 0.35);
        fillLight.position.set(0, -10, 15);
        this.scene.add(fillLight);

        // 1. 地面陰影接收面 (位置設定於腳掌接地基準面 Y = -25.5)
        const groundGeo = new THREE.PlaneGeometry(160, 160);
        const groundMat = new THREE.ShadowMaterial({ opacity: 0.30 });
        this.groundMesh = new THREE.Mesh(groundGeo, groundMat);
        this.groundMesh.rotation.x = -Math.PI / 2;
        this.groundMesh.position.y = -25.5;
        this.groundMesh.receiveShadow = true;
        this.scene.add(this.groundMesh);

        // 2. 藝用美學地面空間網格 (Floor Spatial Grid)
        this.floorGrid = new THREE.GridHelper(80, 40, 0x5a6880, 0x252a35);
        this.floorGrid.position.y = -25.5;
        this.floorGrid.material.opacity = 0.40;
        this.floorGrid.material.transparent = true;
        this.scene.add(this.floorGrid);
    }

    _initAnatomy() {
        if (this.statusText) {
            this.statusText.textContent = "載入開源醫學級 206 塊 3D 骨骼模型中...";
        }
        this.anatomicalTorso = new AnatomicalTorso(() => {
            if (this.statusText && this.statusText.textContent.includes("載入開源醫學")) {
                this.statusText.textContent = "✅ 醫學級 206 塊 3D 骨骼模型已就緒，請上傳人體模特兒圖片";
            }
            this._fitCameraToSkeleton('front');
        });
        this.anatomicalTorso.muscleSystem?.onLoaded(() => {
            this._updateMuscleCounterUI();
        });
        this.scene.add(this.anatomicalTorso.rootGroup);
        this._initBonePicker();
    }

    /**
     * 初始化 3D 骨骼滑鼠點擊射線檢測 (206 Bones Raycast Picker)
     * 點擊任一骨頭時高光該骨骼並顯示其英文解剖名稱 (English Bone Name)
     */
    _initBonePicker() {
        this.raycaster = new THREE.Raycaster();
        this.pointerNDC = new THREE.Vector2();
        this.boneTooltip = document.getElementById('boneNameTooltip');
        this.selectedBoneAnchorLocal = null;
        this.selectedBoneMesh = null;

        let downX = 0;
        let downY = 0;

        this.canvas.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            downX = e.clientX;
            downY = e.clientY;
        });

        this.canvas.addEventListener('pointerup', (e) => {
            if (e.button !== 0) return;
            // 區分單純點擊與拖曳旋轉視角 (移動小於 5px 視為點擊)
            const moveDist = Math.hypot(e.clientX - downX, e.clientY - downY);
            if (moveDist > 5) return;

            const rect = this.canvas.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;

            this.pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            this.pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

            this.raycaster.setFromCamera(this.pointerNDC, this.camera);
            const hits = this.raycaster.intersectObject(this.anatomicalTorso.rootGroup, true);

            let pickedHit = null;
            for (const hit of hits) {
                if (!hit.object || !hit.object.isMesh) continue;
                if (hit.object.userData.isCavityHole) continue;
                // 確保該網格及其所有父層級皆處於可見狀態
                let vis = true;
                let curr = hit.object;
                while (curr) {
                    if (curr.visible === false) {
                        vis = false;
                        break;
                    }
                    curr = curr.parent;
                }
                if (vis && (hit.object.userData.muscleId || hit.object.userData.boneName)) {
                    pickedHit = hit;
                    break;
                }
            }

            if (pickedHit && pickedHit.object.userData.muscleId) {
                const muscleId = pickedHit.object.userData.muscleId;
                const muscleName = pickedHit.object.userData.muscleName;
                const ms = this.anatomicalTorso.muscleSystem;

                this.anatomicalTorso.selectBoneByName(null);

                if (this.musclePeelMode && ms) {
                    ms.peelMuscle(muscleId);
                    this.selectedBoneMesh = null;
                    this.selectedBoneAnchorLocal = null;
                    this._updateMuscleCounterUI();

                    if (this.boneTooltip) {
                        clearTimeout(this._peelToastTimer);
                        const clickX = Math.max(70, Math.min(rect.width - 70, e.clientX - rect.left));
                        const clickY = Math.max(42, Math.min(rect.height - 20, e.clientY - rect.top));
                        this.boneTooltip.textContent = muscleName;
                        this.boneTooltip.style.left = `${clickX}px`;
                        this.boneTooltip.style.top = `${clickY}px`;
                        this.boneTooltip.style.display = 'block';
                        this._peelToastTimer = setTimeout(() => {
                            if (!this.selectedBoneMesh && this.boneTooltip) {
                                this.boneTooltip.style.display = 'none';
                            }
                        }, 1600);
                    }
                } else if (ms) {
                    clearTimeout(this._peelToastTimer);
                    ms.selectMuscleById(muscleId);
                    this.selectedBoneMesh = pickedHit.object;
                    this.selectedBoneAnchorLocal = pickedHit.object.worldToLocal(pickedHit.point.clone());

                    if (this.boneTooltip) {
                        this.boneTooltip.textContent = muscleName;
                        this.boneTooltip.style.display = 'block';
                        this._updateBoneTooltipPosition();
                    }
                }
            } else if (pickedHit) {
                clearTimeout(this._peelToastTimer);
                if (this.anatomicalTorso.muscleSystem) {
                    this.anatomicalTorso.muscleSystem.selectMuscleById(null);
                }
                const boneName = pickedHit.object.userData.boneName;
                this.anatomicalTorso.selectBoneByName(boneName);
                this.selectedBoneMesh = pickedHit.object;
                this.selectedBoneAnchorLocal = pickedHit.object.worldToLocal(pickedHit.point.clone());

                if (this.boneTooltip) {
                    this.boneTooltip.textContent = boneName;
                    this.boneTooltip.style.display = 'block';
                    this._updateBoneTooltipPosition();
                }
            } else {
                clearTimeout(this._peelToastTimer);
                this.anatomicalTorso.selectBoneByName(null);
                if (this.anatomicalTorso.muscleSystem) {
                    this.anatomicalTorso.muscleSystem.selectMuscleById(null);
                }
                this.selectedBoneMesh = null;
                this.selectedBoneAnchorLocal = null;
                if (this.boneTooltip) {
                    this.boneTooltip.style.display = 'none';
                }
            }
        });
    }

    _updateBoneTooltipPosition() {
        if (!this.boneTooltip || this.boneTooltip.style.display === 'none') return;
        if (!this.selectedBoneMesh || !this.selectedBoneAnchorLocal) return;

        // 若選中的是骨骼網格但節點已被重建，自動重新綁定最新網格節點
        if (!this.selectedBoneMesh.parent && this.anatomicalTorso.selectedBoneName) {
            this.anatomicalTorso.rootGroup.traverse(child => {
                if (child.isMesh && child.userData.boneName === this.anatomicalTorso.selectedBoneName) {
                    this.selectedBoneMesh = child;
                    this.selectedBoneAnchorLocal = new THREE.Vector3(0, 0, 0);
                }
            });
        }

        // 若該部位被右側開關隱藏，自動隱藏標籤
        let curr = this.selectedBoneMesh;
        while (curr) {
            if (curr.visible === false) {
                this.boneTooltip.style.display = 'none';
                return;
            }
            curr = curr.parent;
        }

        const worldPt = this.selectedBoneAnchorLocal.clone();
        this.selectedBoneMesh.localToWorld(worldPt);
        worldPt.project(this.camera);

        const width = this.viewportArea.clientWidth;
        const height = this.viewportArea.clientHeight;
        const screenX = (worldPt.x * 0.5 + 0.5) * width;
        const screenY = (-worldPt.y * 0.5 + 0.5) * height;

        const clampedX = Math.max(70, Math.min(width - 70, screenX));
        const clampedY = Math.max(42, Math.min(height - 20, screenY));

        this.boneTooltip.style.left = `${clampedX}px`;
        this.boneTooltip.style.top = `${clampedY}px`;
    }

    _initPoseEstimator() {
        this.poseEstimator = new TorsoPoseEstimator();
    }

    _initUI() {
        const fileInput = document.getElementById('fileInput');
        fileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                this._handleImageFile(e.target.files[0]);
                e.target.value = '';
            }
        });

        const dropZone = document.getElementById('dropZone');
        dropZone.addEventListener('click', () => fileInput.click());
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.style.borderColor = 'var(--accent)';
        });
        dropZone.addEventListener('dragleave', () => {
            dropZone.style.borderColor = '#3a3c48';
        });
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.style.borderColor = '#3a3c48';
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                this._handleImageFile(e.dataTransfer.files[0]);
            }
        });

        // 骨骼部位顯示開關
        document.getElementById('toggleSkull').addEventListener('change', (e) => {
            this.anatomicalTorso.toggleSkull(e.target.checked);
        });
        document.getElementById('toggleRibs').addEventListener('change', (e) => {
            this.anatomicalTorso.toggleRibcage(e.target.checked);
        });
        document.getElementById('toggleShoulderGirdle').addEventListener('change', (e) => {
            this.anatomicalTorso.toggleShoulderGirdle(e.target.checked);
        });
        document.getElementById('toggleArms').addEventListener('change', (e) => {
            this.anatomicalTorso.toggleArms(e.target.checked);
        });
        document.getElementById('toggleForearms').addEventListener('change', (e) => {
            this.anatomicalTorso.toggleForearms(e.target.checked);
        });
        document.getElementById('toggleHands').addEventListener('change', (e) => {
            this.anatomicalTorso.toggleHands(e.target.checked);
        });
        document.getElementById('togglePelvis').addEventListener('change', (e) => {
            this.anatomicalTorso.togglePelvis(e.target.checked);
        });
        document.getElementById('toggleFemurs').addEventListener('change', (e) => {
            this.anatomicalTorso.toggleFemurs(e.target.checked);
        });
        document.getElementById('toggleLowerLegs').addEventListener('change', (e) => {
            this.anatomicalTorso.toggleLowerLegs(e.target.checked);
        });
        document.getElementById('toggleFeet').addEventListener('change', (e) => {
            this.anatomicalTorso.toggleFeet(e.target.checked);
        });

        // 程式化肌肉層與單塊剝除互動控制
        const ms = this.anatomicalTorso.muscleSystem;
        document.getElementById('toggleMuscles')?.addEventListener('change', (e) => {
            this.anatomicalTorso.toggleMuscles(e.target.checked);
        });
        const btnPeelMode = document.getElementById('btnMuscleModePeel');
        const btnInspectMode = document.getElementById('btnMuscleModeInspect');
        const syncMuscleModeUI = () => {
            btnPeelMode?.classList.toggle('active', this.musclePeelMode);
            btnInspectMode?.classList.toggle('active', !this.musclePeelMode);
        };
        btnPeelMode?.addEventListener('click', () => {
            this.musclePeelMode = true;
            ms?.selectMuscleById(null);
            syncMuscleModeUI();
        });
        btnInspectMode?.addEventListener('click', () => {
            this.musclePeelMode = false;
            syncMuscleModeUI();
        });
        document.getElementById('btnMuscleUndo')?.addEventListener('click', () => {
            const restoredName = ms?.undoPeel();
            this._updateMuscleCounterUI();
            if (restoredName && this.boneTooltip) {
                this.boneTooltip.textContent = restoredName;
            }
        });
        document.getElementById('btnMusclePeelSuperficial')?.addEventListener('click', () => {
            ms?.peelSuperficial();
            this._updateMuscleCounterUI();
        });
        document.getElementById('btnMuscleRestoreAll')?.addEventListener('click', () => {
            ms?.restoreAll();
            this._updateMuscleCounterUI();
        });
        const sliderMuscleOpacity = document.getElementById('sliderMuscleOpacity');
        const valMuscleOpacity = document.getElementById('valMuscleOpacity');
        sliderMuscleOpacity?.addEventListener('input', (e) => {
            const pct = parseInt(e.target.value, 10);
            if (valMuscleOpacity) valMuscleOpacity.textContent = `${pct}%`;
            ms?.setOpacity(pct / 100);
        });
        this._updateMuscleCounterUI();

        // 地面自動吸附開關
        document.getElementById('toggleGroundSnap')?.addEventListener('change', (e) => {
            const enabled = e.target.checked;
            this.anatomicalTorso.autoGroundSnap = enabled;
            if (enabled) {
                this.anatomicalTorso.snapToGround(-25.5);
            } else {
                this.anatomicalTorso.rootGroup.position.y = 0;
                this.anatomicalTorso.rootGroup.updateMatrixWorld(true);
            }
            this._fitCameraToSkeleton();
        });

        // 地面空間參考網格開關
        document.getElementById('toggleFloorGrid')?.addEventListener('change', (e) => {
            const enabled = e.target.checked;
            if (this.floorGrid) this.floorGrid.visible = enabled;
            if (this.groundMesh) this.groundMesh.visible = enabled;
        });

        // 2D 骨架特徵線開關
        this.btnToggle2D.addEventListener('click', () => {
            this.show2DLandmarks = !this.show2DLandmarks;
            this.landmarkCanvas.style.display = this.show2DLandmarks ? 'block' : 'none';
            this.btnToggle2D.textContent = this.show2DLandmarks ? '隱藏特徵線' : '顯示特徵線';
            if (this.show2DLandmarks) this._draw2DLandmarks();
        });

        // 左右鏡像翻轉開關
        const btnMirror = document.getElementById('btnToggleMirror');
        btnMirror.addEventListener('click', () => {
            this.poseEstimator.isMirrored = !this.poseEstimator.isMirrored;
            btnMirror.classList.toggle('active', this.poseEstimator.isMirrored);
            this.currentPose.thoracicRoll = -this.currentPose.thoracicRoll;
            this.currentPose.lumbarRoll = -this.currentPose.lumbarRoll;
            this.currentPose.thoracicYaw = -this.currentPose.thoracicYaw;
            this.currentPose.cervicalYaw = -this.currentPose.cervicalYaw;
            this.currentPose.headYaw = -this.currentPose.headYaw;
            this.currentPose.headRoll = -this.currentPose.headRoll;

            const tempArm = this.currentPose.leftArmRoll;
            this.currentPose.leftArmRoll = -this.currentPose.rightArmRoll;
            this.currentPose.rightArmRoll = -tempArm;

            const tempHip = this.currentPose.leftHipRoll;
            this.currentPose.leftHipRoll = -this.currentPose.rightHipRoll;
            this.currentPose.rightHipRoll = -tempHip;

            const tempHipP = this.currentPose.leftHipPitch;
            this.currentPose.leftHipPitch = this.currentPose.rightHipPitch;
            this.currentPose.rightHipPitch = tempHipP;

            const tempKnee = this.currentPose.leftKneeFlex;
            this.currentPose.leftKneeFlex = this.currentPose.rightKneeFlex;
            this.currentPose.rightKneeFlex = tempKnee;

            const tempAnk = this.currentPose.leftAnklePitch;
            this.currentPose.leftAnklePitch = this.currentPose.rightAnklePitch;
            this.currentPose.rightAnklePitch = tempAnk;

            this.anatomicalTorso.setTorsoPose(this.currentPose);
            this._updateSlidersUI();
        });

        // 正/背身翻轉切換開關 (快捷翻轉)
        const btnToggleBack = document.getElementById('btnToggleBackStance');
        btnToggleBack?.addEventListener('click', () => {
            const nextMode = (this.currentStance === 'front') ? 'over_shoulder' : 'front';
            this.setStanceMode(nextMode);
        });

        // 人體面向模式按鈕群 (正面 / 純背身 / 背身回眸)
        document.getElementById('btnStanceFront')?.addEventListener('click', () => this.setStanceMode('front'));
        document.getElementById('btnStanceBack')?.addEventListener('click', () => this.setStanceMode('back'));
        document.getElementById('btnStanceOverShoulder')?.addEventListener('click', () => this.setStanceMode('over_shoulder'));

        // 姿態微調滑桿
        this._bindSlider('sliderHeadYaw', 'valHeadYaw', 'headYaw');
        this._bindSlider('sliderHeadPitch', 'valHeadPitch', 'headPitch');
        this._bindSlider('sliderHeadRoll', 'valHeadRoll', 'headRoll');
        this._bindSlider('sliderPelvisRoll', 'valPelvisRoll', 'pelvisRoll');
        this._bindSlider('sliderThoracicYaw', 'valThoracicYaw', 'thoracicYaw');
        this._bindSlider('sliderThoracicPitch', 'valThoracicPitch', 'thoracicPitch');
        this._bindSlider('sliderThoracicRoll', 'valThoracicRoll', 'thoracicRoll');
        this._bindSlider('sliderLumbarRoll', 'valLumbarRoll', 'lumbarRoll');
        this._bindSlider('sliderLumbarPitch', 'valLumbarPitch', 'lumbarPitch');
        this._bindSlider('sliderNeckPitch', 'valNeckPitch', 'cervicalPitch');
        this._bindSlider('sliderRightArmRoll', 'valRightArmRoll', 'rightArmRoll');
        this._bindSlider('sliderRightArmPitch', 'valRightArmPitch', 'rightArmPitch');
        this._bindSlider('sliderRightArmYaw', 'valRightArmYaw', 'rightArmYaw');
        this._bindSlider('sliderRightElbowFlex', 'valRightElbowFlex', 'rightElbowFlex');
        this._bindSlider('sliderRightForearmTwist', 'valRightForearmTwist', 'rightForearmTwist');
        this._bindSlider('sliderLeftArmRoll', 'valLeftArmRoll', 'leftArmRoll');
        this._bindSlider('sliderLeftArmPitch', 'valLeftArmPitch', 'leftArmPitch');
        this._bindSlider('sliderLeftArmYaw', 'valLeftArmYaw', 'leftArmYaw');
        this._bindSlider('sliderLeftElbowFlex', 'valLeftElbowFlex', 'leftElbowFlex');
        this._bindSlider('sliderLeftForearmTwist', 'valLeftForearmTwist', 'leftForearmTwist');

        // 下肢骨骼滑桿
        this._bindSlider('sliderRightHipPitch', 'valRightHipPitch', 'rightHipPitch');
        this._bindSlider('sliderRightHipRoll', 'valRightHipRoll', 'rightHipRoll');
        this._bindSlider('sliderRightKneeFlex', 'valRightKneeFlex', 'rightKneeFlex');
        this._bindSlider('sliderRightAnklePitch', 'valRightAnklePitch', 'rightAnklePitch');
        this._bindSlider('sliderRightAnkleYaw', 'valRightAnkleYaw', 'rightAnkleYaw');
        this._bindSlider('sliderRightAnkleRoll', 'valRightAnkleRoll', 'rightAnkleRoll');

        this._bindSlider('sliderLeftHipPitch', 'valLeftHipPitch', 'leftHipPitch');
        this._bindSlider('sliderLeftHipRoll', 'valLeftHipRoll', 'leftHipRoll');
        this._bindSlider('sliderLeftKneeFlex', 'valLeftKneeFlex', 'leftKneeFlex');
        this._bindSlider('sliderLeftAnklePitch', 'valLeftAnklePitch', 'leftAnklePitch');
        this._bindSlider('sliderLeftAnkleYaw', 'valLeftAnkleYaw', 'leftAnkleYaw');
        this._bindSlider('sliderLeftAnkleRoll', 'valLeftAnkleRoll', 'leftAnkleRoll');

        // 手部手勢選擇器
        const selRightGest = document.getElementById('selectRightHandGesture');
        if (selRightGest) {
            selRightGest.addEventListener('change', (e) => {
                const val = e.target.value;
                this.currentPose.rightHandGesture = val;
                if (val === 'auto') {
                    if (this.currentPose.rightHandAngles) {
                        this.anatomicalTorso.setFingerAngles('right', this.currentPose.rightHandAngles);
                    } else {
                        this.anatomicalTorso.setHandGesture('right', 'relaxed');
                    }
                } else {
                    this.anatomicalTorso.setHandGesture('right', val);
                }
            });
        }

        const selLeftGest = document.getElementById('selectLeftHandGesture');
        if (selLeftGest) {
            selLeftGest.addEventListener('change', (e) => {
                const val = e.target.value;
                this.currentPose.leftHandGesture = val;
                if (val === 'auto') {
                    if (this.currentPose.leftHandAngles) {
                        this.anatomicalTorso.setFingerAngles('left', this.currentPose.leftHandAngles);
                    } else {
                        this.anatomicalTorso.setHandGesture('left', 'relaxed');
                    }
                } else {
                    this.anatomicalTorso.setHandGesture('left', val);
                }
            });
        }

        // 重置為 AI 姿態
        document.getElementById('btnResetPose').addEventListener('click', () => {
            this._applyPose(this.aiPoseBackup);
            this._updateSlidersUI();
        });

        // 性別骨骼形態切換
        document.getElementById('btnGenderAuto')?.addEventListener('click', () => {
            this.genderMode = 'auto';
            if (this.currentPose && this.currentPose.suggestedGender) {
                this._setGender(this.currentPose.suggestedGender, false);
            } else {
                this._updateGenderUI();
            }
        });
        document.getElementById('btnGenderFemale')?.addEventListener('click', () => {
            this.genderMode = 'female';
            this._setGender('female', true);
        });
        document.getElementById('btnGenderMale')?.addEventListener('click', () => {
            this.genderMode = 'male';
            this._setGender('male', true);
        });

        // 人體體型與頭身比控制 (支援亞洲寫實 7.0、模特 7.5、古典 8.0)
        const sliderRatio = document.getElementById('sliderHeadRatio');
        if (sliderRatio) {
            sliderRatio.addEventListener('input', (e) => {
                const ratio = parseFloat(e.target.value);
                this._setHeadRatio(ratio);
            });
        }

        document.getElementById('btnRatioAsian')?.addEventListener('click', () => this._setHeadRatio(7.0));
        document.getElementById('btnRatioModel')?.addEventListener('click', () => this._setHeadRatio(7.5));
        document.getElementById('btnRatioClassic')?.addEventListener('click', () => this._setHeadRatio(8.0));

        // 快速視角切換
        document.getElementById('btnFrontView')?.addEventListener('click', () => this._setCameraView('front'));
        document.getElementById('btnSideView')?.addEventListener('click', () => this._setCameraView('side'));
        document.getElementById('btnBackView')?.addEventListener('click', () => this._setCameraView('back'));
        document.getElementById('btnTopView')?.addEventListener('click', () => this._setCameraView('top'));
        document.getElementById('btnResetCamera')?.addEventListener('click', () => this._fitCameraToSkeleton('front'));

        // 放大與縮小控制 (頂部工具列按鈕 & 畫布懸浮按鈕)
        document.getElementById('btnZoomIn')?.addEventListener('click', () => this._zoomCamera(0.80));
        document.getElementById('btnZoomOut')?.addEventListener('click', () => this._zoomCamera(1.25));
        document.getElementById('btnFloatZoomIn')?.addEventListener('click', () => this._zoomCamera(0.80));
        document.getElementById('btnFloatZoomOut')?.addEventListener('click', () => this._zoomCamera(1.25));
        document.getElementById('btnFloatFit')?.addEventListener('click', () => this._fitCameraToSkeleton('front'));

        // 浮動性別一鍵循環切換按鈕 (自適應 -> 強制女性 -> 強制男性 -> 自適應)
        document.getElementById('btnFloatGender')?.addEventListener('click', () => {
            if (this.genderMode === 'auto') {
                this.genderMode = 'female';
                this._setGender('female', true);
            } else if (this.genderMode === 'female') {
                this.genderMode = 'male';
                this._setGender('male', true);
            } else {
                this.genderMode = 'auto';
                if (this.currentPose && this.currentPose.suggestedGender) {
                    this._setGender(this.currentPose.suggestedGender, false);
                } else {
                    this._setGender('female', false);
                }
            }
            this._updateGenderUI();
        });

        this._updateStanceUI();

        // 鍵盤快速鍵支援 (+/- 放大縮小，F/0 全身置中)
        window.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
            if (e.key === '+' || e.key === '=') {
                this._zoomCamera(0.82);
            } else if (e.key === '-' || e.key === '_') {
                this._zoomCamera(1.22);
            } else if (e.key === 'f' || e.key === 'F' || e.key === '0') {
                this._fitCameraToSkeleton('front');
            }
        });
    }

    _bindSlider(sliderId, labelId, propName) {
        const slider = document.getElementById(sliderId);
        const label = document.getElementById(labelId);
        if (!slider || !label) return;
        slider.addEventListener('input', (e) => {
            const deg = parseFloat(e.target.value);
            label.textContent = `${deg}°`;
            this.currentPose[propName] = deg * (Math.PI / 180);
            this.anatomicalTorso.setTorsoPose(this.currentPose);
        });
    }

    _updateSlidersUI() {
        const radToDeg = (rad) => Math.round((rad || 0) * (180 / Math.PI));
        
        const setSlider = (id, valId, val) => {
            const el = document.getElementById(id);
            const valEl = document.getElementById(valId);
            if (el && valEl) {
                const deg = radToDeg(val);
                el.value = deg;
                valEl.textContent = `${deg}°`;
            }
        };

        setSlider('sliderHeadYaw', 'valHeadYaw', this.currentPose.headYaw);
        setSlider('sliderHeadPitch', 'valHeadPitch', this.currentPose.headPitch);
        setSlider('sliderHeadRoll', 'valHeadRoll', this.currentPose.headRoll);
        setSlider('sliderPelvisRoll', 'valPelvisRoll', this.currentPose.pelvisRoll);
        setSlider('sliderThoracicYaw', 'valThoracicYaw', this.currentPose.thoracicYaw);
        setSlider('sliderThoracicPitch', 'valThoracicPitch', this.currentPose.thoracicPitch);
        setSlider('sliderThoracicRoll', 'valThoracicRoll', this.currentPose.thoracicRoll);
        setSlider('sliderLumbarRoll', 'valLumbarRoll', this.currentPose.lumbarRoll);
        setSlider('sliderLumbarPitch', 'valLumbarPitch', this.currentPose.lumbarPitch);
        setSlider('sliderNeckPitch', 'valNeckPitch', this.currentPose.cervicalPitch);
        setSlider('sliderRightArmRoll', 'valRightArmRoll', this.currentPose.rightArmRoll);
        setSlider('sliderRightArmPitch', 'valRightArmPitch', this.currentPose.rightArmPitch);
        setSlider('sliderRightArmYaw', 'valRightArmYaw', this.currentPose.rightArmYaw);
        setSlider('sliderRightElbowFlex', 'valRightElbowFlex', this.currentPose.rightElbowFlex);
        setSlider('sliderRightForearmTwist', 'valRightForearmTwist', this.currentPose.rightForearmTwist);
        setSlider('sliderLeftArmRoll', 'valLeftArmRoll', this.currentPose.leftArmRoll);
        setSlider('sliderLeftArmPitch', 'valLeftArmPitch', this.currentPose.leftArmPitch);
        setSlider('sliderLeftArmYaw', 'valLeftArmYaw', this.currentPose.leftArmYaw);
        setSlider('sliderLeftElbowFlex', 'valLeftElbowFlex', this.currentPose.leftElbowFlex);
        setSlider('sliderLeftForearmTwist', 'valLeftForearmTwist', this.currentPose.leftForearmTwist);

        setSlider('sliderRightHipPitch', 'valRightHipPitch', this.currentPose.rightHipPitch);
        setSlider('sliderRightHipRoll', 'valRightHipRoll', this.currentPose.rightHipRoll);
        setSlider('sliderRightKneeFlex', 'valRightKneeFlex', this.currentPose.rightKneeFlex);
        setSlider('sliderRightAnklePitch', 'valRightAnklePitch', this.currentPose.rightAnklePitch);
        setSlider('sliderRightAnkleYaw', 'valRightAnkleYaw', this.currentPose.rightAnkleYaw);
        setSlider('sliderRightAnkleRoll', 'valRightAnkleRoll', this.currentPose.rightAnkleRoll);

        setSlider('sliderLeftHipPitch', 'valLeftHipPitch', this.currentPose.leftHipPitch);
        setSlider('sliderLeftHipRoll', 'valLeftHipRoll', this.currentPose.leftHipRoll);
        setSlider('sliderLeftKneeFlex', 'valLeftKneeFlex', this.currentPose.leftKneeFlex);
        setSlider('sliderLeftAnklePitch', 'valLeftAnklePitch', this.currentPose.leftAnklePitch);
        setSlider('sliderLeftAnkleYaw', 'valLeftAnkleYaw', this.currentPose.leftAnkleYaw);
        setSlider('sliderLeftAnkleRoll', 'valLeftAnkleRoll', this.currentPose.leftAnkleRoll);

        const selRG = document.getElementById('selectRightHandGesture');
        if (selRG) {
            if (this.currentPose.rightHandGesture) {
                selRG.value = this.currentPose.rightHandGesture;
            } else if (this.currentPose.rightHandAngles) {
                selRG.value = 'auto';
            }
        }

        const selLG = document.getElementById('selectLeftHandGesture');
        if (selLG) {
            if (this.currentPose.leftHandGesture) {
                selLG.value = this.currentPose.leftHandGesture;
            } else if (this.currentPose.leftHandAngles) {
                selLG.value = 'auto';
            }
        }

        const sliderRatio = document.getElementById('sliderHeadRatio');
        const valRatio = document.getElementById('valHeadRatio');
        if (sliderRatio && valRatio && this.currentPose.headToBodyRatio) {
            sliderRatio.value = this.currentPose.headToBodyRatio;
            valRatio.textContent = this._getRatioDesc(this.currentPose.headToBodyRatio);
        }
    }

    _updateMuscleCounterUI() {
        const badge = document.getElementById('valMuscleCounter');
        const ms = this.anatomicalTorso?.muscleSystem;
        if (!badge || !ms) return;
        const stats = ms.getStats();
        badge.textContent = stats.total > 0 ? `${stats.remaining} / ${stats.total}` : 'Loading...';
    }

    _getRatioDesc(ratio) {
        let desc = '亞洲大眾寫實';
        if (ratio < 6.9) desc = '厚實/亞洲日常';
        else if (ratio <= 7.2) desc = '亞洲大眾寫實';
        else if (ratio <= 7.7) desc = '修長/時尚模特';
        else desc = '古典藝術雕塑';
        return `${ratio.toFixed(1)} 頭身 (${desc})`;
    }

    _setGender(gender, isManual = false) {
        this.currentGender = gender;
        this.anatomicalTorso.setGender(gender);
        if (this.currentPose) {
            this.anatomicalTorso.setTorsoPose(this.currentPose);
        }
        this._updateGenderUI();
    }

    _updateGenderUI() {
        const btnAuto = document.getElementById('btnGenderAuto');
        const btnFemale = document.getElementById('btnGenderFemale');
        const btnMale = document.getElementById('btnGenderMale');
        const badge = document.getElementById('valGenderBadge');

        btnAuto?.classList.toggle('active', this.genderMode === 'auto');
        btnFemale?.classList.toggle('active', this.genderMode === 'female');
        btnMale?.classList.toggle('active', this.genderMode === 'male');

        if (this.statusText && this.statusText.textContent) {
            const gLabel = this.currentGender === 'male' ? '♂ 男性骨架' : '♀ 女性骨架';
            this.statusText.textContent = this.statusText.textContent.replace(/性別 \([♀♂] [男女]性骨架\)/, `性別 (${gLabel})`);
        }

        const btnFloatG = document.getElementById('btnFloatGender');
        if (btnFloatG) {
            if (this.genderMode === 'auto') {
                btnFloatG.textContent = '⚖️';
                btnFloatG.title = `骨骼性別：AI 自適應 (${this.currentGender === 'female' ? '♀ 女' : '♂ 男'}，點擊強制女性)`;
            } else if (this.genderMode === 'female') {
                btnFloatG.textContent = '♀';
                btnFloatG.title = '骨骼性別：強制女性 (點擊切換為男性)';
            } else {
                btnFloatG.textContent = '♂';
                btnFloatG.title = '骨骼性別：強制男性 (點擊切換為自適應)';
            }
        }

        if (badge) {
            const ratioDesc = (this.currentPose && this.currentPose.shoulderToHipRatio)
                ? ` (肩臀比 ${this.currentPose.shoulderToHipRatio})`
                : '';
            if (this.genderMode === 'auto') {
                badge.style.color = '#6ee7b7';
                badge.textContent = (this.currentGender === 'female' ? '♀ 女性 (自適應)' : '♂ 男性 (自適應)') + ratioDesc;
            } else if (this.genderMode === 'female') {
                badge.style.color = '#f472b6';
                badge.textContent = '♀ 女性形態 (纖細柔美、寬圓骨盆)';
            } else {
                badge.style.color = '#60a5fa';
                badge.textContent = '♂ 男性形態 (寬肩倒三角、剛挺粗壯)';
            }
        }
    }

    setStanceMode(mode) {
        this.currentStance = mode;
        this._updateStanceUI();

        // 1. 若有原圖 MediaPipe 特徵點，透過 poseEstimator.reprocessWithStance 重新解算完整逆運動學
        try {
            const newPose = this.poseEstimator.reprocessWithStance(mode);
            if (newPose) {
                this._applyPose(newPose);
                this.aiPoseBackup = { ...newPose };
                this.currentPose = { ...newPose };
                this._updateSlidersUI();

                const ratioStr = newPose.headToBodyRatio ? `${newPose.headToBodyRatio} 頭身` : '7.1 頭身';
                const genderStr = this.currentGender === 'female' ? '♀ 女性骨架' : '♂ 男性骨架';
                const backStr = newPose.isBackStance ? (newPose.isOverShoulderLook ? '、背身回眸模式' : '、純背身模式 (180° 後背視角)') : '、正面模式';
                const profileStr = newPose.isProfileStance ? `、側身模式 (${newPose.profileSign < 0 ? '面向左' : '面向右'} 90°)` : '';
                const handTrackStr = (newPose.rightHandAngles || newPose.leftHandAngles) ? '與 21 節點逐指動態追蹤' : '';
                this.statusText.textContent = `✅ 姿態已切換！已適應人物頭身比 (${ratioStr})、性別 (${genderStr})${backStr}${profileStr}${handTrackStr}`;
                return;
            }
        } catch (err) {
            console.error("[AnatoPose] reprocessWithStance error:", err);
        }

        // 2. 備援手動翻轉 (無影像特徵時直接翻轉當前 3D 骨架模型)
        if (mode === 'back' || mode === 'over_shoulder') {
            this.currentPose.isBackStance = true;
            this.currentPose.isOverShoulderLook = (mode === 'over_shoulder');
            this.currentPose.pelvisYaw = Math.PI;
            this.currentPose.thoracicYaw = Math.PI;
            if (mode === 'over_shoulder') {
                const faceX = this.lastLandmarks2D?.nose?.x ?? 0.6;
                const midSX = this.lastLandmarks2D?.midShoulder?.x ?? 0.5;
                const turnSign = (faceX > midSX) ? -1.0 : 1.0;
                this.currentPose.headYaw = Math.PI + turnSign * 1.25;
                this.currentPose.cervicalYaw = turnSign * 0.81;
                this.currentPose.cervicalPitch = 0.02;
                this.currentPose.headPitch = 0.01;
                this.currentPose.headRoll = 0.0;
            } else {
                this.currentPose.headYaw = Math.PI;
                this.currentPose.cervicalYaw = 0.0;
                this.currentPose.cervicalPitch = 0.0;
                this.currentPose.headPitch = 0.0;
                this.currentPose.headRoll = 0.0;
            }
        } else {
            this.currentPose.isBackStance = false;
            this.currentPose.isOverShoulderLook = false;
            this.currentPose.pelvisYaw = 0;
            this.currentPose.thoracicYaw = 0;
            this.currentPose.headYaw = 0;
        }
        this._applyPose(this.currentPose);
        this._updateSlidersUI();
        this.statusText.textContent = `✅ 已手動切換為 ${mode === 'back' ? '純背身模式 (180°)' : (mode === 'over_shoulder' ? '背身回眸模式' : '正面模式')}`;
    }

    _updateStanceUI() {
        const btnFront = document.getElementById('btnStanceFront');
        const btnBack = document.getElementById('btnStanceBack');
        const btnOver = document.getElementById('btnStanceOverShoulder');
        const badge = document.getElementById('valStanceBadge');

        btnFront?.classList.toggle('active', this.currentStance === 'front');
        btnBack?.classList.toggle('active', this.currentStance === 'back');
        btnOver?.classList.toggle('active', this.currentStance === 'over_shoulder');

        if (badge) {
            if (this.currentStance === 'back') {
                badge.textContent = '🔄 純背身 (180°)';
                badge.style.color = '#f59e0b';
            } else if (this.currentStance === 'over_shoulder') {
                badge.textContent = '👀 背身回眸';
                badge.style.color = '#ec4899';
            } else {
                badge.textContent = '🧍 正面模式';
                badge.style.color = '#6ee7b7';
            }
        }
    }

    _setHeadRatio(ratio) {
        this.currentPose.headToBodyRatio = ratio;
        this.currentPose.skullScale = (48.0 / ratio) / 5.90;
        this.anatomicalTorso.setHeadRatio(ratio);

        const slider = document.getElementById('sliderHeadRatio');
        const valEl = document.getElementById('valHeadRatio');
        if (slider) slider.value = ratio;
        if (valEl) valEl.textContent = this._getRatioDesc(ratio);

        this._fitCameraToSkeleton();
    }

    _getTargetY() {
        if (this.anatomicalTorso && this.anatomicalTorso.rootGroup) {
            this.anatomicalTorso.rootGroup.updateMatrixWorld(true);
            const bbox = new THREE.Box3().setFromObject(this.anatomicalTorso.rootGroup);
            if (!bbox.isEmpty()) {
                return (bbox.max.y + bbox.min.y) * 0.5;
            }
        }
        return 2.0;
    }

    /**
     * 計算全人體骨骼在當前畫布長寬比下的理想相機觀測距離 (保證頭頂與雙腳永遠完整可見)
     */
    _calculateIdealCameraDistance() {
        let skeletonHeight = 52.0;
        let skeletonWidth = 28.0;

        if (this.anatomicalTorso && this.anatomicalTorso.rootGroup) {
            this.anatomicalTorso.rootGroup.updateMatrixWorld(true);
            const bbox = new THREE.Box3().setFromObject(this.anatomicalTorso.rootGroup);
            if (!bbox.isEmpty()) {
                skeletonHeight = Math.max(16, bbox.max.y - bbox.min.y);
                skeletonWidth = Math.max(16, bbox.max.x - bbox.min.x);
            }
        }

        const aspect = Math.max(0.1, this.camera ? this.camera.aspect : 1.0);
        const fov = this.camera ? this.camera.fov : 38;
        const fovRad = (fov * Math.PI) / 180;
        const tanHalfFov = Math.tan(fovRad * 0.5);

        // 包含適度邊界留白 (Margin ~25%)，保證頭頂與雙腳絕不被視窗邊緣裁切
        const padding = 1.25;
        const distY = (skeletonHeight * padding * 0.5) / tanHalfFov;
        const distX = (skeletonWidth * padding * 0.5) / (tanHalfFov * aspect);
        return Math.max(distY, distX, 50);
    }

    /**
     * 讓相機自動適應並置中全人體骨骼（從頭頂到腳底完整呈現）
     */
    _fitCameraToSkeleton(view = 'front') {
        const dist = this._calculateIdealCameraDistance();
        const targetY = this._getTargetY();

        if (view) {
            this._setCameraView(view);
        } else {
            const offset = this.camera.position.clone().sub(this.controls.target);
            if (offset.lengthSq() < 1e-4) {
                this.camera.position.set(0, targetY, dist);
            } else {
                offset.setLength(dist);
                this.camera.position.copy(new THREE.Vector3(0, targetY, 0)).add(offset);
            }
            this.controls.target.set(0, targetY, 0);
            this.controls.update();
        }
    }

    /**
     * 縮放相機視野 (factor < 1 為放大靠近，factor > 1 為縮小拉遠)
     */
    _zoomCamera(factor) {
        const offset = this.camera.position.clone().sub(this.controls.target);
        const currentDist = offset.length();
        const newDist = THREE.MathUtils.clamp(
            currentDist * factor,
            this.controls.minDistance,
            this.controls.maxDistance
        );
        offset.setLength(newDist);
        this.camera.position.copy(this.controls.target).add(offset);
        this.controls.update();
    }

    _setCameraView(view) {
        document.querySelectorAll('.gizmo-btn').forEach(b => b.classList.remove('active'));

        const dist = this._calculateIdealCameraDistance();
        const targetY = this._getTargetY();
        switch (view) {
            case 'front':
                this.camera.position.set(0, targetY, dist);
                document.getElementById('btnFrontView')?.classList.add('active');
                break;
            case 'side':
                this.camera.position.set(dist, targetY, 0);
                document.getElementById('btnSideView')?.classList.add('active');
                break;
            case 'back':
                this.camera.position.set(0, targetY, -dist);
                document.getElementById('btnBackView')?.classList.add('active');
                break;
            case 'top':
                this.camera.position.set(0, dist + targetY, 0.01);
                document.getElementById('btnTopView')?.classList.add('active');
                break;
        }
        this.controls.target.set(0, targetY, 0);
        this.controls.update();
    }

    async _handleImageFile(file) {
        this.statusText.textContent = "載入並分析模特兒圖片中...";
        const reader = new FileReader();
        reader.onload = async (e) => {
            const img = new Image();
            img.onload = async () => {
                this.originalImageElement = img;

                this.emptyPlaceholder.style.display = 'none';
                this.referenceImage.src = img.src;
                this.referenceImage.style.display = 'block';

                const pose = await this.poseEstimator.estimateFromImage(img);
                if (pose) {
                    // 每次上傳新圖片時，自動恢復為 AI 自適應性別偵測，避免前一張圖的手動切換鎖定新圖片
                    this.genderMode = 'auto';
                    if (pose.suggestedGender) {
                        this._setGender(pose.suggestedGender, false);
                    }
                    this._applyPose(pose);
                    this.aiPoseBackup = { ...pose };
                    this._updateSlidersUI();
                    this._updateGenderUI();
                    this.lastLandmarks2D = pose.landmarks2D;

                    if (pose.isBackStance) {
                        this.currentStance = pose.isOverShoulderLook ? 'over_shoulder' : 'back';
                    } else {
                        this.currentStance = 'front';
                    }
                    this._updateStanceUI();

                    // 識別完成後自動將視角調至最適全身比例，讓使用者第一眼看到完整人體骨架
                    this._fitCameraToSkeleton('front');

                    if (pose.landmarks2D) {
                        this.btnToggle2D.style.display = 'inline-block';
                        this.landmarkCanvas.style.display = 'block';
                        this._draw2DLandmarks();
                    }

                    const engineBadge = (pose.semanticSource === 'gemini-vlm')
                        ? `[🤖 Gemini AI 預判] `
                        : `[🧠 Holistic 視覺預判] `;
                    const ratioStr = pose.headToBodyRatio ? `${pose.headToBodyRatio} 頭身` : '7.1 頭身';
                    const genderStr = this.currentGender === 'female' ? '♀ 女性骨架' : '♂ 男性骨架';
                    const backStr = pose.isBackStance ? (pose.isOverShoulderLook ? '、背身回眸模式' : '、純背身模式 (180° 後背視角)') : '';
                    const profileStr = pose.isProfileStance ? `、側身模式 (${pose.profileSign < 0 ? '面向左' : '面向右'} 90°)` : '';
                    const claspedStr = pose.isOverheadClasped ? '、過頂拱手閉環' : '';
                    const handTrackStr = (pose.rightHandAngles || pose.leftHandAngles) ? '與 21 節點逐指動態追蹤' : '';
                    const truncStr = pose.isLegsTruncated ? '、下肢裁切照 (已鎖定標準站姿)' : '';
                    this.statusText.textContent = `✅ ${engineBadge}姿態識別完成！頭身比 (${ratioStr})、性別 (${genderStr})${backStr}${profileStr}${claspedStr}${handTrackStr}${truncStr}`;
                } else {
                    this._resetToNeutralPose();
                    this.statusText.textContent = "未識別到完整人體 (可能為純背面或過度遮擋視角)，已重置為標準解剖姿態";
                }
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    _resetToNeutralPose() {
        const defaultPose = {
            pelvisRoll: 0,
            pelvisPitch: 0,
            pelvisYaw: 0,
            thoracicPitch: 0,
            thoracicYaw: 0,
            thoracicRoll: 0,
            lumbarPitch: 0,
            lumbarRoll: 0,
            lumbarYaw: 0,
            cervicalPitch: 0,
            cervicalYaw: 0,
            headPitch: 0,
            headYaw: 0,
            headRoll: 0,
            headToBodyRatio: 7.1,
            skullScale: 1.15,
            leftArmPitch: 0,
            leftArmRoll: 0.12,
            leftArmYaw: 0,
            leftElbowFlex: 0.15,
            leftForearmTwist: 1.48,
            leftHandGesture: 'auto',
            leftHandAngles: null,
            rightArmPitch: 0,
            rightArmRoll: -0.12,
            rightArmYaw: 0,
            rightElbowFlex: 0.15,
            rightForearmTwist: 1.48,
            rightHandGesture: 'auto',
            rightHandAngles: null,
            leftHipPitch: 0,
            leftHipRoll: 0.08,
            leftHipYaw: 0,
            leftKneeFlex: 0.08,
            leftAnklePitch: -0.04,
            leftAnkleYaw: 0.12,
            leftAnkleRoll: 0,
            rightHipPitch: 0,
            rightHipRoll: -0.08,
            rightHipYaw: 0,
            rightKneeFlex: 0.08,
            rightAnklePitch: -0.04,
            rightAnkleYaw: -0.12,
            rightAnkleRoll: 0
        };

        this._applyPose(defaultPose);
        this.aiPoseBackup = { ...defaultPose };
        this._updateSlidersUI();
        this.lastLandmarks2D = null;
        this.currentStance = 'front';
        this._updateStanceUI();

        if (this.landmarkCanvas) {
            const ctx = this.landmarkCanvas.getContext('2d');
            ctx.clearRect(0, 0, this.landmarkCanvas.width, this.landmarkCanvas.height);
        }
        if (this.btnToggle2D) {
            this.btnToggle2D.style.display = 'none';
        }
        this._fitCameraToSkeleton('front');
    }

    _draw2DLandmarks() {
        if (!this.lastLandmarks2D || !this.originalImageElement) return;

        const img = this.referenceImage;
        const rect = img.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        this.landmarkCanvas.width = rect.width;
        this.landmarkCanvas.height = rect.height;
        this.landmarkCanvas.style.width = `${rect.width}px`;
        this.landmarkCanvas.style.height = `${rect.height}px`;

        const ctx = this.landmarkCanvas.getContext('2d');
        ctx.clearRect(0, 0, rect.width, rect.height);

        const lm = this.lastLandmarks2D;
        const toScreen = (pt) => ({
            x: pt.x * rect.width,
            y: pt.y * rect.height
        });

        const pLS = toScreen(lm.leftShoulder);
        const pRS = toScreen(lm.rightShoulder);
        const pLH = toScreen(lm.leftHip);
        const pRH = toScreen(lm.rightHip);
        const pMS = toScreen(lm.midShoulder);
        const pMH = toScreen(lm.midHip);

        // 0. 頭部五官特徵線 (Eyes & Nose - 藝用 2D 面部幾何與左右面積比)
        if (lm.leftEye && lm.rightEye) {
            const pLE = toScreen(lm.leftEye);
            const pRE = toScreen(lm.rightEye);
            ctx.strokeStyle = '#f72585';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(pRE.x, pRE.y);
            ctx.lineTo(pLE.x, pLE.y);
            if (lm.nose) {
                const pN = toScreen(lm.nose);
                ctx.lineTo(pN.x, pN.y);
                ctx.lineTo(pRE.x, pRE.y);
                this._drawPoint(ctx, pN, '#f72585', 5);
            }
            ctx.stroke();

            // 雙眼寬度與耳側跨度
            if (lm.leftEyeInner && lm.leftEyeOuter) {
                const pLI = toScreen(lm.leftEyeInner);
                const pLO = toScreen(lm.leftEyeOuter);
                ctx.strokeStyle = '#4cc9f0';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(pLI.x, pLI.y);
                ctx.lineTo(pLO.x, pLO.y);
                ctx.stroke();
            }
            if (lm.rightEyeInner && lm.rightEyeOuter) {
                const pRI = toScreen(lm.rightEyeInner);
                const pRO = toScreen(lm.rightEyeOuter);
                ctx.strokeStyle = '#4cc9f0';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(pRI.x, pRI.y);
                ctx.lineTo(pRO.x, pRO.y);
                ctx.stroke();
            }

            this._drawPoint(ctx, pLE, '#4cc9f0', 3.5);
            this._drawPoint(ctx, pRE, '#4cc9f0', 3.5);
        }

        // 1. 雙肩軸線 (Shoulder Axis)
        ctx.strokeStyle = '#e07a5f';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(pLS.x, pLS.y);
        ctx.lineTo(pRS.x, pRS.y);
        ctx.stroke();

        // 2. 雙臂連線 (Shoulder -> Elbow -> Wrist)
        if (lm.rightElbow) {
            const pRE = toScreen(lm.rightElbow);
            ctx.strokeStyle = '#4cc9f0';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(pRS.x, pRS.y);
            ctx.lineTo(pRE.x, pRE.y);
            if (lm.rightWrist) {
                const pRW = toScreen(lm.rightWrist);
                ctx.lineTo(pRW.x, pRW.y);
            }
            ctx.stroke();
            this._drawPoint(ctx, pRE, '#4cc9f0', 5);
        }

        if (lm.leftElbow) {
            const pLE = toScreen(lm.leftElbow);
            ctx.strokeStyle = '#4cc9f0';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(pLS.x, pLS.y);
            ctx.lineTo(pLE.x, pLE.y);
            if (lm.leftWrist) {
                const pLW = toScreen(lm.leftWrist);
                ctx.lineTo(pLW.x, pLW.y);
            }
            ctx.stroke();
            this._drawPoint(ctx, pLE, '#4cc9f0', 5);
        }

        // 3. 骨盆連線與恥骨倒三角 (Pelvic Basin & Pubic Symphysis)
        ctx.strokeStyle = '#81b29a';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(pLH.x, pLH.y);
        ctx.lineTo(pRH.x, pRH.y);
        const pPubic = {
            x: (pLH.x + pRH.x) * 0.5,
            y: (pLH.y + pRH.y) * 0.5 + Math.abs(pLH.x - pRH.x) * 0.35
        };
        ctx.lineTo(pPubic.x, pPubic.y);
        ctx.lineTo(pLH.x, pLH.y);
        ctx.stroke();
        this._drawPoint(ctx, pPubic, '#81b29a', 5);

        // 4. 脊椎動勢線
        ctx.strokeStyle = '#f4a261';
        ctx.lineWidth = 4;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(pMS.x, pMS.y);
        ctx.lineTo(pMH.x, pMH.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // 5. 節點標記
        this._drawPoint(ctx, pLS, '#e07a5f');
        this._drawPoint(ctx, pRS, '#e07a5f');
        this._drawPoint(ctx, pLH, '#81b29a');
        this._drawPoint(ctx, pRH, '#81b29a');
        this._drawPoint(ctx, pMS, '#f4a261', 6);
        this._drawPoint(ctx, pMH, '#f4a261', 6);

        // 6. MediaPipe Hands 21 節點手骨骨架繪製
        const drawHandSkeleton = (handLandmarks) => {
            if (!handLandmarks || handLandmarks.length < 21) return;
            const connections = [
                [0, 1], [1, 2], [2, 3], [3, 4],       // Thumb
                [0, 5], [5, 6], [6, 7], [7, 8],       // Index
                [5, 9], [9, 10], [10, 11], [11, 12],  // Middle
                [9, 13], [13, 14], [14, 15], [15, 16],// Ring
                [13, 17], [17, 18], [18, 19], [19, 20], // Pinky
                [0, 17], [5, 17]                      // Palm base & arch
            ];

            ctx.strokeStyle = '#06d6a0';
            ctx.lineWidth = 2;
            connections.forEach(([i, j]) => {
                const ptA = toScreen(handLandmarks[i]);
                const ptB = toScreen(handLandmarks[j]);
                ctx.beginPath();
                ctx.moveTo(ptA.x, ptA.y);
                ctx.lineTo(ptB.x, ptB.y);
                ctx.stroke();
            });

            handLandmarks.forEach(pt => {
                this._drawPoint(ctx, toScreen(pt), '#ffd166', 3.5);
            });
        };

        if (lm.leftHand2D) drawHandSkeleton(lm.leftHand2D);
        if (lm.rightHand2D) drawHandSkeleton(lm.rightHand2D);

        // 7. 雙腿與足部連線 (Hip -> Knee -> Ankle -> Heel -> Toe)
        const drawLeg = (pHip, pKnee, pAnkle, pHeel, pToe) => {
            if (!pKnee) return;
            ctx.strokeStyle = '#9d4edd';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(pHip.x, pHip.y);
            ctx.lineTo(pKnee.x, pKnee.y);
            if (pAnkle) {
                ctx.lineTo(pAnkle.x, pAnkle.y);
                if (pHeel && pToe) {
                    ctx.lineTo(pHeel.x, pHeel.y);
                    ctx.lineTo(pToe.x, pToe.y);
                    ctx.lineTo(pAnkle.x, pAnkle.y);
                } else if (pToe) {
                    ctx.lineTo(pToe.x, pToe.y);
                }
            }
            ctx.stroke();

            this._drawPoint(ctx, pKnee, '#c77dff', 5);
            if (pAnkle) this._drawPoint(ctx, pAnkle, '#e0aaff', 4.5);
            if (pHeel) this._drawPoint(ctx, pHeel, '#ff9e00', 3.5);
            if (pToe) this._drawPoint(ctx, pToe, '#ffd166', 3.5);
        };

        if (lm.leftKnee) {
            drawLeg(
                pLH,
                toScreen(lm.leftKnee),
                lm.leftAnkle ? toScreen(lm.leftAnkle) : null,
                lm.leftHeel ? toScreen(lm.leftHeel) : null,
                lm.leftFootIndex ? toScreen(lm.leftFootIndex) : null
            );
        }
        if (lm.rightKnee) {
            drawLeg(
                pRH,
                toScreen(lm.rightKnee),
                lm.rightAnkle ? toScreen(lm.rightAnkle) : null,
                lm.rightHeel ? toScreen(lm.rightHeel) : null,
                lm.rightFootIndex ? toScreen(lm.rightFootIndex) : null
            );
        }
    }

    _drawPoint(ctx, pt, color, radius = 5) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
        ctx.fill();
    }

    _applyPose(pose) {
        Object.assign(this.currentPose, pose);
        this.anatomicalTorso.setTorsoPose(this.currentPose);
    }

    _onResize() {
        const width = this.viewportArea.clientWidth;
        const height = this.viewportArea.clientHeight;
        if (width === 0 || height === 0) return;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);

        if (this.show2DLandmarks && this.lastLandmarks2D) {
            this._draw2DLandmarks();
        }
    }

    _animate() {
        requestAnimationFrame(() => this._animate());
        this.controls.update();
        this._updateBoneTooltipPosition();
        this.renderer.render(this.scene, this.camera);
    }
}

window.addEventListener('DOMContentLoaded', () => {
    new App();
});
