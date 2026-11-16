//! Commands for registered `Source`s — built-in beyond MangaDex, and `.lua`
//! extensions — the counterpart to `meta.rs` for anything that isn't the
//! MangaDex/Kitsu pair `leaf_meta::Source` names.
//!
//! A fresh [`Registry`] is built per request, same reasoning as opening the
//! library per request in `library.rs`: it keeps every command a plain
//! blocking job with nothing shared to reason about, and loading a handful of
//! `.lua` files is cheap next to the SQLite/HTTP work each command already does.

use anyhow::{anyhow, Result};
use leaf_extensions::{MangaDetails, MangasPage, Registry, SourceInfo, UserScript};
use leaf_library::model::{NewSeries, PublishedChapter, PublishedVolume};
use leaf_library::{Library, Series, SeriesId};
use leaf_meta::VolumeChapters;
use tauri::AppHandle;

use crate::settings;
use crate::util::blocking;

/// Built-in sources plus every **approved** `.lua` file under
/// `<library>/extensions/` — the same folder the CLI reads, so either front
/// end can point a user's script at one place. A script that fails to load is
/// silently skipped: one broken extension must not make every other source
/// command unusable, and there is no user-facing surface here yet to show a
/// per-script warning on (unlike the CLI's stderr).
///
/// An extension that loads fine but whose fingerprint is not in settings is
/// *pending*, not registered — see `pending_extensions` / `approve_extension`.
/// Loading a stranger's Lua gives their code an HTTP client on the user's
/// network; the net guard bounds where it can reach, and the gate lets the
/// user notice *what* they are turning on before they do.
pub fn load_registry(app: &AppHandle) -> Result<Registry> {
    let root = settings::library_root(app)?;
    let settings = settings::load(app)?;
    let mut registry = Registry::load_builtin();
    let governance = governance(&settings);
    let (_failures, _pending) =
        registry.load_governed_extensions(&root.join("extensions"), &governance);
    Ok(registry)
}

/// The three trust lists as the registry wants them.
fn governance(s: &settings::Settings) -> leaf_extensions::Governance<'_> {
    leaf_extensions::Governance {
        approved: &s.approved_extensions,
        dev_files: &s.dev_extensions,
        disabled: &s.disabled_extensions,
    }
}

/// Every `.lua` file in the extensions folder, with its state against the
/// gate — the list the Extensions panel renders. Unlike `load_registry` this
/// builds no source anyone will use; it answers "what is in there, and what
/// do I need to do about it?".
#[tauri::command]
pub async fn list_extensions(app: AppHandle) -> Result<Vec<UserScript>, String> {
    blocking(move || {
        let root = settings::library_root(&app)?;
        let settings = settings::load(&app)?;
        Ok(Registry::survey(
            &root.join("extensions"),
            &governance(&settings),
        ))
    })
    .await
}

/// Validate a name the UI supplied for something inside the extensions
/// folder. The folder is the user's and the name came over IPC, so nothing
/// may escape it or name a non-script.
fn extension_name(file: &str) -> Result<(), anyhow::Error> {
    let path = std::path::Path::new(file);
    let plain = path.file_name().map(|n| n == std::ffi::OsStr::new(file)) == Some(true);
    if !plain || path.extension().and_then(|e| e.to_str()) != Some("lua") {
        return Err(anyhow!("{file:?} is not an extension file"));
    }
    Ok(())
}

/// Copy a script the user picked (from the file dialog, so a real path
/// anywhere) into the extensions folder.
///
/// `as_name` renames on the way in — how "Update" overwrites an existing
/// entry with a newer file the author sent under some download name. With
/// `None` the file keeps its own name.
///
/// Copying in does not enable: the new bytes are unapproved, so the row
/// lands as pending (or stays dev if that file was already in dev — its
/// next save is this save). No path from a dialog click to code running
/// without the gate having said something first.
#[tauri::command]
pub async fn install_extension(
    app: AppHandle,
    source_path: String,
    as_name: Option<String>,
) -> Result<String, String> {
    blocking(move || {
        let source = std::path::Path::new(&source_path);
        if source.extension().and_then(|e| e.to_str()) != Some("lua") {
            return Err(anyhow!("choose a .lua file"));
        }
        // Read through the registry's own loader before saving: a file that
        // will not parse is rejected here rather than landing in the folder
        // as another broken row.
        let text = std::fs::read_to_string(source)
            .map_err(|e| anyhow!("reading {}: {e}", source.display()))?;
        leaf_extensions::lua::LuaSource::load(text.clone())
            .map_err(|e| anyhow!("that file is not a working extension: {e:#}"))?;

        let name = match &as_name {
            Some(name) => {
                extension_name(name)?;
                name.clone()
            }
            None => source
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .ok_or_else(|| anyhow!("picked file has no name"))?,
        };

        let root = settings::library_root(&app)?;
        let dest_dir = root.join("extensions");
        std::fs::create_dir_all(&dest_dir)?;
        std::fs::write(dest_dir.join(&name), text).map_err(|e| anyhow!("writing {name}: {e}"))?;
        Ok(name)
    })
    .await
}

/// Switch an extension off (or back on). Off files are skipped before
/// loading: no VM, no pending nag, no source in any picker.
#[tauri::command]
pub async fn set_extension_enabled(
    app: AppHandle,
    file: String,
    enabled: bool,
) -> Result<(), String> {
    blocking(move || {
        extension_name(&file)?;
        let mut settings = settings::load(&app)?;
        let named = settings.disabled_extensions.iter().any(|f| f == &file);
        if enabled && named {
            settings.disabled_extensions.retain(|f| f != &file);
        } else if !enabled && !named {
            settings.disabled_extensions.push(file);
        } else {
            return Ok(());
        }
        settings::save(&app, &settings)
    })
    .await
}

/// Delete the script file and forget every trust claim about it.
///
/// Fingerprints stay: they are content hashes, and an identical copy of an
/// approved script elsewhere should not need re-approving for the deletion
/// of one copy. The name-keyed lists must go, though — a new file reusing
/// the name of a removed extension must not inherit its dev mode or read
/// "disabled" with no visible row to re-enable.
#[tauri::command]
pub async fn remove_extension(app: AppHandle, file: String) -> Result<(), String> {
    blocking(move || {
        extension_name(&file)?;
        let root = settings::library_root(&app)?;
        let path = root.join("extensions").join(&file);
        // `remove_file` on a path that was validated to be a plain name
        // inside the extensions folder; never recursive, never a directory.
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| anyhow!("removing {file}: {e}"))?;
        }
        let mut settings = settings::load(&app)?;
        settings.dev_extensions.retain(|f| f != &file);
        settings.disabled_extensions.retain(|f| f != &file);
        settings::save(&app, &settings)
    })
    .await
}

/// Approve one extension by fingerprint. Approval is content-addressed: a
/// later edit changes the fingerprint and puts the script back in the pending
/// list, which is the whole point of not keying it on the filename.
#[tauri::command]
pub async fn approve_extension(app: AppHandle, fingerprint: String) -> Result<(), String> {
    blocking(move || {
        let mut settings = settings::load(&app)?;
        if !settings.approved_extensions.contains(&fingerprint) {
            settings.approved_extensions.push(fingerprint);
            settings::save(&app, &settings)?;
        }
        Ok(())
    })
    .await
}

/// Put one extension file into development mode: registered whatever its
/// bytes are, so saving the script takes effect without re-approval.
#[tauri::command]
pub async fn set_extension_dev(app: AppHandle, file: String, dev: bool) -> Result<(), String> {
    blocking(move || {
        let mut settings = settings::load(&app)?;
        let named = settings.dev_extensions.iter().any(|f| f == &file);
        if dev && !named {
            settings.dev_extensions.push(file);
        } else if !dev {
            settings.dev_extensions.retain(|f| f != &file);
        } else {
            return Ok(());
        }
        settings::save(&app, &settings)
    })
    .await
}

/// Freeze a development extension: the file's current bytes become a real
/// approval and it leaves the dev list — after this, edits re-gate.
///
/// The fingerprint is computed here from the file, not taken from the
/// caller: the UI may only say *which file* to lock, never *what it
/// contains*, or a stale panel could approve bytes its author never showed.
#[tauri::command]
pub async fn lock_extension(app: AppHandle, file: String) -> Result<String, String> {
    blocking(move || {
        let root = settings::library_root(&app)?;
        let path = root.join("extensions").join(&file);
        // Refuse anything that is not a plain `.lua` filename — the folder is
        // the user's and `file` came over IPC.
        let is_plain_name = std::path::Path::new(&file)
            .file_name()
            .map(|n| n == std::ffi::OsStr::new(&file))
            == Some(true);
        if !is_plain_name || path.extension().and_then(|e| e.to_str()) != Some("lua") {
            return Err(anyhow!("{file:?} is not an extension file"));
        }
        let text = std::fs::read_to_string(&path)?;
        let fingerprint = Registry::fingerprint(&text);
        let mut settings = settings::load(&app)?;
        if !settings.approved_extensions.contains(&fingerprint) {
            settings.approved_extensions.push(fingerprint.clone());
        }
        settings.dev_extensions.retain(|f| f != &file);
        settings::save(&app, &settings).map(|_| fingerprint)
    })
    .await
}

/// Every registered source, for an Add-from-source picker.
#[tauri::command]
pub async fn list_sources(app: AppHandle) -> Result<Vec<SourceInfo>, String> {
    blocking(move || Ok(load_registry(&app)?.all())).await
}

/// Search one registered source's own catalogue.
#[tauri::command]
pub async fn search_source(
    app: AppHandle,
    source: String,
    query: String,
    page: u32,
) -> Result<MangasPage, String> {
    blocking(move || {
        let registry = load_registry(&app)?;
        let source = registry
            .get(&source)
            .ok_or_else(|| anyhow!("{source:?} is not a registered source"))?;
        source.search(&query, page)
    })
    .await
}

/// A registered source's most-popular listing, for Explore.
#[tauri::command]
pub async fn popular_source(
    app: AppHandle,
    source: String,
    page: u32,
) -> Result<MangasPage, String> {
    blocking(move || {
        let registry = load_registry(&app)?;
        let source = registry
            .get(&source)
            .ok_or_else(|| anyhow!("{source:?} is not a registered source"))?;
        source.popular(page)
    })
    .await
}

/// A registered source's latest-updates listing, for Explore.
#[tauri::command]
pub async fn latest_source(
    app: AppHandle,
    source: String,
    page: u32,
) -> Result<MangasPage, String> {
    blocking(move || {
        let registry = load_registry(&app)?;
        let source = registry
            .get(&source)
            .ok_or_else(|| anyhow!("{source:?} is not a registered source"))?;
        source.latest(page)
    })
    .await
}

/// A registered source's own detail page for one series — the Explore
/// equivalent of `SeriesModal`'s header, for a source with no MangaDex/Kitsu
/// listing of its own.
#[tauri::command]
pub async fn manga_details_source(
    app: AppHandle,
    source: String,
    external_id: String,
) -> Result<MangaDetails, String> {
    blocking(move || {
        let registry = load_registry(&app)?;
        let source = registry
            .get(&source)
            .ok_or_else(|| anyhow!("{source:?} is not a registered source"))?;
        source.manga_details(&external_id)
    })
    .await
}

/// A registered source's chapter list for one series, for Explore's "read
/// online without adding" path — the same call `pull_layout` makes when
/// actually adding the series, just without writing anything to the library.
#[tauri::command]
pub async fn volumes_source(
    app: AppHandle,
    source: String,
    external_id: String,
) -> Result<Vec<VolumeChapters>, String> {
    blocking(move || {
        let registry = load_registry(&app)?;
        let source = registry
            .get(&source)
            .ok_or_else(|| anyhow!("{source:?} is not a registered source"))?;
        source.volumes(&external_id, None)
    })
    .await
}

/// Add a series found through a registered source.
///
/// Only what the dialog already has — the catalogue listing's title, and the
/// source/ids the click carried — is written before returning; the whole
/// network tail (details, chapter layout, cover) runs as a task on the queue.
/// This command used to be a synchronous waterfall of four to six sequential
/// round-trips behind one button click: five to seven seconds of spinner on
/// a normal day, and twenty-plus when a call hit the timeout. A row that
/// exists and fills in a few seconds later is the same end state with none
/// of the waiting; a failed tail stays recoverable with Refresh, exactly as
/// the old `let _ = pull_layout(...)` made it, except visibly now — the task
/// panel says so.
///
/// `fallback_title` is the title from the catalogue listing, used until the
/// source's own detail page answers (see `MangaDetails::best_effort` in the
/// task, which overwrites it with what it finds).
#[tauri::command]
pub async fn add_series_from_source(
    app: AppHandle,
    source: String,
    external_id: String,
    fallback_title: String,
) -> Result<Series, String> {
    blocking(move || {
        // Only the registry lookup — the one thing that must fail the click
        // itself ("that source does not exist"), and it is disk-and-VM work,
        // not network.
        let registry = load_registry(&app)?;
        if registry.get(&source).is_none() {
            return Err(anyhow!("{source:?} is not a registered source"));
        }

        let mut library = Library::open(settings::library_root(&app)?)?;
        let added = library.add_series(NewSeries {
            source: Some(source.clone()),
            source_id: Some(external_id.clone()),
            title: fallback_title.clone(),
            title_romaji: None,
            title_native: None,
            author: String::new(),
            artist: String::new(),
            description: String::new(),
            year: None,
            status: None,
            site_url: None,
            tags: Vec::new(),
            content_rating: None,
        })?;

        // One-worker queue means this lands behind any download the user
        // already started, which is right: the click asked for the add first.
        let series_id = added.id;
        let label = fallback_title;
        // The task owns its own handle; `enqueue` keeps the one it was given.
        let inside = app.clone();
        crate::tasks::enqueue(&app, "metadata", &label, move |progress| {
            let app = inside;
            if progress.cancelled() {
                return Ok(None);
            }
            progress.step("details and cover", 0, 2);
            let library = Library::open(settings::library_root(&app)?)?;
            let series = library.series(series_id)?;
            // Best effort inside: a blank blurb is recoverable, an
            // errored-out task that deleted nothing is not worse.
            let _ = crate::library::refetch_metadata(&app, &library, &series);

            if progress.cancelled() {
                return Ok(Some("added; layout not pulled — refresh it later".into()));
            }
            progress.step("chapter list", 1, 2);
            let registry = load_registry(&app)?;
            let ext_source = registry
                .get(&source)
                .ok_or_else(|| anyhow!("{source:?} is not a registered source"))?;
            let mut library = Library::open(settings::library_root(&app)?)?;
            let title = library.series(series_id)?.title;
            match pull_layout(&mut library, series_id, ext_source.as_ref(), &external_id, &title) {
                Ok(report) => {
                    progress.step("", 2, 2);
                    Ok(Some(format!(
                        "{} chapters in {} volumes",
                        report.chapters_added, report.volumes
                    )))
                }
                // The series is in the library; only its shelves are empty
                // until Refresh. Saying so beats marking the whole add failed.
                Err(e) => Ok(Some(format!("layout pull failed ({e:#}); use Refresh"))),
            }
        });

        Ok(added)
    })
    .await
}

/// The `leaf_meta::Source`-flavoured `pull_layout` in `library.rs`
/// mirrors this for MangaDex/Kitsu; this is the same shape for any other
/// registered `Source`, plus the best-effort MangaDex volume remap a flat,
/// volume-less source (most scraped sites) needs to organise into anything
/// other than one "Unsorted" bucket. `pub(crate)` rather than a command of its
/// own: `library::library_sync_series` calls this as its fallback when a
/// series' `source` isn't `leaf_meta::Source`, so the app's one Refresh
/// button works for either kind without the frontend needing to know which.
pub(crate) fn pull_layout(
    library: &mut Library,
    id: SeriesId,
    source: &dyn leaf_extensions::Source,
    source_id: &str,
    title: &str,
) -> Result<leaf_library::SyncReport> {
    let mut published = source.volumes(source_id, None)?;
    let mut covers = source.covers(source_id)?;

    if published.len() == 1 && published[0].volume == leaf_library::UNSORTED {
        if let Some((remapped, mangadex_covers)) =
            leaf_meta::mangadex::remap_onto_volumes(title, &published)
        {
            published = remapped;
            // The source's own gallery (if any) has no idea these volume
            // numbers exist, so MangaDex's own covers are the only ones that
            // can actually match them; kept second so a real match from the
            // source's own gallery still wins where one somehow exists.
            for cover in mangadex_covers {
                if !covers.iter().any(|c| c.volume == cover.volume) {
                    covers.push(cover);
                }
            }
        }
    }

    let volumes: Vec<PublishedVolume> = published
        .into_iter()
        .map(|v| PublishedVolume {
            cover_url: covers
                .iter()
                .find(|c| c.volume.as_deref() == Some(v.volume.as_str()))
                .map(|c| c.url.clone()),
            chapters: v
                .chapters
                .into_iter()
                .map(|c| PublishedChapter {
                    number: c.number,
                    title: None,
                    source_id: c.id,
                    unavailable: c.unavailable,
                })
                .collect(),
            number: v.volume,
        })
        .collect();

    library.sync_layout(id, &volumes)
}
