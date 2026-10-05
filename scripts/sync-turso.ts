import 'dotenv/config';
import { createClient } from '@libsql/client';
import Database from 'better-sqlite3';

async function main() {
  const tursoUrl = process.env.TURSO_DATABASE_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;

  if (!tursoUrl || !tursoToken) {
    console.error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN in .env');
    process.exit(1);
  }

  const turso = createClient({
    url: tursoUrl,
    authToken: tursoToken,
  });

  const localDb = new Database('./data/local.db');

  console.log('🔄 Initializing schema on Turso Cloud Database...');

  await turso.execute(`
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
  `);

  await turso.execute(`
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
      is_active     INTEGER DEFAULT 1,
      last_used_at  TEXT,
      created_at    TEXT DEFAULT (datetime('now'))
    );
  `);

  await turso.execute(`
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
      created_at        TEXT DEFAULT (datetime('now')),
      updated_at        TEXT DEFAULT (datetime('now')),
      UNIQUE(tmdb_id, season, episode)
    );
  `);

  await turso.execute(`
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

  // Migrate indexes
  await turso.execute(`CREATE INDEX IF NOT EXISTS idx_titles_tmdb ON titles(tmdb_id);`);
  await turso.execute(`CREATE INDEX IF NOT EXISTS idx_titles_status ON titles(status);`);
  await turso.execute(`CREATE INDEX IF NOT EXISTS idx_titles_on_air ON titles(is_on_air);`);
  await turso.execute(`CREATE INDEX IF NOT EXISTS idx_videos_lookup ON videos(tmdb_id, season, episode);`);
  await turso.execute(`CREATE INDEX IF NOT EXISTS idx_videos_dm ON videos(dm_video_id);`);

  // Sync dm_accounts
  const localAccounts = localDb.prepare('SELECT * FROM dm_accounts').all() as any[];
  console.log(`📡 Syncing ${localAccounts.length} DM Accounts to Turso...`);
  for (const acc of localAccounts) {
    await turso.execute({
      sql: `INSERT OR REPLACE INTO dm_accounts (id, label, api_key, api_secret, access_token, token_expires, upload_count, daily_upload_count, daily_duration_seconds, daily_reset_at, is_active, last_used_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [acc.id, acc.label, acc.api_key, acc.api_secret, acc.access_token, acc.token_expires, acc.upload_count, acc.daily_upload_count, acc.daily_duration_seconds, acc.daily_reset_at, acc.is_active, acc.last_used_at, acc.created_at]
    });
  }

  // Sync titles
  const localTitles = localDb.prepare('SELECT * FROM titles').all() as any[];
  console.log(`📡 Syncing ${localTitles.length} Titles to Turso...`);
  for (const t of localTitles) {
    await turso.execute({
      sql: `INSERT OR REPLACE INTO titles (id, slug, title, kind, year, tmdb_id, poster_url, audio_langs, total_seasons, total_episodes, is_on_air, airing_status, next_air_date, last_air_date, last_scraped_at, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [t.id, t.slug, t.title, t.kind, t.year, t.tmdb_id, t.poster_url, t.audio_langs, t.total_seasons, t.total_episodes, t.is_on_air, t.airing_status, t.next_air_date, t.last_air_date, t.last_scraped_at, t.status, t.created_at, t.updated_at]
    });
  }

  // Sync videos
  const localVideos = localDb.prepare('SELECT * FROM videos').all() as any[];
  console.log(`📡 Syncing ${localVideos.length} Videos to Turso...`);
  for (const v of localVideos) {
    await turso.execute({
      sql: `INSERT OR REPLACE INTO videos (id, title_id, tmdb_id, season, episode, is_movie, dm_account_id, dm_video_id, dm_video_url, dm_title, source_url, resolution, file_size_mb, duration_seconds, upload_status, error_message, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [v.id, v.title_id, v.tmdb_id, v.season, v.episode, v.is_movie, v.dm_account_id, v.dm_video_id, v.dm_video_url, v.dm_title, v.source_url, v.resolution, v.file_size_mb, v.duration_seconds, v.upload_status, v.error_message, v.created_at, v.updated_at]
    });
  }

  const resTitles = await turso.execute('SELECT COUNT(*) as count FROM titles');
  const resVideos = await turso.execute('SELECT COUNT(*) as count FROM videos');
  const resAccounts = await turso.execute('SELECT COUNT(*) as count FROM dm_accounts');

  console.log('\n🎉 Turso Cloud Database is fully SYNCED and READY!');
  console.log(`  - Titles:   ${resTitles.rows[0].count}`);
  console.log(`  - Videos:   ${resVideos.rows[0].count}`);
  console.log(`  - Accounts: ${resAccounts.rows[0].count}`);
}

main().catch(console.error);
