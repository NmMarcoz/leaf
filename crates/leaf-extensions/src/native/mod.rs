//! Sources implemented directly in Rust rather than loaded as a script.
//!
//! MangaDex stays native rather than becoming a Lua source because
//! `leaf-meta::mangadex` already handles a subtle protocol correctly and is
//! already tested — MangaDex@Home's short-lived per-request signed URLs, the
//! two-request language-fallback merge for volume/chapter aggregation.
//! "Works as an extension" means it is reached through the same role traits
//! and [`crate::Registry`] as anything else, not that its implementation
//! language has to match.
//!
//! [`enrich`] wraps AniList and Jikan — metadata databases with no chapter
//! structure at all — as [`crate::EnrichSource`]s, so the chain that fills
//! what a series' own source left blank iterates registered enrich sources
//! instead of naming them.

pub mod enrich;
pub mod mangadex;
