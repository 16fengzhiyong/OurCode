import * as THREE from 'three';
import gsap from 'gsap';

/**
 * 3D Holographic Ground Selection Ring & Reticle
 * Accurately bounds the selected workstation in 3D world space.
 * Features rotating dashed inner circle, glowing outer ring, 4 tech corner brackets,
 * and smooth glide transitions when selection changes.
 */
export class SelectionRing {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.position.set(0, 0.03, 0);
    this.scene.add(this.group);

    this.time = 0;
    this.currentPos = new THREE.Vector3(0, 0.03, 0);

    this.buildMeshes();
  }

  buildMeshes() {
    // 1. Outer Glowing Ring
    const outerGeo = new THREE.RingGeometry(2.1, 2.2, 32);
    const outerMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    });
    this.outerRing = new THREE.Mesh(outerGeo, outerMat);
    this.outerRing.rotation.x = -Math.PI / 2;
    this.group.add(this.outerRing);

    // 2. Inner Dashed Tech Ring
    const innerGeo = new THREE.RingGeometry(1.7, 1.76, 24);
    const innerMat = new THREE.MeshBasicMaterial({
      color: 0x0ea5e9,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
    });
    this.innerRing = new THREE.Mesh(innerGeo, innerMat);
    this.innerRing.rotation.x = -Math.PI / 2;
    this.group.add(this.innerRing);

    // 3. Four Tech Corner Brackets
    const bracketMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.9,
    });
    this.bracketsGroup = new THREE.Group();
    const size = 2.4;
    const len = 0.5;
    const thickness = 0.06;

    const corners = [
      { x: -size, z: -size, rot: 0 },
      { x: size, z: -size, rot: Math.PI / 2 },
      { x: size, z: size, rot: Math.PI },
      { x: -size, z: size, rot: -Math.PI / 2 },
    ];

    corners.forEach((c) => {
      const corner = new THREE.Group();
      corner.position.set(c.x, 0, c.z);
      corner.rotation.y = c.rot;

      const hBar = new THREE.Mesh(new THREE.BoxGeometry(len, 0.01, thickness), bracketMat);
      hBar.position.set(len / 2, 0, 0);
      corner.add(hBar);

      const vBar = new THREE.Mesh(new THREE.BoxGeometry(thickness, 0.01, len), bracketMat);
      vBar.position.set(0, 0, len / 2);
      corner.add(vBar);

      this.bracketsGroup.add(corner);
    });

    this.group.add(this.bracketsGroup);

    // 4. Subtle center pulse disc
    const discGeo = new THREE.CircleGeometry(1.6, 24);
    const discMat = new THREE.MeshBasicMaterial({
      color: 0x0284c7,
      transparent: true,
      opacity: 0.08,
      side: THREE.DoubleSide,
    });
    this.disc = new THREE.Mesh(discGeo, discMat);
    this.disc.rotation.x = -Math.PI / 2;
    this.group.add(this.disc);
  }

  /**
   * Smoothly move selection ring to the new workstation coordinates
   */
  moveTo(x, z, immediate = false) {
    if (immediate) {
      this.group.position.set(x, 0.03, z);
      return;
    }

    gsap.to(this.group.position, {
      x,
      z,
      duration: 0.45,
      ease: 'power2.out',
    });

    // Slight bounce / scale pop on move
    this.group.scale.set(0.9, 1, 0.9);
    gsap.to(this.group.scale, {
      x: 1,
      y: 1,
      z: 1,
      duration: 0.5,
      ease: 'back.out(2)',
    });
  }

  update(deltaTime) {
    this.time += deltaTime;
    const t = this.time;

    // Rotate inner dashed ring
    if (this.innerRing) {
      this.innerRing.rotation.z = t * 0.8;
    }

    // Pulse outer ring opacity
    if (this.outerRing) {
      this.outerRing.material.opacity = 0.65 + Math.sin(t * 4) * 0.25;
    }

    // Subtle breathing on brackets
    if (this.bracketsGroup) {
      const s = 1.0 + Math.sin(t * 3) * 0.02;
      this.bracketsGroup.scale.set(s, 1, s);
    }
  }
}
