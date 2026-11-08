# Recon: cinex.watch & play.firkaizen.id — 2026-11-08

Verified by live fetches from the assistant's VM (curl). Both sites reachable from the VM.
Caveat on networking: the VM's DNS resolves public hosts into a 198.18.x.x proxy range, so
real server IPs were obtained via Google DNS-over-HTTPS instead. All four relevant domains
(cinex.watch, play.firkaizen.id, player.videasy.ws, vidlink.pro) sit behind **Cloudflare
anycast** (172.67.x / 104.21.x). No master playlist could be reached fetch-only from either
site (both video paths are encrypted JS players), so stream resolution variants and stream
CDN locations are **not directly verifiable** from the VM — a live browser session would be
needed for those two points.

---

## 1. Cinex — https://cinex.watch

**What it is.** Free streaming frontend: movies, series, anime, K-drama, C-drama, J-drama,
Thai drama, Pinoy, Bollywood (its own browse categories). React/Vite SPA (single bundle
`/assets/index-*.js`, lazy chunks for Detail / Watch / ServerPicker / Search). Homepage
responded 200 in ~0.4s from the VM. Cloudflare-fronted.

**Catalog & matching.** Metadata comes straight from the public TMDB API
(`api.themoviedb.org/3`, key embedded in the bundle); posters from image.tmdb.org.
Routes: `/browse/movie`, `/browse/tv`, `/browse/:type/genre/:genreId`,
`/browse/:type/category/:categorySlug`, detail `/movie/:id` (TMDB id), watch page with a
server picker. Search = TMDB `/search/multi`. **Matching from TMDB id is native** — the
whole site is keyed by TMDB id, so title accuracy is as good as TMDB itself.

**Player structure.** Cinex hosts **no streams and no subtitle service of its own**. Its
ServerPicker chunk lists iframe embed aggregators, all keyed by TMDB id
(`(id) => .../embed/movie/${id}`, `(id, s, e) => .../embed/tv/${id}/${s}/${e}`):
- "Main Server" — `vidstuck.cc/embed/...` (the zxcstream player stack; `embed.zxcstream.xyz/player/...` also present)
- "Server 1" — `player.videasy.ws/embed/movie/<id>?autoplay=1&ds_lang=en` (Videasy)
- Backups — `vaplayer.ru` (VidAPI), `vidsrcme.ru` (VidSrc), `vidlink.pro`, `vidfast.vc`,
  `vidbolt.xyz`, `cinesrc.st`, and more

**Subtitles.** None first-party and no fetchable tracks. Subtitles exist only *inside* each
embed player (Videasy exposes subtitle language selection in its own UI; Cinex passes
`ds_lang=en`). A fetch-only provider cannot extract them from Cinex.

**Stream reachability (probed).** Videasy embed page for F1 (TMDB 911430) loads only a
1.2 KB sandbox stub (`/assets/sbx.js`) that redirects to `/sandbox.php` — the real player
and its (encrypted) source API sit behind that; no m3u8 in the page. VidLink's old
`/api/b/movie/?id=` path now returns the app's 404 page (scheme changed). **No playable
stream URL could be extracted fetch-only.**

**Quality / delivery.** Unverifiable from the VM (see caveat). In-browser, these players
serve adaptive HLS; Cinex's own origin is Cloudflare anycast (Indonesian users typically
land on a Jakarta/Singapore CF edge for the web layer — the stream CDNs behind the
encrypted players are a separate, unverified hop).

**Difficulty: HARD / low value as a scrape target.** It is a shell over the same upstream
embed ecosystem already mapped via zxcstream (VidSrc, VidAPI, VidLink, Videasy). Scraping
"Cinex" adds nothing; the upstreams themselves are the targets, and the two most prominent
(Videasy, VidLink) encrypt their source calls.

---

## 2. FirKaizen — https://play.firkaizen.id

**What it is.** Indonesian hobby "premium-style" streaming app (custom vanilla-JS frontend,
`/static/js/index.js`, same-origin JSON API). Profiles, watch-party (`/api/party/`),
accounts (`/api/me` → `{"logged_in":false}` when logged out), and a VIP model: code
comments state non-VIP users get a lifetime play quota enforced via `/api/can_play`.
Homepage 200 in ~1.2s from the VM. Cloudflare-fronted.

**Catalog & matching.** TMDB-based (image.tmdb.org posters; all its APIs and players are
keyed by `tmdb_id`). Title pages are client-side (no server-rendered `/movie/tmdb/<id>`
route — that path 404s).

**Player structure (video).** Same embed-aggregator pattern as Cinex — a server rotation /
auto-failover list: `vidsrcme` (VidSrc), `videasy` (player.videasy.net), `vidfast`,
`vidzee` (player.vidzee.wtf), `embedapi` (apiplayer.ru = VidAPI), `vidstreams`
(autoembed.co), `111movies`, `2embedcc`, `vidlink` — all TMDB-id iframe embeds. **No
first-party video streams**, and the same encryption caveat as Cinex applies to resolving
them fetch-only.

**Subtitles — the standout asset.** FirKaizen runs its own **open subtitle API**:

```
GET https://play.firkaizen.id/api/subtitles/file?tmdb_id=<id>&media_type=movie|tv&language=id|en[&season=<s>&episode=<e>]
```

- **No authentication required** (verified logged-out from the VM).
- Returns a real **soft WEBVTT** file (`Content-Type: text/vtt`), served from the site's
  own Cloudflare-fronted origin.
- Per the frontend code, the pool is built from OpenSubtitles converted to VTT, originally
  designed to be injected into the VidLink player as an external `sub_file`. In a Nuvio
  provider, the same URL can be attached directly as a soft subtitle track to any stream
  resolved by TMDB id.
- Verified samples (2026-11-08):
  - F1 (TMDB 911430), movie, `language=id` → 200, **170,540 bytes** of genuine Indonesian VTT
  - F1, `language=en` → 200, **181,639 bytes**, a *different* file (real English track)
  - Queen of Tears (TMDB 215720), tv S1E1, `language=id` → 200, **93,066 bytes**, correct episode subs
  - The Dark Knight (TMDB 155), movie, `language=id` → 200, **126,670 bytes** (pool covers older catalogue too)
  - Unknown TMDB id → 404 `{"error":"Subtitle gak ketemu buat judul ini"}`
- Exact parameter names matter: `tmdb_id`, `media_type`, `language` (a `lang=` variant is
  silently ignored and falls back to Indonesian).

**Quality / delivery.** Video: same unverifiable-encrypted-player situation as Cinex.
Subtitles: tiny text files on Cloudflare anycast — effectively instant from anywhere,
including Indonesia.

**Difficulty: subtitles EASY, video HARD.** The subtitle API is a clean, unauthenticated,
TMDB-keyed endpoint — the single most reusable asset found in either site. It can upgrade
*every* existing provider in the personal plugin (attach id+en soft subs by TMDB id),
independent of where the video stream itself comes from.

---

## Bottom line

| | Cinex | FirKaizen |
|---|---|---|
| Own streams | None (embed shell) | None (embed shell) |
| Own subtitles | None | **Yes — open API, id + en soft VTT, no auth** |
| TMDB-id matching | Native | Native |
| Fetch-only stream extraction | Blocked (encrypted players) | Blocked (same upstreams) |
| Scrape difficulty | Hard, low added value | **Easy for subtitles**, hard for video |
| Recommendation | Skip; mine its server list only | **Adopt the subtitle API plugin-wide**; skip its video |
