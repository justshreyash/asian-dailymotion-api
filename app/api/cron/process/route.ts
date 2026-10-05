import { NextRequest, NextResponse } from 'next/server';
import { runDiscovery } from '../../../../lib/pipeline/discover';
import { runTmdbResolution } from '../../../../lib/pipeline/resolve-tmdb';
import { runUploads } from '../../../../lib/pipeline/upload';
import { initSchema } from '../../../../lib/db/schema';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; 

export async function GET(request: NextRequest) {
  // Check authorization header or query param if CRON_SECRET is configured
  const authHeader = request.headers.get('authorization');
  const { searchParams } = new URL(request.url);
  const keyParam = searchParams.get('key');
  const cronSecret = process.env.CRON_SECRET;
  
  if (cronSecret) {
    const isAuthorized = authHeader === `Bearer ${cronSecret}` || keyParam === cronSecret;
    if (!isAuthorized) {
      return NextResponse.json({ error: 'Unauthorized: invalid or missing CRON_SECRET' }, { status: 401 });
    }
  }

  try {
    await initSchema(); // Ensure DB tables exist

    console.log('\n=======================================');
    console.log('🕒 CRON JOB STARTED');
    console.log('=======================================');

    // 1. Run Discovery (limit to 1 page per category to save time)
    await runDiscovery(1);

    // 2. Resolve TMDB IDs & Sync On-Air drama schedules
    await runTmdbResolution();
    const { syncAiringSeriesDetails } = await import('../../../../lib/pipeline/resolve-tmdb');
    await syncAiringSeriesDetails();

    // 3. Process Uploads (swarm will break early if limits reached)
    await runUploads({ maxUploads: 8 });

    console.log('\n=======================================');
    console.log('✅ CRON JOB FINISHED');
    console.log('=======================================');

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Cron job failed:', err);
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
