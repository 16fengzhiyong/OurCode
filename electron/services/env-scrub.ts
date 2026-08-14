/**
 * Environment scrubbing for agent-controlled child processes.
 *
 * When the assistant spawns a subprocess on the user's behalf (git, shell
 * commands, search tools, LSP/debug adapters, MCP stdio servers), the parent
 * environment must not silently leak credential-shaped variables into it — a
 * leaked API key or password would then be readable by any code the agent runs
 * (npm scripts, tests, downloaded tooling). This mirrors the discipline of
 * production agent harnesses (e.g. DeepSeek Harness' `scrubbedParentEnv`).
 *
 * Deliberate scope:
 *  - The user's OWN interactive terminal is NOT scrubbed — that's their shell,
 *    and they may legitimately need `echo $MY_TOKEN` there.
 *  - Scrubbing is name-based and conservative: only variable names containing
 *    credential-shaped keywords are removed. Legitimate config (JAVA_HOME,
 *    GIT_SSH_COMMAND, PYTHONPATH, proxy URLs…) survives untouched, so stripping
 *    never breaks a build that merely reads an env var that happens to be long.
 *  - Explicitly-provided env layers win over the scrub: callers pass their own
 *    `env` (e.g. an MCP server's configured env) AFTER the scrubbed base.
 */

/** Credential-shaped name fragments — a match strips the variable entirely. */
const SECRET_FRAGMENT_RE = /(?:^|_)(?:KEY|PASSWORD|PASSWD|SECRET|TOKEN|CREDENTIALS?|APIKEY)(?:_|$)/i

/** Internal harness variables — never meaningful to a child process. */
const INTERNAL_PREFIXES = ['DSH_', 'OURCODE_', 'ELECTRON_RUN_AS_NODE']

/**
 * Exact-name allowlist. These are configuration, not secrets — stripping them
 * would break language toolchains, git plumbing and terminal behavior for no
 * security gain.
 */
const DEFAULT_KEEP: ReadonlySet<string> = new Set([
  // paths & home
  'PATH', 'HOME', 'USER', 'USERNAME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
  'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'PATHEXT', 'COMSPEC', 'SHELL',
  // language toolchains
  'JAVA_HOME', 'JDK_HOME', 'JRE_HOME', 'PYTHONPATH', 'PYTHONHOME', 'NODE_PATH',
  'NVM_DIR', 'NVM_HOME', 'NVM_SYMLINK', 'PNPM_HOME', 'RUSTUP_HOME', 'CARGO_HOME',
  'GOROOT', 'GOPATH', 'GOTOOLCHAIN', 'DOTNET_ROOT', 'DENO_DIR', 'ANDROID_HOME',
  'ANDROID_SDK_ROOT', 'ANDROID_NDK_HOME', 'FLUTTER_ROOT',
  // terminal / locale
  'TERM', 'TERMINFO', 'TERMINFO_DIRS', 'COLORTERM', 'NO_COLOR', 'LANG', 'LANGUAGE',
  'TZ', 'EDITOR', 'VISUAL', 'PAGER', 'LESS', 'PSModulePath', 'PROMPT', 'DISPLAY',
  'SSH_AUTH_SOCK', 'SSH_AGENT_PID',
  // proxies (URLs, no embedded secrets in the common case; stripping would
  // break corporate setups for zero gain)
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
])

/** Prefix allowlist — e.g. git plumbing (GIT_ASKPASS points at a helper path). */
const DEFAULT_KEEP_PREFIXES: readonly string[] = ['GIT_', 'NPM_CONFIG_', 'npm_config_', 'YARN_', 'COREPACK_', 'XDG_']

export interface ScrubOptions {
  /** Extra exact names to keep (merged with the defaults). */
  keep?: readonly string[]
  /** Extra prefixes to keep (merged with the defaults). */
  keepPrefixes?: readonly string[]
}

/** Whether a single variable name should be kept as-is. */
export function isEnvVarKept(name: string, options?: ScrubOptions): boolean {
  if (DEFAULT_KEEP.has(name) || options?.keep?.includes(name)) return true
  for (const prefix of [...DEFAULT_KEEP_PREFIXES, ...(options?.keepPrefixes ?? [])]) {
    if (name.startsWith(prefix)) return true
  }
  return false
}

/**
 * Return a copy of `env` with credential-shaped variables removed.
 *
 * Keep rules win over strip rules: PATH / GIT_ASKPASS / JAVA_HOME survive even
 * though they contain no keywords; anything name-matched as a secret goes away
 * regardless of how the caller got it. The original object is never mutated.
 */
export function scrubEnv(
  env: Record<string, string | undefined>,
  options?: ScrubOptions,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {}
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue
    if (INTERNAL_PREFIXES.some((p) => name.startsWith(p))) continue
    if (isEnvVarKept(name, options)) {
      out[name] = value
      continue
    }
    if (SECRET_FRAGMENT_RE.test(name)) continue
    out[name] = value
  }
  return out
}

/** Convenience wrapper for the `env` option of spawn/execFile/exec. */
export function scrubbedSpawnEnv(options?: ScrubOptions): NodeJS.ProcessEnv {
  return scrubEnv(process.env ?? {}, options)
}
