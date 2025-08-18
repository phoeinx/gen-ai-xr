// XRViz.js

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { VoiceController } from './modules/VoiceController.js';
import { HandTracker } from './modules/HandTracker.js';

export class XRVisualizer {
  constructor(container) {
    console.log('XRVisualizer constructor called with container:', container);
    this.container = container;
    this.loadedModels = []; // Track loaded GLB models
    this.mouse = new THREE.Vector2();
    
    // Initialize GLTF loader
    this.gltfLoader = new GLTFLoader();
    
    // Object generation state
    this.heldObject = null; // Currently held object
    this.promptMode = false; // Whether prompt input is active
    this.isGenerating = false; // Whether currently generating object
    
    this.config = {
      environment: {
        size: 150, // environment size
      }
    };

    // Web-based movement
    this.moveState = { forward: 0, right: 0 };
    this.lookState = { x: 0, y: 0 };
    this.keyboardEnabled = true;
    this.pointerLocked = false;
    this.inVR = false;

    // AR state
    this.isAR = false;
    this.hitTestSource = null;
    this.viewerSpace = null;
    this.localSpace = null;
    this.reticle = null;
    this.placedDesk = false;

    // Voice control setup
    this.voiceController = null;

    // Hand tracking setup
    this.handTracker = null;

    this._initScene();
    this._addEventListeners();
    this._initVoiceController();
    this._initHandTracker();
    this._animate();

    // Enable WebXR
    this.renderer.xr.enabled = true;
    // Add AR button with hit-test support
    document.body.appendChild(ARButton.createButton(this.renderer, {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root: document.body }
    }));
  }

  _initScene() {
    console.log('Initializing WebXR scene');
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      75,
      this.container.clientWidth / this.container.clientHeight,
      0.1,
      1000
    );

    this.camera.rotation.order = 'YXZ';

    // Camera rig for VR support
    this.cameraRig = new THREE.Object3D();
    this.cameraRig.position.set(0, 1.6, 0); // standing height
    this.cameraRig.add(this.camera);
    this.scene.add(this.cameraRig);

    // Renderer setup - optimized for performance and AR
    this.renderer = new THREE.WebGLRenderer({ 
      antialias: false, // disable for performance
      alpha: true,      // AR: transparent to show camera passthrough
      powerPreference: "high-performance"
    });
    this.renderer.setClearColor(0x000000, 0); // AR: fully transparent background
    console.log('Renderer created:', this.renderer);
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap; // use basic shadows for performance
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // limit pixel ratio
    this.container.appendChild(this.renderer.domElement);
    console.log('Renderer canvas appended to container');

    // Raycaster for interactions
    this.raycaster = new THREE.Raycaster();

    // Lighting setup
    this._setupLighting();

    // WebXR session events (AR + VR)
    this.renderer.xr.addEventListener('sessionstart', async () => {
      const session = this.renderer.xr.getSession();
      this.inVR = true; // in an XR session (VR or AR)
      try {
        // Try AR setup (if AR session, hit-test will succeed)
        this.viewerSpace = await session.requestReferenceSpace('viewer');
        this.localSpace = await session.requestReferenceSpace('local');
        this.hitTestSource = await session.requestHitTestSource({ space: this.viewerSpace });
        this.isAR = true;

        // Create placement reticle and controller select handler
        this._createARReticle();
        const controller = this.renderer.xr.getController(0);
        controller.addEventListener('select', () => this._onARSelect());
        this.scene.add(controller);

        // Add controller input handlers for voice control (B button)
        session.addEventListener('inputsourceschange', () => {
          for (const inputSource of session.inputSources) {
            if (inputSource.gamepad) {
              // Setup voice controller input listeners
              this.voiceController?.setupControllerInputListeners(inputSource);
            }
          }
        });

        // Setup initial controllers
        for (const inputSource of session.inputSources) {
          if (inputSource.gamepad) {
            this.voiceController?.setupControllerInputListeners(inputSource);
          }
        }
      } catch (e) {
        // Not AR; treat as VR
        this.isAR = false;
        this.cameraRig.position.y = 0; // zero height for VR
      }

      // Hand tracking setup
      if (session && session.inputSources) {
        // Setup hand tracking with the new hand tracker
        this.handTracker.setupHandTracking(session);
      }
    });

    this.renderer.xr.addEventListener('sessionend', () => {
      // Cleanup AR state
      this.inVR = false;
      this.isAR = false;
      this.hitTestSource = null;
      this.viewerSpace = null;
      this.localSpace = null;
      if (this.reticle) {
        this.scene.remove(this.reticle);
        this.reticle.geometry.dispose();
        this.reticle.material.dispose();
        this.reticle = null;
      }

      // Cleanup hand tracking
      if (this.handTracker) {
        this.handTracker.cleanupHandTracking();
      }

      // Restore virtual environment when leaving AR
      if (!this.skyDome) this._createSky();
      if (!this.groundPlane) this._createGroundPlane();

      this.cameraRig.position.y = 1.6;
    });

    // Audio context for ambient sounds
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }

  async _initVoiceController() {
    // Initialize voice controller after scene is set up
    this.voiceController = new VoiceController(this.camera, this.scene);
    
    // Set up event handlers
    this.voiceController.onVoiceCommand = (text, command) => {
      this._handleVoiceCommand(text, command);
    };
    
    this.voiceController.onConnectionChange = (connected) => {
      console.log(`Voice control ${connected ? 'enabled' : 'disabled'}`);
    };
    
    this.voiceController.onError = (error) => {
      console.error('Voice control error:', error);
    };
  }

  _initHandTracker() {
    // Initialize hand tracker after scene is set up
    this.handTracker = new HandTracker(this.scene, this.renderer);
    
    // Set up event handlers for hand tracking
    this.handTracker.onPinchStart = (handedness, position) => {
      this._onHandPinchStart(handedness, position);
    };
    
    this.handTracker.onPinchEnd = (handedness) => {
      this._onHandPinchEnd(handedness);
    };
    
    this.handTracker.onGrabObject = (handedness, position) => {
      this._onHandGrabObject(handedness, position);
    };
    
    this.handTracker.onReleaseObject = (handedness) => {
      this._onHandReleaseObject(handedness);
    };
  }

  // Hand tracking event handlers
  _onHandPinchStart(handedness, position) {
    console.log(`Hand pinch started: ${handedness}`, position);
  }

  _onHandPinchEnd(handedness) {
    console.log(`Hand pinch ended: ${handedness}`);
  }

  _onHandGrabObject(handedness, position) {
    // Spawn a new object from loaded models when pinching
    if (!this.handTracker.getGrabbedObject() && this.loadedModels.length > 0) {
      const randomIndex = Math.floor(Math.random() * this.loadedModels.length);
      const newObject = this.loadedModels[randomIndex].clone();
      newObject.position.set(position.x, position.y, position.z);
      newObject.scale.setScalar(0.5);
      this.scene.add(newObject);
      this.handTracker.setGrabbedObject(newObject);
      
      console.log(`Grabbed object with ${handedness} hand`);
    }
  }

  _onHandReleaseObject(handedness) {
    console.log(`Released object with ${handedness} hand`);
  }

  async _handleVoiceCommand(text, command) {
    console.log('Voice command received:', command);

    // Browser/frontend
    const res = await fetch('/api/generate-model/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: text })
    });

    if (!res.ok) {
      // 404: No static model match, 500: File missing on server
      const msg = await res.text();
      throw new Error(`Request failed: ${res.status} ${msg}`);
    }

    const data = await res.json();
    // Prefer backend-provided absolute URL; fallback to API-proxied static path
    const modelUrl = data.url || `/api/models/${encodeURIComponent(data.filename)}`;
    this._loadAndHoldObject(modelUrl);
    if (window.showMessage) {
      window.showMessage(`✅ Loading ${data.filename}...`);
    }
  }

  _setupLighting() {
    // Bright ambient light for clear morning
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5); // bright white ambient
    this.scene.add(ambientLight);

    // Bright morning sun (directional light)
    this.sunLight = new THREE.DirectionalLight(0xffffff, 1.0); // bright white sun
    this.sunLight.position.set(30, 60, 20); // higher angle for clear day
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 1024;
    this.sunLight.shadow.mapSize.height = 1024;
    this.sunLight.shadow.camera.near = 0.5;
    this.sunLight.shadow.camera.far = 200;
    this.sunLight.shadow.camera.left = -50;
    this.sunLight.shadow.camera.right = 50;
    this.sunLight.shadow.camera.top = 50;
    this.sunLight.shadow.camera.bottom = -50;
    this.scene.add(this.sunLight);

    // Add subtle fill light for softer shadows
    const fillLight = new THREE.DirectionalLight(0x87ceeb, 0.2); // sky blue fill light
    fillLight.position.set(-20, 30, -10);
    this.scene.add(fillLight);
  }

  _addEventListeners() {
    // Keyboard controls
    document.addEventListener('keydown', (e) => {
      if (!this.keyboardEnabled) {
        return;
      }
      if (e.code === 'KeyW') {
        this.moveState.forward = 1;
      }
      if (e.code === 'KeyS') {
        this.moveState.forward = -1;
      }
      if (e.code === 'KeyA') {
        this.moveState.right = -1;
      }
      if (e.code === 'KeyD') {
        this.moveState.right = 1;
      }
      if (e.code === 'KeyF') {
        this._spawnFlowerAtPlayerPosition();
      }
      if (e.code === 'KeyG') {
        this._handleObjectGeneration();
      }
      if (e.code === 'KeyP') {
        // Place held object
        if (this.heldObject) {
          this._spawnHeldObject();
        } else {
          if (window.showMessage) {
            window.showMessage('No object to place. Load an object first! (G for prompt, V for voice)');
          }
        }
      }
      if (e.code === 'KeyV') {
        // Voice control toggle
        if (this.voiceController) {
          this.voiceController.toggleVoiceListening();
        }
      }
    });

    document.addEventListener('keyup', (e) => {
      if (e.code === 'KeyW' && this.moveState.forward === 1) {
        this.moveState.forward = 0;
      }
      if (e.code === 'KeyS' && this.moveState.forward === -1) {
        this.moveState.forward = 0;
      }
      if (e.code === 'KeyA' && this.moveState.right === -1) {
        this.moveState.right = 0;
      }
      if (e.code === 'KeyD' && this.moveState.right === 1) {
        this.moveState.right = 0;
      }
    });

    // Mouse look controls
    document.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked || !this.keyboardEnabled) {
        return;
      }
      const sensitivity = 0.002;
      this.cameraRig.rotation.y -= e.movementX * sensitivity; // yaw
      this.camera.rotation.x -= e.movementY * sensitivity;    // pitch

      // Clamp vertical rotation
      this.camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.camera.rotation.x));
    });

    // Pointer lock
    this.renderer.domElement.addEventListener('click', () => {
      this.renderer.domElement.requestPointerLock();
    });

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.renderer.domElement;
    });

    // Mouse position for non-VR hover effects
    window.addEventListener("mousemove", event => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    });

    // Window resize handling
    window.addEventListener('resize', () => {
      this.handleResize();
    });
  }

  _animate() {
    // Use WebXR frame/time and update AR hit-test
    this.renderer.setAnimationLoop((time, frame) => {
      const moveSpeed = 0.12;

      // Desktop/VR movement
      const forward = new THREE.Vector3();
      this.camera.getWorldDirection(forward);
      forward.y = 0; forward.normalize();

      const right = new THREE.Vector3();
      right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

      const moveVector = new THREE.Vector3();
      moveVector.addScaledVector(forward, this.moveState.forward);
      moveVector.addScaledVector(right, this.moveState.right);
      moveVector.multiplyScalar(moveSpeed);
      this.cameraRig.position.add(moveVector);

      // AR hit-test + reticle update
      if (this.isAR && frame && this.hitTestSource && this.localSpace) {
        const results = frame.getHitTestResults(this.hitTestSource);
        if (results.length > 0) {
          const hit = results[0];
          const pose = hit.getPose(this.localSpace);
          if (pose) {
            if (this.reticle) {
              this.reticle.visible = true;
              this.reticle.matrix.fromArray(pose.transform.matrix);
            }
          }
        } else if (this.reticle) {
          this.reticle.visible = false;
        }
      }

      // Hand tracking update
      if (this.handTracker) {
        this.handTracker.updateHandTracking(frame);
      }

      // Controller input update (for voice control B button)
      if (this.voiceController && this.renderer.xr.isPresenting) {
        const session = this.renderer.xr.getSession();
        this.voiceController.updateControllerInput(session);
      }

      // Update voice UI elements
      if (this.voiceController) {
        this.voiceController.updateVoiceUI(time || performance.now());
      }

      // Held object animation (breathing/bob)
      this._updateHeldObject((time || performance.now()) * 0.001);

      this.renderer.render(this.scene, this.camera);
    });
  }

  // Method to handle window/viewport resize
  handleResize() {
    if (!this.camera || !this.renderer || !this.container) {
      return;
    }

    // Update camera aspect ratio
    this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera.updateProjectionMatrix();

    // Update renderer size
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);

    console.log('XR visualization resized to:', this.container.clientWidth, 'x', this.container.clientHeight);
  }

  // Method to spawn a flower at the player's current position
  _spawnFlowerAtPlayerPosition() {
    // Get player's current position (camera rig position)
    const playerX = this.cameraRig.position.x;
    const playerZ = this.cameraRig.position.z;
    
    // Spawn flower slightly in front of the player
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0; // keep on ground level
    forward.normalize();
    forward.multiplyScalar(2); // 2 units in front of player
    
    const spawnX = playerX + forward.x;
    const spawnZ = playerZ + forward.z;
    
    // Load and spawn the flower GLB model
    this.gltfLoader.load(
      './assets/models/flower.glb',
      (gltf) => {
        const flowerModel = gltf.scene.clone();
        
        // Position the flower
        flowerModel.position.set(spawnX, 0, spawnZ);
        
        // Scale the flower appropriately
        flowerModel.scale.setScalar(0.5);
        
        // Add random rotation for variety
        flowerModel.rotation.y = Math.random() * Math.PI * 2;
        
        // Enable shadows if needed
        flowerModel.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        
        // Add to scene and flowers array
        this.loadedModels.push(flowerModel);
        this.scene.add(flowerModel);
        
        // Optional: Add a subtle spawn effect
        this._createSpawnEffect(spawnX, spawnZ);
      },
      (progress) => {
        // Loading progress (optional)
        console.log('Loading flower model:', (progress.loaded / progress.total * 100) + '%');
      },
      (error) => {
        console.error('Error loading flower model:', error);
      }
    );
  }

  // Optional spawn effect for visual feedback
  _createSpawnEffect(x, z) {
    const effectGeometry = new THREE.RingGeometry(0.5, 1, 12);
    const effectMaterial = new THREE.MeshBasicMaterial({
      color: 0x90EE90, // light green
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide
    });
    
    const effect = new THREE.Mesh(effectGeometry, effectMaterial);
    effect.position.set(x, 0.1, z);
    effect.rotation.x = -Math.PI / 2; // lay flat on ground
    this.scene.add(effect);
    
    // Animate the effect
    const startTime = performance.now();
    const animate = () => {
      const elapsed = (performance.now() - startTime) / 1000;
      if (elapsed < 1) {
        effect.scale.setScalar(1 + elapsed * 2);
        effect.material.opacity = 0.7 * (1 - elapsed);
        requestAnimationFrame(animate);
      } else {
        this.scene.remove(effect);
        effect.geometry.dispose();
        effect.material.dispose();
      }
    };
    animate();
  }

  // Object generation and holding system
  _handleObjectGeneration() {
    if (this.heldObject) {
      // If holding an object, spawn it at current location
      this._spawnHeldObject();
    } else if (!this.promptMode && !this.isGenerating) {
      // If not holding anything and not in prompt mode, show prompt
      this._showPromptInput();
    }
  }

  _showPromptInput() {
    this.promptMode = true;
    this.keyboardEnabled = false; // Disable movement while typing
    
    // Call parent window function directly instead of postMessage
    if (window.showPromptInput) {
      window.showPromptInput();
    }
    
    // Prevent immediate key processing for a short time
    setTimeout(() => {
      // Additional cleanup if needed
    }, 100);
  }

  async _generateObjectFromPrompt(promptText) {
    if (this.isGenerating) {
      console.warn('Already generating an object, ignoring new request');
      return;
    }
    
    this.isGenerating = true;
    
    if (!promptText) {
      console.warn('No prompt text provided, aborting generation');
      this.isGenerating = false;
      return;
    }
    
    try {
      // Call backend API to generate model
      const res = await fetch('/api/generate-model/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: promptText })
      });
      
      if (!res.ok) {
        throw new Error(`Request failed: ${res.status} ${await res.text()}`);
      }
      
      const data = await res.json();
      console.log("data >>>", data)
      const modelUrl = data.url || `/api/models/${encodeURIComponent(data.filename)}`;
      console.log("modelUrl >>>", modelUrl)
      // Load and hold the generated object
      await this._loadAndHoldObject(modelUrl);
      
      // Show success message
      if (window.showMessage) {
        window.showMessage(`✅ Loaded ${data.filename}! Press G or say "place" to spawn it!`);
      }
      
    } catch (error) {
      console.error('Error generating object:', error);
      if (window.showMessage) {
        window.showMessage(`❌ Error generating object: ${error.message}`);
      }
    } finally {
      this.isGenerating = false;
      this.promptMode = false; // Exit prompt mode
      this.keyboardEnabled = true; // Re-enable movement
    }
  }

  async _loadAndHoldObject(modelUrl) {
    return new Promise((resolve, reject) => {
      this.gltfLoader.load(
        modelUrl,
        (gltf) => {
          const model = gltf.scene;
          
          // Auto-scale to hand-held size
          this._scaleObjectForHolding(model);
          
          // Enable shadows
          this._enableShadowsForModel(model);
          
          // Position in front of camera (held position)
          this._positionObjectInHand(model);
          
          // Remove any previously held object
          if (this.heldObject) {
            // Remove from camera if attached
            if (this.heldObject.parent === this.camera) {
              this.camera.remove(this.heldObject);
            } else {
              this.scene.remove(this.heldObject);
            }
          }
          
          // Set as currently held object
          this.heldObject = model;
          
          console.log('Object loaded and held:', modelUrl);
          
          // Show instruction to spawn with enhanced feedback
          if (window.showMessage) {
            window.showMessage('✅ Object ready! Press G or say "place" to spawn it in the world!');
          }
          
          resolve(model);
        },
        (progress) => {
          const percentage = (progress.loaded / progress.total) * 100;
          console.log(`Loading progress: ${percentage.toFixed(1)}%`);
        },
        (error) => {
          console.error('Error loading object:', error);
          reject(error);
        }
      );
    });
  }

  _scaleObjectForHolding(model) {
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const maxDimension = Math.max(size.x, size.y, size.z);
    
    // Scale to hand-held size (max 0.8 units for better hand appearance)
    let scale = 1;
    if (maxDimension > 0.8) {
      scale = 0.8 / maxDimension;
      model.scale.setScalar(scale);
    }
    
    // Store original scale for animations
    model.userData.originalScale = scale;
  }

  _positionObjectInHand(model) {
    // Position object in front of camera, appearing to be held in hand
    // Right hand position - slightly down and to the right
    const handOffset = new THREE.Vector3(0.4, -0.4, -1.2);
    
    // Don't apply camera matrix - keep relative to camera
    model.position.copy(handOffset);
    
    // Add slight initial rotation for natural holding angle
    model.rotation.set(0.2, 0.3, 0.1);
    
    // Add holding animation data
    model.userData.holdingAnimation = {
      basePosition: handOffset.clone(),
      baseRotation: new THREE.Euler(0.2, 0.3, 0.1),
      time: 0,
      bobIntensity: 0.08,
      swayIntensity: 0.03
    };
    
    // Make the object a child of the camera so it moves with the player
    this.camera.add(model);
  }

  _spawnHeldObject() {
    if (!this.heldObject) {
      return;
    }
    
    // Get spawn position in front of player
    const spawnPos = this._getPlayerSpawnPosition();
    
    // Remove object from camera (it's currently attached to camera)
    this.camera.remove(this.heldObject);
    
    // Reset object properties for world placement
    this.heldObject.position.set(spawnPos.x, 0, spawnPos.z);
    this.heldObject.rotation.set(0, Math.random() * Math.PI * 2, 0); // Random Y rotation only
    
    // Scale up to world size and reset scale animation
    const worldScale = 2.5; // Make spawned objects larger than held objects
    this.heldObject.scale.setScalar(this.heldObject.userData.originalScale * worldScale);
    
    // Remove holding-specific properties
    delete this.heldObject.userData.holdingAnimation;
    delete this.heldObject.userData.originalScale;
    
    // Add to scene and tracking
    this.scene.add(this.heldObject);
    this.loadedModels.push(this.heldObject);
    
    // Clear held object reference
    this.heldObject = null;
    
    // Add spawn effect
    this._createSpawnEffect(spawnPos.x, spawnPos.z);
    
    console.log('Object spawned at:', spawnPos);
    
    // Show success message
    if (window.showMessage) {
      window.showMessage('Object spawned successfully!');
    }
  }

  _enableShadowsForModel(model) {
    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        
        if (child.material) {
          child.material.needsUpdate = true;
        }
      }
    });
  }

  // Helper method to get spawn position in front of player
  _getPlayerSpawnPosition() {
    const playerX = this.cameraRig.position.x;
    const playerZ = this.cameraRig.position.z;
    
    // Spawn 3 units in front of player
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    forward.multiplyScalar(3);
    
    return {
      x: playerX + forward.x,
      y: 0, // ground level
      z: playerZ + forward.z
    };
  }

  // Update held object animation in the animation loop
  _updateHeldObject(time) {
    if (this.heldObject && this.heldObject.userData.holdingAnimation) {
      const anim = this.heldObject.userData.holdingAnimation;
      anim.time += 0.02;
      
      // Enhanced hand-holding animation
      // Walking bob - vertical movement
      const walkingBob = Math.sin(anim.time * 3) * anim.bobIntensity;
      
      // Hand sway - horizontal movement
      const handSway = Math.sin(anim.time * 2) * anim.swayIntensity;
      
      // Update position with natural hand movement
      this.heldObject.position.set(
        anim.basePosition.x + handSway,
        anim.basePosition.y + walkingBob,
        anim.basePosition.z
      );
      
      // Gentle rotation for natural hand movement
      this.heldObject.rotation.set(
        anim.baseRotation.x + Math.sin(anim.time * 1.5) * 0.05,
        anim.baseRotation.y + Math.cos(anim.time * 1.8) * 0.03,
        anim.baseRotation.z + Math.sin(anim.time * 2.2) * 0.02
      );
      
      // Add breathing effect - subtle scale animation
      const breathingScale = 1 + Math.sin(anim.time * 1.5) * 0.02;
      this.heldObject.scale.setScalar(this.heldObject.userData.originalScale * breathingScale);
    }
  }

  // Create an AR placement reticle
  _createARReticle() {
    const geo = new THREE.RingGeometry(0.12, 0.15, 32);
    const mat = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
    const reticle = new THREE.Mesh(geo, mat);
    reticle.rotation.x = -Math.PI / 2;
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    this.scene.add(reticle);
    this.reticle = reticle;
  }

  // Place held object or desk at the reticle when selecting in AR
  _onARSelect() {
    // TODO: test if selection is working and implement
    // if (!this.isAR || !this.reticle || !this.reticle.visible) return;

    // const target = new THREE.Vector3();
    // const quat = new THREE.Quaternion();
    // const scale = new THREE.Vector3();
    // this.reticle.matrix.decompose(target, quat, scale);

    // if (this.heldObject) {
    //   // Place currently held object
    //   this.camera.remove(this.heldObject);
    //   this.heldObject.position.copy(target);
    //   this.heldObject.rotation.set(0, Math.random() * Math.PI * 2, 0);
    //   const s = (this.heldObject.userData?.originalScale || 1) * 2.5;
    //   this.heldObject.scale.setScalar(s);
    //   delete this.heldObject.userData?.holdingAnimation;
    //   delete this.heldObject.userData?.originalScale;
    //   this.scene.add(this.heldObject);
    //   this.loadedModels.push(this.heldObject);
    //   this.heldObject = null;
    //   this._createSpawnEffect(target.x, target.z);
    //   if (window.showMessage) window.showMessage('Placed object');
    // } else {
    //   // Place or move the desk
    //   const placeDesk = (desk) => {
    //     desk.position.copy(target);
    //     desk.rotation.y = Math.PI;
    //     if (!this.centerDesk) {
    //       this.centerDesk = desk;
    //       this.scene.add(desk);
    //     }
    //     this.placedDesk = true;
    //   };

    //   if (this.centerDesk) {
    //     placeDesk(this.centerDesk);
    //   } else {
    //     this.gltfLoader.load(
    //       './assets/models/desk.glb',
    //       (gltf) => {
    //         const desk = gltf.scene.clone();
    //         desk.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
    //         placeDesk(desk);
    //       },
    //       undefined,
    //       () => {
    //         // Fallback simple desk
    //         const desk = new THREE.Group();
    //         const top = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 0.5), new THREE.MeshLambertMaterial({ color: 0x8b4513 }));
    //         top.position.y = 0.75;
    //         desk.add(top);
    //         placeDesk(desk);
    //       }
    //     );
    //   }
    //   if (window.showMessage) window.showMessage('Placed desk');
    // }
  }
}
