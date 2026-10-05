import { NextRequest, NextResponse } from 'next/server';
import { runDiscovery } from '@/lib/pipeline/discover';
import { runTmdbResolution } from '@/lib/pipeline/resolve-tmdb';
import { runUploads } from '@/lib/pipeline/upload';
import { resetFailedTitles } from '@/lib/db/queries';
import { dbAll, dbGet, dbRun } from '@/lib/db/client';
import { initSchema } from '@/lib/db/schema';
import { getDmAccessToken } from '@/lib/dailymotion/client';
import { verifyAdminRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  if (!verifyAdminRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized: invalid or missing admin credentials' }, { status: 401 });
  }

  try {
    await initSchema();
    const body = await request.json().catch(() => ({}));
    const action = body.action || 'all';

    console.log(`\n⚡ Admin pipeline triggered: action = ${action}`);

    if (action === 'discover') {
      const pages = body.pages || 1;
      await runDiscovery(pages);
      return NextResponse.json({ success: true, message: `Discovered pages 1 to ${pages}` });
    }

    if (action === 'resolve_tmdb') {
      if (body.resetFailed) await resetFailedTitles();
      await runTmdbResolution();
      return NextResponse.json({ success: true, message: 'TMDB Resolution completed' });
    }

    if (action === 'sync_airing') {
      const { syncAiringSeriesDetails } = await import('@/lib/pipeline/resolve-tmdb');
      const onAirCount = await syncAiringSeriesDetails();
      return NextResponse.json({ success: true, message: `Synced TMDB airing status for series (${onAirCount} active on-air).` });
    }

    if (action === 'upload') {
      const maxUploads = body.maxUploads ? parseInt(body.maxUploads, 10) : 8;
      const prioritizeTmdbId = body.prioritizeTmdbId ? parseInt(body.prioritizeTmdbId, 10) : undefined;
      const count = await runUploads({ maxUploads, prioritizeTmdbId });
      return NextResponse.json({ success: true, message: `Upload batch completed (${count} uploaded)` });
    }

    if (action === 'sync_durations') {
      const accounts = await dbAll('SELECT * FROM dm_accounts WHERE is_active = 1');
      const today = new Date().toISOString().slice(0, 10);
      
      let updatedVideos = 0;
      for (const acc of accounts) {
        try {
          const token = await getDmAccessToken(acc.api_key, acc.api_secret);
          const videos = await dbAll("SELECT * FROM videos WHERE dm_video_id IS NOT NULL AND dm_account_id = ? AND upload_status = 'uploaded'", [acc.id]);
          
          for (const v of videos) {
            const endpoint = `https://partner.api.dailymotion.com/rest/video/${v.dm_video_id}?fields=duration`;
            const r = await fetch(endpoint, { headers: { Authorization: `Bearer ${token.access_token}` } });
            if (r.ok) {
              const d = await r.json();
              if (d.duration && d.duration > 0) {
                await dbRun('UPDATE videos SET duration_seconds = ? WHERE id = ?', [d.duration, v.id]);
                updatedVideos++;
              }
            }
          }

          // Calculate today's uploads and durations strictly for this account
          const todayStats = await dbGet(`
            SELECT COUNT(*) as count, COALESCE(SUM(duration_seconds), 0) as duration
            FROM videos
            WHERE dm_account_id = ? 
              AND upload_status = 'uploaded' 
              AND DATE(created_at) = ?
          `, [acc.id, today]);

          const lifetimeCount = ((await dbGet(`
            SELECT COUNT(*) as count FROM videos WHERE dm_account_id = ? AND upload_status = 'uploaded'
          `, [acc.id])) as any)?.count || 0;

          await dbRun(`
            UPDATE dm_accounts 
            SET upload_count = ?, 
                daily_upload_count = ?, 
                daily_duration_seconds = ?, 
                daily_reset_at = ?
            WHERE id = ?
          `, [lifetimeCount, todayStats?.count || 0, todayStats?.duration || 0, today, acc.id]);

        } catch (e) {
          console.warn(`Could not sync duration for ${acc.label}:`, e);
        }
      }

      return NextResponse.json({ success: true, message: `Synced durations for ${updatedVideos} videos across swarm` });
    }

    if (action === 'health_check') {
      const { scanAllSwarmVideosHealth } = await import('@/lib/dailymotion/health');
      const scanResult = await scanAllSwarmVideosHealth({ maxCheck: 300 });
      return NextResponse.json({
        success: true,
        message: `Health scan complete: ${scanResult.aliveCount} healthy, ${scanResult.takedownCount} takedowns, ${scanResult.quarantinedAccounts} quarantined accounts.`,
        summary: scanResult,
      });
    }

    // Default 'all'
    const { scanAllSwarmVideosHealth } = await import('@/lib/dailymotion/health');
    await scanAllSwarmVideosHealth({ maxCheck: 100 });
    await runDiscovery(1);
    await runTmdbResolution();
    await runUploads();

    return NextResponse.json({ success: true, message: 'Full pipeline cycle finished' });
  } catch (err) {
    console.error('Pipeline action failed:', err);
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
