import { describe, it, expect } from 'vitest'
import { redactSecrets, redactError, secretValues } from '../services/llm/redact'

const KEY = 'sk-test-abc123def456ghi789'
const opts = { apiKey: KEY, baseUrl: 'https://api.example.com', customHeaders: { 'x-api-key': 'hdr-secret-value' } }

describe('redactSecrets', () => {
  it('masks the exact apiKey everywhere it appears', () => {
    const out = redactSecrets(`401 invalid key: ${KEY}`, opts)
    expect(out).not.toContain(KEY)
    expect(out).toContain('[REDACTED]')
    expect(out).toContain('401 invalid key:')
  })

  it('masks custom header values', () => {
    const out = redactSecrets(`x-api-key: hdr-secret-value`, opts)
    expect(out).not.toContain('hdr-secret-value')
  })

  it('masks URL-encoded forms of the key (Gemini ?key=)', () => {
    const encoded = encodeURIComponent(KEY)
    const out = redactSecrets(`https://generativelanguage.googleapis.com/v1/models?key=${encoded}`, opts)
    expect(out).not.toContain(encoded)
    expect(out).not.toContain(KEY)
    expect(out).toContain('[REDACTED]')
  })

  it('pattern-masks query-string keys even without knowing the exact value', () => {
    const out = redactSecrets('https://x.com/?key=sk-UNKNOWNLONGSECRET123456789', {})
    expect(out).not.toContain('sk-UNKNOWNLONGSECRET123456789')
    expect(out).toContain('[REDACTED]')
  })

  it('pattern-masks Bearer / Authorization / x-api-key headers', () => {
    expect(redactSecrets('Authorization: Bearer abcdefghijklmnop123456', {})).toContain('[REDACTED]')
    expect(redactSecrets('authorization: abcdefghijklmnop123456', {})).toContain('[REDACTED]')
    expect(redactSecrets('x-api-key: abcdefghijklmnop123456', {})).toContain('[REDACTED]')
  })

  it('does not mangle short non-secret values', () => {
    const out = redactSecrets('bearer of the news ?key=abc Authorization=ok', {})
    expect(out).toBe('bearer of the news ?key=abc Authorization=ok')
  })

  it('returns input unchanged when there is nothing to mask', () => {
    const text = 'plain error message'
    expect(redactSecrets(text, opts)).toBe(text)
    expect(redactSecrets('', opts)).toBe('')
  })

  it('does not mutate the input', () => {
    const text = `error ${KEY}`
    redactSecrets(text, opts)
    expect(text).toContain(KEY)
  })
})

describe('redactError', () => {
  it('returns a new Error with a redacted message and preserved name', () => {
    const err = new Error(`API 请求失败 (401): ${KEY}`)
    err.name = 'HttpError'
    const out = redactError(err, opts)
    expect(out).toBeInstanceOf(Error)
    expect(out.name).toBe('HttpError')
    expect(out.message).not.toContain(KEY)
    expect(out.message).toContain('API 请求失败 (401):')
  })

  it('returns the same Error when nothing was redacted', () => {
    const err = new Error('plain')
    expect(redactError(err, opts)).toBe(err)
  })

  it('coerces non-Error values', () => {
    const out = redactError('boom', opts)
    expect(out.message).toBe('boom')
  })
})

describe('secretValues', () => {
  it('collects deduped non-empty secrets', () => {
    const values = secretValues(opts)
    expect(values).toContain(KEY)
    expect(values).toContain('hdr-secret-value')
    expect(values.filter((v) => v === KEY).length).toBe(1)
  })
})
