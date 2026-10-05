import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { runDiscovery } from '../../../../lib/pipeline/discover';
import { runTmdbResolution, syncAiringSeriesDetails } from '../../../../lib/pipeline/resolve-tmdb';
import { runUploads } from '../../../../lib/pipeline/upload';
import { initSchema } from '../../../../lib/db/schema';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; 

async function executePipelineJob() {
  try {
    await initSchema();
    console.log('\n=======================================');
    console.log('🕒 PIPELINE BATCH EXECUTION STARTED');
    console.log('=======================================');

    // 1. Audit Swarm Video Health (detect suspensions / takedowns and quarantine unsafe nodes)
    const { scanAllSwarmVideosHealth } = await import('../../../../lib/dailymotion/health');
    await scanAllSwarmVideosHealth({ maxCheck: 100 });

    // 2. Run Discovery (1 page to keep ingestion fast & fresh)
    await runDiscovery(1);

    // 3. Resolve TMDB IDs & Sync On-Air schedules
    await runTmdbResolution();
    await syncAiringSeriesDetails();

    // 4. Process Uploads with greedy bin-packing
    await runUploads({ maxUploads: 8 });

    console.log('\n=======================================');
    console.log('✅ PIPELINE BATCH EXECUTION COMPLETED');
    console.log('=======================================');
  } catch (err) {
    console.error('Pipeline batch execution failed:', err);
  }
}

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

  const shouldWaitSync = searchParams.get('sync') === '1' || searchParams.get('wait') === 'true';

  if (shouldWaitSync) {
    await executePipelineJob();
    return NextResponse.json({ success: true, mode: 'synchronous' });
  }

  // Asynchronous background execution: returns HTTP 200 in ~50ms to cron caller (e.g. cron-job.org with 30s limit),
  // while Vercel runtime continues processing the batch in background for up to 300s!
  waitUntil(executePipelineJob());

  return NextResponse.json({
    success: true,
    status: 'dispatched',
    message: 'Pipeline batch execution triggered in background via waitUntil.',
    timestamp: new Date().toISOString(),
  });
}
