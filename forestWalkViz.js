// forestWalkViz.js

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.module.js';
import { VRButton } from './VRButton.js';

export class ForestWalkVisualizer {
  constructor(container) {
    this.container = container;
    this.trees = [];
    this.flowers = [];
    this.fireflies = [];
    this.mouse = new THREE.Vector2();
    
    this.config = {
      forest: {
        size: 150, // reduced forest size for better performance
        treeCount: 80, // reduced tree count for performance
        flowerCount: 50, // reduced flower count
        fireflyCount: 15 // reduced firefly count for performance
      },
      colors: {
        treeColors: [0x2d5016, 0x1a3009, 0x3d6b1a, 0x4a7c23],
        trunkColors: [0x8b4513, 0x654321, 0x5d4037, 0x6d4c41],
        flowerColors: [0xff69b4, 0xffd700, 0x9370db, 0x00ced1, 0xff1493]
      }
    };

    this.moveState = { forward: 0, right: 0 };
    this.lookState = { x: 0, y: 0 };
    this.keyboardEnabled = true;
    this.pointerLocked = false;
    this.inVR = false;

    this._initScene();
    this._createForest();
    this._addEventListeners();
    this._animate();

    // Enable WebXR
    this.renderer.xr.enabled = true;
    document.body.appendChild(VRButton.createButton(this.renderer));
  }

  _initScene() {
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

    // Renderer setup - optimized for performance
    this.renderer = new THREE.WebGLRenderer({ 
      antialias: false, // disable for performance
      alpha: false,
      powerPreference: "high-performance"
    });
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap; // use basic shadows for performance
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // limit pixel ratio
    this.container.appendChild(this.renderer.domElement);

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
      this.config.forest.size * 2,
      this.config.forest.size * 2,
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

  _createForest() {
    this._createTrees();
    this._createFlowers();
    this._createFireflies();
  }

  _createTrees() {
    const { treeCount, size } = this.config.forest;
    const { treeColors, trunkColors } = this.config.colors;

    for (let i = 0; i < treeCount; i++) {
      const x = (Math.random() - 0.5) * size * 2;
      const z = (Math.random() - 0.5) * size * 2;
      
      // Skip area around spawn point
      if (Math.sqrt(x * x + z * z) < 5) {
        continue;
      }

      const tree = this._createSingleTree(x, z, treeColors, trunkColors);
      this.trees.push(tree);
      this.scene.add(tree);
    }
  }

  _createSingleTree(x, z, treeColors, trunkColors) {
    const treeGroup = new THREE.Group();

    // Trunk - bigger and more realistic
    const trunkHeight = THREE.MathUtils.randFloat(15, 25); // much taller
    const trunkRadius = THREE.MathUtils.randFloat(0.8, 1.5); // thicker
    const trunkGeometry = new THREE.CylinderGeometry(
      trunkRadius * 0.8, 
      trunkRadius * 1.3, 
      trunkHeight, 
      12, // more segments for rounder trunk
      3 // height segments for texture
    );
    
    // Add bark texture variation
    const trunkMaterial = new THREE.MeshLambertMaterial({ // Lambert for performance
      color: trunkColors[Math.floor(Math.random() * trunkColors.length)],
    });
    
    const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
    trunk.position.y = trunkHeight / 2;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    treeGroup.add(trunk);

    // Canopy - bigger and more realistic with multiple layers
    const canopyLayers = Math.floor(Math.random() * 2) + 3; // 3-4 layers
    for (let layer = 0; layer < canopyLayers; layer++) {
      const layerProgress = layer / (canopyLayers - 1);
      const canopyRadius = THREE.MathUtils.randFloat(8, 15) * (1 - layerProgress * 0.4); // much larger
      const canopyHeight = THREE.MathUtils.randFloat(4, 8) * (1 - layerProgress * 0.3); // taller canopy
      
      // Use lower detail for performance but still look good
      const canopyGeometry = new THREE.ConeGeometry(canopyRadius, canopyHeight, 12, 2); 
      const canopyMaterial = new THREE.MeshLambertMaterial({ // Lambert for performance
        color: treeColors[Math.floor(Math.random() * treeColors.length)],
      });
      
      const canopy = new THREE.Mesh(canopyGeometry, canopyMaterial);
      canopy.position.y = trunkHeight + layer * (canopyHeight * 0.4) - canopyHeight * 0.2;
      canopy.castShadow = true;
      canopy.receiveShadow = true;
      
      // Add slight random offset for more natural look
      canopy.position.x += (Math.random() - 0.5) * 2;
      canopy.position.z += (Math.random() - 0.5) * 2;
      
      treeGroup.add(canopy);
    }

    // Add some branch details for realism
    const branchCount = Math.floor(Math.random() * 3) + 2;
    for (let i = 0; i < branchCount; i++) {
      const branchLength = THREE.MathUtils.randFloat(3, 6);
      const branchThickness = 0.1;
      const branchGeometry = new THREE.CylinderGeometry(branchThickness, branchThickness * 0.5, branchLength, 6);
      const branchMaterial = new THREE.MeshLambertMaterial({
        color: trunkColors[Math.floor(Math.random() * trunkColors.length)]
      });
      
      const branch = new THREE.Mesh(branchGeometry, branchMaterial);
      const branchHeight = trunkHeight * 0.6 + Math.random() * trunkHeight * 0.3;
      const angle = (i / branchCount) * Math.PI * 2 + Math.random() * 0.5;
      
      branch.position.set(
        Math.cos(angle) * trunkRadius * 1.2,
        branchHeight,
        Math.sin(angle) * trunkRadius * 1.2
      );
      branch.rotation.z = Math.cos(angle) * 0.3;
      branch.rotation.x = Math.sin(angle) * 0.3;
      
      treeGroup.add(branch);
    }

    treeGroup.position.set(x, 0, z);
    
    // Add slight random rotation
    treeGroup.rotation.y = Math.random() * Math.PI * 2;
    
    return treeGroup;
  }

  _createFlowers() {
    const { flowerCount, size } = this.config.forest;
    const { flowerColors } = this.config.colors;

    for (let i = 0; i < flowerCount; i++) {
      const x = (Math.random() - 0.5) * size * 2;
      const z = (Math.random() - 0.5) * size * 2;

      const flower = this._createSingleFlower(x, z, flowerColors);
      this.flowers.push(flower);
      this.scene.add(flower);
    }
  }

  _createSingleFlower(x, z, flowerColors) {
    const flowerGroup = new THREE.Group();

    // Stem - simplified
    const stemHeight = THREE.MathUtils.randFloat(0.5, 1.2);
    const stemGeometry = new THREE.CylinderGeometry(0.02, 0.02, stemHeight, 4);
    const stemMaterial = new THREE.MeshLambertMaterial({ color: 0x228b22 }); // Lambert for performance
    const stem = new THREE.Mesh(stemGeometry, stemMaterial);
    stem.position.y = stemHeight / 2;
    flowerGroup.add(stem);

    // Single flower head instead of multiple petals for performance
    const flowerGeometry = new THREE.SphereGeometry(0.15, 6, 4); // lower detail
    const petalColor = flowerColors[Math.floor(Math.random() * flowerColors.length)];
    const flowerMaterial = new THREE.MeshLambertMaterial({
      color: petalColor,
      emissive: petalColor,
      emissiveIntensity: 0.1 // reduced glow for performance
    });
    const flowerHead = new THREE.Mesh(flowerGeometry, flowerMaterial);
    flowerHead.position.y = stemHeight;
    flowerGroup.add(flowerHead);

    flowerGroup.position.set(x, 0, z);
    return flowerGroup;
  }

  _createFireflies() {
    const { fireflyCount, size } = this.config.forest;

    for (let i = 0; i < fireflyCount; i++) {
      const firefly = this._createSingleFirefly(size);
      this.fireflies.push(firefly);
      this.scene.add(firefly);
    }
  }

  _createSingleFirefly(size) {
    const fireflyGroup = new THREE.Group();

    // Simplified glowing sphere - more like morning dew drops
    const glowGeometry = new THREE.SphereGeometry(0.06, 6, 4); // smaller
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0xffeb3b, // warm yellow for morning
      transparent: true,
      opacity: 0.6 // more subtle in morning light
    });
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    fireflyGroup.add(glow);

    // Smaller point light for morning fireflies (they're less bright in daylight)
    const light = new THREE.PointLight(0xffeb3b, 0.15, 2); // dimmer yellowish light
    fireflyGroup.add(light);

    // Random starting position
    fireflyGroup.position.set(
      (Math.random() - 0.5) * size * 1.5, // reduced range
      Math.random() * 6 + 2, // lower height
      (Math.random() - 0.5) * size * 1.5
    );

    // Animation properties
    fireflyGroup.userData = {
      originalPosition: fireflyGroup.position.clone(),
      phase: Math.random() * Math.PI * 2,
      speed: THREE.MathUtils.randFloat(0.3, 1.0), // slower for performance
      amplitude: THREE.MathUtils.randFloat(1, 4) // smaller range
    };

    return fireflyGroup;
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

    // Animate fireflies - reduced frequency for performance
    if (Math.floor(time * 10) % 2 === 0) { // animate every other frame
      this.fireflies.forEach(firefly => {
        const { originalPosition, phase, speed, amplitude } = firefly.userData;
        const currentPhase = phase + time * speed;
        
        firefly.position.x = originalPosition.x + Math.sin(currentPhase) * amplitude;
        firefly.position.y = originalPosition.y + Math.sin(currentPhase * 1.2) * 1.5;
        firefly.position.z = originalPosition.z + Math.cos(currentPhase * 0.7) * amplitude;

        // Simplified morning light flicker
        const light = firefly.children.find(child => child.isPointLight);
        if (light) {
          light.intensity = 0.1 + Math.sin(currentPhase * 3) * 0.05; // very subtle morning glow
        }
      });
    }

    // Simplified wind effect on flowers - less frequent updates
    if (Math.floor(time * 5) % 3 === 0) { // update every third frame
      this.flowers.forEach((flower, index) => {
        const windPhase = time * 1.5 + index * 0.3;
        flower.rotation.z = Math.sin(windPhase) * 0.05; // reduced movement
      });
    }

    // Less frequent ambient sounds
    if (Math.random() < 0.0005) { // even rarer chance
      this._playForestSound();
    }

    this.renderer.setAnimationLoop(this._animate.bind(this));
    this.renderer.render(this.scene, this.camera);
  }

  _playForestSound() {
    const ctx = this.audioCtx;
    const now = ctx.currentTime;

    // Create a gentle nature sound
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(THREE.MathUtils.randFloat(200, 400), now);

    gainNode.gain.setValueAtTime(0.05, now);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 2);

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.start(now);
    oscillator.stop(now + 2);
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
    
    // Create and add the flower
    const flower = this._createSingleFlower(spawnX, spawnZ, this.config.colors.flowerColors);
    this.flowers.push(flower);
    this.scene.add(flower);
    
    // Optional: Add a subtle spawn effect
    this._createSpawnEffect(spawnX, spawnZ);
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
}
