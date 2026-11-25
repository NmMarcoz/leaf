//! The `sources` subcommands.
//!
//! A way to exercise a source — built-in or a `.lua` script under development
//! — from a terminal, the same reasoning as the `library` subcommands: it is
//! much the fastest way to find out a script's `SOURCE.base_url`/selectors are
//! wrong, without launching the desktop app.
//!
//! `verify` is also what an extension repository's CI runs: it loads each
//! script through the real sandbox, without touching the network, and checks
//! it against the folder it sits in. `--json` prints the manifests an index
//! generator needs, so the generator never has to parse Lua itself.
//!
//! The CLI is ungated, as it always was: it is the user's own terminal
//! running the user's own files. `repo install` still only writes files —
//! the desktop app will show them pending like anything else.

use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use clap::Subcommand;
use leaf_extensions::lua::LuaSource;
use leaf_extensions::repo::{self, RepoStatus};
use leaf_extensions::{EnrichSource, Kind, MetadataSource, ReaderSource, Registry};
use serde::Serialize;

#[derive(Subcommand)]
pub enum SourcesCommand {
    /// List every source: built in, and every script in the library's
    /// extensions folder.
    List,
    /// Run a `.lua` source script against one id and print what it returns,
    /// without registering it anywhere. For an enrich script the id is a
    /// title to look up.
    Test {
        script: PathBuf,
        /// Manga id to look up, in whatever form the source expects.
        id: String,
        /// Also print the source's popular list, page 1 (catalogues only).
        #[arg(long)]
        popular: bool,
    },
    /// Load scripts through the sandbox without calling them, and check each
    /// one's kind against the folder it sits in (`metadata/`, `enrich/`,
    /// `readers/`). Exits non-zero if any fails.
    Verify {
        /// Script files, or folders to search for `.lua` files.
        paths: Vec<PathBuf>,
        /// Print every manifest as JSON on stdout.
        #[arg(long)]
        json: bool,
    },
    /// Browse or install from an extension repository.
    Repo {
        #[command(subcommand)]
        command: RepoCommand,
    },
}

#[derive(Subcommand)]
pub enum RepoCommand {
    /// List a repository's scripts against the extensions folder.
    Browse {
        /// The repository's address: its `index.json`, or the folder holding it.
        url: String,
    },
    /// Download scripts into the extensions folder, verifying each against
    /// the repository's index.
    Install {
        url: String,
        /// Source ids to install; none with `--all` installs everything not
        /// yet up to date.
        ids: Vec<String>,
        #[arg(long)]
        all: bool,
    },
}

pub fn run(library: Option<PathBuf>, command: SourcesCommand) -> Result<()> {
    match command {
        SourcesCommand::List => list(&extensions_dir(library)?),
        SourcesCommand::Test {
            script,
            id,
            popular,
        } => test(&script, &id, popular),
        SourcesCommand::Verify { paths, json } => verify(&paths, json),
        SourcesCommand::Repo { command } => match command {
            RepoCommand::Browse { url } => repo_browse(&extensions_dir(library)?, &url),
            RepoCommand::Install { url, ids, all } => {
                repo_install(&extensions_dir(library)?, &url, &ids, all)
            }
        },
    }
}

fn extensions_dir(library: Option<PathBuf>) -> Result<PathBuf> {
    Ok(crate::library::resolve_root(library)?.join("extensions"))
}

fn list(dir: &Path) -> Result<()> {
    let mut registry = Registry::load_builtin();
    for (path, e) in registry.load_user_extensions(dir) {
        eprintln!("warning: {} failed to load: {e:#}", path.display());
    }
    for info in registry.all() {
        println!(
            "{:<24} {:<9} {:<24} {}",
            info.id, info.kind, info.name, info.lang
        );
    }
    Ok(())
}

fn test(script: &Path, id: &str, popular: bool) -> Result<()> {
    let text =
        std::fs::read_to_string(script).with_context(|| format!("reading {}", script.display()))?;
    let source = LuaSource::load(text).context("loading the source script")?;
    let info = source.info();

    println!("id       {}", info.id);
    println!("name     {}", info.name);
    println!("kind     {}", info.kind);
    println!("lang     {}", info.lang);
    println!("base_url {}", info.base_url);
    if !info.mirrors.is_empty() {
        println!("mirrors  {}", info.mirrors.join(", "));
    }
    println!("can      {}", info.capabilities.join(", "));
    for warning in source.warnings() {
        println!("warning  {warning}");
    }
    println!();

    if info.kind == Kind::Enrich {
        match source.lookup(id).context("lookup")? {
            Some(details) => {
                println!("title    {}", details.title);
                if let Some(author) = &details.author {
                    println!("author   {author}");
                }
                println!("tags     {}", details.tags.join(", "));
            }
            None => println!("no match for {id:?}"),
        }
        return Ok(());
    }

    if source.is_catalogue() {
        if popular {
            let page = MetadataSource::popular(&source, 1).context("popular(1)")?;
            println!(
                "popular  {} results, has_next_page={}",
                page.manga.len(),
                page.has_next_page
            );
            for m in &page.manga {
                println!("  {:<20} {}", m.id, m.title);
            }
            println!();
        }

        let details = MetadataSource::manga_details(&source, id).context("manga_details")?;
        println!("title    {}", details.title);
        if let Some(author) = &details.author {
            println!("author   {author}");
        }
        println!("tags     {}", details.tags.join(", "));

        let volumes = MetadataSource::volumes(&source, id, None).context("volumes")?;
        println!("volumes  {}", volumes.len());
        for v in &volumes {
            println!("  volume {:<4} {} chapters", v.volume, v.chapters.len());
        }
        let covers = MetadataSource::covers(&source, id).context("covers")?;
        println!("covers   {}", covers.len());
    }

    if info.kind == Kind::Reader && source.can_resolve() {
        let chapters = ReaderSource::chapters(&source, id).context("chapters")?;
        println!("chapters {}", chapters.len());
        if let Some(first) = chapters.iter().find(|c| c.id.is_some()) {
            let chapter_id = first.id.as_deref().unwrap_or_default();
            let pages = ReaderSource::page_list(&source, chapter_id).context("page_list")?;
            println!("chapter {} has {} pages", first.number, pages.len());
        }
    } else if info.kind == Kind::Reader {
        // Manual-link only: the id given is a chapter id.
        let pages = ReaderSource::page_list(&source, id).context("page_list")?;
        println!("chapter {id} has {} pages", pages.len());
    }

    Ok(())
}

/// One verified script, as `verify --json` prints it.
#[derive(Serialize)]
struct Verified {
    file: String,
    sha256: String,
    #[serde(flatten)]
    info: leaf_extensions::SourceInfo,
    warnings: Vec<String>,
}

fn verify(paths: &[PathBuf], json: bool) -> Result<()> {
    let mut files = Vec::new();
    for path in paths {
        collect_lua(path, &mut files)?;
    }
    files.sort();
    if files.is_empty() {
        bail!("no .lua files found");
    }

    let mut verified = Vec::new();
    let mut failed = 0usize;
    for file in &files {
        match verify_one(file) {
            Ok(v) => {
                if !json {
                    println!(
                        "ok       {} ({}, {})",
                        file.display(),
                        v.info.id,
                        v.info.kind
                    );
                }
                for warning in &v.warnings {
                    eprintln!("warning  {}: {warning}", file.display());
                }
                verified.push(v);
            }
            Err(e) => {
                failed += 1;
                eprintln!("FAIL     {}: {e:#}", file.display());
            }
        }
    }

    // Two scripts claiming one id would fight over it in every library that
    // installs both.
    let mut ids: Vec<&str> = verified.iter().map(|v| v.info.id.as_str()).collect();
    ids.sort_unstable();
    for pair in ids.windows(2) {
        if pair[0] == pair[1] {
            failed += 1;
            eprintln!(
                "FAIL     id {:?} is declared by more than one script",
                pair[0]
            );
        }
    }

    if json {
        println!("{}", serde_json::to_string_pretty(&verified)?);
    }
    if failed > 0 {
        bail!("{failed} of {} scripts failed verification", files.len());
    }
    Ok(())
}

fn collect_lua(path: &Path, files: &mut Vec<PathBuf>) -> Result<()> {
    if path.is_dir() {
        for entry in
            std::fs::read_dir(path).with_context(|| format!("reading {}", path.display()))?
        {
            collect_lua(&entry?.path(), files)?;
        }
    } else if path.extension().and_then(|e| e.to_str()) == Some("lua") {
        files.push(path.to_path_buf());
    }
    Ok(())
}

fn verify_one(file: &Path) -> Result<Verified> {
    let text = std::fs::read_to_string(file).context("reading")?;
    let sha256 = Registry::fingerprint(&text);
    let source = LuaSource::load(text)?;
    let info = source.info().clone();

    let folder = file
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .unwrap_or_default();
    let expected = match folder {
        "metadata" => Some(Kind::Metadata),
        "enrich" => Some(Kind::Enrich),
        "readers" => Some(Kind::Reader),
        _ => None,
    };
    if let Some(expected) = expected {
        if expected != info.kind {
            bail!(
                "declares kind {} but sits in {folder}/, which holds {expected} sources",
                info.kind
            );
        }
    }

    Ok(Verified {
        file: file.display().to_string(),
        sha256,
        warnings: source.warnings().to_vec(),
        info,
    })
}

fn repo_browse(dir: &Path, url: &str) -> Result<()> {
    let fetched = repo::fetch_index(url)?;
    if let Some(name) = &fetched.index.name {
        println!("{name}");
    }
    println!("{}\n", fetched.url);
    let rows = repo::browse(dir, &fetched.index, &Default::default());
    for row in &rows {
        let status = match row.status {
            RepoStatus::NotInstalled => "",
            RepoStatus::Installed => "installed",
            RepoStatus::UpdateAvailable => "update",
            RepoStatus::Incompatible => "needs newer Leaf",
        };
        println!(
            "{:<24} {:<9} {:<4} {:<24} {:<10} {}",
            row.script.id,
            row.script.kind,
            row.script.lang,
            row.script.name,
            row.script.version,
            status
        );
    }
    if fetched.skipped > 0 {
        println!(
            "\n{} entries skipped: this Leaf does not understand them",
            fetched.skipped
        );
    }
    Ok(())
}

fn repo_install(dir: &Path, url: &str, ids: &[String], all: bool) -> Result<()> {
    if ids.is_empty() && !all {
        bail!("name the source ids to install, or pass --all");
    }
    let fetched = repo::fetch_index(url)?;
    let rows = repo::browse(dir, &fetched.index, &Default::default());

    for id in ids {
        if !rows.iter().any(|r| &r.script.id == id) {
            bail!("{id:?} is not in this repository");
        }
    }
    let wanted = rows.iter().filter(|r| {
        if all {
            matches!(
                r.status,
                RepoStatus::NotInstalled | RepoStatus::UpdateAvailable
            )
        } else {
            ids.contains(&r.script.id)
        }
    });

    let mut failures = 0usize;
    for row in wanted {
        match repo::install(dir, &fetched.url, &row.script) {
            Ok(name) => println!("installed {} as {name}", row.script.id),
            Err(e) => {
                failures += 1;
                eprintln!("failed    {}: {e:#}", row.script.id);
            }
        }
    }
    if failures > 0 {
        bail!("{failures} scripts were not installed");
    }
    Ok(())
}
