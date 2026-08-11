import { describe, it, expect } from 'vitest'
import { parseLLMError } from '@/services/llm/errors'

describe('parseLLMError classification', () => {
  it('classifies 401/403 as auth', () => {
    expect(parseLLMError(new Error('API 请求失败 (401): {"error":{"message":"invalid api key"}}')).type).toBe('auth')
    expect(parseLLMError(new Error('API 请求失败 (403): forbidden')).type).toBe('auth')
  })

  it('classifies 408/429 as rate_limit', () => {
    expect(parseLLMError(new Error('API 请求失败 (429): too many')).type).toBe('rate_limit')
    expect(parseLLMError(new Error('API 请求失败 (408): the server timed out')).type).toBe('rate_limit')
  })

  it('classifies 5xx as server', () => {
    const err = parseLLMError(new Error('API 请求失败 (502): bad gateway'))
    expect(err.type).toBe('server')
    expect(err.code).toBe(502)
  })

  it('classifies 4xx (other than auth/rate-limit) as bad_request with the code', () => {
    const err = parseLLMError(new Error(
      'API 请求失败 (400): {"error":{"message":"An assistant message with \'tool_calls\' must be followed by tool messages"}}'
    ))
    expect(err.type).toBe('bad_request')
    expect(err.code).toBe(400)
    expect(err.message).toContain('400')
  })

  it('recognizes the bare status_code=400 relay format', () => {
    const err = parseLLMError(new Error('status_code=400, An assistant message with \'tool_calls\' must be followed by tool messages responding to each \'tool_call_id\'.'))
    expect(err.type).toBe('bad_request')
    expect(err.code).toBe(400)
  })

  it('classifies timeout / network errors before the status code', () => {
    expect(parseLLMError(new Error('请求超时，请稍后重试')).type).toBe('timeout')
    expect(parseLLMError(new Error('Failed to fetch')).type).toBe('network')
    expect(parseLLMError(new Error('网络请求失败')).type).toBe('network')
  })

  it('extracts the raw upstream detail into the collapsible area', () => {
    const err = parseLLMError(new Error('API 请求失败 (400): {"error":{"message":"bad payload"}}'))
    expect(err.detail).toBe('{"error":{"message":"bad payload"}}')
  })

  it('falls back to unknown only when nothing is recognizable', () => {
    const err = parseLLMError(new Error('Some random internal failure'))
    expect(err.type).toBe('unknown')
  })
})
