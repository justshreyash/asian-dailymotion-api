//! HubCloud and mirror link resolution for 4KHDHub.

use std::net::IpAddr;
use std::sync::LazyLock;

use base64::Engine;
use reqwest::Url;
use scraper::{Html, Selector};

use crate::error::{Result, WavoError};

static SEL_DOWNLOAD: LazyLock<Selector> = LazyLock::new(|| {
    Selector::parse("a#download, a.btn-primary, a.btn-success, a.btn[href*='/download/'], a[href*='/download/'], a[href*='gamerxyt.com'], a[href*='hubcloud.php']").unwrap()
});
static SEL_LINKS: LazyLock<Selector> = LazyLock::new(|| Selector::parse("a[href]").unwrap());

/// Resolves a mirror link (which may be a GreenMotors redirect, HubDrive link,
/// or direct HubCloud link) into direct playable video URLs.
pub async fn resolve_mirror_url(client: &reqwest::Client, mirror_url: &str) -> Result<String> {
    if mirror_url.contains("greenmotors.") || mirror_url.contains("greenmountmotors.") {
        resolve_greenmotors(client, mirror_url).await
    } else if mirror_url.contains("hubdrive.") {
        resolve_hubdrive(client, mirror_url).await
    } else if mirror_url.contains("hubcloud.") {
        resolve_hubcloud(client, mirror_url).await
    } else {
        validate_playback_url(mirror_url)
    }
}

pub async fn resolve_greenmotors(client: &reqwest::Client, drive_url: &str) -> Result<String> {
    let html = client
        .get(drive_url)
        .send()
        .await
        .map_err(|e| WavoError::Provider(format!("GreenMotors network error: {}", e)))?
        .text()
        .await
        .map_err(|e| WavoError::Provider(format!("Failed to read GreenMotors body: {}", e)))?;

    let target_url = unpack_greenmotors_url(&html)
        .ok_or_else(|| WavoError::Provider("Failed to unpack GreenMotors payload".into()))?;

    if target_url.contains("hubcloud.") {
        resolve_hubcloud(client, &target_url).await
    } else if target_url.contains("hubdrive.") {
        resolve_hubdrive(client, &target_url).await
    } else {
        validate_playback_url(&target_url)
    }
}

pub async fn resolve_hubdrive(client: &reqwest::Client, drive_url: &str) -> Result<String> {
    let html = client
        .get(drive_url)
        .send()
        .await
        .map_err(|e| WavoError::Provider(format!("HubDrive network error: {}", e)))?
        .text()
        .await
        .map_err(|e| WavoError::Provider(format!("Failed to read HubDrive body: {}", e)))?;

    let hubcloud_url = extract_hubcloud_drive_url(&html)
        .ok_or_else(|| WavoError::Provider("HubDrive HubCloud mirror missing".into()))?;

    resolve_hubcloud(client, &hubcloud_url).await
}

pub async fn resolve_hubcloud(client: &reqwest::Client, drive_url: &str) -> Result<String> {
    let drive_html = client
        .get(drive_url)
        .send()
        .await
        .map_err(|e| WavoError::Provider(format!("HubCloud drive error: {}", e)))?
        .text()
        .await
        .map_err(|e| WavoError::Provider(format!("Failed to read HubCloud drive: {}", e)))?;

    let resolver_url = {
        let document = Html::parse_document(&drive_html);
        document
            .select(&SEL_DOWNLOAD)
            .filter_map(|node| node.value().attr("href"))
            .find(|href| href.starts_with("https://"))
            .map(str::to_string)
            .ok_or_else(|| WavoError::Provider("HubCloud resolver link missing".into()))?
    };

    let resolver_html = client
        .get(&resolver_url)
        .send()
        .await
        .map_err(|e| WavoError::Provider(format!("HubCloud resolver error: {}", e)))?
        .text()
        .await
        .map_err(|e| {
            WavoError::Provider(format!("Failed to read HubCloud resolver page: {}", e))
        })?;

    let mut candidates: Vec<(u8, String)> = {
        let resolver = Html::parse_document(&resolver_html);
        let mut list = Vec::new();

        // 1. Script pixeldrain URLs
        for url in extract_script_pixeldrain_urls(&resolver_html) {
            list.push((score(&url, "PixelDrain"), url));
        }

        // 2. Links in resolver page
        for node in resolver.select(&SEL_LINKS) {
            let Some(href) = node.value().attr("href") else {
                continue;
            };
            let label = node.text().collect::<String>();

            if let Some(unwrapped) = unwrap_watch_online_url(href) {
                if let Ok(valid) = validate_playback_url(&unwrapped) {
                    list.push((score(&valid, "Watch Online"), valid));
                    continue;
                }
            }

            if let Ok(url) = validate_playback_url(href) {
                let final_url = pixeldrain_api_url(&url).unwrap_or(url);
                list.push((score(&final_url, &label), final_url));
            }
        }
        list
    };

    candidates.sort_by_key(|c| c.0);

    // Try candidates in priority order
    for (_, candidate_url) in candidates {
        // If candidate is a pixel.hubcloud redirect or workers.dev redirect, resolve to final URL
        if candidate_url.contains("pixel.hubcloud.") || candidate_url.contains("workers.dev") {
            if let Ok(followed) = follow_redirect_to_final(client, &candidate_url).await {
                return Ok(followed);
            }
            continue;
        }
        return Ok(candidate_url);
    }

    Err(WavoError::Provider(
        "No playable stream mirrors found in HubCloud".into(),
    ))
}

async fn follow_redirect_to_final(client: &reqwest::Client, url: &str) -> Result<String> {
    // Make a HEAD request following up to 5 redirects to get the final media URL
    let mut current = url.to_string();
    for _ in 0..5 {
        let resp = client
            .get(&current)
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
            .send()
            .await
            .map_err(|e| WavoError::Provider(format!("Redirect follow error: {}", e)))?;

        let final_url = resp.url().to_string();
        if final_url.contains("googleusercontent.com")
            || final_url.ends_with(".mkv")
            || final_url.ends_with(".mp4")
        {
            return Ok(final_url);
        }

        if let Some(loc) = resp.headers().get("location").and_then(|h| h.to_str().ok()) {
            if loc.contains("link=") {
                if let Some(idx) = loc.find("link=") {
                    return Ok(loc[idx + 5..].to_string());
                }
            }
            current = loc.to_string();
        } else {
            return Ok(final_url);
        }
    }
    Ok(current)
}

fn unpack_greenmotors_url(html: &str) -> Option<String> {
    let payload = extract_greenmotors_payload(html)?;
    decode_greenmotors_payload(&payload)
}

fn extract_greenmotors_payload(html: &str) -> Option<String> {
    let needle = "s(";
    let mut search_idx = 0;
    while let Some(pos) = html[search_idx..].find(needle) {
        let abs_pos = search_idx + pos + needle.len();
        let rest = html[abs_pos..].trim_start();
        let after_key = if let Some(stripped) = rest.strip_prefix("'o'") {
            stripped
        } else if let Some(stripped) = rest.strip_prefix("\"o\"") {
            stripped
        } else {
            search_idx = abs_pos;
            continue;
        };
        let after_comma = if let Some(stripped) = after_key.trim_start().strip_prefix(',') {
            stripped
        } else {
            search_idx = abs_pos;
            continue;
        };
        let trimmed = after_comma.trim_start();
        let quote = match trimmed.chars().next() {
            Some(c @ ('\'' | '"')) => c,
            _ => {
                search_idx = abs_pos;
                continue;
            }
        };
        let payload_slice = &trimmed[1..];
        if let Some(end) = payload_slice.find(quote) {
            return Some(payload_slice[..end].to_string());
        }
        search_idx = abs_pos;
    }
    None
}

fn rot13(input: &str) -> String {
    input
        .chars()
        .map(|c| match c {
            'a'..='m' | 'A'..='M' => ((c as u8) + 13) as char,
            'n'..='z' | 'N'..='Z' => ((c as u8) - 13) as char,
            _ => c,
        })
        .collect()
}

pub fn decode_greenmotors_payload(payload: &str) -> Option<String> {
    let b64 = &base64::engine::general_purpose::STANDARD;
    let step1_bytes = b64.decode(payload.as_bytes()).ok()?;
    let step1_str = String::from_utf8(step1_bytes).ok()?;
    let step2_bytes = b64.decode(step1_str.as_bytes()).ok()?;
    let step2_str = String::from_utf8(step2_bytes).ok()?;
    let step3_rot = rot13(&step2_str);
    let step4_bytes = b64.decode(step3_rot.as_bytes()).ok()?;
    let step4_str = String::from_utf8(step4_bytes).ok()?;
    let json_val: serde_json::Value = serde_json::from_str(&step4_str).ok()?;
    let target_b64 = json_val.get("o")?.as_str()?;
    let target_bytes = b64.decode(target_b64.as_bytes()).ok()?;
    String::from_utf8(target_bytes).ok()
}

fn extract_hubcloud_drive_url(html: &str) -> Option<String> {
    let document = Html::parse_document(html);
    let links = Selector::parse("a[href]").ok()?;
    document.select(&links).find_map(|node| {
        let raw = node.value().attr("href")?;
        let url = Url::parse(raw).ok()?;
        let host = url.host_str()?;
        (host.contains("hubcloud.") && url.path().starts_with("/drive/")).then(|| url.to_string())
    })
}

fn unwrap_watch_online_url(raw: &str) -> Option<String> {
    let url = Url::parse(raw).ok()?;
    if url.host_str().is_some_and(|h| h.contains("pages.dev")) {
        let b64 = url
            .query_pairs()
            .find(|(k, _)| k == "u")
            .map(|(_, v)| v.into_owned())?;
        let decoded_bytes = base64::engine::general_purpose::STANDARD
            .decode(b64.as_bytes())
            .ok()?;
        let decoded_str = String::from_utf8(decoded_bytes).ok()?;
        if decoded_str.starts_with("https://") {
            return Some(decoded_str);
        }
    }
    None
}

fn extract_script_pixeldrain_urls(html: &str) -> Vec<String> {
    let mut urls = Vec::new();
    let search_prefix = |prefix: &str, urls: &mut Vec<String>| {
        let mut remainder = html;
        while let Some(pos) = remainder.find(prefix) {
            let url_offset = pos;
            let candidate = &remainder[url_offset..];
            let end = candidate
                .find(|character: char| {
                    character == '"'
                        || character == '\''
                        || character.is_whitespace()
                        || character == '<'
                        || character == '\\'
                })
                .unwrap_or(candidate.len());
            if let Some(url) = pixeldrain_api_url(&candidate[..end]) {
                if !urls.contains(&url) {
                    urls.push(url);
                }
            }
            remainder = &candidate[end..];
        }
    };

    search_prefix("https://pixeldrain.dev/u/", &mut urls);
    search_prefix("https://pixeldrain.com/u/", &mut urls);
    search_prefix("https://pixeldrain.dev/api/file/", &mut urls);
    search_prefix("https://pixeldrain.com/api/file/", &mut urls);
    urls
}

fn pixeldrain_api_url(raw: &str) -> Option<String> {
    let url = Url::parse(raw).ok()?;
    let host = url.host_str()?;
    if !host.contains("pixeldrain.") {
        return None;
    }
    let id = if let Some(stripped) = url.path().strip_prefix("/u/") {
        stripped.trim_matches('/')
    } else {
        let stripped = url.path().strip_prefix("/api/file/")?;
        stripped.trim_matches('/')
    };
    if id.is_empty()
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return None;
    }
    Some(format!("https://{}/api/file/{}?download", host, id))
}

pub fn validate_playback_url(raw: &str) -> Result<String> {
    let url = normalize_playback_url_str(raw)
        .ok_or_else(|| WavoError::Provider(format!("Invalid URL: {}", raw)))?;
    if url.scheme() != "https" || url.host_str().is_none() {
        return Err(WavoError::Provider("Non-https playback URL".into()));
    }
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    let path = url.path().to_ascii_lowercase();
    if host == "localhost"
        || host.ends_with(".local")
        || host
            .parse::<IpAddr>()
            .is_ok_and(|address| !is_public_ip(address))
        || path.ends_with(".zip")
        || path.contains("login.php")
        || path.contains("logout")
        || host.contains("greenmotors.")
        || host.contains("greenmountmotors.")
    {
        return Err(WavoError::Provider(format!(
            "Forbidden playback host/path: {}",
            raw
        )));
    }
    Ok(url.to_string())
}

fn normalize_playback_url_str(raw: &str) -> Option<Url> {
    if let Ok(url) = Url::parse(raw) {
        return Some(url);
    }
    let (scheme_host, rest) = {
        let idx = raw.find("://")?;
        let after_scheme = &raw[idx + 3..];
        let host_end = after_scheme
            .find(['/', '?', '#'])
            .unwrap_or(after_scheme.len());
        let host = &after_scheme[..host_end];
        if host.is_empty() || host.contains(' ') {
            return None;
        }
        (&raw[..idx + 3 + host_end], &after_scheme[host_end..])
    };

    let (path_part, query_fragment) = if let Some(pos) = rest.find(['?', '#']) {
        (&rest[..pos], &rest[pos..])
    } else {
        (rest, "")
    };

    let encoded_path = path_part
        .split('/')
        .map(|segment| {
            segment
                .split(':')
                .map(|sub| {
                    percent_encoding::utf8_percent_encode(sub, percent_encoding::NON_ALPHANUMERIC)
                        .to_string()
                })
                .collect::<Vec<_>>()
                .join(":")
        })
        .collect::<Vec<_>>()
        .join("/");

    let full = format!("{}{}{}", scheme_host, encoded_path, query_fragment);
    Url::parse(&full).ok()
}

fn is_public_ip(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => {
            !(address.is_private()
                || address.is_loopback()
                || address.is_link_local()
                || address.is_broadcast()
                || address.is_documentation()
                || address.is_unspecified())
        }
        IpAddr::V6(address) => {
            !(address.is_loopback()
                || address.is_unspecified()
                || address.is_unique_local()
                || address.is_unicast_link_local())
        }
    }
}

pub fn score(url: &str, label: &str) -> u8 {
    let value = format!("{} {}", url, label).to_ascii_lowercase();
    if value.contains("pixel.hubcloud.")
        || value.contains("googleusercontent.com")
        || value.contains("googlevideo.com")
        || value.contains("cloudflarestorage.com")
        || value.contains("r2.cloudflarestorage.com")
        || value.contains("fsl server")
        || value.contains("r2.dev")
        || value.contains("watch online")
    {
        0
    } else if value.contains("storage.googleapis.com")
        || value.contains("hubcloud.cx/re/")
        || value.contains("hubcloud.fans/re/")
    {
        1
    } else if value.contains("pixeldrain.com")
        || value.contains("pixeldrain.dev")
        || value.contains("pixeldrain")
    {
        2
    } else if value.contains("testzip.php")
        || value.contains("vcloud.php")
        || value.contains("drive.php")
        || value.contains("gpdl.")
    {
        3
    } else {
        4
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_greenmotors_payload_pipeline() {
        let payload = "Y214WE0xWjNZbXRhVUdwMmIxQldObFo2ZFRCeFZVOXRRbmxxYVV0UU9XRndla2w1YjNveGFYRlVPV3h3YkRWM2IxVkpka3RRT1dKdk1qRjViMVJUYUUxVVNXeExVRGgyV1ZCWGFWWjNZblpNU0hWR1dsUkJWa2RIVFZweVIzbHBUVk54V0c1NlYxVkNSMU51UkcxSmFreHRRVVZ4ZVdOV1JtRlBlRzlKU1RKTWJVRkNjbnBCYUVwaGVYbHZlWGswU25vMWVISktXbTFIZDFaMmMwUTlQUT09";
        let target = decode_greenmotors_payload(payload);
        assert_eq!(
            target.as_deref(),
            Some("https://hubcloud.ist/drive/sssrvrzv1fwrssv")
        );
    }
}
