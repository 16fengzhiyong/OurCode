import { describe, it, expect } from 'vitest'
import { scrubEnv, isEnvVarKept, scrubbedSpawnEnv } from '../services/env-scrub'

describe('env-scrub', () => {
  describe('scrubEnv', () => {
    it('strips credential-shaped variable names', () => {
      const out = scrubEnv({
        PATH: '/usr/bin',
        OPENAI_API_KEY: 'sk-leak',
        GITHUB_TOKEN: 'ghp-leak',
        MY_SECRET: 's3cr3t',
        DB_PASSWORD: 'pw',
        plain: 'kept',
      })
      expect(out).toEqual({ PATH: '/usr/bin', plain: 'kept' })
      expect(out.OPENAI_API_KEY).toBeUndefined()
      expect(out.GITHUB_TOKEN).toBeUndefined()
      expect(out.MY_SECRET).toBeUndefined()
      expect(out.DB_PASSWORD).toBeUndefined()
    })

    it('keeps toolchain / git / locale config that merely looks long', () => {
      const out = scrubEnv({
        JAVA_HOME: 'C:/jdk',
        PYTHONPATH: 'x',
        GIT_ASKPASS: '/path/helper',
        GIT_SSH_COMMAND: 'ssh -i /key', // contains a secret path but the NAME is git config
        PATH: '/usr/bin',
        LANG: 'zh_CN.UTF-8',
      })
      expect(out.JAVA_HOME).toBe('C:/jdk')
      expect(out.PYTHONPATH).toBe('x')
      expect(out.GIT_ASKPASS).toBe('/path/helper')
      expect(out.GIT_SSH_COMMAND).toBe('ssh -i /key')
      expect(out.LANG).toBe('zh_CN.UTF-8')
    })

    it('keeps proxy variables (no embedded-credential stripping by name)', () => {
      const out = scrubEnv({ HTTP_PROXY: 'http://corp:8080', NO_PROXY: 'localhost', http_proxy: 'http://corp:8080' })
      expect(out.HTTP_PROXY).toBe('http://corp:8080')
      expect(out.NO_PROXY).toBe('localhost')
      expect(out.http_proxy).toBe('http://corp:8080')
    })

    it('strips internal harness prefixes and undefined values', () => {
      const out = scrubEnv({ DSH_HOME: '/x', OURCODE_DEBUG: '1', PATH: '/bin', UNSET_VAR: undefined })
      expect(out).toEqual({ PATH: '/bin' })
    })

    it('respects caller-provided keep lists (exact + prefix)', () => {
      const out = scrubEnv(
        { CUSTOM_TOKEN: 'secret', MYAPP_KEY: 'k', MYAPP_KEEP_ME: 'v', PATH: '/bin' },
        { keep: ['CUSTOM_TOKEN'], keepPrefixes: ['MYAPP_KEEP_'] },
      )
      expect(out.CUSTOM_TOKEN).toBe('secret')
      expect(out.MYAPP_KEY).toBeUndefined()
      expect(out.MYAPP_KEEP_ME).toBe('v')
    })

    it('does not mutate the input object', () => {
      const input: Record<string, string | undefined> = { PATH: '/bin', OPENAI_API_KEY: 'sk-x' }
      scrubEnv(input)
      expect(input.OPENAI_API_KEY).toBe('sk-x')
    })
  })

  describe('isEnvVarKept', () => {
    it('covers the defaults', () => {
      expect(isEnvVarKept('PATH')).toBe(true)
      expect(isEnvVarKept('GIT_ASKPASS')).toBe(true)
      expect(isEnvVarKept('JAVA_HOME')).toBe(true)
      expect(isEnvVarKept('OPENAI_API_KEY')).toBe(false)
      expect(isEnvVarKept('TOKEN')).toBe(false)
    })
  })

  describe('scrubbedSpawnEnv', () => {
    it('returns the scrubbed process.env with PATH still present', () => {
      const out = scrubbedSpawnEnv()
      expect(out.PATH).toBeDefined()
      expect(out.OPENAI_API_KEY).toBeUndefined()
    })
  })
})
