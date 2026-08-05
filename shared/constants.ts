// IPC Channel Constants

export const IPC_CHANNELS = {
  // File System
  FS_READ_FILE: 'fs:readFile',
  FS_WRITE_FILE: 'fs:writeFile',
  FS_LIST_DIR: 'fs:listDir',
  FS_WATCH: 'fs:watch',
  FS_UNWATCH: 'fs:unwatch',
  FS_CREATE_FILE: 'fs:createFile',
  FS_CREATE_DIR: 'fs:createDir',
  FS_RENAME: 'fs:rename',
  FS_DELETE: 'fs:delete',
  FS_STAT: 'fs:stat',
  FS_OPEN_IN_FINDER: 'fs:openInFinder',
  FS_COPY_PATH: 'fs:copyPath',
  FS_COPY: 'fs:copy',
  FS_MOVE: 'fs:move',
  FS_SELECT_FOLDER: 'fs:selectFolder',
  FS_FILE_CHANGED: 'fs:fileChanged',
  FS_OPEN_STREAM: 'fs:openStream',
  FS_READ_CHUNK: 'fs:readChunk',
  FS_READ_CHUNK_BATCH: 'fs:readChunkBatch',
  FS_CLOSE_STREAM: 'fs:closeStream',
  FS_OPEN_WRITE_STREAM: 'fs:openWriteStream',
  FS_WRITE_CHUNK: 'fs:writeChunk',
  FS_CLOSE_WRITE_STREAM: 'fs:closeWriteStream',
  FS_ABORT_WRITE_STREAM: 'fs:abortWriteStream',

  // Store (SQLite)
  STORE_GET_CONFIG_GROUPS: 'store:getConfigGroups',
  STORE_SAVE_CONFIG_GROUP: 'store:saveConfigGroup',
  STORE_DELETE_CONFIG_GROUP: 'store:deleteConfigGroup',
  STORE_GET_SESSIONS: 'store:getSessions',
  STORE_SAVE_SESSION: 'store:saveSession',
  STORE_DELETE_SESSION: 'store:deleteSession',
  STORE_GET_PREFERENCES: 'store:getPreferences',
  STORE_SAVE_PREFERENCES: 'store:savePreferences',

  // Encryption
  CRYPTO_SET_MASTER_KEY: 'crypto:setMasterKey',
  CRYPTO_UNLOCK: 'crypto:unlock',
  CRYPTO_IS_LOCKED: 'crypto:isLocked',

  // App
  APP_GET_PATH: 'app:getPath',
  APP_GET_PLATFORM: 'app:getPlatform',
  APP_RESOLVE_ENV_VAR: 'app:resolveEnvVar',
  APP_QUIT: 'app:quit',
  APP_GET_VERSION: 'app:getVersion',

  // Window
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_IS_MAXIMIZED: 'window:isMaximized',
  WINDOW_OPEN_DEV_TOOLS: 'window:openDevTools',

  // Dialog
  DIALOG_OPEN_FILE: 'dialog:openFile',
  DIALOG_OPEN_FOLDER: 'dialog:openFolder',
  DIALOG_SAVE_FILE: 'dialog:saveFile',
  DIALOG_MESSAGE: 'dialog:message',

  // Terminal
  TERM_CREATE: 'term:create',
  TERM_WRITE: 'term:write',
  TERM_RESIZE: 'term:resize',
  TERM_DATA: 'term:data',
  TERM_EXIT: 'term:exit',
  TERM_DISPOSE: 'term:dispose',

  // Search
  SEARCH_IN_FILES: 'search:inFiles',

  // Git
  GIT_EXEC: 'git:exec',

  // Shell
  SHELL_EXEC: 'shell:exec',

  // Auto Update
  UPDATE_CHECK: 'update:check',
  UPDATE_DOWNLOAD: 'update:download',
  UPDATE_INSTALL: 'update:install',
  UPDATE_STATUS: 'update:status',
  UPDATE_PROGRESS: 'update:progress',
} as const

// Default Model Parameters
export const DEFAULT_MODEL_PARAMS = {
  temperature: 1.0,
  maxTokens: 0, // 0 means unlimited
  topP: 1.0,
  frequencyPenalty: 0,
  presencePenalty: 0,
}

// Default User Preferences
export const DEFAULT_PREFERENCES = {
  theme: 'dark' as const,
  fontSize: 14,
  fontFamily: "'Cascadia Code', 'Fira Code', Consolas, 'Courier New', monospace",
  tabSize: 2,
  autoSave: true,
  autoSaveInterval: 1000,
  showMinimap: true,
  showHiddenFiles: false,
  chatPosition: 'right' as const,
  language: 'zh-CN' as const,
  encryptChatData: false,
}

// Free model keywords
export const FREE_MODEL_KEYWORDS = ['free', 'gpt-3.5', 'llama', 'mistral', 'gemma']

// Known model metadata (context window, vision, function call)
export const MODEL_METADATA: Record<string, { contextWindow: number; vision: boolean; functionCall: boolean }> = {
  // OpenAI
  'gpt-4o': { contextWindow: 128000, vision: true, functionCall: true },
  'gpt-4o-mini': { contextWindow: 128000, vision: true, functionCall: true },
  'gpt-4-turbo': { contextWindow: 128000, vision: true, functionCall: true },
  'gpt-4-turbo-preview': { contextWindow: 128000, vision: false, functionCall: true },
  'gpt-4': { contextWindow: 8192, vision: false, functionCall: true },
  'gpt-3.5-turbo': { contextWindow: 16385, vision: false, functionCall: true },
  'o1': { contextWindow: 200000, vision: true, functionCall: true },
  'o1-mini': { contextWindow: 128000, vision: false, functionCall: false },
  'o3-mini': { contextWindow: 200000, vision: false, functionCall: true },
  // Anthropic
  'claude-sonnet-4-20250514': { contextWindow: 200000, vision: true, functionCall: true },
  'claude-3-7-sonnet-20250219': { contextWindow: 200000, vision: true, functionCall: true },
  'claude-3-5-sonnet-20241022': { contextWindow: 200000, vision: true, functionCall: true },
  'claude-3-5-sonnet-20240620': { contextWindow: 200000, vision: true, functionCall: true },
  'claude-3-5-haiku-20241022': { contextWindow: 200000, vision: true, functionCall: true },
  'claude-3-opus-20240229': { contextWindow: 200000, vision: true, functionCall: true },
  'claude-3-sonnet-20240229': { contextWindow: 200000, vision: true, functionCall: true },
  'claude-3-haiku-20240307': { contextWindow: 200000, vision: true, functionCall: true },
  // DeepSeek
  'deepseek-chat': { contextWindow: 64000, vision: false, functionCall: true },
  'deepseek-coder': { contextWindow: 64000, vision: false, functionCall: false },
  'deepseek-reasoner': { contextWindow: 64000, vision: false, functionCall: false },
  // Gemini
  'gemini-1.5-pro': { contextWindow: 2000000, vision: true, functionCall: true },
  'gemini-1.5-flash': { contextWindow: 1000000, vision: true, functionCall: true },
  'gemini-2.0-flash': { contextWindow: 1000000, vision: true, functionCall: true },
  // Groq
  'llama3-70b-8192': { contextWindow: 8192, vision: false, functionCall: false },
  'mixtral-8x7b-32768': { contextWindow: 32768, vision: false, functionCall: false },
  'llama-3.1-70b-versatile': { contextWindow: 131072, vision: false, functionCall: true },
  'llama-3.1-8b-instant': { contextWindow: 131072, vision: false, functionCall: true },
}

/** Look up metadata for a model by exact ID or by prefix matching */
export function lookupModelMetadata(modelId: string): { contextWindow: number; vision: boolean; functionCall: boolean } | undefined {
  if (MODEL_METADATA[modelId]) return MODEL_METADATA[modelId]
  const parts = modelId.split('-')
  if (parts.length >= 2) {
    const prefix = parts.slice(0, 2).join('-')
    if (MODEL_METADATA[prefix]) return MODEL_METADATA[prefix]
  }
  return undefined
}

// Language map by file extension
export const LANGUAGE_MAP: Record<string, string> = {
  // JavaScript / TypeScript
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  // Python
  py: 'python',
  pyw: 'python',
  pyi: 'python',
  // Ruby
  rb: 'ruby',
  erb: 'erb',
  // Java / Kotlin / Scala
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  scala: 'scala',
  // Swift / Objective-C
  swift: 'swift',
  m: 'objective-c',
  mm: 'objective-c',
  // Go
  go: 'go',
  // Rust
  rs: 'rust',
  // C / C++
  c: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  h: 'c',
  hpp: 'cpp',
  hxx: 'cpp',
  // C#
  cs: 'csharp',
  csx: 'csharp',
  // PHP
  php: 'php',
  // Web
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  sass: 'scss',
  less: 'less',
  // Frontend frameworks
  vue: 'html',
  svelte: 'html',
  astro: 'html',
  // Data / Config
  json: 'json',
  jsonc: 'json',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  cfg: 'ini',
  conf: 'ini',
  env: 'plaintext',
  // Documentation
  md: 'markdown',
  mdx: 'markdown',
  rst: 'restructuredtext',
  txt: 'plaintext',
  // Shell
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',
  ps1: 'powershell',
  bat: 'bat',
  cmd: 'bat',
  // SQL
  sql: 'sql',
  // Dockerfile
  dockerfile: 'dockerfile',
  // Lua
  lua: 'lua',
  // R
  r: 'r',
  // Haskell
  hs: 'haskell',
  lhs: 'haskell',
  // Elixir / Erlang
  ex: 'elixir',
  exs: 'elixir',
  erl: 'erlang',
  // Dart
  dart: 'dart',
  // Perl
  pl: 'perl',
  pm: 'perl',
  // Groovy
  groovy: 'groovy',
  gradle: 'groovy',
  // Protobuf / GraphQL
  proto: 'protobuf',
  graphql: 'graphql',
  gql: 'graphql',
  // Prisma
  prisma: 'prisma',
  // TOML / INI variants
  lock: 'plaintext',
  // Editor config
  editorconfig: 'properties',
  gitignore: 'plaintext',
  gitattributes: 'plaintext',
}
