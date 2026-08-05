#!/usr/bin/env node

import * as fs from 'fs'
import * as path from 'path'

const args = process.argv.slice(2)

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log(`
  create-nebula-plugin <plugin-name>

  Scaffolds a new OurCode plugin project.

  Options:
    --help, -h       Show this help message
    --template, -t   Template to use (default: "basic")

  Examples:
    npx create-nebula-plugin my-plugin
    npx create-nebula-plugin my-plugin --template panel
  `)
  process.exit(0)
}

const pluginName = args[0]
const templateIdx = args.indexOf('--template') !== -1 ? args.indexOf('--template') : args.indexOf('-t')
const template = templateIdx !== -1 && args[templateIdx + 1] ? args[templateIdx + 1] : 'basic'

const validTemplates = ['basic', 'panel', 'ai-hook']
if (!validTemplates.includes(template)) {
  console.error(`Unknown template: ${template}. Available: ${validTemplates.join(', ')}`)
  process.exit(1)
}

const targetDir = path.resolve(process.cwd(), pluginName)

if (fs.existsSync(targetDir)) {
  console.error(`Directory already exists: ${targetDir}`)
  process.exit(1)
}

fs.mkdirSync(targetDir, { recursive: true })

const pluginId = pluginName.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-')
const pluginDisplayName = pluginName
  .replace(/[-_]/g, ' ')
  .replace(/\b\w/g, (c) => c.toUpperCase())

// Generate manifest
const manifest = {
  id: pluginId,
  name: pluginDisplayName,
  version: '0.1.0',
  description: `A OurCode plugin: ${pluginDisplayName}`,
  author: 'Developer',
  main: 'index.js',
  permissions: getPermissionsForTemplate(template),
}

fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')

// Generate index.js
const code = getCodeForTemplate(template, pluginId)
fs.writeFileSync(path.join(targetDir, 'index.js'), code)

// Generate README
const readme = `# ${pluginDisplayName}

A OurCode plugin.

## Development

Edit \`index.js\` to implement your plugin logic. The plugin runs in a sandboxed Web Worker with access to the OurCode Extension API.

### API Reference

The global \`api\` object provides:

- \`api.editor\` — Read/write editor content
- \`api.fs\` — File system operations
- \`api.ai\` — Send messages to AI
- \`api.ui\` — Register panels and status bar items
- \`api.commands\` — Register custom commands
- \`api.keybindings\` — Register keyboard shortcuts
- \`api.workspace\` — Access workspace info

### Installation

1. Build your plugin (if using TypeScript/bundler)
2. In OurCode: Extensions > Install Extension
3. Paste the contents of \`manifest.json\` and \`index.js\`

## License

MIT
`
fs.writeFileSync(path.join(targetDir, 'README.md'), readme)

// Generate package.json for development
const pkg = {
  name: pluginId,
  version: '0.1.0',
  private: true,
  scripts: {
    build: 'echo "No build step needed for plain JS"',
  },
}
fs.writeFileSync(path.join(targetDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')

console.log(`\n  Plugin "${pluginName}" created successfully!\n`)
console.log(`  Directory: ${targetDir}`)
console.log(`  Template:  ${template}\n`)
console.log(`  Next steps:`)
console.log(`    cd ${pluginName}`)
console.log(`    # Edit index.js to implement your plugin`)
console.log(`    # Install via OurCode Extensions > Install Extension\n`)

function getPermissionsForTemplate(t: string): string[] {
  switch (t) {
    case 'panel':
      return ['editor.read', 'ui.panel']
    case 'ai-hook':
      return ['ai.chat', 'editor.read']
    default:
      return ['editor.read']
  }
}

function getCodeForTemplate(t: string, id: string): string {
  switch (t) {
    case 'panel':
      return `// ${id} — OurCode Plugin (Panel Template)
// This plugin registers a custom sidebar panel.

api.ui.registerPanel('${id}', '${pluginDisplayName}', () => {
  const container = document.createElement('div')
  container.style.cssText = 'padding: 16px; font-family: sans-serif; color: #ccc;'

  const title = document.createElement('h3')
  title.textContent = '${pluginDisplayName}'
  title.style.cssText = 'margin: 0 0 12px; font-size: 14px; color: #fff;'

  const content = document.createElement('div')
  content.style.cssText = 'font-size: 12px; line-height: 1.6;'

  const refreshBtn = document.createElement('button')
  refreshBtn.textContent = 'Refresh'
  refreshBtn.style.cssText = 'margin-top: 8px; padding: 4px 12px; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;'
  refreshBtn.onclick = () => {
    const file = api.editor.getActiveFile()
    content.textContent = file
      ? 'Active file: ' + file.path + ' (' + file.language + ')'
      : 'No active file'
  }

  container.appendChild(title)
  container.appendChild(content)
  container.appendChild(refreshBtn)

  // Initial render
  const file = api.editor.getActiveFile()
  content.textContent = file
    ? 'Active file: ' + file.path + ' (' + file.language + ')'
    : 'No active file'

  return container
})

console.log('[${id}] Panel plugin loaded')
`

    case 'ai-hook':
      return `// ${id} — OurCode Plugin (AI Hook Template)
// This plugin listens to AI messages and can intercept/respond.

let messageCount = 0

api.ai.onMessage((message) => {
  messageCount++
  console.log('[${id}] AI message received (#' + messageCount + '):', message.role)
})

// Register a command to send a test message
api.commands.registerCommand('${id}.testSend', async () => {
  try {
    const response = await api.ai.sendMessage('Hello from ${pluginDisplayName}!')
    console.log('[${id}] AI response:', response.substring(0, 100))
  } catch (err) {
    console.error('[${id}] Failed to send message:', err.message)
  }
})

console.log('[${id}] AI hook plugin loaded')
`

    default:
      return `// ${id} — OurCode Plugin (Basic Template)
// This plugin demonstrates basic editor access.

// Log when the plugin loads
console.log('[${id}] Plugin loaded')

// Read the active file when the plugin activates
const activeFile = api.editor.getActiveFile()
if (activeFile) {
  console.log('[${id}] Active file:', activeFile.path)
  console.log('[${id}] Language:', activeFile.language)
  console.log('[${id}] Content length:', activeFile.content.length, 'characters')
} else {
  console.log('[${id}] No file currently open')
}

// Listen for editor content changes
api.editor.onDidChangeContent((content) => {
  console.log('[${id}] Editor content changed, length:', content.length)
})

// Register a command
api.commands.registerCommand('${id}.hello', () => {
  api.ui.showNotification('Hello from ${pluginDisplayName}!', 'info')
})

console.log('[${id}] Ready. Use command "${id}.hello" to test.')
`
  }
}
