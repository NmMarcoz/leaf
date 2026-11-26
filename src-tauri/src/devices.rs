//! The readers a user owns, and how a built volume reaches each one.
//!
//! A device is two things at once: the build profile a volume is written for
//! (page size, format, greyscale, spreads) and the way the file gets there
//! (mailed to its address, or copied into a folder or a plugged-in reader).
//! One device is the default. Builds start from it and the "Send to" button
//! uses it, so for most people this is a setting they make once.
//!
//! Detection only *looks* at mounted volumes for a reader's marker files. It
//! never mounts, ejects or writes anything but the copied volume.

use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

/// The long edge a device's pages are scaled to when it names no resolution.
/// Matches `Compression::KINDLE`, the default before devices existed.
const DEFAULT_QUALITY: u8 = 85;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Device {
    /// Stable across renames: the default and a queued send refer to this.
    pub id: String,
    pub name: String,
    /// `kindle`, `kobo`, `boox` or `other`. Decides which marker files mean
    /// "this reader is plugged in", and where on it a volume goes.
    pub kind: String,
    /// `email` or `folder`. A folder covers a USB reader too: it is a folder
    /// once mounted.
    pub delivery: String,
    /// The reader's own mail address (`…@kindle.com`), for `email`.
    #[serde(default)]
    pub address: String,
    /// Where `folder` copies to. Empty means "find the plugged-in reader of
    /// this kind", which is what a Kindle or Kobo on a cable wants.
    #[serde(default)]
    pub folder: String,
    /// The screen, in pixels. `None` keeps pages at their original size.
    #[serde(default)]
    pub resolution: Option<Resolution>,
    /// `epub` or `cbz`.
    pub format: String,
    #[serde(default = "yes")]
    pub grayscale: bool,
    #[serde(default = "yes")]
    pub split_spreads: bool,
    /// JPEG quality for re-encoded pages. Not shown in the device form; kept
    /// so an older "custom" compression survives becoming a device.
    #[serde(default = "default_quality")]
    pub quality: u8,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct Resolution {
    pub width: u32,
    pub height: u32,
}

fn yes() -> bool {
    true
}

fn default_quality() -> u8 {
    DEFAULT_QUALITY
}

/// Everything a build takes from a device, resolved once so the editor's
/// build and a batch build cannot disagree about it.
#[derive(Debug, Clone, Copy)]
pub struct Profile {
    pub split_spreads: bool,
    pub compression: leaf_core::Compression,
}

impl Device {
    pub fn profile(&self) -> Profile {
        let compression = match self.resolution {
            None => leaf_core::Compression {
                grayscale: self.grayscale,
                ..leaf_core::Compression::ORIGINAL
            },
            // The long edge is what the writer scales by; a page drawn
            // landscape is still fitted to the screen's long side.
            Some(r) => leaf_core::Compression::custom(
                Some(r.width.max(r.height)),
                self.quality,
                self.grayscale,
            ),
        };
        Profile { split_spreads: self.split_spreads, compression }
    }
}

/// What a build uses when there is no device at all: the old defaults, which
/// were sized for a Kindle.
pub fn fallback_profile() -> Profile {
    Profile {
        split_spreads: true,
        compression: leaf_core::Compression::KINDLE,
    }
}

/// The device a pre-devices settings file describes, so upgrading keeps every
/// build exactly as it was and the Kindle address keeps working.
///
/// `compression` is the old preset name; `custom` its numbers.
pub fn migrated(
    format: &str,
    compression: &str,
    custom: leaf_core::Compression,
    split_spreads: bool,
    kindle_email: &str,
) -> Device {
    let c = match compression {
        "original" => leaf_core::Compression::ORIGINAL,
        "large" => leaf_core::Compression::LARGE,
        "compact" => leaf_core::Compression::COMPACT,
        "custom" => custom,
        _ => leaf_core::Compression::KINDLE,
    };
    Device {
        id: "device-1".into(),
        name: "Kindle".into(),
        kind: "kindle".into(),
        delivery: if kindle_email.trim().is_empty() { "folder" } else { "email" }.into(),
        address: kindle_email.trim().into(),
        folder: String::new(),
        // Only the long edge was ever stored; a 3:4 screen is what every
        // preset was sized against.
        resolution: c.max_edge.map(|h| Resolution { width: h * 3 / 4, height: h }),
        format: if format == "cbz" { "cbz" } else { "epub" }.into(),
        grayscale: c.grayscale,
        split_spreads,
        quality: c.quality,
    }
}

/* -------------------------------------------------------------- detection */

/// A reader found mounted on this machine.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Connected {
    pub kind: String,
    /// The mount point's own name, as the file manager shows it.
    pub label: String,
    /// The mount point.
    pub root: PathBuf,
}

/// What kind of reader a mounted volume is, from the files it carries.
///
/// A Kindle has `documents/` beside `system/`; a Kobo keeps `.kobo/` at its
/// root. Both are there on every model that mounts as a drive, and neither
/// shows up on an ordinary USB stick.
pub fn identify(root: &Path) -> Option<&'static str> {
    if root.join(".kobo").is_dir() {
        Some("kobo")
    } else if root.join("documents").is_dir() && root.join("system").is_dir() {
        Some("kindle")
    } else {
        None
    }
}

/// Where on a reader a volume should be copied.
///
/// A Kindle only lists what is in `documents/`. A Kobo indexes the whole
/// drive, so the root is as good as anywhere and is where people look.
pub fn target_on(kind: &str, root: &Path) -> PathBuf {
    match kind {
        "kindle" => root.join("documents"),
        _ => root.to_path_buf(),
    }
}

/// Every reader mounted right now.
pub fn connected() -> Vec<Connected> {
    let mut found = Vec::new();
    for parent in mount_parents() {
        let Ok(entries) = std::fs::read_dir(&parent) else { continue };
        for entry in entries.flatten() {
            let root = entry.path();
            if let Some(kind) = identify(&root) {
                found.push(Connected {
                    kind: kind.into(),
                    label: entry.file_name().to_string_lossy().into_owned(),
                    root,
                });
            }
        }
    }
    #[cfg(windows)]
    for letter in b'D'..=b'Z' {
        let root = PathBuf::from(format!("{}:\\", letter as char));
        if let Some(kind) = identify(&root) {
            found.push(Connected { kind: kind.into(), label: format!("{}:", letter as char), root });
        }
    }
    found.sort_by(|a, b| a.root.cmp(&b.root));
    found
}

/// Where each desktop OS mounts removable drives, one level above the drive.
fn mount_parents() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if cfg!(target_os = "macos") {
        out.push(PathBuf::from("/Volumes"));
    } else if cfg!(unix) {
        if let Ok(user) = std::env::var("USER") {
            out.push(PathBuf::from("/run/media").join(&user));
            out.push(PathBuf::from("/media").join(&user));
        }
        out.push(PathBuf::from("/media"));
        out.push(PathBuf::from("/mnt"));
    }
    out
}

/// The folder a `folder` device copies into right now.
///
/// A folder the user chose wins. Without one, the plugged-in reader of the
/// device's kind; a device with no chosen folder and no reader attached is an
/// error that says to plug it in, not a silent copy somewhere else.
pub fn destination(device: &Device, attached: &[Connected]) -> Result<PathBuf> {
    if !device.folder.trim().is_empty() {
        let dir = PathBuf::from(device.folder.trim());
        if !dir.is_dir() {
            bail!("{} is not there — is the reader plugged in?", dir.display());
        }
        return Ok(dir);
    }
    match attached.iter().find(|c| c.kind == device.kind) {
        Some(reader) => Ok(target_on(&reader.kind, &reader.root)),
        None => bail!("{} is not plugged in", device.name),
    }
}

/// Copy built volumes into `dir`, one by one, so one bad file does not stop
/// the rest. Returns the names copied and the ones that failed with why.
pub fn copy_into(dir: &Path, paths: &[PathBuf]) -> (Vec<String>, Vec<(String, String)>) {
    let mut sent = Vec::new();
    let mut failed = Vec::new();
    for path in paths {
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.to_string_lossy().into_owned());
        let result = std::fs::create_dir_all(dir)
            .and_then(|_| std::fs::copy(path, dir.join(&name)))
            .with_context(|| format!("copying to {}", dir.display()));
        match result {
            Ok(_) => sent.push(name),
            Err(e) => failed.push((name, format!("{e:#}"))),
        }
    }
    (sent, failed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn device(kind: &str) -> Device {
        Device {
            id: "d".into(),
            name: "Reader".into(),
            kind: kind.into(),
            delivery: "folder".into(),
            address: String::new(),
            folder: String::new(),
            resolution: Some(Resolution { width: 1072, height: 1448 }),
            format: "epub".into(),
            grayscale: true,
            split_spreads: true,
            quality: 85,
        }
    }

    #[test]
    fn an_old_settings_file_becomes_one_device_that_builds_the_same() {
        let d = migrated("epub", "kindle", leaf_core::Compression::KINDLE, true, " me@kindle.com ");
        assert_eq!(d.delivery, "email");
        assert_eq!(d.address, "me@kindle.com");
        assert_eq!(d.profile().compression, leaf_core::Compression::KINDLE);
        assert!(d.profile().split_spreads);

        let original = migrated("cbz", "original", leaf_core::Compression::KINDLE, false, "");
        assert_eq!(original.delivery, "folder");
        assert_eq!(original.format, "cbz");
        assert_eq!(original.resolution, None);
        assert_eq!(original.profile().compression.max_edge, None);
    }

    #[test]
    fn a_custom_compression_keeps_its_numbers_when_migrated() {
        let custom = leaf_core::Compression::custom(Some(2000), 70, false);
        let d = migrated("epub", "custom", custom, true, "");
        assert_eq!(d.profile().compression, custom);
    }

    #[test]
    fn a_device_scales_pages_by_its_screens_long_edge() {
        let mut d = device("kindle");
        d.resolution = Some(Resolution { width: 1680, height: 1264 });
        assert_eq!(d.profile().compression.max_edge, Some(1680));
    }

    #[test]
    fn kindles_and_kobos_are_told_apart_by_their_marker_folders() {
        let tmp = tempfile::tempdir().unwrap();
        let kindle = tmp.path().join("Kindle");
        std::fs::create_dir_all(kindle.join("documents")).unwrap();
        std::fs::create_dir_all(kindle.join("system")).unwrap();
        let kobo = tmp.path().join("KOBOeReader");
        std::fs::create_dir_all(kobo.join(".kobo")).unwrap();
        let stick = tmp.path().join("USB");
        std::fs::create_dir_all(stick.join("documents")).unwrap();

        assert_eq!(identify(&kindle), Some("kindle"));
        assert_eq!(identify(&kobo), Some("kobo"));
        assert_eq!(identify(&stick), None, "documents/ alone is any USB stick");
    }

    #[test]
    fn a_plugged_in_kindle_receives_volumes_in_its_documents_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("Kindle");
        let attached = vec![Connected { kind: "kindle".into(), label: "Kindle".into(), root: root.clone() }];
        assert_eq!(destination(&device("kindle"), &attached).unwrap(), root.join("documents"));
        assert!(destination(&device("kobo"), &attached).is_err(), "a Kobo is not a Kindle");
    }

    #[test]
    fn a_chosen_folder_wins_and_a_missing_one_says_so() {
        let tmp = tempfile::tempdir().unwrap();
        let mut d = device("boox");
        d.folder = tmp.path().to_string_lossy().into_owned();
        assert_eq!(destination(&d, &[]).unwrap(), tmp.path());

        d.folder = tmp.path().join("gone").to_string_lossy().into_owned();
        let err = destination(&d, &[]).unwrap_err().to_string();
        assert!(err.contains("plugged in"), "{err}");
    }

    #[test]
    fn copying_reports_each_file_and_carries_on_past_a_missing_one() {
        let tmp = tempfile::tempdir().unwrap();
        let built = tmp.path().join("v01.epub");
        std::fs::write(&built, b"epub").unwrap();
        let out = tmp.path().join("reader/documents");
        let (sent, failed) = copy_into(&out, &[tmp.path().join("missing.epub"), built]);
        assert_eq!(sent, vec!["v01.epub".to_string()]);
        assert_eq!(failed.len(), 1);
        assert_eq!(std::fs::read(out.join("v01.epub")).unwrap(), b"epub");
    }
}
