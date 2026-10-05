import { NextRequest, NextResponse } from 'next/server';
import { getAllTitles } from '@/lib/db/queries';
import { verifyAdminRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!verifyAdminRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q') || '';
    const status = searchParams.get('status') || '';
    const kind = searchParams.get('kind') || '';

    const titles = await getAllTitles({ q, status, kind, limit: 250 });
    return NextResponse.json({ titles });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
