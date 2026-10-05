import { NextRequest, NextResponse } from 'next/server';
import { getVideoByLookup, getTitleByTmdbId, getVideosByTmdbId } from '../../../lib/db/queries';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { tmdbid: string } }
) {
  const tmdbId = parseInt(params.tmdbid, 10);
  if (isNaN(tmdbId) || tmdbId < 1) {
    return NextResponse.json({
      error: 'Invalid TMDB ID: must be a positive integer',
      status: 'invalid_request'
    }, { status: 400 });
  }

  const title = await getTitleByTmdbId(tmdbId);

  // If title is not found in our catalog at all
  if (!title) {
    return NextResponse.json({
      error: `Title with TMDB ID ${tmdbId} not found in Korean drama/movie catalog.`,
      status: 'title_not_found',
      tmdb_id: tmdbId,
    }, { status: 404 });
  }

  // 1. MOVIE HANDLING
  if (title.kind === 'movie') {
    const video = await getVideoByLookup(tmdbId);
    
    if (video && video.upload_status === 'uploaded' && video.dm_video_id) {
      return NextResponse.json({
        tmdb_id: tmdbId,
        title: title.title,
        is_movie: true,
        status: 'ready',
        dm_video_id: video.dm_video_id,
        dm_video_url: video.dm_video_url,
        dm_embed_url: `https://geo.dailymotion.com/player.html?video=${video.dm_video_id}`,
        resolution: video.resolution || '1080p',
        duration_seconds: video.duration_seconds || 0,
        upload_status: 'uploaded',
      });
    }

    if (video && (video.upload_status === 'pending' || video.upload_status === 'uploading')) {
      return NextResponse.json({
        tmdb_id: tmdbId,
        title: title.title,
        is_movie: true,
        status: 'pending_upload',
        message: 'Movie is in the upload queue and awaiting Dailymotion ingestion.',
        dm_video_id: null,
        dm_video_url: null,
        dm_embed_url: null,
        retry_after_seconds: 300,
      });
    }

    return NextResponse.json({
      tmdb_id: tmdbId,
      title: title.title,
      is_movie: true,
      status: 'pending_source',
      message: 'Movie is indexed but pending source release or upload.',
      dm_video_id: null,
      dm_video_url: null,
      dm_embed_url: null,
    });
  }

  // 2. SERIES HANDLING (Summary of all seasons and uploaded episodes)
  const videos = await getVideosByTmdbId(tmdbId);
  const uploadedVideos = videos.filter(v => v.upload_status === 'uploaded' && v.dm_video_id);

  return NextResponse.json({
    tmdb_id: tmdbId,
    title: title.title,
    kind: 'series',
    is_movie: false,
    is_on_air: Boolean(title.is_on_air),
    airing_status: title.airing_status || 'Ended',
    next_air_date: title.next_air_date,
    last_air_date: title.last_air_date,
    total_seasons: title.total_seasons,
    total_episodes: title.total_episodes,
    uploaded_episodes_count: uploadedVideos.length,
    episodes: uploadedVideos.map(v => ({
      season: v.season,
      episode: v.episode,
      dm_video_id: v.dm_video_id,
      dm_video_url: v.dm_video_url,
      dm_embed_url: `https://geo.dailymotion.com/player.html?video=${v.dm_video_id}`,
      resolution: v.resolution || '1080p',
      duration_seconds: v.duration_seconds || 0,
    })),
    message: title.is_on_air
      ? `Series is currently on-air. Query /ko/${tmdbId}/{season}/{episode} for individual episode playback.`
      : `Query /ko/${tmdbId}/{season}/{episode} for individual episode playback.`,
  });
}
