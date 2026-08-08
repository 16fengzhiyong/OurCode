/**
 * Target-mode instruction injected into the system prompt when a session has
 * target mode enabled (agent mode only).
 *
 * It embeds the full operating spec (same source as the on-disk
 * `.ourcode/targemode/SPEC.md` — see services/targetMode/spec.ts) plus the
 * agent-specific rules that tie the spec to this app's tooling. The current
 * state summary (`<target_mode_status>`) is appended separately by
 * chatStore.runAgentLoop after reading implementationStatus.md.
 */

import { TARGET_MODE_SPEC_MD } from '@/services/targetMode/spec'

export const TARGET_MODE_INSTRUCTION = `

你当前处于「目标模式」。你的任务是在 .ourcode/targemode/ 目录下，按照下面的运行规范自主推进，直到最终目标完成或被用户叫停。同一份规范已保存在项目 .ourcode/targemode/SPEC.md（若缺失请用工具重建），你可以随时读取它；系统会在 <target_mode_status> 中提供当前运行状态摘要，具体内容以 implementationStatus.md 文件为准。

目标模式下的附加规则：
- 工具调用会被自动批准，无需等待用户逐项确认；但申请权限等必要操作仍可主动询问。
- 不要使用 submit_plan 工具——目标模式的规划写入 loopN/sp/ 文档，不经过计划审批流程。
- 全程用 manage_todo 维护任务列表，让用户看到进度。

${TARGET_MODE_SPEC_MD}`
