import 'dotenv/config';
import Database from 'better-sqlite3';
import { createClient } from '@libsql/client';

async function main() {
  console.log('🔄 Syncing takedown columns and marking suspended videos...');

  // 1. Local SQLite migrations
  const db = new Database('./data/local.db');
  try { db.prepare("ALTER TABLE dm_accounts ADD COLUMN strike_count INTEGER DEFAULT 0").run(); } catch {}
  try { db.prepare("ALTER TABLE dm_accounts ADD COLUMN status TEXT DEFAULT 'active'").run(); } catch {}
  try { db.prepare("ALTER TABLE videos ADD COLUMN takedown_detected_at TEXT").run(); } catch {}
  try { db.prepare("ALTER TABLE videos ADD COLUMN takedown_reason TEXT").run(); } catch {}

  // 2. Turso Cloud migrations
  const turso = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });

  try { await turso.execute("ALTER TABLE dm_accounts ADD COLUMN strike_count INTEGER DEFAULT 0"); } catch {}
  try { await turso.execute("ALTER TABLE dm_accounts ADD COLUMN status TEXT DEFAULT 'active'"); } catch {}
  try { await turso.execute("ALTER TABLE videos ADD COLUMN takedown_detected_at TEXT"); } catch {}
  try { await turso.execute("ALTER TABLE videos ADD COLUMN takedown_reason TEXT"); } catch {}

  // 3. Mark the 4 detected takedown videos from today's run
  const takedownIds = [24, 25, 26, 27];
  const now = new Date().toISOString();
  const reason = 'Flagged by Dailymotion Automated Fingerprint Recognition (Suspended)';

  for (const id of takedownIds) {
    db.prepare(`
      UPDATE videos 
      SET upload_status = 'takedown', error_message = ?, takedown_reason = ?, takedown_detected_at = ? 
      WHERE id = ?
    `).run(reason, reason, now, id);

    await turso.execute({
      sql: `UPDATE videos SET upload_status = 'takedown', error_message = ?, takedown_reason = ?, takedown_detected_at = ? WHERE id = ?`,
      args: [reason, reason, now, id],
    });
    console.log(`  🚨 Marked video #${id} as 'takedown' in local and Turso DB`);
  }

  // 4. Update strike count on hosting accounts (Account #1 and Account #2)
  await turso.execute("UPDATE dm_accounts SET strike_count = 2, status = 'quarantined', is_active = 0 WHERE id = 1");
  await turso.execute("UPDATE dm_accounts SET strike_count = 2, status = 'quarantined', is_active = 0 WHERE id = 2");

  db.prepare("UPDATE dm_accounts SET strike_count = 2, status = 'quarantined', is_active = 0 WHERE id = 1").run();
  db.prepare("UPDATE dm_accounts SET strike_count = 2, status = 'quarantined', is_active = 0 WHERE id = 2").run();

  console.log('✅ Accounts marked with strikes and quarantined for safety!');
}

main().catch(console.error);
