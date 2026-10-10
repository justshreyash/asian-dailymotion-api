/**
 * Playmate Video Hosting API Client
 * Docs: https://playmate.to/api-docs
 */

export interface PlaymateUploadResult {
  success: boolean;
  fileCode?: string;
  embedUrl?: string;
  videoUrl?: string;
  videoId?: number;
  title?: string;
  error?: string;
}

export interface PlaymateFileInfo {
  status: number;
  file_code: string;
  name?: string;
  canplay?: number;
  state?: string; // 'waiting', 'pending', 'active', 'deleted'
  views?: string | number;
  views_started?: string | number;
  length?: string | number; // duration in seconds
  uploaded?: string;
  video_codec?: string;
  audio_codec?: string;
  resolution?: string;
  size?: number;
}

export interface PlaymateAccountInfo {
  username: string;
  email: string;
  balance: string;
  total_earned: string;
  total_views: number;
  videos_total: number;
}

export class PlaymateClient {
  private apiKey: string;
  private folderId: number;
  private baseUrl: string = 'https://api.playmate.to';

  constructor(apiKey?: string, folderId?: number) {
    this.apiKey =
      apiKey ||
      process.env.PLAYMATE_API_KEY ||
      'deaf804d60034a3e2a42ccf4a0cfd2b8f6ce1f892f00cea2cba52e57dba7d052';
    this.folderId =
      folderId ??
      (process.env.PLAYMATE_FOLDER_ID ? parseInt(process.env.PLAYMATE_FOLDER_ID, 10) : 1233);
  }

  getFolderId(): number {
    return this.folderId;
  }

  /**
   * Helper to extract clean alphanumeric file code from either full URL or raw code.
   */
  static cleanFileCode(input: string): string {
    if (!input) return '';
    return input.includes('/') ? input.split('/').pop() || input : input;
  }

  /**
   * Upload video via Remote HTTP(S) URL.
   * Playmate server downloads and encodes video in the cloud.
   */
  async uploadByRemoteUrl(
    videoUrl: string,
    options: {
      folderId?: number;
      customTitle?: string;
    } = {}
  ): Promise<PlaymateUploadResult> {
    const fldId = options.folderId ?? this.folderId;
    try {
      const endpoint = `${this.baseUrl}/upload/url?key=${encodeURIComponent(
        this.apiKey
      )}&url=${encodeURIComponent(videoUrl)}&fld_id=${fldId}`;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0 (Server-To-Dailymotion/PlaymatePipeline)',
        },
      });

      if (!res.ok) {
        return {
          success: false,
          error: `HTTP ${res.status}: ${await res.text()}`,
        };
      }

      const data = await res.json();
      if (data?.status !== 200 || !data?.result?.filecode) {
        return {
          success: false,
          error: data?.msg || 'Failed to queue remote upload on Playmate',
        };
      }

      const rawFileCode = data.result.filecode;
      const fileCode = PlaymateClient.cleanFileCode(rawFileCode);

      // Optionally rename if custom title requested
      if (options.customTitle) {
        try {
          await this.renameFile(fileCode, options.customTitle);
        } catch {}
      }

      return {
        success: true,
        fileCode,
        embedUrl: `https://playmate.to/embed/${fileCode}`,
        videoUrl: `https://playmate.to/watch/${fileCode}`,
      };
    } catch (err) {
      return {
        success: false,
        error: (err as Error).message,
      };
    }
  }

  /**
   * Upload video directly by posting buffer / file payload to Playmate upload server.
   */
  async uploadDirectBuffer(
    buffer: Buffer | Blob,
    fileName: string,
    options: {
      folderId?: number;
      customTitle?: string;
    } = {}
  ): Promise<PlaymateUploadResult> {
    const fldId = options.folderId ?? this.folderId;
    try {
      // Step 1: Request upload server
      const srvRes = await fetch(`${this.baseUrl}/upload/server?key=${encodeURIComponent(this.apiKey)}`);
      if (!srvRes.ok) {
        return { success: false, error: `Failed to get upload server: HTTP ${srvRes.status}` };
      }
      const srvData = await srvRes.json();
      if (srvData?.status !== 200 || !srvData?.result?.upload_url) {
        return { success: false, error: srvData?.msg || 'Invalid upload server response' };
      }

      const uploadUrl = srvData.result.upload_url;
      const keyField = srvData.result.key_field || 'api_key';
      const fileField = srvData.result.file_field || 'vsrc';

      // Step 2: Post file multipart/form-data
      const formData = new FormData();
      formData.append(keyField, this.apiKey);
      formData.append('fld_id', fldId.toString());

      const blob = buffer instanceof Blob ? buffer : new Blob([new Uint8Array(buffer)], { type: 'video/mp4' });
      formData.append(fileField, blob, fileName);

      const postRes = await fetch(uploadUrl, {
        method: 'POST',
        body: formData,
      });

      const resText = await postRes.text();
      let resJson: any = null;
      try {
        resJson = JSON.parse(resText);
      } catch {
        return { success: false, error: `Invalid server response (${postRes.status}): ${resText}` };
      }

      if (resJson?.error) {
        return { success: false, error: resJson.error };
      }

      const fileCode = PlaymateClient.cleanFileCode(resJson.filecode);
      if (!fileCode) {
        return { success: false, error: 'No filecode returned from Playmate upload server' };
      }

      // Ensure file moved to folder
      try {
        await this.setFileFolder(fileCode, fldId);
      } catch {}

      // Optionally rename
      if (options.customTitle) {
        try {
          await this.renameFile(fileCode, options.customTitle);
        } catch {}
      }

      return {
        success: true,
        fileCode,
        videoId: resJson.video_id,
        title: resJson.title,
        embedUrl: `https://playmate.to/embed/${fileCode}`,
        videoUrl: `https://playmate.to/watch/${fileCode}`,
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * Get file information (encoding state, canplay, duration, codecs, size).
   */
  async getFileInfo(fileCode: string): Promise<PlaymateFileInfo | null> {
    const clean = PlaymateClient.cleanFileCode(fileCode);
    const res = await fetch(`${this.baseUrl}/file/info?key=${encodeURIComponent(this.apiKey)}&file_code=${clean}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.result?.[0] || null;
  }

  /**
   * Assign file to a destination folder.
   */
  async setFileFolder(fileCode: string, folderId: number): Promise<boolean> {
    const clean = PlaymateClient.cleanFileCode(fileCode);
    const res = await fetch(
      `${this.baseUrl}/file/set_folder?key=${encodeURIComponent(this.apiKey)}&file_code=${clean}&fld_id=${folderId}`,
      { method: 'POST' }
    );
    if (!res.ok) return false;
    const data = await res.json();
    return data?.status === 200;
  }

  /**
   * Rename a video.
   */
  async renameFile(fileCode: string, newName: string): Promise<boolean> {
    const clean = PlaymateClient.cleanFileCode(fileCode);
    const res = await fetch(
      `${this.baseUrl}/file/rename?key=${encodeURIComponent(this.apiKey)}&file_code=${clean}&name=${encodeURIComponent(
        newName
      )}`,
      { method: 'POST' }
    );
    if (!res.ok) return false;
    const data = await res.json();
    return data?.status === 200;
  }

  /**
   * Delete a video from Playmate.
   */
  async deleteFile(fileCode: string): Promise<boolean> {
    const clean = PlaymateClient.cleanFileCode(fileCode);
    const res = await fetch(
      `${this.baseUrl}/file/delete?key=${encodeURIComponent(this.apiKey)}&file_code=${clean}`,
      { method: 'POST' }
    );
    if (!res.ok) return false;
    const data = await res.json();
    return data?.status === 200;
  }

  /**
   * List files in a folder.
   */
  async listFiles(folderId?: number, page = 1, perPage = 50): Promise<any[]> {
    const fldId = folderId ?? this.folderId;
    const res = await fetch(
      `${this.baseUrl}/file/list?key=${encodeURIComponent(this.apiKey)}&fld_id=${fldId}&page=${page}&per_page=${perPage}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data?.result || [];
  }

  /**
   * Get account stats and info.
   */
  async getAccountInfo(): Promise<PlaymateAccountInfo | null> {
    const res = await fetch(`${this.baseUrl}/account/info?key=${encodeURIComponent(this.apiKey)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.result || null;
  }
}
