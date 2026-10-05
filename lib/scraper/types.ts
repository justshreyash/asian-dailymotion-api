// Shared types for the scraper module (TS port of Rust structs)

export type MediaKind = 'series' | 'movie';

export interface SearchResult {
  /** URL slug on 4KHDHub, e.g. "celebrity-series-3771" */
  id: string;
  title: string;
  year?: number;
  kind: MediaKind;
  providerId: string;
  overview?: string;
  posterUrl?: string;
  seasons?: Season[];
}

export interface Season {
  seasonNumber: number;
  episodes: Episode[];
}

export interface Episode {
  episodeNumber: number;
  title?: string;
  id: string;
}

export interface StreamRelease {
  id: string;
  resolution: string;
  /** File size string like "2.92 GB" */
  size?: string;
  /** File size in MB (parsed) */
  sizeMb?: number;
  mediaTags: string[];
  source: string;
  releaseTitle: string;
  mirrors: string[];
  audioLanguages: string[];
}

export interface StreamInfo {
  url: string;
  quality: string;
  headers?: Record<string, string>;
  subtitles: Subtitle[];
  audioLanguage?: string;
}

export interface Subtitle {
  url: string;
  language: string;
  label: string;
}
