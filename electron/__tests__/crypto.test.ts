import { describe, it, expect, beforeEach } from 'vitest'
import { CryptoService } from '../services/crypto'

describe('CryptoService', () => {
  let crypto: CryptoService

  beforeEach(() => {
    crypto = new CryptoService()
  })

  describe('encrypt/decrypt (machine-ID based)', () => {
    it('should encrypt and decrypt text correctly', () => {
      const plaintext = 'sk-abc123def456'
      const encrypted = crypto.encrypt(plaintext)
      expect(Buffer.isBuffer(encrypted)).toBe(true)
      expect(encrypted.length).toBeGreaterThan(0)

      const decrypted = crypto.decrypt(encrypted)
      expect(decrypted).toBe(plaintext)
    })

    it('should produce different ciphertext for same plaintext (random IV)', () => {
      const plaintext = 'test-key'
      const enc1 = crypto.encrypt(plaintext)
      const enc2 = crypto.encrypt(plaintext)
      expect(enc1.equals(enc2)).toBe(false)
      expect(crypto.decrypt(enc1)).toBe(crypto.decrypt(enc2))
    })

    it('should handle empty string', () => {
      const encrypted = crypto.encrypt('')
      expect(crypto.decrypt(encrypted)).toBe('')
    })

    it('should handle unicode text', () => {
      const plaintext = '你好世界🔑'
      const encrypted = crypto.encrypt(plaintext)
      expect(crypto.decrypt(encrypted)).toBe(plaintext)
    })

    it('should fail to decrypt with wrong data (tampered)', () => {
      const encrypted = crypto.encrypt('secret')
      // Tamper with the encrypted data
      encrypted[encrypted.length - 1] ^= 0xff
      expect(() => crypto.decrypt(encrypted)).toThrow()
    })
  })

  describe('encryptForExport/decryptForImport', () => {
    it('should encrypt and decrypt with password', () => {
      const plaintext = 'my-api-key-12345'
      const password = 'strong-password'

      const encrypted = crypto.encryptForExport(plaintext, password)
      expect(typeof encrypted).toBe('string')
      expect(encrypted).toContain(':')

      const decrypted = crypto.decryptForImport(encrypted, password)
      expect(decrypted).toBe(plaintext)
    })

    it('should fail with wrong password', () => {
      const plaintext = 'secret-key'
      const encrypted = crypto.encryptForExport(plaintext, 'correct-password')

      expect(() => {
        crypto.decryptForImport(encrypted, 'wrong-password')
      }).toThrow()
    })

    it('should produce different output each time (random salt)', () => {
      const plaintext = 'same-key'
      const password = 'same-password'

      const enc1 = crypto.encryptForExport(plaintext, password)
      const enc2 = crypto.encryptForExport(plaintext, password)
      expect(enc1).not.toBe(enc2)

      // Both should decrypt to same plaintext
      expect(crypto.decryptForImport(enc1, password)).toBe(plaintext)
      expect(crypto.decryptForImport(enc2, password)).toBe(plaintext)
    })

    it('should reject invalid format', () => {
      expect(() => crypto.decryptForImport('invalid-data', 'pass')).toThrow('Invalid encrypted data format')
    })
  })

  describe('master password (chat encryption)', () => {
    it('should set master password and generate salt + verify token', () => {
      const result = crypto.setMasterPassword('my-master-pass')
      expect(result.salt).toBeTruthy()
      expect(result.verifyToken).toBeTruthy()
      expect(crypto.hasChatKey()).toBe(true)
    })

    it('should unlock with correct password', () => {
      const password = 'secure-password'
      const { salt, verifyToken } = crypto.setMasterPassword(password)

      // Create a new instance (simulating app restart)
      const crypto2 = new CryptoService()
      expect(crypto2.hasChatKey()).toBe(false)

      const unlocked = crypto2.unlockWithPassword(password, salt, verifyToken)
      expect(unlocked).toBe(true)
      expect(crypto2.hasChatKey()).toBe(true)
    })

    it('should reject wrong password on unlock', () => {
      const { salt, verifyToken } = crypto.setMasterPassword('correct')

      const crypto2 = new CryptoService()
      const unlocked = crypto2.unlockWithPassword('wrong', salt, verifyToken)
      expect(unlocked).toBe(false)
      expect(crypto2.hasChatKey()).toBe(false)
    })

    it('should encrypt and decrypt chat messages', () => {
      crypto.setMasterPassword('test-pass')

      const message = 'Hello, this is a private message'
      const encrypted = crypto.encryptChat(message)
      expect(Buffer.isBuffer(encrypted)).toBe(true)

      const decrypted = crypto.decryptChat(encrypted)
      expect(decrypted).toBe(message)
    })

    it('should lock and prevent chat operations', () => {
      crypto.setMasterPassword('pass')
      crypto.lockChat()
      expect(crypto.hasChatKey()).toBe(false)
      expect(() => crypto.encryptChat('test')).toThrow('Chat encryption not unlocked')
      expect(() => crypto.decryptChat(Buffer.from('test'))).toThrow('Chat encryption not unlocked')
    })
  })
})
