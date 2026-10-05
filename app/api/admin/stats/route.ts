import { NextRequest, NextResponse } from 'next/server';
import { getStats, getAllDmAccounts } from '@/lib/db/queries';
import { verifyAdminRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!verifyAdminRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [stats, rawAccounts] = await Promise.all([
      getStats(),
      getAllDmAccounts(),
    ]);

    const accounts = rawAccounts.map(acc => ({
      ...acc,
      api_secret: acc.api_secret ? '••••••••••••' : '',
      access_token: acc.access_token ? '••••••••••••' : null,
    }));

    return NextResponse.json({
      stats,
      accounts,
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
