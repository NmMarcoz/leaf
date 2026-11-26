//! Commands for sending a finished volume to a device.
//!
//! The SMTP password is the one secret this app holds, and it is a live
//! credential for the user's mail account — not something scoped to us. It goes
//! in the OS keychain and never into `settings.json`, never across IPC on the
//! way back, and never into an error message.

use std::path::PathBuf;

use anyhow::{bail, Result};
#[cfg(desktop)]
use anyhow::Context;
#[cfg(desktop)]
use leaf_send::{Account, Delivery, Security};
use serde::Serialize;
use tauri::AppHandle;
#[cfg(desktop)]
use tauri::Emitter;

use crate::devices;
#[cfg(desktop)]
use crate::settings::DeliveryConfig;
use crate::settings;
use crate::util::blocking;

/// Keychain coordinates. The service matches the bundle identifier so the entry
/// is recognisable in Keychain Access or Credential Manager.
const SERVICE: &str = "dev.leaf";
const ACCOUNT: &str = "smtp-password";

/// The delivery settings plus whether a password is stored, which is all the UI
/// can know about it.
#[derive(Serialize)]
pub struct DeliveryStatus {
    config: DeliveryConfig,
    has_password: bool,
}

#[derive(Clone, Serialize)]
struct SendProgress {
    file: String,
    /// 1-based position in this batch.
    index: usize,
    total: usize,
}

#[derive(Serialize)]
pub struct SendReport {
    pub sent: Vec<String>,
    pub failed: Vec<SendFailure>,
}

#[derive(Serialize)]
pub struct SendFailure {
    file: String,
    error: String,
}

/// Why sending is held back on mobile.
///
/// Android has no equivalent of the macOS Keychain or Windows Credential
/// Manager that this reaches for. Falling back to a plaintext file would put a
/// live credential for the user's whole mail account on disk, which is a worse
/// answer than not offering the feature yet.
#[cfg(not(desktop))]
const UNAVAILABLE: &str = "Send to Kindle is not available on this platform yet: \
                           there is nowhere secure to keep your mail password.";

#[cfg(desktop)]
fn entry() -> Result<keyring::Entry> {
    keyring::Entry::new(SERVICE, ACCOUNT).context("opening the system keychain")
}

/// The stored password, or `None` when there is not one.
///
/// A keychain that cannot be read at all is reported as "no password" rather
/// than an error: on a machine where the keychain is unavailable the useful
/// message is the one the send produces, not one from here.
#[cfg(desktop)]
fn stored_password() -> Option<String> {
    entry().ok()?.get_password().ok()
}

#[cfg(not(desktop))]
fn stored_password() -> Option<String> {
    None
}

#[tauri::command]
pub async fn send_config(app: AppHandle) -> Result<DeliveryStatus, String> {
    blocking(move || {
        Ok(DeliveryStatus {
            config: settings::load(&app)?.delivery,
            has_password: stored_password().is_some(),
        })
    })
    .await
}

/// Save the delivery settings, and the password when one was typed.
///
/// `password` being `None` means "leave whatever is stored alone", which is what
/// lets the UI show a filled-looking field without ever having received the
/// secret. An empty string means "forget it".
#[tauri::command]
pub async fn save_send_config(
    app: AppHandle,
    config: DeliveryConfig,
    password: Option<String>,
) -> Result<DeliveryStatus, String> {
    blocking(move || {
        let mut current = settings::load(&app)?;
        current.delivery = config;
        settings::save(&app, &current)?;

        #[cfg(desktop)]
        if let Some(secret) = password {
            let entry = entry()?;
            if secret.is_empty() {
                // Not an error if there was nothing stored to begin with.
                let _ = entry.delete_credential();
            } else {
                entry
                    .set_password(&secret)
                    .context("saving the password to the system keychain")?;
            }
        }
        #[cfg(not(desktop))]
        if password.is_some() {
            bail!("{UNAVAILABLE}");
        }

        Ok(DeliveryStatus {
            config: settings::load(&app)?.delivery,
            has_password: stored_password().is_some(),
        })
    })
    .await
}

/// Prove a device is reachable, without sending a document.
///
/// For an email device that is a test message to its address through the
/// mail account; for a folder device, that the folder (or the plugged-in
/// reader) is there to write to.
#[tauri::command]
pub async fn send_test_email(app: AppHandle, device: Option<String>) -> Result<(), String> {
    blocking(move || {
        let settings = settings::load(&app)?;
        let Some(device) = settings::device(&settings, device.as_deref()).cloned() else {
            bail!("add a device first");
        };
        if device.delivery == "folder" {
            devices::destination(&device, &devices::connected())?;
            return Ok(());
        }

        #[cfg(not(desktop))]
        bail!("{UNAVAILABLE}");

        #[cfg(desktop)]
        {
            let to = device.address.trim().to_string();
            if to.is_empty() {
                bail!("{} has no email address", device.name);
            }
            leaf_send::send_test(
                &account(&settings.delivery)?,
                &stored_password().unwrap_or_default(),
                &to,
            )
        }
    })
    .await
}

/// Readers plugged in right now, for the device form's "found" line.
#[tauri::command]
pub async fn connected_readers() -> Result<Vec<devices::Connected>, String> {
    blocking(|| Ok(devices::connected())).await
}

/// Send already-built files.
///
/// Deliberately takes paths rather than building anything: the editor and the
/// series gallery both already know how to produce a file, and sending one that
/// does not also land on disk would be a surprise.
///
/// One message per file. Batching them into a single mail would blow through
/// the attachment limit on the second volume.
#[tauri::command]
pub async fn send_files(
    app: AppHandle,
    paths: Vec<String>,
    device: Option<String>,
) -> Result<SendReport, String> {
    blocking(move || deliver_all(&app, device.as_deref(), &paths)).await
}

/// Send built volumes to a device (`None` = the default one).
///
/// Split out of the command because a queued build finishes by doing exactly
/// this, and "build then send" should be one job rather than something the user
/// has to come back and finish by hand.
pub fn deliver_all(app: &AppHandle, device: Option<&str>, paths: &[String]) -> anyhow::Result<SendReport> {
    if paths.is_empty() {
        bail!("nothing to send");
    }
    let settings = settings::load(app)?;
    let Some(device) = settings::device(&settings, device).cloned() else {
        bail!("no device to send to — add one under Settings → Devices");
    };

    if device.delivery == "folder" {
        let dir = devices::destination(&device, &devices::connected())?;
        let files: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
        let (sent, failed) = devices::copy_into(&dir, &files);
        return Ok(SendReport {
            sent,
            failed: failed
                .into_iter()
                .map(|(file, error)| SendFailure { file, error })
                .collect(),
        });
    }

    #[cfg(not(desktop))]
    {
        let _ = app;
        bail!("{UNAVAILABLE}");
    }

    #[cfg(desktop)]
    {
        let to = device.address.trim().to_string();
        if to.is_empty() {
            bail!("{} has no email address — add one under Settings → Devices", device.name);
        }
        let account = account(&settings.delivery)?;
        let secret = stored_password().unwrap_or_default();

        let total = paths.len();
        let mut sent = Vec::new();
        let mut failed = Vec::new();

        for (index, path) in paths.iter().enumerate() {
            let path = PathBuf::from(path);
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.to_string_lossy().into_owned());

            let _ = app.emit(
                "send-progress",
                SendProgress { file: name.clone(), index: index + 1, total },
            );

            // A volume that fails is recorded and the rest still go; losing
            // eleven sends to one oversized file would be daft.
            match deliver(&account, &secret, &to, &path, &name) {
                Ok(()) => sent.push(name),
                Err(e) => failed.push(SendFailure { file: name, error: format!("{e:#}") }),
            }
        }

        Ok(SendReport { sent, failed })
    }
}

#[cfg(desktop)]
fn deliver(
    account: &Account,
    password: &str,
    to: &str,
    path: &std::path::Path,
    name: &str,
) -> Result<()> {
    let bytes = std::fs::read(path).with_context(|| format!("reading {}", path.display()))?;
    leaf_send::send(account, password, &Delivery { to, filename: name, bytes })
}

#[cfg(desktop)]
fn account(config: &DeliveryConfig) -> Result<Account> {
    if config.host.trim().is_empty() {
        bail!("no mail server set — add the sending account under Settings → Devices");
    }
    Ok(Account {
        host: config.host.trim().to_string(),
        port: config.port,
        security: match config.security.as_str() {
            "tls" => Security::Tls,
            "none" => Security::None,
            _ => Security::StartTls,
        },
        username: config.username.trim().to_string(),
        from: config.from.trim().to_string(),
    })
}
