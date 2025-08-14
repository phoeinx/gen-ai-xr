// XRViz.js

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { WhisperClient } from './WhisperClient.js';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { XRHandModelFactory } from 'https://esm.sh/three@0.158.0/examples/jsm/webxr/XRHandModelFactory.js';

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
    this.whisperClient = null;
    this.voiceEnabled = false;
    this.isListening = false;

    // Hand tracking state
    this.handModels = { left: null, right: null };
    this.pinchState = { left: false, right: false };
    this.lastPinchState = { left: false, right: false };
    this.grabbedObject = null;
    this.isHolding = false;
    this.handModelFactory = null;

    // Controller input state for voice control
    this.controllerButtonStates = new Map(); // Track button states per controller

    // Voice UI feedback elements
    this.loadingBarBackground = null;
    this.loadingBarFill = null;
    this.transcribingText = null;
    this.transcriptDisplay = null;

    this._initScene();
    this._addEventListeners();
    this._initVoiceControl();
    this._createVoiceUI();
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
              // Listen for gamepad button events
              this._setupControllerInputListeners(inputSource);
            }
          }
        });

        // Setup initial controllers
        for (const inputSource of session.inputSources) {
          if (inputSource.gamepad) {
            this._setupControllerInputListeners(inputSource);
          }
        }
      } catch (e) {
        // Not AR; treat as VR
        this.isAR = false;
        this.cameraRig.position.y = 0; // zero height for VR
      }

      // Hand tracking setup
      if (session && session.inputSources) {
        session.addEventListener('inputsourceschange', this._onInputSourcesChange.bind(this));
        // Add hand models for any hands present
        for (const inputSource of session.inputSources) {
          if (inputSource.hand) {
            const handedness = inputSource.handedness;
            if (!this.handModels[handedness]) {
              const handModel = this.handModelFactory.createHandModel(inputSource);
              this.handModels[handedness] = handModel;
              this.scene.add(handModel);
            }
          }
        }
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

      // Restore virtual environment when leaving AR
      if (!this.skyDome) this._createSky();
      if (!this.groundPlane) this._createGroundPlane();

      this.cameraRig.position.y = 1.6;
    });

    // Audio context for ambient sounds
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }

  async _initVoiceControl() {
    try {
      // Initialize Whisper client
      const wsScheme = location.protocol === 'https:' ? 'wss' : 'ws';
      const whisperUrl = `${wsScheme}://${location.host}/whisper/ws`;
      this.whisperClient = new WhisperClient(whisperUrl);
      
      // Set up event handlers
      this.whisperClient.onTranscription = (result) => {
        this._handleVoiceCommand(result.text);
      };
      
      this.whisperClient.onError = (error) => {
        console.error('Voice control error:', error);
        if (window.showMessage) {
          window.showMessage(`Voice error: ${error}`);
        }
      };
      
      this.whisperClient.onConnectionChange = (connected) => {
        this.voiceEnabled = connected;
        console.log(`Voice control ${connected ? 'enabled' : 'disabled'}`);
        if (window.showMessage) {
          window.showMessage(`Voice control ${connected ? 'enabled' : 'disabled'}`);
        }
      };
      
      // Try to connect
      await this.whisperClient.connect();
      
    } catch (error) {
      console.warn('Voice control not available:', error);
      this.voiceEnabled = false;
    }
  }

  _handleVoiceCommand(text) {
    const command = text.toLowerCase().trim();
    console.log('Voice command received:', command);
    
    // Show transcript
    this._showTranscript(text);
    
    // Enable keyboard for potential prompt mode
    this.keyboardEnabled = true;
    
    // Check for object keywords first
    const objectModel = this._matchObjectKeyword(command);
    if (objectModel) {
      // Use backend models path for most models, frontend assets for desk/flower
      let modelPath;
      if (objectModel === 'desk' || objectModel === 'flower') {
        modelPath = `./assets/models/${objectModel}.glb`;
      } else {
        modelPath = `/api/models/${objectModel}.glb`; // Backend models via API proxy
      }
      
      this._loadAndHoldObject(modelPath);
      if (window.showMessage) {
        window.showMessage(`✅ Loading ${objectModel}...`);
      }
      return;
    }
    
    // Command patterns for specific actions
    if (command.includes('spawn') && command.includes('flower')) {
      this._spawnFlowerAtPlayerPosition();
      if (window.showMessage) {
        window.showMessage('Spawning flower via voice command');
      }
    }
    else if (command.includes('place') || command.includes('drop') || command.includes('put down')) {
      if (this.heldObject) {
        this._spawnHeldObject();
        if (window.showMessage) {
          window.showMessage('Placing object via voice command');
        }
      } else {
        if (window.showMessage) {
          window.showMessage('No object to place. Say a model name first! (car, tree, cactus, etc.)');
        }
      }
    }
    else {
      // Show available models if no match found
      const availableModels = this._getAvailableModels().join(', ');
      if (window.showMessage) {
        window.showMessage(`Available models: ${availableModels}. Or say "place", "clear sky", etc.`);
      }
    }
  }

  _matchObjectKeyword(command) {
    // Define available models and their keywords
    const modelKeywords = {
      'car': ['car', 'vehicle', 'automobile'],
      'tree': ['tree', 'plant'],
      'cactus': ['cactus', 'succulent'],
      'bonfire': ['bonfire', 'fire', 'campfire'],
      'firework': ['firework', 'fireworks', 'rocket'],
      'toaster': ['toaster', 'toast'],
      'flower': ['flower', 'bloom'],
      'desk': ['desk', 'table']
    };
    
    // Check each model for keyword matches
    for (const [model, keywords] of Object.entries(modelKeywords)) {
      for (const keyword of keywords) {
        if (command.includes(keyword)) {
          return model;
        }
      }
    }
    
    return null;
  }

  _getAvailableModels() {
    return ['car', 'tree', 'cactus', 'bonfire', 'firework', 'toaster', 'flower', 'desk'];
  }

  startVoiceListening() {
    if (!this.voiceEnabled || !this.whisperClient) {
      if (window.showMessage) {
        window.showMessage('❌ Voice control not available. Check Whisper server connection.');
      }
      console.warn('Voice control not available');
      return false;
    }
    
    if (this.isListening) {
      console.warn('Already listening');
      return false;
    }
    
    this.whisperClient.startRecording();
    this.isListening = true;
    
    // Show visual feedback
    this._showVoiceIndicator(true);
    
    if (window.showMessage) {
      window.showMessage('🎤 Listening... Say a model name: car, tree, cactus, bonfire, etc.');
    }
    
    return true;
  }

  stopVoiceListening() {
    if (!this.isListening || !this.whisperClient) {
      return false;
    }
    
    this.whisperClient.stopRecording();
    this.isListening = false;
    
    // Hide visual feedback
    this._showVoiceIndicator(false);
    
    if (window.showMessage) {
      window.showMessage('🔄 Processing your voice command...');
    }
    
    return true;
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

    // No fog for clear visibility
    // this.scene.fog = removed for clear sky
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
        if (!this.isListening) {
          this.startVoiceListening();
        } else {
          this.stopVoiceListening();
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
      this._updateHandTracking(frame);

      // Controller input update (for voice control B button)
      this._updateControllerInput();

      // Update voice UI elements
      this._updateVoiceUI(time || performance.now());

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

  async _generateObjectFromPrompt(prompt) {
    if (this.isGenerating) {
      if (window.showMessage) {
        window.showMessage('Already generating an object, please wait...');
      }
      return;
    }
    
    this.isGenerating = true;
    this.promptMode = false;
    
    // Show immediate feedback
    if (window.showMessage) {
      window.showMessage(`🎯 Generating: "${prompt}"...`);
    }
    
    try {
      // Call backend API
      const response = await fetch('/api/generate-model-direct', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: prompt,
          x: this.cameraRig.position.x,
          z: this.cameraRig.position.z
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('Model generated:', data);

      if (window.showMessage) {
        window.showMessage('🎨 Object created! Loading into your hand...');
      }

      // Load and hold the object - prepend /api for frontend proxy
      const fullModelUrl = '/api' + data.model_url;
      await this._loadAndHoldObject(fullModelUrl);
      
    } catch (error) {
      console.error('Error generating object:', error);
      
      if (window.showMessage) {
        window.showMessage(`❌ Generation failed: ${error.message}. Loading fallback object...`);
      }
      
      // Fallback: load a default object
      try {
        await this._loadAndHoldObject('/api/models/crystal.glb'); // Fallback object
      } catch (fallbackError) {
        if (window.showMessage) {
          window.showMessage('❌ Could not load any object. Check your connection.');
        }
      }
    } finally {
      this.isGenerating = false;
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
    if (!this.isAR || !this.reticle || !this.reticle.visible) return;

    const target = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    this.reticle.matrix.decompose(target, quat, scale);

    if (this.heldObject) {
      // Place currently held object
      this.camera.remove(this.heldObject);
      this.heldObject.position.copy(target);
      this.heldObject.rotation.set(0, Math.random() * Math.PI * 2, 0);
      const s = (this.heldObject.userData?.originalScale || 1) * 2.5;
      this.heldObject.scale.setScalar(s);
      delete this.heldObject.userData?.holdingAnimation;
      delete this.heldObject.userData?.originalScale;
      this.scene.add(this.heldObject);
      this.loadedModels.push(this.heldObject);
      this.heldObject = null;
      this._createSpawnEffect(target.x, target.z);
      if (window.showMessage) window.showMessage('Placed object');
    } else {
      // Place or move the desk
      const placeDesk = (desk) => {
        desk.position.copy(target);
        desk.rotation.y = Math.PI;
        if (!this.centerDesk) {
          this.centerDesk = desk;
          this.scene.add(desk);
        }
        this.placedDesk = true;
      };

      if (this.centerDesk) {
        placeDesk(this.centerDesk);
      } else {
        this.gltfLoader.load(
          './assets/models/desk.glb',
          (gltf) => {
            const desk = gltf.scene.clone();
            desk.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
            placeDesk(desk);
          },
          undefined,
          () => {
            // Fallback simple desk
            const desk = new THREE.Group();
            const top = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 0.5), new THREE.MeshLambertMaterial({ color: 0x8b4513 }));
            top.position.y = 0.75;
            desk.add(top);
            placeDesk(desk);
          }
        );
      }
      if (window.showMessage) window.showMessage('Placed desk');
    }
  }

  _onInputSourcesChange(event) {
    const session = this.renderer.xr.getSession();
    if (session) {
      for (const inputSource of session.inputSources) {
        if (inputSource.hand) {
          const handedness = inputSource.handedness;
          if (!this.handModels[handedness]) {
            const handModel = this.handModelFactory.createHandModel(inputSource);
            this.handModels[handedness] = handModel;
            this.scene.add(handModel);
          }
        }
      }
    }
  }

  // Pinch detection and object spawn/hold
  _updateHandTracking(frame) {
    if (!this.renderer.xr.isPresenting) return;
    const session = this.renderer.xr.getSession();
    if (!session) return;
    for (const [handedness, handModel] of Object.entries(this.handModels)) {
      if (!handModel) continue;
      const inputSource = Array.from(session.inputSources).find(
        src => src.handedness === handedness && src.hand
      );
      if (inputSource && inputSource.hand) {
        try {
          const referenceSpace = this.renderer.xr.getReferenceSpace();
          const framePose = frame.getPose(inputSource.hand.get('index-finger-tip'), referenceSpace);
          if (framePose) {
            const isPinching = this._detectPinch(inputSource.hand, frame, referenceSpace);
            this._handlePinchGesture(handedness, isPinching, framePose.transform.position);
          }
        } catch (e) {}
      }
    }
    this._updateGrabbedObject();
  }

  _detectPinch(hand, frame, referenceSpace) {
    try {
      const thumbTip = frame.getPose(hand.get('thumb-tip'), referenceSpace);
      const indexTip = frame.getPose(hand.get('index-finger-tip'), referenceSpace);
      if (thumbTip && indexTip) {
        const distance = new THREE.Vector3()
          .subVectors(
            new THREE.Vector3().fromArray([thumbTip.transform.position.x, thumbTip.transform.position.y, thumbTip.transform.position.z]),
            new THREE.Vector3().fromArray([indexTip.transform.position.x, indexTip.transform.position.y, indexTip.transform.position.z])
          ).length();
        return distance < 0.03; // 3cm threshold for pinch
      }
    } catch (e) {}
    return false;
  }

  _handlePinchGesture(handedness, isPinching, position) {
    const wasPinching = this.lastPinchState[handedness];
    this.pinchState[handedness] = isPinching;
    if (isPinching && !wasPinching) {
      this._onPinchStart(handedness, position);
    } else if (!isPinching && wasPinching) {
      this._onPinchEnd(handedness);
    }
    this.lastPinchState[handedness] = isPinching;
  }

  _onPinchStart(handedness, position) {
    if (!this.grabbedObject && this.loadedModels.length > 0) {
      // Spawn a new object from loaded models
      const randomIndex = Math.floor(Math.random() * this.loadedModels.length);
      const newObject = this.loadedModels[randomIndex].clone();
      newObject.position.set(position.x, position.y, position.z);
      newObject.scale.setScalar(0.5);
      this.scene.add(newObject);
      this.grabbedObject = newObject;
      this.isHolding = true;
    }
  }

  _onPinchEnd(handedness) {
    if (this.grabbedObject && handedness === 'right') {
      this.grabbedObject = null;
      this.isHolding = false;
    }
  }

  _updateGrabbedObject() {
    if (this.grabbedObject && this.isHolding) {
      // Update object position based on right hand
      const rightHand = this.handModels.right;
      if (rightHand) {
        this.grabbedObject.position.copy(rightHand.position);
      }
    }
  }

  // Controller input handling for voice control
  _setupControllerInputListeners(inputSource) {
    // Initialize button state tracking for this controller
    if (!this.controllerButtonStates.has(inputSource)) {
      this.controllerButtonStates.set(inputSource, {
        bButton: false,
        lastBButton: false
      });
    }
  }

  _updateControllerInput() {
    if (!this.renderer.xr.isPresenting) return;
    
    const session = this.renderer.xr.getSession();
    if (!session) return;

    // Check all input sources for gamepad input
    for (const inputSource of session.inputSources) {
      if (inputSource.gamepad) {
        this._checkControllerButtons(inputSource);
      }
    }
  }

  _checkControllerButtons(inputSource) {
    const gamepad = inputSource.gamepad;
    if (!gamepad || !gamepad.buttons) return;

    // Get or initialize button state for this controller
    let buttonState = this.controllerButtonStates.get(inputSource);
    if (!buttonState) {
      buttonState = { bButton: false, lastBButton: false };
      this.controllerButtonStates.set(inputSource, buttonState);
    }

    // Check B button (typically button index 1 on most XR controllers)
    // Button 1 is commonly the B button on Oculus/Meta controllers
    const bButtonPressed = gamepad.buttons[1] && gamepad.buttons[1].pressed;
    
    // Detect button press (not held)
    if (bButtonPressed && !buttonState.lastBButton) {
      // B button was just pressed - toggle voice recording
      console.log('B button pressed - toggling voice listening');
      if (!this.isListening) {
        this.startVoiceListening();
      } else {
        this.stopVoiceListening();
      }
    }

    // Update button states
    buttonState.lastBButton = buttonState.bButton;
    buttonState.bButton = bButtonPressed;
  }

  // Voice UI methods for visual feedback
  _createVoiceUI() {
    // Create loading bar background
    const loadingBarGeometry = new THREE.PlaneGeometry(1.2, 0.1);
    const loadingBarMaterial = new THREE.MeshBasicMaterial({
      color: 0x333333,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide
    });
    this.loadingBarBackground = new THREE.Mesh(loadingBarGeometry, loadingBarMaterial);
    this.loadingBarBackground.visible = false;
    
    // Create loading bar fill
    const loadingFillGeometry = new THREE.PlaneGeometry(1.2, 0.1);
    const loadingFillMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide
    });
    this.loadingBarFill = new THREE.Mesh(loadingFillGeometry, loadingFillMaterial);
    this.loadingBarFill.visible = false;
    
    // Create "Transcribing..." text
    const transcribingCanvas = document.createElement('canvas');
    transcribingCanvas.width = 512;
    transcribingCanvas.height = 64;
    const transcribingContext = transcribingCanvas.getContext('2d');
    transcribingContext.fillStyle = 'rgba(0, 0, 0, 0)';
    transcribingContext.fillRect(0, 0, transcribingCanvas.width, transcribingCanvas.height);
    transcribingContext.fillStyle = 'white';
    transcribingContext.font = 'bold 32px Arial';
    transcribingContext.textAlign = 'center';
    transcribingContext.textBaseline = 'middle';
    transcribingContext.fillText('Transcribing...', transcribingCanvas.width / 2, transcribingCanvas.height / 2);
    
    const transcribingTexture = new THREE.CanvasTexture(transcribingCanvas);
    const transcribingGeometry = new THREE.PlaneGeometry(1, 0.125);
    const transcribingMaterial = new THREE.MeshBasicMaterial({
      map: transcribingTexture,
      transparent: true,
      side: THREE.DoubleSide
    });
    this.transcribingText = new THREE.Mesh(transcribingGeometry, transcribingMaterial);
    this.transcribingText.visible = false;
    
    // Create transcript display plane
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    context.fillStyle = 'rgba(0, 0, 0, 0.8)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    
    const texture = new THREE.CanvasTexture(canvas);
    const transcriptGeometry = new THREE.PlaneGeometry(1, 0.25);
    const transcriptMaterial = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: THREE.DoubleSide
    });
    this.transcriptDisplay = new THREE.Mesh(transcriptGeometry, transcriptMaterial);
    this.transcriptDisplay.visible = false;
    
    // Add to camera so they follow the user
    this.camera.add(this.loadingBarBackground);
    this.camera.add(this.loadingBarFill);
    this.camera.add(this.transcribingText);
    this.camera.add(this.transcriptDisplay);
  }

  _showVoiceIndicator(show) {
    if (!this.loadingBarBackground || !this.loadingBarFill || !this.transcribingText) return;
    
    this.loadingBarBackground.visible = show;
    this.loadingBarFill.visible = show;
    this.transcribingText.visible = show;
    
    if (show) {
      // Position elements in view
      this.loadingBarBackground.position.set(0, 0.6, -2);
      this.loadingBarFill.position.set(0, 0.6, -1.99); // Slightly in front
      this.transcribingText.position.set(0, 0.75, -2);
      
      // Initialize loading progress
      this.loadingBarFill.userData.startTime = performance.now();
      this.loadingBarFill.scale.set(0, 1, 1); // Start with no width
    }
  }

  _showTranscript(text) {
    if (!this.transcriptDisplay) return;
    
    // Update canvas with new text
    const canvas = this.transcriptDisplay.material.map.image;
    const context = canvas.getContext('2d');
    
    // Clear canvas
    context.fillStyle = 'rgba(0, 0, 0, 0.8)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw text
    context.fillStyle = 'white';
    context.font = '24px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    
    // Word wrap for long text
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';
    
    for (const word of words) {
      const testLine = currentLine + (currentLine ? ' ' : '') + word;
      const metrics = context.measureText(testLine);
      if (metrics.width > canvas.width - 20 && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) {
      lines.push(currentLine);
    }
    
    // Draw lines
    const lineHeight = 30;
    const startY = (canvas.height - (lines.length - 1) * lineHeight) / 2;
    for (let i = 0; i < lines.length; i++) {
      context.fillText(lines[i], canvas.width / 2, startY + i * lineHeight);
    }
    
    // Update texture
    this.transcriptDisplay.material.map.needsUpdate = true;
    
    // Show transcript and position below voice indicator
    this.transcriptDisplay.visible = true;
    this.transcriptDisplay.position.set(0, 0.2, -2);
    
    // Hide transcript after 4 seconds
    setTimeout(() => {
      if (this.transcriptDisplay) {
        this.transcriptDisplay.visible = false;
      }
    }, 4000);
  }

  _updateVoiceUI(time) {
    // Animate loading bar progress
    if (this.loadingBarFill && this.loadingBarFill.visible) {
      const elapsed = (time - (this.loadingBarFill.userData.startTime || 0)) * 0.001;
      // Create a smooth back-and-forth loading animation
      const progress = (Math.sin(elapsed * 2) + 1) / 2; // Oscillate between 0 and 1
      this.loadingBarFill.scale.set(progress, 1, 1);
      
      // Add subtle color pulse to the loading bar
      const colorIntensity = 0.8 + Math.sin(elapsed * 4) * 0.2; // Pulse between 0.6 and 1.0
      this.loadingBarFill.material.opacity = colorIntensity;
    }
  }
}
