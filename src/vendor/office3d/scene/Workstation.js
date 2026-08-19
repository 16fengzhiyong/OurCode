import * as THREE from 'three';
import workstationMats, { sharedGeometries } from './MaterialLibrary.js';
import { DynamicScreen } from './DynamicScreen.js';

/**
 * 3D Workstation Unit
 * 本类仅维护【每工位独立】的动态部分：
 * - 双显示器屏幕平面（CanvasTexture 内容每 Agent 不同，严禁共享）
 * - 人体工学转椅（offline 状态 z 轴可动画）
 * 桌面、桌腿、隔板、显示器支架/边框、键盘鼠标、桌面道具等【全部工位一致】的静态家具
 * 已移入全局 WorkstationKit（跨 8 工位 InstancedMesh 合并，大幅降低 draw call）。
 */
export class Workstation {
  constructor(agentConfig, scene) {
    this.agentConfig = agentConfig;
    this.scene = scene;
    this.id = agentConfig.id;
    this.role = agentConfig.role;
    this.deskPos = agentConfig.deskPos; // { x, z, row, col }

    this.group = new THREE.Group();
    this.group.position.set(this.deskPos.x, 0, this.deskPos.z);
    this.scene.add(this.group);

    // Orientation: All workstations uniformly face North towards the wall (-Z, rotation.y = 0)
    this.facingAngle = 0;
    this.group.rotation.y = this.facingAngle;

    // Dynamic screens (per-agent textures — NOT shared)
    this.primaryScreen = new DynamicScreen(this.id, this.role, false);
    this.secondaryScreen = new DynamicScreen(this.id, this.role, true);

    this.chair = null;
    this.status = agentConfig.status || 'idle';

    this.buildMonitors();
    this.buildChair();

    this.setStatus(this.status);
  }

  buildMonitors() {
    // --- 1. Primary Main Monitor (Center-Left) ---
    // 边框已在 WorkstationKit 中实例化，这里只放屏幕平面（纹理内容每工位不同）
    const mon1Group = new THREE.Group();
    mon1Group.position.set(-0.52, 1.30, -0.38);
    mon1Group.rotation.y = 0.12;

    const screenMat1 = new THREE.MeshBasicMaterial({
      map: this.primaryScreen.texture,
    });
    const screenMesh1 = new THREE.Mesh(new THREE.PlaneGeometry(1.24, 0.74), screenMat1);
    screenMesh1.position.z = 0.022;
    mon1Group.add(screenMesh1);

    this.group.add(mon1Group);

    // --- 2. Secondary Monitor (Right - Slightly Angled) ---
    const mon2Group = new THREE.Group();
    mon2Group.position.set(0.60, 1.30, -0.36);
    mon2Group.rotation.y = -0.25;

    const screenMat2 = new THREE.MeshBasicMaterial({
      map: this.secondaryScreen.texture,
    });
    const screenMesh2 = new THREE.Mesh(new THREE.PlaneGeometry(1.02, 0.74), screenMat2);
    screenMesh2.position.z = 0.022;
    mon2Group.add(screenMesh2);

    this.group.add(mon2Group);
  }

  buildChair() {
    const mats = workstationMats;
    const geo = sharedGeometries;

    this.chair = new THREE.Group();
    this.chair.position.set(0, 0, 0.65);

    // 5-Star Wheeled Base —— 5 臂 + 5 轮合并为 2 个 InstancedMesh（10 → 2 draw call）
    const armInst = new THREE.InstancedMesh(geo.chairArm, mats.chrome, 5);
    const wheelInst = new THREE.InstancedMesh(geo.chairWheel, mats.chair, 5);
    for (let i = 0; i < 5; i++) {
      const angle = (i * Math.PI * 2) / 5;
      armInst.setMatrixAt(
        i,
        new THREE.Matrix4().compose(
          new THREE.Vector3(Math.sin(angle) * 0.20, 0.08, Math.cos(angle) * 0.20),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, 0)),
          new THREE.Vector3(1, 1, 1)
        )
      );
      wheelInst.setMatrixAt(
        i,
        new THREE.Matrix4().compose(
          new THREE.Vector3(Math.sin(angle) * 0.38, 0.035, Math.cos(angle) * 0.38),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)),
          new THREE.Vector3(1, 1, 1)
        )
      );
    }
    armInst.instanceMatrix.needsUpdate = true;
    wheelInst.instanceMatrix.needsUpdate = true;
    this.chair.add(armInst, wheelInst);

    // Hydraulic Gas Cylinder Column
    const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.38, 8), mats.chrome);
    cylinder.position.y = 0.26;
    this.chair.add(cylinder);

    // Ergonomic Seat Cushion
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.08, 0.62), mats.chair);
    seat.position.set(0, 0.48, 0);
    seat.castShadow = true;
    this.chair.add(seat);

    // Curved Ergonomic Mesh Backrest
    const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.05), mats.chair);
    backrest.position.set(0, 0.90, 0.28);
    backrest.rotation.x = 0.1;
    backrest.castShadow = true;
    this.chair.add(backrest);

    // Adjustable Armrests
    for (const ax of [-0.35, 0.35]) {
      const armPole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.22, 8), mats.chrome);
      armPole.position.set(ax, 0.60, 0.04);
      this.chair.add(armPole);

      const armPad = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.025, 0.25), mats.chair);
      armPad.position.set(ax, 0.71, 0.04);
      this.chair.add(armPad);
    }

    this.group.add(this.chair);
  }

  setStatus(status) {
    this.status = status;
    this.primaryScreen.setStatus(status);
    this.secondaryScreen.setStatus(status);

    if (status === 'offline') {
      // Push chair in when vacant
      if (this.chair) this.chair.position.z = 0.38;
    } else {
      if (this.chair) this.chair.position.z = 0.65;
    }
  }

  update(deltaTime) {
    this.primaryScreen.update(deltaTime);
    this.secondaryScreen.update(deltaTime);
  }
}
