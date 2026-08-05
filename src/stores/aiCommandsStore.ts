import { create } from 'zustand'
import { CustomAICommand } from '@/types'
import { v4 as uuidv4 } from 'uuid'

interface AICommandsState {
  commands: CustomAICommand[]

  // Actions
  loadCommands: () => void
  addCommand: (command: Omit<CustomAICommand, 'id'>) => void
  updateCommand: (id: string, updates: Partial<CustomAICommand>) => void
  deleteCommand: (id: string) => void
  getCommand: (id: string) => CustomAICommand | undefined
  executeCommand: (commandId: string, context: { selection?: string; file?: string; language?: string }) => string
}

const STORAGE_KEY = 'ourcode-custom-ai-commands'

const DEFAULT_COMMANDS: CustomAICommand[] = [
  {
    id: 'default-explain',
    name: '解释代码',
    prompt: '请详细解释以下代码的含义、功能和实现逻辑：\n\n```{language}\n{selection}\n```',
    icon: '🤖',
  },
  {
    id: 'default-refactor',
    name: '重构建议',
    prompt: '请对以下代码提供重构建议，优化其可读性、性能和可维护性：\n\n```{language}\n{selection}\n```',
    icon: '🔧',
  },
  {
    id: 'default-test',
    name: '生成单元测试',
    prompt: '请为以下代码生成完整的单元测试，覆盖正常情况和边界情况：\n\n```{language}\n{selection}\n```',
    icon: '🧪',
  },
  {
    id: 'default-docs',
    name: '生成文档注释',
    prompt: '请为以下代码生成详细的文档注释（JSDoc/Docstring 格式）：\n\n```{language}\n{selection}\n```',
    icon: '📝',
  },
  {
    id: 'default-fix',
    name: '修复问题',
    prompt: '请检查以下代码中的潜在问题（Bug、安全漏洞、性能问题）并提供修复方案：\n\n```{language}\n{selection}\n```',
    icon: '🩹',
  },
  {
    id: 'default-optimize',
    name: '优化性能',
    prompt: '请分析以下代码的性能瓶颈并提供优化方案：\n\n```{language}\n{selection}\n```',
    icon: '⚡',
  },
  {
    id: 'default-translate',
    name: '翻译为英文',
    prompt: '请将以下代码中的中文注释和字符串翻译为英文，保持代码逻辑不变：\n\n```{language}\n{selection}\n```',
    icon: '🌐',
  },
  {
    id: 'default-simplify',
    name: '简化代码',
    prompt: '请简化以下代码，在保持功能不变的前提下减少复杂度：\n\n```{language}\n{selection}\n```',
    icon: '✂️',
  },
  {
    id: 'default-security',
    name: '安全审查',
    prompt: '请对以下代码进行安全审查，检查潜在的安全漏洞（SQL 注入、XSS、CSRF 等）：\n\n```{language}\n{selection}\n```',
    icon: '🔒',
  },
]

export const useAICommandsStore = create<AICommandsState>((set, get) => ({
  commands: DEFAULT_COMMANDS,

  loadCommands: () => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const custom = JSON.parse(stored) as CustomAICommand[]
        set({ commands: [...DEFAULT_COMMANDS, ...custom] })
      }
    } catch {
      set({ commands: DEFAULT_COMMANDS })
    }
  },

  addCommand: (command) => {
    const newCommand: CustomAICommand = {
      id: uuidv4(),
      ...command,
    }

    set((s) => {
      const commands = [...s.commands, newCommand]
      // Save only custom commands (not defaults)
      const custom = commands.filter((c) => !DEFAULT_COMMANDS.find((d) => d.id === c.id))
      localStorage.setItem(STORAGE_KEY, JSON.stringify(custom))
      return { commands }
    })
  },

  updateCommand: (id, updates) => {
    set((s) => {
      const commands = s.commands.map((c) => (c.id === id ? { ...c, ...updates } : c))
      const custom = commands.filter((c) => !DEFAULT_COMMANDS.find((d) => d.id === c.id))
      localStorage.setItem(STORAGE_KEY, JSON.stringify(custom))
      return { commands }
    })
  },

  deleteCommand: (id) => {
    // Prevent deleting default commands
    if (DEFAULT_COMMANDS.find((d) => d.id === id)) return

    set((s) => {
      const commands = s.commands.filter((c) => c.id !== id)
      const custom = commands.filter((c) => !DEFAULT_COMMANDS.find((d) => d.id === c.id))
      localStorage.setItem(STORAGE_KEY, JSON.stringify(custom))
      return { commands }
    })
  },

  getCommand: (id) => {
    return get().commands.find((c) => c.id === id)
  },

  executeCommand: (commandId, context) => {
    const command = get().getCommand(commandId)
    if (!command) return ''

    let prompt = command.prompt
    prompt = prompt.replace(/\{selection\}/g, context.selection || '')
    prompt = prompt.replace(/\{file\}/g, context.file || '')
    prompt = prompt.replace(/\{language\}/g, context.language || '')

    return prompt
  },
}))
