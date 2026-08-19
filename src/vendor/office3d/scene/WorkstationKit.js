import * as THREE from 'three';
import workstationMats, { sharedGeometries } from './MaterialLibrary.js';

/**
 * 全局工位静态家具实例化库
 *
 * 8 个工位外观完全一致，将每类静态家具零件做成跨工位的 InstancedMesh：
 * 每类零件 1 次 draw call 渲染全部 8 个工位，静态家具的绘制调用从 ~38×8 降到 ~30 次，
 * 阴影 pass 也从 ~14×8 降到 ~14 次。
 *
 * 注意：
 * - 屏幕（每工位纹理内容不同）与椅子（z 轴可动画）仍由 Workstation 单独维护，不在此列。
 * - 所有实例矩阵 = T(deskPos) · T(零件局部坐标) · R(局部旋转)，工位 facingAngle 恒为 0。
 * - 实例索引按「工位主序」填充（desk i 占 idx ∈ [i*perDesk, (i+1)*perDesk)），
 *   供射线拾取时由 instanceId 反查工位（userData.perDesk）。
 */
export class WorkstationKit {
  constructor(scene, desks) {
    this.desks = desks; // [{ id, x, z }] 顺序与 agentsData 一致
    this.group = new THREE.Group();
    scene.add(this.group);
    this.colliders = []; // 参与射线检测的 InstancedMesh 列表

    this.build(desks);
  }

  build(desks) {
    const N = desks.length;
    const mats = workstationMats;

    // 复用临时对象（构造期一次性使用）
    const _euler = new THREE.Euler();
    const _quat = new THREE.Quaternion();
    const _pos = new THREE.Vector3();
    const _scale = new THREE.Vector3(1, 1, 1);

    /**
     * 添加一类静态家具。
     * @param {THREE.BufferGeometry} geo 零件几何
     * @param {THREE.Material} mat 零件材质
     * @param {Object} opts { perDesk, cast, receive, local }
     *   - perDesk: 每工位实例数（如隔板支架 2、多肉花瓣 6）
     *   - local: (deskIdx, k) => ({ pos:[x,y,z], ry }) 零件在工作台局部坐标系的位姿
     */
    const add = (geo, mat, opts = {}) => {
      const perDesk = opts.perDesk || 1;
      const total = N * perDesk;
      const inst = new THREE.InstancedMesh(geo, mat, total);

      desks.forEach((d, i) => {
        for (let k = 0; k < perDesk; k++) {
          const l = opts.local ? opts.local(i, k) : null;
          _euler.set(0, l && l.ry ? l.ry : 0, 0);
          _quat.setFromEuler(_euler);
          _pos.set(d.x + (l ? l.pos[0] : 0), l ? l.pos[1] : 0, d.z + (l ? l.pos[2] : 0));
          inst.setMatrixAt(i * perDesk + k, new THREE.Matrix4().compose(_pos, _quat, _scale));
        }
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.castShadow = !!opts.cast;
      inst.receiveShadow = !!opts.receive;
      inst.userData.perDesk = perDesk;
      this.group.add(inst);
      this.colliders.push(inst);
      return inst;
    };

    // ─── 桌面与桌腿 ───
    add(new THREE.BoxGeometry(3.0, 0.06, 0.90), mats.desk, {
      cast: true, receive: true,
      local: () => ({ pos: [0, 0.85, -0.20] }),
    });
    add(new THREE.BoxGeometry(0.08, 0.82, 0.85), mats.leg, {
      cast: true,
      local: () => ({ pos: [-1.42, 0.41, -0.20] }),
    });
    add(new THREE.BoxGeometry(0.08, 0.82, 0.85), mats.leg, {
      cast: true,
      local: () => ({ pos: [1.42, 0.41, -0.20] }),
    });
    add(new THREE.BoxGeometry(2.7, 0.06, 0.06), mats.leg, {
      local: () => ({ pos: [0, 0.70, -0.45] }),
    });

    // ─── 吸音隔板与金属支架 ───
    add(new THREE.BoxGeometry(2.9, 0.65, 0.05), mats.felt, {
      cast: true,
      local: () => ({ pos: [0, 1.15, -0.63] }),
    });
    add(new THREE.BoxGeometry(0.05, 0.15, 0.08), mats.bracket, {
      perDesk: 2,
      local: (i, k) => ({ pos: [k === 0 ? -1.0 : 1.0, 0.90, -0.63] }),
    });

    // ─── 显示器支架（底座/立柱/双臂/边框） ───
    add(new THREE.CylinderGeometry(0.09, 0.11, 0.05, 10), mats.stand, {
      local: () => ({ pos: [0, 0.90, -0.45] }),
    });
    add(new THREE.CylinderGeometry(0.03, 0.03, 0.45, 10), mats.stand, {
      local: () => ({ pos: [0, 1.12, -0.45] }),
    });
    add(new THREE.BoxGeometry(0.52, 0.025, 0.025), mats.stand, {
      local: () => ({ pos: [-0.32, 1.22, -0.42], ry: 0.25 }),
    });
    add(new THREE.BoxGeometry(0.52, 0.025, 0.025), mats.stand, {
      local: () => ({ pos: [0.32, 1.22, -0.42], ry: -0.25 }),
    });
    // 主/副屏边框（屏幕平面本身在 Workstation 内，纹理内容每工位不同；边框不投影）
    add(new THREE.BoxGeometry(1.30, 0.80, 0.04), mats.bezel, {
      local: () => ({ pos: [-0.52, 1.30, -0.38], ry: 0.12 }),
    });
    add(new THREE.BoxGeometry(1.08, 0.80, 0.04), mats.bezel, {
      local: () => ({ pos: [0.60, 1.30, -0.36], ry: -0.25 }),
    });

    // ─── 键盘 / 鼠标 / 桌垫 ───
    add(new THREE.BoxGeometry(1.5, 0.008, 0.42), mats.deskMat, {
      receive: true,
      local: () => ({ pos: [0, 0.885, 0.02] }),
    });
    add(new THREE.BoxGeometry(0.68, 0.02, 0.24), mats.kbChassis, {
      local: () => ({ pos: [-0.16, 0.895, 0.06] }),
    });
    add(new THREE.BoxGeometry(0.64, 0.015, 0.20), mats.key, {
      local: () => ({ pos: [-0.16, 0.908, 0.06] }),
    });
    add(new THREE.BoxGeometry(0.22, 0.018, 0.035), mats.keyAccent, {
      local: () => ({ pos: [-0.16, 0.91, 0.13] }),
    });
    add(new THREE.BoxGeometry(0.11, 0.035, 0.16), mats.mouse, {
      local: () => ({ pos: [0.38, 0.90, 0.06] }),
    });

    // ─── 桌面道具：咖啡杯 / 多肉 / 书堆 / 文件夹 ───
    add(new THREE.CylinderGeometry(0.065, 0.055, 0.13, 10), mats.mug, {
      local: () => ({ pos: [0.85, 0.94, 0.02] }),
    });
    add(new THREE.CylinderGeometry(0.058, 0.058, 0.018, 10), mats.coffee, {
      local: () => ({ pos: [0.85, 0.99, 0.02] }),
    });
    add(new THREE.TorusGeometry(0.032, 0.01, 6, 10, Math.PI), mats.mug, {
      local: () => ({ pos: [0.91, 0.94, 0.02], ry: Math.PI / 2 }),
    });
    add(new THREE.CylinderGeometry(0.08, 0.06, 0.10, 10), mats.pot, {
      local: () => ({ pos: [-0.95, 0.93, -0.25] }),
    });
    // 多肉 6 瓣 → 8 工位共 48 实例合并为 1 个 InstancedMesh
    add(sharedGeometries.succulentPetal, mats.plant, {
      perDesk: 6,
      local: (i, k) => {
        const angle = (k * Math.PI * 2) / 6;
        return { pos: [-0.95 + Math.cos(angle) * 0.04, 0.99, -0.25 + Math.sin(angle) * 0.04], ry: angle };
      },
    });
    add(new THREE.SphereGeometry(0.03, 6, 6), mats.plant, {
      local: () => ({ pos: [-0.95, 1.02, -0.25] }),
    });
    // 技术书堆（2 本不同颜色）
    add(new THREE.BoxGeometry(0.30, 0.04, 0.40), mats.book[0], {
      local: () => ({ pos: [0.95, 0.90, -0.30], ry: -0.04 }),
    });
    add(new THREE.BoxGeometry(0.28, 0.034, 0.38), mats.page, {
      local: () => ({ pos: [0.95, 0.90, -0.30], ry: -0.04 }),
    });
    add(new THREE.BoxGeometry(0.30, 0.04, 0.40), mats.book[1], {
      local: () => ({ pos: [0.95, 0.942, -0.30], ry: 0.04 }),
    });
    add(new THREE.BoxGeometry(0.28, 0.034, 0.38), mats.page, {
      local: () => ({ pos: [0.95, 0.942, -0.30], ry: 0.04 }),
    });
    // 黄色文件夹与白纸
    add(new THREE.BoxGeometry(0.26, 0.018, 0.34), mats.yellow, {
      local: () => ({ pos: [-0.75, 0.89, 0.02], ry: 0.18 }),
    });
    add(new THREE.BoxGeometry(0.22, 0.014, 0.28), mats.sheetWhite, {
      local: () => ({ pos: [-0.74, 0.90, 0.04], ry: 0.24 }),
    });
  }
}
