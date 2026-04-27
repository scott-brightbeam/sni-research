import { SignJWT, jwtVerify } from 'jose';
import { timingSafeEqual } from 'node:crypto';

const ALG = 'HS256';
const ISSUER = 'helsinn-proposal-1';
const COOKIE_NAME = 'hp_session';
const SESSION_TTL_SECONDS = 24 * 60 * 60;

function keyBytes() {
  const secret = process.env.HELSINN_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('HELSINN_SESSION_SECRET must be set and at least 32 chars');
  }
  return new TextEncoder().encode(secret);
}

export async function signSessionJWT(email, sid, via = 'password') {
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({ email, sid, via })
    .setProtectedHeader({ alg: ALG })
    .setIssuer(ISSUER)
    .setIssuedAt(now)
    .setExpirationTime(now + SESSION_TTL_SECONDS)
    .sign(keyBytes());
}

export async function verifySessionJWT(token) {
  try {
    const { payload } = await jwtVerify(token, keyBytes(), { issuer: ISSUER });
    return payload;
  } catch {
    return null;
  }
}

export function passwordMatches(submitted) {
  const expected = process.env.HELSINN_PASSWORD || '';
  if (!expected) return false;
  const a = Buffer.from(String(submitted || ''));
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    // constant-time dummy compare so we still spend roughly the same time
    timingSafeEqual(Buffer.alloc(b.length), Buffer.alloc(b.length));
    return false;
  }
  return timingSafeEqual(a, b);
}

export { COOKIE_NAME, SESSION_TTL_SECONDS };
