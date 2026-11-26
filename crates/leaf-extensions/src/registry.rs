//! Where every known source lives, looked up by its stable id and the role
//! the caller needs.
//!
//! This is what replaces the `match "mangadex" | "kitsu"` that used to be
//! scattered across `src-tauri/src/library.rs` and `src-tauri/src/fetch.rs` —
//! `series.source` already stores a source id as free text, so adding a new
//! source only ever means registering it here, never touching a match arm.
//!
//! One id can play several roles (MangaDex is a catalogue, a reader and an
//! enricher), so an entry is an id with up to three role handles rather than
//! one object. A lookup that finds the id under a different role says so —
//! "that is an enrich source" — instead of "not found", because the pickers
//! each ask for one role and the user needs to know which line they hit.

use std::path::Path;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::lua::LuaSource;
use crate::native;
use crate::types::{EnrichSource, Kind, MangaDetails, MetadataSource, ReaderSource, SourceInfo};

/// A user script that parsed and loaded fine but the user has not approved
/// yet, per the trust gate in [`Registry::load_governed_extensions`].
pub struct PendingExtension {
    pub path: std::path::PathBuf,
    pub info: SourceInfo,
    /// sha256 of the script's bytes, hex — the same string the approval list
    /// stores, so a script edited after showing its banner changes identity
    /// and has to be approved again.
    pub fingerprint: String,
}

/// What the trust gate consults when loading user extensions. Bundled rather
/// than three slice arguments because they travel together and are easy to
/// swap — swapping `dev` and `disabled` would still compile, which is a bug
/// waiting to load silently.
#[derive(Default)]
pub struct Governance<'a> {
    /// Fingerprints the user approved byte-for-byte.
    pub approved: &'a [String],
    /// Files in development mode: registered whatever their bytes are.
    pub dev_files: &'a [String],
    /// Files the user deactivated. Skipped before even loading them — an
    /// off extension costs no VM and must not nag about approval either.
    /// Keyed by filename like dev mode: it is a statement about the entry
    /// in the list, which survives the author editing the file.
    pub disabled: &'a [String],
}

/// One user script as the extensions panel lists it, with the state the
/// governance produced for its current bytes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserScript {
    pub file: String,
    pub fingerprint: String,
    pub state: ScriptState,
    /// Absent when the script failed to load — the row still renders, with
    /// `error`, because a broken file the user cannot remove from the UI is
    /// worse than a broken file. Flattened so the panel's row has `name`,
    /// `kind` and `base_url` at its top level, which is how it renders them.
    #[serde(flatten)]
    pub info: Option<SourceInfo>,
    /// Why `state` is `Broken`; empty otherwise.
    pub error: String,
    /// What the loader accepted but will not act on.
    #[serde(default)]
    pub warnings: Vec<String>,
}

/// Where one script stands with the gate. Exactly one per row.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ScriptState {
    /// Registered: its current bytes are approved.
    Approved,
    /// Registered regardless of bytes, until locked.
    Dev,
    /// Loads, but waits for Approve or Develop.
    Pending,
    /// The user switched it off; not loaded at all.
    Disabled,
    /// Not even parseable — listed so it can be removed.
    Broken,
}

/// The role a caller asked for, for [`LookupError`]'s message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Metadata,
    Enrich,
    Reader,
}

/// Why a lookup came back empty: the id is unknown, or it is known and does
/// not play the role asked for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LookupError {
    NotFound(String),
    /// A catalogue with no installed reader for its site — see
    /// [`Registry::reader_for`].
    NoReaderFor {
        id: String,
        name: String,
        site: String,
    },
    WrongKind {
        id: String,
        kind: Kind,
        wanted: Role,
    },
}

impl std::fmt::Display for LookupError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound(id) => write!(f, "{id:?} is not a registered source"),
            Self::NoReaderFor { name, site, .. } => write!(
                f,
                "{name} lists chapters but does not serve pages; install and approve a \
                 reader extension for {site} on the Extensions screen"
            ),
            Self::WrongKind { id, kind, wanted } => {
                let cannot = match wanted {
                    Role::Metadata => "has no catalogue to browse",
                    Role::Enrich => "cannot fill in series details",
                    Role::Reader => "cannot serve pages",
                };
                write!(f, "{id:?} is a {kind} source and {cannot}")
            }
        }
    }
}

impl std::error::Error for LookupError {}

struct Entry {
    info: SourceInfo,
    metadata: Option<Arc<dyn MetadataSource>>,
    enrich: Option<Arc<dyn EnrichSource>>,
    reader: Option<Arc<dyn ReaderSource>>,
}

#[derive(Default)]
pub struct Registry {
    entries: Vec<Entry>,
}

impl Registry {
    /// The sha256 of a script's bytes, hex. Public so the front end can
    /// record the same fingerprint the loader checked, rather than trusting
    /// one it was merely told.
    pub fn fingerprint(script: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(script.as_bytes());
        hasher
            .finalize()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    }

    /// The sources that ship with the app, needing no user action to exist.
    ///
    /// MangaDex as a catalogue and an enricher, then AniList and Jikan as
    /// enrichers — registration order is the enrich chain's order, which is
    /// MangaDex (falling back to Kitsu), AniList, Jikan, as it always was.
    /// Kitsu is not an entry of its own: see [`native::mangadex`]'s enrich
    /// impl.
    ///
    /// No builtin is a reader. The binary fetches no pages at all; a page
    /// comes from a user-installed reader script — see [`Self::reader_for`].
    pub fn load_builtin() -> Self {
        let mut registry = Self::default();
        let mangadex = Arc::new(native::mangadex::MangaDexSource::default());
        registry.entries.push(Entry {
            info: MetadataSource::info(mangadex.as_ref()).clone(),
            metadata: Some(mangadex.clone() as Arc<dyn MetadataSource>),
            enrich: Some(mangadex as Arc<dyn EnrichSource>),
            reader: None,
        });
        let anilist: Arc<dyn EnrichSource> = Arc::new(native::enrich::AniList::default());
        let jikan: Arc<dyn EnrichSource> = Arc::new(native::enrich::Jikan::default());
        for enricher in [anilist, jikan] {
            registry.entries.push(Entry {
                info: enricher.info().clone(),
                metadata: None,
                enrich: Some(enricher),
                reader: None,
            });
        }
        registry
    }

    /// Register a loaded script under the roles its kind allows. A later
    /// entry with an id already taken is ignored — builtins load first, so
    /// a script cannot shadow one.
    pub fn register(&mut self, source: LuaSource) {
        if self.entries.iter().any(|e| e.info.id == source.info().id) {
            return;
        }
        let catalogue = source.is_catalogue();
        let kind = source.kind();
        let info = source.info().clone();
        let source = Arc::new(source);
        self.entries.push(Entry {
            info,
            metadata: catalogue.then(|| source.clone() as Arc<dyn MetadataSource>),
            enrich: (kind == Kind::Enrich).then(|| source.clone() as Arc<dyn EnrichSource>),
            reader: (kind == Kind::Reader).then_some(source as Arc<dyn ReaderSource>),
        });
    }

    /// Load every `.lua` file directly inside `dir` as a user-supplied source.
    ///
    /// Returns one error per file that failed to load rather than stopping at
    /// the first one — a typo in one source must not hide every other.
    pub fn load_user_extensions(&mut self, dir: &Path) -> Vec<(std::path::PathBuf, anyhow::Error)> {
        let mut failures = Vec::new();
        for path in lua_files(dir) {
            let result = std::fs::read_to_string(&path)
                .map_err(anyhow::Error::from)
                .and_then(LuaSource::load);
            match result {
                Ok(source) => self.register(source),
                Err(e) => failures.push((path, e)),
            }
        }
        failures
    }

    /// [`Self::load_user_extensions`] behind a trust gate: a script whose
    /// fingerprint the user has not approved is *not registered* — it is
    /// returned as pending so the front end can show what it is (name, kind,
    /// id, base_url, fingerprint) and ask.
    ///
    /// A file named in `dev_files` bypasses the gate entirely: it is an
    /// extension the user is actively authoring, and re-approving every save
    /// would make the desktop app unusable for script development. The
    /// promise dev mode makes is about the *file*, not its bytes — locking it
    /// converts the current bytes into a real approval and leaves the list.
    ///
    /// The gate exists because a `.lua` file is the user's machine handing a
    /// stranger's code an HTTP client that lives on their network. Net
    /// filtering (`crate::net_guard`) bounds what even an approved script can
    /// reach, but only a human can notice that a file named after one site
    /// wants `base_url = http://evil.example`.
    ///
    /// Builtins never pass through the gate; they ship signed with the app.
    pub fn load_governed_extensions(
        &mut self,
        dir: &Path,
        governance: &Governance,
    ) -> (
        Vec<(std::path::PathBuf, anyhow::Error)>,
        Vec<PendingExtension>,
    ) {
        let mut failures = Vec::new();
        let mut pending = Vec::new();

        for path in lua_files(dir) {
            let name = file_name(&path);
            if governance.disabled.contains(&name) {
                continue; // Deactivated: not loaded, not offered, not pending.
            }
            let text = match std::fs::read_to_string(&path) {
                Ok(text) => text,
                Err(e) => {
                    failures.push((path, e.into()));
                    continue;
                }
            };
            let fingerprint = Self::fingerprint(&text);
            match LuaSource::load(text) {
                Ok(source) => {
                    if governance.dev_files.contains(&name)
                        || governance.approved.contains(&fingerprint)
                    {
                        self.register(source);
                    } else {
                        pending.push(PendingExtension {
                            path,
                            info: source.info().clone(),
                            fingerprint,
                        });
                    }
                }
                Err(e) => failures.push((path, e)),
            }
        }
        (failures, pending)
    }

    /// The extensions folder as the panel sees it: one row per `.lua` file,
    /// each in exactly one state. Separate from
    /// [`Self::load_governed_extensions`] because the panel must *not* pay
    /// for VMs it is only listing — a script with a bug that times out the
    /// load still deserves a row the user can remove.
    pub fn survey(dir: &Path, governance: &Governance) -> Vec<UserScript> {
        let mut rows = Vec::new();
        for path in lua_files(dir) {
            let name = file_name(&path);
            let text = match std::fs::read_to_string(&path) {
                Ok(text) => text,
                Err(e) => {
                    rows.push(UserScript {
                        file: name,
                        fingerprint: String::new(),
                        state: ScriptState::Broken,
                        info: None,
                        error: e.to_string(),
                        warnings: Vec::new(),
                    });
                    continue;
                }
            };
            let fingerprint = Self::fingerprint(&text);
            // A script that fails to load still deserves a row the user can
            // remove; running it through `LuaSource::load` is how the panel
            // knows its manifest at all.
            match LuaSource::load(text) {
                Ok(source) => {
                    let state = if governance.disabled.contains(&name) {
                        ScriptState::Disabled
                    } else if governance.dev_files.contains(&name) {
                        ScriptState::Dev
                    } else if governance.approved.contains(&fingerprint) {
                        ScriptState::Approved
                    } else {
                        ScriptState::Pending
                    };
                    rows.push(UserScript {
                        info: Some(source.info().clone()),
                        warnings: source.warnings().to_vec(),
                        state,
                        file: name,
                        fingerprint,
                        error: String::new(),
                    });
                }
                Err(e) => rows.push(UserScript {
                    file: name,
                    fingerprint,
                    state: ScriptState::Broken,
                    info: None,
                    error: format!("{e:#}"),
                    warnings: Vec::new(),
                }),
            }
        }
        rows.sort_by(|a, b| a.file.cmp(&b.file));
        rows
    }

    fn entry(&self, id: &str) -> Result<&Entry, LookupError> {
        let id = canonical(id);
        self.entries
            .iter()
            .find(|e| e.info.id == id)
            .ok_or_else(|| LookupError::NotFound(id.to_string()))
    }

    fn wrong(entry: &Entry, wanted: Role) -> LookupError {
        LookupError::WrongKind {
            id: entry.info.id.clone(),
            kind: entry.info.kind,
            wanted,
        }
    }

    /// The catalogue registered as `id`.
    pub fn metadata(&self, id: &str) -> Result<Arc<dyn MetadataSource>, LookupError> {
        let entry = self.entry(id)?;
        entry
            .metadata
            .clone()
            .ok_or_else(|| Self::wrong(entry, Role::Metadata))
    }

    /// The reader registered as `id`.
    pub fn reader(&self, id: &str) -> Result<Arc<dyn ReaderSource>, LookupError> {
        let entry = self.entry(id)?;
        entry
            .reader
            .clone()
            .ok_or_else(|| Self::wrong(entry, Role::Reader))
    }

    /// Where the pages of a chapter listed by `id` come from.
    ///
    /// The source itself when it is a reader. Otherwise — a catalogue, whose
    /// chapter ids are its site's own — the first registered reader that
    /// declares the same site, by origin of `base_url` or a mirror. That is
    /// how a series from the built-in MangaDex catalogue reads at all: its
    /// chapter ids are MangaDex's, and only a user-installed reader declaring
    /// `mangadex.org` can turn them into pages. Matching on the declared site
    /// rather than a script id keeps the binary from naming any script, and
    /// any reader for that site serves, whoever wrote it.
    pub fn reader_for(&self, id: &str) -> Result<Arc<dyn ReaderSource>, LookupError> {
        let entry = self.entry(id)?;
        if let Some(reader) = &entry.reader {
            return Ok(reader.clone());
        }
        // Only a catalogue has chapter ids for some site to serve.
        let site = entry
            .metadata
            .as_ref()
            .and_then(|_| leaf_fetch::url::origin_of(&entry.info.base_url))
            .ok_or_else(|| Self::wrong(entry, Role::Reader))?;
        self.entries
            .iter()
            .filter_map(|e| e.reader.as_ref().map(|r| (e, r)))
            .find(|(e, _)| {
                std::iter::once(&e.info.base_url)
                    .chain(&e.info.mirrors)
                    .any(|url| leaf_fetch::url::origin_of(url).as_deref() == Some(site.as_str()))
            })
            .map(|(_, reader)| reader.clone())
            .ok_or_else(|| LookupError::NoReaderFor {
                id: entry.info.id.clone(),
                name: entry.info.name.clone(),
                site,
            })
    }

    /// Every enrich source, in registration order — the chain's order.
    pub fn enrich_sources(&self) -> Vec<Arc<dyn EnrichSource>> {
        self.entries
            .iter()
            .filter_map(|e| e.enrich.clone())
            .collect()
    }

    /// Every registered source, whatever its role.
    pub fn all(&self) -> Vec<SourceInfo> {
        self.entries.iter().map(|e| e.info.clone()).collect()
    }

    /// The sources that can be browsed — what Explore and "add from source"
    /// list.
    pub fn catalogues(&self) -> Vec<SourceInfo> {
        self.entries
            .iter()
            .filter(|e| e.metadata.is_some())
            .map(|e| e.info.clone())
            .collect()
    }

    /// The sources that can serve pages.
    pub fn readers(&self) -> Vec<SourceInfo> {
        self.entries
            .iter()
            .filter(|e| e.reader.is_some())
            .map(|e| e.info.clone())
            .collect()
    }

    /// Best-effort series metadata: `source.manga_details(id)` first, then
    /// whatever it left blank — or, if the call failed outright, everything —
    /// is filled by [`Self::enrich`].
    ///
    /// A scraped site's markup is far more likely to break than any metadata
    /// database, and this is what lets adding a series survive that instead
    /// of failing outright. Never overrides a field the source *did* supply:
    /// its own page is the more specific answer when it has one.
    /// `fallback_title` — the title already on hand from whichever catalogue
    /// listing this series was picked from — is the search query when the
    /// source's own call didn't get far enough to supply one itself.
    pub fn best_effort(
        &self,
        source: &dyn MetadataSource,
        external_id: &str,
        fallback_title: &str,
    ) -> MangaDetails {
        let mut details = source
            .manga_details(external_id)
            .unwrap_or_else(|_| MangaDetails {
                title: fallback_title.to_string(),
                ..Default::default()
            });
        if details.title.is_empty() {
            details.title = fallback_title.to_string();
        }
        let query = details.title.clone();
        self.enrich(&mut details, &query);
        details
    }

    /// Ask every enrich source, in order, to fill what `details` is still
    /// missing. Each is asked regardless of whether an earlier one answered,
    /// so a title only the third carries a cover for still gets it after the
    /// first supplied the description; a failing one is skipped, never fatal.
    pub fn enrich(&self, details: &mut MangaDetails, query: &str) {
        for source in self.enrich_sources() {
            if let Ok(Some(found)) = source.lookup(query) {
                // An enricher's title is its own spelling of a match, not a
                // better name for the series the user already has.
                details.fill_gaps(MangaDetails {
                    title: String::new(),
                    ..found
                });
            }
        }
    }
}

/// Older library rows store a series' source as `"mangadex"`, from before
/// the registry existed; it names the built-in catalogue.
fn canonical(id: &str) -> &str {
    match id {
        "mangadex" => native::mangadex::ID,
        other => other,
    }
}

/// Every `.lua` file directly inside `dir`; nothing when it does not exist,
/// which is not an error — no extensions folder yet is the fresh state.
fn lua_files(dir: &Path) -> Vec<std::path::PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("lua"))
        .collect()
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[test]
    fn mangadex_is_a_builtin_catalogue_but_not_a_reader() {
        let registry = Registry::load_builtin();
        assert!(registry.metadata(native::mangadex::ID).is_ok());
        assert!(
            registry.metadata("mangadex").is_ok(),
            "the legacy row spelling"
        );
        assert_eq!(registry.catalogues().len(), 1);
        // The binary serves no pages, from anywhere.
        assert!(registry.readers().is_empty());
        assert!(matches!(
            registry.reader_for(native::mangadex::ID).err(),
            Some(LookupError::NoReaderFor { .. })
        ));
    }

    #[test]
    fn a_catalogue_reads_through_a_reader_declaring_its_site() {
        let dir = tempfile::tempdir().unwrap();
        // Another site's reader first, to prove the match is by site.
        std::fs::write(dir.path().join("other.lua"), stub_script("other")).unwrap();
        std::fs::write(
            dir.path().join("md.lua"),
            r#"SOURCE = { id = "test.md-reader", name = "MD reader", kind = "reader",
                          base_url = "https://reader.example",
                          mirrors = { "https://mangadex.org" } }
               function page_list(id) return {} end"#,
        )
        .unwrap();
        let mut registry = Registry::load_builtin();
        assert!(registry.load_user_extensions(dir.path()).is_empty());

        let reader = registry.reader_for("mangadex").unwrap();
        assert_eq!(reader.info().id, "test.md-reader");
        // A reader still answers for itself.
        assert_eq!(
            registry.reader_for("test.other").unwrap().info().id,
            "test.other"
        );
    }

    #[test]
    fn the_builtin_enrich_chain_keeps_its_order() {
        let ids: Vec<String> = Registry::load_builtin()
            .enrich_sources()
            .iter()
            .map(|s| s.info().id.clone())
            .collect();
        assert_eq!(
            ids,
            [
                native::mangadex::ID,
                native::enrich::ANILIST_ID,
                native::enrich::JIKAN_ID
            ]
        );
    }

    #[test]
    fn an_unknown_id_is_not_found() {
        assert_eq!(
            Registry::load_builtin().metadata("nothing.here").err(),
            Some(LookupError::NotFound("nothing.here".into()))
        );
    }

    #[test]
    fn asking_an_enricher_for_pages_says_what_it_is() {
        let err = Registry::load_builtin()
            .reader(native::enrich::ANILIST_ID)
            .err()
            .unwrap();
        assert!(matches!(
            err,
            LookupError::WrongKind {
                kind: Kind::Enrich,
                wanted: Role::Reader,
                ..
            }
        ));
        assert!(err.to_string().contains("cannot serve pages"));
    }

    #[test]
    fn a_missing_extensions_folder_yields_no_failures() {
        let mut registry = Registry::load_builtin();
        let failures = registry.load_user_extensions(Path::new("/nonexistent/leaf-test-dir"));
        assert!(failures.is_empty());
    }

    /// The smallest script that loads: a manifest and the one function a
    /// reader must have.
    fn stub_script(name: &str) -> String {
        format!(
            r#"SOURCE = {{ id = "test.{name}", name = "{name}", kind = "reader", lang = "en",
                 base_url = "https://{name}.example" }}
               function page_list(id) return {{}} end"#
        )
    }

    #[test]
    fn registration_follows_the_declared_kind() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("pages.lua"), stub_script("pages")).unwrap();
        std::fs::write(
            dir.path().join("facts.lua"),
            r#"SOURCE = { id = "test.facts", name = "Facts", kind = "enrich",
                          base_url = "https://facts.example" }
               function search() return { manga = {} } end
               function details() return { title = "x" } end"#,
        )
        .unwrap();
        let mut registry = Registry::load_builtin();
        assert!(registry.load_user_extensions(dir.path()).is_empty());

        assert!(registry.reader("test.pages").is_ok());
        // A page-only reader is not something Explore can browse.
        assert!(registry.metadata("test.pages").is_err());
        assert!(registry.reader("test.facts").is_err());
        assert_eq!(
            registry.enrich_sources().last().unwrap().info().id,
            "test.facts",
            "user enrichers run after the builtins"
        );
    }

    #[test]
    fn a_script_cannot_shadow_a_builtin_id() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("fake.lua"),
            format!(
                r#"SOURCE = {{ id = "{}", name = "Fake", kind = "reader",
                               base_url = "https://fake.example" }}
                   function page_list(id) return {{}} end"#,
                native::mangadex::ID
            ),
        )
        .unwrap();
        let mut registry = Registry::load_builtin();
        registry.load_user_extensions(dir.path());
        // The fake did not attach itself to the builtin's id as a reader.
        assert!(registry.reader(native::mangadex::ID).is_err());
        assert!(registry.readers().is_empty());
    }

    /// An enricher answering from a fixed table, recording that it was asked.
    struct Fixed {
        info: SourceInfo,
        answer: Result<Option<MangaDetails>, ()>,
        asked: Mutex<u32>,
    }

    impl EnrichSource for Fixed {
        fn info(&self) -> &SourceInfo {
            &self.info
        }
        fn lookup(&self, _: &str) -> anyhow::Result<Option<MangaDetails>> {
            *self.asked.lock().unwrap() += 1;
            self.answer.clone().map_err(|_| anyhow::anyhow!("offline"))
        }
    }

    fn fixed(id: &str, answer: Result<Option<MangaDetails>, ()>) -> Arc<Fixed> {
        Arc::new(Fixed {
            info: SourceInfo {
                id: id.into(),
                name: id.into(),
                kind: Kind::Enrich,
                lang: "en".into(),
                base_url: "https://x.example".into(),
                mirrors: Vec::new(),
                description: None,
                api: 1,
                nsfw: false,
                capabilities: Vec::new(),
            },
            answer,
            asked: Mutex::new(0),
        })
    }

    #[test]
    fn the_enrich_chain_fills_gaps_in_order_and_survives_a_failure() {
        let broken = fixed("broken", Err(()));
        let first = fixed(
            "first",
            Ok(Some(MangaDetails {
                author: Some("First".into()),
                ..Default::default()
            })),
        );
        let second = fixed(
            "second",
            Ok(Some(MangaDetails {
                author: Some("Second".into()),
                description: Some("From the second".into()),
                ..Default::default()
            })),
        );
        let mut registry = Registry::default();
        for e in [broken.clone(), first, second] {
            registry.entries.push(Entry {
                info: e.info.clone(),
                metadata: None,
                enrich: Some(e),
                reader: None,
            });
        }

        let mut details = MangaDetails {
            title: "Mine".into(),
            ..Default::default()
        };
        registry.enrich(&mut details, "Mine");
        assert_eq!(*broken.asked.lock().unwrap(), 1);
        assert_eq!(details.title, "Mine");
        assert_eq!(details.author.as_deref(), Some("First"));
        assert_eq!(details.description.as_deref(), Some("From the second"));
    }

    #[test]
    fn an_unapproved_script_stays_pending_instead_of_registering() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("stranger.lua"), stub_script("stranger")).unwrap();

        let mut registry = Registry::load_builtin();
        let (failures, pending) =
            registry.load_governed_extensions(dir.path(), &Default::default());
        assert!(failures.is_empty());
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].info.id, "test.stranger");
        assert_eq!(pending[0].info.kind, Kind::Reader);
        // Not usable as a source until approved.
        assert!(registry.reader("test.stranger").is_err());

        // Approving by the fingerprint it was shown with registers it...
        let fingerprint = Registry::fingerprint(&stub_script("stranger"));
        assert_eq!(fingerprint, pending[0].fingerprint);
        let mut registry = Registry::load_builtin();
        let (_, still) = registry.load_governed_extensions(
            dir.path(),
            &Governance {
                approved: std::slice::from_ref(&fingerprint),
                ..Default::default()
            },
        );
        assert!(still.is_empty());
        assert!(registry.reader("test.stranger").is_ok());

        // ...and one edited byte changes the fingerprint, which puts the new
        // content back at the gate under the same filename.
        std::fs::write(dir.path().join("stranger.lua"), stub_script("stranger2")).unwrap();
        let mut registry = Registry::load_builtin();
        let (_, pending) = registry.load_governed_extensions(
            dir.path(),
            &Governance {
                approved: &[fingerprint],
                ..Default::default()
            },
        );
        assert_eq!(pending.len(), 1);
        assert!(registry.reader("test.stranger").is_err());
    }

    #[test]
    fn a_dev_file_bypasses_the_gate_until_its_content_is_locked() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("wip.lua"), stub_script("wip1")).unwrap();

        // Dev mode: the file runs whatever its current bytes are — this is the
        // save-forty-times loop the strict fingerprint would make unusable.
        let mut registry = Registry::load_builtin();
        let (_, pending) = registry.load_governed_extensions(
            dir.path(),
            &Governance {
                dev_files: &["wip.lua".to_string()],
                ..Default::default()
            },
        );
        assert!(pending.is_empty());
        assert!(registry.reader("test.wip1").is_ok());

        std::fs::write(dir.path().join("wip.lua"), stub_script("wip2")).unwrap();
        let mut registry = Registry::load_builtin();
        registry.load_governed_extensions(
            dir.path(),
            &Governance {
                dev_files: &["wip.lua".to_string()],
                ..Default::default()
            },
        );
        assert!(registry.reader("test.wip2").is_ok());

        // Locking (the front end records the current fingerprint and drops
        // the file from the dev list) hands control back to the byte lock.
        let locked = Registry::fingerprint(&stub_script("wip2"));
        std::fs::write(dir.path().join("wip.lua"), stub_script("wip3")).unwrap();
        let mut registry = Registry::load_builtin();
        let (_, pending) = registry.load_governed_extensions(
            dir.path(),
            &Governance {
                approved: &[locked],
                ..Default::default()
            },
        );
        assert_eq!(pending.len(), 1);
        assert!(registry.reader("test.wip3").is_err());
    }

    #[test]
    fn a_broken_script_is_a_failure_at_the_gate_not_a_pending_one() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("typo.lua"), "SOURCE = {").unwrap();
        let mut registry = Registry::load_builtin();
        let (failures, pending) =
            registry.load_governed_extensions(dir.path(), &Default::default());
        assert_eq!(failures.len(), 1);
        assert!(pending.is_empty());
    }

    #[test]
    fn a_disabled_file_is_not_loaded_even_when_approved() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("off.lua"), stub_script("off")).unwrap();
        let fingerprint = Registry::fingerprint(&stub_script("off"));

        let mut registry = Registry::load_builtin();
        let governance = Governance {
            approved: &[fingerprint],
            disabled: &["off.lua".to_string()],
            ..Default::default()
        };
        registry.load_governed_extensions(dir.path(), &governance);
        assert!(registry.reader("test.off").is_err());
    }

    #[test]
    fn the_survey_lists_every_file_in_exactly_one_state() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("good.lua"), stub_script("good")).unwrap();
        std::fs::write(dir.path().join("broken.lua"), "SOURCE = {").unwrap();
        let fingerprint = Registry::fingerprint(&stub_script("good"));

        let rows = Registry::survey(
            dir.path(),
            &Governance {
                approved: &[fingerprint],
                ..Default::default()
            },
        );
        assert_eq!(rows.len(), 2);
        let good = rows.iter().find(|r| r.file == "good.lua").unwrap();
        assert_eq!(good.state, ScriptState::Approved);
        let info = good.info.as_ref().unwrap();
        assert_eq!(info.id, "test.good");
        assert_eq!(info.kind, Kind::Reader);
        // Broken still gets a row — the user must be able to remove it.
        let broken = rows.iter().find(|r| r.file == "broken.lua").unwrap();
        assert_eq!(broken.state, ScriptState::Broken);
        assert!(broken.info.is_none());
        assert!(!broken.error.is_empty());
    }
}
