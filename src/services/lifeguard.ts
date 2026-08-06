/**
 * Lifeguard — pre-commit AI bug checking.
 *
 * Feeds the staged/unstaged diff to the configured model and asks for a strict
 * JSON list of potential bugs. Findings are rendered in the Git panel so the
 * user can fix issues before committing.
 */
import { sendLLMRequest } from '@/services/llm/LLMClient'
import { ApiConfigGroup } from '@/types'

export interface LifeguardFinding {
  severity: 'error' | 'warning' | 'info'
  file?: string
  line?: number
  message: string
  suggestion?: string
}

const LIFEGUARD_PROMPT = `你是代码审查专家。请审查下面的 git diff，找出其中的潜在缺陷：
- 逻辑错误（错误的条件、边界处理缺失、竞态）
- 空值/未定义访问、资源泄漏、未处理的错误路径
- 安全问题（注入、路径穿越、敏感信息泄露）
- 明显的行为回归

只输出 JSON 数组，格式：
[{"severity":"error|warning|info","file":"文件名","line":行号(可省略),"message":"问题描述","suggestion":"修复建议(可省略)"}]
不要输出任何其他文字或 markdown。没有发现问题时输出 []。

git diff:
\`\`\`
{diff}
\`\`\``

/** Run a Lifeguard check on a diff. Throws on unrecoverable errors. */
export async function runLifeguardCheck(
  diff: string,
  configGroup: ApiConfigGroup,
): Promise<LifeguardFinding[]> {
  const prompt = LIFEGUARD_PROMPT.replace('{diff}', diff.slice(0, 20000) || '(空 diff)')
  const req = {
    model: configGroup.defaultModel || '',
    messages: [
      { role: 'system' as const, content: '你只输出合法的 JSON，不输出其他内容。' },
      { role: 'user' as const, content: prompt },
    ],
    stream: false,
    temperature: 0.2,
    maxTokens: 3000,
    topP: 1,
    frequencyPenalty: 0,
    presencePenalty: 0,
  }

  let raw = ''
  for await (const chunk of sendLLMRequest(req, configGroup)) {
    if (chunk.content) raw += chunk.content
    if (chunk.done) break
  }

  return parseFindings(raw)
}

/** Robustly parse a findings JSON array (tolerates fenced output / prose) */
export function parseFindings(raw: string): LifeguardFinding[] {
  // Strip markdown fences if present
  let text = raw.trim().replace(/^```[\w-]*\n?/, '').replace(/\n?```$/, '').trim()
  // Fall back to the first balanced [ ... ] block if the model wrapped prose around it
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start !== -1 && end > start) {
    text = text.slice(start, end + 1)
  }
  try {
    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((f: any) => f && typeof f.message === 'string')
      .map((f: any) => ({
        severity: (['error', 'warning', 'info'].includes(f.severity) ? f.severity : 'info') as LifeguardFinding['severity'],
        file: typeof f.file === 'string' ? f.file : undefined,
        line: typeof f.line === 'number' ? f.line : undefined,
        message: f.message,
        suggestion: typeof f.suggestion === 'string' ? f.suggestion : undefined,
      }))
  } catch {
    return []
  }
}
