// forestWalkViz.js

import * as THREE from 'three';
import { VRButton } from './VRButton.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class ForestWalkVisualizer {
  constructor(container) {
    console.log('ForestWalkVisualizer constructor called with container:', container);
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
      },
      colors: {
        flowerColors: [0xff69b4, 0xffd700, 0x9370db, 0x00ced1, 0xff1493] // Keep for spawning flowers
      }
    };

    this.moveState = { forward: 0, right: 0 };
    this.lookState = { x: 0, y: 0 };
    this.keyboardEnabled = true;
    this.pointerLocked = false;
    this.inVR = false;

    this._initScene();
    this._addEventListeners();
    this._animate();

    // Enable WebXR
    this.renderer.xr.enabled = true;
    document.body.appendChild(VRButton.createButton(this.renderer));
  }

  _initScene() {
    console.log('_initScene called');
    this.scene = new THREE.Scene();
    console.log('Scene created:', this.scene);
    this.camera = new THREE.PerspectiveCamera(
      75,
      this.container.clientWidth / this.container.clientHeight,
      0.1,
      1000
    );
    console.log('Camera created:', this.camera);

    this.camera.rotation.order = 'YXZ';

    // Camera rig for VR support
    this.cameraRig = new THREE.Object3D();
    this.cameraRig.position.set(0, 1.6, 0); // standing height
    this.cameraRig.add(this.camera);
    this.scene.add(this.cameraRig);

    // Renderer setup - optimized for performance
    this.renderer = new THREE.WebGLRenderer({ 
      antialias: false, // disable for performance
      alpha: false,
      powerPreference: "high-performance"
    });
    console.log('Renderer created:', this.renderer);
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap; // use basic shadows for performance
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // limit pixel ratio
    this.container.appendChild(this.renderer.domElement);
    console.log('Renderer canvas appended to container');

    // Raycaster for interactions
    this.raycaster = new THREE.Raycaster();

    // Create mystical sky
    this._createSky();

    // Forest floor
    this._createForestFloor();

    // Lighting setup
    this._setupLighting();

    // VR event listeners
    this.renderer.xr.addEventListener('sessionstart', () => {
      this.cameraRig.position.y = 0; // zero height for VR
      this.inVR = true;
    });

    this.renderer.xr.addEventListener('sessionend', () => {
      this.cameraRig.position.y = 1.6;
      this.inVR = false;
    });

    // Audio context for ambient sounds
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }

  _createSky() {
    const skyGeometry = new THREE.SphereGeometry(500, 32, 32);
    skyGeometry.scale(-1, -1, 1); // invert normals

    // Black sky
    const skyMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000, // black sky
      side: THREE.BackSide,
      fog: false
    });

    this.skyDome = new THREE.Mesh(skyGeometry, skyMaterial);
    this.scene.add(this.skyDome);
  }

  _createForestFloor() {
    const floorGeometry = new THREE.PlaneGeometry(
      this.config.environment.size * 2,
      this.config.environment.size * 2,
      32, // reduced segments for performance
      32
    );
    
    // Add some variation to the floor
    const vertices = floorGeometry.attributes.position.array;
    for (let i = 0; i < vertices.length; i += 3) {
      vertices[i + 2] += Math.random() * 0.2 - 0.1; // reduced height variation
    }
    floorGeometry.attributes.position.needsUpdate = true;
    floorGeometry.computeVertexNormals();

    const floorMaterial = new THREE.MeshLambertMaterial({ // use Lambert for performance
      color: 0x228b22, // brighter forest green for clear day
    });

    this.forestFloor = new THREE.Mesh(floorGeometry, floorMaterial);
    this.forestFloor.rotation.x = -Math.PI / 2;
    this.forestFloor.receiveShadow = true;
    this.scene.add(this.forestFloor);
  }

  _setupLighting() {
    // Bright ambient light for clear morning
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5); // bright white ambient
    this.scene.add(ambientLight);

    // Bright morning sun (directional light)
    this.morningLight = new THREE.DirectionalLight(0xffffff, 1.0); // bright white sun
    this.morningLight.position.set(30, 60, 20); // higher angle for clear day
    this.morningLight.castShadow = true;
    this.morningLight.shadow.mapSize.width = 1024;
    this.morningLight.shadow.mapSize.height = 1024;
    this.morningLight.shadow.camera.near = 0.5;
    this.morningLight.shadow.camera.far = 200;
    this.morningLight.shadow.camera.left = -50;
    this.morningLight.shadow.camera.right = 50;
    this.morningLight.shadow.camera.top = 50;
    this.morningLight.shadow.camera.bottom = -50;
    this.scene.add(this.morningLight);

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
    const time = performance.now() * 0.001; // seconds
    const moveSpeed = 0.12; // slightly reduced for more controlled movement

    // Movement controls
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();

    const right = new THREE.Vector3();
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    const moveVector = new THREE.Vector3();
    moveVector.addScaledVector(forward, this.moveState.forward);
    moveVector.addScaledVector(right, this.moveState.right);
    moveVector.multiplyScalar(moveSpeed);

    this.cameraRig.position.add(moveVector);

    // Update held object animation
    this._updateHeldObject(time);

    this.renderer.setAnimationLoop(this._animate.bind(this));
    this.renderer.render(this.scene, this.camera);
  }

  // Method to adjust sky clarity (can be called externally)
  setSkyClarity(clarity) {
    // clarity: 0 = overcast, 1 = crystal clear
    const overcastBlue = new THREE.Color(0x87ceeb);
    const clearBlue = new THREE.Color(0x4a90e2);
    
    const skyColor = new THREE.Color().lerpColors(overcastBlue, clearBlue, clarity);
    
    if (this.skyDome?.material) {
      this.skyDome.material.color.copy(skyColor);
    }

    // Adjust lighting for clarity
    if (this.morningLight) {
      this.morningLight.intensity = 0.8 + clarity * 0.4; // brighter in clear weather
    }
  }

  // Method to add interactive elements (can be called externally)
  addMagicalElement(x, z) {
    const magicalGeometry = new THREE.SphereGeometry(0.5, 16, 12);
    const magicalMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.6
    });
    const magicalSphere = new THREE.Mesh(magicalGeometry, magicalMaterial);
    magicalSphere.position.set(x, 1, z);
    
    // Add pulsing animation
    magicalSphere.userData = { startTime: performance.now() };
    this.scene.add(magicalSphere);

    return magicalSphere;
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

    console.log('Forest visualization resized to:', this.container.clientWidth, 'x', this.container.clientHeight);
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
        // Fallback: create a simple geometric flower if GLB fails
        this._createFallbackFlower(spawnX, spawnZ);
      }
    );
  }

  // Fallback method to create a simple geometric flower if GLB loading fails
  _createFallbackFlower(x, z) {
    const flowerGroup = new THREE.Group();

    // Simple stem
    const stemGeometry = new THREE.CylinderGeometry(0.02, 0.02, 0.8, 8);
    const stemMaterial = new THREE.MeshLambertMaterial({ color: 0x228b22 });
    const stem = new THREE.Mesh(stemGeometry, stemMaterial);
    stem.position.y = 0.4;
    flowerGroup.add(stem);

    // Simple flower head
    const flowerGeometry = new THREE.SphereGeometry(0.15, 8, 6);
    const flowerMaterial = new THREE.MeshLambertMaterial({ color: 0xff69b4 });
    const flowerHead = new THREE.Mesh(flowerGeometry, flowerMaterial);
    flowerHead.position.y = 0.8;
    flowerGroup.add(flowerHead);

    flowerGroup.position.set(x, 0, z);
    
    this.loadedModels.push(flowerGroup);
    this.scene.add(flowerGroup);
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
      return;
    }
    
    this.isGenerating = true;
    this.promptMode = false;
    
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

      // Load and hold the object - prepend /api for frontend proxy
      const fullModelUrl = '/api' + data.model_url;
      await this._loadAndHoldObject(fullModelUrl);
      
    } catch (error) {
      console.error('Error generating object:', error);
      // Fallback: load a default object
      await this._loadAndHoldObject('/api/models/crystal.glb'); // Fallback object
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
          
          // Show instruction to spawn
          if (window.showMessage) {
            window.showMessage('Press G again to spawn the object, or move around to see it in your hand!');
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
}
