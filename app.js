/**
 * AnatoPose 3D - Main Application Controller (Upper Limb & Shoulder Girdle Edition)
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { AnatomicalTorso } from './anatomy.js?v=3.4';
import { TorsoPoseEstimator } from './poseDetector.js?v=3.4';

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
            // 藝用解剖頭部姿態 (Head Pose)
            headPitch: 0,
            headYaw: 0,
            headRoll: 0,
            leftArmPitch: 0,
            leftArmRoll: 0.12,
            leftArmYaw: 0,
            leftElbowFlex: 0.15,
            leftForearmTwist: 1.48, // 生理休息位半旋前 (85°)，掌心對準大腿
            leftHandGesture: 'relaxed',
            rightArmPitch: 0,
            rightArmRoll: -0.12,
            rightArmYaw: 0,
            rightElbowFlex: 0.15,
            rightForearmTwist: 1.48, // 生理休息位半旋前 (85°)，掌心對準大腿
            rightHandGesture: 'relaxed',
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
        this.camera.position.set(0, -3.0, 48);

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
        this.controls.target.set(0, -4.0, 0); // 居中聚焦在全人體骨骼中心
        this.controls.maxDistance = 85;
        this.controls.minDistance = 6;

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

        // 地面 (位置設定於腳掌底部 Y = -25.5)
        const groundGeo = new THREE.PlaneGeometry(120, 120);
        const groundMat = new THREE.ShadowMaterial({ opacity: 0.25 });
        const ground = new THREE.Mesh(groundGeo, groundMat);
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -25.5;
        ground.receiveShadow = true;
        this.scene.add(ground);
    }

    _initAnatomy() {
        this.anatomicalTorso = new AnatomicalTorso();
        this.scene.add(this.anatomicalTorso.rootGroup);
    }

    _initPoseEstimator() {
        this.poseEstimator = new TorsoPoseEstimator();
    }

    _initUI() {
        const fileInput = document.getElementById('fileInput');
        fileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                this._handleImageFile(e.target.files[0]);
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

        // 範例按鈕
        document.getElementById('btnSample1').addEventListener('click', () => this._loadPresetSample('sampleA'));
        document.getElementById('btnSample2').addEventListener('click', () => this._loadPresetSample('sampleB'));

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
        document.getElementById('toggleLandmarks').addEventListener('change', (e) => {
            this.anatomicalTorso.toggleLandmarks(e.target.checked);
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
                this.currentPose.rightHandGesture = e.target.value;
                this.anatomicalTorso.setHandGesture('right', e.target.value);
            });
        }

        const selLeftGest = document.getElementById('selectLeftHandGesture');
        if (selLeftGest) {
            selLeftGest.addEventListener('change', (e) => {
                this.currentPose.leftHandGesture = e.target.value;
                this.anatomicalTorso.setHandGesture('left', e.target.value);
            });
        }

        // 重置為 AI 姿態
        document.getElementById('btnResetPose').addEventListener('click', () => {
            this._applyPose(this.aiPoseBackup);
            this._updateSlidersUI();
        });

        // 快速視角按鈕
        document.getElementById('btnFrontView').addEventListener('click', () => this._setCameraView('front'));
        document.getElementById('btnSideView').addEventListener('click', () => this._setCameraView('side'));
        document.getElementById('btnBackView').addEventListener('click', () => this._setCameraView('back'));
        document.getElementById('btnTopView').addEventListener('click', () => this._setCameraView('top'));
        document.getElementById('btnResetCamera').addEventListener('click', () => this._setCameraView('front'));
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
        if (selRG && this.currentPose.rightHandGesture) {
            selRG.value = this.currentPose.rightHandGesture;
        }

        const selLG = document.getElementById('selectLeftHandGesture');
        if (selLG && this.currentPose.leftHandGesture) {
            selLG.value = this.currentPose.leftHandGesture;
        }
    }

    _setCameraView(view) {
        document.querySelectorAll('.gizmo-btn').forEach(b => b.classList.remove('active'));

        const dist = 48;
        const targetY = -4.0;
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
                    this._applyPose(pose);
                    this.aiPoseBackup = { ...pose };
                    this._updateSlidersUI();
                    this.lastLandmarks2D = pose.landmarks2D;

                    if (pose.landmarks2D) {
                        this.btnToggle2D.style.display = 'inline-block';
                        this.landmarkCanvas.style.display = 'block';
                        this._draw2DLandmarks();
                    }

                    this.statusText.textContent = "✅ 姿態與手勢識別完成！MediaPipe Holistic 全身與手掌 21 骨節解算手掌法向與手勢";
                } else {
                    this.statusText.textContent = "未識別到完整人體，已使用預設解剖姿態";
                }
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
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

    _loadPresetSample(type) {
        const canvas = document.createElement('canvas');
        canvas.width = 600;
        canvas.height = 800;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#1c1e26';
        ctx.fillRect(0, 0, 600, 800);

        ctx.strokeStyle = '#e07a5f';
        ctx.lineWidth = 4;
        ctx.fillStyle = '#ffffff';
        ctx.font = '22px sans-serif';

        let targetPose;
        if (type === 'sampleA') {
            ctx.fillText("範例 A：微側身挺胸 + 抬手姿態", 40, 60);
            targetPose = {
                pelvisRoll: -0.06,
                pelvisPitch: 0,
                pelvisYaw: 0.1,
                thoracicPitch: -0.15,
                thoracicYaw: 0.25,
                thoracicRoll: -0.05,
                lumbarPitch: 0.12,
                lumbarRoll: 0.05,
                lumbarYaw: 0.12,
                cervicalPitch: -0.05,
                cervicalYaw: 0.15,
                headPitch: 0,
                headYaw: 0.15,
                headRoll: -0.05,
                leftArmPitch: 0.1,
                leftArmRoll: 0.2,
                leftArmYaw: 0,
                leftElbowFlex: 0.25,
                leftForearmTwist: 1.48,
                rightArmPitch: 0.35,
                rightArmRoll: -1.15, // 右手高抬
                rightArmYaw: 0,
                rightElbowFlex: 1.85, // 右肘屈曲比耶
                rightForearmTwist: 0.35,
                rightHandGesture: 'peace',
                leftHandGesture: 'relaxed',
                leftHipPitch: 0.05,
                leftHipRoll: 0.08,
                leftHipYaw: 0,
                leftKneeFlex: 0.05,
                leftAnklePitch: -0.02,
                leftAnkleRoll: 0,
                rightHipPitch: -0.08,
                rightHipRoll: -0.08,
                rightHipYaw: 0,
                rightKneeFlex: 0.08,
                rightAnklePitch: -0.04,
                rightAnkleRoll: 0
            };
        } else {
            ctx.fillText("範例 B：側彎對抗 (Contrapposto)", 40, 60);
            targetPose = {
                pelvisRoll: 0.22,
                pelvisPitch: 0.02,
                pelvisYaw: -0.08,
                thoracicPitch: 0.05,
                thoracicYaw: -0.25,
                thoracicRoll: 0.22,
                lumbarPitch: -0.05,
                lumbarRoll: -0.28,
                lumbarYaw: -0.1,
                cervicalPitch: 0.08,
                cervicalYaw: -0.15,
                headPitch: 0.05,
                headYaw: -0.15,
                headRoll: 0.08,
                leftArmPitch: -0.1,
                leftArmRoll: 0.45,
                leftArmYaw: 0,
                leftElbowFlex: 0.45,
                leftForearmTwist: 1.48,
                rightArmPitch: 0.2,
                rightArmRoll: -0.3,
                rightArmYaw: 0,
                rightElbowFlex: 0.5,
                rightForearmTwist: 1.48,
                rightHandGesture: 'relaxed',
                leftHandGesture: 'relaxed',
                leftHipPitch: -0.05,
                leftHipRoll: 0.16,
                leftHipYaw: 0,
                leftKneeFlex: 0.04, // 承重腿直立
                leftAnklePitch: -0.02,
                leftAnkleRoll: 0.06,
                rightHipPitch: 0.15,
                rightHipRoll: -0.12,
                rightHipYaw: 0,
                rightKneeFlex: 0.35, // 游離放鬆腿屈膝
                rightAnklePitch: -0.12,
                rightAnkleRoll: -0.04
            };
        }

        const dataUrl = canvas.toDataURL();
        this.emptyPlaceholder.style.display = 'none';
        this.referenceImage.src = dataUrl;
        this.referenceImage.style.display = 'block';
        this.landmarkCanvas.style.display = 'none';
        this.btnToggle2D.style.display = 'none';

        this._applyPose(targetPose);
        this.aiPoseBackup = { ...targetPose };
        this._updateSlidersUI();
        this.statusText.textContent = `✅ 已載入 ${type === 'sampleA' ? '範例 A (抬手站姿)' : '範例 B (側彎對抗)'}！`;
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
        this.renderer.render(this.scene, this.camera);
    }
}

window.addEventListener('DOMContentLoaded', () => {
    new App();
});
