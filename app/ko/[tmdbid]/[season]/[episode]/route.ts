import { NextRequest, NextResponse } from 'next/server';
import { getVideoByLookup, getTitleByTmdbId } from '../../../../../lib/db/queries';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { tmdbid: string; season: string; episode: string } }
) {
  const tmdbId = parseInt(params.tmdbid, 10);
  const season = parseInt(params.season, 10);
  const episode = parseInt(params.episode, 10);

  if (isNaN(tmdbId) || isNaN(season) || isNaN(episode) || season < 1 || episode < 1) {
    return NextResponse.json({
      error: 'Invalid parameters: tmdbid, season, and episode must be positive integers.',
      status: 'invalid_request'
    }, { status: 400 });
  }

  const title = await getTitleByTmdbId(tmdbId);
  const video = await getVideoByLookup(tmdbId, season, episode);

  // 1. Video is already uploaded and ready
  if (video && video.upload_status === 'uploaded' && video.dm_video_id) {
    return NextResponse.json({
      tmdb_id: tmdbId,
      title: title?.title || null,
      season,
      episode,
      status: 'ready',
      is_movie: false,
      is_on_air: Boolean(title?.is_on_air),
      airing_status: title?.airing_status || 'Ended',
      dm_video_id: video.dm_video_id,
      dm_video_url: video.dm_video_url,
      dm_embed_url: `https://geo.dailymotion.com/player.html?video=${video.dm_video_id}`,
      resolution: video.resolution || '1080p',
      duration_seconds: video.duration_seconds || 0,
      upload_status: 'uploaded',
    });
  }

  // 2. Video is currently in upload queue / pending
  if (video && (video.upload_status === 'pending' || video.upload_status === 'uploading')) {
    return NextResponse.json({
      tmdb_id: tmdbId,
      title: title?.title || null,
      season,
      episode,
      status: 'pending_upload',
      is_movie: false,
      is_on_air: Boolean(title?.is_on_air),
      airing_status: title?.airing_status || 'Ended',
      message: `Episode S${season}E${episode} is indexed in catalog and pending upload to Dailymotion.`,
      dm_video_id: null,
      dm_video_url: null,
      dm_embed_url: null,
      upload_status: video.upload_status,
      retry_after_seconds: 300,
    });
  }

  // 3. Video not yet in videos table, but Title exists in DB
  if (title) {
    const isOnAir = Boolean(title.is_on_air || title.airing_status === 'Returning Series');

    // Check if requested episode exceeds known total episodes
    if (title.total_episodes > 0 && episode > title.total_episodes) {
      return NextResponse.json({
        error: `Episode S${season}E${episode} exceeds total known episodes (${title.total_episodes}) for this series.`,
        tmdb_id: tmdbId,
        title: title.title,
        status: 'episode_out_of_range',
        total_episodes: title.total_episodes,
      }, { status: 404 });
    }

    if (isOnAir) {
      return NextResponse.json({
        tmdb_id: tmdbId,
        title: title.title,
        season,
        episode,
        status: 'pending_source',
        is_on_air: true,
        airing_status: title.airing_status,
        next_air_date: title.next_air_date,
        last_air_date: title.last_air_date,
        total_episodes: title.total_episodes,
        message: `Episode S${season}E${episode} is on-air or upcoming. Not yet published on source (4KHDHub). Background scheduler checks regularly for new releases.`,
        dm_video_id: null,
        dm_video_url: null,
        dm_embed_url: null,
        retry_after_hours: 6,
      });
    }

    return NextResponse.json({
      tmdb_id: tmdbId,
      title: title.title,
      season,
      episode,
      status: 'pending_source',
      is_on_air: false,
      airing_status: title.airing_status || 'Ended',
      message: `Episode S${season}E${episode} is not currently available from source mirrors or pending ingestion.`,
      dm_video_id: null,
      dm_video_url: null,
      dm_embed_url: null,
    }, { status: 404 });
  }

  // 4. Title not found at all
  return NextResponse.json({
    error: `Title with TMDB ID ${tmdbId} not found in Korean drama catalog.`,
    status: 'title_not_found',
    tmdb_id: tmdbId,
  }, { status: 404 });
}
