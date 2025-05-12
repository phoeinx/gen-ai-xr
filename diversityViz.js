// diversityViz.js

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.module.js';
// import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { VRButton } from './VRButton.js';

export class DiversityVisualizer {
  constructor(container) {
    this.lastUpdateTime = 0;
    this.updateInterval = 500; // milliseconds
    this.lastScrubProgress = null;

    this.snapshotData = [];
    this.snapshotReady = false;

    this.container = container;
    this.people = [];
    this.highlighted = null;
    this.mouse = new THREE.Vector2();
    this.lastProgress = 0;
    this.lastUpdateTime = 0;
    this.updateInterval = 100; // ms — adjust as needed
    this.lastScrubProgress = null;

    this.config = {
      clustering: {
        centerAttraction: 0.001,
        minSeparation: 2.0,
        attractionStrength: 0.25,
        repulsionStrength: 0.25,
        globalStrength: 0.1,
        damping: 0.55
      },
      raceColors: [0x588157, 0x3a7ca5, 0xef476f, 0xffc857],
      // raceLabels: ['Green', 'Blue', 'Red', 'Yellow'],
      raceLabels: ['White', 'Asian', 'Black', 'Hispanic / Other'],
      ageHeights: [0.2, 0.5, 1.0],
      // ageLabels: ['Young', 'Middle', 'Older'],
      ageLabels: ['0–19', '20–34', '35+'],
      // eduLabels: ['None', 'Medium', 'High'],
      eduLabels: ['< High School', 'High School / Some College', 'Bachelor or Above'],
      cols: 10,
      rows: 10,
      spacing: 2
    };

    this.config.clusterCenter = { x: 12, z: 0 }; // your chosen center

    this.firstNames = ['Alex', 'Jordan', 'Taylor', 'Casey', 'Morgan', 'Riley', 'Jamie', 'Robin', 'Sky', 'Devon'];
    this.lastNames = ['Lee', 'Garcia', 'Patel', 'Kim', 'Jordan', 'Nguyen', 'Smith', 'Chen', 'Hernandez', 'Okafor'];

    this.skyTopColorStart = new THREE.Color(0x87ceeb); // soft blue
    // set color to dark mid gray
    this.skyTopColorEnd = new THREE.Color(0x444444); // dark gray
    // this.skyTopColorEnd = new THREE.Color(0xa83232);   // intense red/orange

    this.corridorBounds = {
      xMin: -1,
      xMax: 1,
      zMin: -5,
      zMax: 5  // for now, not enforced but available
    };

    this.moveState = { forward: 0, right: 0 };
    this.lookState = { x: 0, y: 0 };
    this.keyboardEnabled = true;
    this.pointerLocked = false; // already in use
    this.inVR = false;

    this.totalPeople = this.config.cols * this.config.rows;
    this._initScene();
    this._initPeople();
    this._animate();
    this._addEventListeners();

    this.snapshotData = [];
    this.loadData().then(() => {
    console.log('Snapshot data loaded:', this.snapshotData.length, 'entries');
    this.snapshotReady = true;

    // Trigger initial update using progress = 0
    this.update(this.lastProgress || 0);
    });

    this.renderer.xr.enabled = true;
    document.body.appendChild(VRButton.createButton(this.renderer));
  }

  createBuildingArray({ centerX, centerZ, countX, countZ, spacing, irregularity }) {
    this.buildings = []; // store for future updates

    const startX = centerX - ((countX - 1) * spacing) / 2;
    const startZ = centerZ - ((countZ - 1) * spacing) / 2;

    for (let i = 0; i < countX; i++) {
      for (let j = 0; j < countZ; j++) {
        // Position
        const x = (startX + i * spacing) + (Math.random() - 0.2) * irregularity;
        // const x = startX + i * spacing;
        const z = startZ + j * spacing;

        // Irregular height and color
        const height = THREE.MathUtils.lerp(4, 7, irregularity * Math.random());
        const baseColor = new THREE.Color(Math.random(), Math.random(), Math.random());
        const visibleColor = new THREE.Color().lerpColors(
          baseColor,
          new THREE.Color(0x888888),
          1 - irregularity
        );

        const geometry = new THREE.BoxGeometry(1, height, 2.2);
        const material = new THREE.MeshStandardMaterial({ color: visibleColor });

        const building = new THREE.Mesh(geometry, material);
        building.position.set(x, height / 2, z); // place on ground
        this.scene.add(building);

        this.buildings.push({
          mesh: building,
          baseHeight: height,
          baseColor: baseColor
        });

      }
    }
  }


  _initScene() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      75,
      this.container.clientWidth / this.container.clientHeight,
      0.1,
      1000
    );

    this.camera.rotation.order = 'YXZ'; // yaw first, then pitch

    this.cameraRig = new THREE.Object3D();
    this.cameraRig.position.set(0, 1.6, 0); // seated height
    this.cameraRig.add(this.camera);
    this.scene.add(this.cameraRig);

    this.raycaster = new THREE.Raycaster();
    this.renderer = new THREE.WebGLRenderer();
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.container.appendChild(this.renderer.domElement);

    const skyGeometry = new THREE.SphereGeometry(100, 32, 32); // big enough to surround scene
    skyGeometry.scale(-1, -1, 1); // invert normals to render inside

    // Custom shader for vertical gradient
    const skyMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        topColor: { value: new THREE.Color(0x87ceeb) },   // sky blue
        bottomColor: { value: new THREE.Color(0xcccccc) }, // light gray ground tone
        offset: { value: 0.01 },
        exponent: { value: 0.6 }
      },
      vertexShader: `
        varying float vY;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vY = normalize(worldPosition.xyz).y;
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform float offset;
        uniform float exponent;
        varying float vY;
        void main() {
          float h = max(vY + offset, 0.0);
          h = pow(h, exponent);
          gl_FragColor = vec4(mix(bottomColor, topColor, h), 1.0);
        }
      `
    });

    this.skyDome = new THREE.Mesh(skyGeometry, skyMaterial);
    this.scene.add(this.skyDome);

    // this.skyDome.material.uniforms.topColor.value.set(0xffe0b2);   // peach
    // this.skyDome.material.uniforms.bottomColor.value.set(0x444444); // dark ground

    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.position.set(10, 10, 10);
    this.scene.add(light);
    this.scene.add(new THREE.AmbientLight(0x404040));

    this.createBuildingArray({
      centerX: -6,
      centerZ: 0,
      countX: 1,
      countZ: 24,
      spacing: 1.8,
      irregularity: 1.0 // maximum randomness at startup
    });

    const alleyWidth = 4;    // X direction (side-to-side)
    const alleyLength = 40;  // Z direction (forward-back)

    const alleyGeometry = new THREE.PlaneGeometry(alleyWidth, alleyLength);
    const alleyMaterial = new THREE.MeshStandardMaterial({
      color: 0x444444,
      side: THREE.DoubleSide,
      transparent: false
    });

    this.alleyPlane = new THREE.Mesh(alleyGeometry, alleyMaterial);

    // Rotate to lie flat on XZ plane
    this.alleyPlane.rotation.x = -Math.PI / 2;

    // Position it to match your clustering center (horizontally)
    const cx = 0;
    const cz = 0;
    this.alleyPlane.position.set(cx, 0.025, cz);

    this.scene.add(this.alleyPlane);

    const grassWidth = 900;
    const grassLength = 900;

    const grassGeometry = new THREE.PlaneGeometry(grassWidth, grassLength);
    const grassMaterial = new THREE.MeshStandardMaterial({
      color: 0x228B22, // forest green
      side: THREE.DoubleSide,
      transparent: false
      // opacity: 0.4
    });

    this.grassPlane = new THREE.Mesh(grassGeometry, grassMaterial);
    this.grassPlane.rotation.x = -Math.PI / 2;

    const cgx = this.config.clusterCenter.x;
    const cgz = this.config.clusterCenter.z;

    this.grassPlane.position.set(cgx - 6, 0, cgz); // 6 units left in X
    this.scene.add(this.grassPlane);

    const axesHelper = new THREE.AxesHelper(10);
    this.scene.add(axesHelper);

    this.renderer.xr.addEventListener('sessionstart', () => {
      this.inVR = true;
    });

    this.renderer.xr.addEventListener('sessionend', () => {
      this.inVR = false;
    });

    // --- Create a text sprite to show camera position ---
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.font = '28px monospace';
    ctx.fillText('User position: ', 10, 64);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture });
    this.positionLabel = new THREE.Sprite(material);
    // this.positionLabel.scale.set(4, 1, 1); // Size of the label
    this.positionLabel.scale.set(1.2, 0.4, 1);
    this.positionLabel.position.set(0, 2, -2); // Initial position in the scene
    this.camera.add(this.positionLabel);
    this.positionLabel.position.set(0, -0.3, -1.5); // In front of camera, slightly below eye level

    // --- Label for hovered person ---
    const hoverCanvas = document.createElement('canvas');
    hoverCanvas.width = 512;
    hoverCanvas.height = 256;
    const hoverCtx = hoverCanvas.getContext('2d');

    const hoverTexture = new THREE.CanvasTexture(hoverCanvas);
    const hoverMaterial = new THREE.SpriteMaterial({ map: hoverTexture, transparent: true });
    this.hoverLabel = new THREE.Sprite(hoverMaterial);
    this.hoverLabel.scale.set(3, 1.2, 1); // size of label
    this.hoverLabel.visible = false;
    this.scene.add(this.hoverLabel);

    const puckGeometry = new THREE.BoxGeometry(3.0, 0.05, 0.4);
    const puckMaterial = new THREE.MeshStandardMaterial({ color: 0xff8800 });
    this.sliderFollower = new THREE.Mesh(puckGeometry, puckMaterial);
    this.sliderFollower.position.set(0, 0.025, 0); // just above ground
    this.scene.add(this.sliderFollower);

    const puckCanvas = document.createElement('canvas');
    puckCanvas.width = 300;
    puckCanvas.height = 96;

    const puckCtx = puckCanvas.getContext('2d');
    puckCtx.fillStyle = 'white';
    puckCtx.font = '18px sans-serif';
    puckCtx.fillText('Corporate ownership: 0%', 10, 40);
    const puckLabelTexture = new THREE.CanvasTexture(puckCanvas);
    const puckLabelMaterial = new THREE.SpriteMaterial({ map: puckLabelTexture, transparent: true });
    this.puckLabel = new THREE.Sprite(puckLabelMaterial);
    this.puckLabel.scale.set(2, 0.6, 1);
    this.puckLabel.position.set(0, 1.0, 0); // floats above the puck
    this.sliderFollower.add(this.puckLabel); // attach to puck
  }

  _initPeople() {
    const { raceColors, ageHeights, cols, rows, spacing } = this.config;
    const finalDistribution = [0.9, 0.05, 0.03, 0.02];
    const finalCounts = finalDistribution.map(p => Math.floor(p * this.totalPeople));
    while (finalCounts.reduce((a, b) => a + b, 0) < this.totalPeople) finalCounts[0]++;

    const originalRaceIndices = Array.from({ length: this.totalPeople }, () => Math.floor(Math.random() * raceColors.length));

    const targetRaceIndices = [];
    finalCounts.forEach((count, raceIndex) => {
      for (let i = 0; i < count; i++) targetRaceIndices.push(raceIndex);
    });
    for (let i = targetRaceIndices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [targetRaceIndices[i], targetRaceIndices[j]] = [targetRaceIndices[j], targetRaceIndices[i]];
    }

    for (let i = 0; i < this.totalPeople; i++) {
      const ageIndex = Math.floor(Math.random() * ageHeights.length);
      const educationLevel = Math.floor(Math.random() * 3);
      const first = this.firstNames[i % this.firstNames.length];
      const last = this.lastNames[Math.floor(i / this.firstNames.length) % this.lastNames.length];
      const fullName = `${first} ${last}`;

      const centerX = this.config.clusterCenter.x;
      const centerZ = this.config.clusterCenter.z;

      const x = centerX + (i % cols - cols / 2) * spacing;
      const z = centerZ + (Math.floor(i / cols) - rows / 2) * spacing;
      this.people.push(new Person(i, originalRaceIndices[i], targetRaceIndices[i], ageIndex, 0, educationLevel, 2, x, z, fullName, this));
    }
  }

  async loadData() {
    const response = await fetch('./data/data_CDV.json'); // adjust path if needed
    const rawData = await response.json();

    // Sort by corp_own_rate (ascending)
    rawData.sort((a, b) => a.corp_own_rate - b.corp_own_rate);

    // Store full data
    this.snapshotData = rawData;
    this.snapshotReady = true;
    console.log('Snapshot data loaded:', this.snapshotData.length);
  }

  getInterpolatedSnapshot(progress) {
    if (!this.snapshotReady || !this.snapshotData || this.snapshotData.length === 0) {
      console.warn('Snapshot data not ready');
      return null;
    }

    const snapshots = this.snapshotData;
    const minRate = snapshots[0].corp_own_rate;
    const maxRate = snapshots[snapshots.length - 1].corp_own_rate;

    // Convert progress to corp_own_rate
    const targetRate = minRate + progress * (maxRate - minRate);

    // Find the two snapshots that bound this rate
    let lower = snapshots[0];
    let upper = snapshots[snapshots.length - 1];

    for (let i = 0; i < snapshots.length - 1; i++) {
      if (
        snapshots[i].corp_own_rate <= targetRate &&
        snapshots[i + 1].corp_own_rate >= targetRate
      ) {
        lower = snapshots[i];
        upper = snapshots[i + 1];
        break;
      }
    }

    const t = (targetRate - lower.corp_own_rate) / (upper.corp_own_rate - lower.corp_own_rate);

    // Interpolate all fields
    const result = {};
    for (const key in lower) {
      if (key === 'corp_own_rate') {
        result[key] = targetRate;
      } else {
        result[key] = lower[key] + (upper[key] - lower[key]) * t;
      }
    }

    return result;
  }

  getWeightedCategory(weights, personIndex, totalPeople) {
    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    const cumulative = [];
    let sum = 0;
    for (const key in weights) {
      sum += weights[key] / total;
      cumulative.push({ key, threshold: sum });
    }

    // Use a stable pseudo-random value per person
    const pseudoRandom = (personIndex + 1) / (totalPeople + 1);

    for (const entry of cumulative) {
      if (pseudoRandom <= entry.threshold) return entry.key;
    }
    return cumulative[cumulative.length - 1].key;
  }

  _animate() {
    const moveSpeed = 0.1;

    // Get forward direction from cameraRig (XZ only)
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();

    // Compute right vector correctly (Y is up)
    const right = new THREE.Vector3();
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    // Apply movement
    const moveVector = new THREE.Vector3();
    moveVector.addScaledVector(forward, this.moveState.forward);
    moveVector.addScaledVector(right, this.moveState.right);
    moveVector.multiplyScalar(moveSpeed);

    this.cameraRig.position.add(moveVector);

    // requestAnimationFrame(() => this._animate());
    this.renderer.setAnimationLoop(this._animate.bind(this));

    // this.raycaster.setFromCamera(this.mouse, this.camera);
    if (this.inVR || this.pointerLocked) {
      // Use center of screen (camera direction)
      const origin = new THREE.Vector3();
      const direction = new THREE.Vector3();

      this.camera.getWorldPosition(origin);
      this.camera.getWorldDirection(direction);

      this.raycaster.set(origin, direction);
    } else {
      // Use mouse coordinates (2D hover)
      this.raycaster.setFromCamera(this.mouse, this.camera);
    }

    const intersects = this.raycaster.intersectObjects(this.people.map(p => p.mesh));

    const target = intersects.length > 0
      ? this.people.find(p => p.mesh === intersects[0].object)
      : null;

    if (target !== this.highlighted) {
      // Un-highlight old one
      if (this.highlighted) {
        this.highlighted.mesh.material.emissive.setHex(0x000000);
      }

      this.highlighted = target;

      if (this.highlighted) {
        const data = this.highlighted.getDisplayData(this.lastProgress);
        const lines = [
          `Name: ${data.name}`,
          `Race: ${data.race}`,
          `Age: ${data.age}`,
          `Education: ${data.education}`,
          `Job: ${data.job}`
        ];
        // if (data.job) {
        //   lines.push(`Job: ${data.job}`);
        // }

        // Draw on canvas
        const canvas = this.hoverLabel.material.map.image;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'white';
        ctx.font = '28px monospace';
        lines.forEach((line, i) => {
          ctx.fillText(line, 10, 30 + i * 24);
        });
        this.hoverLabel.material.map.needsUpdate = true;

        // Position label slightly above person
        const pos = this.highlighted.mesh.position.clone();
        pos.y += 2;
        this.hoverLabel.position.copy(pos);
        this.hoverLabel.lookAt(this.camera.position);
        this.hoverLabel.visible = true;

      } else {
        this.hoverLabel.visible = false;
      }

      // Highlight new one
      if (this.highlighted) {
        this.highlighted.mesh.material.emissive.setHex(0x444444);
        const data = this.highlighted.getDisplayData(this.lastProgress);
        window.parent.postMessage({ type: 'hover-info', data }, '*');
      } else {
        window.parent.postMessage({ type: 'hover-info', data: null }, '*');
      }
    }

    this.people.forEach(p => p.applyClusteringForce(this.lastProgress));

    // --- Update user camera position and show it on the label ---

    const camPos = new THREE.Vector3();
    this.camera.getWorldPosition(camPos);

    const inCorridor = (
      camPos.x >= this.corridorBounds.xMin &&
      camPos.x <= this.corridorBounds.xMax
    );

    // If in corrider, Z driver ownership
    const now = performance.now();

    if (inCorridor) {
      // Clamp and normalize Z to [0, 1]
      const z = this.sliderFollower.position.z;
      const progress = (z - this.corridorBounds.zMin) / (this.corridorBounds.zMax - this.corridorBounds.zMin);

      const progressChanged = Math.abs(progress - (this.lastScrubProgress ?? -1)) > 0.001;

      if (now - this.lastUpdateTime > this.updateInterval && progressChanged) {
        this.update(progress);
        this.lastUpdateTime = now;
        this.lastScrubProgress = progress;

        if (this.snapshotReady && this.currentSnapshot) {
          const canvas = this.puckLabel.material.map.image;
          const ctx = canvas.getContext('2d');
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          const corpRate = Math.round(this.currentSnapshot.corp_own_rate);
          const isObserved = corpRate <= 30;

          const color = isObserved ? 'limegreen' : 'orange';
          const labelLines = [
            isObserved ? 'observed' : 'simulated',
            'corporate ownership',
            `${corpRate}%`
          ];

          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = color;
          ctx.font = '16px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          labelLines.forEach((line, i) => {
            ctx.fillText(line, canvas.width / 2, 20 + i * 24);
          });

          this.puckLabel.material.map.needsUpdate = true;
        }
      }

      this.scrubStatus = `ACTIVE`;
      this.scrubProgress = progress;
    } else {
      this.scrubStatus = `FROZEN`;
    }

    if (this.scrubStatus === 'ACTIVE') {
      const targetZ = THREE.MathUtils.clamp(camPos.z, this.corridorBounds.zMin, this.corridorBounds.zMax);
      const currentZ = this.sliderFollower.position.z;

      const damping = 0.01; // smaller = smoother/slower
      const newZ = THREE.MathUtils.lerp(currentZ, targetZ, damping);

      this.sliderFollower.position.z = newZ;
    }

    const canvas = this.positionLabel.material.map.image;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'white';
    ctx.font = '28px monospace';
    ctx.fillText(`X: ${camPos.x.toFixed(2)}`, 10, 40);
    ctx.fillText(`Y: ${camPos.y.toFixed(2)}`, 10, 70);
    ctx.fillText(`Z: ${camPos.z.toFixed(2)}`, 10, 100);
    ctx.fillText(`Mode: ${this.scrubStatus}`, 10, 130);
    if (this.scrubStatus === 'ACTIVE') {
      ctx.fillText(`Corporate ownership: ${this.scrubProgress.toFixed(2)}`, 10, 160);
    }

    this.positionLabel.material.map.needsUpdate = true;

    this.renderer.render(this.scene, this.camera);
  }

  _addEventListeners() {
    document.addEventListener('keydown', (e) => {
      if (!this.keyboardEnabled) return;
      if (e.code === 'KeyW') this.moveState.forward = 1;
      if (e.code === 'KeyS') this.moveState.forward = -1;
      if (e.code === 'KeyA') this.moveState.right = -1;
      if (e.code === 'KeyD') this.moveState.right = 1;
    });

    document.addEventListener('keyup', (e) => {
      if (e.code === 'KeyW' && this.moveState.forward === 1) this.moveState.forward = 0;
      if (e.code === 'KeyS' && this.moveState.forward === -1) this.moveState.forward = 0;
      if (e.code === 'KeyA' && this.moveState.right === -1) this.moveState.right = 0;
      if (e.code === 'KeyD' && this.moveState.right === 1) this.moveState.right = 0;
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked || !this.keyboardEnabled) return;
      const sensitivity = 0.002;
      this.cameraRig.rotation.y -= e.movementX * sensitivity; // yaw
      this.camera.rotation.x -= e.movementY * sensitivity;    // pitch (look up/down)

      // Clamp vertical rotation to prevent flipping
      this.camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.camera.rotation.x));
    });

    // Enable pointer lock on click
    this.renderer.domElement.addEventListener('click', () => {
      this.renderer.domElement.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.renderer.domElement;
    });

    window.addEventListener("mousemove", event => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    });
  }

  update(progress) {
    const snapshot = this.getInterpolatedSnapshot(progress);
    if (!snapshot) return; // wait until data is loaded
    this.lastProgress = progress;

    if (this.skyDome?.material?.uniforms?.topColor) {
      if (this.skyTopColorStart && this.skyTopColorEnd) {
        const skyColor = new THREE.Color();
        skyColor.lerpColors(this.skyTopColorStart, this.skyTopColorEnd, progress);
        this.skyDome.material.uniforms.topColor.value.copy(skyColor);
      } else { // default to blue
        this.skyDome.material.uniforms.topColor.value.set(0x87ceeb);
        console.warn('Sky dome colors not set');
      }
    }

    this.currentSnapshot = snapshot;
    const totalPeople = this.people.length;

    if (this.buildings?.length) {
      const uniformity = progress; // 0 = random, 1 = uniform
      // const baseColor = new THREE.Color(0x888888);

      for (const { mesh, baseHeight, baseColor } of this.buildings) {
        const h = THREE.MathUtils.lerp(baseHeight, 6, uniformity);
        mesh.scale.y = h / mesh.geometry.parameters.height;
        mesh.position.y = h / 2;

        // const currentColor = new THREE.Color().lerpColors(
        //   new THREE.Color(
        //     Math.random() * (1 - uniformity),
        //     Math.random() * (1 - uniformity),
        //     Math.random() * (1 - uniformity)
        //   ),
        //   baseColor,
        //   uniformity
        // );
        const gray = new THREE.Color(0x888888);
        const currentColor = new THREE.Color().lerpColors(
          baseColor,
          gray,
          uniformity
        );
        // console.log('Uniformity (progress):', uniformity);
        mesh.material.color.copy(currentColor);
      }
    }

    for (let i = 0; i < totalPeople; i++) {
      const person = this.people[i];

      // Race
      const raceChoice = this.getWeightedCategory({
        White: snapshot.White,
        Asian: snapshot.Asian,
        Black: snapshot.Black,
        Hispanic: snapshot.Hispanic,
        Other: snapshot.Other
      }, i, totalPeople);

      const raceIndexMap = {
        White: 0,
        Asian: 1,
        Black: 2,
        Hispanic: 3,
        Other: 3 // reuse 3 for both Hispanic/Other in your 4-color system
      };
      person.targetRace = raceIndexMap[raceChoice];

      // Age
      const ageChoice = this.getWeightedCategory({
        'Age_0_19': snapshot['Age_0_19'],
        'Age_20_34': snapshot['Age_20_34'],
        'Age_35_54': snapshot['Age_35_54'],
        'Age_55_plus': snapshot['Age_55_plus']
      }, i, totalPeople);

      const ageIndexMap = {
        'Age_0_19': 0,
        'Age_20_34': 1,
        'Age_35_54': 2,
        'Age_55_plus': 2  // group 35+ as "Older"
      };
      person.targetAgeIndex = ageIndexMap[ageChoice];

      // Education
      const eduChoice = this.getWeightedCategory({
        Edu_Below_High_School: snapshot.Edu_Below_High_School,
        Edu_High_School: snapshot.Edu_High_School,
        Edu_Some_College: snapshot.Edu_Some_College,
        Edu_Bachelor_or_Above: snapshot.Edu_Bachelor_or_Above
      }, i, totalPeople);

      const eduIndexMap = {
        Edu_Below_High_School: 0,
        Edu_High_School: 1,
        Edu_Some_College: 1,
        Edu_Bachelor_or_Above: 2
      };
      person.targetEducationLevel = eduIndexMap[eduChoice];

      // Job category
      // console.log('Snapshot job fields:', snapshot.Job_Technology, snapshot.Job_Corporate, snapshot.Job_Healthcare);
      const jobChoice = this.getWeightedCategory({
        Job_Technology: snapshot.Job_Technology,
        Job_Corporate: snapshot.Job_Corporate,
        Job_Healthcare: snapshot.Job_Healthcare,
        Job_Construction: snapshot.Job_Construction,
        Job_Hospitality: snapshot.Job_Hospitality,
        Job_Repair_Tech: snapshot.Job_Repair_Tech
      }, i, totalPeople);

      person.targetJobCategory = jobChoice;  // store full label
      // console.log(`Assigned job to person ${i}: ${jobChoice}`);

      person.update(progress); // update mesh
    }

  }
}

class Person {
  constructor(index, originalRace, targetRace, ageIndex, targetAgeIndex, educationLevel, targetEducationLevel, x, z, name, viz) {
    this.name = name;
    this.index = index;
    this.originalRace = originalRace;
    this.targetRace = targetRace;
    this.ageIndex = ageIndex;
    this.targetAgeIndex = targetAgeIndex;
    this.educationLevel = educationLevel;
    this.targetEducationLevel = targetEducationLevel;
    this.viz = viz;

    this.x = x;
    this.z = z;
    this.velocity = new THREE.Vector2();
    this.position2D = new THREE.Vector2(x, z);
    this.originalPosition = this.position2D.clone();

    const geometry = new THREE.CylinderGeometry(0.5, 0.5, 0.2, 32);
    const material = new THREE.MeshStandardMaterial({ color: viz.config.raceColors[this.originalRace], emissive: 0x000000 });
    this.mesh = new THREE.Mesh(geometry, material);
    viz.scene.add(this.mesh);

    this.eduMesh = this.createEducationMesh(this.educationLevel);
    viz.scene.add(this.eduMesh);
  }

createEducationMesh(level) {
  const emojiMap = ['‍🏭', '✏️', '🎓'];
  const emoji = emojiMap[level] || '❓';

  const size = 48;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // 🔥 No background fill — fully transparent canvas
  ctx.clearRect(0, 0, size, size);

  ctx.font = '26px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = 'black'; // or 'white' if the emoji is too dark
  ctx.fillText(emoji, size / 2, size / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.5, 0.5, 0.5);

  return sprite;
}

  applyClusteringForce(progress) {
    const cfg = this.viz.config.clustering;
    const pos = this.position2D;
    const vel = this.velocity;
    let force = new THREE.Vector2();
    const strength = progress * cfg.globalStrength;

    for (const other of this.viz.people) {
      if (other === this) continue;
      const delta = other.position2D.clone().sub(pos);
      const dist = delta.length();
      const distSq = dist * dist + 0.01;
      const dir = delta.normalize();

      if (dist < cfg.minSeparation) {
        force.sub(dir.multiplyScalar(0.1 * (cfg.minSeparation - dist)));
        continue;
      }
      if (other.originalRace === this.originalRace) {
        force.add(dir.multiplyScalar(cfg.attractionStrength * strength / distSq));
      } else {
        force.sub(dir.multiplyScalar(cfg.repulsionStrength * strength / distSq));
      }
    }

    // const toCenter = new THREE.Vector2(10, -5).sub(pos);
    const center = new THREE.Vector2(
      this.viz.config.clusterCenter.x,
      this.viz.config.clusterCenter.z
    );
    const toCenter = center.clone().sub(pos);
    force.add(toCenter.multiplyScalar(cfg.centerAttraction));

    vel.add(force);
    vel.multiplyScalar(cfg.damping);
    pos.add(vel);

    this.x = pos.x;
    this.z = pos.y;
    this.mesh.position.set(this.x, this.getHeight() / 2, this.z);
    this.eduMesh.position.set(this.x, this.getHeight() + 0.1, this.z);
  }

  update(progress) {
    const threshold = this.index / this.viz.totalPeople;
    const raceIndex = progress >= threshold ? this.targetRace : this.originalRace;
    const ageIndex = progress >= threshold ? this.targetAgeIndex : this.ageIndex;
    const eduLevel = progress >= threshold ? this.targetEducationLevel : this.educationLevel;

    const height = this.viz.config.ageHeights[ageIndex];
    this.mesh.material.color.setHex(this.viz.config.raceColors[raceIndex]);
    this.mesh.scale.y = height / 0.2;
    this.mesh.position.y = height / 2;

    this.viz.scene.remove(this.eduMesh);
    this.eduMesh = this.createEducationMesh(eduLevel);
    this.eduMesh.position.set(this.x, height + 0.1, this.z);
    this.viz.scene.add(this.eduMesh);
  }

  getHeight() {
    return this.viz.config.ageHeights[this.ageIndex];
  }

  getDisplayData(progress = 0) {
    const threshold = this.index / this.viz.totalPeople;

    const raceIndex = progress >= threshold ? this.targetRace : this.originalRace;
    const ageIndex = progress >= threshold ? this.targetAgeIndex : this.ageIndex;
    const eduLevel = progress >= threshold ? this.targetEducationLevel : this.educationLevel;

    const { raceLabels, ageLabels, eduLabels } = this.viz.config;

    // console.log(`Person ${this.index} job:`, this.targetJobCategory);
    return {
      // index: this.index,
      name: this.name,
      race: raceLabels[raceIndex],
      age: ageLabels[ageIndex],
      education: eduLabels[eduLevel],
      job: this.targetJobCategory?.replace('Job_', '').replace('_', ' ') || 'Unknown'
    };
  }

} 
