import * as THREE from 'three';

/**
 * DynamicScreen creates high-resolution CanvasTextures for workstation dual monitors
 * accurately rendering active states: Code IDE, Git Diff, Thinking Neural Net, Error Crash, or Power OFF.
 */
export class DynamicScreen {
  constructor(agentId, role, isSecondary = false) {
    this.agentId = agentId;
    this.role = role;
    this.isSecondary = isSecondary;
    this.status = 'idle';

    // 逻辑尺寸固定 512×320，画布降为半分辨率 256×160（绘制时整体缩放）
    // 屏幕在 3D 场景中很小，肉眼几乎无差别，但纹理内存/上传带宽降为 1/4
    this.LOGICAL_W = 512;
    this.LOGICAL_H = 320;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.LOGICAL_W / 2;
    this.canvas.height = this.LOGICAL_H / 2;
    this.ctx = this.canvas.getContext('2d');

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    this.time = Math.random() * 100;
    this.codeLineOffset = 0;
    this.blinkTimer = 0;
    this.redrawAcc = 0; // 降频重绘计时器（10Hz，低帧率档会进一步拉长）
    this.redrawInterval = 0.1; // 重绘间隔（秒），由 OfficeScene 按帧率档联动
    this._lastIdleActivity = -1; // idle 副屏静态帧跟踪（活动周期切换时才重绘）

    this.codeLines = [
      "import { AgentEngine, Vector3 } from '@ai/core';",
      "const agent = new AgentEngine({ id: " + agentId + " });",
      "async function dispatchTask(payload: TaskEvent) {",
      "  const stream = await runtime.route(payload);",
      "  for await (const chunk of stream) {",
      "    pipeline.process(chunk.embeddings);",
      "    if (chunk.status === 'READY') {",
      "      renderWorker.syncFrame(chunk.matrix);",
      "    }",
      "  }",
      "  return { status: 200, latency: '4.2ms' };",
      "}",
      "export default compose(withCache, memo)(agent);"
    ];

    // 预计算 IDE 代码行的分词与宽度（字体固定不变，避免每帧调用昂贵的 measureText）
    this.ctx.font = '13px Consolas, "Courier New", monospace';
    this._lineLayout = this.codeLines.map((line) =>
      line.split(/(\s+|[(){}[\];,=])/).map((w) => ({ text: w, width: this.ctx.measureText(w).width }))
    );

    this.render();
  }

  setStatus(newStatus) {
    if (this.status !== newStatus) {
      this.status = newStatus;
      this.render();
      this.texture.needsUpdate = true;
    }
  }

  update(deltaTime) {
    this.time += deltaTime;
    this.blinkTimer += deltaTime;

    if (this.status === 'offline') return; // 黑屏静态，无需重绘

    // 静态帧跳过重绘：completed / reviewing / PM-UI 静态屏 / idle 副屏，
    // 直接砍掉 canvas 绘制与纹理上传（详见 isStaticFrame）
    if (this.isStaticFrame()) return;

    this.codeLineOffset += deltaTime * 25;

    // 降频重绘：10Hz（或按帧率档拉长），大幅降低 CPU 与纹理上传开销
    this.redrawAcc += deltaTime;
    if (this.redrawAcc >= this.redrawInterval) {
      this.redrawAcc = 0;
      this.render();
      this.texture.needsUpdate = true;
    }
  }

  /** 按目标帧率设置重绘间隔：低帧率档时渲染已卡，屏幕重绘同步降频 */
  setRedrawInterval(seconds) {
    this.redrawInterval = Math.max(0.05, seconds);
  }

  /**
   * 当前帧是否为完全静止画面（无需按 10Hz 重绘）。
   * 静态画面只在 setStatus 进入该状态时绘制一次，直到状态改变或活动周期切换。
   */
  isStaticFrame() {
    if (this.status === 'completed' || this.status === 'reviewing') return true;

    if (this.status === 'working') {
      const isUI = this.role.includes('设计') || this.agentId === 3;
      const isPM = this.role.includes('需求') || this.role.includes('总监') || this.agentId === 1 || this.agentId === 2;
      // PM 甘特图 / UI Figma 稿为纯静态画面；QA/开发屏含滚动代码等动画，需持续重绘
      return !this.isSecondary && (isUI || isPM);
    }

    if (this.status === 'idle' && this.isSecondary) {
      // 副屏（游戏频道 / 待机 feed）为静态文本，仅当 18s 活动周期切换时需重绘一次
      const activity = Math.floor((this.time + this.agentId * 5.3) / 18) % 3;
      if (activity === this._lastIdleActivity) return true;
      this._lastIdleActivity = activity;
    }

    return false;
  }

  render() {
    const ctx = this.ctx;
    const w = this.LOGICAL_W;
    const h = this.LOGICAL_H;
    const t = this.time;

    // 半分辨率输出：整体缩放到 256×160 画布（每次 setTransform 会重置之前的变换）
    ctx.setTransform(0.5, 0, 0, 0.5, 0, 0);

    // Clear
    ctx.clearRect(0, 0, w, h);

    if (this.status === 'offline') {
      // 1. Power OFF / Vacant Workstation -> Pitch Black
      ctx.fillStyle = '#06070a';
      ctx.fillRect(0, 0, w, h);
      
      // Screen bezel reflection
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, 'rgba(255, 255, 255, 0.03)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0.4)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Faint standby LED in bottom corner
      ctx.fillStyle = 'rgba(239, 68, 68, 0.4)';
      ctx.beginPath();
      ctx.arc(w - 20, h - 16, 2.5, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    if (this.status === 'working') {
      // 2. Working -> Role-Specific Screen Displays (Dev IDE, UI Figma Mockup, QA Bug Screen, PM Gantt)
      const isQA = this.role.includes('测试') || this.agentId === 7 || this.agentId === 8;
      const isUI = this.role.includes('设计') || this.agentId === 3;
      const isPM = this.role.includes('需求') || this.role.includes('总监') || this.agentId === 1 || this.agentId === 2;

      if (isQA && !this.isSecondary) {
        // --- QA Role: BUG TESTING & Issues Tracker Screen (Prop 9) ---
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(0, 0, w, h);

        // Header Banner
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, w, 32);
        ctx.fillStyle = '#facc15';
        ctx.font = 'bold 13px "Segoe UI", sans-serif';
        ctx.fillText("🐞 BUG TESTING & QA VALIDATION", 20, 21);

        // Big Red Bug Icon on Left
        const bugX = 110;
        const bugY = 145;
        // Legs
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 3;
        for (let leg = -2; leg <= 2; leg++) {
          if (leg === 0) continue;
          ctx.beginPath();
          ctx.moveTo(bugX, bugY + leg * 10);
          ctx.lineTo(bugX + (leg > 0 ? 38 : -38), bugY + leg * 15);
          ctx.stroke();
        }
        // Bug Body
        ctx.fillStyle = '#dc2626';
        ctx.beginPath();
        ctx.arc(bugX, bugY, 28, 0, Math.PI * 2);
        ctx.fill();
        // Bug Head
        ctx.fillStyle = '#991b1b';
        ctx.beginPath();
        ctx.arc(bugX, bugY - 26, 14, 0, Math.PI * 2);
        ctx.fill();
        // Eyes
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(bugX - 5, bugY - 28, 3, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(bugX + 5, bugY - 28, 3, 0, Math.PI * 2); ctx.fill();

        // Right side QA Stats
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 16px "Segoe UI", sans-serif';
        ctx.fillText("ISSUES FOUND: 7", 190, 75);

        ctx.font = '12px "Segoe UI", sans-serif';
        ctx.fillStyle = '#4ade80';
        ctx.fillText("PASS: 124 / 131 Cases (94.6%)", 190, 110);
        // Green Pass Bar
        ctx.fillStyle = '#166534';
        ctx.fillRect(190, 120, 280, 14);
        ctx.fillStyle = '#22c55e';
        ctx.fillRect(190, 120, 260, 14);

        ctx.fillStyle = '#f87171';
        ctx.fillText("FAIL / CRITICAL: 7 Blocks", 190, 160);
        // Red Fail Bar
        ctx.fillStyle = '#7f1d1d';
        ctx.fillRect(190, 170, 280, 14);
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(190, 170, 45, 14);

        // Bottom logs
        ctx.fillStyle = '#94a3b8';
        ctx.font = '11px Consolas, monospace';
        ctx.fillText(`> [E2E-AUTO] Test cycle #${Math.floor(t * 2) % 99 + 1} executing smoothly`, 30, h - 25);
        return;
      }

      if (isUI && !this.isSecondary) {
        // --- UI Designer: FIGMA / APP MOCKUP CANVAS (Prop 8) ---
        ctx.fillStyle = '#e2e8f0';
        ctx.fillRect(0, 0, w, h);

        // Figma Toolbar
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, w, 28);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px "Segoe UI", sans-serif';
        ctx.fillText("❖ Figma — Mobile 3D Agent App (v3.2)", 20, 18);

        // 3 App Screens Mockup side by side
        const appW = 100;
        const appH = 190;
        const appY = 48;

        // Phone 1: Login / Profile Screen
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.roundRect(40, appY, appW, appH, 8); ctx.fill();
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath(); ctx.arc(90, appY + 45, 18, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#0284c7';
        ctx.fillRect(60, appY + 80, 60, 16);
        ctx.fillStyle = '#f59e0b';
        ctx.fillRect(60, appY + 110, 60, 20);

        // Phone 2: Dashboard Cards
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.roundRect(170, appY, appW, appH, 8); ctx.fill();
        ctx.fillStyle = '#f43f5e';
        ctx.fillRect(182, appY + 25, 76, 30);
        ctx.fillStyle = '#22c55e';
        ctx.fillRect(182, appY + 65, 76, 40);
        ctx.fillStyle = '#a855f7';
        ctx.fillRect(182, appY + 115, 76, 45);

        // Phone 3: Analytics Graph
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.roundRect(300, appY, appW, appH, 8); ctx.fill();
        ctx.fillStyle = '#3b82f6';
        ctx.fillRect(315, appY + 25, 70, 12);
        // Bar Chart
        const barHeights = [25, 55, 40, 80, 65];
        barHeights.forEach((bh, bIdx) => {
          ctx.fillStyle = bIdx % 2 === 0 ? '#38bdf8' : '#6366f1';
          ctx.fillRect(315 + bIdx * 14, appY + 140 - bh, 10, bh);
        });

        // Bottom status
        ctx.fillStyle = '#475569';
        ctx.font = '11px sans-serif';
        ctx.fillText("Layers: 48 Frames | Auto-Layout: ON | 100% Zoom", 40, h - 18);
        return;
      }

      if (isPM && !this.isSecondary) {
        // --- PM / Director: ROADMAP & GANTT CHART ---
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(0, 0, w, h);

        ctx.fillStyle = '#1e293b';
        ctx.fillRect(0, 0, w, 28);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px "Segoe UI", sans-serif';
        ctx.fillText("📋 Sprint 14 PRD & Agent Delivery Topology", 20, 18);

        // Gantt Chart Rows
        const gantt = [
          { name: "3D 场景建模与贴图提取", progress: 0.95, col: '#22c55e' },
          { name: "8 人物骨骼动画与微姿态", progress: 0.85, col: '#3b82f6' },
          { name: "任务抛物线与走动交接", progress: 0.70, col: '#a855f7' },
          { name: "全链路压测与 Bug 验收", progress: 0.45, col: '#f59e0b' }
        ];

        gantt.forEach((g, gIdx) => {
          const gy = 55 + gIdx * 45;
          ctx.fillStyle = '#334155';
          ctx.font = 'bold 12px "Segoe UI", sans-serif';
          ctx.fillText(g.name, 30, gy + 14);

          // Bar Background
          ctx.fillStyle = '#e2e8f0';
          ctx.fillRect(200, gy, 260, 20);
          // Progress Fill
          ctx.fillStyle = g.col;
          ctx.fillRect(200, gy, 260 * g.progress, 20);

          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 11px sans-serif';
          ctx.fillText(`${Math.floor(g.progress * 100)}%`, 210, gy + 14);
        });

        ctx.fillStyle = '#64748b';
        ctx.font = '11px sans-serif';
        ctx.fillText("Sprint Health Index: 98.4% · Target Release: Today 18:00", 30, h - 20);
        return;
      }

      // Default: Developer Syntax Highlighted IDE & Terminal (Prop 7)
      ctx.fillStyle = '#0d1117';
      ctx.fillRect(0, 0, w, h);

      // Top title bar
      ctx.fillStyle = '#161b22';
      ctx.fillRect(0, 0, w, 28);
      // Window buttons
      ctx.fillStyle = '#ff5f56'; ctx.beginPath(); ctx.arc(16, 14, 4.5, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#ffbd2e'; ctx.beginPath(); ctx.arc(30, 14, 4.5, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#27c93f'; ctx.beginPath(); ctx.arc(44, 14, 4.5, 0, Math.PI*2); ctx.fill();

      // Tab
      ctx.fillStyle = '#0d1117';
      ctx.fillRect(60, 4, 120, 24);
      ctx.fillStyle = '#58a6ff';
      ctx.font = 'bold 12px "Segoe UI", monospace';
      ctx.fillText(this.isSecondary ? 'Terminal #1' : `Agent_${this.agentId}.ts`, 70, 20);

      if (!this.isSecondary) {
        // Main IDE Code Editor
        ctx.fillStyle = '#30363d';
        ctx.fillRect(0, 28, 40, h - 28); // Line numbers gutter

        ctx.font = '13px Consolas, "Courier New", monospace';
        const startY = 50;
        const lineH = 20;
        const numLines = this.codeLines.length;

        for (let i = 0; i < 14; i++) {
          const lineIndex = Math.floor((i + this.codeLineOffset / lineH)) % numLines;
          const y = startY + i * lineH;
          if (y > h - 10) break;

          // Line number
          ctx.fillStyle = '#484f58';
          ctx.fillText((i + 1).toString().padStart(2, ' '), 12, y);

          // Code syntax coloring（分词宽度已在构造时预计算，避免每帧 measureText）
          const layout = this._lineLayout[lineIndex] || [];
          let x = 50;
          for (let li = 0; li < layout.length; li++) {
            const w = layout[li].text;
            if (['import', 'const', 'async', 'function', 'for', 'await', 'if', 'return', 'export', 'default'].includes(w)) {
              ctx.fillStyle = '#ff7b72'; // Keyword pink
            } else if (['AgentEngine', 'Vector3', 'TaskEvent'].includes(w)) {
              ctx.fillStyle = '#79c0ff'; // Type cyan
            } else if (w.startsWith("'") || w.startsWith('"')) {
              ctx.fillStyle = '#a5d6ff'; // String blue
            } else if (!isNaN(Number(w))) {
              ctx.fillStyle = '#d2a8ff'; // Number purple
            } else {
              ctx.fillStyle = '#c9d1d9'; // Identifier
            }
            ctx.fillText(w, x, y);
            x += layout[li].width;
          }
        }

        // Animated blinking cursor
        if (Math.floor(this.blinkTimer * 3) % 2 === 0) {
          ctx.fillStyle = '#58a6ff';
          ctx.fillRect(180, 50 + (Math.floor(this.time * 2) % 10) * lineH - 12, 8, 15);
        }
      } else {
        // Secondary Screen: Realtime Terminal logs & CPU Graph
        ctx.font = '12px Consolas, monospace';
        ctx.fillStyle = '#3fb950';
        ctx.fillText(`[AGENT-ONLINE] ID:${this.agentId} WORKER_ACTIVE`, 20, 50);
        ctx.fillStyle = '#8b949e';
        ctx.fillText(`THREADS: 8 | FPS: 60 | GPU_MEM: 142MB`, 20, 70);

        // Waveform/Graph
        ctx.strokeStyle = '#238636';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let gx = 20; gx < w - 20; gx += 5) {
          const gy = 150 + Math.sin((gx + t * 40) * 0.05) * 30 + Math.cos((gx - t * 20) * 0.08) * 15;
          if (gx === 20) ctx.moveTo(gx, gy);
          else ctx.lineTo(gx, gy);
        }
        ctx.stroke();

        ctx.fillStyle = '#58a6ff';
        ctx.fillText(`> Task progress: 84% [▓▓▓▓▓▓▓▓▓▓▓▓░░]`, 20, 230);
        ctx.fillStyle = '#3fb950';
        ctx.fillText(`> Latency: 3.4ms | Throughput: 1.2k ops/s`, 20, 260);
      }
      return;
    }

    if (this.status === 'reviewing') {
      // 3. Reviewing -> Git Diff (Red & Green lines)
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, w, h);

      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, 0, w, 32);
      ctx.fillStyle = '#818cf8';
      ctx.font = 'bold 13px "Segoe UI", sans-serif';
      ctx.fillText(`[GIT DIFF REVIEW] commit: #3d8a9f (Agent ${this.agentId})`, 20, 22);

      // Split 2-column Diff
      const mid = w / 2;
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(mid - 1, 32, 2, h - 32);

      // Red deleted side
      ctx.fillStyle = 'rgba(239, 68, 68, 0.15)';
      ctx.fillRect(10, 45, mid - 20, 38);
      ctx.fillStyle = '#f87171';
      ctx.font = '12px Consolas, monospace';
      ctx.fillText("- const renderMode = '2D_CANVAS';", 20, 68);

      // Green added side
      ctx.fillStyle = 'rgba(34, 197, 94, 0.15)';
      ctx.fillRect(mid + 10, 45, mid - 20, 38);
      ctx.fillStyle = '#4ade80';
      ctx.fillText("+ const renderMode = '3D_THREE_JS';", mid + 20, 68);

      // Next diff chunk
      ctx.fillStyle = 'rgba(34, 197, 94, 0.15)';
      ctx.fillRect(mid + 10, 95, mid - 20, 60);
      ctx.fillStyle = '#4ade80';
      ctx.fillText("+ enableBezierFlight(task3D);", mid + 20, 118);
      ctx.fillText("+ bindPreciseSelectionRing();", mid + 20, 138);

      // Status badge
      ctx.fillStyle = '#6366f1';
      ctx.fillRect(20, h - 45, 140, 26);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText("✓ APPROVE & MERGE", 32, h - 28);
      return;
    }

    if (this.status === 'thinking') {
      // 4. Thinking -> Neural Graph & Topology Network
      ctx.fillStyle = '#090714';
      ctx.fillRect(0, 0, w, h);

      ctx.fillStyle = '#a855f7';
      ctx.font = 'bold 13px "Segoe UI", sans-serif';
      ctx.fillText("✦ NEURAL THINKING & REASONING ✦", 20, 25);

      // Draw animated pulsing nodes
      const nodes = [
        { x: 120, y: 120 }, { x: 256, y: 80 }, { x: 380, y: 130 },
        { x: 180, y: 220 }, { x: 320, y: 220 }, { x: 256, y: 160 }
      ];

      // Connecting lines
      ctx.strokeStyle = 'rgba(168, 85, 247, 0.4)';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          ctx.beginPath();
          ctx.moveTo(nodes[i].x, nodes[i].y);
          ctx.lineTo(nodes[j].x, nodes[j].y);
          ctx.stroke();
        }
      }

      // Glowing nodes
      nodes.forEach((n, idx) => {
        const pulse = Math.sin(t * 4 + idx) * 4 + 8;
        const grad = ctx.createRadialGradient(n.x, n.y, 2, n.x, n.y, pulse * 2);
        grad.addColorStop(0, '#c084fc');
        grad.addColorStop(0.5, 'rgba(168, 85, 247, 0.5)');
        grad.addColorStop(1, 'rgba(168, 85, 247, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(n.x, n.y, pulse * 2, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(n.x, n.y, 4, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.fillStyle = '#e9d5ff';
      ctx.font = '12px Consolas, monospace';
      ctx.fillText(`Analyzing context windows: 128k tokens... [depth:${Math.floor(t*2)%6 + 1}]`, 40, h - 25);
      return;
    }

    if (this.status === 'receiving') {
      // 5. Receiving -> Data Stream download
      ctx.fillStyle = '#081e28';
      ctx.fillRect(0, 0, w, h);

      ctx.fillStyle = '#06b6d4';
      ctx.font = 'bold 14px "Segoe UI", sans-serif';
      ctx.fillText("↓ INCOMING 3D TASK PAYLOAD", 20, 30);

      // Progress bar
      const prog = (Math.sin(t * 3) * 0.5 + 0.5);
      ctx.fillStyle = '#164e63';
      ctx.fillRect(40, 100, w - 80, 24);
      ctx.fillStyle = '#06b6d4';
      ctx.fillRect(40, 100, (w - 80) * prog, 24);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px Consolas, monospace';
      ctx.fillText(`RECEIVING: ${Math.floor(prog * 100)}% · 84.2 MB/s`, 50, 117);

      // Packet streams
      ctx.fillStyle = '#67e8f9';
      ctx.font = '11px Consolas, monospace';
      ctx.fillText(`+ Chunk [${Math.floor(t * 10) % 999}]: TaskSpecification.proto`, 40, 160);
      ctx.fillText(`+ Verification hash: 0x${Math.floor(t * 12345).toString(16).toUpperCase()}`, 40, 185);
      ctx.fillText(`+ Sender: Upstream Orchestrator Agent`, 40, 210);
      return;
    }

    if (this.status === 'completed') {
      // 6. Completed -> Big Green Checkmark
      ctx.fillStyle = '#06281e';
      ctx.fillRect(0, 0, w, h);

      ctx.fillStyle = '#10b981';
      ctx.beginPath();
      ctx.arc(w / 2, 110, 42, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 44px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText("✓", w / 2, 126);

      ctx.font = 'bold 18px "Segoe UI", sans-serif';
      ctx.fillText("TASK COMPLETED 100%", w / 2, 190);

      ctx.fillStyle = '#6ee7b7';
      ctx.font = '12px Consolas, monospace';
      ctx.fillText("Execution Time: 00:04:18 | Errors: 0", w / 2, 225);
      ctx.fillText("All pipeline gates passed smoothly", w / 2, 250);
      ctx.textAlign = 'left';
      return;
    }

    if (this.status === 'error') {
      // 7. Error -> Red Crash Screen & Alert
      const flash = Math.floor(t * 5) % 2 === 0;
      ctx.fillStyle = flash ? '#450a0a' : '#1f0606';
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, w - 6, h - 6);

      ctx.fillStyle = '#ef4444';
      ctx.font = 'bold 22px "Segoe UI", sans-serif';
      ctx.fillText("⚠ EXCEPTION ENCOUNTERED", 30, 45);

      ctx.fillStyle = '#fca5a5';
      ctx.font = '12px Consolas, monospace';
      ctx.fillText("Error: Execution Timeout in AgentTaskPipeline()", 30, 85);
      ctx.fillText("at WorkerNode.processQueue (worker.js:142:9)", 30, 110);
      ctx.fillText("at async AgentRuntime.evaluate (runtime.js:88:3)", 30, 130);
      ctx.fillText("Status: Awaiting intervention / auto-recovery", 30, 160);

      // Warning beacon
      ctx.fillStyle = flash ? '#ef4444' : '#7f1d1d';
      ctx.fillRect(30, 200, w - 60, 36);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 14px sans-serif';
      ctx.fillText("RETRYING AUTOMATICALLY (Attempt 3/5)...", 50, 224);
      return;
    }

    // --- 8. IDLE / STANDBY / GAMING SCREENS ---
    const cyclePeriod = 18;
    const idleActivityIndex = Math.floor((t + this.agentId * 5.3) / cyclePeriod) % 3;

    if (idleActivityIndex === 2) {
      // --- GAMING MODE (玩电脑游戏): Dynamic Space Arcade Shooter ---
      if (!this.isSecondary) {
        // Main Screen: 2D Arcade Pixel Shooter Game
        ctx.fillStyle = '#060913';
        ctx.fillRect(0, 0, w, h);

        // Animated Starfield
        for (let i = 0; i < 40; i++) {
          const sx = (i * 37 + Math.sin(i * 10) * 80) % w;
          const sy = (i * 23 + t * (40 + (i % 4) * 30)) % h;
          const sSize = (i % 3) + 1;
          ctx.fillStyle = i % 2 === 0 ? '#38bdf8' : '#e0f2fe';
          ctx.fillRect(sx, sy, sSize, sSize);
        }

        // Top Arcade HUD
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(0, 0, w, 28);
        ctx.fillStyle = '#facc15';
        ctx.font = 'bold 12px Consolas, monospace';
        const score = 18400 + Math.floor(t * 150);
        ctx.fillText(`★ CYBER STRIKE 2088 ★`, 15, 18);
        ctx.fillStyle = '#4ade80';
        ctx.fillText(`SCORE: ${score}`, 220, 18);
        ctx.fillStyle = '#f43f5e';
        ctx.fillText(`LIVES: ♥ ♥ ♥`, 380, 18);

        // Alien Invader Fleet
        const fleetX = Math.sin(t * 2) * 50;
        for (let r = 0; r < 2; r++) {
          for (let c = 0; c < 6; c++) {
            const ex = 70 + c * 60 + fleetX;
            const ey = 50 + r * 40 + Math.sin(t * 4 + c) * 6;
            ctx.fillStyle = r === 0 ? '#ec4899' : '#a855f7';
            // Draw pixel invader body
            ctx.fillRect(ex, ey, 24, 16);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(ex + 4, ey + 4, 4, 4);
            ctx.fillRect(ex + 16, ey + 4, 4, 4);
          }
        }

        // Player Spaceship
        const playerX = w / 2 + Math.sin(t * 3.5) * 110;
        const playerY = h - 45;

        // Laser Bullets
        for (let b = 0; b < 3; b++) {
          const by = (playerY - 20 - ((t * 280 + b * 70) % (h - 70)));
          ctx.fillStyle = '#38bdf8';
          ctx.fillRect(playerX + 10, by, 4, 14);
          ctx.fillStyle = '#67e8f9';
          ctx.fillRect(playerX + 8, by + 2, 8, 8);
        }

        // Ship body
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.moveTo(playerX + 12, playerY);
        ctx.lineTo(playerX + 28, playerY + 24);
        ctx.lineTo(playerX - 4, playerY + 24);
        ctx.closePath();
        ctx.fill();

        // Ship thruster flame
        ctx.fillStyle = Math.sin(t * 20) > 0 ? '#fb923c' : '#facc15';
        ctx.fillRect(playerX + 8, playerY + 24, 8, 8 + Math.sin(t * 30) * 4);

        // Bottom Banner
        ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
        ctx.fillRect(0, h - 22, w, 22);
        ctx.fillStyle = '#94a3b8';
        ctx.font = '11px Consolas, monospace';
        ctx.fillText(`STAGE: 04 [ASTEROID BELT]  ·  COMBO x12  ·  POWER: 100%`, 20, h - 8);

      } else {
        // Secondary Screen: Discord Gaming Channel & Voice Stream
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, w, h);

        ctx.fillStyle = '#1e293b';
        ctx.fillRect(0, 0, w, 28);
        ctx.fillStyle = '#818cf8';
        ctx.font = 'bold 12px "Segoe UI", sans-serif';
        ctx.fillText(`💬 #gaming-lounge (Agent Office)`, 15, 18);

        // Chat stream messages
        const msgs = [
          { name: 'Dev-05', col: '#38bdf8', msg: 'Dodged the boss missile! +500 XP' },
          { name: 'PM-02', col: '#14b8a6', msg: 'Haha nice shot! Boss is in meeting.' },
          { name: 'QA-07', col: '#fb923c', msg: 'Next round coop mode? Inviting...' },
          { name: 'UI-03', col: '#c084fc', msg: 'Loving the pixel particle effects!' },
        ];

        let my = 55;
        msgs.forEach((m) => {
          ctx.fillStyle = m.col;
          ctx.font = 'bold 11px sans-serif';
          ctx.fillText(`@${m.name}:`, 20, my);
          ctx.fillStyle = '#e2e8f0';
          ctx.font = '11px sans-serif';
          ctx.fillText(m.msg, 90, my);
          my += 35;
        });

        // Bottom stats
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(15, h - 55, w - 30, 42);
        ctx.fillStyle = '#22c55e';
        ctx.font = 'bold 11px Consolas, monospace';
        ctx.fillText(`● VOICE CONNECTED (8 Agents) · 144 FPS · 12ms`, 25, h - 30);
      }

    } else {
      // --- PHONE & DRINK MODE (玩手机/喝水): Ambient Standby Dashboard ---
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, w, h);

      // Subtle wallpaper header
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, 0, w, 28);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '11px sans-serif';
      ctx.fillText(`Workspace · ${this.role} · Standby`, 15, 18);

      if (!this.isSecondary) {
        // Digital Clock
        ctx.fillStyle = '#e2e8f0';
        ctx.font = 'bold 38px "Segoe UI", sans-serif';
        const now = new Date();
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
        ctx.fillText(timeStr, 35, 85);

        ctx.fillStyle = '#64748b';
        ctx.font = '13px sans-serif';
        ctx.fillText("Agent Standby · Ready for next dispatch", 35, 115);

        // Music Player / Lo-Fi Audio Waveform
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(35, 140, w - 70, 70);

        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText("♪ Lo-Fi Coding Beats · Relax Session", 50, 165);

        // Audio Frequency bars
        for (let b = 0; b < 24; b++) {
          const barH = 8 + Math.abs(Math.sin(t * 6 + b * 0.4)) * 24;
          ctx.fillStyle = b % 2 === 0 ? '#38bdf8' : '#818cf8';
          ctx.fillRect(50 + b * 16, 200 - barH, 10, barH);
        }

        // Status pill
        ctx.fillStyle = '#0f766e';
        ctx.fillRect(35, 235, 140, 26);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px sans-serif';
        ctx.fillText("● SYSTEM OPTIMAL", 48, 252);

      } else {
        // Tech News & System Metrics
        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 13px sans-serif';
        ctx.fillText("⚡ Office Live Dispatch Feed", 20, 55);

        ctx.fillStyle = '#94a3b8';
        ctx.font = '12px Consolas, monospace';
        ctx.fillText("> GPU Compute Pipeline: IDLE", 20, 85);
        ctx.fillText("> Model Inference Latency: 4.2ms", 20, 110);
        ctx.fillText("> Awaiting Next Sprint Task Queue...", 20, 135);

        // Mini metric cards
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(20, 165, 110, 60);
        ctx.fillRect(145, 165, 110, 60);

        ctx.fillStyle = '#22c55e';
        ctx.font = 'bold 16px sans-serif';
        ctx.fillText("99.9%", 35, 195);
        ctx.fillText("0.02s", 160, 195);

        ctx.fillStyle = '#94a3b8';
        ctx.font = '11px sans-serif';
        ctx.fillText("System Health", 35, 212);
        ctx.fillText("Queue Delay", 160, 212);
      }
    }
  }
}
