import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from 'crypto'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'

const ROOT = resolve(import.meta.dir, '../..')
const CRED_FILE = process.env.SNI_CREDENTIAL_FILE || join(ROOT, '.credentials.enc')

function getKey() {
  const keyHex = process.env.SNI_CREDENTIAL_KEY
  if (!keyHex) throw new Error('SNI_CREDENTIAL_KEY not set in environment')
  // Derive a 32-byte key via PBKDF2
  return pbkdf2Sync(Buffer.from(keyHex, 'hex'), 'sni-credential-salt', 100000, 32, 'sha256')
}

export function encrypt(plaintext) {
  const key = getKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()])
  const tag = cipher.getAuthTag()
  // Format: IV (12) + Tag (16) + Ciphertext
  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

export function decrypt(encoded) {
  const key = getKey()
  const buf = Buffer.from(encoded, 'base64')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const ciphertext = buf.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return decipher.update(ciphertext) + decipher.final('utf-8')
}

export function saveCredentials(credentials) {
  const json = JSON.stringify(credentials)
  const encrypted = encrypt(json)
  writeFileSync(CRED_FILE, encrypted)
}

export function loadCredentials() {
  if (!existsSync(CRED_FILE)) return []
  try {
    const encrypted = readFileSync(CRED_FILE, 'utf-8')
    const json = decrypt(encrypted)
    return JSON.parse(json)
  } catch {
    return []
  }
}
