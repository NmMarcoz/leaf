//! Commands for registered `Source`s — built-in beyond MangaDex, and `.lua`
//! extensions — the counterpart to `meta.rs` for anything that isn't the
//! MangaDex/Kitsu pair `leaf_meta::Source` names.
//!
//! A fresh [`Registry`] is built per request, same reasoning as opening the
//! library per request in `library.rs`: it keeps every command a plain
//! blocking job with nothing shared to reason about, and loading a handful of
//! `.lua` files is cheap next to the SQLite/HTTP work each command already does.

use anyhow::{anyhow, Result};
use leaf_extensions::{MangaDetails, MangasPage, Registry, Source as _, SourceInfo};
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
    let (_failures, _pending) = registry.load_governed_extensions(
        &root.join("extensions"),
        &settings.approved_extensions,
        &settings.dev_extensions,
    );
    Ok(registry)
}

/// The extension folder as the gate sees it: what is waiting for approval,
/// and what the user marked as in development (registered, no byte lock —
/// ready to lock when it is finished).
#[derive(serde::Serialize)]
pub struct ExtensionReview {
    pub pending: Vec<PendingInfo>,
    pub dev: Vec<DevInfo>,
}

/// One extension the user is developing: current facts, so the panel can
/// show what locking would freeze.
#[derive(serde::Serialize)]
pub struct DevInfo {
    pub file: String,
    pub fingerprint: String,
    #[serde(flatten)]
    pub info: SourceInfo,
}

/// What `load_registry` left at the gate: every extension file that loads
/// successfully but is neither approved nor in development, with the facts
/// the user needs to decide (name, id, base_url, fingerprint).
#[tauri::command]
pub async fn review_extensions(app: AppHandle) -> Result<ExtensionReview, String> {
    blocking(move || {
        let root = settings::library_root(&app)?;
        let settings = settings::load(&app)?;
        let mut registry = Registry::load_builtin();
        let (_failures, pending) = registry.load_governed_extensions(
            &root.join("extensions"),
            &settings.approved_extensions,
            &settings.dev_extensions,
        );

        // Dev files are registered, so they never appear in `pending` — read
        // the same folder again for the ones that are, matching by name.
        let dev_dir = root.join("extensions");
        let mut dev = Vec::new();
        for name in &settings.dev_extensions {
            let path = dev_dir.join(name);
            let Ok(text) = std::fs::read_to_string(&path) else {
                continue; // Deleted since it was flagged dev.
            };
            let fingerprint = Registry::fingerprint(&text);
            if let Ok(source) = leaf_extensions::lua::LuaSource::load(text) {
                dev.push(DevInfo {
                    file: name.clone(),
                    fingerprint,
                    info: source.info().clone(),
                });
            }
        }

        Ok(ExtensionReview {
            pending: pending
                .into_iter()
                .map(|p| PendingInfo {
                    file: p
                        .path
                        .file_name()
                        .map(|n| n.to_string_lossy().into_owned())
                        .unwrap_or_default(),
                    fingerprint: p.fingerprint,
                    info: p.info,
                })
                .collect(),
            dev,
        })
    })
    .await
}

/// One pending extension as the frontend sees it — `PendingExtension` minus
/// the path, which is the user's filesystem and has no business crossing IPC.
#[derive(serde::Serialize)]
pub struct PendingInfo {
    pub file: String,
    pub fingerprint: String,
    #[serde(flatten)]
    pub info: SourceInfo,
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

/// Add a series found through a registered source, then pull its layout —
/// the `add_series_from_source` counterpart to `library::library_add_series`.
///
/// `fallback_title` is the title already on hand from the catalogue listing
/// this series was picked from — used only if the source's own detail page
/// fails, or leaves a field blank; see `MangaDetails::best_effort`.
#[tauri::command]
pub async fn add_series_from_source(
    app: AppHandle,
    source: String,
    external_id: String,
    fallback_title: String,
) -> Result<Series, String> {
    blocking(move || {
        let registry = load_registry(&app)?;
        let ext_source = registry
            .get(&source)
            .ok_or_else(|| anyhow!("{source:?} is not a registered source"))?;
        let details: MangaDetails =
            MangaDetails::best_effort(ext_source.as_ref(), &external_id, &fallback_title);

        let mut library = Library::open(settings::library_root(&app)?)?;
        let added = library.add_series(NewSeries {
            source: Some(source.clone()),
            source_id: Some(external_id.clone()),
            title: details.title,
            title_romaji: details.title_romaji,
            title_native: details.title_native,
            author: details.author.unwrap_or_default(),
            artist: details.artist.unwrap_or_default(),
            description: details.description.unwrap_or_default(),
            year: None,
            status: None,
            site_url: None,
            tags: details.tags,
            content_rating: details.content_rating,
        })?;

        // Best effort from here, same as `library_add_series`: a series with
        // no layout yet is recoverable with Refresh, a failed add is not.
        let _ = pull_layout(
            &mut library,
            added.id,
            ext_source.as_ref(),
            &external_id,
            &added.title,
        );
        if let Some(url) = details.cover_url {
            if let Ok(bytes) = leaf_meta::download_image(&url) {
                let _ = library.set_cover(added.id, &bytes);
            }
        }

        library.series(added.id)
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
