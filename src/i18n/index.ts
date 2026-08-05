/**
 * Lightweight i18n. The UI strings are hardcoded Chinese today; this module
 * establishes the extraction pattern (title bar + common chrome first) and
 * lets the preference `language` actually switch locales.
 */

export type Locale = 'zh-CN' | 'en-US'

const zhCN = {
  'menu.file': '文件',
  'menu.edit': '编辑',
  'menu.selection': '选择',
  'menu.view': '查看',
  'menu.go': '转到',
  'menu.run': '运行',
  'menu.agent': '智能体',
  'menu.terminal': '终端',
  'menu.extensions': '扩展',
  'menu.help': '帮助',

  'menu.file.new': '新建文件',
  'menu.file.openFolder': '打开文件夹',
  'menu.file.save': '保存',
  'menu.file.saveAll': '全部保存',
  'menu.file.newWindow': '新窗口',
  'menu.file.preferences': '偏好设置',

  'menu.edit.undo': '撤销',
  'menu.edit.redo': '重做',
  'menu.edit.cut': '剪切',
  'menu.edit.copy': '复制',
  'menu.edit.paste': '粘贴',
  'menu.edit.find': '查找',
  'menu.edit.replace': '替换',
  'menu.edit.commandPalette': '命令面板',

  'menu.selection.selectAll': '全选',
  'menu.selection.expand': '展开选区',
  'menu.selection.shrink': '收缩选区',

  'menu.view.commandPalette': '命令面板',
  'menu.view.toggleSidebar': '切换侧边栏',
  'menu.view.toggleTerminal': '切换终端',
  'menu.view.toggleChat': '切换AI面板',

  'menu.go.gotoFile': '转到文件',
  'menu.go.gotoSymbol': '转到符号',
  'menu.go.gotoLine': '转到行号',
  'menu.go.gotoDefinition': '转到定义',
  'menu.go.gotoReferences': '转到引用',

  'menu.run.debug': '开始调试',
  'menu.run.noDebug': '运行无调试',
  'menu.run.stop': '停止',
  'menu.run.restart': '重启',

  'menu.agent.newChat': '新建对话',
  'menu.agent.clearChat': '清空当前对话',
  'menu.agent.exportMd': '导出对话为 Markdown',
  'menu.agent.exportJson': '导出对话为 JSON',

  'menu.terminal.new': '新建终端',
  'menu.terminal.panel': '终端面板',

  'menu.extensions.marketplace': '扩展市场',

  'menu.help.reportIssue': '报告问题',
  'menu.help.featureRequest': '功能建议',
  'menu.help.exportData': '导出所有数据',
  'menu.help.clearData': '清除所有数据',
  'menu.help.devtools': '开发者工具',

  'common.close': '关闭',
  'common.cancel': '取消',
  'common.save': '保存',
  'common.discard': '不保存',
  'common.confirm': '确定',
  'common.delete': '删除',
  'common.rename': '重命名',
  'common.copy': '复制',
  'common.paste': '粘贴',
  'common.enabled': '启用',
  'common.disabled': '禁用',
} as const

const enUS: Record<string, string> = {
  'menu.file': 'File',
  'menu.edit': 'Edit',
  'menu.selection': 'Selection',
  'menu.view': 'View',
  'menu.go': 'Go',
  'menu.run': 'Run',
  'menu.agent': 'Agent',
  'menu.terminal': 'Terminal',
  'menu.extensions': 'Extensions',
  'menu.help': 'Help',

  'menu.file.new': 'New File',
  'menu.file.openFolder': 'Open Folder',
  'menu.file.save': 'Save',
  'menu.file.saveAll': 'Save All',
  'menu.file.newWindow': 'New Window',
  'menu.file.preferences': 'Preferences',

  'menu.edit.undo': 'Undo',
  'menu.edit.redo': 'Redo',
  'menu.edit.cut': 'Cut',
  'menu.edit.copy': 'Copy',
  'menu.edit.paste': 'Paste',
  'menu.edit.find': 'Find',
  'menu.edit.replace': 'Replace',
  'menu.edit.commandPalette': 'Command Palette',

  'menu.selection.selectAll': 'Select All',
  'menu.selection.expand': 'Expand Selection',
  'menu.selection.shrink': 'Shrink Selection',

  'menu.view.commandPalette': 'Command Palette',
  'menu.view.toggleSidebar': 'Toggle Sidebar',
  'menu.view.toggleTerminal': 'Toggle Terminal',
  'menu.view.toggleChat': 'Toggle AI Panel',

  'menu.go.gotoFile': 'Go to File',
  'menu.go.gotoSymbol': 'Go to Symbol',
  'menu.go.gotoLine': 'Go to Line',
  'menu.go.gotoDefinition': 'Go to Definition',
  'menu.go.gotoReferences': 'Go to References',

  'menu.run.debug': 'Start Debugging',
  'menu.run.noDebug': 'Run Without Debugging',
  'menu.run.stop': 'Stop',
  'menu.run.restart': 'Restart',

  'menu.agent.newChat': 'New Chat',
  'menu.agent.clearChat': 'Clear Current Chat',
  'menu.agent.exportMd': 'Export Chat as Markdown',
  'menu.agent.exportJson': 'Export Chat as JSON',

  'menu.terminal.new': 'New Terminal',
  'menu.terminal.panel': 'Terminal Panel',

  'menu.extensions.marketplace': 'Extensions Marketplace',

  'menu.help.reportIssue': 'Report Issue',
  'menu.help.featureRequest': 'Feature Request',
  'menu.help.exportData': 'Export All Data',
  'menu.help.clearData': 'Clear All Data',
  'menu.help.devtools': 'Developer Tools',

  'common.close': 'Close',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.discard': "Don't Save",
  'common.confirm': 'OK',
  'common.delete': 'Delete',
  'common.rename': 'Rename',
  'common.copy': 'Copy',
  'common.paste': 'Paste',
  'common.enabled': 'Enable',
  'common.disabled': 'Disable',
}

const dictionaries: Record<Locale, Record<string, string>> = {
  'zh-CN': zhCN,
  'en-US': enUS,
}

/** Current locale (set at startup from preferences; default zh-CN). */
let currentLocale: Locale = 'zh-CN'

export function setLocale(locale: Locale): void {
  currentLocale = locale
  document.documentElement.lang = locale === 'zh-CN' ? 'zh-CN' : 'en'
}

export function getLocale(): Locale {
  return currentLocale
}

/** Translate a key; falls back to zh-CN then the key itself. */
export function t(key: string): string {
  const dict = dictionaries[currentLocale]
  return dict[key] ?? zhCN[key as keyof typeof zhCN] ?? key
}
