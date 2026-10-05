import 'dotenv/config';
import { dbRun, closeDb } from '../lib/db/client';
import { getAllDmAccounts, resetHoldVideos } from '../lib/db/queries';

async function main() {
  await dbRun("UPDATE dm_accounts SET is_active = 1 WHERE status = 'active'");
  console.log('Reactivated all active accounts.');

  const resetCount = await resetHoldVideos();
  console.log(`Reset ${resetCount} hold videos back to pending.`);

  const accounts = await getAllDmAccounts();
  for (const a of accounts) {
    console.log(`Account #${a.id} "${a.label}": is_active = ${a.is_active}, status = ${a.status}, strike_count = ${a.strike_count}, daily_hours = ${((a.daily_duration_seconds || 0) / 3600).toFixed(2)}h`);
  }
  closeDb();
}

main().catch(console.error);
