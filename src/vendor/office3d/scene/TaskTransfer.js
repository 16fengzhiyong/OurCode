import * as THREE from 'three';
import gsap from 'gsap';

/**
 * 3D Parabolic Task / File Transfer System
 * Documents & data payloads fly along smooth 3D Bezier curves between workstations with
 * dynamic particle trails and landing impact ripples. Characters remain in their seats!
 */
export class TaskTransferManager {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.activeTransfers = [];
  }

  /**
   * Launch a 3D File Transfer between two workstations
   * @param {Object} fromAgent - sender agent config
   * @param {Object} toAgent - recipient agent config
   * @param {Function} onComplete - callback when file arrives
   */
  launchTransfer(fromAgent, toAgent, onComplete) {
    const startX = fromAgent.deskPos.x;
    const startZ = fromAgent.deskPos.z;
    const endX = toAgent.deskPos.x;
    const endZ = toAgent.deskPos.z;

    const p0 = new THREE.Vector3(startX, 1.3, startZ);
    const p2 = new THREE.Vector3(endX, 1.3, endZ);

    const dist = p0.distanceTo(p2);
    const arcHeight = Math.max(3.0, dist * 0.45);
    const p1 = new THREE.Vector3(
      (startX + endX) / 2,
      1.3 + arcHeight,
      (startZ + endZ) / 2
    );

    // Create 3D Holographic File Mesh
    const fileGroup = new THREE.Group();

    // 1. Glowing Document Folder / Envelope
    const folderGeo = new THREE.BoxGeometry(0.55, 0.08, 0.42);
    const folderMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 1.2,
      roughness: 0.2,
      metalness: 0.1,
    });
    const folder = new THREE.Mesh(folderGeo, folderMat);
    fileGroup.add(folder);

    // 2. White Paper Sheets inside
    const sheetGeo = new THREE.BoxGeometry(0.48, 0.04, 0.38);
    const sheetMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const sheet = new THREE.Mesh(sheetGeo, sheetMat);
    sheet.position.y = 0.03;
    fileGroup.add(sheet);

    // 3. Orbiting Holographic Energy Ring
    const ringGeo = new THREE.TorusGeometry(0.38, 0.015, 6, 18);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x67e8f9 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    fileGroup.add(ring);

    // 4. Point Light on the flying payload
    const payloadLight = new THREE.PointLight(0x38bdf8, 2.0, 4);
    fileGroup.add(payloadLight);

    fileGroup.position.copy(p0);
    this.group.add(fileGroup);

    // 5. Particle Trail Mesh
    const trailCount = 20;
    const trailPositions = new Float32Array(trailCount * 3);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
    const trailMat = new THREE.PointsMaterial({
      color: 0x38bdf8,
      size: 0.12,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
    });
    const trailPoints = new THREE.Points(trailGeo, trailMat);
    this.group.add(trailPoints);

    const trailHistory = [];
    for (let i = 0; i < trailCount; i++) {
      trailHistory.push(p0.clone());
    }

    const transferObj = {
      progress: 0,
      fileGroup,
      trailPoints,
      p0,
      p1,
      p2,
      ring,
      trailHistory,
    };

    this.activeTransfers.push(transferObj);

    // Animate Bezier arc using GSAP
    gsap.to(transferObj, {
      progress: 1,
      duration: 1.6,
      ease: 'power2.inOut',
      onUpdate: () => {
        const t = transferObj.progress;
        // Quadratic Bezier Formula: B(t) = (1-t)^2 * P0 + 2(1-t)t * P1 + t^2 * P2
        const currentX = (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * p1.x + t * t * p2.x;
        const currentY = (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * p1.y + t * t * p2.y;
        const currentZ = (1 - t) * (1 - t) * p0.z + 2 * (1 - t) * t * p1.z + t * t * p2.z;

        fileGroup.position.set(currentX, currentY, currentZ);
        fileGroup.rotation.y += 0.1;
        fileGroup.rotation.x = Math.sin(t * Math.PI) * 0.4;
        ring.rotation.z += 0.15;

        // Update trail
        trailHistory.unshift(new THREE.Vector3(currentX, currentY, currentZ));
        trailHistory.pop();

        const positions = trailGeo.attributes.position.array;
        for (let i = 0; i < trailCount; i++) {
          const pt = trailHistory[i];
          positions[i * 3] = pt.x;
          positions[i * 3 + 1] = pt.y;
          positions[i * 3 + 2] = pt.z;
        }
        trailGeo.attributes.position.needsUpdate = true;
      },
      onComplete: () => {
        // Create Landing Ripple on target desk
        this.createLandingRipple(p2);

        // Remove from scene
        this.group.remove(fileGroup);
        this.group.remove(trailPoints);
        fileGroup.traverse((c) => {
          if (c.geometry) c.geometry.dispose();
          if (c.material) c.material.dispose();
        });
        trailGeo.dispose();
        trailMat.dispose();

        const idx = this.activeTransfers.indexOf(transferObj);
        if (idx > -1) this.activeTransfers.splice(idx, 1);

        if (onComplete) onComplete();
      },
    });
  }

  createLandingRipple(position) {
    const rippleGeo = new THREE.RingGeometry(0.1, 0.2, 24);
    const rippleMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    });
    const ripple = new THREE.Mesh(rippleGeo, rippleMat);
    ripple.rotation.x = -Math.PI / 2;
    ripple.position.set(position.x, 0.90, position.z);
    this.group.add(ripple);

    gsap.to(ripple.scale, {
      x: 6.0,
      y: 6.0,
      duration: 0.6,
      ease: 'power1.out',
    });
    gsap.to(rippleMat, {
      opacity: 0,
      duration: 0.6,
      ease: 'power1.out',
      onComplete: () => {
        this.group.remove(ripple);
        rippleGeo.dispose();
        rippleMat.dispose();
      },
    });
  }
}
