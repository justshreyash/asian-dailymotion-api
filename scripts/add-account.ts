/**
 * CLI Helper to add a new Dailymotion account to the Swarm.
 *
 * Usage:
 *   npx tsx scripts/add-account.ts <label> <apiKey> <apiSecret>
 *
 * Example:
 *   npx tsx scripts/add-account.ts dm-account-2 your_key your_secret
 */

import 'dotenv/config';
import { initSchema } from '../lib/db/schema';
import { addDmAccount, getAllDmAccounts } from '../lib/db/queries';
import { closeDb } from '../lib/db/client';

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 3) {
    console.log('Usage: npx tsx scripts/add-account.ts <label> <apiKey> <apiSecret>');
    console.log('\nCurrent registered accounts:');
    initSchema();
    const accounts = getAllDmAccounts();
    console.table(accounts.map(a => ({
      id: a.id,
      label: a.label,
      active: a.is_active === 1,
      daily_uploads: a.daily_upload_count,
      daily_hours: ((a.daily_duration_seconds || 0) / 3600).toFixed(1),
      total_uploads: a.upload_count,
    })));
    closeDb();
    process.exit(0);
  }

  const [label, apiKey, apiSecret] = args;

  initSchema();
  const account = addDmAccount({ label, apiKey, apiSecret });
  console.log(`✅ Successfully added account "${account.label}" (ID: ${account.id}) to Dailymotion Swarm!`);

  console.log('\nAll accounts in swarm:');
  const accounts = getAllDmAccounts();
  console.table(accounts.map(a => ({
    id: a.id,
    label: a.label,
    active: a.is_active === 1,
    daily_uploads: a.daily_upload_count,
    daily_hours: ((a.daily_duration_seconds || 0) / 3600).toFixed(1),
    total_uploads: a.upload_count,
  })));

  closeDb();
}

main().catch(err => {
  console.error('Error adding account:', err);
  closeDb();
  process.exit(1);
});
