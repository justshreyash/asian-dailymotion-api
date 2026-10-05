# ⚡ Dailymotion Swarm Hub & Pipeline Manager

Automated Korean drama & movie pipeline engine that ingests releases from 4KHDHub (Korean audio with multi-sub/Hindi/Eng), resolves TMDB IDs, optimizes file sizes with intelligent greedy bin-packing into a multi-account Dailymotion swarm, and exposes high-performance streaming lookup APIs for 3rd-party services.

---

## 🏗️ Architecture & Core Features

```
               ┌───────────────────────┐
               │    4KHDHub Scraper    │ (Korean Dramas & Movies)
               └──────────┬────────────┘
                          │
               ┌──────────▼────────────┐
               │  TMDB Metadata Engine │ (100% ID Resolution & Air Dates)
               └──────────┬────────────┘
                          │
         ┌────────────────▼────────────────┐
         │  Greedy Capacity Bin-Packer     │
         │  (1080p Smallest-First + Hold)  │
         └──────────┬───────────┬──────────┘
                    │           │
       ┌────────────▼──┐     ┌──▼────────────┐
       │ Swarm Node #1 │     │ Swarm Node #2 │ (Dailymotion Swarm Drive)
       └───────┬───────┘     └──┬────────────┘
               └──────────┬─────┘
                          │
             ┌────────────▼────────────┐
             │   Public 3rd-Party API  │
             │   /ko/[tmdbid]/[s]/[e]  │ (Direct Streams & Geo Player Embeds)
             └─────────────────────────┘
```

* **Prioritized Ingestion Queue**:
  1. Explicitly requested dramas (e.g. `[314939]`)
  2. On-air broadcasting series (auto-syncs schedule from TMDB)
  3. Release year descending (`2026` ➔ `2025` ➔ `2024` ➔ ...)
  4. In-progress series
* **Smart Bin-Packing & Hold Queue**: If a large video (e.g., 2 GB / 90m) exceeds a node's remaining daily capacity, it is safely preserved in `on_hold` status without stopping the pipeline. The engine automatically bin-packs smaller files (400 MB / 20–30 min episodes) to maximize daily quota utilization.
* **Autonomous Release**: `on_hold` items automatically release upon 24h daily reset or whenever a new swarm node is added.
* **Zero Video Proxying**: Stream links are sent directly to Dailymotion via URL upload mode—**0 bytes of video pass through Vercel**.

---

## 📊 Monthly Free Tier Sustainability (Theory & Practice)

| Platform | Free Tier Quota | Monthly Usage Projection | Sustainability |
| :--- | :--- | :--- | :--- |
| **Vercel Hobby** | 100 GB Data Transfer / mo | **< 200 MB / mo** (API responses only) | 🟢 **100% Safe** (Zero video proxying) |
| **Vercel Functions** | 100 GB-Hours / mo | **~3.6 GB-Hours / mo** (4 cron runs / day) | 🟢 **100% Safe** (<4% of quota) |
| **Turso Cloud DB** | 9 GB Storage & 500M reads | **~15 MB** DB size / <100k reads / mo | 🟢 **100% Safe** (<0.2% storage) |
| **TMDB API** | Free unlimited (~40 req/10s) | Cached permanently in Turso | 🟢 **100% Safe** |
| **Dailymotion Swarm** | 14 vids / 9.5h per account daily | **Resets every 24h** (scales with swarm nodes) | 🟢 **Unlimited Monthly** |

---

## 🚀 1-Click Deployment to Vercel

1. Push this repository to GitHub.
2. Import the project in [Vercel Dashboard](https://vercel.com/new).
3. Add the following **Environment Variables** in Vercel Project Settings:

```env
# TMDB API Key
TMDB_API_KEY=your_tmdb_api_key

# Turso Cloud Database
TURSO_DATABASE_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=your_turso_jwt_token

# Pipeline Security Keys
CRON_SECRET=your_custom_cron_secret
ADMIN_SECRET=your_secure_admin_password
```

4. Click **Deploy**. Vercel will build the production bundle and schedule automated cron processing every 6 hours (`0 */6 * * *`).

---

## 🔌 3rd-Party Public API Endpoints

### 1. Episode Stream Lookup
`GET /ko/[tmdbid]/[season]/[episode]`

**Response (Available)**:
```json
{
  "status": "ready",
  "tmdb_id": 314939,
  "season": 1,
  "episode": 1,
  "title": "A Love Other Than Yours",
  "video_id": "k7HZRBqrPR77LnL4J3Q",
  "video_url": "https://www.dailymotion.com/video/k7HZRBqrPR77LnL4J3Q",
  "embed_url": "https://geo.dailymotion.com/player.html?video=k7HZRBqrPR77LnL4J3Q",
  "resolution": "1080p",
  "file_size_mb": 1150
}
```

**Response (On-Air / Pending Broadcast)**:
```json
{
  "status": "pending_source",
  "message": "Episode has not yet been broadcast or released by 4KHDHub source.",
  "tmdb_id": 314939,
  "season": 1,
  "episode": 7,
  "next_air_date": "2026-10-06"
}
```

### 2. Movie Stream Lookup
`GET /ko/[tmdbid]`

---

## 🛡️ Admin Dashboard
Access the dashboard at `https://your-domain.vercel.app/`. Enter your `ADMIN_SECRET` to unlock:
* Real-time transfer graphs
* Swarm node daily video count & duration meters
* 1-Click manual pipeline triggers
* Direct video player previews and API endpoint copy shortcuts
