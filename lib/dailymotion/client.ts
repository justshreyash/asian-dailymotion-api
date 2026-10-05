import https from 'node:https';

export interface DmUploadResult {
  success: boolean;
  videoId?: string;
  videoUrl?: string;
  embedUrl?: string;
  duration?: number;
  error?: string;
}

export interface DmTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

export interface DmVideoResponse {
  id: string;
  title: string;
  url: string;
  embed_url: string;
  status: string;
}

function httpsRequest(options: https.RequestOptions, body?: string): Promise<{ status: number; data: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode || 200, data: raw }));
    });
    req.on('error', reject);
    req.setTimeout(25000, () => {
      req.destroy();
      reject(new Error('Dailymotion request timed out'));
    });
    if (body) req.write(body);
    req.end();
  });
}

async function resilientPost(urlStr: string, headers: Record<string, string>, body: string, retries = 3): Promise<any> {
  const url = new URL(urlStr);
  let lastErr: Error | null = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await httpsRequest({
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          ...headers,
          'Content-Length': Buffer.byteLength(body),
        },
      }, body);

      if (res.status >= 400 && res.status !== 401 && res.status !== 403 && res.status !== 429) {
        throw new Error(`HTTP ${res.status}: ${res.data}`);
      }

      return { status: res.status, json: JSON.parse(res.data), text: res.data };
    } catch (e) {
      lastErr = e as Error;
      if (attempt < retries) await new Promise(r => setTimeout(r, attempt * 600));
    }
  }
  throw lastErr || new Error(`Failed to POST to ${urlStr}`);
}

async function resilientGet(urlStr: string, headers: Record<string, string>, retries = 3): Promise<any> {
  const url = new URL(urlStr);
  let lastErr: Error | null = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await httpsRequest({
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'GET',
        headers,
      });

      if (res.status >= 400) {
        return null;
      }

      return JSON.parse(res.data);
    } catch (e) {
      lastErr = e as Error;
      if (attempt < retries) await new Promise(r => setTimeout(r, attempt * 500));
    }
  }
  return null;
}

/**
 * Get an OAuth2 access token using client_credentials grant.
 */
export async function getDmAccessToken(apiKey: string, apiSecret: string): Promise<DmTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: apiKey,
    client_secret: apiSecret,
    scope: 'manage_videos',
  }).toString();

  const res = await resilientPost(
    'https://partner.api.dailymotion.com/oauth/v1/token',
    { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  );

  if (res.status >= 400) {
    throw new Error(`DM OAuth2 failed (${res.status}): ${res.text}`);
  }

  return res.json as DmTokenResponse;
}

/**
 * Upload a video to Dailymotion by providing a remote URL.
 * Dailymotion will fetch the video from the URL itself.
 */
function extractOwnerIdFromJwt(token: string): string | null {
  try {
    const parts = token.split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      return payload.ooi || null;
    }
  } catch {}
  return null;
}

export async function uploadVideoByUrl(
  accessToken: string,
  data: {
    url: string;
    title: string;
    isPrivate: boolean;
    category?: string;
    channelId?: string;
  },
): Promise<DmUploadResult> {
  const targetUser = data.channelId || extractOwnerIdFromJwt(accessToken);
  const endpoint = targetUser
    ? `https://partner.api.dailymotion.com/rest/user/${targetUser}/videos`
    : `https://partner.api.dailymotion.com/rest/videos`;

  const body = new URLSearchParams({
    url: data.url,
    title: data.title,
    channel: data.category || 'creation',
    published: 'true',
    private: data.isPrivate ? 'true' : 'false',
    is_created_for_kids: 'false',
  }).toString();

  const res = await resilientPost(
    endpoint,
    {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body
  );

  if (res.status >= 400) {
    return {
      success: false,
      error: `DM upload failed (${res.status}): ${res.text}`,
    };
  }

  const video = res.json as any;

  // For private videos, fetch private_id so the link and player work without "Private video" restriction
  let videoId = video.id;
  let videoUrl = `https://www.dailymotion.com/video/${video.id}`;
  let embedUrl = `https://www.dailymotion.com/embed/video/${video.id}`;
  let duration: number | undefined;

  try {
    const details = await checkVideoStatus(accessToken, video.id);
    if (details) {
      if (details.private_id) {
        videoId = details.private_id;
      }
      if (details.url) {
        videoUrl = details.url;
      }
      if (details.embed_url) {
        embedUrl = details.embed_url;
      }
      if (details.duration) {
        duration = details.duration;
      }
    }
  } catch (e) {
    console.warn('Could not fetch private_id details:', e);
  }

  return {
    success: true,
    videoId,
    videoUrl,
    embedUrl,
    duration,
  };
}

/**
 * Check if a Dailymotion video exists and its processing status.
 */
export async function checkVideoStatus(
  accessToken: string,
  videoId: string,
): Promise<{ status: string; title: string; private_id?: string; url?: string; embed_url?: string; duration?: number } | null> {
  return resilientGet(
    `https://partner.api.dailymotion.com/rest/video/${videoId}?fields=status,title,private_id,url,embed_url,duration`,
    { Authorization: `Bearer ${accessToken}` }
  );
}
