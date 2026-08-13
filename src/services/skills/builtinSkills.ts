/**
 * Built-in skills that ship with the IDE.
 *
 * Unlike user / registry / imported skills — which are discovered from
 * `.ourcode/skills`, `skills`, or `<userData>/skills` on disk — these are
 * compiled into the app: they are always enabled, cannot be disabled
 * (setSkillEnabled) or deleted (uninstallSkill), and always win over any
 * same-named skill on disk (SkillManager's dedup keeps the built-in copy).
 *
 * The protected "skill-creator" lives here: the skill that teaches the model
 * how to author and iterate on new skills for OurCode.
 */

export interface BuiltinSkill {
  name: string
  description: string
  /** Full SKILL.md content (YAML frontmatter + markdown body). */
  content: string
}

const SKILL_CREATOR_CONTENT = `---
name: skill-creator
description: 创建、改进与迭代自定义技能（skill）。当用户想新建一个技能、把重复的工作流沉淀为可复用技能、修改已有技能的 SKILL.md、或优化技能的触发描述时使用——即使用户没有明说「技能」，只要表达了「把这件事固化下来 / 以后自动执行」的意图，也应主动触发本技能。
---

# 技能创建器（skill-creator）

用于编写并持续改进 OurCode 自定义技能。

## 核心循环

- 搞清楚这个技能要做什么、大致怎么做。
- 写一版技能草稿（SKILL.md）。
- 用 2–3 个真实测试提示词试跑。
- 和用户一起看输出并修改。
- 重复，直到技能足够好用。

你被加载后，先判断用户处在循环的哪一步：可能说「我想要一个 XX 技能」（从最上面开始），也可能已有草稿（跳到评估/迭代）。要灵活——用户说「先别正式评估，随便聊聊」就照做。

## 与用户沟通

使用者从资深技能作者到新手都有，注意上下文线索；不确定时用一句话解释术语（例如「评估提示词就是发给你、看技能表现的一条测试消息」），不要假设对方熟悉。

---

## 创建技能

### 1. 明确意图

先搞清楚用户要什么。如果当前对话已经体现出值得沉淀的工作流（例如用户反复手动做同一件事，并说「把这个做成技能」），先从对话历史里提取答案——用了哪些工具、步骤顺序、用户做的修正、输入输出格式。有缺口先向用户确认，再写草稿。

需要问清楚：

1. 这个技能要让模型能做什么？
2. 什么时候触发？用户的哪些说法或场景该触发它？
3. 期望的输出格式是什么？
4. 有没有示例输入/输出可以把行为锁死？

### 2. 技能放在哪里

OurCode 在以下目录发现技能（优先级从高到低）：

- 项目 .ourcode/skills/<name>/SKILL.md —— 项目技能，随项目走。
- 项目 skills/<name>/SKILL.md —— 注册中心/导入技能的落地目录。
- <userData>/skills/<name>/SKILL.md —— 全局技能，处处可用。

默认把新技能写到项目 .ourcode/skills/ —— 它是项目级、可随源码一起提交的标准位置。想让技能在所有项目通用，写到 <userData>/skills/。同一个名字如果在多处都存在，项目技能优先于全局技能。

### 3. 写 SKILL.md

每个技能是一个目录，内含 SKILL.md（YAML frontmatter + markdown 正文）：

    my-skill/
    ├── SKILL.md          (必需)
    └── (可选)
        ├── references/   (按需阅读的补充文档)
        ├── scripts/      (可调用的辅助脚本)
        └── assets/       (模板、fixture 等)

必需的 frontmatter：

- name —— 技能标识符，小写 kebab-case，1–64 字符，必须与目录名一致。
- description —— 什么时候触发、做什么。这是主要的触发信号——「做什么」和「什么场景」都写在这里，而不是正文里。模型倾向于少触发技能，所以描述要写得主动一点：与其写「构建内部数据仪表盘」，不如写「构建快速的内部数据仪表盘。当用户提到仪表盘、数据可视化、内部指标，或想展示任何公司数据时使用——即使没说『仪表盘』这个词」。

大多数技能只需要 name 和 description 两个字段。

### 4. 渐进式披露

OurCode 分三层加载技能：

1. 元数据（name + description）始终在上下文里，保持简短。
2. SKILL.md 正文在技能触发时才加载，尽量控制在 500 行以内。
3. 打包文件（references/、scripts/、assets/）按需读取，原则上不限大小。

正文太长时，把领域细节拆到 reference 文件里，并在 SKILL.md 里告诉模型何时去读。

### 5. 写作风格

用祈使句（「编辑前先读取文件」）。规则不显然时解释为什么——现代模型理解了原因会执行得更好。发现自己开始写全大写的 MUST/NEVER 时，通常是规则需要更好的解释，而不是更响的强调。

示例胜过规则。技能产出结构化内容时，给出字面示例；要用特定工具时，展示调用方式。

### 6. 测试提示词

写好草稿后，拟 2–3 个真实测试提示词——用户真的会打的那种，带具体文件路径、列名、口语化甚至带错别字。分享给用户：「我想试这几个场景，要补充或改动吗？」

然后逐个跑：加载草稿技能，把测试提示词交给模型，看结果。一次跑一个，逐个和用户一起看。

---

## 评估草稿

对每个测试提示词：

1. 确认草稿技能已经在 OurCode 能发现的位置（上面列出的目录之一）。
2. 在新的一轮对话里，把测试提示词交给模型。要么靠 description 触发，要么用 /技能名 提示词 强制加载。
3. 和用户一起看结果：触发了吗？输出符合预期吗？哪里跑偏了？

同时记录结果和轨迹：如果技能让模型做了一堆无用功（反复重读同一批文件、写一次性脚本、原地打转），说明技能写得过重或不清——那是「删减」的信号，不是「加更多规则」的信号。

---

## 改进技能

这是循环的核心。跑完测试提示词、用户看完输出，就让它更好。

改进思路：

1. 从反馈中泛化。你和用户在几个例子上快速迭代，但技能要能处理你们都见过的之外的输入。顽固问题扛不住定点修改时，换个角度或比喻，而不是堆更多约束。过度拟合的细碎规则和压迫性的 MUST 只会让技能越来越差。
2. 保持 prompt 精简。删掉不产生价值的东西。模型在技能诱导的无用功上浪费 token 时，删掉对应指引，看效果。
3. 解释为什么。今天的模型在有上下文时推理得很好。即使用户反馈很简短甚至沮丧，也先弄清楚他们到底要什么，把理解写进指令。换说法通常比加强制更有用。
4. 找重复劳动。如果每次试跑都独立写出同一个辅助脚本或走同样的多步流程，就把脚本打包进 scripts/ 让技能指向它——写一次，而不是让模型每次都重造。

然后循环：应用改进 → 重跑测试提示词 → 给用户看新输出 → 继续，直到满意或改动不再见效。

---

## 更新已有技能

用户想改一个已安装的技能而不是新建时：

- 保留原来的 name 和目录名。已装技能叫 research-helper，更新后仍叫 research-helper，不是 research-helper-v2。
- 如果原技能路径只读，复制到可写的位置（.ourcode/skills/ 或 <userData>/skills/）再改，让用户优先级的发现覆盖原技能。
- 同名技能从不同路径发现时会作为不同安装保留；路径就是安装身份。

注意：随应用分发的内置技能（如本技能 skill-creator）始终启用、不可彻底删除；它作为兜底存在，可被同名技能覆盖，删除覆盖后内置默认版恢复。

---

## 核心循环，再来一遍

- 搞清楚技能是做什么的。
- 写草稿。
- 用 2–3 个真实测试提示词试跑。
- 和用户一起看结果。
- 改进。
- 重复，直到用户满意或改进不再见效。
`

export const BUILTIN_SKILLS: BuiltinSkill[] = [
  {
    name: 'skill-creator',
    description:
      '创建、改进与迭代自定义技能（skill）。当用户想新建一个技能、把重复的工作流沉淀为可复用技能、修改已有技能的 SKILL.md、或优化技能的触发描述时使用——即使用户没有明说「技能」，只要表达了「把这件事固化下来 / 以后自动执行」的意图，也应主动触发本技能。',
    content: SKILL_CREATOR_CONTENT,
  },
]

const BUILTIN_NAMES = new Set(BUILTIN_SKILLS.map((s) => s.name))

/** Whether a name refers to a protected built-in skill. */
export function isBuiltinSkillName(name: string): boolean {
  return BUILTIN_NAMES.has(name)
}
