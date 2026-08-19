import * as THREE from 'three';

/**
 * 3D Office Environment —— 仅保留正视角度（相机 (0,5.5,14) → (0,1,0)，FOV 34°）下可见的素材
 *
 * 已移除的素材（正视角度下不可见，为省性能全部去掉）：
 * - 左侧墙 + 落地窗：视轴夹角约 50°，完全在视野外
 * - 吊顶线性灯具 ×3：y=6.8 位于视野顶界（17° 半垂直视场）上方
 * - 服务器机柜 + 3 棵盆栽：位于 x=±12.5 之外，超出默认水平视界（~24°）
 *
 * 保留：地板/地毯、背景墙与踢脚线、白板（均位于正对视线上）。
 */
export class OfficeEnvironment {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.initLighting();
    this.buildArchitecture();
    this.buildDecor();
  }

  initLighting() {
    // 1. Warm Ambient Light
    const ambient = new THREE.AmbientLight(0xfff6ea, 1.2);
    this.scene.add(ambient);

    // 2. Hemispheric Sky & Floor Light
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0xdbeafe, 0.8);
    hemiLight.position.set(0, 20, 0);
    this.scene.add(hemiLight);

    // 3. Main Key Sun/Ceiling Light with Soft Shadows
    // 阴影贴图 512²（原 1024²）：场景光照固定、相机仅正视，降低阴影 pass 开销；
    // 阴影本身经 PCFSoft 柔化，黏土卡通风格下视觉差异很小
    const sunLight = new THREE.DirectionalLight(0xfff8ee, 1.8);
    sunLight.position.set(18, 26, 16);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 512;
    sunLight.shadow.mapSize.height = 512;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 80;
    const d = 16;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    sunLight.shadow.bias = -0.0005;
    sunLight.shadow.radius = 2.5;
    this.scene.add(sunLight);

    // 4. Cool Fill Light from opposite side for 3D depth
    const fillLight = new THREE.DirectionalLight(0x93c5fd, 0.6);
    fillLight.position.set(-20, 18, -14);
    this.scene.add(fillLight);
    // 注：原 rimLight（后侧轮廓光）已移除 —— 相机仅正视，其贡献极小，
    // 而每多一个 DirectionalLight 就多一份逐片元光照计算（软渲下尤其昂贵）
  }

  buildArchitecture() {
    // 1. Procedural Wood Plank Floor Texture
    // 512×512（原 1024²）：地板纹理在正视视角下距离较远，降档后视觉几乎无差，
    // 省 ~3MB（CPU canvas + GPU 纹理各半）与采样带宽
    const floorCanvas = document.createElement('canvas');
    floorCanvas.width = 512;
    floorCanvas.height = 512;
    const fctx = floorCanvas.getContext('2d');

    // Base warm wood tone
    fctx.fillStyle = '#e5dfd5';
    fctx.fillRect(0, 0, 512, 512);

    // Wood planks grid
    fctx.strokeStyle = 'rgba(180, 170, 158, 0.4)';
    fctx.lineWidth = 2;
    const plankWidth = 64;
    const plankHeight = 32;

    for (let y = 0; y < 512; y += plankHeight) {
      const offsetX = (Math.floor(y / plankHeight) % 2) * 32;
      for (let x = -32; x < 512 + 32; x += plankWidth) {
        // Slight color variation per plank
        const v = Math.random() * 8 - 4;
        fctx.fillStyle = `rgb(${225 + v}, ${218 + v}, ${208 + v})`;
        fctx.fillRect(x + offsetX, y, plankWidth - 2, plankHeight - 2);
        fctx.strokeRect(x + offsetX, y, plankWidth - 2, plankHeight - 2);
      }
    }

    const floorTexture = new THREE.CanvasTexture(floorCanvas);
    floorTexture.wrapS = THREE.RepeatWrapping;
    floorTexture.wrapT = THREE.RepeatWrapping;
    floorTexture.repeat.set(3, 3);

    // Floor Mesh
    const floorGeo = new THREE.PlaneGeometry(32, 24);
    const floorMat = new THREE.MeshStandardMaterial({
      map: floorTexture,
      roughness: 0.4,
      metalness: 0.05,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.receiveShadow = true;
    this.group.add(floor);

    // Subtle area rug under workstation cluster
    const rugGeo = new THREE.BoxGeometry(19, 0.02, 12.5);
    const rugMat = new THREE.MeshStandardMaterial({
      color: 0xd6d3d1,
      roughness: 0.9,
    });
    const rug = new THREE.Mesh(rugGeo, rugMat);
    rug.position.set(0, 0.01, -0.5);
    rug.receiveShadow = true;
    this.group.add(rug);

    // 2. Back Wall (正视角度下作为背景，保留)
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0xf3f4f6,
      roughness: 0.85,
    });
    const baseboardMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.5,
    });

    const backWallGeo = new THREE.BoxGeometry(32, 9, 0.4);
    const backWall = new THREE.Mesh(backWallGeo, wallMat);
    backWall.position.set(0, 4.5, -11.8);
    backWall.receiveShadow = true;
    this.group.add(backWall);

    const backBaseboard = new THREE.Mesh(new THREE.BoxGeometry(32, 0.35, 0.5), baseboardMat);
    backBaseboard.position.set(0, 0.175, -11.75);
    this.group.add(backBaseboard);
  }

  buildDecor() {
    // Kanban / Whiteboard on Back Wall
    const boardGroup = new THREE.Group();
    boardGroup.position.set(-5, 4.5, -11.55);

    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(7, 3.4, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.4 })
    );
    boardGroup.add(frame);

    const boardSurface = new THREE.Mesh(
      new THREE.BoxGeometry(6.8, 3.2, 0.09),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 })
    );
    boardGroup.add(boardSurface);

    // Sticky notes on Whiteboard
    const noteColors = [0xfef08a, 0x93c5fd, 0xfbcfe8, 0x86efac];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 6; col++) {
        if (Math.random() > 0.3) {
          const colr = noteColors[Math.floor(Math.random() * noteColors.length)];
          const note = new THREE.Mesh(
            new THREE.BoxGeometry(0.55, 0.55, 0.02),
            new THREE.MeshStandardMaterial({ color: colr, roughness: 0.6 })
          );
          note.position.set(-2.4 + col * 0.95, 1.0 - row * 0.9, 0.06);
          note.rotation.z = (Math.random() - 0.5) * 0.1;
          boardGroup.add(note);
        }
      }
    }
    this.group.add(boardGroup);
  }
}
