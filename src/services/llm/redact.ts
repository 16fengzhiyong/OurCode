/**
 * Secret redaction for error surfaces.
 *
 * API keys must never leak into chat error cards, tool-error text the model
 * sees, or usage telemetry. Provider error bodies occasionally echo the key
 * back (e.g. a 401 body that repeats the Authorization value), and URL-keyed
 * providers put the key in the request URL, so a fetch error can contain it.
 *
 * Two layers, defense in depth:
 *  1. Exact-value replacement — the caller knows the actual secrets for the
 *     request in flight (apiKey + custom header values), so those exact
 *     strings (and their URL-encoded forms) are masked everywhere they appear.
 *  2. Pattern-based masking — for texts where the exact key isn't known,
 *     `?key=…`, `Authorization: Bearer …` and `x-api-key: …` shaped values
 *     (≥ 8 chars) are masked so a key can't slip through unnamed.
 *
 * Redaction only affects display strings — never the stored config.
 */

export interface RedactSecretsOptions {
  apiKey?: string
  baseUrl?: string
  customHeaders?: Record<string, string>
}

const REDACTED = '[REDACTED]'

/** Minimum length for pattern-based masks — short values are almost never
 *  secrets, and masking them would mangle legitimate text like `?key=abc`. */
const MIN_PATTERN_LEN = 8
const MIN_LEN_QUANT = `{${MIN_PATTERN_LEN},}`

/** Collect the exact secret strings to mask (deduped, non-empty). */
export function secretValues(opts?: RedactSecretsOptions): string[] {
  if (!opts) return []
  const values: string[] = []
  const push = (v: string | undefined) => {
    const s = v?.trim()
    if (s && s.length > 0 && !values.includes(s)) values.push(s)
  }
  push(opts.apiKey)
  if (opts.apiKey) {
    try {
      push(encodeURIComponent(opts.apiKey.trim()))
    } catch {
      /* malformed URI components are skipped */
    }
  }
  for (const v of Object.values(opts.customHeaders ?? {})) push(v)
  return values
}

/** Mask every occurrence of the exact secret values in `text`. */
function maskExact(text: string, secrets: string[]): string {
  let out = text
  for (const secret of secrets) {
    // String#split is a plain substring search — no regex escaping needed, and
    // it handles keys containing regex metacharacters safely.
    if (out.includes(secret)) out = out.split(secret).join(REDACTED)
  }
  return out
}

/** Pattern-based masks — work even when the exact key value is unknown. */
function maskPatterns(text: string): string {
  return text
    // Query-string credentials: ?key=… &api_key=… &access_token=… (≥ 8 chars)
    .replace(
      new RegExp(`([?&](?:key|api_key|apikey|access_token|token)=)[^&\\s"'<>]${MIN_LEN_QUANT}`, 'gi'),
      `$1${REDACTED}`,
    )
    // Authorization / Bearer tokens
    .replace(new RegExp(`(\\b[Bb]earer\\s+)[A-Za-z0-9._~+/=-]${MIN_LEN_QUANT}`, 'g'), `$1${REDACTED}`)
    // x-api-key / api-key header style
    .replace(new RegExp(`([Xx]-[Aa][Pp][Ii]-[Kk][Ee][Yy][^:\\s]*\\s*[:=]\\s*["']?)[^"'<>\\s]${MIN_LEN_QUANT}`, 'g'), `$1${REDACTED}`)
    // Authorization: <token> without the word Bearer
    .replace(new RegExp(`([Aa]uthorization\\s*[:=]\\s*(?:[Bb]earer\\s+)?)[^"'<>\\s]${MIN_LEN_QUANT}`, 'g'), `$1${REDACTED}`)
}

/** Redact a text using exact secrets + pattern masks. Pure; returns the input
 *  unchanged when there is nothing to mask. */
export function redactSecrets(text: string, opts?: RedactSecretsOptions): string {
  if (!text) return text
  return maskPatterns(maskExact(text, secretValues(opts)))
}

/** Redact an Error's message in place-safe way: returns a NEW Error with the
 *  same name (so AbortError checks keep working) and a redacted message. */
export function redactError(error: unknown, opts?: RedactSecretsOptions): Error {
  const err = error instanceof Error ? error : new Error(String(error ?? ''))
  if (!err.message) return err
  const redacted = redactSecrets(err.message, opts)
  if (redacted === err.message) return err
  const out = new Error(redacted)
  out.name = err.name
  out.stack = err.stack
  return out
}
