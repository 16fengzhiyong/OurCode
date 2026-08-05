/**
 * File icon utility with SVG icons for common file types.
 * Returns colored SVG paths for use in React components.
 */

interface IconDef {
  color: string
  label: string
}

const ICON_MAP: Record<string, IconDef> = {
  // JavaScript/TypeScript
  js: { color: '#F7DF1E', label: 'JS' },
  jsx: { color: '#61DAFB', label: 'JSX' },
  ts: { color: '#3178C6', label: 'TS' },
  tsx: { color: '#3178C6', label: 'TSX' },
  mjs: { color: '#F7DF1E', label: 'MJS' },
  cjs: { color: '#F7DF1E', label: 'CJS' },

  // Web
  html: { color: '#E34F26', label: 'HTML' },
  htm: { color: '#E34F26', label: 'HTM' },
  css: { color: '#1572B6', label: 'CSS' },
  scss: { color: '#CC6699', label: 'SCSS' },
  sass: { color: '#CC6699', label: 'SASS' },
  less: { color: '#1D365D', label: 'LESS' },

  // Data/Config
  json: { color: '#292929', label: 'JSON' },
  xml: { color: '#E34F26', label: 'XML' },
  yaml: { color: '#CB171E', label: 'YAML' },
  yml: { color: '#CB171E', label: 'YML' },
  toml: { color: '#9C4221', label: 'TOML' },

  // Documents
  md: { color: '#083FA1', label: 'MD' },
  txt: { color: '#89e051', label: 'TXT' },
  pdf: { color: '#FF0000', label: 'PDF' },

  // Images
  png: { color: '#A855F7', label: 'PNG' },
  jpg: { color: '#A855F7', label: 'JPG' },
  jpeg: { color: '#A855F7', label: 'JPEG' },
  gif: { color: '#A855F7', label: 'GIF' },
  svg: { color: '#FFB13B', label: 'SVG' },
  ico: { color: '#A855F7', label: 'ICO' },
  webp: { color: '#A855F7', label: 'WEBP' },

  // Code
  py: { color: '#3776AB', label: 'PY' },
  rb: { color: '#CC342D', label: 'RB' },
  java: { color: '#ED8B00', label: 'JV' },
  go: { color: '#00ADD8', label: 'GO' },
  rs: { color: '#DEA584', label: 'RS' },
  c: { color: '#555555', label: 'C' },
  cpp: { color: '#00599C', label: 'C++' },
  h: { color: '#7A8B99', label: 'H' },
  hpp: { color: '#7A8B99', label: 'HPP' },
  cs: { color: '#239120', label: 'C#' },
  php: { color: '#777BB4', label: 'PHP' },
  swift: { color: '#F05138', label: 'SW' },
  kt: { color: '#7F52FF', label: 'KT' },
  scala: { color: '#DC322F', label: 'SC' },
  r: { color: '#276DC3', label: 'R' },
  lua: { color: '#000080', label: 'LUA' },
  dart: { color: '#0175C2', label: 'DART' },

  // Shell
  sh: { color: '#89e051', label: 'SH' },
  bash: { color: '#89e051', label: 'BASH' },
  zsh: { color: '#89e051', label: 'ZSH' },
  ps1: { color: '#012456', label: 'PS' },
  bat: { color: '#C1F12E', label: 'BAT' },
  cmd: { color: '#C1F12E', label: 'CMD' },

  // Database
  sql: { color: '#CC2927', label: 'SQL' },

  // Build/Deploy
  makefile: { color: '#427819', label: 'MAKE' },
  cmake: { color: '#064F8C', label: 'CMAKE' },

  // Lock files
  lock: { color: '#888888', label: 'LOCK' },
}

const FILENAME_ICONS: Record<string, IconDef> = {
  'package.json': { color: '#2ECC71', label: 'PKG' },
  'tsconfig.json': { color: '#3178C6', label: 'TSC' },
  'dockerfile': { color: '#2496ED', label: '🐳' },
  '.gitignore': { color: '#F05032', label: 'GIT' },
  '.env': { color: '#ECD53F', label: 'ENV' },
  '.env.local': { color: '#ECD53F', label: 'ENV' },
  '.eslintrc.json': { color: '#4B32C3', label: 'ESL' },
  '.prettierrc': { color: '#56B3B4', label: 'PRT' },
  'vite.config.ts': { color: '#646CFF', label: 'VIT' },
  'webpack.config.js': { color: '#8DD6F9', label: 'WPK' },
  'tailwind.config.js': { color: '#06B6D4', label: 'TW' },
  'readme.md': { color: '#083FA1', label: 'DOC' },
  'license': { color: '#888888', label: 'LIC' },
  'license.md': { color: '#888888', label: 'LIC' },
  'license.txt': { color: '#888888', label: 'LIC' },
}

const DIRECTORY_ICONS: Record<string, IconDef> = {
  'src': { color: '#F59E0B', label: 'SRC' },
  'node_modules': { color: '#888888', label: 'NPM' },
  '.git': { color: '#F05032', label: 'GIT' },
  'dist': { color: '#6B7280', label: 'OUT' },
  'build': { color: '#6B7280', label: 'OUT' },
  'public': { color: '#10B981', label: 'PUB' },
  'test': { color: '#EF4444', label: 'TST' },
  'tests': { color: '#EF4444', label: 'TST' },
  '__tests__': { color: '#EF4444', label: 'TST' },
  'e2e': { color: '#8B5CF6', label: 'E2E' },
  'components': { color: '#61DAFB', label: 'CMP' },
  'utils': { color: '#8B5CF6', label: 'UTL' },
  'hooks': { color: '#EC4899', label: 'HK' },
  'services': { color: '#3B82F6', label: 'SVC' },
  'stores': { color: '#F59E0B', label: 'STR' },
  'assets': { color: '#10B981', label: 'AST' },
  'styles': { color: '#06B6D4', label: 'CSS' },
  'lib': { color: '#8B5CF6', label: 'LIB' },
  'plugins': { color: '#F97316', label: 'PLG' },
  '.vscode': { color: '#007ACC', label: 'VSC' },
  '.github': { color: '#24292E', label: 'GH' },
}

export function getFileIconDef(name: string, isDirectory: boolean): IconDef {
  if (isDirectory) {
    const lower = name.toLowerCase()
    return DIRECTORY_ICONS[lower] || { color: '#FBBF24', label: '📁' }
  }

  const fullName = name.toLowerCase()
  const ext = name.split('.').pop()?.toLowerCase() || ''

  // Check specific filenames first
  if (FILENAME_ICONS[fullName]) return FILENAME_ICONS[fullName]

  // Check extension
  if (ICON_MAP[ext]) return ICON_MAP[ext]

  // Default
  return { color: '#9CA3AF', label: '📄' }
}

/** SVG icon component for file tree and tabs */
export function FileIcon({ name, isDirectory, isOpen, size = 16 }: {
  name: string
  isDirectory: boolean
  isOpen?: boolean
  size?: number
}) {
  if (isDirectory) {
    return FolderIcon({ name, isOpen, size })
  }

  const def = getFileIconDef(name, false)

  return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 1C2.44772 1 2 1.44772 2 2V14C2 14.5523 2.44772 15 3 15H13C13.5523 15 14 14.5523 14 14V5L10 1H3Z" fill="${def.color}" opacity="0.15"/>
    <path d="M10 1V4C10 4.55228 10.4477 5 11 5H14" stroke="${def.color}" stroke-width="1" stroke-linecap="round"/>
    <path d="M3 1C2.44772 1 2 1.44772 2 2V14C2 14.5523 2.44772 15 3 15H13C13.5523 15 14 14.5523 14 14V5L10 1H3Z" stroke="${def.color}" stroke-width="1"/>
    <text x="8" y="11.5" text-anchor="middle" fill="${def.color}" font-size="5" font-family="Inter, sans-serif" font-weight="600">${def.label}</text>
  </svg>`
}

function FolderIcon({ name, isOpen, size = 16 }: { name: string; isOpen?: boolean; size: number }) {
  const def = getFileIconDef(name, true)

  if (isOpen) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M1.5 3C1.5 2.44772 1.94772 2 2.5 2H6L7.5 4H13.5C14.0523 4 14.5 4.44772 14.5 5V6H4.5L2.5 12.5C2.35 12.89 2 13 1.75 13C1.5 13 1.5 12.5 1.5 12.5V3Z" fill="${def.color}" opacity="0.3"/>
      <path d="M1.5 12.5L3.5 5.5H14.5L12.5 12.5H1.5Z" fill="${def.color}" opacity="0.15"/>
      <path d="M1.5 3C1.5 2.44772 1.94772 2 2.5 2H6L7.5 4H13.5C14.0523 4 14.5 4.44772 14.5 5V5.5H3.5L1.5 12.5V3Z" fill="${def.color}" opacity="0.25"/>
      <path d="M1.5 12.5L3.5 5.5H14.5L12.5 12.5H1.5Z" stroke="${def.color}" stroke-width="1" stroke-linejoin="round"/>
    </svg>`
  }

  return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M1.5 3C1.5 2.44772 1.94772 2 2.5 2H6L7.5 4H13.5C14.0523 4 14.5 4.44772 14.5 5V12C14.5 12.5523 14.0523 13 13.5 13H2.5C1.94772 13 1.5 12.5523 1.5 12V3Z" fill="${def.color}" opacity="0.2"/>
    <path d="M1.5 3C1.5 2.44772 1.94772 2 2.5 2H6L7.5 4H13.5C14.0523 4 14.5 4.44772 14.5 5V12C14.5 12.5523 14.0523 13 13.5 13H2.5C1.94772 13 1.5 12.5523 1.5 12V3Z" stroke="${def.color}" stroke-width="1"/>
  </svg>`
}

/** Get icon as dangerouslySetInnerHTML-compatible object */
export function getFileIconHTML(name: string, isDirectory: boolean, isOpen?: boolean, size?: number) {
  return { __html: FileIcon({ name, isDirectory, isOpen, size }) }
}

/** Legacy string-based icon for backward compatibility */
export function getFileIcon(name: string, isDirectory: boolean): string {
  const def = getFileIconDef(name, isDirectory)
  return def.label
}
