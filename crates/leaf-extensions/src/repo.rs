//! Extension repositories: a URL the user adds, serving an `index.json`
//! that lists `.lua` scripts and the exact bytes of each.
//!
//! The app ships with no repository and names none — not in code, not in a
//! settings default. A repository is something the user types, the same way
//! they would type a URL into a browser; this module only knows how to read
//! one.
//!
//! What a repository can do is deliberately small. Installing downloads one
//! script into the extensions folder and stops: the file lands *pending*,
//! like any file copied in by hand, and the trust gate still asks. The
//! index's `sha256` is checked against the bytes actually served and a
//! mismatch is refused outright — the index is what the user browsed, and
//! bytes that are not what it described are not something to "warn" about.
//! Updating is the same install over the old file, which changes its
//! fingerprint and so puts it back at the gate: an update never inherits
//! the previous version's approval.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};

use crate::lua::LuaSource;
use crate::net_guard::{self, Scope};
use crate::registry::{Governance, Registry, ScriptState};
use crate::types::{Kind, API_LEVEL};

/// The index format this build reads. A repository declaring a newer one is
/// refused as a whole — its entries may mean something this build would
/// misread.
pub const INDEX_SCHEMA: u32 = 1;

const MAX_INDEX_BYTES: u64 = 4 * 1024 * 1024;
const MAX_SCRIPT_BYTES: u64 = 2 * 1024 * 1024;

/// `index.json` as served.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoIndex {
    pub schema: u32,
    /// What the repository calls itself, for the panel's heading.
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub generated: Option<String>,
    pub scripts: Vec<RepoScript>,
}

/// One script as the index describes it — the manifest the loader would
/// read, plus where the file is and what its bytes hash to.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RepoScript {
    /// Path relative to the index URL, e.g. `readers/some-site.lua`.
    pub file: String,
    pub id: String,
    pub name: String,
    pub kind: Kind,
    #[serde(default)]
    pub lang: String,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub mirrors: Vec<String>,
    #[serde(default)]
    pub description: Option<String>,
    /// sha256 of the exact bytes, hex — the same value the trust gate
    /// records, so "install from a repository" and "approve the pending
    /// row" speak one currency.
    pub sha256: String,
    /// A date. The fingerprint is the real version; this is for people.
    #[serde(default)]
    pub version: String,
    #[serde(default = "first_api")]
    pub api: u32,
    #[serde(default)]
    pub nsfw: bool,
    #[serde(default)]
    pub capabilities: Vec<String>,
}

fn first_api() -> u32 {
    1
}

/// A fetched index and where it came from.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FetchedIndex {
    /// The index's own URL, after normalising what the user typed.
    pub url: String,
    pub index: RepoIndex,
    /// Entries left out because this build does not understand them — an
    /// unknown `kind`, a missing field. A future kind degrades to "not
    /// offered", never to "repository unreadable".
    pub skipped: usize,
}

/// One index entry against the local extensions folder.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoRow {
    #[serde(flatten)]
    pub script: RepoScript,
    pub status: RepoStatus,
    /// The local file holding this id, when there is one.
    pub local_file: Option<String>,
    /// That file's state at the gate.
    pub local_state: Option<ScriptState>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RepoStatus {
    NotInstalled,
    /// The local file's bytes are exactly the index's.
    Installed,
    /// A local file carries this id with other bytes.
    UpdateAvailable,
    /// Needs a newer host API than this build offers — never offered for
    /// install, rather than installed and shown broken.
    Incompatible,
}

/// What the user typed, as the index URL: kept when it names a `.json`
/// file, else `index.json` inside it.
pub fn index_url(input: &str) -> Result<String> {
    let input = input.trim();
    let lower = input.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) {
        bail!("a repository address starts with https://");
    }
    // Scheme and host are case-insensitive, and a phone keyboard happily
    // capitalises them; the path is not, so it is left alone. Normalised so
    // one repository is stored and compared as one address.
    let (scheme, rest) = input.split_once("://").unwrap_or_default();
    let host_end = rest.find('/').unwrap_or(rest.len());
    let input = format!(
        "{}://{}{}",
        scheme.to_ascii_lowercase(),
        rest[..host_end].to_ascii_lowercase(),
        &rest[host_end..]
    );
    if input.ends_with(".json") {
        return Ok(input);
    }
    Ok(format!("{}/index.json", input.trim_end_matches('/')))
}

/// Parse an index, dropping the entries this build cannot read.
pub fn parse_index(text: &str) -> Result<(RepoIndex, usize)> {
    #[derive(Deserialize)]
    struct Raw {
        schema: u32,
        #[serde(default)]
        name: Option<String>,
        #[serde(default)]
        generated: Option<String>,
        scripts: Vec<serde_json::Value>,
    }
    let raw: Raw = serde_json::from_str(text).context("the repository index is not valid JSON")?;
    if raw.schema > INDEX_SCHEMA {
        bail!(
            "this repository uses index format {}; this Leaf reads up to {INDEX_SCHEMA} — update Leaf",
            raw.schema
        );
    }
    let total = raw.scripts.len();
    let scripts: Vec<RepoScript> = raw
        .scripts
        .into_iter()
        .filter_map(|v| serde_json::from_value(v).ok())
        .collect();
    let skipped = total - scripts.len();
    Ok((
        RepoIndex {
            schema: raw.schema,
            name: raw.name,
            generated: raw.generated,
            scripts,
        },
        skipped,
    ))
}

/// Fetch and parse a repository's index.
pub fn fetch_index(input: &str) -> Result<FetchedIndex> {
    let url = index_url(input)?;
    let text = fetch_text(&url, MAX_INDEX_BYTES)?;
    let (index, skipped) = parse_index(&text)?;
    Ok(FetchedIndex {
        url,
        index,
        skipped,
    })
}

/// Every entry of `index` with its standing in the local folder `dir`.
pub fn browse(dir: &Path, index: &RepoIndex, governance: &Governance) -> Vec<RepoRow> {
    let local = Registry::survey(dir, governance);
    index
        .scripts
        .iter()
        .map(|script| {
            let found = local
                .iter()
                .find(|row| row.info.as_ref().is_some_and(|i| i.id == script.id));
            let status = if script.api > API_LEVEL {
                RepoStatus::Incompatible
            } else {
                match found {
                    None => RepoStatus::NotInstalled,
                    Some(row) if row.fingerprint == script.sha256 => RepoStatus::Installed,
                    Some(_) => RepoStatus::UpdateAvailable,
                }
            };
            RepoRow {
                script: script.clone(),
                status,
                local_file: found.map(|r| r.file.clone()),
                local_state: found.map(|r| r.state),
            }
        })
        .collect()
}

/// Download one script and check it is exactly what the index described:
/// the bytes hash to `sha256`, and the manifest they declare matches the
/// entry's id and kind. Returns the script's text.
pub fn download(index_url: &str, script: &RepoScript) -> Result<String> {
    if script.api > API_LEVEL {
        bail!(
            "{} needs host API level {}; this Leaf offers {API_LEVEL} — update Leaf",
            script.name,
            script.api
        );
    }
    let url = leaf_fetch::url::resolve(index_url, &script.file)
        .ok_or_else(|| anyhow!("{:?} is not a valid script path", script.file))?;
    let text = fetch_text(&url, MAX_SCRIPT_BYTES)?;

    let served = Registry::fingerprint(&text);
    if !served.eq_ignore_ascii_case(&script.sha256) {
        bail!(
            "refused {}: the repository's index says its sha256 is {}, but the file served \
             hashes to {served}. The index and the file disagree, so neither can be trusted.",
            script.file,
            script.sha256
        );
    }

    let loaded =
        LuaSource::load(text.clone()).with_context(|| format!("{} does not load", script.file))?;
    let info = loaded.info();
    if info.id != script.id || info.kind != script.kind {
        bail!(
            "refused {}: the index lists it as {} ({}), but the script declares {} ({})",
            script.file,
            script.id,
            script.kind,
            info.id,
            info.kind
        );
    }
    Ok(text)
}

/// Install (or update) one script into `dir`: download and verify, then
/// write it over the local file holding the same id, or under the index's
/// own filename when there is none. Returns the filename written.
///
/// Writing does not approve. The new bytes have a fingerprint nobody has
/// said yes to, so the file shows as pending until the user does.
pub fn install(dir: &Path, index_url: &str, script: &RepoScript) -> Result<String> {
    let text = download(index_url, script)?;
    let name = match local_file_for(dir, &script.id) {
        Some(existing) => existing,
        None => install_name(&script.file)?,
    };
    std::fs::create_dir_all(dir)?;
    let path: PathBuf = dir.join(&name);
    std::fs::write(&path, text).with_context(|| format!("writing {}", path.display()))?;
    Ok(name)
}

/// The local file carrying `id`, if any — so an update lands on the file
/// the user already has rather than beside it under another name, which
/// would leave two copies fighting over one id.
fn local_file_for(dir: &Path, id: &str) -> Option<String> {
    Registry::survey(dir, &Governance::default())
        .into_iter()
        .find(|row| row.info.as_ref().is_some_and(|i| i.id == id))
        .map(|row| row.file)
}

/// The filename an index entry installs as: the last path segment, and only
/// a plain `.lua` name. The index is a stranger's text; nothing in it may
/// name a path outside the extensions folder.
pub fn install_name(file: &str) -> Result<String> {
    let name = file.rsplit('/').next().unwrap_or_default();
    let plain = !name.is_empty()
        && name.ends_with(".lua")
        && name.len() > 4
        && !name.starts_with('.')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
    if !plain {
        bail!("{file:?} is not a plain .lua file name");
    }
    Ok(name.to_string())
}

/// GET `url` as text through the guarded agent, following redirects by hand
/// so every hop is re-checked, and refusing a body over `max` bytes.
fn fetch_text(url: &str, max: u64) -> Result<String> {
    let agent = net_guard::agent_for(Scope::Repos);
    let mut url = url.to_string();
    for _ in 0..=net_guard::MAX_HOPS {
        if !(url.starts_with("https://") || url.starts_with("http://")) {
            bail!("{url:?} is not an http(s) address");
        }
        if !net_guard::url_is_public_for(&url, Scope::Repos) {
            bail!("{url:?} is on a private or metadata address");
        }
        let response = match agent
            .get(&url)
            .set("User-Agent", leaf_fetch::USER_AGENT)
            .timeout(Duration::from_secs(20))
            .call()
        {
            Ok(response) => response,
            Err(ureq::Error::Status(code, _)) => bail!("{url} answered {code}"),
            Err(e) => bail!("fetching {url}: {e}"),
        };
        let status = response.status();
        if (300..399).contains(&status) {
            let location = response
                .header("Location")
                .ok_or_else(|| anyhow!("{url} redirected nowhere"))?;
            url = leaf_fetch::url::resolve(&url, location)
                .ok_or_else(|| anyhow!("{url} redirected to an unfetchable {location:?}"))?;
            continue;
        }
        let mut bytes = Vec::new();
        response
            .into_reader()
            .take(max + 1)
            .read_to_end(&mut bytes)
            .with_context(|| format!("reading {url}"))?;
        if bytes.len() as u64 > max {
            bail!("{url} is unexpectedly large");
        }
        return String::from_utf8(bytes).map_err(|_| anyhow!("{url} is not UTF-8 text"));
    }
    bail!(
        "{url:?} bounced more than {} redirects",
        net_guard::MAX_HOPS
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_typed_folder_address_means_its_index_json() {
        assert_eq!(
            index_url("https://repo.example/leaf/").unwrap(),
            "https://repo.example/leaf/index.json"
        );
        assert_eq!(
            index_url(" https://repo.example/x/custom.json ").unwrap(),
            "https://repo.example/x/custom.json"
        );
        assert!(index_url("file:///etc/passwd").is_err());
        assert_eq!(
            index_url("Https://RAW.Repo.example/Owner/Main/").unwrap(),
            "https://raw.repo.example/Owner/Main/index.json"
        );
    }

    #[test]
    fn an_unknown_kind_drops_the_entry_not_the_repository() {
        let text = r#"{ "schema": 1, "scripts": [
            { "file": "readers/a.lua", "id": "user.a", "name": "A", "kind": "reader",
              "sha256": "00" },
            { "file": "future/b.lua", "id": "user.b", "name": "B", "kind": "translator",
              "sha256": "00" }
        ]}"#;
        let (index, skipped) = parse_index(text).unwrap();
        assert_eq!(index.scripts.len(), 1);
        assert_eq!(index.scripts[0].id, "user.a");
        assert_eq!(skipped, 1);
    }

    #[test]
    fn a_newer_index_format_is_refused_whole() {
        let err = parse_index(r#"{ "schema": 99, "scripts": [] }"#).unwrap_err();
        assert!(err.to_string().contains("update Leaf"));
    }

    #[test]
    fn an_index_cannot_name_a_path_outside_the_folder() {
        assert_eq!(
            install_name("readers/some-site.lua").unwrap(),
            "some-site.lua"
        );
        for bad in [
            "../../.bashrc",
            "readers/..lua",
            "readers/x.sh",
            "readers/",
            "a/.hidden.lua",
            "x/a b.lua",
        ] {
            assert!(install_name(bad).is_err(), "{bad} must be refused");
        }
    }

    fn entry(id: &str, sha256: &str, api: u32) -> RepoScript {
        RepoScript {
            file: format!("readers/{id}.lua"),
            id: id.into(),
            name: id.into(),
            kind: Kind::Reader,
            lang: "en".into(),
            base_url: "https://x.example".into(),
            mirrors: Vec::new(),
            description: None,
            sha256: sha256.into(),
            version: String::new(),
            api,
            nsfw: false,
            capabilities: Vec::new(),
        }
    }

    #[test]
    fn browsing_compares_the_index_against_local_fingerprints() {
        let dir = tempfile::tempdir().unwrap();
        let script = r#"SOURCE = { id = "user.here", name = "Here", kind = "reader",
                                   base_url = "https://here.example" }
                        function page_list() return {} end"#;
        std::fs::write(dir.path().join("here.lua"), script).unwrap();
        let fingerprint = Registry::fingerprint(script);

        let index = RepoIndex {
            schema: 1,
            name: None,
            generated: None,
            scripts: vec![
                entry("user.here", &fingerprint, 1),
                entry("user.absent", "00", 1),
                entry("user.future", "00", API_LEVEL + 1),
            ],
        };
        let rows = browse(dir.path(), &index, &Governance::default());
        assert_eq!(rows[0].status, RepoStatus::Installed);
        assert_eq!(rows[0].local_file.as_deref(), Some("here.lua"));
        assert_eq!(rows[0].local_state, Some(ScriptState::Pending));
        assert_eq!(rows[1].status, RepoStatus::NotInstalled);
        assert_eq!(rows[2].status, RepoStatus::Incompatible);

        let index = RepoIndex {
            scripts: vec![entry("user.here", "ff", 1)],
            ..index
        };
        assert_eq!(
            browse(dir.path(), &index, &Governance::default())[0].status,
            RepoStatus::UpdateAvailable
        );
    }
}
