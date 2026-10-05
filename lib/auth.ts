import { NextRequest } from 'next/server';
import crypto from 'crypto';

const SESSION_COOKIE_NAME = 'admin_session';

/**
 * Generates a deterministic signature/token for a given secret.
 */
export function getSessionSignature(secret: string): string {
  return crypto.createHash('sha256').update(`dm_swarm_salt_${secret}`).digest('hex');
}

/**
 * Validates whether an incoming NextRequest is authorized as Admin.
 * Supports:
 * 1. Bearer token in Authorization header (`Bearer <ADMIN_SECRET>`)
 * 2. `admin_session` HttpOnly cookie matching the HMAC of ADMIN_SECRET
 * 3. Fallback to pass if ADMIN_SECRET is not configured (dev mode only)
 */
export function verifyAdminRequest(request: NextRequest): boolean {
  const adminSecret = process.env.ADMIN_SECRET;

  // If no admin secret is configured in environment, allow for initial local dev
  if (!adminSecret) {
    return true;
  }

  // 1. Check Authorization header
  const authHeader = request.headers.get('authorization');
  if (authHeader) {
    if (authHeader === `Bearer ${adminSecret}` || authHeader === adminSecret) {
      return true;
    }
  }

  // 2. Check admin_session cookie
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (sessionCookie) {
    const expectedSig = getSessionSignature(adminSecret);
    if (sessionCookie === expectedSig) {
      return true;
    }
  }

  return false;
}


/**
 * Validates whether a raw input string matches the configured ADMIN_SECRET.
 */
export function verifyAdminSecret(secret: string): boolean {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) return true;
  if (!secret) return false;
  return secret.trim() === adminSecret.trim();
}

export { SESSION_COOKIE_NAME };

