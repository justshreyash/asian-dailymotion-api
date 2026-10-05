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
  updateDmAccountToken,
  incrementDmAccountUpload,
  deactivateDmAccount,
  DAILY_UPLOAD_LIMIT,
  DAILY_DURATION_LIMIT_SECONDS,
  type DmAccountRow,
} from '../db/queries';
import { getDmAccessToken, uploadVideoByUrl, type DmUploadResult } from './client';

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

export class DmSwarm {
  /**
   * Get all active accounts that have enough remaining daily capacity for the requested duration.
   */
  async getQualifiedAccounts(estimatedDurationSeconds = 3600, sizeMb?: number): Promise<DmAccountRow[]> {
    const accounts = await getActiveDmAccounts();
    return accounts.filter(account => {
      const remainingUploads = DAILY_UPLOAD_LIMIT - (account.daily_upload_count || 0);
      const remainingDuration = DAILY_DURATION_LIMIT_SECONDS - (account.daily_duration_seconds || 0);
      return remainingUploads > 0 && remainingDuration >= estimatedDurationSeconds;
    });
  }

  /**
   * Returns the maximum duration (in seconds) available on any single active account in the swarm.
   */
  async getMaxRemainingDuration(): Promise<number> {
    const accounts = await getActiveDmAccounts();
    if (accounts.length === 0) return 0;
    
    let maxRemaining = 0;
    for (const acc of accounts) {
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
        return { success: false, error: 'No active DM accounts available (all exhausted or deactivated)' };
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
          console.log(`  ✅ Uploaded via "${account.label}" (${account.daily_upload_count + 1}/${DAILY_UPLOAD_LIMIT} today, ${Math.round(duration / 60)}m) → ${result.videoId}`);
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

        // Check if it's a rate limit or quota error
        if (result.error?.includes('429') || result.error?.includes('403') || result.error?.includes('quota') || result.error?.includes('upload_limit_exceeded') || result.error?.includes('slow down')) {
          console.log(`  ⚠️ Account "${account.label}" reached rate limit or daily quota. Bypassing node for this batch.`);
          continue;
        }

        // Other error — log and try next account
        console.log(`  ❌ Account "${account.label}" failed: ${result.error}`);
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

