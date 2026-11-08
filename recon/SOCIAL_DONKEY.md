# Recon: Donkey (donkey.to) — deep technical teardown

- **Date:** 2026-11-08 (fetch-based recon from the VM: curl + bundle analysis; no live browser)
- **Site:** https://donkey.to/ — Next.js (App Router) SPA, ~26 KB HTML shell, buildId `XuabacoLxND2zCSxzLJmm`
- **Test titles:** F1 (2025, TMDB 911430, IMDb tt16311594) · Queen of Tears (TMDB 215720, IMDb tt27668559 — IMDb id obtained from the keyless TMDB proxy `db.wecollege.net/3`, see below) S1E1

## TL;DR verdict

**Donkey itself has nothing to scrape** — it is a thin TMDB front-end whose only job is building
iframe embed URLs from a TMDB id. The real scrape target behind it (per the upstream rule) is the
**"Wings" sources API, which is alive at `https://api.wecollege.net`** (the host vidy.st uses).
That API is the *same protocol* as the dead `api.speedracelight.com` behind Cineby/Videasy:
seed → encrypted sources payload → the exact XOR keystream decrypt already implemented and
byte-verified in the local, uncommitted `providers/cineby.js`. A working provider is therefore
**EASY–MEDIUM and mostly already built**: repoint the Cineby port at `api.wecollege.net`, send
vidy.st Referer/Origin headers, and call `/<city>/sources` endpoints instead of
`/cdn/sources-with-title`. Live-verified from the VM: F1 → direct HLS 2160p/1080p/720p/480p +
English VTT. Indonesian subtitles for the player experience come from **OpenSubtitles by IMDb id**
(verified: 4 Indonesian tracks for F1 and 4 for Queen of Tears S1E1) — attachable in-provider,
plus the repo's existing FirKaizen helper.

---

## 1. How donkey.to works

- Next.js App Router SPA. Homepage chunks (~700 KB) call **TMDB directly from the browser**:
  `api.themoviedb.org/3/search/multi`, `/3/trending/movie/day`, `/3/trending/tv/day`,
  `/3/genre/...`, `/3/configuration/countries`, `/3/tv/...` — with an embedded key
  (non-standard encoded form in the bundle; value not reproduced here).
  Trending shows also come from **Trakt**: `api.trakt.tv/shows/trending?limit=50`
  (`trakt-api-key` header, embedded key).
- Routes: `/featured?mediaType=movie|tv`, `/media/movie`, `/media/tv`, `/media/recent`,
  `/media/search?query=<q>`, and the player route below.
- Donkey also has a small own backend used for **accounts / watch progress only**
  (`mediaprogress` GET/POST, `user_id` based) — irrelevant to streaming.
- Community: Telegram `t.me/donkey_to`.

## 2. Matching model — TMDB-id keyed

Every Play button / search result navigates to:

```
/watch-now?type=movie|tv&id=<TMDB id>
```

The watch page (`app/watch-now/page-38825d5b035fab95.js`) then fetches TMDB details
`GET api.themoviedb.org/3/<type>/<id>?language=en-US` and builds the embed URL from the detail
object `B`: all servers use `B.id` (TMDB) first, falling back to `B.imdb_id` — **except vidsrc.sh,
which prefers `B.imdb_id`**. TV appends `/<season>/<episode>` (defaults 1/1). No title search
anywhere in the playback path → matching is exact by construction.

## 3. The five embed servers (the actual "sources")

State default is `vidstuck.cc`. URL templates exactly as built by the watch page
(`{type}` = `movie`|`tv`, `{id}` = TMDB id unless noted, `{s}/{e}` only for TV):

| Server (UI key) | Embed URL template |
|---|---|
| `vidstuck.cc` (default) | `https://vidstuck.cc/embed/{type}/{id}/{s}/{e}?loading=2&color=FFA500` |
| `vidy.st` | `https://vidy.st/{type}/{id}/{s}/{e}?color=FFA500` |
| `vidsrc.sh` | `https://vidsrc.sh/embed/{type}/{imdbId}/{s}/{e}&color=FFA500` (IMDb preferred; note the built URL really does use `&color` with no `?` for movies) |
| `https://1embed.cc/embed/` | `https://1embed.cc/embed/{type}/{id}/{s}/{e}?color=FFA500` |
| `https://player.videasy.net/` | `https://player.videasy.net/{type}/{id}/{s}/{e}?color=FFA500` |

Each upstream was followed individually — §4.

## 4. Upstream dissection

### 4a. vidy.st → `api.wecollege.net` — THE prize (Wings API, alive)

vidy.st is a full streaming site itself (Next.js pages router; meta: "embed player, watch movies,
tv shows, anime, iframe player"). Its movie page lazy-loads player chunks (122/6476) containing
a sources client for **`https://api.wecollege.net`** with **18 per-"city" source endpoints**:

`atlanta, austin, berlin, boise, cancun, chicago, dallas, delhi, miami, munich, nashville,
oakland, paris, phoenix, portland, reno, seattle, vegas` — each `GET /<city>/sources`.

Vidy's UI notes per city: Miami/Boise "Original audio. May have 4K"; 11 more "Original audio";
Munich/Berlin "German audio", Paris "French audio", Delhi "Hindi audio", Cancun "Spanish audio".
(City names are source-family labels, **not** CDN geography.)

**Protocol — identical to Cineby/Videasy's Wings scheme, verified live:**
1. `GET https://api.wecollege.net/seed?mediaId=<tmdbId>` → `{"seed":"<...>","ttlMs":30000}`
2. `GET https://api.wecollege.net/<city>/sources?title=<urlenc>&mediaType=movie|tv&year=<yyyy>
   &totalSeasons=<n>&episodeId=<e>&seasonId=<s>&tmdbId=<id>&imdbId=<tt...>&enc=2&seed=<seed>`
   (vidy passes `title` pre-`encodeURIComponent`-ed, i.e. double-encoded on the wire;
   single-encoded also worked in tests)
3. Response is a base64url text payload → XOR with the custom keystream (seed + tmdbId,
   MAGIC `mvm1`, fmix32/fnv1a32 — the exact functions in `providers/cineby.js`) →
   JSON `{sources:[{quality,url}], subtitles:[{lang,language,url}], thumbnail, playlist}`.

**Access gate (important):** the API is behind Cloudflare with a **Referer/Origin allowlist**.
Requests succeed only with `Referer: https://www.vidy.st/` + `Origin: https://www.vidy.st`
(browser UA). Bare requests, and donkey.to/cineby.at referers, get 403 (CF HTML). A provider
just sends those two headers — fetch-only, no problem.

**Cross-checks:**
- `api.speedracelight.com` still 404s every route even with the vidy referer → wecollege is a
  separate, currently-live deployment of the same backend (or its successor host).
- Videasy-style path `/cdn/sources-with-title` on wecollege → 404. Only `/<city>/sources` exists.
- Bonus: `https://db.wecollege.net/3/...` is a **keyless TMDB-shaped proxy** vidy uses for
  metadata (e.g. `GET /3/tv/215720/external_ids` → 200, returned QoT's `imdb_id` with no key).

**Live test results (VM, vidy headers):**

| Call | Result |
|---|---|
| F1 / miami | ✅ 4 sources on **moon.goldenkite.top**: 2160p, 1080p, 720p, 480p (per-quality `index-s<q>-v1-a1.m3u8`) + `playlist` = master.m3u8 on same host; subtitles: `eng` VTT (on same CDN, `/subs/eng.vtt`) |
| F1 / boise | ✅ identical set (same goldenkite file; miami≡boise family) |
| F1 / nashville | ⚠️ inconsistent: one run → 1 source "Auto" @ **sun1.vividstone.top**, no subs; other runs → 401 |
| F1 / vegas, berlin | ❌ HTTP 500 ("vegas: no embed") |
| F1 / seattle, delhi (+ atlanta, oakland, austin, reno at times) | ❌ HTTP 401 — persistent for some cities even with a fresh seed; those endpoints look broken or scoped differently (vidy's own client retries once on 401 with a fresh seed) |
| QoT S1E1 / miami, boise | ❌ HTTP 500 `No streams available for the requested content (S1E1)` |
| QoT / vegas, chicago, portland | ❌ 500 — "no embed" / "title not found" |
| QoT / dallas | ❌ 500 — **`idlix blocked (403 http 403)`** → the dallas source scrapes **IDLIX** upstream and is itself Cloudflare-blocked there |
| QoT / phoenix | ❌ 500 — "gate 502" |
| QoT / nashville | ❌ 500 — `no original audio (available: SOFTBOX)` → QoT exists on nashville only as a "SOFTBOX" variant; vidy's fetcher seemingly requests a specific variant — an unexplored `variant`-style parameter is the one open thread |

Error messages are plain JSON and leak each city's upstream health — per-city availability is
**title-dependent and flaky**; a provider should try 2–4 cities in order and stop at first success.
Latency: ~3 s (miami/boise movie) up to ~15–20 s per TV city (upstream scraping server-side).

**Stream CDN:** `moon.goldenkite.top` (and `sun1.vividstone.top`) — signed URLs (`?s=s1.<exp>.…`).
From the VM, playlist and subtitle fetches return **403 (openresty behind Cloudflare,
`server: cloudflare`, cf-cache DYNAMIC)** under every header combination tried → the CDN blocks
this datacenter IP. Same known pattern as VidAPI/FileLions master playlists, which played fine
from a real browser — **phone/residential playback is plausible but unverified from here**.

### 4b. vidstuck.cc — zxcstream-family player with token-handshake backend

- The embed page is itself a Next.js (Turbopack) SPA player (hls.js + dash.js). Code inspection
  shows the same bundle also serves **zxcstream.cc** (per-hostname GA switch; footer links
  zxcstream.com) — vidstuck and the zxcstream alvin already uses are one family.
- Own backend (origin-relative, all under `https://vidstuck.cc/backend/`):
  - `POST /backend/kawasaki` — handshake: body carries media identifiers (+ a mode field, e.g.
    `"subtitle"`), returns `{ts, token}`. Parameter names are minified/obfuscated in the bundle.
  - `GET /backend/servers/<serverPath>?<ids>&ts=<ts>&token=<token>` → `{links:[{link, …}]}`,
    each `link` passed through a decode transform; servers have `path` + optional dub support.
  - `GET /backend/tmdb/details/<id>/<type>`, `/backend/tmdb/season/...`, `/backend/tmdb/episode/...` — TMDB proxy.
  - `GET /backend/intro?imdbId&season&episode&tmdbId` — intro/outro skip timestamps.
  - `GET /backend/thumbnail?...` — preview sprites.
  - The player listens for `postMessage` from origin `https://vidstuck.cc` (`player-config`:
    autoplay etc.) — this is how donkey syncs settings with it.
  - Behaviour note: if the embedding referrer is **not** on an allowlist (bcine.ru, zflix.me,
    zxcstream.cc, 7movies.ac, vidstuck.cc, xcinematv.com, allflix.org, flyflix.net, localhost),
    the player pops `zxcstream.icu` in a new tab (≤ once/10 min) — an ad redirect when embedded
    on third-party sites like donkey.
- **VM status:** every `/backend/*` probe from the VM hits a Cloudflare "Attention Required"
  block, so the handshake could not be exercised live. The obfuscated kawasaki parameter names
  are the main unknown — pinning them down needs either much deeper bundle reversal or one
  captured browser session (outside this task's fetch-only scope).

### 4c. vidsrc.sh — VidSrc (vidsrcme) family, token chain + Turnstile

Observed chain for F1, all fetchable until the last step:
1. `GET https://vidsrc.sh/embed/movie/tt16311594` → page with
   `data-api="/vs_src.php?type=movie&id=tt16311594"` (+ `sbx.js`, an anti-sandbox blocker whose
   comment names `new.vidsrcme.ru/embed.php` — vidsrc.sh is a vidsrcme front).
2. `GET https://vidsrc.sh/vs_src.php?type=movie&id=tt16311594` →
   `{"src":"https://stellarconductornexus.com/embed/movie/tt16311594?vs=<token>"}` (rotating
   mirror domain + signed token).
3. That page's config exposes `playerUrl":"/embed/player/movie/tt16311594?vs=<token2>"` and
   references `https://data.vidsrc.sh`.
4. The player page loads `player.js`, `subtitles.js`, `vsdec.js` (obfuscated string-array code)
   **and Cloudflare Turnstile** — final stream resolution is bot-gated; not fetch-recon-able
   end-to-end from the VM. Classic VidSrc difficulty profile (cf. the D3adly audit's vidsrc row).

### 4d. player.videasy.net → player.videasy.to

`https://player.videasy.net/movie/911430` **301-redirects to `player.videasy.to`**, which is
unreachable from the VM (connection 000). Its backend is the Wings API (§4a) — dead at
speedracelight, alive at wecollege — so this embed is subsumed by §4a.

### 4e. 1embed.cc

`https://1embed.cc/embed/movie/911430` — connection fails from the VM (000) on every attempt.
Untested; nothing more can be said fetch-side.

## 5. Subtitles — how the "customizable Indonesian subs" actually work

Three distinct mechanisms were found; none of them is donkey's own:

1. **Wings payload subtitles (vidy path):** each `/<city>/sources` response carries
   `subtitles:[{lang, language, url}]` — VTT files hosted next to the streams
   (`…/subs/eng.vtt` on goldenkite for F1/miami). Language set is whatever that source's file
   has; only `eng` observed for F1. Codes are ISO-639-3 style (`eng`; expect `ind` for Indonesian
   when present).
2. **OpenSubtitles REST, queried by IMDb id (vidstuck + vidsrc players):**
   - vidstuck ("libreSubs" hook): movie
     `GET https://rest.opensubtitles.org/search/imdbid-<imdb numeric>`;
     TV `…/search/episode-<e>/imdbid-<imdb numeric>/season-<s>`. Results mapped to
     `{id:"<ISO639>-<n>", display: LanguageName (+ " (HI)"), file: SubDownloadLink}` with the
     download URL rewritten `/filead/`→`/file/`, `/src-api/`→`/subencoding-utf8/src-api/` and
     `.gz` stripped (forces plain UTF-8 subtitle file), fetched via its own
     `/backend/subtitle/prox?url=…` proxy. English sorted first.
   - The vidsrc.sh player's `subtitles.js` uses the same `rest.opensubtitles.org/search` base.
   - vidstuck additionally has a first-party caption service (`POST /backend/kawasaki` mode
     `"subtitle"` → `GET /backend/subtitle?…` → `{captions:[…]}`) queried by
     tmdbId/type/season/episode/title/year — contents not observable from the VM (CF block).
   - **Indonesian availability — VERIFIED directly against OpenSubtitles:**
     F1 (imdbid-16311594): 100 tracks, **Indonesian ×4** (SRT), English ×10.
     Queen of Tears S1E1 (episode-1/imdbid-27668559/season-1): 58 tracks, **Indonesian ×4**,
     English ×4, Korean ×4. No API key needed for the search endpoint.
3. **"Customizable"** = player-side presentation settings (vidy's settings UI literally has
   Subtitles / OpenSubtitles / "Customize appearance"; vidstuck similar). In Nuvio terms this is
   irrelevant — what matters is the subtitle *tracks*, which mechanisms 1–2 supply.

For the repo: an OpenSubtitles attach helper (search by IMDb id → filter `id`+`en` → apply
vidstuck's download-URL rewrite) would guarantee Indonesian subs on any Wings/vidstuck/vidsrc
stream, complementing FirKaizen.

## 6. CDN geography hints

- `api.wecollege.net`, `db.wecollege.net`: behind Cloudflare (CF block pages; allowlist gate) —
  anycast, no single-region signal.
- `moon.goldenkite.top` / `sun1.vividstone.top`: Cloudflare in front (`server: cloudflare`,
  `cf-cache-status: DYNAMIC`, openresty origin), signed URLs. Anycast edge → likely a nearby
  (Singapore) edge for Indonesian viewers, but **no direct SG evidence**; and the VM's datacenter
  IP is 403-blocked, so real-world performance must be judged from the phone.
- vidstuck/vidsrc.sh/donkey themselves: Cloudflare-fronted.

## 7. Feasibility verdict & the exact provider flow

**Donkey as a scrape target: BLOCKED/pointless** — no own catalog API for streams, no own files;
it is five iframe URL templates over a TMDB id.

**The upstream worth building (vidy/Wings at wecollege): EASY–MEDIUM — recommended.**
Rationale: protocol + crypto already implemented and proven in the local Cineby port; the API
answered live from the VM with plain fetch; streams are direct HLS with per-quality renditions
up to 2160p; payload carries its own subtitle tracks; matching is TMDB-id exact.

Provider flow (fetch-only, sandbox-safe — no DOM/crypto libs needed):
1. TMDB meta via the house key: title, year, `imdb_id` (external_ids); for TV also totalSeasons.
2. Headers on every wecollege call: Chrome UA + `Referer: https://www.vidy.st/` +
   `Origin: https://www.vidy.st`.
3. `GET https://api.wecollege.net/seed?mediaId=<tmdbId>` → `seed` (cache ≤30 s per title).
4. For cities in order `miami → boise → nashville → (a few more)`, until first success:
   `GET /<city>/sources?title&mediaType&year&totalSeasons&episodeId&seasonId&tmdbId&imdbId&enc=2&seed`
   → XOR-decrypt (existing verified code) → JSON. On HTTP 401, refresh the seed once and retry
   (mirrors vidy's client). Expect 3–20 s per city; cap total wait.
5. Emit `sources[]` as streams (name e.g. `Wings <city> <quality>`), prefer the `playlist`
   master URL when present; attach payload `subtitles[]` filtered to id/en
   (`ind`→`id`, `eng`→`en`).
6. Attach FirKaizen (existing helper) **and/or** an OpenSubtitles-by-IMDb attach for Indonesian
   coverage (§5.2 — proven for both test titles).
7. Playback headers for the CDN URLs: plain UA is the honest default; the CDN's VM-403 is an
   IP block, not a header gate (all header combos were tried).

**Caveats / open threads:**
- Per-city, per-title availability is spotty (QoT S1E1 found on **none** of 13 cities tried;
  nashville's "available: SOFTBOX" error suggests an unexplored variant parameter that may
  unlock soft-subbed variants — the single most promising follow-up).
- Some city endpoints (seattle/atlanta/austin/reno/oakland/delhi) returned persistent 401 —
  treat the city list as best-effort with graceful fallthrough.
- goldenkite/vividstone playback from a residential IP is **unverified** (VM blocked) — needs
  alvin's phone test, same as VidAPI/FileLions before it.
- vidstuck backend: **MEDIUM–HARD** (kawasaki token handshake with obfuscated param names +
  CF-blocked from VM; would need a captured browser session to pin the params). vidsrc.sh:
  **HARD** (rotating signed mirrors + Turnstile). 1embed.cc: **unknown** (unreachable from VM).

## 8. Concrete URLs observed (evidence index)

- `https://donkey.to/watch-now?type=movie&id=911430` → watch chunk
  `/_next/static/chunks/app/watch-now/page-38825d5b035fab95.js`
- `https://vidy.st/movie/911430?color=FFA500` (donkey embed target; www.vidy.st after redirect)
- `https://api.wecollege.net/seed?mediaId=911430` → `{"seed":"…","ttlMs":30000}`
- `https://api.wecollege.net/miami/sources?title=F1&mediaType=movie&year=2025&episodeId=1&seasonId=1&tmdbId=911430&imdbId=tt16311594&enc=2&seed=…`
  → decrypted `{sources:[2160p/1080p/720p/480p @ moon.goldenkite.top], subtitles:[eng], playlist: …/master.m3u8}`
- `https://db.wecollege.net/3/tv/215720/external_ids` → `{"imdb_id":"tt27668559", …}` (no key)
- `https://rest.opensubtitles.org/search/imdbid-16311594` → 100 tracks incl. Indonesian ×4
- `https://rest.opensubtitles.org/search/episode-1/imdbid-27668559/season-1` → 58 tracks incl. Indonesian ×4
- `https://vidsrc.sh/vs_src.php?type=movie&id=tt16311594` →
  `{"src":"https://stellarconductornexus.com/embed/movie/tt16311594?vs=…"}`
- `https://vidstuck.cc/backend/kawasaki`, `/backend/servers/<path>`, `/backend/subtitle`,
  `/backend/subtitle/prox?url=…`, `/backend/intro`, `/backend/tmdb/details/<id>/<type>`
  (paths from bundle; CF-blocked from VM)
- `https://player.videasy.net/movie/911430` → 301 → `https://player.videasy.to/...` (000 from VM)
