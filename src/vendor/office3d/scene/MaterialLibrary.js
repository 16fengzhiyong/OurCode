import * as THREE from 'three';

/**
 * 全局共享材质与几何库
 * 所有工位外观统一，材质/几何只创建一份供 8 个工位与重复件复用：
 * - 材质实例数：~20 份替代 ~160 份（省 GPU 状态切换与显存）
 * - 重复几何（椅子轮臂、多肉、植物、服务器刀片/LED）共享一份，供 InstancedMesh 复用
 * 注意：几何中的 scale 已烘焙进几何本身（如多肉花瓣、植物叶片）。
 */

// —— 工位共享材质 ——
const workstationMats = {
  desk: new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.35, metalness: 0.05 }),
  leg: new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.4, metalness: 0.6 }),
  felt: new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.85 }),
  bracket: new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8, roughness: 0.2 }),
  bezel: new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.3, metalness: 0.5 }),
  stand: new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.8, roughness: 0.2 }),
  deskMat: new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.85 }),
  kbChassis: new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.4 }),
  key: new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.5 }),
  keyAccent: new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.4 }),
  mouse: new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.3 }),
  mug: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 }),
  coffee: new THREE.MeshStandardMaterial({ color: 0x3b1d11, roughness: 0.1 }),
  pot: new THREE.MeshStandardMaterial({ color: 0xe07a5f, roughness: 0.5 }),
  plant: new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.5 }),
  book: [0x2563eb, 0x0284c7, 0x1e3a8a].map(
    (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.4 })
  ),
  page: new THREE.MeshBasicMaterial({ color: 0xf8fafc }),
  yellow: new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.35 }),
  sheetWhite: new THREE.MeshStandardMaterial({ color: 0xffffff }),
  chair: new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.6 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.9, roughness: 0.2 }),
};

// —— 共享几何（供 InstancedMesh 复用；scale 已烘焙进几何，分段数已按软渲优化）——
export const sharedGeometries = {
  chairArm: new THREE.BoxGeometry(0.045, 0.035, 0.40),
  chairWheel: new THREE.CylinderGeometry(0.035, 0.035, 0.025, 6),
  succulentPetal: (() => {
    const g = new THREE.SphereGeometry(0.038, 6, 6);
    g.scale(1, 1.4, 0.6);
    return g;
  })(),
};

// —— 角色共享材质（所有 Agent 外观一致的部件，避免每角色重复建一份）——
export const avatarSharedMats = {
  pants: new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.7 }),
  shoes: new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.4 }),
};

export default workstationMats;
