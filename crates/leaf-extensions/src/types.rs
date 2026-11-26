//! The shapes every source speaks in, regardless of what backs it, and the
//! three role traits a source can be registered under.
//!
//! `VolumeChapters`/`ChapterRef`/`VolumeCover` are reused directly from
//! `leaf-meta` rather than redeclared here: none of the three carries a
//! `Source` enum field, so nothing about them is MangaDex-specific, and
//! `pull_layout` in the Tauri layer can keep consuming exactly what it does
//! today. `SeriesMatch` is not reused the same way — it carries
//! `leaf_meta::Source`, which a Lua-backed extension has no variant for —
//! so a source-agnostic `MangaSummary`/`MangaDetails` pair lives here instead.

pub use leaf_meta::{ChapterRef, VolumeChapters, VolumeCover};

use anyhow::Result;
use serde::{Deserialize, Serialize};

/// What a source *is*, which decides what it may do.
///
/// A closed set on purpose. The line that matters is that only a `Reader`
/// may hand out page URLs: a metadata or enrich script that defines
/// `page_list` is refused at load, not filtered at a call site, so "this
/// source cannot download pages" is something the loader guarantees rather
/// than something every caller has to remember.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Kind {
    /// Browse titles and the published volume → chapter map. Never pages.
    Metadata,
    /// Descriptions, alt titles, a series cover. No volume map, no pages.
    Enrich,
    /// Serves chapter pages.
    Reader,
}

impl Kind {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "metadata" => Some(Self::Metadata),
            "enrich" => Some(Self::Enrich),
            "reader" => Some(Self::Reader),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Metadata => "metadata",
            Self::Enrich => "enrich",
            Self::Reader => "reader",
        }
    }
}

impl std::fmt::Display for Kind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.pad(self.as_str())
    }
}

/// The level of the host API (`leaf.*` and the manifest/function contract)
/// this build offers. A script declaring a higher `SOURCE.api` is refused at
/// load with "needs a newer Leaf" instead of failing halfway through a call.
///
/// An integer rather than the app's version: the app version moves with
/// every UI release and the crate's own version does not track it at all,
/// while this only moves when a script could tell the difference. Bump it
/// whenever `leaf.*` gains something a script might depend on.
pub const API_LEVEL: u32 = 1;

/// What a source is, for listing in an Extensions screen and for namespacing
/// `leaf-library`'s `series.source` column.
///
/// `Serialize`/`Deserialize` (unlike the source traits, which cannot cross a
/// thread boundary let alone IPC): this crosses into the Tauri frontend for
/// an Add-from-source picker exactly like `leaf_meta::SeriesMatch` does.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceInfo {
    /// Stable and namespaced, e.g. `"leaf.mangadex"` or `"user.some-site"`.
    /// This is the exact string stored in `series.source` — that column is
    /// already free text, added for this reason. `user.` means "not built
    /// in", not "personal": scripts from a shared repository use it too.
    pub id: String,
    pub name: String,
    pub kind: Kind,
    /// ISO 639-1, or `"multi"` for a source that carries many languages itself
    /// (MangaDex, being crowd-translated, is the obvious example).
    pub lang: String,
    pub base_url: String,
    /// Further origins `leaf.http` may reach. Shown at the gate because they
    /// widen what the approval covers.
    #[serde(default)]
    pub mirrors: Vec<String>,
    /// One line on what the source is, written by its author.
    #[serde(default)]
    pub description: Option<String>,
    /// The host API level the script was written against.
    #[serde(default = "default_api")]
    pub api: u32,
    /// The source's catalogue is mostly adult content. Declared, not
    /// detected — it is what lets a picker label it before anyone browses.
    #[serde(default)]
    pub nsfw: bool,
    /// The functions the source actually answers, in its kind's terms — what
    /// the panel shows as "search · chapters · pages", and what tells a
    /// manual-link-only reader (no `search`) from one that can resolve.
    #[serde(default)]
    pub capabilities: Vec<String>,
}

fn default_api() -> u32 {
    API_LEVEL
}

/// One row in a popular/latest/search results page.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MangaSummary {
    pub id: String,
    pub title: String,
    pub cover_url: Option<String>,
}

/// A page of catalogue browsing.
///
/// `has_next_page` rather than a total count: Tachiyomi sources report exactly
/// this, because plenty of sites can say "there is another page" without ever
/// being able to say how many entries exist in total.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MangasPage {
    pub manga: Vec<MangaSummary>,
    pub has_next_page: bool,
}

/// Everything about one series a source can offer beyond its summary row.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MangaDetails {
    pub title: String,
    pub title_romaji: Option<String>,
    pub title_native: Option<String>,
    pub author: Option<String>,
    pub artist: Option<String>,
    pub description: Option<String>,
    /// Already named, not left as ids — a source knows its own tag names.
    pub tags: Vec<String>,
    pub content_rating: Option<String>,
    /// Languages this series has been translated into, when the source tracks
    /// per-series translations at all (most single-language sites won't).
    pub available_languages: Vec<String>,
    pub cover_url: Option<String>,
}

impl MangaDetails {
    /// Fill every field still blank from `other`, never overriding one that
    /// is already set: whichever provider answered first is the more
    /// specific answer, and the chain only exists to cover its gaps.
    pub fn fill_gaps(&mut self, other: MangaDetails) {
        if self.title.is_empty() {
            self.title = other.title;
        }
        fill(&mut self.title_romaji, other.title_romaji);
        fill(&mut self.title_native, other.title_native);
        fill(&mut self.author, other.author);
        fill(&mut self.artist, other.artist);
        fill(&mut self.description, other.description);
        fill(&mut self.content_rating, other.content_rating);
        fill(&mut self.cover_url, other.cover_url);
        if self.tags.is_empty() {
            self.tags = other.tags;
        }
        if self.available_languages.is_empty() {
            self.available_languages = other.available_languages;
        }
    }
}

fn fill(slot: &mut Option<String>, value: Option<String>) {
    if slot.is_none() {
        *slot = value;
    }
}

impl From<leaf_meta::MetadataHint> for MangaDetails {
    fn from(hint: leaf_meta::MetadataHint) -> Self {
        MangaDetails {
            title: String::new(),
            title_romaji: hint.title_romaji,
            title_native: hint.title_native,
            author: hint.author,
            artist: hint.artist,
            description: hint.description,
            tags: hint.tags,
            content_rating: hint.content_rating,
            available_languages: Vec::new(),
            cover_url: hint.cover_url,
        }
    }
}

/// A catalogue: browse titles, read a series' facts and its published
/// volume → chapter map. What Explore and "add from source" talk to.
///
/// Method names and shapes mirror Tachiyomi's own `CatalogueSource` on
/// purpose — porting a Keiyoushi extension is meant to be a mechanical
/// translation, not a redesign.
pub trait MetadataSource: Send + Sync {
    fn info(&self) -> &SourceInfo;

    fn popular(&self, page: u32) -> Result<MangasPage>;
    fn latest(&self, page: u32) -> Result<MangasPage>;
    fn search(&self, query: &str, page: u32) -> Result<MangasPage>;

    fn manga_details(&self, id: &str) -> Result<MangaDetails>;

    /// The published volume-to-chapter map, in one translation when the
    /// source has more than one, else `language` is ignored.
    fn volumes(&self, id: &str, language: Option<&str>) -> Result<Vec<VolumeChapters>>;

    /// Per-volume cover art, when the source publishes any.
    fn covers(&self, id: &str) -> Result<Vec<VolumeCover>>;
}

/// A details-only provider, asked to fill what a series' own source left
/// blank.
///
/// One `lookup(title)` rather than `search` + `details`: the native
/// providers (AniList, Jikan) answer a title in one request with no id, and
/// AniList allows thirty a minute, so a two-call trait would double the cost
/// for nothing. A Lua enrich script still writes `search` + `details`; its
/// adapter composes them.
pub trait EnrichSource: Send + Sync {
    fn info(&self) -> &SourceInfo;

    /// The best single match for `title`, or `None` when there is none.
    fn lookup(&self, title: &str) -> Result<Option<MangaDetails>>;
}

/// A source of chapter pages.
///
/// `search` + `chapters` are how "chapter 7 of this series" becomes this
/// site's own chapter id; a reader without them only serves chapters the
/// user links by hand, and says so through [`ReaderSource::can_resolve`].
pub trait ReaderSource: Send + Sync {
    fn info(&self) -> &SourceInfo;

    fn search(&self, query: &str, page: u32) -> Result<MangasPage>;

    /// Every chapter of one series on this site — for resolution, never
    /// rendered as the series' volume map.
    fn chapters(&self, manga_id: &str) -> Result<Vec<ChapterRef>>;

    /// Image URLs for one chapter, in reading order.
    fn page_list(&self, chapter_id: &str) -> Result<Vec<String>>;

    /// Whether `search` and `chapters` are both answered.
    fn can_resolve(&self) -> bool {
        let caps = &self.info().capabilities;
        caps.iter().any(|c| c == "search") && caps.iter().any(|c| c == "chapters")
    }
}
