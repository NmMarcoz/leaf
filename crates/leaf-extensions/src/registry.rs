//! Where every known [`Source`] lives, looked up by its stable id.
//!
//! This is what replaces the `match "mangadex" | "kitsu"` that used to be
//! scattered across `src-tauri/src/library.rs` and `src-tauri/src/fetch.rs` —
//! `series.source` already stores a source id as free text, so adding a new
//! source only ever means registering it here, never touching a match arm.

use std::path::Path;
use std::sync::Arc;

use sha2::{Digest, Sha256};

use crate::lua::LuaSource;
use crate::native;
use crate::types::{Source, SourceInfo};

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

pub struct Registry {
    sources: Vec<(String, Arc<dyn Source>)>,
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
    /// MangaDex only, today. Kitsu is deliberately absent — see the crate
    /// root doc for why a source that cannot list chapters has no business
    /// being registered as one.
    pub fn load_builtin() -> Self {
        let mangadex: Arc<dyn Source> = Arc::new(native::mangadex::MangaDexSource::default());
        Self {
            sources: vec![(mangadex.info().id.clone(), mangadex)],
        }
    }

    /// Load every `.lua` file directly inside `dir` as a user-supplied source.
    ///
    /// Returns one error per file that failed to load rather than stopping at
    /// the first one — a typo in one source must not hide every other.
    pub fn load_user_extensions(&mut self, dir: &Path) -> Vec<(std::path::PathBuf, anyhow::Error)> {
        let mut failures = Vec::new();
        let Ok(entries) = std::fs::read_dir(dir) else {
            return failures; // No extensions folder yet is not an error.
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("lua") {
                continue;
            }
            let result = std::fs::read_to_string(&path)
                .map_err(anyhow::Error::from)
                .and_then(LuaSource::load);
            match result {
                Ok(source) => {
                    let source: Arc<dyn Source> = Arc::new(source);
                    self.sources.push((source.info().id.clone(), source));
                }
                Err(e) => failures.push((path, e)),
            }
        }
        failures
    }

    /// [`Self::load_user_extensions`] behind a trust gate: a script whose
    /// fingerprint the user has not approved is *not registered* — it is
    /// returned as pending so the front end can show what it is (name, id,
    /// base_url, fingerprint) and ask.
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
    /// reach, but only a human can notice that a file named `mangataro.lua`
    /// wants `base_url = http://evil.example`.
    ///
    /// Builtins never pass through the gate; they ship signed with the app.
    pub fn load_governed_extensions(
        &mut self,
        dir: &Path,
        approved: &[String],
        dev_files: &[String],
    ) -> (
        Vec<(std::path::PathBuf, anyhow::Error)>,
        Vec<PendingExtension>,
    ) {
        let mut failures = Vec::new();
        let mut pending = Vec::new();
        let Ok(entries) = std::fs::read_dir(dir) else {
            return (failures, pending); // No extensions folder yet is not an error.
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("lua") {
                continue;
            }
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
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
                    let source: Arc<dyn Source> = Arc::new(source);
                    if dev_files.contains(&name) || approved.contains(&fingerprint) {
                        self.sources.push((source.info().id.clone(), source));
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

    pub fn get(&self, id: &str) -> Option<Arc<dyn Source>> {
        self.sources
            .iter()
            .find(|(sid, _)| sid == id)
            .map(|(_, source)| source.clone())
    }

    pub fn all(&self) -> Vec<SourceInfo> {
        self.sources.iter().map(|(_, s)| s.info().clone()).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mangadex_is_registered_by_default() {
        let registry = Registry::load_builtin();
        assert!(registry.get(native::mangadex::ID).is_some());
        assert_eq!(registry.all().len(), 1);
    }

    #[test]
    fn an_unknown_id_is_not_found() {
        assert!(Registry::load_builtin().get("nothing.here").is_none());
    }

    #[test]
    fn a_missing_extensions_folder_yields_no_failures() {
        let mut registry = Registry::load_builtin();
        let failures = registry.load_user_extensions(Path::new("/nonexistent/leaf-test-dir"));
        assert!(failures.is_empty());
    }

    /// The whole manifest, minus the body functions, is enough to load.
    fn stub_script(name: &str) -> String {
        format!(
            r#"SOURCE = {{ id = "test.{name}", name = "{name}", lang = "en",
                 base_url = "https://{name}.example" }}"#
        )
    }

    #[test]
    fn an_unapproved_script_stays_pending_instead_of_registering() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("stranger.lua"), stub_script("stranger")).unwrap();

        let mut registry = Registry::load_builtin();
        let (failures, pending) = registry.load_governed_extensions(dir.path(), &[], &[]);
        assert!(failures.is_empty());
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].info.id, "test.stranger");
        // Not usable as a source until approved.
        assert!(registry.get("test.stranger").is_none());

        // Approving by the fingerprint it was shown with registers it...
        let fingerprint = Registry::fingerprint(&stub_script("stranger"));
        assert_eq!(fingerprint, pending[0].fingerprint);
        let mut registry = Registry::load_builtin();
        let (_, still) =
            registry.load_governed_extensions(dir.path(), std::slice::from_ref(&fingerprint), &[]);
        assert!(still.is_empty());
        assert!(registry.get("test.stranger").is_some());

        // ...and one edited byte changes the fingerprint, which puts the new
        // content back at the gate under the same filename.
        std::fs::write(dir.path().join("stranger.lua"), stub_script("stranger2")).unwrap();
        let mut registry = Registry::load_builtin();
        let (_, pending) = registry.load_governed_extensions(dir.path(), &[fingerprint], &[]);
        assert_eq!(pending.len(), 1);
        assert!(registry.get("test.stranger").is_none());
    }

    #[test]
    fn a_dev_file_bypasses_the_gate_until_its_content_is_locked() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("wip.lua"), stub_script("wip1")).unwrap();

        // Dev mode: the file runs whatever its current bytes are — this is the
        // save-forty-times loop the strict fingerprint would make unusable.
        let mut registry = Registry::load_builtin();
        let (_, pending) =
            registry.load_governed_extensions(dir.path(), &[], &["wip.lua".to_string()]);
        assert!(pending.is_empty());
        assert!(registry.get("test.wip1").is_some());

        std::fs::write(dir.path().join("wip.lua"), stub_script("wip2")).unwrap();
        let mut registry = Registry::load_builtin();
        registry.load_governed_extensions(dir.path(), &[], &["wip.lua".to_string()]);
        assert!(registry.get("test.wip2").is_some());

        // Locking (the front end records the current fingerprint and drops
        // the file from the dev list) hands control back to the byte lock.
        let locked = Registry::fingerprint(&stub_script("wip2"));
        std::fs::write(dir.path().join("wip.lua"), stub_script("wip3")).unwrap();
        let mut registry = Registry::load_builtin();
        let (_, pending) = registry.load_governed_extensions(dir.path(), &[locked], &[]);
        assert_eq!(pending.len(), 1);
        assert!(registry.get("test.wip3").is_none());
    }

    #[test]
    fn a_broken_script_is_a_failure_at_the_gate_not_a_pending_one() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("typo.lua"), "SOURCE = {").unwrap();
        let mut registry = Registry::load_builtin();
        let (failures, pending) = registry.load_governed_extensions(dir.path(), &[], &[]);
        assert_eq!(failures.len(), 1);
        assert!(pending.is_empty());
    }
}
