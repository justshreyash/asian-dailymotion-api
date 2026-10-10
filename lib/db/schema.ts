/**
 * Database schema — creates all tables if they don't exist.
 */

import { dbExec, dbRun } from './client';

export async function initSchema(): Promise<void> {
  await dbExec(`
    CREATE TABLE IF NOT EXISTS titles (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      slug          TEXT NOT NULL UNIQUE,
      title         TEXT NOT NULL,
      kind          TEXT NOT NULL CHECK (kind IN ('series', 'movie')),
      year          INTEGER,
      tmdb_id       INTEGER,
      poster_url    TEXT,
      audio_langs   TEXT NOT NULL DEFAULT '[]',
      total_seasons INTEGER DEFAULT 0,
      total_episodes INTEGER DEFAULT 0,
      is_on_air     INTEGER DEFAULT 0,
      airing_status TEXT DEFAULT 'unknown',
      next_air_date TEXT,
      last_air_date TEXT,
      last_scraped_at TEXT,
      status        TEXT DEFAULT 'discovered',
      created_at    TEXT DEFAULT (datetime('now')),
      updated_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dm_accounts (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      label         TEXT NOT NULL,
      api_key       TEXT NOT NULL,
      api_secret    TEXT NOT NULL,
      access_token  TEXT,
      token_expires TEXT,
      upload_count  INTEGER DEFAULT 0,
      daily_upload_count INTEGER DEFAULT 0,
      daily_duration_seconds INTEGER DEFAULT 0,
      daily_reset_at TEXT,
      strike_count  INTEGER DEFAULT 0,
      status        TEXT DEFAULT 'active',
      is_active     INTEGER DEFAULT 1,
      last_used_at  TEXT,
      created_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS videos (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      title_id          INTEGER NOT NULL,
      tmdb_id           INTEGER NOT NULL,
      season            INTEGER,
      episode           INTEGER,
      is_movie          INTEGER NOT NULL DEFAULT 0,
      dm_account_id     INTEGER,
      dm_video_id       TEXT,
      dm_video_url      TEXT,
      dm_title          TEXT NOT NULL,
      source_url        TEXT,
      resolution        TEXT,
      file_size_mb      REAL,
      duration_seconds  INTEGER DEFAULT 0,
      upload_status     TEXT DEFAULT 'pending',
      error_message     TEXT,
      takedown_detected_at TEXT,
      takedown_reason   TEXT,
      created_at        TEXT DEFAULT (datetime('now')),
      updated_at        TEXT DEFAULT (datetime('now')),
      UNIQUE(tmdb_id, season, episode)
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      type          TEXT NOT NULL,
      target_id     TEXT,
      status        TEXT DEFAULT 'queued',
      result        TEXT,
      started_at    TEXT,
      completed_at  TEXT,
      created_at    TEXT DEFAULT (datetime('now'))
    );
  `);

  // Safe column additions for existing SQLite/Turso databases
  try { await dbRun("ALTER TABLE dm_accounts ADD COLUMN strike_count INTEGER DEFAULT 0;"); } catch {}
  try { await dbRun("ALTER TABLE dm_accounts ADD COLUMN status TEXT DEFAULT 'active';"); } catch {}
  try { await dbRun("ALTER TABLE videos ADD COLUMN takedown_detected_at TEXT;"); } catch {}
  try { await dbRun("ALTER TABLE videos ADD COLUMN takedown_reason TEXT;"); } catch {}
  try { await dbRun("ALTER TABLE videos ADD COLUMN flagged_sources TEXT DEFAULT '[]';"); } catch {}
  try { await dbRun("ALTER TABLE videos ADD COLUMN provider TEXT DEFAULT 'dailymotion';"); } catch {}
  try { await dbRun("ALTER TABLE videos ADD COLUMN embed_url TEXT;"); } catch {}

  // Safe index creation
  try { await dbRun('CREATE INDEX IF NOT EXISTS idx_titles_tmdb ON titles(tmdb_id);'); } catch {}
  try { await dbRun('CREATE INDEX IF NOT EXISTS idx_titles_status ON titles(status);'); } catch {}
  try { await dbRun('CREATE INDEX IF NOT EXISTS idx_titles_on_air ON titles(is_on_air);'); } catch {}
  try { await dbRun('CREATE INDEX IF NOT EXISTS idx_videos_lookup ON videos(tmdb_id, season, episode);'); } catch {}
  try { await dbRun('CREATE INDEX IF NOT EXISTS idx_videos_dm ON videos(dm_video_id);'); } catch {}
  try { await dbRun('CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(upload_status);'); } catch {}
  try { await dbRun('CREATE INDEX IF NOT EXISTS idx_videos_provider ON videos(provider);'); } catch {}
  try { await dbRun('CREATE INDEX IF NOT EXISTS idx_dm_active ON dm_accounts(is_active);'); } catch {}

  console.log('✅ Database schema verified');
}
