//! [`LuaSource`]: a source backed by a sandboxed Lua script.
//!
//! The VM lives on a dedicated thread that owns it exclusively for its whole
//! life, and every source method is really a message sent to that thread
//! over a channel. This isn't just a convenience: `mlua::Lua` is not
//! `Send`/`Sync`, so a VM can never be shared across threads directly, and a
//! single VM was never meant to be called into reentrantly from several
//! threads at once anyway. Confining it to one thread and mediating every
//! call through a channel is the same pattern `src-tauri/src/tasks.rs` already
//! uses for its single background worker, applied here for the same reason:
//! it makes something inherently single-threaded safe to hand out as a plain
//! `Arc<dyn …Source>`.
//!
//! What a script may do is decided by `SOURCE.kind`, at load, in
//! [`check_kind`] — see that function for the rules. One `LuaSource` type
//! implements all three role traits; the registry only ever hands it out
//! under the roles its kind allows, and the methods re-check the kind
//! themselves, so the page line holds even for a caller holding the
//! concrete type.

mod host;
mod sandbox;

use std::sync::mpsc;

use anyhow::{anyhow, bail, Result};
use mlua::Table;

use crate::types::{
    ChapterRef, EnrichSource, Kind, MangaDetails, MangaSummary, MangasPage, MetadataSource,
    ReaderSource, SourceInfo, VolumeChapters, VolumeCover, API_LEVEL,
};

type Reply<T> = mpsc::Sender<Result<T>>;

/// One request to the VM's owning thread. Each variant carries its own
/// reply channel rather than a boxed `dyn Any`, so the thread loop and every
/// call site stay plainly typed.
enum Call {
    Popular(u32, Reply<MangasPage>),
    Latest(u32, Reply<MangasPage>),
    Search(String, u32, Reply<MangasPage>),
    MangaDetails(String, Reply<MangaDetails>),
    Volumes(String, Option<String>, Reply<Vec<VolumeChapters>>),
    Covers(String, Reply<Vec<VolumeCover>>),
    Chapters(String, Reply<Vec<ChapterRef>>),
    Lookup(String, Reply<Option<MangaDetails>>),
    PageList(String, Reply<Vec<String>>),
}

/// Every global function name the loader looks at. Anything else a script
/// defines is its own business (helpers are usually `local`, but needn't be).
const KNOWN_FUNCTIONS: &[&str] = &[
    "popular",
    "latest",
    "search",
    "manga_details",
    "details",
    "volumes",
    "covers",
    "chapters",
    "page_list",
];

/// The full catalogue a reader can still carry from before the kind split.
/// A reader defining all three is also offered as a catalogue — see
/// [`Verdict::catalogue`].
const CATALOGUE_CORE: &[&str] = &["search", "manga_details", "volumes"];

pub struct LuaSource {
    info: SourceInfo,
    warnings: Vec<String>,
    /// A reader that also carries a full catalogue (`search` +
    /// `manga_details` + `volumes`), and so also answers as a
    /// [`MetadataSource`].
    catalogue: bool,
    /// Whether the script defines `chapters` itself, or it is derived from
    /// `volumes`.
    own_chapters: bool,
    tx: mpsc::Sender<Call>,
}

/// What [`init`] hands back across the thread boundary.
struct Loaded {
    info: SourceInfo,
    verdict: Verdict,
}

impl LuaSource {
    /// Load and validate a source script, starting its owning thread.
    ///
    /// Blocks until the script has run to completion and its `SOURCE`
    /// manifest has been read and checked against its kind, so a broken
    /// script fails here rather than on its first real use.
    pub fn load(script: String) -> Result<Self> {
        let (ready_tx, ready_rx) = mpsc::channel::<Result<Loaded>>();
        let (call_tx, call_rx) = mpsc::channel::<Call>();

        std::thread::Builder::new()
            .name("leaf-lua-source".to_string())
            .spawn(move || run(script, ready_tx, call_rx))
            .map_err(|e| anyhow!("starting the source's thread: {e}"))?;

        let loaded = ready_rx
            .recv()
            .map_err(|_| anyhow!("the source's thread exited before it finished loading"))??;

        Ok(Self {
            info: loaded.info,
            warnings: loaded.verdict.warnings,
            catalogue: loaded.verdict.catalogue,
            own_chapters: loaded.verdict.own_chapters,
            tx: call_tx,
        })
    }

    /// The manifest, as read and completed at load. Inherent so a caller
    /// holding the concrete type need not say which role trait it means.
    pub fn info(&self) -> &SourceInfo {
        &self.info
    }

    pub fn kind(&self) -> Kind {
        self.info.kind
    }

    /// Things the loader accepted but will not act on — a reader's stray
    /// `covers`, half of a resolution pair. Shown on the extension's row.
    pub fn warnings(&self) -> &[String] {
        &self.warnings
    }

    /// Whether this source answers the [`MetadataSource`] role: a metadata
    /// script, or a reader still carrying a full catalogue.
    pub fn is_catalogue(&self) -> bool {
        self.info.kind == Kind::Metadata || self.catalogue
    }

    /// Send a call and wait for its reply. The only way this fails is the
    /// owning thread having already exited, which only happens if a previous
    /// call poisoned it — treated as the source being unusable from here on,
    /// same as any other permanent failure.
    fn ask<T>(&self, build: impl FnOnce(Reply<T>) -> Call) -> Result<T> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.tx
            .send(build(reply_tx))
            .map_err(|_| anyhow!("{} is no longer running", self.info.name))?;
        reply_rx
            .recv()
            .map_err(|_| anyhow!("{} did not answer", self.info.name))?
    }

    fn require_catalogue(&self) -> Result<()> {
        if self.is_catalogue() {
            Ok(())
        } else {
            bail!(
                "{} is a {} source and has no catalogue",
                self.info.name,
                self.info.kind
            )
        }
    }

    fn require(&self, kind: Kind, what: &str) -> Result<()> {
        if self.info.kind == kind {
            Ok(())
        } else {
            bail!(
                "{} is a {} source and cannot {what}",
                self.info.name,
                self.info.kind
            )
        }
    }

    fn search_any(&self, query: &str, page: u32) -> Result<MangasPage> {
        self.ask(|reply| Call::Search(query.to_string(), page, reply))
    }
}

impl MetadataSource for LuaSource {
    fn info(&self) -> &SourceInfo {
        &self.info
    }

    fn popular(&self, page: u32) -> Result<MangasPage> {
        self.require_catalogue()?;
        self.ask(|reply| Call::Popular(page, reply))
    }

    fn latest(&self, page: u32) -> Result<MangasPage> {
        self.require_catalogue()?;
        self.ask(|reply| Call::Latest(page, reply))
    }

    fn search(&self, query: &str, page: u32) -> Result<MangasPage> {
        self.require_catalogue()?;
        self.search_any(query, page)
    }

    fn manga_details(&self, id: &str) -> Result<MangaDetails> {
        self.require_catalogue()?;
        self.ask(|reply| Call::MangaDetails(id.to_string(), reply))
    }

    fn volumes(&self, id: &str, language: Option<&str>) -> Result<Vec<VolumeChapters>> {
        self.require_catalogue()?;
        self.ask(|reply| Call::Volumes(id.to_string(), language.map(str::to_string), reply))
    }

    fn covers(&self, id: &str) -> Result<Vec<VolumeCover>> {
        self.require_catalogue()?;
        self.ask(|reply| Call::Covers(id.to_string(), reply))
    }
}

impl EnrichSource for LuaSource {
    fn info(&self) -> &SourceInfo {
        &self.info
    }

    fn lookup(&self, title: &str) -> Result<Option<MangaDetails>> {
        self.require(Kind::Enrich, "enrich a series")?;
        self.ask(|reply| Call::Lookup(title.to_string(), reply))
    }
}

impl ReaderSource for LuaSource {
    fn info(&self) -> &SourceInfo {
        &self.info
    }

    fn search(&self, query: &str, page: u32) -> Result<MangasPage> {
        self.require(Kind::Reader, "resolve chapters")?;
        self.search_any(query, page)
    }

    fn chapters(&self, manga_id: &str) -> Result<Vec<ChapterRef>> {
        self.require(Kind::Reader, "resolve chapters")?;
        if self.own_chapters {
            return self.ask(|reply| Call::Chapters(manga_id.to_string(), reply));
        }
        // A reader from before the split lists chapters as a volume map;
        // flattened, it is the same list.
        let volumes = self.ask(|reply| Call::Volumes(manga_id.to_string(), None, reply))?;
        Ok(volumes.into_iter().flat_map(|v| v.chapters).collect())
    }

    fn page_list(&self, chapter_id: &str) -> Result<Vec<String>> {
        self.require(Kind::Reader, "serve pages")?;
        let pages = self.ask(|reply| Call::PageList(chapter_id.to_string(), reply))?;
        // These URLs are the one output that leaves the sandbox as a *request
        // the host itself makes* — the downloader fetches them verbatim — so
        // a script that returns `http://169.254.169.254/...` here would
        // otherwise probe the user's network through the app. Origin pinning
        // is too strict (CDN-hosted pages legitimately live off the site's
        // origin); the private-address rule is not negotiable.
        Ok(pages
            .into_iter()
            .filter(|url| crate::net_guard::url_is_public(url))
            .collect())
    }
}

/// The body of the source's dedicated thread: build the VM, run the script,
/// report readiness, then serve calls until the sender side is dropped (which
/// is what ends the `for` loop and lets this function, and the thread, exit).
fn run(script: String, ready: mpsc::Sender<Result<Loaded>>, calls: mpsc::Receiver<Call>) {
    let (lua, loaded) = match init(&script) {
        Ok(pair) => pair,
        Err(e) => {
            let _ = ready.send(Err(e));
            return;
        }
    };
    if ready.send(Ok(loaded)).is_err() {
        return; // Nobody is waiting for this source any more.
    }

    // Each arm's reply carries a different `T`, so every arm discards its own
    // `send` result rather than the `match` producing one shared type — a
    // reply nobody is listening for any more (e.g. a cancelled task) is not
    // this thread's problem to handle beyond that.
    for call in calls {
        match call {
            Call::Popular(page, reply) => {
                let _ = reply.send(call_paged(&lua, "popular", page));
            }
            Call::Latest(page, reply) => {
                let _ = reply.send(call_paged(&lua, "latest", page));
            }
            Call::Search(query, page, reply) => {
                let _ = reply.send(call_search(&lua, &query, page));
            }
            Call::MangaDetails(id, reply) => {
                let _ = reply.send(call_details(&lua, "manga_details", &id));
            }
            Call::Volumes(id, language, reply) => {
                let _ = reply.send(call_volumes(&lua, &id, language.as_deref()));
            }
            Call::Covers(id, reply) => {
                let _ = reply.send(call_covers(&lua, &id));
            }
            Call::Chapters(id, reply) => {
                let _ = reply.send(call_chapters(&lua, &id));
            }
            Call::Lookup(title, reply) => {
                let _ = reply.send(call_lookup(&lua, &title));
            }
            Call::PageList(id, reply) => {
                let _ = reply.send(call_page_list(&lua, &id));
            }
        }
    }
}

/// Run the script once, read its `SOURCE` manifest, check it against the
/// functions the script defines, then install the host functions now that
/// the allowed origins are known. See [`sandbox::new_vm`]'s doc for why this
/// order — script first, host functions after — is safe.
fn init(script: &str) -> Result<(mlua::Lua, Loaded)> {
    let (lua, leaf) = sandbox::new_vm()?;
    // Named, or Lua reports positions against this Rust file (mlua's
    // default chunk name is the caller's location), which sends a script
    // author looking in the wrong place entirely.
    lua.load(script)
        .set_name("=script")
        .exec()
        .map_err(|e| anyhow!("running source script: {}", clean(&e)))?;

    let source_table: Table = lua
        .globals()
        .get("SOURCE")
        .map_err(|_| anyhow!("script does not define a SOURCE table"))?;
    let id: String = source_table
        .get("id")
        .map_err(|_| anyhow!("SOURCE.id is required"))?;
    let name: String = source_table
        .get("name")
        .map_err(|_| anyhow!("SOURCE.name is required"))?;
    let kind_text: Option<String> = source_table
        .get("kind")
        .map_err(|_| anyhow!("SOURCE.kind must be a string"))?;
    let kind = match kind_text.as_deref() {
        None => bail!(
            "SOURCE.kind is required: \"metadata\", \"enrich\" or \"reader\" — it is what the \
             approval screen tells the user this script can do"
        ),
        Some(text) => Kind::parse(text).ok_or_else(|| {
            anyhow!("SOURCE.kind {text:?} is not one of \"metadata\", \"enrich\", \"reader\"")
        })?,
    };
    let lang: String = source_table
        .get("lang")
        .unwrap_or_else(|_| "en".to_string());
    let base_url: String = source_table
        .get("base_url")
        .map_err(|_| anyhow!("SOURCE.base_url is required"))?;
    let mirrors: Vec<String> = source_table.get("mirrors").unwrap_or_default();
    let description: Option<String> = source_table.get("description").unwrap_or(None);
    let api: u32 = source_table
        .get::<Option<u32>>("api")
        .map_err(|_| anyhow!("SOURCE.api must be a whole number"))?
        .unwrap_or(1);
    if api > API_LEVEL {
        bail!("this script needs host API level {api}; this Leaf offers {API_LEVEL} — update Leaf");
    }
    let nsfw: bool = source_table.get("nsfw").unwrap_or(false);

    let mut allowed_origins: Vec<String> =
        leaf_fetch::url::origin_of(&base_url).into_iter().collect();
    for mirror in &mirrors {
        allowed_origins.extend(leaf_fetch::url::origin_of(mirror));
    }
    if allowed_origins.is_empty() {
        bail!("SOURCE.base_url {base_url:?} is not a valid http(s) URL");
    }

    let globals = lua.globals();
    let defined: Vec<&str> = KNOWN_FUNCTIONS
        .iter()
        .copied()
        .filter(|f| matches!(globals.get::<mlua::Value>(*f), Ok(mlua::Value::Function(_))))
        .collect();
    let verdict = check_kind(kind, &defined)?;

    host::install(&lua, &leaf, allowed_origins)
        .map_err(|e| anyhow!("installing host functions: {e}"))?;

    Ok((
        lua,
        Loaded {
            info: SourceInfo {
                id,
                name,
                kind,
                lang,
                base_url,
                mirrors,
                description,
                api,
                nsfw,
                capabilities: verdict.capabilities.clone(),
            },
            verdict,
        },
    ))
}

/// The loader's judgement of one script's functions against its kind.
#[derive(Debug, Default, PartialEq)]
pub struct Verdict {
    pub capabilities: Vec<String>,
    pub warnings: Vec<String>,
    /// A reader carrying the whole catalogue it had before the kind split,
    /// offered as a [`MetadataSource`] too. Transitional: until a series can
    /// bind chapters to a reader independently of where its metadata came
    /// from, taking that catalogue away would leave the reader unreachable.
    pub catalogue: bool,
    pub own_chapters: bool,
}

/// What a script of `kind` that defines `defined` may do.
///
/// Refused outright, because it is the security line: a non-reader with
/// `page_list` or `chapters`. Refused because the script is not usable: a
/// kind's required functions missing (`page_list` for a reader; `search` +
/// `details` for enrich; `search` + `manga_details` + `volumes` for
/// metadata). Everything else that does not belong to the kind is a
/// *warning* and is never called — ported extensions carry adjacent junk and
/// must not die on it.
pub fn check_kind(kind: Kind, defined: &[&str]) -> Result<Verdict> {
    let has = |f: &str| defined.contains(&f);
    let mut verdict = Verdict::default();

    if kind != Kind::Reader {
        let serving: Vec<&str> = ["page_list", "chapters"]
            .into_iter()
            .filter(|f| has(f))
            .collect();
        if !serving.is_empty() {
            bail!(
                "a {kind} source may not define {} — only a reader serves pages",
                serving.join(" or ")
            );
        }
    }

    let (required, allowed): (&[&str], &[&str]) = match kind {
        Kind::Metadata => (
            &["search", "manga_details", "volumes"],
            &[
                "popular",
                "latest",
                "search",
                "manga_details",
                "volumes",
                "covers",
            ],
        ),
        Kind::Enrich => (&["search", "details"], &["search", "details"]),
        Kind::Reader => (&["page_list"], &["search", "chapters", "page_list"]),
    };
    let missing: Vec<&str> = required.iter().copied().filter(|f| !has(f)).collect();
    if !missing.is_empty() {
        bail!("a {kind} source must define {}", missing.join(", "));
    }

    if kind == Kind::Reader {
        verdict.own_chapters = has("chapters");
        verdict.catalogue = CATALOGUE_CORE.iter().all(|f| has(f));
        let can_list = verdict.own_chapters || has("volumes");
        if has("search") != can_list {
            verdict.warnings.push(
                "defines only one of search and chapters, so it can only serve chapters linked \
                 by hand"
                    .to_string(),
            );
        }
    }

    for f in defined {
        let legacy_catalogue = verdict.catalogue
            && ["popular", "latest", "manga_details", "volumes", "covers"].contains(f);
        if !allowed.contains(f) && !legacy_catalogue {
            verdict
                .warnings
                .push(format!("{f} is not part of a {kind} source and is ignored"));
        }
    }

    verdict.capabilities = match kind {
        Kind::Metadata => defined
            .iter()
            .filter(|f| allowed.contains(f))
            .map(|f| capability_name(f).to_string())
            .collect(),
        Kind::Enrich => vec!["search".into(), "details".into()],
        Kind::Reader => {
            let mut caps = Vec::new();
            if has("search") {
                caps.push("search".to_string());
            }
            if verdict.own_chapters || has("volumes") {
                caps.push("chapters".to_string());
            }
            caps.push("pages".to_string());
            if verdict.catalogue {
                caps.push("catalogue".to_string());
            }
            caps
        }
    };
    Ok(verdict)
}

/// The panel's word for a function: `manga_details` is just "details".
fn capability_name(function: &str) -> &str {
    match function {
        "manga_details" => "details",
        other => other,
    }
}

/// A script call's failure as something a person can read.
///
/// A script that raises `error("...")` is talking to the user — "this
/// chapter is licensed and published at <url>" — so that message is passed
/// on alone, without the call it came from and without Lua's stack
/// traceback. Two reasons: the reader shows errors verbatim, and it offers a
/// URL that *ends* the message as a "read at publisher" button, which a
/// trailing traceback would bury. Everything else (a host function failing,
/// a type mismatch) keeps the call as context, because that is a bug report.
fn script_error(e: mlua::Error, context: impl FnOnce() -> String) -> anyhow::Error {
    match &e {
        mlua::Error::RuntimeError(_) => anyhow!("{}", clean(&e)),
        _ => anyhow!("{}: {}", context(), clean(&e)),
    }
}

/// An mlua error's message without the stack traceback Lua appends, and
/// with a host function's failure reduced to its cause.
fn clean(e: &mlua::Error) -> String {
    match e {
        mlua::Error::CallbackError { cause, .. } => clean(cause),
        mlua::Error::RuntimeError(message) => message
            .split("\nstack traceback:")
            .next()
            .unwrap_or_default()
            .trim()
            .to_string(),
        other => other.to_string(),
    }
}

fn function(lua: &mlua::Lua, name: &str, signature: &str) -> Result<mlua::Function> {
    lua.globals()
        .get(name)
        .map_err(|_| anyhow!("script does not define {name}{signature}"))
}

fn call_paged(lua: &mlua::Lua, name: &str, page: u32) -> Result<MangasPage> {
    let f = function(lua, name, "(page)")?;
    let table: Table = sandbox::call_with_timeout(lua, sandbox::CALL_TIMEOUT, || f.call(page))
        .map_err(|e| script_error(e, || format!("{name}({page})")))?;
    read_manga_page(&table)
}

fn call_search(lua: &mlua::Lua, query: &str, page: u32) -> Result<MangasPage> {
    let f = function(lua, "search", "(query, page)")?;
    let table: Table =
        sandbox::call_with_timeout(lua, sandbox::CALL_TIMEOUT, || f.call((query, page)))
            .map_err(|e| script_error(e, || format!("search({query:?}, {page})")))?;
    read_manga_page(&table)
}

/// `manga_details(id)` for a catalogue, `details(id)` for an enrich script:
/// the same shape under the name each kind uses.
fn call_details(lua: &mlua::Lua, name: &str, id: &str) -> Result<MangaDetails> {
    let f = function(lua, name, "(id)")?;
    let table: Table = sandbox::call_with_timeout(lua, sandbox::CALL_TIMEOUT, || f.call(id))
        .map_err(|e| script_error(e, || format!("{name}({id:?})")))?;
    read_manga_details(&table)
}

fn call_volumes(lua: &mlua::Lua, id: &str, language: Option<&str>) -> Result<Vec<VolumeChapters>> {
    let f = function(lua, "volumes", "(id, language)")?;
    let table: Table =
        sandbox::call_with_timeout(lua, sandbox::CALL_TIMEOUT, || f.call((id, language)))
            .map_err(|e| script_error(e, || format!("volumes({id:?}, {language:?})")))?;
    read_volume_chapters(&table)
}

fn call_covers(lua: &mlua::Lua, id: &str) -> Result<Vec<VolumeCover>> {
    let f = function(lua, "covers", "(id)")?;
    let table: Table = sandbox::call_with_timeout(lua, sandbox::CALL_TIMEOUT, || f.call(id))
        .map_err(|e| script_error(e, || format!("covers({id:?})")))?;
    read_volume_covers(&table)
}

fn call_chapters(lua: &mlua::Lua, id: &str) -> Result<Vec<ChapterRef>> {
    let f = function(lua, "chapters", "(manga_id)")?;
    let table: Table = sandbox::call_with_timeout(lua, sandbox::CALL_TIMEOUT, || f.call(id))
        .map_err(|e| script_error(e, || format!("chapters({id:?})")))?;
    read_chapter_refs(&table)
}

/// An enrich script's `search` + `details`, composed into one answer: the
/// first hit's details, or `None` when the search found nothing.
fn call_lookup(lua: &mlua::Lua, title: &str) -> Result<Option<MangaDetails>> {
    let Some(first) = call_search(lua, title, 1)?.manga.into_iter().next() else {
        return Ok(None);
    };
    let mut details = call_details(lua, "details", &first.id)?;
    if details.cover_url.is_none() {
        details.cover_url = first.cover_url;
    }
    Ok(Some(details))
}

fn call_page_list(lua: &mlua::Lua, chapter_id: &str) -> Result<Vec<String>> {
    let f = function(lua, "page_list", "(chapter_id)")?;
    let table: Table =
        sandbox::call_with_timeout(lua, sandbox::CALL_TIMEOUT, || f.call(chapter_id))
            .map_err(|e| script_error(e, || format!("page_list({chapter_id:?})")))?;
    read_strings(&table)
}

/* ------------------------------------------------------- Lua -> Rust shapes */

fn read_manga_page(table: &Table) -> Result<MangasPage> {
    let rows: Table = table
        .get("manga")
        .map_err(|_| anyhow!("expected a `manga` array"))?;
    let has_next_page: bool = table.get("has_next_page").unwrap_or(false);

    let mut manga = Vec::with_capacity(rows.raw_len());
    for pair in rows.sequence_values::<Table>() {
        let row = pair.map_err(|e| anyhow!("reading a manga entry: {e}"))?;
        manga.push(MangaSummary {
            id: row
                .get("id")
                .map_err(|_| anyhow!("a manga entry is missing `id`"))?,
            title: row
                .get("title")
                .map_err(|_| anyhow!("a manga entry is missing `title`"))?,
            cover_url: row.get("cover_url").unwrap_or(None),
        });
    }
    Ok(MangasPage {
        manga,
        has_next_page,
    })
}

fn read_manga_details(table: &Table) -> Result<MangaDetails> {
    Ok(MangaDetails {
        title: table
            .get("title")
            .map_err(|_| anyhow!("details are missing `title`"))?,
        title_romaji: table.get("title_romaji").unwrap_or(None),
        title_native: table.get("title_native").unwrap_or(None),
        author: table.get("author").unwrap_or(None),
        artist: table.get("artist").unwrap_or(None),
        description: table.get("description").unwrap_or(None),
        tags: table
            .get::<Option<Table>>("tags")
            .unwrap_or(None)
            .map(|t| read_strings(&t))
            .transpose()?
            .unwrap_or_default(),
        content_rating: table.get("content_rating").unwrap_or(None),
        available_languages: table
            .get::<Option<Table>>("available_languages")
            .unwrap_or(None)
            .map(|t| read_strings(&t))
            .transpose()?
            .unwrap_or_default(),
        cover_url: table.get("cover_url").unwrap_or(None),
    })
}

fn read_chapter_refs(table: &Table) -> Result<Vec<ChapterRef>> {
    let mut chapters = Vec::with_capacity(table.raw_len());
    for pair in table.clone().sequence_values::<Table>() {
        let c = pair.map_err(|e| anyhow!("reading a chapter entry: {e}"))?;
        chapters.push(ChapterRef {
            number: c
                .get("number")
                .map_err(|_| anyhow!("a chapter entry is missing `number`"))?,
            id: c.get("id").unwrap_or(None),
            unavailable: c.get("unavailable").unwrap_or(false),
        });
    }
    Ok(chapters)
}

fn read_volume_chapters(table: &Table) -> Result<Vec<VolumeChapters>> {
    let mut volumes = Vec::with_capacity(table.raw_len());
    for pair in table.clone().sequence_values::<Table>() {
        let row = pair.map_err(|e| anyhow!("reading a volume entry: {e}"))?;
        let volume: String = row
            .get("volume")
            .map_err(|_| anyhow!("a volume entry is missing `volume`"))?;
        let chapter_rows: Table = row
            .get("chapters")
            .map_err(|_| anyhow!("volume {volume:?} is missing `chapters`"))?;
        volumes.push(VolumeChapters {
            chapters: read_chapter_refs(&chapter_rows)?,
            volume,
        });
    }
    Ok(volumes)
}

fn read_volume_covers(table: &Table) -> Result<Vec<VolumeCover>> {
    let mut covers = Vec::with_capacity(table.raw_len());
    for pair in table.clone().sequence_values::<Table>() {
        let row = pair.map_err(|e| anyhow!("reading a cover entry: {e}"))?;
        let url: String = row
            .get("url")
            .map_err(|_| anyhow!("a cover entry is missing `url`"))?;
        // A script that has no separate thumbnail can just omit it.
        let thumbnail_url: String = row.get("thumbnail_url").unwrap_or_else(|_| url.clone());
        covers.push(VolumeCover {
            volume: row.get("volume").unwrap_or(None),
            url,
            thumbnail_url,
        });
    }
    Ok(covers)
}

fn read_strings(table: &Table) -> Result<Vec<String>> {
    table
        .clone()
        .sequence_values::<String>()
        .collect::<mlua::Result<Vec<_>>>()
        .map_err(|e| anyhow!("expected an array of strings: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(kind: &str) -> String {
        format!(
            r#"SOURCE = {{ id = "test.k", name = "K", kind = "{kind}", base_url = "https://k.example" }}"#
        )
    }

    fn script(kind: &str, functions: &[&str]) -> String {
        let mut text = manifest(kind);
        for f in functions {
            text.push_str(&format!("\nfunction {f}() return {{}} end"));
        }
        text
    }

    #[test]
    fn a_script_without_a_kind_is_refused() {
        let text = r#"SOURCE = { id = "test.k", name = "K", base_url = "https://k.example" }
                      function page_list() return {} end"#;
        let err = LuaSource::load(text.into()).err().unwrap();
        assert!(format!("{err:#}").contains("SOURCE.kind is required"));
    }

    #[test]
    fn an_unknown_kind_is_refused() {
        let err = LuaSource::load(script("downloader", &["page_list"]))
            .err()
            .unwrap();
        assert!(format!("{err:#}").contains("not one of"));
    }

    #[test]
    fn a_metadata_script_cannot_serve_pages() {
        let err = check_kind(
            Kind::Metadata,
            &["search", "manga_details", "volumes", "page_list"],
        )
        .unwrap_err();
        assert!(err.to_string().contains("only a reader serves pages"));
    }

    #[test]
    fn an_enrich_script_cannot_list_chapters() {
        let err = check_kind(Kind::Enrich, &["search", "details", "chapters"]).unwrap_err();
        assert!(err.to_string().contains("chapters"));
    }

    #[test]
    fn each_kind_refuses_a_missing_required_function() {
        assert!(check_kind(Kind::Reader, &["search", "chapters"]).is_err());
        assert!(check_kind(Kind::Enrich, &["search"]).is_err());
        assert!(check_kind(Kind::Metadata, &["search", "manga_details"]).is_err());
    }

    #[test]
    fn a_reader_with_only_page_list_loads_as_manual_link_only() {
        let source = LuaSource::load(script("reader", &["page_list"])).unwrap();
        assert!(!source.can_resolve());
        assert!(!source.is_catalogue());
        assert_eq!(source.info().capabilities, vec!["pages"]);
        assert!(source.warnings().is_empty());
    }

    #[test]
    fn half_a_resolution_pair_is_a_warning_not_an_error() {
        let verdict = check_kind(Kind::Reader, &["search", "page_list"]).unwrap();
        assert_eq!(verdict.warnings.len(), 1);
        assert!(verdict.warnings[0].contains("linked by hand"));
    }

    #[test]
    fn foreign_functions_on_a_kind_are_warned_about_and_never_called() {
        let source = LuaSource::load(script("reader", &["page_list", "covers"])).unwrap();
        assert!(source.warnings().iter().any(|w| w.starts_with("covers")));
        // Not a catalogue, so the covers it wrote are unreachable.
        assert!(MetadataSource::covers(&source, "1").is_err());
    }

    #[test]
    fn a_reader_carrying_a_full_catalogue_also_answers_as_one() {
        let source = LuaSource::load(script(
            "reader",
            &[
                "popular",
                "latest",
                "search",
                "manga_details",
                "volumes",
                "covers",
                "page_list",
            ],
        ))
        .unwrap();
        assert!(source.is_catalogue());
        assert!(source.can_resolve(), "volumes stands in for chapters");
        assert!(source.warnings().is_empty());
        assert_eq!(
            source.info().capabilities,
            vec!["search", "chapters", "pages", "catalogue"]
        );
    }

    #[test]
    fn a_metadata_source_refuses_page_calls_even_through_the_concrete_type() {
        let source =
            LuaSource::load(script("metadata", &["search", "manga_details", "volumes"])).unwrap();
        let err = ReaderSource::page_list(&source, "c1").unwrap_err();
        assert!(err.to_string().contains("cannot serve pages"));
    }

    #[test]
    fn the_manifest_carries_its_descriptive_fields() {
        let text = r#"SOURCE = { id = "test.k", name = "K", kind = "enrich", lang = "pt",
                        base_url = "https://k.example", mirrors = { "https://cdn.k.example" },
                        description = "Synopses only.", api = 1, nsfw = true }
                      function search() return { manga = {} } end
                      function details() return { title = "x" } end"#;
        let source = LuaSource::load(text.into()).unwrap();
        let info = source.info();
        assert_eq!(info.kind, Kind::Enrich);
        assert_eq!(info.lang, "pt");
        assert_eq!(info.mirrors, vec!["https://cdn.k.example"]);
        assert_eq!(info.description.as_deref(), Some("Synopses only."));
        assert!(info.nsfw);
        assert_eq!(info.capabilities, vec!["search", "details"]);
    }

    #[test]
    fn a_script_needing_a_newer_host_is_refused_with_that_reason() {
        let text = format!(
            r#"SOURCE = {{ id = "t", name = "t", kind = "reader", base_url = "https://t.example",
                           api = {} }}
               function page_list() return {{}} end"#,
            API_LEVEL + 1
        );
        let err = LuaSource::load(text).err().unwrap();
        assert!(format!("{err:#}").contains("update Leaf"));
    }

    #[test]
    fn a_script_raised_error_reaches_the_user_as_written() {
        let text = r#"SOURCE = { id = "t", name = "t", kind = "reader", base_url = "https://t.example" }
                      function page_list(id)
                        error("licensed; published at https://publisher.example/c/" .. id, 0)
                      end"#;
        let source = LuaSource::load(text.into()).unwrap();
        let err = ReaderSource::page_list(&source, "7").unwrap_err().to_string();
        // Nothing after the URL — the reader turns a trailing URL into a button.
        assert_eq!(err, "licensed; published at https://publisher.example/c/7");
    }

    #[test]
    fn a_script_error_points_at_the_script_not_the_host() {
        let text = r#"SOURCE = { id = "t", name = "t", kind = "reader", base_url = "https://t.example" }
                      function page_list(id)
                        local missing = nil
                        return missing.field
                      end"#;
        let source = LuaSource::load(text.into()).unwrap();
        let err = ReaderSource::page_list(&source, "7").unwrap_err().to_string();
        assert!(err.starts_with("script:4:"), "{err}");
        assert!(!err.contains("stack traceback"), "{err}");
        assert!(!err.contains(".rs"), "{err}");
    }

    #[test]
    fn an_enrich_lookup_finding_nothing_is_none() {
        let text = r#"SOURCE = { id = "t", name = "t", kind = "enrich", base_url = "https://t.example" }
                      function search() return { manga = {} } end
                      function details() return { title = "never" } end"#;
        let source = LuaSource::load(text.into()).unwrap();
        assert!(source.lookup("anything").unwrap().is_none());
    }
}
