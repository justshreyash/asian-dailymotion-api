/**
 * Intelligent Playmate Fallback Pipeline & Auto-Healer
 * 
 * Automatically routes videos that are blacklisted, taken down, or failed
 * on Dailymotion to Playmate hosting (folder: mult-audio, fld_id: 1233).
 * Preserves catalog integrity and serves playable streams.
 */

import { PlaymateClient } from '../playmate/client';
import { FourKHdHubClient } from '../scraper/client';
import { selectBestReleases } from '../utils/release-picker';
import {
  dbAll,
  dbGet,
} from '../db/client';
import {
  VideoRow,
  updatePlaymateVideoUpload,
  updateTitleStatus,
  getPlaymateEligibleVideos,
} from '../db/queries';

export interface PlaymateUploadOptions {
  limit?: number;
  dryRun?: boolean;
  videoIds?: number[];
  titleId?: number;
}

export async function uploadEligibleToPlaymate(options: PlaymateUploadOptions = {}) {
  const playmate = new PlaymateClient();
  const scraper = new FourKHdHubClient();

  console.log(`\n======================================================`);
  console.log(`🚀 Starting Playmate Video Fallback Pipeline...`);
  console.log(`📁 Target Playmate Folder ID: ${playmate.getFolderId()} (mult-audio)`);
  console.log(`======================================================\n`);

  // Verify Playmate account connectivity
  const accountInfo = await playmate.getAccountInfo();
  if (!accountInfo) {
    console.error('❌ Could not connect to Playmate API. Verify PLAYMATE_API_KEY.');
    return { success: false, error: 'Authentication failed' };
  }
  console.log(`👤 Connected to Playmate user: ${accountInfo.username} (${accountInfo.email}) | Total videos: ${accountInfo.videos_total}`);

  // Fetch target videos
  let videos: VideoRow[] = [];
  if (options.videoIds && options.videoIds.length > 0) {
    const placeholders = options.videoIds.map(() => '?').join(',');
    videos = await dbAll<VideoRow>(`
      SELECT v.*, t.title as title_name, t.slug as title_slug, t.status as title_status, t.kind as title_kind
      FROM videos v
      JOIN titles t ON v.title_id = t.id
      WHERE v.id IN (${placeholders})
    `, options.videoIds);
  } else if (options.titleId) {
    videos = await dbAll<VideoRow>(`
      SELECT v.*, t.title as title_name, t.slug as title_slug, t.status as title_status, t.kind as title_kind
      FROM videos v
      JOIN titles t ON v.title_id = t.id
      WHERE v.title_id = ? AND v.upload_status != 'uploaded'
    `, [options.titleId]);
  } else {
    videos = await getPlaymateEligibleVideos();
  }

  if (options.limit && options.limit > 0) {
    videos = videos.slice(0, options.limit);
  }

  console.log(`🎯 Identified ${videos.length} videos requiring Playmate upload.\n`);

  let uploadedCount = 0;
  let failedCount = 0;
  const titlesToEvaluate = new Set<number>();

  for (const video of videos) {
    const titleName = video.title_name || `Title #${video.title_id}`;
    const epLabel = video.is_movie ? 'Movie' : `S${video.season ?? 1}E${video.episode ?? 1}`;
    console.log(`🎬 Processing [${titleName}] ${epLabel} (Video #${video.id}, Current Status: ${video.upload_status})...`);

    titlesToEvaluate.add(video.title_id);

    if (options.dryRun) {
      console.log(`   [DRY RUN] Would resolve source and upload to Playmate.`);
      uploadedCount++;
      continue;
    }

    try {
      let directUrl: string | null = null;
      let selectedResolution = video.resolution || '1080p';

      // 1. Check if current source_url is valid and alive
      if (video.source_url && !video.source_url.includes('pixeldrain')) {
        try {
          const headRes = await fetch(video.source_url, {
            method: 'HEAD',
            headers: { 'User-Agent': 'Mozilla/5.0' },
          });
          if (headRes.ok) {
            directUrl = video.source_url;
            console.log(`   ⚡ Existing source_url is active and ready.`);
          }
        } catch {}
      }

      // 2. If no valid direct URL, scrape fresh release via 4KHDHub
      if (!directUrl && video.title_slug) {
        console.log(`   🔍 Scraping fresh mirror links for ${video.title_slug}...`);
        try {
          const releases = video.is_movie
            ? await scraper.allReleases(video.title_slug)
            : await scraper.episodeReleases(video.title_slug, video.season ?? 1, video.episode ?? 1);

          if (releases.length > 0) {
            const bestReleases = selectBestReleases(releases);
            for (const rel of bestReleases) {
              try {
                console.log(`   ⏳ Resolving mirror for release: ${rel.releaseTitle} (${rel.resolution})...`);
                const resolved = await scraper.resolveRelease(rel);
                if (resolved && resolved.url) {
                  directUrl = resolved.url;
                  selectedResolution = rel.resolution || selectedResolution;
                  console.log(`   ✅ Direct stream link resolved (${selectedResolution}).`);
                  break;
                }
              } catch (resErr) {
                console.warn(`   ⚠️ Mirror resolution failed for release: ${(resErr as Error).message}`);
              }
            }
          }
        } catch (scrapeErr) {
          console.warn(`   ⚠️ Scraper error: ${(scrapeErr as Error).message}`);
        }
      }

      if (!directUrl) {
        console.error(`   ❌ Failed to resolve any valid stream source URL for Video #${video.id}.`);
        failedCount++;
        continue;
      }

      // 3. Upload to Playmate
      const customTitle = `${titleName} ${epLabel}`;
      console.log(`   🚀 Dispatching remote upload to Playmate (Title: "${customTitle}")...`);
      const uploadRes = await playmate.uploadByRemoteUrl(directUrl, {
        customTitle,
        folderId: playmate.getFolderId(),
      });

      if (!uploadRes.success || !uploadRes.fileCode) {
        console.error(`   ❌ Playmate upload failed: ${uploadRes.error}`);
        failedCount++;
        continue;
      }

      console.log(`   🎉 Upload queued on Playmate! Filecode: ${uploadRes.fileCode}`);
      console.log(`   🔗 Embed URL: ${uploadRes.embedUrl}`);

      // 4. Update Database
      await updatePlaymateVideoUpload(video.id, {
        fileCode: uploadRes.fileCode,
        embedUrl: uploadRes.embedUrl!,
        sourceUrl: directUrl,
        resolution: selectedResolution,
      });

      console.log(`   💾 Database updated: upload_status = 'uploaded', provider = 'playmate'.\n`);
      uploadedCount++;

      // Small pause between remote uploads to be polite to the API
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.error(`   ❌ Unexpected error processing video #${video.id}: ${(err as Error).message}\n`);
      failedCount++;
    }
  }

  // 5. Evaluate and heal parent titles
  console.log(`\n🩺 Evaluating parent titles health...`);
  for (const titleId of titlesToEvaluate) {
    const titleRow = await dbGet('SELECT * FROM titles WHERE id = ?', [titleId]);
    if (!titleRow) continue;

    const unuploaded = await dbAll(
      "SELECT id FROM videos WHERE title_id = ? AND upload_status != 'uploaded'",
      [titleId]
    );

    if (unuploaded.length === 0) {
      await updateTitleStatus(titleId, 'completed');
      console.log(`   ✅ Title [${titleRow.title}] (#${titleId}) all episodes uploaded! Status -> completed.`);
    } else {
      if (titleRow.status === 'blacklisted') {
        await updateTitleStatus(titleId, 'processing');
        console.log(`   🔄 Title [${titleRow.title}] (#${titleId}) restored from blacklisted -> processing.`);
      }
    }
  }

  console.log(`\n======================================================`);
  console.log(`📊 Playmate Fallback Pipeline Summary:`);
  console.log(`   - Target Videos: ${videos.length}`);
  console.log(`   - Successfully Uploaded: ${uploadedCount}`);
  console.log(`   - Failed / Unresolved: ${failedCount}`);
  console.log(`======================================================\n`);

  return {
    total: videos.length,
    uploaded: uploadedCount,
    failed: failedCount,
  };
}
