import { describe, it, expect, afterEach } from 'bun:test'
import { existsSync, rmSync } from 'fs'
import { join, resolve } from 'path'

const ROOT = resolve(import.meta.dir, '../..')
const testCredPath = join(ROOT, '.credentials-test.enc')

// Set test env
process.env.SNI_CREDENTIAL_KEY = 'a'.repeat(64) // 32 bytes hex
process.env.SNI_CREDENTIAL_FILE = testCredPath

const { encrypt, decrypt, saveCredentials, loadCredentials } = await import('../lib/credential-store.js')

afterEach(() => {
  if (existsSync(testCredPath)) rmSync(testCredPath)
})

describe('credential-store', () => {
  it('encrypts and decrypts round-trip', () => {
    const plaintext = 'hello world secret'
    const encrypted = encrypt(plaintext)
    expect(encrypted).not.toBe(plaintext)
    const decrypted = decrypt(encrypted)
    expect(decrypted).toBe(plaintext)
  })

  it('produces different ciphertext for same plaintext (random IV)', () => {
    const plaintext = 'same input'
    const a = encrypt(plaintext)
    const b = encrypt(plaintext)
    expect(a).not.toBe(b)
  })

  it('saves and loads credentials', () => {
    const creds = [
      { name: 'FT', email: 'test@example.com', password: 'secret123' },
      { name: 'EV', email: 'test@example.com', password: 'pass456' },
    ]
    saveCredentials(creds)
    expect(existsSync(testCredPath)).toBe(true)

    const loaded = loadCredentials()
    expect(loaded).toEqual(creds)
  })

  it('returns empty array when no credential file', () => {
    if (existsSync(testCredPath)) rmSync(testCredPath)
    const loaded = loadCredentials()
    expect(loaded).toEqual([])
  })
})
