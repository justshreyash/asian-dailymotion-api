//! 4KHDHub content provider.

pub mod client;
pub mod hubcloud;
pub mod parser;

use async_trait::async_trait;
use tracing::info;

use crate::error::{Result, WavoError};
use crate::providers::{HealthStatus, Provider, SearchResult, StreamInfo, StreamRelease, Subtitle};
use client::FourKHdHubClient;

pub struct FourKHdHubProvider {
    client: FourKHdHubClient,
}

impl FourKHdHubProvider {
    pub fn new() -> Result<Self> {
        Ok(Self {
            client: FourKHdHubClient::new()?,
        })
    }
}

#[async_trait]
impl Provider for FourKHdHubProvider {
    fn id(&self) -> &'static str {
        "fourkhdhub"
    }

    fn display_name(&self) -> &'static str {
        "4KHDHub"
    }

    async fn search(&self, query: &str) -> Result<Vec<SearchResult>> {
        info!("Searching 4KHDHub for '{}'", query);
        self.client.search(query).await
    }

    async fn details(&self, item: &SearchResult) -> Result<SearchResult> {
        info!(
            "Fetching 4KHDHub details for '{}' ({})",
            item.title, item.id
        );
        self.client.details(&item.id).await
    }

    async fn resolve_stream(&self, item: &SearchResult) -> Result<StreamInfo> {
        self.resolve_episode_stream(item, 1, 1).await
    }

    async fn resolve_episode_stream(
        &self,
        item: &SearchResult,
        season: u32,
        episode: u32,
    ) -> Result<StreamInfo> {
        info!(
            "Resolving 4KHDHub stream for '{}' (S{:02}E{:02})",
            item.title, season, episode
        );
        let releases = self
            .client
            .episode_releases(&item.id, season, episode)
            .await?;
        if releases.is_empty() {
            return Err(WavoError::Provider(format!(
                "No stream releases found on 4KHDHub for S{:02}E{:02}",
                season, episode
            )));
        }

        self.client.resolve_release(&releases[0]).await
    }

    async fn get_episode_releases(
        &self,
        item: &SearchResult,
        season: u32,
        episode: u32,
    ) -> Result<Vec<StreamRelease>> {
        let is_series =
            item.kind == crate::providers::MediaKind::TvSeries || item.seasons.is_some();
        let (se_query, ep_query) = if is_series { (season, episode) } else { (0, 0) };

        info!(
            "Fetching 4KHDHub releases for '{}' (S{:02}E{:02})",
            item.title, se_query, ep_query
        );
        self.client
            .episode_releases(&item.id, se_query, ep_query)
            .await
    }

    async fn resolve_release_stream(
        &self,
        _item: &SearchResult,
        release: &StreamRelease,
    ) -> Result<StreamInfo> {
        info!(
            "Resolving selected 4KHDHub release: {}",
            release.release_title
        );
        self.client.resolve_release(release).await
    }

    async fn fetch_subtitles(&self, _item: &SearchResult, _lang: &str) -> Result<Vec<Subtitle>> {
        Ok(Vec::new())
    }

    fn health_check(&self) -> HealthStatus {
        HealthStatus::Healthy
    }
}
