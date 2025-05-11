// diversityViz.js

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.module.js';
// import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { VRButton } from './VRButton.js';

export class DiversityVisualizer {
  constructor(container) {
    this.lastUpdateTime = 0;
    this.updateInterval = 500; // milliseconds
    this.lastScrubProgress = null;

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
      raceLabels: ['Green', 'Blue', 'Red', 'Yellow'],
      ageHeights: [0.2, 0.5, 1.0],
      ageLabels: ['Young', 'Middle', 'Older'],
      eduLabels: ['None', 'Medium', 'High'],
      cols: 10,
      rows: 10,
      spacing: 2
    };

    this.corridorBounds = {
      xMin: -2,
      xMax: 2,
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
    });

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

    this.camera.rotation.order = 'YXZ'; // yaw first, then pitch

    this.cameraRig = new THREE.Object3D();
    this.cameraRig.position.set(0, 1.6, 0); // seated height
    this.cameraRig.add(this.camera);
    this.scene.add(this.cameraRig);

    this.raycaster = new THREE.Raycaster();
    this.renderer = new THREE.WebGLRenderer();
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.container.appendChild(this.renderer.domElement);

    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.position.set(10, 10, 10);
    this.scene.add(light);
    this.scene.add(new THREE.AmbientLight(0x404040));

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
    hoverCanvas.height = 128;
    const hoverCtx = hoverCanvas.getContext('2d');

    const hoverTexture = new THREE.CanvasTexture(hoverCanvas);
    const hoverMaterial = new THREE.SpriteMaterial({ map: hoverTexture, transparent: true });
    this.hoverLabel = new THREE.Sprite(hoverMaterial);
    this.hoverLabel.scale.set(3, 1, 1); // size of label
    this.hoverLabel.visible = false;
    this.scene.add(this.hoverLabel);

    const puckGeometry = new THREE.BoxGeometry(3.0, 0.05, 0.4);
    const puckMaterial = new THREE.MeshStandardMaterial({ color: 0xff8800 });
    this.sliderFollower = new THREE.Mesh(puckGeometry, puckMaterial);
    this.sliderFollower.position.set(0, 0.025, 0); // just above ground
    this.scene.add(this.sliderFollower);
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
      const x = (i % cols - cols / 2) * spacing;
      const z = (Math.floor(i / cols) - rows / 2) * spacing;
      this.people.push(new Person(i, originalRaceIndices[i], targetRaceIndices[i], ageIndex, 0, educationLevel, 2, x, z, this));
    }
  }

  async loadData() {
    const response = await fetch('./data/data_CDV.json'); // adjust path if needed
    const rawData = await response.json();

    // Sort by corp_own_rate (ascending)
    rawData.sort((a, b) => a.corp_own_rate - b.corp_own_rate);

    // Store full data
    this.snapshotData = rawData;
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
        const data = this.highlighted.getDisplayData();
        const lines = [
          `ID: ${data.index}`,
          `Race: ${data.race}`,
          `Age: ${data.age}`,
          `Education: ${data.education}`
        ];

        // Draw on canvas
        const canvas = this.hoverLabel.material.map.image;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'white';
        ctx.font = '28px monospace';
        lines.forEach((line, i) => {
          ctx.fillText(line, 10, 40 + i * 30);
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
        const data = this.highlighted.getDisplayData();
        window.parent.postMessage({ type: 'hover-info', data }, '*');
      } else {
        window.parent.postMessage({ type: 'hover-info', data: null }, '*');
      }
    }

    this.people.forEach(p => p.applyClusteringForce(this.lastProgress));

    // --- Update user camera position and show it on the label ---
    // const camPos = this.camera.position;

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
      // const z = THREE.MathUtils.clamp(camPos.z, this.corridorBounds.zMin, this.corridorBounds.zMax);
      // const progress = (z - this.corridorBounds.zMin) / (this.corridorBounds.zMax - this.corridorBounds.zMin);
      const z = this.sliderFollower.position.z;
      const progress = (z - this.corridorBounds.zMin) / (this.corridorBounds.zMax - this.corridorBounds.zMin);

      const progressChanged = Math.abs(progress - (this.lastScrubProgress ?? -1)) > 0.001;

      if (now - this.lastUpdateTime > this.updateInterval && progressChanged) {
        this.update(progress);
        this.lastUpdateTime = now;
        this.lastScrubProgress = progress;
      }

      this.scrubStatus = `ACTIVE`;
      this.scrubProgress = progress;
    } else {
      this.scrubStatus = `FROZEN`;
    }

    if (this.scrubStatus === 'ACTIVE') {
      const targetZ = THREE.MathUtils.clamp(camPos.z, this.corridorBounds.zMin, this.corridorBounds.zMax);
      const currentZ = this.sliderFollower.position.z;

      const damping = 0.1; // smaller = smoother/slower
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
      ctx.fillText(`Ownership: ${this.scrubProgress.toFixed(2)}`, 10, 160);
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

    // document.addEventListener('mousemove', (e) => {
    //   if (!this.pointerLocked || !this.keyboardEnabled) return;
    //   const sensitivity = 0.002;
    //   this.cameraRig.rotation.y -= e.movementX * sensitivity; // Yaw only (no pitch)
    // });


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
    this.lastProgress = progress;
    this.people.forEach(p => p.update(progress));
  }
}

class Person {
  constructor(index, originalRace, targetRace, ageIndex, targetAgeIndex, educationLevel, targetEducationLevel, x, z, viz) {
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

  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // 🔥 No background fill — fully transparent canvas
  ctx.clearRect(0, 0, size, size);

  ctx.font = '96px serif';
  // ctx.font = '48px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
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

    const toCenter = new THREE.Vector2(0, 0).sub(pos);
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

  getDisplayData() {
    const { raceLabels, ageLabels, eduLabels } = this.viz.config;
    return {
      index: this.index,
      race: raceLabels[this.originalRace],
      age: ageLabels[this.ageIndex],
      education: eduLabels[this.educationLevel]
    };
  }
} 
