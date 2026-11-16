# Writing a Leaf extension

A Leaf extension is one `.lua` file: a script that teaches the app a manga
site it has no built-in client for. It is not a plugin in the usual sense —
there is no UI hook, no event system, no install step. The script answers a
fixed set of functions and the rest of the app treats its site exactly like
MangaDex.

If you know a Tachiyomi/Keiyoushi `HttpSource`, you know this: the method
names and shapes deliberately mirror `CatalogueSource`, so porting is mostly
translating Kotlin selectors into `leaf.html.select` calls.

## The one-minute version

```lua
-- my-site.lua
SOURCE = {
  id       = "user.my-site",          -- stable, namespaced; stored on series rows
  name     = "My Site",               -- shown in pickers
  lang     = "en",                    -- ISO 639-1
  base_url = "https://my-site.example",
}

function popular(page)
  local res = leaf.http.get(SOURCE.base_url .. "/browse?page=" .. page)
  local data = leaf.json.decode(res.body)
  local out = {}
  for i, row in ipairs(data.results) do
    out[i] = { id = row.slug, title = row.name, cover_url = row.thumb }
  end
  return { manga = out, has_next_page = #out > 0 }
end

function latest(page)  return popular(page) end
function search(query, page)
  local res = leaf.http.get(SOURCE.base_url .. "/search?q=" .. query .. "&page=" .. page)
  -- ...same shape as popular
end

function manga_details(id)
  local res = leaf.http.get(SOURCE.base_url .. "/manga/" .. id)
  local doc = res.body
  local title = leaf.html.select(doc, "h1")[1].text
  return { title = title }
end

function volumes(id, language)
  local res = leaf.http.get(SOURCE.base_url .. "/manga/" .. id .. "/chapters")
  local data = leaf.json.decode(res.body)
  local chapters = {}
  for i, row in ipairs(data.chapters) do
    chapters[i] = { number = row.num, id = row.slug, title = row.name }
  end
  return { { volume = "1", chapters = chapters } }
end

function covers(id) return {} end      -- optional in spirit; the fn is required

function page_list(chapter_id)
  local res = leaf.http.get(SOURCE.base_url .. "/read/" .. chapter_id)
  local out = {}
  for i, img in ipairs(leaf.html.select(res.body, ".reader img")) do
    out[i] = img.attrs["src"]
  end
  return out
end
```

Test it from a terminal before touching the app:

```sh
Leaf sources test my-site.lua --id one-piece --popular
```

That loads the script through the real sandbox against the real network,
prints each call's result, and registers nothing anywhere.

## Installing and approving

Drop the file in `<library>/extensions/` — by default `~/Leaf/extensions/`.
Both the CLI and the app read that one folder, and it travels with your
library. There is no install step and no restart: every source command builds
a fresh registry from the folder, so a save is picked up by the next call.

The app will **not** run it yet. A script is code running with the app's
network access, so the desktop asks first: open *Add from a source* and the
new file appears in a pending panel with two choices.

- **Approve** freezes the current bytes: a sha256 is recorded as the
  approval, and any later edit re-gates the file, because what you approved
  was the old bytes. This is what you want for a finished extension from
  someone else.
- **Develop** puts the file in development mode: it is registered whatever
  its current contents are, so saving takes effect with no re-ask — the
  save-forty-times loop you need while authoring. When the script is done,
  **Lock** converts its current bytes into a real approval and leaves dev
  mode; from then on edits re-gate like any other file.

(The CLI skips all of this — see below — but since dev mode exists, you can
now iterate inside the app itself. Note the promise dev mode makes is about
the *file*, not its bytes: keep it on only for scripts you are writing.)

The CLI skips the gate on purpose — you chose to run a terminal against your
library — so `sources test` and `library get` work on any script regardless
of its approval state. It is still the fastest feedback loop: no dialog, and
every call's return printed.

## The sandbox

You get Lua 5.4 with `table`, `string`, `utf8` and `math` — plus four host
modules, and nothing else:

| | |
| --- | --- |
| `leaf.http.get(url, opts?) → {status, body}` | `opts.referer` sets a `Referer` header |
| `leaf.http.post(url, body_string, opts?)` | sends `body` with `Content-Type: application/json` |
| `leaf.html.select(html, css) → rows` | each row: `.text`, `.html`, `.attrs` (e.g. `row.attrs["src"]`, `row.attrs["data-src"]`) |
| `leaf.json.decode(s)` / `leaf.json.encode(v)` | plain Lua tables in and out |
| `leaf.time.now() → seconds` | the only clock — `os` does not exist |

Not available, by design:

- **No `os`, no `io`, no files.** The script never touches your disk.
- **No `require`, no `load`.** Everything you need goes in the one file.
  Two scripts cannot share code; copy the helper in.
- **No network except `leaf.http`** — and it is bounded twice: requests only
  go to `base_url` (plus an optional `mirrors = {...}` list in `SOURCE`), and
  the host refuses to connect to any loopback/private/link-local/metadata
  address even if a name resolves there. Redirects are followed only when
  they land back inside your declared origins.
- **No crypto library.** If the site needs an MD5 token, you write MD5 in
  Lua — `example.lua` carries a pure-Lua one as the worked example
  (masking to 32 bits after each step, since Lua 5.4 integers are 64-bit).
- **20 seconds per call.** `popular`, `search`, `page_list` — each is aborted
  if it runs longer, and the source is dead for the rest of the session.
  Keep work per call to one or two HTTP round-trips.

## What each function must return

All shapes are plain tables; missing optional fields are fine.

- `popular(page)` / `latest(page)` / `search(query, page)` →
  `{ manga = { {id, title, cover_url?}, ... }, has_next_page = bool }`.
  Pages are 1-based. `id` is whatever *you* need back to identify the manga —
  it is stored verbatim in the library's `source_id` column and passed to
  every other function. Use a slug or site id, not a URL, if you can: the
  app re-reads through your functions later with no memory of how the id was
  built.
- `manga_details(id)` → `{ title, author?, artist?, description?, tags?,
  content_rating?, available_languages?, cover_url? }`. `title` is required.
- `volumes(id, language)` → `{ { volume = "1", chapters = { {number, id, title?}, ... } }, ... }`,
  oldest first. `number` is what the library sorts and names folders by, and
  what it matches across translations — keep it the plain chapter number as a
  string (`"7"`, `"10.5"`), not the display label. `language` may be `nil`;
  ignore it unless the site serves several.
- `covers(id)` → `{ {url, thumbnail_url?, volume?}, ... }` — per-volume cover
  art the shelf shows. Returning `{}` is fine.
- `page_list(chapter_id)` → an array of image URLs **in reading order**.
  The app downloads them exactly as given. Relative URLs are resolved against
  the chapter page you got them from; `data:` URIs work too. Note the guard:
  page URLs pointing at private addresses are dropped before download.

## Debugging tips

- **`Leaf sources test` prints each call's return values** and is much faster
  than the GUI for selector work. `print(...)` works and lands on the CLI's
  stdout, so `print(body:sub(1,500))` is the quick look at what a call
  actually received; inside the GUI, stdout goes where the app was launched
  from, so `error("dbg: " .. …)` is the way to see a value there — the error
  text surfaces verbatim in the app's toast.
- **The site you are scraping is not the site `curl` sees.** The downloader
  sends a `User-Agent` of `Leaf/<version>`; hotlink-protected images 403
  without the right `Referer`, so pass `opts = { referer = SOURCE.base_url }`
  (or the chapter URL) on image requests. If a `leaf.http.get` answers HTML
  where you expected JSON, the site is probably checking something header-wise
  — try `curl` with the app's UA to reproduce.
- **Lazy-loaded galleries**: many readers put the real URL in
  `data-src`/`data-lazy-url` and a placeholder in `src`. Check both:
  `img.attrs["data-src"] or img.attrs["src"]`.
- **A chapter whose pages all vanish at the app's size sieve** is usually
  your `page_list` returning the thumbnail route instead of the full image.
- If the app silently ignores your file while the CLI loads it, the
  fingerprint changed (you edited since approving) — look in the pending
  panel. If the CLI *also* ignores it, the script failed to load; the CLI
  prints why, the app deliberately does not.

## The rules the format encodes

- One file, one site. `SOURCE.id` is forever: it is stored on every series
  the user adds through you. Pick it once, never reuse it for another site.
- Never block on interactivity — a script runs on a worker thread answering
  calls; there is no user to ask for credentials. If a site needs a login,
  the honest answer is a `cookie` string in `opts` you cannot yet populate,
  so: document it, or don't write that site.
- Be polite to the site: one request per call where you can, no scraping
  ahead of what the app asked for. The app already paces its chapter
  downloads; your `page_list` is not the place to pre-fetch.
