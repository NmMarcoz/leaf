//! `leaf.http.get(url, opts)` / `leaf.http.post(url, body, opts)` —
//! the actual security boundary of the sandbox. Lua itself has no ambient
//! network access; these are the only doors, and they only open onto the
//! origins the source declared.
//!
//! Two guards sit underneath every call, both from [`crate::net_guard`]: the
//! agent refuses to connect to private/metadata space at all, and redirects
//! are followed by hand here — ureq's own following would let the *first*
//! server steer a request to an origin the pin forbids, since it never
//! re-checks. Each hop re-runs the pin, so a redirect chain is only as
//! permissive as the script's declared origins.

use std::io::Read;
use std::time::Duration;

use leaf_fetch::url::origin_of;
use mlua::{Lua, Table, Value};

use crate::net_guard;

/// A response body larger than this is almost certainly not the HTML/JSON
/// page a source is after.
const MAX_BODY_BYTES: usize = 16 * 1024 * 1024;

const ACCEPT: &str = "text/html,application/json;q=0.9,*/*;q=0.8";

/// Install `get`/`post` into `table`, refusing any request whose origin isn't
/// in `allowed_origins`.
pub fn install(lua: &Lua, table: &Table, allowed_origins: Vec<String>) -> mlua::Result<()> {
    let origins = allowed_origins.clone();
    let get = lua.create_function(move |lua, (url, opts): (String, Option<Table>)| {
        request(lua, "GET", &url, None, &origins, opts)
    })?;
    table.set("get", get)?;

    // A separate function rather than an `opts.method`/`opts.body` on `get`:
    // a source script reads `leaf.http.post(url, body, opts)` at a
    // glance, where an options-bag method would need its own doc line to
    // explain what unlocks the body.
    let post = lua.create_function(
        move |lua, (url, body, opts): (String, String, Option<Table>)| {
            request(lua, "POST", &url, Some(body), &allowed_origins, opts)
        },
    )?;
    table.set("post", post)
}

/// Shared by `get` and `post`: check the origin, send the request, follow any
/// redirects by hand (re-checking each hop), cap and return the body. `body`
/// carries a POST's JSON payload; `get` has none.
fn request(
    lua: &Lua,
    method: &str,
    url: &str,
    body: Option<String>,
    allowed_origins: &[String],
    opts: Option<Table>,
) -> mlua::Result<Value> {
    let referer: Option<String> = opts
        .as_ref()
        .and_then(|o| o.get::<Option<String>>("referer").ok().flatten());
    // `opts.headers` = extra request headers, applied over the defaults.
    // Some sites key their whole API on a marker header (a scan-group id,
    // an app signature) that no UA/Accept/Referer combination substitutes
    // for; this is still one door behind origin pinning, so which bytes go
    // on the wire is the script's business.
    let headers: Vec<(String, String)> = opts
        .as_ref()
        .and_then(|o| o.get::<Option<Table>>("headers").ok().flatten())
        .map(|t| t.pairs::<String, String>().filter_map(|p| p.ok()).collect())
        .unwrap_or_default();

    // One agent per call: it carries the guarded resolver, and building it is
    // cheap next to the request it is about to make.
    let agent = net_guard::guarded_agent();
    let mut url = url.to_string();
    let mut method = method.to_string();
    let mut payload = body;

    for _ in 0..=net_guard::MAX_HOPS {
        check_origin(&url, allowed_origins)?;
        // The pin is name-level; the resolver also checks the address (a
        // public name rebound to 127.0.0.1 fails at dial time), but failing
        // here gives the script the clearer of the two errors.
        if !net_guard::url_is_public(&url) {
            return Err(mlua::Error::RuntimeError(format!(
                "{url:?} is on a private or metadata address"
            )));
        }

        let built = apply_headers(&agent, &method, &url, referer.as_deref(), &headers)
            .timeout(Duration::from_secs(20));

        let response = match &payload {
            Some(contents) => {
                let built = built.set("Content-Type", "application/json");
                built.send_string(contents)
            }
            None => built.call(),
        }
        .map_err(|e| mlua::Error::RuntimeError(format!("fetching {url}: {e}")))?;

        let status = response.status();

        // The agent runs with redirects(0), so a 3xx lands here instead of
        // being followed invisibly — and the hop is then only taken if it
        // passes the same two checks as the URL the script asked for.
        if (300..399).contains(&status) {
            let Some(location) = response.header("Location") else {
                return finish(lua, status, String::new());
            };
            let from = response.get_url().to_string();
            url = leaf_fetch::url::resolve(&from, location).ok_or_else(|| {
                mlua::Error::RuntimeError(format!(
                    "{from} redirected to an unfetchable {location:?}"
                ))
            })?;
            // A 303 (and, as browsers do, a 301/302 answering a POST) turns
            // the next hop into a GET; the body does not cross the hop.
            if status != 307 && status != 308 {
                method = "GET".into();
                payload = None;
            }
            continue;
        }

        let mut text = String::new();
        response
            .into_reader()
            .take(MAX_BODY_BYTES as u64 + 1)
            .read_to_string(&mut text)
            .map_err(|e| mlua::Error::RuntimeError(format!("reading response from {url}: {e}")))?;
        if text.len() > MAX_BODY_BYTES {
            return Err(mlua::Error::RuntimeError(format!(
                "response from {url} is unexpectedly large"
            )));
        }

        return finish(lua, status, text);
    }

    Err(mlua::Error::RuntimeError(format!(
        "{url:?} bounced more than {} redirects",
        net_guard::MAX_HOPS
    )))
}

/// The header set `leaf_fetch::download::build_request` applies, ported onto
/// the guarded agent so a script's requests present the same User-Agent as
/// the downloader's — one scraper identity, two doors. `extra` are the
/// script's own `opts.headers`, applied last so it can override even these.
fn apply_headers(
    agent: &ureq::Agent,
    method: &str,
    url: &str,
    referer: Option<&str>,
    extra: &[(String, String)],
) -> ureq::Request {
    let mut request = agent
        .request(method, url)
        .set("User-Agent", leaf_fetch::USER_AGENT)
        .set("Accept", ACCEPT);
    if let Some(referer) = referer {
        request = request.set("Referer", referer);
        if let Some(origin) = origin_of(referer) {
            request = request.set("Origin", &origin);
        }
    }
    for (name, value) in extra {
        request = request.set(name, value);
    }
    request
}

fn check_origin(url: &str, allowed_origins: &[String]) -> mlua::Result<()> {
    let origin = origin_of(url).unwrap_or_default();
    if !allowed_origins.iter().any(|allowed| allowed == &origin) {
        return Err(mlua::Error::RuntimeError(format!(
            "{url:?} is outside this source's declared origins"
        )));
    }
    Ok(())
}

fn finish(lua: &Lua, status: u16, body: String) -> mlua::Result<Value> {
    let result = lua.create_table()?;
    result.set("status", status)?;
    result.set("body", body)?;
    Ok(Value::Table(result))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_undeclared_origin_is_refused_before_any_socket() {
        let allowed = vec!["https://manga.example.com".to_string()];
        let err = check_origin("http://169.254.169.254/latest", &allowed).unwrap_err();
        assert!(err.to_string().contains("declared origins"));
    }

    #[test]
    fn a_declared_origin_passes_the_pin() {
        let allowed = vec!["https://manga.example.com".to_string()];
        assert!(check_origin("https://manga.example.com/manga/1", &allowed).is_ok());
    }
}
