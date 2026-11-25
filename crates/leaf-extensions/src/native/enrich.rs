//! AniList and Jikan (an unofficial MyAnimeList API) as
//! [`EnrichSource`]s. Both answer a title in one request and track no
//! chapter or volume structure, so details are all they can offer.

use anyhow::Result;

use crate::types::{EnrichSource, Kind, MangaDetails, SourceInfo, API_LEVEL};

pub const ANILIST_ID: &str = "leaf.anilist";
pub const JIKAN_ID: &str = "leaf.jikan";

fn info(id: &str, name: &str, base_url: &str) -> SourceInfo {
    SourceInfo {
        id: id.to_string(),
        name: name.to_string(),
        kind: Kind::Enrich,
        lang: "multi".to_string(),
        base_url: base_url.to_string(),
        mirrors: Vec::new(),
        description: None,
        api: API_LEVEL,
        nsfw: false,
        capabilities: vec!["details".to_string()],
    }
}

pub struct AniList {
    info: SourceInfo,
}

impl Default for AniList {
    fn default() -> Self {
        Self {
            info: info(ANILIST_ID, "AniList", "https://anilist.co"),
        }
    }
}

impl EnrichSource for AniList {
    fn info(&self) -> &SourceInfo {
        &self.info
    }

    fn lookup(&self, title: &str) -> Result<Option<MangaDetails>> {
        Ok(leaf_meta::anilist::search(title)?.map(MangaDetails::from))
    }
}

pub struct Jikan {
    info: SourceInfo,
}

impl Default for Jikan {
    fn default() -> Self {
        Self {
            info: info(JIKAN_ID, "MyAnimeList (Jikan)", "https://myanimelist.net"),
        }
    }
}

impl EnrichSource for Jikan {
    fn info(&self) -> &SourceInfo {
        &self.info
    }

    fn lookup(&self, title: &str) -> Result<Option<MangaDetails>> {
        Ok(leaf_meta::jikan::search(title)?.map(MangaDetails::from))
    }
}
