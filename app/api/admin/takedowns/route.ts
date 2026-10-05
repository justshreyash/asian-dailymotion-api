import { NextRequest, NextResponse } from 'next/server';
import {
  getPaginatedTakedowns,
  getAllDmAccounts,
  getStats,
  requeueTakedownVideo,
  requeueAllTakedowns,
  dismissTakedownVideo,
  resetAccountStrikes,
  quarantineDmAccount,
  reactivateDmAccount,
  blacklistTitle,
  unblacklistTitle,
} from '@/lib/db/queries';
import { scanAllSwarmVideosHealth } from '@/lib/dailymotion/health';
import { verifyAdminRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!verifyAdminRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized: invalid or missing admin credentials' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '25', 10);

    const [takedownsRes, rawAccounts, stats] = await Promise.all([
      getPaginatedTakedowns({ page, limit }),
      getAllDmAccounts(),
      getStats(),
    ]);

    const accounts = rawAccounts.map(acc => ({
      ...acc,
      api_secret: acc.api_secret ? '••••••••••••' : '',
      access_token: acc.access_token ? '••••••••••••' : null,
    }));

    return NextResponse.json({
      takedowns: takedownsRes.takedowns,
      total: takedownsRes.total,
      page: takedownsRes.page,
      limit: takedownsRes.limit,
      totalPages: takedownsRes.totalPages,
      accounts,
      stats,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!verifyAdminRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized: invalid or missing admin credentials' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { action, videoId, accountId, titleId } = body;

    if (action === 'scan') {
      const result = await scanAllSwarmVideosHealth({ maxCheck: 300 });
      return NextResponse.json({ success: true, summary: result });
    }

    if (action === 'requeue' && videoId) {
      await requeueTakedownVideo(videoId);
      return NextResponse.json({ success: true, message: `Video #${videoId} requeued for re-upload with alternative clean release, and parent title unblocked.` });
    }

    if (action === 'requeue_all') {
      const count = await requeueAllTakedowns();
      return NextResponse.json({ success: true, count, message: `${count} takedown videos requeued for alternative release retry, and parent titles unblocked.` });
    }

    if (action === 'dismiss' && videoId) {
      await dismissTakedownVideo(videoId);
      return NextResponse.json({ success: true, message: `Video #${videoId} dismissed / archived.` });
    }

    if (action === 'reset_strikes' && accountId) {
      await resetAccountStrikes(accountId);
      return NextResponse.json({ success: true, message: `Account #${accountId} strikes reset to 0 and node reactivated.` });
    }

    if (action === 'quarantine_account' && accountId) {
      await quarantineDmAccount(accountId);
      return NextResponse.json({ success: true, message: `Account #${accountId} quarantined.` });
    }

    if (action === 'reactivate_account' && accountId) {
      await reactivateDmAccount(accountId);
      return NextResponse.json({ success: true, message: `Account #${accountId} reactivated.` });
    }

    if (action === 'blacklist_title' && titleId) {
      await blacklistTitle(titleId);
      return NextResponse.json({ success: true, message: `Title #${titleId} has been blacklisted. All future episode uploads are halted.` });
    }

    if (action === 'unblacklist_title' && titleId) {
      await unblacklistTitle(titleId);
      return NextResponse.json({ success: true, message: `Title #${titleId} has been unblacklisted and restored to discovered.` });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
