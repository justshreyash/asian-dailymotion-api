/**
 * Dailymotion Account Swarm Manager
 *
 * Manages multiple DM accounts for upload distribution.
 * - Round-robin / least-used account selection
 * - Token caching with auto-refresh
 * - Daily upload count tracking (14/day limit per free account)
 * - Daily duration tracking (9.5h limit per free account)
 * - Intelligent Bin-Packing: routes to accounts with sufficient remaining capacity
 * - Auto-deactivation on quota/ban errors
 */

import {
  getActiveDmAccounts,
  getAllDmAccounts,
  updateDmAccountToken,
  incrementDmAccountUpload,
  deactivateDmAccount,
  DAILY_UPLOAD_LIMIT,
  DAILY_DURATION_LIMIT_SECONDS,
  type DmAccountRow,
} from '../db/queries';
import { getDmAccessToken, uploadVideoByUrl, deleteDmVideo, type DmUploadResult } from './client';

export interface SwarmUploadResult {
  success: boolean;
  accountId?: number;
  accountLabel?: string;
  videoId?: string;
  videoUrl?: string;
  embedUrl?: string;
  duration?: number;
  error?: string;
}

export interface AccountCapacity {
  id: number;
  label: string;
  dailyUploadCount: number;
  remainingUploads: number;
  dailyDurationSeconds: number;
  remainingDurationSeconds: number;
  totalUploads: number;
  isActive: boolean;
}

// In-memory swarm state for intelligent pacing & failure isolation
const nodeCooldowns = new Map<number, number>(); // accountId -> cooldown expiry timestamp (ms)
let lastUploadedAccountId: number | null = null;
let consecutiveUploadsOnNode: number = 0;

export class DmSwarm {
  /**
   * Get all active accounts that have enough remaining daily capacity for the requested duration.
   * Filters out any accounts currently in a temporary rate-limit cooldown.
   * If a node just completed 2 consecutive uploads, rotates other nodes to the front.
   */
  async getQualifiedAccounts(estimatedDurationSeconds = 3600, sizeMb?: number): Promise<DmAccountRow[]> {
    const now = Date.now();
    const accounts = await getActiveDmAccounts();

    let qualified = accounts.filter(account => {
      const cooldownUntil = nodeCooldowns.get(account.id);
      if (cooldownUntil && cooldownUntil > now) {
        return false;
      }
      const remainingUploads = DAILY_UPLOAD_LIMIT - (account.daily_upload_count || 0);
      const remainingDuration = DAILY_DURATION_LIMIT_SECONDS - (account.daily_duration_seconds || 0);
      return remainingUploads > 0 && remainingDuration >= estimatedDurationSeconds;
    });

    // If multiple nodes are available and the current node reached 2 consecutive uploads,
    // prioritize other nodes to enforce the 2-per-node swarm rotation policy
    if (qualified.length > 1 && lastUploadedAccountId != null && consecutiveUploadsOnNode >= 2) {
      qualified = [
        ...qualified.filter(a => a.id !== lastUploadedAccountId),
        ...qualified.filter(a => a.id === lastUploadedAccountId),
      ];
    }

    return qualified;
  }

  /**
   * Returns the maximum duration (in seconds) available on any single active account in the swarm.
   */
  async getMaxRemainingDuration(): Promise<number> {
    const now = Date.now();
    const accounts = await getActiveDmAccounts();
    if (accounts.length === 0) return 0;
    
    let maxRemaining = 0;
    for (const acc of accounts) {
      const cooldownUntil = nodeCooldowns.get(acc.id);
      if (cooldownUntil && cooldownUntil > now) continue;

      if (acc.daily_upload_count < DAILY_UPLOAD_LIMIT) {
        const rem = DAILY_DURATION_LIMIT_SECONDS - (acc.daily_duration_seconds || 0);
        if (rem > maxRemaining) {
          maxRemaining = rem;
        }
      }
    }
    return maxRemaining;
  }

  /**
   * Upload a video using the best available account from the swarm.
   * Tries qualified accounts in order (least-used first) until one succeeds.
   */
  async upload(
    videoUrl: string,
    title: string,
    options: { estimatedDurationSeconds?: number; sizeMb?: number } = {}
  ): Promise<SwarmUploadResult> {
    const isMovieTitle = title.startsWith('m-') || !title.includes('-');
    const estimatedDuration = options.estimatedDurationSeconds || (isMovieTitle ? 5400 : 3600);

    // 1. First attempt only accounts with verified remaining duration capacity
    let accounts = await this.getQualifiedAccounts(estimatedDuration, options.sizeMb);

    // If no qualified accounts found with full estimated duration, but some active accounts exist with at least 15 min left
    if (accounts.length === 0) {
      const allActive = await getActiveDmAccounts();
      if (allActive.length === 0) {
        return { success: false, error: 'No active DM accounts available (all exhausted, quarantined, or deactivated)' };
      }
      return {
        success: false,
        error: `Capacity hold: Item requires ~${Math.round(estimatedDuration / 60)}m, but max remaining node capacity is ${Math.round((await this.getMaxRemainingDuration()) / 60)}m.`,
      };
    }

    console.log(`  Swarm: ${accounts.length} qualified accounts for ~${Math.round(estimatedDuration / 60)}m upload ("${title}")...`);

    for (const account of accounts) {
      try {
        const token = await this.ensureToken(account);
        const remHours = ((DAILY_DURATION_LIMIT_SECONDS - (account.daily_duration_seconds || 0)) / 3600).toFixed(1);

        console.log(`  Trying node "${account.label}" (${account.daily_upload_count}/14 vids, ${remHours}h remaining today)...`);

        const result = await uploadVideoByUrl(token, {
          url: videoUrl,
          title,
          isPrivate: true,
        });

        if (result.success) {
          const duration = result.duration || estimatedDuration;
          await incrementDmAccountUpload(account.id, duration);

          if (lastUploadedAccountId === account.id) {
            consecutiveUploadsOnNode++;
          } else {
            lastUploadedAccountId = account.id;
            consecutiveUploadsOnNode = 1;
          }

          console.log(`  ✅ Uploaded via "${account.label}" (${account.daily_upload_count + 1}/${DAILY_UPLOAD_LIMIT} today, ${consecutiveUploadsOnNode} on node, ${Math.round(duration / 60)}m) → ${result.videoId}`);
          return {
            success: true,
            accountId: account.id,
            accountLabel: account.label,
            videoId: result.videoId,
            videoUrl: result.videoUrl,
            embedUrl: result.embedUrl,
            duration,
          };
        }

        // If this specific account reached its hourly/daily upload rate limit, put it on cooldown and try next node
        if (result.error?.includes('upload_limit_exceeded') || result.error?.includes('slow down') || result.error?.includes('429')) {
          console.log(`  ⚠️ Account "${account.label}" rate-limited ("${result.error}"). Setting 1-hour cooldown and rotating to next swarm node...`);
          nodeCooldowns.set(account.id, Date.now() + 60 * 60 * 1000);
          continue;
        }

        // If Dailymotion explicitly rejects the remote stream URL parameter itself, skip trying other accounts on the identical bad URL
        if (result.error?.includes('cannot_download_url') || result.error?.includes('invalid_url') || result.error?.includes('url_not_found')) {
          console.log(`  ⚠️ URL rejected by Dailymotion ingest bot ("${result.error}"). Skipping this stream URL.`);
          return { success: false, error: `Remote stream URL rejected: ${result.error}` };
        }

        // Other account-specific error — try next account in swarm
        console.log(`  ⚠️ Account "${account.label}" failed: ${result.error}. Trying next node...`);
        continue;

      } catch (e) {
        console.log(`  ❌ Account "${account.label}" threw: ${(e as Error).message}`);
        continue;
      }
    }

    return { success: false, error: 'All DM accounts failed for this upload' };
  }

  /**
   * Ensure we have a valid OAuth2 token for the given account.
   * Returns the access token string.
   */
  private async ensureToken(account: DmAccountRow): Promise<string> {
    // Check if cached token is still valid (with 5 min buffer)
    if (account.access_token && account.token_expires) {
      const expiresAt = new Date(account.token_expires);
      const now = new Date();
      const bufferMs = 5 * 60 * 1000; // 5 minutes
      if (expiresAt.getTime() - bufferMs > now.getTime()) {
        return account.access_token;
      }
    }

    // Refresh token
    console.log(`  Refreshing token for "${account.label}"...`);
    const tokenResp = await getDmAccessToken(account.api_key, account.api_secret);
    const expiresAt = new Date(Date.now() + tokenResp.expires_in * 1000).toISOString();

    await updateDmAccountToken(account.id, tokenResp.access_token, expiresAt);

    return tokenResp.access_token;
  }

  /**
   * Delete a video from Dailymotion using the owning account's token (or trying active accounts).
   */
  async deleteVideo(videoId: string, accountId?: number | null): Promise<boolean> {
    const allAccounts = await getAllDmAccounts();
    let accountsToTry: DmAccountRow[] = [];

    if (accountId) {
      const specific = allAccounts.find(a => a.id === accountId);
      if (specific) accountsToTry.push(specific);
    }
    for (const acc of allAccounts) {
      if (!accountsToTry.some(a => a.id === acc.id)) {
        accountsToTry.push(acc);
      }
    }

    for (const account of accountsToTry) {
      try {
        const token = await this.ensureToken(account);
        const deleted = await deleteDmVideo(token, videoId);
        if (deleted) {
          console.log(`  🗑️ Successfully deleted DM video "${videoId}" via account "${account.label}"`);
          return true;
        }
      } catch (e) {
        // continue trying
      }
    }
    return false;
  }

  /**
   * Get swarm status summary with daily counts and hours.
   */
  async getStatus(): Promise<{ active: number; accounts: { label: string; daily: number; dailyHours: string; maxDaily: number; maxHours: string; total: number; active: boolean }[] }> {
    const accounts = await getActiveDmAccounts();
    return {
      active: accounts.length,
      accounts: accounts.map(a => ({
        label: a.label,
        daily: a.daily_upload_count,
        dailyHours: ((a.daily_duration_seconds || 0) / 3600).toFixed(1),
        maxDaily: DAILY_UPLOAD_LIMIT,
        maxHours: (DAILY_DURATION_LIMIT_SECONDS / 3600).toFixed(1),
        total: a.upload_count,
        active: a.is_active === 1,
      })),
    };
  }
}


