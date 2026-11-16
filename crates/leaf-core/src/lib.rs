//! Core pipeline for turning folders of scraped manga images into readable volumes.
//!
//! Deliberately free of any UI or Tauri dependency: the CLI, the desktop app and
//! the tests all drive the same code through [`scan`] and the [`writers`].

pub mod badge;
pub mod compress;
pub mod natsort;
pub mod page;
pub mod project;
pub mod scan;
pub mod sieve;
pub mod writers;

pub use compress::Compression;
pub use page::{ExcludeReason, Page, PageKind};
pub use project::{Chapter, Direction, Metadata, Volume};
pub use scan::scan_volume;
pub use sieve::{Norm, Verdict};
pub use writers::WriteOptions;
