/**
 * Audio language filter — checks if a title meets the Korean + (Hindi or English) criteria.
 */

export function meetsAudioCriteria(audioLangs: string[]): boolean {
  const langs = audioLangs.map(l => l.toLowerCase());

  const hasKorean = langs.some(l =>
    l.includes('korean') || l.includes('original') || l.includes('multi')
  );
  const hasHindi = langs.some(l => l.includes('hindi'));
  const hasEnglish = langs.some(l => l.includes('english') || l.includes('eng'));

  // Korean/Original must be present, plus at least one of Hindi or English
  return hasKorean && (hasHindi || hasEnglish);
}

/**
 * Quick check if "multi" likely means Korean + dubbed.
 * "Multi" on 4KHDHub Korean content typically means Korean + Hindi + English.
 */
export function isMultiAudioKorean(audioLangs: string[], kind: 'series' | 'movie', slug: string): boolean {
  const langs = audioLangs.map(l => l.toLowerCase());
  const hasMulti = langs.includes('multi');
  const isKoreanCategory = slug.includes('korean') || slug.includes('-series-');

  // If it has "multi" and it's a Korean series, assume it meets criteria
  if (hasMulti && isKoreanCategory) return true;

  return meetsAudioCriteria(audioLangs);
}
