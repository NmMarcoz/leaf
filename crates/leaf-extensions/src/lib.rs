//! Pluggable manga sources, in three roles, with MangaDex as the first one
//! registered.
//!
//! This replaces the closed `leaf_meta::Source` enum (`MangaDex | Kitsu`)
//! that used to be matched by hand everywhere a library series' backend
//! mattered. `leaf-library`'s `series.source` column is already free
//! text — added for exactly this — so a source only ever needs registering
//! here, in [`Registry`], never a schema change or a new match arm.
//!
//! A source is one of three [`Kind`]s — a **metadata** catalogue
//! ([`MetadataSource`]), an **enrich** provider that only fills in details
//! ([`EnrichSource`]), or a **reader** that serves pages ([`ReaderSource`]).
//! Only a reader may serve pages, and that is enforced when a script loads,
//! not at a call site.
//!
//! Third-party sources are written in **Lua** ([`lua::LuaSource`]), not
//! compiled Rust and not WASM: easier to read, and easier to port a
//! Keiyoushi/Tachiyomi extension into by eye, since the traits' methods
//! mirror Tachiyomi's own `CatalogueSource`/`HttpSource` on purpose. A script
//! runs inside a sandbox with a whitelisted standard library and no ambient
//! network access at all — see [`lua::sandbox`] — so what it can do is
//! entirely bounded by the host functions this crate hands it.
//!
//! MangaDex itself ([`native::mangadex`]) stays native Rust, delegating to the
//! already-tested `leaf-meta::mangadex` client, rather than being
//! rewritten into a script: "works as an extension" means it is reached
//! through the same traits and registry as anything else, not that its
//! implementation language has to match.
//!
//! Scripts reach the user either copied in by hand or from an extension
//! repository the user added ([`repo`]). The crate knows how to read a
//! repository; it ships with none.
//!
//! Deliberately out of scope here: any path to running actual Keiyoushi APKs
//! (that would mean embedding a JVM and an Android-API compatibility shim on
//! desktop, and a wholly separate native APK loader on Android — two
//! unrelated heavy subsystems for one feature, decided against).

pub mod lua;
pub mod native;
pub mod net_guard;
pub mod registry;
pub mod repo;
pub mod types;

pub use registry::{
    Governance, LookupError, PendingExtension, Registry, Role, ScriptState, UserScript,
};
pub use types::{
    ChapterRef, EnrichSource, Kind, MangaDetails, MangaSummary, MangasPage, MetadataSource,
    ReaderSource, SourceInfo, VolumeChapters, VolumeCover, API_LEVEL,
};
