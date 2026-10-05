# Implementation Plan: Korean Drama → Dailymotion Pipeline

## 📋 Project Overview

Build an automated pipeline that:
1. **Scrapes** all Korean dramas from 4KHDHub that have Korean + (Hindi or English) audio
2. **Resolves** TMDB IDs for each title
3. **Uploads** to Dailymotion as private videos via URL-based ingestion
4. **Serves** a lookup API at `mysite.com/ko/{tmdbid}/{season}/{episode}` (series) and `mysite.com/ko/{tmdbid}` (movies)
5. **Maintains** a data table tracking all uploaded content

---

## 🏗️ Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Framework** | **Next.js 14+ (App Router)** | Best Vercel integration, API routes + SSR + cron via `vercel.json` |
| **Language** | **TypeScript** | Type safety, excellent DX |
| **Database (Local)** | **SQLite via `better-sqlite3`** | Zero-config local dev, instant reads, file-based — test everything locally first |
| **Database (Prod)** | **Turso (libSQL/SQLite edge)** | Same SQLite semantics, generous free tier (9 GB, 25M reads/mo) — swap in after local testing |
| **Scraper Logic** | **TypeScript port** of Rust `fourkhdhub` | Rewrite the scraping/parsing/HubCloud resolution logic in TS |
| **TMDB** | TMDB API v3 | Match titles → TMDB IDs |
| **Dailymotion** | Dailymotion API v2 | OAuth2 `client_credentials` + remote URL upload, **multi-account swarm** |
| **Deployment** | **Vercel** (Hobby) | 300s function timeout, 1M invocations/mo, 100 GB bandwidth |
| **Job Queue** | **Vercel Cron + Upstash QStash** (optional) | Trigger batch processing; QStash for fan-out if needed |

### Why This Stack?

- **Next.js on Vercel**: Zero-config deployment, native cron support, API routes double as the lookup endpoint
- **Local-first with SQLite**: Test everything locally with `better-sqlite3`, then swap to Turso for prod with same SQL semantics — no external dependencies during dev
- **Turso over Neon/Supabase**: Lighter, faster for simple key-value-style lookups, generous free tier, embedded SQLite semantics
- **TypeScript port vs. calling Rust binary**: Deploying Rust on Vercel serverless is complex; the Rust code is ~700 lines of HTML parsing + HTTP — straightforward to port to TS with `cheerio` + `node-fetch`

### 🏃 Development Strategy: Local First!

```
Phase A: LOCAL PROTOTYPE
  SQLite file → test scraper → test TMDB → test DM upload → verify everything works
  ↓
Phase B: VERCEL DEPLOYMENT  
  Swap SQLite → Turso → deploy → test cron → verify production
  ↓
Phase C: SCALE
  Add more DM accounts → monitor → optimize
```

---

## 📊 Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          VERCEL DEPLOYMENT                         │
│                                                                     │
│  ┌──────────────────┐    ┌──────────────────┐   ┌────────────────┐ │
│  │  Cron Job         │    │  API Routes       │   │  SQLite/Turso  │ │
│  │  (every 6h)       │    │                   │   │                │ │
│  │                   │    │  /ko/[tmdbid]     │   │  videos table  │ │
│  │  1. Scrape 4KHDH  │───▶│  /ko/[tmdbid]/   │◀─▶│  jobs table    │ │
│  │  2. Filter Korean │    │    [season]/      │   │  titles table  │ │
│  │  3. Match TMDB    │    │    [episode]      │   │  dm_accounts   │ │
│  │  4. Upload to DM  │    │                   │   │                │ │
│  │  5. Save to DB    │    │  /api/admin/*     │   │                │ │
│  └──────────────────┘    └──────────────────┘   └────────────────┘ │
│                                                                     │
│  ┌──────────────────┐    ┌──────────────────────────────────────┐  │
│  │  4KHDHub Scraper  │    │  Dailymotion Account Swarm           │  │
│  │  (TS port)        │    │                                      │  │
│  │                   │    │  Account 1 ──┐                       │  │
│  │  - search/list    │    │  Account 2 ──┼── Round-robin /       │  │
│  │  - parse details  │    │  Account 3 ──┤   Least-used picker   │  │
│  │  - parse releases │    │  Account N ──┘                       │  │
│  │  - resolve direct │    │                                      │  │
│  │    URLs (hubcloud)│    │  - OAuth2 per account                │  │
│  │  - select best    │    │  - Token cache + auto-refresh        │  │
│  │    release (size) │    │  - Upload quota tracking             │  │
│  └──────────────────┘    └──────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 💾 Database Schema (SQLite local / Turso prod)

> **Same schema** works for both `better-sqlite3` (local) and Turso (prod) — seamless swap.

### `titles` — Discovered Korean dramas/movies from 4KHDHub

```sql
CREATE TABLE titles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT NOT NULL UNIQUE,        -- 4KHDHub URL slug (e.g. "celebrity-series-3771")
  title         TEXT NOT NULL,                -- Clean title
  kind          TEXT NOT NULL CHECK (kind IN ('series', 'movie')),
  year          INTEGER,
  tmdb_id       INTEGER,                      -- TMDB ID once resolved
  poster_url    TEXT,
  audio_langs   TEXT NOT NULL,                -- JSON array: ["korean","hindi","english"]
  total_seasons INTEGER DEFAULT 0,
  total_episodes INTEGER DEFAULT 0,
  is_on_air     INTEGER DEFAULT 0,            -- 1 = currently airing / in production
  airing_status TEXT DEFAULT 'unknown',       -- 'Returning Series' | 'Ended' | 'Planned'
  next_air_date TEXT,                         -- E.g. "2026-10-10"
  last_air_date TEXT,                         -- E.g. "2026-10-03"
  last_scraped_at TEXT,                       -- Timestamp of last 4KHDHub check
  status        TEXT DEFAULT 'discovered',    -- discovered | processing | completed | failed
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_titles_tmdb ON titles(tmdb_id);
CREATE INDEX idx_titles_status ON titles(status);
CREATE INDEX idx_titles_on_air ON titles(is_on_air);

CREATE TABLE videos (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  title_id          INTEGER NOT NULL REFERENCES titles(id),
  tmdb_id           INTEGER NOT NULL,
  season            INTEGER,                   -- NULL for movies
  episode           INTEGER,                   -- NULL for movies
  is_movie          INTEGER NOT NULL DEFAULT 0, -- 1 for movie, 0 for series
  dm_account_id     INTEGER REFERENCES dm_accounts(id), -- Which DM account was used
  dm_video_id       TEXT,                       -- Dailymotion video ID
  dm_video_url      TEXT,                       -- Dailymotion embed/player URL
  dm_title          TEXT NOT NULL,              -- Format: "305644-1-4" or "m-305644"
  source_url        TEXT,                       -- Direct video URL from 4KHDHub
  resolution        TEXT,                       -- "1080p", "720p", etc.
  file_size_mb      REAL,                       -- File size in MB for tracking
  duration_seconds  INTEGER DEFAULT 0,          -- Video runtime in seconds
  upload_status     TEXT DEFAULT 'pending',     -- pending | uploading | uploaded | failed
  error_message     TEXT,
  created_at        TEXT DEFAULT (datetime('now')),
  updated_at        TEXT DEFAULT (datetime('now')),
  UNIQUE(tmdb_id, season, episode)
);

CREATE INDEX idx_videos_lookup ON videos(tmdb_id, season, episode);
CREATE INDEX idx_videos_dm ON videos(dm_video_id);
CREATE INDEX idx_videos_status ON videos(upload_status);
```

### `dm_accounts` — Dailymotion Account Swarm

```sql
CREATE TABLE dm_accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  label         TEXT NOT NULL,                -- Human-friendly name: "account-1", "backup-2"
  api_key       TEXT NOT NULL,
  api_secret    TEXT NOT NULL,
  profile_id    TEXT NOT NULL,
  access_token  TEXT,                          -- Cached OAuth2 token
  token_expires TEXT,                          -- Token expiry timestamp
  upload_count  INTEGER DEFAULT 0,            -- Total uploads on this account
  is_active     INTEGER DEFAULT 1,            -- 1 = active, 0 = disabled/banned
  last_used_at  TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_dm_active ON dm_accounts(is_active);
```

### `jobs` — Processing job tracking

```sql
CREATE TABLE jobs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT NOT NULL,                  -- scrape | resolve_tmdb | upload
  target_id   TEXT,                           -- reference ID
  status      TEXT DEFAULT 'queued',          -- queued | running | completed | failed
  result      TEXT,                           -- JSON result/error
  started_at  TEXT,
  completed_at TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);
```

---

## 🔄 Data Flow & Pipeline

### Phase 1: Discovery (Cron - every 6 hours)

```
1. Fetch https://4khdhub.one/category/korean-drama/page/{1..N}/
2. Parse all title cards (using ported parser.ts)
3. For each title:
   a. Fetch detail page
   b. Extract audio language badges/tags
   c. Check: has Korean/Original AND (Hindi OR English)?
   d. If YES → upsert into `titles` table
   e. Skip if already exists & completed
```

### Phase 2: TMDB Resolution

```
For each title with tmdb_id = NULL:
1. Search TMDB: GET /3/search/tv?query={title}&language=en (for series)
   or GET /3/search/movie?query={title}&language=en (for movies)
2. Filter results by year if available
3. Store best-match tmdb_id in titles table
4. For series: fetch season/episode counts from /3/tv/{id}
```

### Phase 3: Select Best Release

```
For each episode/movie with releases available:
  1. Group releases by resolution
  2. Priority order: 1080p > 720p > 480p > 2160p (4K too large for DM)
  3. Within same resolution, sort by file size ASCENDING (smallest first)
  4. Try uploading smallest first:
     a. Resolve mirror → direct URL
     b. Attempt Dailymotion upload
     c. If SUCCESS → done, move to next episode
     d. If FAIL → try next larger file in same resolution
     e. If all fail at this resolution → fallback to next resolution tier

  Example for Ballerina:
    1st try: "NF 1080p WEB-DL AV1"       → 770.97 MB  ✅ smallest
    2nd try: "NF 1080p WEB-DL HDR DV HEVC" → 2.72 GB
    3rd try: "NF 1080p WEB-DL HEVC"       → 2.92 GB
    4th try: "NF 1080p WEB-DL x264"       → 6.03 GB
    fallback: 720p releases (if any)
```

### Phase 4: Upload to Dailymotion (with Account Swarm)

```
For each title with status = 'discovered' or 'processing':
  For each episode (or single movie):
    1. Select best release (Phase 3 logic)
    2. Pick a Dailymotion account (round-robin / least-used from dm_accounts)
    3. Resolve best mirror → direct URL (hubcloud.ts logic)
    4. Generate dm_title:
       - Series: "{tmdb_id}-{season}-{episode}"  (e.g. "305644-1-4")
       - Movie:  "m-{tmdb_id}"                   (e.g. "m-305644")
    5. POST to Dailymotion API v2:
       - url: direct_video_url
       - title: dm_title
       - visibility: "private"
       - category: "creation"
    6. Store dm_video_id, dm_video_url, dm_account_id in videos table
    7. Increment account upload_count
    8. Mark upload_status = 'uploaded'
    9. If account fails (quota/ban) → mark account inactive, try next account
```

### Phase 5: Serve Lookup API (3rd-Party Consumer Friendly)

```
GET /ko/{tmdbid}/{season}/{episode}  →  Specific Series Episode
GET /ko/{tmdbid}                      →  Movie / Series Catalog Overview
```

#### 1. Episode Ready Response (`status: "ready"`):
```json
{
  "tmdb_id": 314939,
  "title": "A Love Other Than Yours",
  "season": 1,
  "episode": 1,
  "status": "ready",
  "is_movie": false,
  "is_on_air": true,
  "airing_status": "Returning Series",
  "dm_video_id": "k3jeCh8bNJZ5kgJW4Jo",
  "dm_video_url": "https://www.dailymotion.com/video/k3jeCh8bNJZ5kgJW4Jo",
  "dm_embed_url": "https://geo.dailymotion.com/player.html?video=k3jeCh8bNJZ5kgJW4Jo",
  "resolution": "1080p",
  "duration_seconds": 3840,
  "upload_status": "uploaded"
}
```

#### 2. On-Air / Upcoming Episode Awaiting Release (`status: "pending_source"`):
```json
{
  "tmdb_id": 314939,
  "title": "A Love Other Than Yours",
  "season": 1,
  "episode": 7,
  "status": "pending_source",
  "is_on_air": true,
  "airing_status": "Returning Series",
  "next_air_date": "2026-10-10",
  "last_air_date": "2026-10-03",
  "total_episodes": 14,
  "message": "Episode S1E7 is on-air or upcoming. Not yet published on source (4KHDHub). Background scheduler checks regularly for new releases.",
  "dm_video_id": null,
  "dm_video_url": null,
  "dm_embed_url": null,
  "retry_after_hours": 6
}
```

#### 3. Series Catalog Overview (`GET /ko/314939`):
```json
{
  "tmdb_id": 314939,
  "title": "A Love Other Than Yours",
  "kind": "series",
  "is_movie": false,
  "is_on_air": true,
  "airing_status": "Returning Series",
  "total_seasons": 1,
  "total_episodes": 14,
  "uploaded_episodes_count": 6,
  "episodes": [
    {
      "season": 1,
      "episode": 1,
      "dm_video_id": "k3jeCh8bNJZ5kgJW4Jo",
      "dm_embed_url": "https://geo.dailymotion.com/player.html?video=k3jeCh8bNJZ5kgJW4Jo",
      "resolution": "1080p"
    }
  ]
}
```

---

## 📁 Project Structure

```
server-to-dailymotion/
├── fourkhdhub/                    # Original Rust reference (read-only)
│
├── app/                           # Next.js App Router
│   ├── layout.tsx
│   ├── page.tsx                   # Admin dashboard (optional)
│   ├── ko/
│   │   ├── [tmdbid]/
│   │   │   ├── route.ts           # Movie lookup: GET /ko/{tmdbid}
│   │   │   └── [season]/
│   │   │       └── [episode]/
│   │   │           └── route.ts   # Episode lookup: GET /ko/{tmdbid}/{season}/{episode}
│   └── api/
│       ├── cron/
│       │   ├── scrape/
│       │   │   └── route.ts       # Cron endpoint: discover new titles
│       │   └── upload/
│       │       └── route.ts       # Cron endpoint: process upload queue
│       ├── admin/
│       │   ├── titles/
│       │   │   └── route.ts       # List/manage discovered titles
│       │   └── videos/
│       │       └── route.ts       # List/manage uploaded videos
│       └── health/
│           └── route.ts           # Health check
│
├── lib/
│   ├── scraper/
│   │   ├── client.ts              # 4KHDHub HTTP client (port of client.rs)
│   │   ├── parser.ts              # HTML parsing (port of parser.rs)
│   │   ├── hubcloud.ts            # Mirror resolution (port of hubcloud.rs)
│   │   └── types.ts               # TypeScript types
│   ├── dailymotion/
│   │   ├── client.ts              # Dailymotion API v2 client
│   │   ├── auth.ts                # OAuth2 token management
│   │   ├── swarm.ts               # Multi-account manager (round-robin, health checks)
│   │   └── types.ts
│   ├── tmdb/
│   │   ├── client.ts              # TMDB API v3 client
│   │   └── types.ts
│   ├── db/
│   │   ├── client.ts              # DB client (SQLite local / Turso prod — auto-detect)
│   │   ├── schema.ts              # SQL schema definitions
│   │   └── queries.ts             # Prepared queries
│   ├── pipeline/
│   │   ├── discover.ts            # Phase 1: scrape & filter
│   │   ├── resolve-tmdb.ts        # Phase 2: TMDB matching
│   │   ├── select-release.ts      # Phase 3: Best release picker (1080p smallest-first)
│   │   └── upload.ts              # Phase 4: Dailymotion upload via swarm
│   └── utils/
│       ├── audio-filter.ts        # Korean + Hindi/English filter logic
│       ├── release-picker.ts      # Resolution priority + file size sorting
│       └── title-format.ts        # dm_title formatting helpers
│
├── scripts/
│   ├── test-scraper.ts            # Local test: scrape a single title
│   ├── test-upload.ts             # Local test: upload one video to DM
│   └── seed-accounts.ts           # Seed DM accounts into local DB
│
├── data/
│   └── local.db                   # Local SQLite database file (git-ignored)
│
├── vercel.json                    # Cron configuration
├── package.json
├── tsconfig.json
├── .env.local                     # Local env vars
├── .env.example                   # Template
└── implementation.md              # This file
```

---

## 🔑 Environment Variables

```env
# Database Mode (local = SQLite file, turso = Turso cloud)
DB_MODE=local                            # "local" for dev, "turso" for prod
DB_PATH=./data/local.db                  # SQLite file path (local mode only)
TURSO_DATABASE_URL=libsql://your-db.turso.io   # Turso (prod mode only)
TURSO_AUTH_TOKEN=your-turso-auth-token         # Turso (prod mode only)

# Dailymotion Accounts (stored in DB, but first account can be env-based)
# Additional accounts added via admin API or seed script
DAILYMOTION_API_KEY=your-dm-api-key
DAILYMOTION_API_SECRET=your-dm-api-secret
DAILYMOTION_PROFILE_ID=your-dm-profile-id

# TMDB API
TMDB_API_KEY=your-tmdb-api-key

# App
CRON_SECRET=your-cron-secret          # Protect cron endpoints
ADMIN_SECRET=your-admin-secret        # Protect admin endpoints
```

---

## ⏱️ Vercel Cron Configuration

```json
{
  "crons": [
    {
      "path": "/api/cron/scrape",
      "schedule": "0 */6 * * *"
    },
    {
      "path": "/api/cron/upload",
      "schedule": "30 */2 * * *"
    }
  ]
}
```

- **Scrape job** runs every 6 hours → discovers new Korean dramas
- **Upload job** runs every 2 hours → processes pending uploads (batch of 5-10 per run to stay within 300s timeout)

---

## 🔗 URL Routing Logic

### Lookup endpoint: `/ko/[tmdbid]` and `/ko/[tmdbid]/[season]/[episode]`

```typescript
// Regex logic for movie vs series:
// If URL is /ko/305644          → series? check DB
// If dm_title starts with "m-"  → movie
// dm_title format:
//   Series: "{tmdb_id}-{season}-{episode}"  e.g. "305644-1-4"
//   Movie:  "m-{tmdb_id}"                   e.g. "m-305644"

// Route: /ko/[tmdbid]/route.ts
// → If tmdb_id exists as movie in DB → return movie data
// → If tmdb_id exists as series → return all seasons/episodes list

// Route: /ko/[tmdbid]/[season]/[episode]/route.ts
// → Return specific episode data with Dailymotion video URL
```

---

## 🔒 Dailymotion Upload Flow (with Account Swarm)

```typescript
// === Account Swarm Manager ===
class DmSwarm {
  // Pick the best account: active, least-used, valid token
  async pickAccount(): Promise<DmAccount> {
    // 1. Get all active accounts from DB
    // 2. Sort by upload_count ASC (least-used first)
    // 3. Check token validity, refresh if needed
    // 4. Return best candidate
  }

  // Add a new account to the swarm
  async addAccount(key: string, secret: string, profileId: string): Promise<void> {
    // Insert into dm_accounts table
  }

  // Mark account as inactive (quota exceeded, banned, etc.)
  async deactivateAccount(id: number): Promise<void> {
    // UPDATE dm_accounts SET is_active = 0 WHERE id = ?
  }
}

// === Per-Account OAuth2 ===
async function getToken(account: DmAccount): Promise<string> {
  // Check cached token
  if (account.access_token && !isExpired(account.token_expires)) {
    return account.access_token;
  }
  // Refresh
  const tokenResp = await fetch('https://oauth2.dailymotion.com/v2/token', {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: account.api_key,
      client_secret: account.api_secret,
      scope: 'manage_videos',
    }),
  });
  // Cache token in DB
  return accessToken;
}

// === Upload with Fallback ===
async function uploadWithSwarm(videoUrl: string, title: string): Promise<UploadResult> {
  const swarm = new DmSwarm();
  const accounts = await swarm.getActiveAccounts();

  for (const account of accounts) {
    try {
      const token = await getToken(account);
      const resp = await fetch(
        `https://api.dailymotion.com/v2/profiles/${account.profile_id}/videos`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: videoUrl,
            title: title,
            visibility: 'private',
            is_for_kids: false,
            category: 'creation',
          }),
        }
      );

      if (resp.ok) {
        await swarm.incrementUploadCount(account.id);
        return { success: true, account_id: account.id, data: await resp.json() };
      }

      // If quota/rate limited → try next account
      if (resp.status === 429 || resp.status === 403) {
        await swarm.deactivateAccount(account.id);
        continue;
      }
    } catch (e) {
      continue; // Try next account
    }
  }

  return { success: false, error: 'All DM accounts exhausted' };
}
```

---

## 🎯 Audio Language Filtering Logic

```typescript
// Audio languages are in <code><span> tags inside download items:
//   <code><span>770.97 MB</span><span>Hindi, English, Korean</span><span>WEB-DL</span></code>

function meetsAudioCriteria(audioLangs: string[]): boolean {
  const langs = audioLangs.map(l => l.toLowerCase());
  const hasKorean = langs.some(l =>
    l.includes('korean') || l.includes('original')
  );
  const hasHindi = langs.some(l => l.includes('hindi'));
  const hasEnglish = langs.some(l => l.includes('english'));

  return hasKorean && (hasHindi || hasEnglish);
}
```

---

## 📐 Release Selection Algorithm

```typescript
interface Release {
  title: string;          // "Ballerina (NF 1080p WEB-DL AV1)"
  resolution: string;     // "1080p"
  fileSizeMb: number;     // 770.97
  mirrors: string[];      // HubCloud/GreenMotors URLs
}

// Resolution priority: 1080p → 720p → 480p → 2160p (4K is usually too large)
const RESOLUTION_PRIORITY = ['1080p', '720p', '480p', '2160p'];

function selectBestRelease(releases: Release[]): Release[] {
  // 1. Group by resolution
  const byRes = new Map<string, Release[]>();
  for (const r of releases) {
    const group = byRes.get(r.resolution) || [];
    group.push(r);
    byRes.set(r.resolution, group);
  }

  // 2. Build ordered list: resolution priority × file size ascending
  const ordered: Release[] = [];
  for (const res of RESOLUTION_PRIORITY) {
    const group = byRes.get(res);
    if (group) {
      group.sort((a, b) => a.fileSizeMb - b.fileSizeMb); // smallest first
      ordered.push(...group);
    }
  }

  return ordered; // First item = best choice, rest = fallbacks
}

// Usage: try each in order until upload succeeds
const candidates = selectBestRelease(releases);
for (const release of candidates) {
  const url = await resolveDirectUrl(release.mirrors[0]);
  const result = await uploadWithSwarm(url, dmTitle);
  if (result.success) break; // Done!
}
```

---

## 📦 Key Dependencies

```json
{
  "dependencies": {
    "next": "^14.0.0",
    "cheerio": "^1.0.0",
    "better-sqlite3": "^11.0.0",   // Local SQLite (dev)
    "@libsql/client": "^0.14.0",   // Turso (prod)
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "@types/better-sqlite3": "^7.0.0",
    "@types/node": "^20.0.0",
    "@types/react": "^18.0.0",
    "tsx": "^4.0.0"                  // Run TS scripts directly for testing
  }
}
```

> **Note**: No `axios` needed — Next.js has native `fetch`. No `puppeteer` — all scraping is pure HTML parsing.
> `tsx` is used to run test scripts like `npx tsx scripts/test-scraper.ts` during local dev.

---

## 🚀 Implementation Phases

### Phase 1: Local Foundation (Day 1)
- [ ] Initialize Next.js project with TypeScript
- [ ] Set up local SQLite with `better-sqlite3` + create schema
- [ ] Port `parser.ts` from Rust `parser.rs`
- [ ] Port `client.ts` from Rust `client.rs`
- [ ] Port `hubcloud.ts` from Rust `hubcloud.rs`
- [ ] Create `scripts/test-scraper.ts` — scrape ONE Korean drama and print results
- [ ] **TEST**: `npx tsx scripts/test-scraper.ts` — verify scraping works

### Phase 2: Local Pipeline (Day 2)
- [ ] Implement release picker (1080p smallest-first algorithm)
- [ ] Implement TMDB client + title matching
- [ ] Implement Dailymotion OAuth2 + upload client (single account first)
- [ ] Create `scripts/test-upload.ts` — resolve URL + upload ONE video to DM
- [ ] **TEST**: Upload a real video, verify it appears as private on Dailymotion

### Phase 3: Account Swarm + Full Pipeline (Day 3)
- [ ] Build `dm_accounts` table + swarm manager
- [ ] Create `scripts/seed-accounts.ts` — add multiple DM accounts
- [ ] Build full discovery pipeline (scrape → filter → match TMDB → store)
- [ ] Build full upload pipeline (select release → resolve → swarm upload → track)
- [ ] **TEST**: Run full pipeline locally on 2-3 titles end-to-end

### Phase 4: API Routes (Day 4)
- [ ] Build `/ko/[tmdbid]` movie lookup route
- [ ] Build `/ko/[tmdbid]/[season]/[episode]` episode lookup route
- [ ] Build `/api/admin/accounts` — add/list/toggle DM accounts
- [ ] Build `/api/admin/titles` and `/api/admin/videos` routes
- [ ] Add cron endpoints with auth
- [ ] **TEST**: Query local API, verify responses match DB

### Phase 5: Vercel Deployment (Day 5)
- [ ] Swap DB client from SQLite → Turso (env-based toggle)
- [ ] Set up Turso database + migrate schema
- [ ] Configure Vercel environment variables
- [ ] Deploy to Vercel
- [ ] Test cron jobs manually via curl
- [ ] Verify end-to-end flow in production

### Phase 6: Scale & Monitor (Day 6+)
- [ ] Add more DM accounts to the swarm
- [ ] Monitor upload success rates
- [ ] Fine-tune batch sizes for 300s timeout
- [ ] Add error alerting / dashboard

---

## ⚠️ Important Considerations

### Rate Limits & Throttling
- **4KHDHub**: Add 1-2s delay between requests to avoid IP bans
- **TMDB API**: 40 requests/10s rate limit
- **Dailymotion API**: Check rate limits per endpoint
- **Process in batches**: 5-10 episodes per cron invocation to stay within 300s Vercel timeout

### Error Recovery
- Idempotent operations (unique constraints prevent duplicates)
- Failed uploads retry on next cron cycle
- Store error messages for debugging

### HubCloud URL Expiry
- Direct URLs from HubCloud may expire
- Resolve URLs just before submitting to Dailymotion (don't cache)
- If Dailymotion fails to fetch, mark as failed and retry

### Vercel Hobby Limits
- **300s** max function duration
- **100 GB** bandwidth (we don't stream video through Vercel — Dailymotion fetches directly)
- **1M** function invocations/mo
- **2** cron jobs (Hobby plan allows up to 2)

---

## 🔄 Mapping from Rust → TypeScript

| Rust File | TypeScript Port | Key Changes |
|-----------|----------------|-------------|
| `client.rs` | `lib/scraper/client.ts` | `reqwest` → native `fetch`, `Url` → `URL` API |
| `parser.rs` | `lib/scraper/parser.ts` | `scraper` crate → `cheerio`, `LazyLock<Selector>` → cached selectors |
| `hubcloud.rs` | `lib/scraper/hubcloud.ts` | `base64` crate → `Buffer.from().toString('base64')`, same resolution chain |
| `mod.rs` | `lib/scraper/index.ts` | Direct export, no trait system needed |

---

## ✅ Success Criteria

1. All Korean dramas with Korean+(Hindi or English) audio discovered from 4KHDHub
2. Each title matched to TMDB ID
3. Smallest viable file (1080p preferred) selected for each episode/movie
4. Each episode/movie uploaded to Dailymotion as private video via account swarm
5. Titles follow format: `{tmdb_id}-{season}-{episode}` or `m-{tmdb_id}`
6. API endpoint returns Dailymotion video URL for any `tmdb_id/season/episode` combo
7. Data table tracks all content with upload status + which DM account was used
8. System runs autonomously via Vercel cron
9. Zero video data passes through Vercel (bandwidth efficient)
10. Easy to add new DM accounts (one API call or DB insert)
11. **Works locally first** before any cloud dependency
