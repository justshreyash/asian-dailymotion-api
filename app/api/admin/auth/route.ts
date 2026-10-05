import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminRequest, getSessionSignature, SESSION_COOKIE_NAME } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/auth — check if current session is authenticated
 */
export async function GET(request: NextRequest) {
  try {
    const adminSecret = process.env.ADMIN_SECRET;
    const isConfigured = Boolean(adminSecret && adminSecret.trim().length > 0);
    const isAuthenticated = verifyAdminRequest(request);

    return NextResponse.json({
      authenticated: isAuthenticated,
      isConfigured,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * POST /api/admin/auth — authenticate with admin secret and set secure cookie
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { secret } = body;
    const adminSecret = process.env.ADMIN_SECRET;

    if (!adminSecret) {
      // If no admin secret is set in env, allow access directly
      return NextResponse.json({ success: true, message: 'No ADMIN_SECRET configured; allowed in dev mode.' });
    }

    if (!secret || secret.trim() !== adminSecret.trim()) {
      return NextResponse.json({ error: 'Invalid admin secret key.' }, { status: 401 });
    }

    const sessionSig = getSessionSignature(adminSecret);
    const response = NextResponse.json({ success: true, message: 'Authentication successful.' });

    // Set secure HttpOnly cookie valid for 30 days
    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: sessionSig,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });

    return response;
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/auth — log out by clearing the session cookie
 */
export async function DELETE() {
  try {
    const response = NextResponse.json({ success: true, message: 'Logged out successfully.' });
    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: '',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
    return response;
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
