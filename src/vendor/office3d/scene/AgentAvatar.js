import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { avatarSharedMats } from './MaterialLibrary.js';

/**
 * 将同一父组内、材质相同的静态 Mesh 合并为单个 Mesh（同一父组 + 同材质 + 同显隐才能合并）。
 * 每个部件的本地变换先烘焙进几何（updateMatrix + applyMatrix4），再 mergeGeometries 合并。
 * 被合并的原始几何会 dispose（释放 GPU 缓冲），并减少 draw call。
 * @returns {number} 合并后减少的 draw call 数
 */
function mergeSiblingsByMaterial(parent) {
  if (!parent || parent.children.length < 2) return 0;

  const groups = new Map();
  parent.children.forEach((child) => {
    if (child.isMesh && !child.isInstancedMesh && child.geometry) {
      const key = child.material.uuid;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(child);
    }
  });

  let saved = 0;
  groups.forEach((meshes) => {
    if (meshes.length < 2) return;
    const geos = meshes.map((m) => {
      m.updateMatrix(); // 本地矩阵 = 相对父组空间的变换
      return m.geometry.clone().applyMatrix4(m.matrix);
    });
    const geo = mergeGeometries(geos, false);
    if (!geo) return; // 属性集不一致等异常：跳过该组
    const merged = new THREE.Mesh(geo, meshes[0].material);
    merged.castShadow = meshes.some((m) => m.castShadow);
    merged.receiveShadow = meshes.some((m) => m.receiveShadow);
    parent.add(merged);
    meshes.forEach((m) => {
      parent.remove(m);
      m.geometry.dispose();
    });
    saved += meshes.length - 1;
  });
  return saved;
}

/**
 * 3D Stylized Rigged Agent Avatar
 * Detailed character model with distinct hairstyles, clothing, glasses/headsets,
 * and articulated joint hierarchy driven by delta-time state animations (Idle, Typing, Thinking, Receiving, Review, Complete, Error, Offline).
 */
export class AgentAvatar {
  constructor(agentConfig, workstation) {
    this.config = agentConfig;
    this.workstation = workstation;
    this.id = agentConfig.id;
    this.role = agentConfig.role;
    this.colors = agentConfig.avatarColor;

    this.group = new THREE.Group();
    // Mount avatar relative to the workstation coordinate frame
    // Workstation chair is at z = 0.42 (moved closer to desk)
    this.group.position.set(0, 0, 0.42);
    this.workstation.group.add(this.group);

    this.status = agentConfig.status || 'idle';
    this.animTime = Math.random() * 10;
    this.fxParticles = [];

    this.buildCharacter();
    this.buildProps();
    this.buildEffects();
    this.setStatus(this.status);
  }

  buildProps() {
    // 1. 3D Smartphone Prop (attached to right hand)
    this.phoneProp = new THREE.Group();
    const phoneMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.8, roughness: 0.2 });
    const phoneBody = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.012, 0.18), phoneMat);
    this.phoneProp.add(phoneBody);

    const screenMat = new THREE.MeshBasicMaterial({ color: 0x60a5fa });
    const phoneScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.16), screenMat);
    phoneScreen.position.y = 0.007;
    phoneScreen.rotation.x = -Math.PI / 2;
    this.phoneProp.add(phoneScreen);

    // Glowing screen edge / indicator
    const glowMat = new THREE.MeshBasicMaterial({ color: 0x93c5fd });
    const topBar = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.018), glowMat);
    topBar.position.set(0, 0.008, -0.065);
    topBar.rotation.x = -Math.PI / 2;
    this.phoneProp.add(topBar);

    this.phoneProp.position.set(-0.05, -0.03, -0.07);
    this.phoneProp.rotation.set(-0.4, 0.3, 0.6);
    this.phoneProp.visible = false;
    this.rightHand.add(this.phoneProp);

    // 2. 3D Water / Coffee Cup Prop (attached to right hand)
    this.cupProp = new THREE.Group();
    const cupMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.2 });
    const cupBody = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.042, 0.12, 10), cupMat);
    this.cupProp.add(cupBody);

    const drinkMat = new THREE.MeshStandardMaterial({ color: 0x451a03, roughness: 0.3 });
    const drinkMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.018, 10), drinkMat);
    drinkMesh.position.y = 0.05;
    this.cupProp.add(drinkMesh);

    const handleMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.7, roughness: 0.3 });
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.01, 6, 12, Math.PI), handleMat);
    handle.position.set(0.055, 0, 0);
    this.cupProp.add(handle);

    this.cupProp.position.set(0.02, -0.06, -0.05);
    this.cupProp.rotation.set(0, 0, 0);
    this.cupProp.visible = false;
    this.rightHand.add(this.cupProp);

    // 3. 3D Yellow Project Folder / Clipboard Prop (attached to right hand / side)
    this.folderProp = new THREE.Group();
    const folderMat = new THREE.MeshStandardMaterial({
      color: 0xfacc15, // 黄色文件夹
      roughness: 0.3,
      metalness: 0.1
    });
    const folderBody = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.28, 0.025), folderMat);
    this.folderProp.add(folderBody);

    // White paper inside
    const paperMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
    const paperMesh = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.25, 0.01), paperMat);
    paperMesh.position.set(0, 0.015, 0.014);
    this.folderProp.add(paperMesh);

    // Metal clip on top
    const clipMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.9, roughness: 0.2 });
    const clip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.025, 0.03), clipMat);
    clip.position.set(0, 0.13, 0.014);
    this.folderProp.add(clip);

    this.folderProp.position.set(0.04, -0.12, 0.04);
    this.folderProp.rotation.set(0.2, 0.4, -0.2);
    this.folderProp.visible = false;
    this.rightHand.add(this.folderProp);
  }

  buildCharacter() {
    const skinMat = new THREE.MeshStandardMaterial({
      color: this.colors.skin,
      roughness: 0.6,
    });
    const suitMat = new THREE.MeshStandardMaterial({
      color: this.colors.suit,
      roughness: 0.5,
    });
    const shirtMat = new THREE.MeshStandardMaterial({
      color: this.colors.shirt,
      roughness: 0.6,
    });
    const hairMat = new THREE.MeshStandardMaterial({
      color: this.colors.hair,
      roughness: 0.7,
    });
    const pantsMat = avatarSharedMats.pants; // 所有角色一致的裤子/鞋共享一份
    const shoesMat = avatarSharedMats.shoes;

    // --- 1. Seated Legs & Shoes (Fixed Base) ---
    this.legsGroup = new THREE.Group();
    this.legsGroup.position.set(0, 0, 0);

    // Thighs (Horizontal extending forward under desk)
    for (const lx of [-0.16, 0.16]) {
      const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.44), pantsMat);
      thigh.position.set(lx, 0.50, -0.16);
      thigh.castShadow = true;
      this.legsGroup.add(thigh);

      // Shins (Vertical down to floor)（小腿不再投影，阴影交给大腿/躯干）
      const shin = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.46, 0.15), pantsMat);
      shin.position.set(lx, 0.25, -0.34);
      this.legsGroup.add(shin);

      // Shoes（鞋子不再投影）
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.10, 0.26), shoesMat);
      shoe.position.set(lx, 0.05, -0.38);
      this.legsGroup.add(shoe);
    }
    this.group.add(this.legsGroup);

    // --- 2. Articulated Upper Body & Torso ---
    this.torsoGroup = new THREE.Group();
    this.torsoGroup.position.set(0, 0.54, 0);

    // Main Torso / Jacket
    const jacket = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.54, 0.30), suitMat);
    jacket.position.y = 0.27;
    jacket.castShadow = true;
    this.torsoGroup.add(jacket);

    // Inner Shirt Collar & Tie/Lanyard
    const innerShirt = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.24, 0.035), shirtMat);
    innerShirt.position.set(0, 0.40, -0.14);
    this.torsoGroup.add(innerShirt);

    // If Director or has tie -> Add Formal Silk Tie
    if (this.colors.tie || this.config.type === 'director') {
      const tieColor = this.colors.tie || 0x0284c7;
      const tieMat = new THREE.MeshStandardMaterial({ color: tieColor, roughness: 0.3, metalness: 0.1 });
      const tieNode = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.022), tieMat);
      tieNode.position.set(0, 0.40, -0.16);
      this.torsoGroup.add(tieNode);

      const tieBody = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.018), tieMat);
      tieBody.position.set(0, 0.28, -0.158);
      this.torsoGroup.add(tieBody);
    } else if (this.colors.accent) {
      // Company ID Badge / Lanyard
      const badgeMat = new THREE.MeshStandardMaterial({
        color: this.colors.accent,
        roughness: 0.3,
      });
      const badge = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.10, 0.018), badgeMat);
      badge.position.set(0, 0.28, -0.155);
      this.torsoGroup.add(badge);
    }

    // --- 3. Head & Neck Hierarchy ---
    this.neckHeadGroup = new THREE.Group();
    this.neckHeadGroup.position.set(0, 0.54, 0);

    // Neck
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.10, 8), skinMat);
    neck.position.y = 0.05;
    this.neckHeadGroup.add(neck);

    // Head Group (for independent yaw/pitch)
    this.headGroup = new THREE.Group();
    this.headGroup.position.set(0, 0.20, 0);

    // Stylized Face / Head (Smooth rounded cuboid/sphere)（分段 16→12，省三角）
    const faceGeo = new THREE.SphereGeometry(0.20, 12, 12);
    faceGeo.scale(1, 1.15, 1.05);
    const face = new THREE.Mesh(faceGeo, skinMat);
    // 脸部不再投影（小部件，阴影可忽略，减少阴影 pass 绘制）
    this.headGroup.add(face);

    // Eyes
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1f2937 });
    for (const ex of [-0.065, 0.065]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 6), eyeMat);
      eye.position.set(ex, 0.03, -0.18);
      this.headGroup.add(eye);
    }

    // Hair Geometries (Customized per Agent Role & HairStyle)
    this.buildHairstyle(this.headGroup, hairMat);

    // Accessories: Glasses
    if (this.colors.glasses) {
      const glassesMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.8, roughness: 0.2 });
      for (const gx of [-0.07, 0.07]) {
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.009, 6, 12), glassesMat);
        rim.position.set(gx, 0.03, -0.19);
        this.headGroup.add(rim);
      }
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.013, 0.013), glassesMat);
      bridge.position.set(0, 0.03, -0.20);
      this.headGroup.add(bridge);
    }

    // Accessories: Headset
    if (this.colors.hasHeadphones) {
      const hpMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.3 });
      const hpAccent = new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.4 });
      // Headband
      const headband = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.018, 6, 12, Math.PI), hpMat);
      headband.rotation.x = -Math.PI / 2;
      headband.position.y = 0.11;
      this.headGroup.add(headband);
      // Ear Cups
      for (const hpx of [-0.21, 0.21]) {
        const earCup = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.045, 8), hpAccent);
        earCup.rotation.z = Math.PI / 2;
        earCup.position.set(hpx, 0.02, 0);
        this.headGroup.add(earCup);
      }
    }

    // Accessories: QA Voice Microphone
    if (this.colors.hasMic) {
      const micMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.7, roughness: 0.3 });
      const micArm = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.13, 6), micMat);
      micArm.rotation.z = -0.7;
      micArm.rotation.x = -0.4;
      micArm.position.set(0.14, 0.01, -0.10);
      this.headGroup.add(micArm);

      const micTip = new THREE.Mesh(new THREE.SphereGeometry(0.016, 6, 6), new THREE.MeshStandardMaterial({ color: 0x0f172a }));
      micTip.position.set(0.07, -0.03, -0.18);
      this.headGroup.add(micTip);
    }

    if (this.colors.hasHat) {
      const hatMat = new THREE.MeshStandardMaterial({ color: 0x451a03, roughness: 0.6 });
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), hatMat);
      cap.position.y = 0.10;
      this.headGroup.add(cap);
      const brim = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.018, 0.13), hatMat);
      brim.position.set(0, 0.10, -0.21);
      brim.rotation.x = -0.15;
      this.headGroup.add(brim);
    }

    this.neckHeadGroup.add(this.headGroup);
    this.torsoGroup.add(this.neckHeadGroup);

    // --- 4. Articulated Left & Right Arms ---
    // Left Arm Hierarchy
    this.leftShoulder = new THREE.Group();
    this.leftShoulder.position.set(-0.31, 0.45, 0);

    const leftUpperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.24, 8), suitMat);
    leftUpperArm.position.y = -0.12;
    leftUpperArm.castShadow = true;
    this.leftShoulder.add(leftUpperArm);

    this.leftElbow = new THREE.Group();
    this.leftElbow.position.set(0, -0.24, 0);

    const leftForearm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.044, 0.24, 8), suitMat);
    leftForearm.position.y = -0.12;
    this.leftElbow.add(leftForearm);

    this.leftHand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 6), skinMat);
    this.leftHand.scale.set(1, 0.8, 1.4);
    this.leftHand.position.set(0, -0.24, 0);
    this.leftElbow.add(this.leftHand);

    this.leftShoulder.add(this.leftElbow);
    this.torsoGroup.add(this.leftShoulder);

    // Right Arm Hierarchy
    this.rightShoulder = new THREE.Group();
    this.rightShoulder.position.set(0.31, 0.45, 0);

    const rightUpperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.24, 8), suitMat);
    rightUpperArm.position.y = -0.12;
    rightUpperArm.castShadow = true;
    this.rightShoulder.add(rightUpperArm);

    this.rightElbow = new THREE.Group();
    this.rightElbow.position.set(0, -0.24, 0);

    const rightForearm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.044, 0.24, 8), suitMat);
    rightForearm.position.y = -0.12;
    this.rightElbow.add(rightForearm);

    this.rightHand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 6), skinMat);
    this.rightHand.scale.set(1, 0.8, 1.4);
    this.rightHand.position.set(0, -0.24, 0);
    this.rightElbow.add(this.rightHand);

    this.rightShoulder.add(this.rightElbow);
    this.torsoGroup.add(this.rightShoulder);

    this.group.add(this.torsoGroup);

    // 同父组 + 同材质静态件合并（省 draw call）：
    // 腿（裤腿+小腿）、鞋、眼、发型块、眼镜、耳机罩、帽檐
    mergeSiblingsByMaterial(this.legsGroup);
    mergeSiblingsByMaterial(this.headGroup);
  }

  buildHairstyle(headParent, hairMat) {
    const style = this.colors.hairStyle || this.config.type;

    if (style === 'femaleLong') {
      // Female wavy long hair draped over shoulders
      const hairTop = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 10, 0, Math.PI * 2, 0, Math.PI * 0.65), hairMat);
      hairTop.position.set(0, 0.05, 0.02);
      hairTop.scale.set(1.05, 1.05, 1.1);
      headParent.add(hairTop);

      // Left & Right falling hair locks
      for (const hx of [-0.16, 0.16]) {
        const lock = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.035, 0.34, 6), hairMat);
        lock.position.set(hx, -0.07, 0.04);
        lock.rotation.z = hx > 0 ? -0.15 : 0.15;
        headParent.add(lock);
      }
      // Back long drape
      const backHair = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.38, 0.12), hairMat);
      backHair.position.set(0, -0.09, 0.12);
      headParent.add(backHair);
    } else if (style === 'femaleBob') {
      // Sleek bob haircut with neat curved ends
      const bobTop = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 10, 0, Math.PI * 2, 0, Math.PI * 0.72), hairMat);
      bobTop.position.set(0, 0.04, 0.01);
      headParent.add(bobTop);

      const bobSides = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.19, 0.19, 8, 1, true), hairMat);
      bobSides.position.set(0, -0.03, 0.02);
      headParent.add(bobSides);
    } else if (style === 'curls') {
      // Designer voluminous fluffy short hair
      const topPuff = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 10), hairMat);
      topPuff.position.set(0, 0.07, 0.01);
      topPuff.scale.set(1.06, 1.08, 1.06);
      headParent.add(topPuff);

      for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI * 2) / 6;
        const bump = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), hairMat);
        bump.position.set(Math.cos(angle) * 0.13, 0.14, Math.sin(angle) * 0.13);
        headParent.add(bump);
      }
    } else if (style === 'sidePart') {
      // Sleek executive side-part
      const hair = new THREE.Mesh(new THREE.SphereGeometry(0.21, 10, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat);
      hair.position.set(0, 0.05, 0.02);
      hair.scale.set(1.04, 1.06, 1.06);
      headParent.add(hair);

      const part = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.035, 0.16), hairMat);
      part.position.set(0.03, 0.16, -0.05);
      part.rotation.z = -0.15;
      headParent.add(part);
    } else {
      // Modern short taper & spiky
      const hair = new THREE.Mesh(new THREE.SphereGeometry(0.21, 10, 10, 0, Math.PI * 2, 0, Math.PI * 0.52), hairMat);
      hair.position.set(0, 0.05, 0.02);
      headParent.add(hair);

      const tuft = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.12), hairMat);
      tuft.position.set(0, 0.16, -0.05);
      tuft.rotation.x = -0.2;
      headParent.add(tuft);
    }
  }

  buildEffects() {
    // 3D Floating Particle Spark / Icon above head for Thinking / Completed / Error
    this.fxGroup = new THREE.Group();
    this.fxGroup.position.set(0, 1.60, 0);
    this.group.add(this.fxGroup);

    // 1. Thinking Spark (Pulsing Diamond)
    const thinkGeo = new THREE.OctahedronGeometry(0.12, 0);
    const thinkMat = new THREE.MeshStandardMaterial({
      color: 0xc084fc,
      emissive: 0xa855f7,
      emissiveIntensity: 1.5,
      roughness: 0.1,
    });
    this.thinkMesh = new THREE.Mesh(thinkGeo, thinkMat);
    this.thinkMesh.visible = false;
    this.fxGroup.add(this.thinkMesh);

    // 2. Completed Victory Rings (Golden Aura)
    const doneGeo = new THREE.TorusGeometry(0.26, 0.018, 6, 18);
    const doneMat = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      emissive: 0xeab308,
      emissiveIntensity: 1.8,
    });
    this.doneMesh = new THREE.Mesh(doneGeo, doneMat);
    this.doneMesh.rotation.x = Math.PI / 2;
    this.doneMesh.visible = false;
    this.fxGroup.add(this.doneMesh);

    // 3. Error Alert Beacon (Red flashing Octahedron)
    const errGeo = new THREE.OctahedronGeometry(0.13, 0);
    const errMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0xdc2626,
      emissiveIntensity: 2.0,
    });
    this.errMesh = new THREE.Mesh(errGeo, errMat);
    this.errMesh.visible = false;
    this.fxGroup.add(this.errMesh);
  }

  setStatus(status) {
    this.status = status;
    this.workstation.setStatus(status);

    // Toggle FX visibility
    if (this.thinkMesh) this.thinkMesh.visible = (status === 'thinking');
    if (this.doneMesh) this.doneMesh.visible = (status === 'completed');
    if (this.errMesh) this.errMesh.visible = (status === 'error');

    // Props visibility
    if (this.phoneProp) this.phoneProp.visible = false;
    if (this.cupProp) this.cupProp.visible = false;
    if (this.folderProp) this.folderProp.visible = (status === 'transfer' || this.id === 6);

    if (status === 'offline') {
      this.group.visible = false;
    } else {
      this.group.visible = true;
    }
  }

  update(deltaTime) {
    if (this.status === 'offline') return;

    this.animTime += deltaTime;
    const t = this.animTime;

    // --- State Continuous Animations ---
    if (this.status === 'transfer') {
      // Transfer state: Holding yellow project folder, pointing/handing over
      if (this.folderProp) this.folderProp.visible = true;
      if (this.phoneProp) this.phoneProp.visible = false;
      if (this.cupProp) this.cupProp.visible = false;

      this.torsoGroup.position.set(0, 0.54 + Math.sin(t * 4) * 0.01, 0);
      this.torsoGroup.rotation.set(0.08, Math.sin(t * 2) * 0.15, 0);
      this.headGroup.rotation.set(-0.15, Math.sin(t * 2) * 0.2, 0);

      // Right arm holding yellow folder forward
      this.rightShoulder.rotation.set(0.85, -0.2, 0.25);
      this.rightElbow.rotation.set(-0.6, 0.3, -0.2);

      // Left arm gesturing forward
      this.leftShoulder.rotation.set(0.65, 0.3, -0.2);
      this.leftElbow.rotation.set(-0.5, 0, 0);

    } else if (this.status === 'idle') {
      // DYNAMIC IDLE BEHAVIORS:
      // Supports 3 dynamic activities: 1. 玩手机 (Smart Phone), 2. 喝水/咖啡 (Drinking), 3. 玩电脑游戏 (PC Gaming)
      const cyclePeriod = 18; // 18-second macro activity cycle
      const activityIndex = Math.floor((t + this.id * 5.3) / cyclePeriod) % 3;
      const phaseTime = (t + this.id * 5.3) % cyclePeriod;

      if (activityIndex === 0) {
        // --- 1. 玩手机 (Smart Phone Mode) ---
        if (this.phoneProp) this.phoneProp.visible = true;
        if (this.cupProp) this.cupProp.visible = false;

        // Torso leans back relaxed in chair
        this.torsoGroup.position.set(0, 0.54 + Math.sin(t * 2) * 0.008, 0.02);
        this.torsoGroup.rotation.set(-0.06 + Math.sin(t * 2) * 0.01, 0, Math.sin(t * 1.5) * 0.015);

        // Head tilted down looking at phone screen
        this.headGroup.rotation.set(0.42, Math.sin(t * 0.8) * 0.05, 0);

        // Both arms held up to chest holding the smartphone
        const thumbTap = Math.sin(t * 14) * 0.04;
        this.leftShoulder.rotation.set(0.70, 0.28, -0.35);
        this.leftElbow.rotation.set(-1.58, 0.25, 0.28);

        this.rightShoulder.rotation.set(0.70, -0.28, 0.35);
        this.rightElbow.rotation.set(-1.58 + thumbTap, -0.25, -0.28);

      } else if (activityIndex === 1) {
        // --- 2. 喝水 / 喝咖啡 (Drinking Water / Coffee Mode) ---
        if (this.phoneProp) this.phoneProp.visible = false;
        if (this.cupProp) this.cupProp.visible = true;

        // Left arm resting naturally on desk/armrest
        this.leftShoulder.rotation.set(0.45, 0.15, -0.15);
        this.leftElbow.rotation.set(-0.95, 0, 0);

        // 8-second sub-cycle for taking a comfortable sip
        const drinkSubT = phaseTime % 8;

        if (drinkSubT < 2.2) {
          // Phase 2a: Lifting cup to lips
          const p = Math.min(1, drinkSubT / 2.0);
          const smoothP = 0.5 - 0.5 * Math.cos(p * Math.PI);
          this.rightShoulder.rotation.set(0.5 + smoothP * 0.55, -0.2 - smoothP * 0.25, 0.2 + smoothP * 0.3);
          this.rightElbow.rotation.set(-1.0 - smoothP * 0.9, smoothP * 0.3, -smoothP * 0.2);
          this.headGroup.rotation.set(smoothP * -0.28, 0.05, 0);
          this.torsoGroup.position.set(0, 0.54, 0);
          this.torsoGroup.rotation.set(-smoothP * 0.05, 0, 0);

        } else if (drinkSubT < 4.8) {
          // Phase 2b: Sipping drink & throat micro-movements
          this.rightShoulder.rotation.set(1.05, -0.45, 0.5);
          this.rightElbow.rotation.set(-1.9 + Math.sin(t * 6) * 0.03, 0.3, -0.2);
          this.headGroup.rotation.set(-0.28 + Math.sin(t * 6) * 0.02, 0.05, 0);
          this.torsoGroup.position.set(0, 0.54 + Math.sin(t * 6) * 0.005, 0);
          this.torsoGroup.rotation.set(-0.06, 0, 0);

        } else if (drinkSubT < 6.8) {
          // Phase 2c: Lowering cup back towards desk
          const p = Math.min(1, (drinkSubT - 4.8) / 1.8);
          const smoothP = 0.5 + 0.5 * Math.cos(p * Math.PI);
          this.rightShoulder.rotation.set(0.5 + smoothP * 0.55, -0.2 - smoothP * 0.25, 0.2 + smoothP * 0.3);
          this.rightElbow.rotation.set(-1.0 - smoothP * 0.9, smoothP * 0.3, -smoothP * 0.2);
          this.headGroup.rotation.set(smoothP * -0.28, (1 - smoothP) * 0.12, 0);
          this.torsoGroup.position.set(0, 0.54, 0);
          this.torsoGroup.rotation.set(-smoothP * 0.05, 0, 0);

        } else {
          // Phase 2d: Contented relaxation & looking around
          this.rightShoulder.rotation.set(0.48, -0.15, 0.15);
          this.rightElbow.rotation.set(-0.95, 0, 0);
          this.headGroup.rotation.set(0, 0.15 + Math.sin(t * 1.5) * 0.1, 0);
          this.torsoGroup.position.set(0, 0.54 + Math.sin(t * 2) * 0.01, 0);
          this.torsoGroup.rotation.set(0, 0, 0);
        }

      } else {
        // --- 3. 玩电脑游戏 (PC Gaming / Mini-Game Mode) ---
        if (this.phoneProp) this.phoneProp.visible = false;
        if (this.cupProp) this.cupProp.visible = false;

        // Eager forward-leaning posture
        this.torsoGroup.position.set(0, 0.54 + Math.sin(t * 6) * 0.008, -0.02);
        this.torsoGroup.rotation.set(0.12 + Math.sin(t * 6) * 0.01, 0, Math.sin(t * 4) * 0.030);

        // Head tracking game screen enthusiastically
        this.headGroup.rotation.set(0.15, Math.sin(t * 3.5) * 0.08, Math.cos(t * 4) * 0.03);

        // Left hand on WASD keys - typing posture (upper arm down, forearm up to keyboard)
        const gameTap = Math.sin(t * 26) * 0.06;
        this.leftShoulder.rotation.set(0.15, 0.38, -0.12);
        this.leftElbow.rotation.set(2.05 + gameTap, 0, 0);

        // Right hand on gaming mouse - slightly more forward/outward
        const mouseClick = Math.sin(t * 18) * 0.04;
        const mouseFlick = Math.cos(t * 8) * 0.04;
        this.rightShoulder.rotation.set(0.20, -0.55, 0.15);
        this.rightElbow.rotation.set(2.00 + mouseClick, 0, mouseFlick);
      }

    } else if (this.status === 'working') {
      // 2. WORKING / TYPING: Hands on mechanical keyboard - typing posture:
      //    upper arm hangs nearly straight down (small x rotation),
      //    large elbow bend brings forearm UP to keyboard level.
      if (this.phoneProp) this.phoneProp.visible = false;
      if (this.cupProp) this.cupProp.visible = false;

      // Natural slight forward lean towards desk
      this.torsoGroup.position.set(0, 0.54 + Math.sin(t * 8) * 0.006, -0.02);
      this.torsoGroup.rotation.set(0.08 + Math.sin(t * 8) * 0.006, 0, 0);
      this.headGroup.rotation.set(0.18, -0.06 + Math.sin(t * 3) * 0.03, 0);

      // Typing tap oscillations
      const leftTap = Math.sin(t * 24) * 0.04;
      const rightTap = Math.cos(t * 22) * 0.04;

      // Left hand on keyboard:
      // - shoulder mostly down (x≈0.15) + inward (y≈+0.38)
      // - large elbow bend (x≈2.05) brings forearm up to keyboard
      this.leftShoulder.rotation.set(0.15, 0.38, -0.12);
      this.leftElbow.rotation.set(2.05 + leftTap, 0, 0);

      // Right hand operates keyboard (75% of time) and mouse (25% of time)
      const useMouse = (Math.sin(t * 0.5 + this.id) > 0.6);
      if (useMouse) {
        // Mouse: arm slightly more forward, shoulder swings outward
        this.rightShoulder.rotation.set(0.20, -0.55, 0.15);
        this.rightElbow.rotation.set(2.00 + Math.sin(t * 8) * 0.03, 0, 0);
      } else {
        this.rightShoulder.rotation.set(0.15, -0.38, 0.12);
        this.rightElbow.rotation.set(2.05 + rightTap, 0, 0);
      }

    } else if (this.status === 'thinking') {
      // 3. THINKING: Leaning back, hand on chin, head tilted up thoughtfully
      if (this.phoneProp) this.phoneProp.visible = false;
      if (this.cupProp) this.cupProp.visible = false;

      this.torsoGroup.position.y = 0.54;
      this.torsoGroup.rotation.x = -0.08 + Math.sin(t * 1.5) * 0.015;
      this.torsoGroup.rotation.z = Math.sin(t * 1.2) * 0.02;

      // Head tilted up
      this.headGroup.rotation.set(-0.25, 0.2 + Math.sin(t * 1.5) * 0.05, 0.08);

      // Right arm up touching chin
      this.rightShoulder.rotation.set(0.9, -0.4, 0.4);
      this.rightElbow.rotation.set(-1.9, 0.4, -0.3);

      // Left arm resting on desk
      this.leftShoulder.rotation.set(0.4, 0.1, -0.1);
      this.leftElbow.rotation.set(-0.9, 0, 0);

      // Pulse floating thinking spark
      if (this.thinkMesh) {
        this.thinkMesh.rotation.y = t * 2;
        this.thinkMesh.rotation.x = t * 1.5;
        const s = 1.0 + Math.sin(t * 4) * 0.25;
        this.thinkMesh.scale.set(s, s, s);
      }

    } else if (this.status === 'receiving') {
      // 4. RECEIVING: Head up watching incoming file, hands reaching out forward
      if (this.phoneProp) this.phoneProp.visible = false;
      if (this.cupProp) this.cupProp.visible = false;

      this.torsoGroup.position.y = 0.54;
      this.torsoGroup.rotation.x = 0.05;
      this.headGroup.rotation.set(-0.35, Math.sin(t * 3) * 0.05, 0);

      // Reaching out both hands
      this.leftShoulder.rotation.set(0.85, 0.2, -0.1);
      this.leftElbow.rotation.set(-0.55, 0, 0);

      this.rightShoulder.rotation.set(0.85, -0.2, 0.1);
      this.rightElbow.rotation.set(-0.55, 0, 0);

    } else if (this.status === 'reviewing') {
      // 5. REVIEWING: Comparing dual monitors (head sweeping left and right), mouse clicks
      if (this.phoneProp) this.phoneProp.visible = false;
      if (this.cupProp) this.cupProp.visible = false;

      this.torsoGroup.position.y = 0.54;
      this.torsoGroup.rotation.x = 0.08;
      this.headGroup.rotation.set(0, Math.sin(t * 2.2) * 0.38, 0);

      // Left hand resting on keyboard/desk - typing posture
      this.leftShoulder.rotation.set(0.15, 0.38, -0.12);
      this.leftElbow.rotation.set(2.02, 0, 0);

      // Right hand on mouse with periodic micro clicks
      const mouseClick = Math.sin(t * 6) * 0.03;
      this.rightShoulder.rotation.set(0.20, -0.55, 0.15);
      this.rightElbow.rotation.set(2.02 + mouseClick, 0, 0);

    } else if (this.status === 'completed') {
      // 6. COMPLETED: Both arms raised in victory / cheering, swaying joyfully
      if (this.phoneProp) this.phoneProp.visible = false;
      if (this.cupProp) this.cupProp.visible = false;

      this.torsoGroup.position.y = 0.54 + Math.sin(t * 4) * 0.03;
      this.torsoGroup.rotation.x = -0.15;
      this.torsoGroup.rotation.z = Math.sin(t * 4) * 0.06;
      this.headGroup.rotation.set(-0.35, Math.sin(t * 4) * 0.1, 0);

      // Cheering V-arms
      this.leftShoulder.rotation.set(1.4, 0.2, -0.8 + Math.sin(t * 6) * 0.1);
      this.leftElbow.rotation.set(-0.3, 0, 0);

      this.rightShoulder.rotation.set(1.4, -0.2, 0.8 - Math.sin(t * 6) * 0.1);
      this.rightElbow.rotation.set(-0.3, 0, 0);

      // Rotating victory ring
      if (this.doneMesh) {
        this.doneMesh.rotation.z = t * 3;
        const s = 1.0 + Math.sin(t * 4) * 0.2;
        this.doneMesh.scale.set(s, s, s);
      }

    } else if (this.status === 'error') {
      // 7. ERROR: Hands clutching head in distress, frantic head shaking
      if (this.phoneProp) this.phoneProp.visible = false;
      if (this.cupProp) this.cupProp.visible = false;

      this.torsoGroup.position.y = 0.54;
      this.torsoGroup.rotation.x = 0.35 + Math.sin(t * 6) * 0.03;
      this.headGroup.rotation.set(0.2, Math.sin(t * 14) * 0.35, 0);

      // Both hands holding head
      this.leftShoulder.rotation.set(1.2, 0.5, -0.6);
      this.leftElbow.rotation.set(-1.8, 0, 0.2);

      this.rightShoulder.rotation.set(1.2, -0.5, 0.6);
      this.rightElbow.rotation.set(-1.8, 0, -0.2);

      // Flashing error beacon
      if (this.errMesh) {
        this.errMesh.rotation.y = t * 5;
        const flash = Math.sin(t * 10) > 0;
        this.errMesh.material.emissiveIntensity = flash ? 3.0 : 0.5;
      }
    }
  }

  getHeadWorldPosition(target = new THREE.Vector3()) {
    this.headGroup.getWorldPosition(target);
    return target;
  }
}
