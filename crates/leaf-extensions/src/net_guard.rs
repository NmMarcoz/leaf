//! Keeping a source script's HTTP out of the machine's own backyard.
//!
//! The origin pin alone is not a boundary: the script *declares* its own
//! `base_url`, so a fake extension happily pins itself to
//! `http://169.254.169.254`, reads the host's cloud instance credentials from
//! the metadata service, and `POST`s them to its author. Loopback, RFC1918 and
//! link-local space generally are not places a scraped manga site lives, and
//! neither is anything reachable by resolving a public name to a private
//! address (DNS rebinding). So every address a script's request could connect
//! to is resolved here and checked before ureq is allowed to dial it — a
//! custom [`ureq::Resolver`], which means the checked addresses are exactly
//! the ones used, not merely the ones that were true at probe time.
//!
//! Redirects are refused by the agent and followed by `host::http` by hand,
//! because a hop is a new URL and every new URL re-runs both checks.
//!
//! `LEAF_ALLOW_PRIVATE_SOURCES=1` turns the guard off for scripts. That is
//! not a hole in the app: the variable lives in the user's own environment,
//! and without the escape the end-to-end tests (which serve fixtures from
//! `127.0.0.1`) and anyone developing a script against a local server could
//! not run at all.
//!
//! Extension repositories ([`crate::repo`]) go through the same guard under
//! their own [`Scope`] and their own variable, `LEAF_ALLOW_PRIVATE_REPOS=1`.
//! Scraping a local fixture and trusting some other machine's list of code
//! are different decisions; one switch must not quietly make both.

use std::io;
use std::net::{IpAddr, SocketAddr, ToSocketAddrs};

use ureq::Agent;

/// How many hand-followed hops one `leaf.http` call may take. Ureq's own
/// default was 10; a legitimate site redirect is 1 or 2, and the rest of that
/// budget is only useful to someone steering a request around the guard.
pub const MAX_HOPS: usize = 5;

/// Who is asking, which decides which environment variable may turn the
/// guard off.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Scope {
    /// A source script's `leaf.http` and the page URLs it hands back.
    Scripts,
    /// Fetching an extension repository's index and scripts.
    Repos,
}

/// The agent both script doors share: guarded resolver, no automatic redirects.
pub fn guarded_agent() -> Agent {
    agent_for(Scope::Scripts)
}

/// [`guarded_agent`] for a given [`Scope`].
pub fn agent_for(scope: Scope) -> Agent {
    ureq::AgentBuilder::new()
        .resolver(move |netloc: &str| resolve_public(netloc, scope))
        .redirects(0)
        .build()
}

/// True when a script may talk to `url` at all — the name-level half of the
/// check, used before any DNS on paths where resolving is not wanted (the
/// `page_list` filter runs on a few dozen URLs at once).
pub fn url_is_public(url: &str) -> bool {
    url_is_public_for(url, Scope::Scripts)
}

/// [`url_is_public`] for a given [`Scope`].
pub fn url_is_public_for(url: &str, scope: Scope) -> bool {
    if disabled(scope) {
        return true;
    }
    match host_of(url) {
        Some(host) => host_is_public(&host),
        // Not parseable: the request path will reject it properly soon enough.
        None => true,
    }
}

fn host_of(url: &str) -> Option<String> {
    let rest = url.split_once("://")?.1;
    let authority = &rest[..rest.find('/').unwrap_or(rest.len())];
    let authority = authority.rsplit_once('@').map_or(authority, |(_, h)| h);
    let host = match authority.strip_prefix('[') {
        // `[::1]:8080` — the host is inside the brackets.
        Some(bracketed) => bracketed.split_once(']').map_or(authority, |(h, _)| h),
        None => authority.split(':').next().unwrap_or(""),
    };
    Some(host.to_ascii_lowercase())
}

fn host_is_public(host: &str) -> bool {
    if is_blocked_hostname(host) {
        return false;
    }
    // An IP literal needs no lookup; a name is checked via DNS below.
    match host.parse::<IpAddr>() {
        Ok(ip) => ip_is_public(&ip),
        Err(_) => true,
    }
}

/// Names that are metadata-service conventions rather than parseable
/// private ranges — `169.254.169.254` is caught by the IP rule, but cloud
/// providers also hand out human names for the same endpoint, and their
/// DNS answers vary by environment.
fn is_blocked_hostname(host: &str) -> bool {
    host == "localhost"
        || host.ends_with(".localhost")
        || host == "metadata.google.internal"
        || host.ends_with(".metadata.google.internal")
        || host == "metadata"
        || host.ends_with(".ec2internal")
}

fn ip_is_public(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            !(o[0] == 0 // 0.0.0.0/8 "this host"
                || o[0] == 10
                || o[0] == 127 // loopback
                || (o[0] == 169 && o[1] == 254) // link-local, incl. every cloud metadata IP
                || (o[0] == 172 && (16..=31).contains(&o[1]))
                || (o[0] == 192 && o[1] == 168)
                || (o[0] == 192 && o[1] == 0 && (o[2] == 0 || o[2] == 2)) // IPv4-translation / TEST-NET-2
                || (o[0] == 198 && (o[1] == 18 || o[1] == 19)) // benchmarking
                || (o[0] == 198 && o[1] == 51 && o[2] == 100) // TEST-NET-3
                || (o[0] == 203 && o[1] == 0 && o[2] == 113) // TEST-NET
                || (o[0] == 100 && (64..=127).contains(&o[1])) // carrier-grade NAT
                || o[0] >= 224) // multicast and reserved
        }
        IpAddr::V6(v6) => {
            let s = v6.segments();
            if s[..5] == [0, 0, 0, 0, 0] && s[5] == 0xFFFF {
                // `::ffff:a.b.c.d` — judge the embedded v4 instead.
                let o = v6.octets();
                return ip_is_public(&IpAddr::from([o[12], o[13], o[14], o[15]]));
            }
            !(v6.is_loopback()
                || s[0] & 0xFE00 == 0xFC00 // unique-local fc00::/7
                || s[0] & 0xFFC0 == 0xFE80 // link-local fe80::/10
                || s[0] >= 0xFF00) // multicast and reserved
        }
    }
}

fn disabled(scope: Scope) -> bool {
    let variable = match scope {
        Scope::Scripts => "LEAF_ALLOW_PRIVATE_SOURCES",
        Scope::Repos => "LEAF_ALLOW_PRIVATE_REPOS",
    };
    // Each call, not once at startup: the tests flip this at runtime.
    std::env::var_os(variable).is_some_and(|v| v == "1")
}

/// The ureq resolver: every address the connection may use is checked here,
/// and only the surviving ones are handed back — so a host can be DNS-rebound
/// between this lookup and ureq's dial only onto an address this function
/// already approved.
fn resolve_public(netloc: &str, scope: Scope) -> io::Result<Vec<SocketAddr>> {
    let (host_only, port) = split_netloc(netloc);

    if disabled(scope) {
        return (host_only, port)
            .to_socket_addrs()
            .map(|iter| iter.collect());
    }
    if is_blocked_hostname(host_only) {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            format!("{host_only:?} is a metadata or loopback name"),
        ));
    }
    if let Ok(ip) = host_only.parse::<IpAddr>() {
        if !ip_is_public(&ip) {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "private network addresses are refused",
            ));
        }
    }

    let addrs: Vec<SocketAddr> = (host_only, port).to_socket_addrs()?.collect();
    if addrs.is_empty() {
        return Err(io::Error::other(format!(
            "{host_only:?} resolved to no addresses"
        )));
    }
    // A public name with any private answer is a rebinding setup, full stop.
    if let Some(private) = addrs.iter().find(|a| !ip_is_public(&a.ip())) {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            format!("{host_only:?} resolves to the non-public address {private}"),
        ));
    }
    Ok(addrs)
}

/// `host:port` / `[v6]:port` -> `("host", port)`. Port defaults to 443 like
/// ureq's own, so a missing one resolves through HTTPS rather than failing.
fn split_netloc(netloc: &str) -> (&str, u16) {
    if let Some(rest) = netloc.strip_prefix('[') {
        if let Some((host, tail)) = rest.split_once(']') {
            let port = tail
                .strip_prefix(':')
                .and_then(|p| p.parse().ok())
                .unwrap_or(443);
            return (host, port);
        }
        return (netloc, 443);
    }
    match netloc.rsplit_once(':') {
        Some((host, port)) if port.parse::<u16>().is_ok() => (host, port.parse().unwrap()),
        _ => (netloc, 443),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metadata_and_private_literals_are_not_public() {
        for url in [
            "http://169.254.169.254/latest/meta-data/iam/",
            "http://metadata.google.internal/x",
            "http://localhost:8080/",
            "http://127.0.0.1/",
            "http://10.0.0.5/",
            "http://192.168.1.1/login",
            "http://172.16.0.1/",
            "http://[::1]/",
            "http://[fd12::34]/",
            "http://100.64.0.1/",
        ] {
            assert!(!url_is_public(url), "{url} must be refused");
        }
    }

    #[test]
    fn ordinary_sites_are_public() {
        for url in [
            "https://manga.example.com/manga/1",
            "https://api.example.test:8443/v1",
            "https://user@[::ffff:8.8.8.8]:8443/x", // v4-mapped public is still public
        ] {
            assert!(url_is_public(url), "{url} must be allowed");
        }
    }

    #[test]
    fn netloc_splitting_handles_v6_and_ports() {
        assert_eq!(split_netloc("example.com"), ("example.com", 443));
        assert_eq!(split_netloc("example.com:8080"), ("example.com", 8080));
        assert_eq!(split_netloc("[::1]:8080"), ("::1", 8080));
        assert_eq!(split_netloc("[::1]"), ("::1", 443));
    }

    #[test]
    fn resolving_a_private_literal_fails_closed() {
        // Without the env bypass, even no-DNS-needed literals must be refused.
        let r = resolve_public("169.254.169.254:80", Scope::Scripts);
        assert!(r.is_err());
        let r = resolve_public("localhost:80", Scope::Scripts);
        assert!(r.is_err());
    }
}
