/**
 * Pipeline Phase 3/4: Uploads
 * Checks titles for new episodes, selects best release, resolves direct URL,
 * and uploads via Dailymotion account swarm with Greedy Bin-Packing & Hold Queue.
 */

import { FourKHdHubClient } from '../scraper/client';
import { parseReleases, parseAllReleases } from '../scraper/parser';
import { selectBestReleases } from '../utils/release-picker';
import { formatDmTitle } from '../utils/title-format';
import { DmSwarm } from '../dailymotion/swarm';
import {
  getAllTitles,
  getVideosByTmdbId,
  getHoldVideos,
  upsertVideo,
  updateVideoUpload,
  updateVideoHold,
  updateVideoError,
  updateTitleStatus,
  updateTitleAiringInfo,
} from '../db/queries';

export interface UploadRunOptions {
  maxUploads?: number;
  maxExecutionSeconds?: number;
  prioritizeTmdbId?: number;
}

export async function runUploads(options: UploadRunOptions = {}) {
  const maxUploads = options.maxUploads ?? 8;
  const maxExecutionSeconds = options.maxExecutionSeconds ?? 240; // Guard for Vercel 300s timeout
  const startTime = Date.now();

  const client = new FourKHdHubClient();
  const swarm = new DmSwarm();

  console.log(`\n🚀 Starting Intelligent Upload Pipeline (Limit ${maxUploads} uploads)...`);

  let uploadsAttempted = 0;
  let itemsPutOnHold = 0;

  // 1. Fetch candidate titles (only mapped TMDB titles, exclude failed and blacklisted)
  const allTitles = await getAllTitles();
  let titles = allTitles.filter(t => t.tmdb_id != null && t.status !== 'failed' && t.status !== 'blacklisted');

  // 2. Prioritize: 
  // Priority 1: explicitly requested title (e.g. 314939)
  // Priority 2: on-air series (active releases currently broadcasting)
  // Priority 3: latest release year descending (2026 -> 2025 -> 2024 -> ...)
  // Priority 4: in-progress series (status = 'processing')
  // Priority 5: newest discovered date (created_at DESC)
  titles.sort((a, b) => {
    if (options.prioritizeTmdbId) {
      if (a.tmdb_id === options.prioritizeTmdbId) return -1;
      if (b.tmdb_id === options.prioritizeTmdbId) return 1;
    }
    const aOnAir = (a.is_on_air === 1 || a.airing_status === 'Returning Series' || a.airing_status === 'In Production') ? 1 : 0;
    const bOnAir = (b.is_on_air === 1 || b.airing_status === 'Returning Series' || b.airing_status === 'In Production') ? 1 : 0;
    if (aOnAir !== bOnAir) return bOnAir - aOnAir; // On-air / Returning series first

    const aYear = a.year || 0;
    const bYear = b.year || 0;
    if (aYear !== bYear) return bYear - aYear; // 2026 -> 2025 -> 2024 ...

    const aProcessing = a.status === 'processing' ? 1 : 0;
    const bProcessing = b.status === 'processing' ? 1 : 0;
    if (aProcessing !== bProcessing) return bProcessing - aProcessing;

    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  for (const title of titles) {
    if (title.tmdb_id == null) continue;

    // Timeout guard check (ensure Vercel function terminates safely before timeout)
    const elapsedSeconds = (Date.now() - startTime) / 1000;
    if (elapsedSeconds >= maxExecutionSeconds) {
      console.log(`\n⏱️ Execution time limit reached (${elapsedSeconds.toFixed(1)}s / ${maxExecutionSeconds}s). Wrapping up.`);
      break;
    }

    if (uploadsAttempted >= maxUploads) {
      console.log(`\n🎯 Max upload limit per batch reached (${uploadsAttempted}/${maxUploads}). Stopping run.`);
      break;
    }

    // Check swarm max available capacity
    const maxCapacitySeconds = await swarm.getMaxRemainingDuration();
    if (maxCapacitySeconds < 300) { // Less than 5 minutes anywhere
      console.log(`\n🛑 All Dailymotion accounts exhausted (14 vids or 9.5 hrs limit) for today. Stopping uploads.`);
      break;
    }

    console.log(`\n📺 Processing: ${title.title} (${title.kind.toUpperCase()}${title.is_on_air ? ' - ON AIR' : ''}) [Swarm Max Free: ${Math.round(maxCapacitySeconds / 60)}m]`);
    
    try {
      // Fetch HTML once for all episodes of this title
      const html = await client.fetchRawHtml(title.slug);
      await updateTitleAiringInfo(title.id, { lastScrapedAt: new Date().toISOString() });

      const isMovie = title.kind === 'movie';
      const existingVideos = await getVideosByTmdbId(title.tmdb_id);

      if (isMovie) {
        // MOVIE LOGIC
        const existing = existingVideos[0];
        if (existing?.upload_status === 'uploaded') {
          await updateTitleStatus(title.id, 'completed');
          console.log(`  ✅ Movie already uploaded.`);
          continue;
        }
        if (existing?.upload_status === 'takedown') {
          continue; // wait for explicit requeue / fallback
        }

        let excludeSizesMb: number[] = [];
        let excludeUrls: string[] = [];
        if (existing?.flagged_sources) {
          try {
            const list = JSON.parse(existing.flagged_sources);
            for (const item of list) {
              if (item.sizeMb) excludeSizesMb.push(item.sizeMb);
              if (item.url) excludeUrls.push(item.url);
            }
          } catch {}
        }

        const releases = parseAllReleases(html);
        if (releases.length === 0) {
          console.log(`  ℹ️ No releases found on page for movie.`);
          continue;
        }

        const bestReleases = selectBestReleases(releases, {
          excludeSizesMb,
          excludeUrls,
          preferAlternativeCodec: excludeSizesMb.length > 0,
          preferAlternativeSource: excludeSizesMb.length > 0,
        });
        if (bestReleases.length === 0) {
          console.log(`  ℹ️ All available releases for this movie match previously flagged sources.`);
          continue;
        }

        const result = await attemptUpload(client, swarm, title.id, title.tmdb_id, true, null, null, bestReleases);
        if (result === 'uploaded') {
          uploadsAttempted++;
          await updateTitleStatus(title.id, 'completed');
        } else if (result === 'on_hold') {
          itemsPutOnHold++;
        }

      } else {
        // SERIES LOGIC
        let uploadedEpsCount = existingVideos.filter(v => v.upload_status === 'uploaded').length;
        let expectedTotal = title.total_episodes || 0;
        let consecutiveEmpty = 0;

        for (let s = 1; s <= (title.total_seasons || 1); s++) {
          const maxEps = title.total_episodes ? title.total_episodes + 2 : 40;
          
          for (let e = 1; e <= maxEps; e++) {
            // Check limits
            if (uploadsAttempted >= maxUploads) break;
            if ((Date.now() - startTime) / 1000 >= maxExecutionSeconds) break;

            const existing = existingVideos.find(v => v.season === s && v.episode === e);
            if (existing?.upload_status === 'uploaded') {
              consecutiveEmpty = 0;
              continue;
            }
            if (existing?.upload_status === 'takedown') {
              // Waiting for explicit requeue / fallback
              continue;
            }

            let excludeSizesMb: number[] = [];
            let excludeUrls: string[] = [];
            if (existing?.flagged_sources) {
              try {
                const list = JSON.parse(existing.flagged_sources);
                for (const item of list) {
                  if (item.sizeMb) excludeSizesMb.push(item.sizeMb);
                  if (item.url) excludeUrls.push(item.url);
                }
              } catch {}
            }

            const releases = parseReleases(html, s, e);
            if (releases.length === 0) {
              consecutiveEmpty++;
              // If we encounter 3 empty episodes past season bounds, break
              if (consecutiveEmpty >= 3 && e > (expectedTotal || 3)) break;
              continue;
            }

            consecutiveEmpty = 0;
            const bestReleases = selectBestReleases(releases, {
              excludeSizesMb,
              excludeUrls,
              preferAlternativeCodec: excludeSizesMb.length > 0,
              preferAlternativeSource: excludeSizesMb.length > 0,
            });

            if (bestReleases.length === 0) {
              console.log(`    ⚠️ S${s}E${e}: All releases match previously flagged sources. Skipping.`);
              continue;
            }

            console.log(`  📦 Checking S${s}E${e} (${bestReleases.length} releases available${excludeSizesMb.length > 0 ? ', fallback diversity active' : ''})`);
            const result = await attemptUpload(client, swarm, title.id, title.tmdb_id, false, s, e, bestReleases);
            
            if (result === 'uploaded') {
              uploadedEpsCount++;
              uploadsAttempted++;
              // Safe spacing between uploads to prevent Dailymotion burst rate limit errors
              await sleep(12000);
            } else if (result === 'on_hold') {
              itemsPutOnHold++;
              // Continue scanning next episodes / titles to bin-pack smaller items
            }
          }
          if (uploadsAttempted >= maxUploads) break;
        }

        if (expectedTotal > 0 && uploadedEpsCount >= expectedTotal && !title.is_on_air) {
          await updateTitleStatus(title.id, 'completed');
        } else {
          await updateTitleStatus(title.id, 'processing');
        }
      }

    } catch (err) {
      console.log(`  ❌ Failed processing title ${title.slug}: ${(err as Error).message}`);
    }
  }

  console.log(`\n✅ Upload pipeline finished. Uploaded ${uploadsAttempted} items, ${itemsPutOnHold} on hold for capacity in ${((Date.now() - startTime) / 1000).toFixed(1)}s.`);
  return uploadsAttempted;
}

async function attemptUpload(
  client: FourKHdHubClient,
  swarm: DmSwarm,
  titleId: number,
  tmdbId: number,
  isMovie: boolean,
  season: number | null,
  episode: number | null,
  bestReleases: any[]
): Promise<'uploaded' | 'on_hold' | 'failed'> {
  const dmTitle = formatDmTitle(tmdbId, isMovie, season || undefined, episode || undefined);
  const estimatedDurationSeconds = isMovie ? 5400 : 3600;

  // Mark as pending in DB first with resolution & size
  const dbVideo = await upsertVideo({
    titleId,
    tmdbId,
    season: season || undefined,
    episode: episode || undefined,
    isMovie,
    dmTitle,
    resolution: bestReleases[0]?.resolution,
    fileSizeMb: bestReleases[0]?.sizeMb,
  });

  if (!dbVideo) {
    console.error('Failed to create/fetch dbVideo record');
    return 'failed';
  }

  // Check if any active account has capacity for this duration
  const qualifiedAccounts = await swarm.getQualifiedAccounts(estimatedDurationSeconds, bestReleases[0]?.sizeMb);
  if (qualifiedAccounts.length === 0) {
    const maxRemaining = await swarm.getMaxRemainingDuration();
    const reason = `Exceeds current node daily capacity (~${Math.round(estimatedDurationSeconds / 60)}m required, max available is ${Math.round(maxRemaining / 60)}m). Deferred on hold.`;
    console.log(`    ⏸️ [ON HOLD] ${reason}`);
    await updateVideoHold(dbVideo.id, reason);
    return 'on_hold';
  }

  for (const release of bestReleases) {
    try {
      // Guard against Dailymotion 4GB file size limit for free tier
      if (release.sizeMb && release.sizeMb > 3800) {
        console.log(`    ⚠️ Skipping release ${release.releaseTitle} (${release.sizeMb}MB exceeds 3.8GB DM limit)`);
        continue;
      }

      console.log(`    Trying release: ${release.releaseTitle} (${release.sizeMb}MB, ${release.resolution})`);
      
      const streamInfo = await client.resolveRelease(release);
      const result = await swarm.upload(streamInfo.url, dmTitle, {
        estimatedDurationSeconds,
        sizeMb: release.sizeMb,
      });

      if (result.success) {
        await updateVideoUpload(dbVideo.id, {
          dmAccountId: result.accountId!,
          dmVideoId: result.videoId!,
          dmVideoUrl: result.videoUrl!,
          sourceUrl: streamInfo.url,
          durationSeconds: result.duration,
        });
        console.log(`      ✅ Upload success: ${result.videoId} on account #${result.accountId}`);
        return 'uploaded';
      } else {
        console.log(`      Upload failed: ${result.error}`);
        if (result.error?.includes('Capacity hold') || result.error?.includes('requires ~')) {
          await updateVideoHold(dbVideo.id, result.error);
          return 'on_hold';
        }
      }
    } catch (e) {
      console.log(`      Failed to resolve/upload: ${(e as Error).message}`);
    }
  }

  // If all fallbacks failed
  await updateVideoError(dbVideo.id, 'All fallback releases failed to upload');
  return 'failed';
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

