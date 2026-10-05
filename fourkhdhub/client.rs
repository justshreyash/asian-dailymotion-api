//! HTTP client for 4KHDHub.

use reqwest::Url;

use super::{hubcloud, parser};
use crate::error::{Result, WavoError};
use crate::providers::{SearchResult, StreamInfo, StreamRelease};

const DEFAULT_BASE_URL: &str = "https://4khdhub.one/";
const BROWSER_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

#[derive(Clone)]
pub struct FourKHdHubClient {
    client: reqwest::Client,
    base_url: Url,
}

impl FourKHdHubClient {
    pub fn new() -> Result<Self> {
        let base_url = Url::parse(DEFAULT_BASE_URL)
            .map_err(|e| WavoError::Provider(format!("Invalid 4KHDHub base URL: {}", e)))?;

        let client = reqwest::Client::builder()
            .user_agent(BROWSER_UA)
            .build()
            .map_err(|e| WavoError::Provider(format!("Failed to build HTTP client: {}", e)))?;

        Ok(Self { client, base_url })
    }

    pub async fn search(&self, query: &str) -> Result<Vec<SearchResult>> {
        let mut url = self.base_url.clone();
        url.query_pairs_mut().append_pair("s", query);

        let html = self.fetch_text(url).await?;
        parser::parse_search(&self.base_url, &html)
    }

    pub async fn details(&self, id: &str) -> Result<SearchResult> {
        let url = self.provider_url(id)?;
        let html = self.fetch_text(url).await?;
        parser::parse_details(id, &html)
    }

    pub async fn episode_releases(
        &self,
        id: &str,
        season: u32,
        episode: u32,
    ) -> Result<Vec<StreamRelease>> {
        let url = self.provider_url(id)?;
        let html = self.fetch_text(url).await?;
        parser::parse_releases(&html, season, episode)
    }

    pub async fn resolve_release(&self, release: &StreamRelease) -> Result<StreamInfo> {
        if release.mirrors.is_empty() {
            return Err(WavoError::Provider(
                "No mirror links found in release".into(),
            ));
        }

        let mut last_err = None;
        for mirror in &release.mirrors {
            match hubcloud::resolve_mirror_url(&self.client, mirror).await {
                Ok(stream_url) => {
                    return Ok(StreamInfo {
                        url: stream_url,
                        quality: release.resolution.clone(),
                        headers: None,
                        subtitles: Vec::new(),
                        audio_language: None,
                    });
                }
                Err(e) => {
                    last_err = Some(e);
                }
            }
        }

        Err(last_err
            .unwrap_or_else(|| WavoError::Provider("Failed to resolve any stream mirror".into())))
    }

    fn provider_url(&self, id: &str) -> Result<Url> {
        let path = if id.starts_with('/') {
            id
        } else {
            &format!("/{}", id)
        };
        self.base_url
            .join(path)
            .map_err(|e| WavoError::Provider(format!("Invalid item path: {}", e)))
    }

    async fn fetch_text(&self, url: Url) -> Result<String> {
        let resp = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|e| WavoError::Provider(format!("4KHDHub HTTP request error: {}", e)))?;

        resp.text()
            .await
            .map_err(|e| WavoError::Provider(format!("4KHDHub response read error: {}", e)))
    }
}
