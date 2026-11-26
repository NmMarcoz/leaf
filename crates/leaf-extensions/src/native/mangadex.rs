//! MangaDex as a catalogue and an enricher, delegating to the existing
//! `leaf-meta` client.
//!
//! Metadata only, on purpose: the catalogue, the volume map and the covers
//! are what it is for, and the enrich role is the title search (with Kitsu
//! as its fallback) that fills gaps for any other source, kept first in the
//! chain as it always was. It is **not** a reader. The binary fetches no
//! MangaDex pages — a MangaDex chapter id becomes pages only through a
//! user-installed reader script declaring `mangadex.org`, found by
//! `Registry::reader_for`.

use anyhow::Result;
use leaf_meta::{BrowseQuery, SeriesMatch, Sort};

use crate::types::{
    EnrichSource, Kind, MangaDetails, MangaSummary, MangasPage, MetadataSource, SourceInfo,
    API_LEVEL,
};

/// The id `series.source` stores for a MangaDex-backed library entry.
pub const ID: &str = "leaf.mangadex";

pub struct MangaDexSource {
    info: SourceInfo,
}

impl Default for MangaDexSource {
    fn default() -> Self {
        Self {
            info: SourceInfo {
                id: ID.to_string(),
                name: "MangaDex".to_string(),
                kind: Kind::Metadata,
                // Crowd-translated rather than one fixed language; `volumes`
                // takes its own `language` argument per call instead.
                lang: "multi".to_string(),
                base_url: "https://mangadex.org".to_string(),
                mirrors: Vec::new(),
                description: None,
                api: API_LEVEL,
                nsfw: false,
                capabilities: [
                    "popular", "latest", "search", "details", "volumes", "covers",
                ]
                .map(String::from)
                .to_vec(),
            },
        }
    }
}

impl MetadataSource for MangaDexSource {
    fn info(&self) -> &SourceInfo {
        &self.info
    }

    fn popular(&self, page: u32) -> Result<MangasPage> {
        browse(BrowseQuery {
            sort: Sort::Follows,
            ..paged(page)
        })
    }

    fn latest(&self, page: u32) -> Result<MangasPage> {
        browse(BrowseQuery {
            sort: Sort::LatestUpload,
            ..paged(page)
        })
    }

    fn search(&self, query: &str, page: u32) -> Result<MangasPage> {
        browse(BrowseQuery {
            title: Some(query.to_string()),
            sort: Sort::Relevance,
            ..paged(page)
        })
    }

    fn manga_details(&self, id: &str) -> Result<MangaDetails> {
        Ok(into_details(leaf_meta::mangadex::manga(id)?))
    }

    fn volumes(&self, id: &str, language: Option<&str>) -> Result<Vec<leaf_meta::VolumeChapters>> {
        leaf_meta::volume_chapters_in(leaf_meta::Source::MangaDex, id, language)
    }

    fn covers(&self, id: &str) -> Result<Vec<leaf_meta::VolumeCover>> {
        leaf_meta::volume_covers(leaf_meta::Source::MangaDex, id)
    }
}

impl EnrichSource for MangaDexSource {
    fn info(&self) -> &SourceInfo {
        &self.info
    }

    /// `leaf_meta::search`, not this source's own `search`: the former falls
    /// back to Kitsu when MangaDex has nothing, which is the behaviour the
    /// chain has always had. A separate Kitsu entry would run it on every
    /// lookup instead of only on a miss.
    fn lookup(&self, title: &str) -> Result<Option<MangaDetails>> {
        Ok(leaf_meta::search(title, 1)?
            .into_iter()
            .next()
            .map(|hit| MangaDetails::from(leaf_meta::MetadataHint::from(hit))))
    }
}

/// A default [`BrowseQuery`] for page `page`, using MangaDex's own default
/// page size (32) as the step.
fn paged(page: u32) -> BrowseQuery {
    const PAGE_SIZE: u32 = 32;
    BrowseQuery {
        offset: page * PAGE_SIZE,
        limit: PAGE_SIZE,
        ..BrowseQuery::default()
    }
}

fn browse(query: BrowseQuery) -> Result<MangasPage> {
    let page = leaf_meta::browse(&query)?;
    Ok(MangasPage {
        has_next_page: page.offset + (page.series.len() as u32) < page.total,
        manga: page.series.into_iter().map(into_summary).collect(),
    })
}

fn into_summary(m: SeriesMatch) -> MangaSummary {
    MangaSummary {
        title: m.display_title().to_string(),
        cover_url: m.thumbnail_url.clone(),
        id: m.id,
    }
}

fn into_details(m: SeriesMatch) -> MangaDetails {
    MangaDetails {
        title: m.display_title().to_string(),
        title_romaji: m.title_romaji,
        title_native: m.title_native,
        author: m.author,
        artist: m.artist,
        description: m.description,
        tags: m.tags.into_iter().map(|t| t.name).collect(),
        content_rating: m.content_rating,
        available_languages: m.available_languages,
        cover_url: m.thumbnail_url,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn info_id_matches_the_public_constant() {
        assert_eq!(MetadataSource::info(&MangaDexSource::default()).id, ID);
    }

    #[test]
    fn paged_steps_by_the_default_page_size() {
        assert_eq!(paged(0).offset, 0);
        assert_eq!(paged(2).offset, 64);
    }
}
