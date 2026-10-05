//! HTML parsing for 4KHDHub search, details, and episode releases.

use std::collections::{BTreeMap, HashMap};
use std::sync::LazyLock;

use reqwest::Url;
use scraper::{ElementRef, Html, Selector};

use crate::error::{Result, WavoError};
use crate::providers::{Episode, MediaKind, SearchResult, Season, StreamRelease};

static SEL_CARD: LazyLock<Selector> = LazyLock::new(|| Selector::parse("a.movie-card").unwrap());
static SEL_TITLE: LazyLock<Selector> =
    LazyLock::new(|| Selector::parse(".movie-card-title").unwrap());
static SEL_META: LazyLock<Selector> =
    LazyLock::new(|| Selector::parse(".movie-card-meta").unwrap());
static SEL_IMG: LazyLock<Selector> = LazyLock::new(|| Selector::parse("img").unwrap());
static SEL_H1: LazyLock<Selector> = LazyLock::new(|| Selector::parse("h1").unwrap());
static SEL_CONTENT_DESC: LazyLock<Selector> =
    LazyLock::new(|| Selector::parse(".content-section p.mt-4").unwrap());
static SEL_EPISODE_ITEM: LazyLock<Selector> =
    LazyLock::new(|| Selector::parse("#episodes .episode-download-item").unwrap());
static SEL_DOWNLOAD_ITEM: LazyLock<Selector> =
    LazyLock::new(|| Selector::parse(".download-item").unwrap());
static SEL_EPISODE_FILE_TITLE: LazyLock<Selector> =
    LazyLock::new(|| Selector::parse(".episode-file-title").unwrap());
static SEL_FILE_TITLE: LazyLock<Selector> =
    LazyLock::new(|| Selector::parse(".file-title").unwrap());
static SEL_LINK_HREF: LazyLock<Selector> = LazyLock::new(|| Selector::parse("a[href]").unwrap());
static SEL_BADGE_SIZE: LazyLock<Selector> =
    LazyLock::new(|| Selector::parse(".badge-size, .badge").unwrap());

pub fn parse_search(base: &Url, html: &str) -> Result<Vec<SearchResult>> {
    let document = Html::parse_document(html);
    let mut items = Vec::new();

    for node in document.select(&SEL_CARD) {
        let Some(href) = node.value().attr("href") else {
            continue;
        };
        let Ok(url) = base.join(href) else { continue };
        if url.host_str() != base.host_str() {
            continue;
        }
        let item_title = text_of(node.select(&SEL_TITLE).next()).unwrap_or_default();
        if item_title.is_empty() {
            continue;
        }
        let meta_text = text_of(node.select(&SEL_META).next()).unwrap_or_default();
        let year = first_four_digit_year(&meta_text);
        let kind = if href.contains("-series-") {
            MediaKind::TvSeries
        } else {
            MediaKind::Movie
        };
        let poster_url = node
            .select(&SEL_IMG)
            .next()
            .and_then(|img| img.value().attr("src"))
            .map(str::to_string);

        items.push(SearchResult {
            id: url.path().trim_start_matches('/').to_string(),
            title: item_title,
            year,
            kind,
            provider_id: "fourkhdhub".to_string(),
            overview: None,
            poster_url,
            seasons: None,
        });
    }

    Ok(items)
}

pub fn parse_details(id: &str, html: &str) -> Result<SearchResult> {
    let document = Html::parse_document(html);
    let raw_title = document
        .select(&SEL_H1)
        .find_map(|node| text_of(Some(node)))
        .filter(|text| !text.is_empty())
        .or_else(|| meta_content(&document, "meta[property=\"og:title\"]"))
        .ok_or_else(|| WavoError::Provider("Title missing in 4KHDHub details".into()))?;

    let title = strip_trailing_year(&raw_title);
    let kind = if id.contains("-series-") {
        MediaKind::TvSeries
    } else {
        MediaKind::Movie
    };
    let overview = document
        .select(&SEL_CONTENT_DESC)
        .find_map(|node| text_of(Some(node)))
        .or_else(|| meta_content(&document, "meta[name=\"description\"]"));

    let poster_url = meta_content(&document, "meta[property=\"og:image\"]");
    let year = first_four_digit_year(&raw_title);

    let seasons = parse_seasons(&document)?;

    Ok(SearchResult {
        id: id.to_string(),
        title,
        year,
        kind,
        provider_id: "fourkhdhub".to_string(),
        overview,
        poster_url,
        seasons: if seasons.is_empty() {
            None
        } else {
            Some(seasons)
        },
    })
}

pub fn parse_releases(html: &str, season: u32, episode: u32) -> Result<Vec<StreamRelease>> {
    let document = Html::parse_document(html);
    let has_episode_items = document.select(&SEL_EPISODE_ITEM).next().is_some();
    let is_episode_query = season > 0 && has_episode_items;

    let item_selector = if is_episode_query {
        &*SEL_EPISODE_ITEM
    } else {
        &*SEL_DOWNLOAD_ITEM
    };
    let filename_selector = if is_episode_query {
        &*SEL_EPISODE_FILE_TITLE
    } else {
        &*SEL_FILE_TITLE
    };
    let link_selector = &*SEL_LINK_HREF;
    let size_selector = &*SEL_BADGE_SIZE;

    let mut grouped: HashMap<String, StreamRelease> = HashMap::new();

    for item in document.select(item_selector) {
        let filename = text_of(item.select(filename_selector).next()).unwrap_or_default();
        if filename.is_empty() || is_archive(&filename) {
            continue;
        }

        if is_episode_query {
            let parsed_ep = parse_season_episode(&filename);
            if parsed_ep != Some((season, episode)) {
                continue;
            }
        }

        let mut mirrors = Vec::new();
        let mut source_label = "Download HubCloud".to_string();

        for link in item.select(link_selector) {
            let Some(href) = link.value().attr("href") else {
                continue;
            };
            if !href.starts_with("https://") || href.contains("logout") {
                continue;
            }
            let label = text_of(Some(link)).unwrap_or_else(|| "Download HubCloud".into());
            if !label.is_empty() && label != "Direct" {
                source_label = label;
            }
            mirrors.push(href.to_string());
        }

        if mirrors.is_empty() {
            continue;
        }

        let size_text = item
            .select(size_selector)
            .find_map(|node| text_of(Some(node)))
            .filter(|t| {
                t.contains("MB") || t.contains("GB") || t.contains("mb") || t.contains("gb")
            });

        let resolution = detect_resolution(&filename);
        let media_tags = detect_media_tags(&filename);

        let key = filename.clone();
        let release = grouped.entry(key).or_insert_with(|| StreamRelease {
            id: filename.clone(),
            resolution,
            size: size_text,
            media_tags,
            source: source_label,
            release_title: filename.clone(),
            mirrors: Vec::new(),
            latency_ms: None,
            audio_languages: Vec::new(),
        });

        for mirror in mirrors {
            if !release.mirrors.contains(&mirror) {
                release.mirrors.push(mirror);
            }
        }
    }

    let mut releases: Vec<StreamRelease> = grouped.into_values().collect();
    // Sort by resolution descending (2160p > 1080p > 720p > 480p)
    releases.sort_by(|a, b| {
        let res_order = |r: &str| -> u32 {
            if r.contains("2160") || r.contains("4K") {
                4
            } else if r.contains("1080") {
                3
            } else if r.contains("720") {
                2
            } else {
                1
            }
        };
        res_order(&b.resolution).cmp(&res_order(&a.resolution))
    });

    Ok(releases)
}

fn parse_seasons(document: &Html) -> Result<Vec<Season>> {
    let mut seasons_map: BTreeMap<u32, BTreeMap<u32, Episode>> = BTreeMap::new();

    for item in document.select(&SEL_EPISODE_ITEM) {
        let filename = text_of(item.select(&SEL_EPISODE_FILE_TITLE).next()).unwrap_or_default();
        if let Some((s, e)) = parse_season_episode(&filename) {
            let ep_title = format!("Episode {:02}", e);
            let ep = Episode {
                episode_number: e,
                title: Some(ep_title),
                id: format!("S{:02}E{:02}", s, e),
            };
            seasons_map.entry(s).or_default().insert(e, ep);
        }
    }

    let seasons = seasons_map
        .into_iter()
        .map(|(season_num, eps)| Season {
            season_number: season_num,
            episodes: eps.into_values().collect(),
        })
        .collect();

    Ok(seasons)
}

fn parse_season_episode(text: &str) -> Option<(u32, u32)> {
    let upper = text.to_ascii_uppercase();
    // Look for S01E03 or S1E3 or Season 1 Episode 3
    let mut idx = 0;
    while let Some(s_pos) = upper[idx..].find('S') {
        let abs_s = idx + s_pos;
        let rest = &upper[abs_s + 1..];
        let s_digits_end = rest
            .find(|c: char| !c.is_ascii_digit())
            .unwrap_or(rest.len());
        if s_digits_end > 0 && s_digits_end <= 3 {
            if let Ok(s_val) = rest[..s_digits_end].parse::<u32>() {
                let after_s = &rest[s_digits_end..];
                if after_s.starts_with('E') || after_s.starts_with("EP") {
                    let e_start = if after_s.starts_with("EP") { 2 } else { 1 };
                    let e_rest = &after_s[e_start..];
                    let e_digits_end = e_rest
                        .find(|c: char| !c.is_ascii_digit())
                        .unwrap_or(e_rest.len());
                    if e_digits_end > 0 && e_digits_end <= 3 {
                        if let Ok(e_val) = e_rest[..e_digits_end].parse::<u32>() {
                            return Some((s_val, e_val));
                        }
                    }
                }
            }
        }
        idx = abs_s + 1;
    }
    None
}

fn detect_resolution(filename: &str) -> String {
    let upper = filename.to_ascii_uppercase();
    if upper.contains("2160P")
        || upper.contains(".4K.")
        || upper.contains(" 4K ")
        || upper.contains("[4K]")
        || upper.contains("-4K-")
        || upper.contains("_4K_")
    {
        "2160p".to_string()
    } else if upper.contains("1080P") || upper.contains(".1080.") || upper.contains("FHD") {
        "1080p".to_string()
    } else if upper.contains("720P") || upper.contains(".720.") {
        "720p".to_string()
    } else if upper.contains("480P") || upper.contains(".480.") {
        "480p".to_string()
    } else {
        "1080p".to_string()
    }
}

fn detect_media_tags(filename: &str) -> Vec<String> {
    let upper = filename.to_ascii_uppercase();
    let mut tags = Vec::new();

    if upper.contains("AV1") {
        tags.push("AV1".to_string());
    } else if upper.contains("H.265") || upper.contains("HEVC") || upper.contains("X265") {
        tags.push("HEVC".to_string());
    } else if upper.contains("H.264") || upper.contains("AVC") || upper.contains("X264") {
        tags.push("H.264".to_string());
    }

    if upper.contains("WEB-DL") || upper.contains("WEBDL") {
        tags.push("WEB-DL".to_string());
    } else if upper.contains("WEBRIP") {
        tags.push("WEBRip".to_string());
    } else if upper.contains("BLURAY") {
        tags.push("BluRay".to_string());
    }

    if upper.contains("DDP") || upper.contains("EAC3") {
        tags.push("DDP".to_string());
    }

    if tags.is_empty() {
        tags.push("WEB-DL".to_string());
    }

    tags
}

fn is_archive(filename: &str) -> bool {
    let lower = filename.to_ascii_lowercase();
    lower.ends_with(".zip") || lower.ends_with(".rar") || lower.ends_with(".7z")
}

fn text_of(node: Option<ElementRef>) -> Option<String> {
    node.map(|n| n.text().collect::<Vec<_>>().join(" ").trim().to_string())
}

fn meta_content(doc: &Html, selector_str: &str) -> Option<String> {
    let sel = Selector::parse(selector_str).ok()?;
    doc.select(&sel)
        .next()?
        .value()
        .attr("content")
        .map(str::to_string)
}

fn first_four_digit_year(text: &str) -> Option<u32> {
    let chars: Vec<char> = text.chars().collect();
    for i in 0..chars.len().saturating_sub(3) {
        if chars[i..i + 4].iter().all(|c| c.is_ascii_digit()) {
            let s: String = chars[i..i + 4].iter().collect();
            if let Ok(year) = s.parse::<u32>() {
                if (1900..=2099).contains(&year) {
                    return Some(year);
                }
            }
        }
    }
    None
}

fn strip_trailing_year(title: &str) -> String {
    let trimmed = title.trim();
    if trimmed.len() > 6 && trimmed.ends_with(')') {
        if let Some(open_paren) = trimmed.rfind('(') {
            let inside = &trimmed[open_paren + 1..trimmed.len() - 1];
            if inside.len() == 4 && inside.chars().all(|c| c.is_ascii_digit()) {
                return trimmed[..open_paren].trim().to_string();
            }
        }
    }
    trimmed.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_trailing_year() {
        assert_eq!(
            strip_trailing_year("A Love Other Than Yours (2026)"),
            "A Love Other Than Yours"
        );
        assert_eq!(strip_trailing_year("Movie (2024)"), "Movie");
        assert_eq!(strip_trailing_year("Show"), "Show");
    }

    #[test]
    fn test_parse_season_episode() {
        assert_eq!(
            parse_season_episode(
                "A.Love.Other.Than.Yours.S01E03.Can.We.Feel.That.Spark.Again.1080p.mkv"
            ),
            Some((1, 3))
        );
        assert_eq!(parse_season_episode("Title.S02E12.720p.mkv"), Some((2, 12)));
    }

    #[test]
    fn test_detect_resolution_and_tags() {
        let fn1 =
            "A.Love.Other.Than.Yours.S01E03.1080p.AMZN.WEB-DL.Multi.DDP2.0.AV1-4KhDHub.Com.mkv";
        assert_eq!(detect_resolution(fn1), "1080p");
        let tags1 = detect_media_tags(fn1);
        assert!(tags1.contains(&"AV1".to_string()));
        assert!(tags1.contains(&"WEB-DL".to_string()));

        let fn2 = "Movie.2160p.4K.WEB-DL.H.265.mkv";
        assert_eq!(detect_resolution(fn2), "2160p");
        let tags2 = detect_media_tags(fn2);
        assert!(tags2.contains(&"HEVC".to_string()));
    }
}
