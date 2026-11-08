# Indonesian OTT Streaming Sites — Recon for Nuvio Providers

Recon date: **8 Nov 2026**. All aliveness claims below were verified by direct
fetches from this VM on that date (search snippets alone were not trusted).
Sites already covered elsewhere and excluded here: nakal.id (IDSub, done),
oppadrama (DramaAsia, done), IDLIX (algorithm documented in IDLIX_ALGO.md).

## Summary ranking (build order suggestion)

| # | Site | Stack | Final stream access | Difficulty |
|---|------|-------|--------------------|------------|
| 1 | Nunadrama | WP MuviPro | iframe embeds (strp2p / upns / Abyss) | **Easy** |
| 2 | Terbit21 / BioskopKeren | WP MuviPro (same as above) | same pattern | **Easy** |
| 3 | LK21 / Layarkaca21 | Custom site + public JSON API | videonode.de embed layer | **Easy–Medium** |
| 4 | Rebahin (SobatKeren / CSN network) | Custom PHP | own `/api/stream/source` → m3u8 JSON | **Easy–Medium** |
| 5 | Ganteng21 (ex-DramaQu) | WP dramaXnews | tokenized player API (gtghost) | **Medium** |
| 6 | Kuramanime (anime) | Custom PHP | Kuramadrive / FileMoon embeds | **Medium** |
| 7 | Loklok | App API (JSON) + Vue web SPA | direct m3u8 + soft subs | **Medium–Hard** |
| 8 | LokTV | App-only (Loklok successor) | presumed same API family | **Hard** |
| — | Dutamovie21, Pusatfilm21, FilmApik, Gomov | — | not verified alive/usable | n/a |

---

## 1. Nunadrama — PRIORITY 1

1. **Domains (verified alive):** Gateway/landing `nunadrama.space` (stable,
   always points at the active catalog domain). Active catalog domain at recon
   time: **`s1.nunadrama.sbs`** (HTTP 200, full catalog). The `.sbs` subdomain
   number rotates when blocked (s1, s2, …); a provider should resolve the
   current host by fetching nunadrama.space first. Older domains
   (nunadrama.vip/.store/.asia/.com) are dead/parked SEO shells.
2. **Tech stack:** WordPress + **MuviPro** theme (Indonesian movie theme,
   `wp-content/themes/muvipro`, `gmr-` CSS classes). Server-side rendered HTML,
   no SPA, no Cloudflare challenge from this VM.
3. **URL patterns / search:**
   - Movie post: `/<slug>-<year>/` (e.g. `/boss-2025/`)
   - Series post: `/<slug>-<year>/` and also `/tv/<slug>-.../` (mixed legacy)
   - Episode page: **`/eps/<series-slug>-episode-<n>/`**
   - Search: standard WP `GET /?s=<keyword>`; advanced search via
     `?s=&search=advanced&post_type=movie|tv&genre=&country=&movieyear=`
   - Taxonomies: `/country/korea/`, `/genre/c-drama/`, `/director/<slug>/`
4. **Player structure:** MuviPro player tabs are plain links — server switching
   is a **query parameter on the same episode URL**: default = Server 1,
   `?player=2`, `?player=3`, `?player=4`. Each variant server-renders one
   `<iframe>`:
   - Server 1: `https://nuna.strp2p.site/#<hash>` (own P2P player host)
   - Server 2: `https://nuna.upns.xyz/#<hash>` (UpNShare-style own host);
     movies default to `https://nuna.upns.pro/#<hash>`
   - Server 3: `https://abyssplayer.com/<id>` (Abyss/Hydrax successor —
     public extractors exist)
   - No doo_player_ajax, no encryption on the site layer itself; the hash
     fragment players (strp2p/upns) are one extra resolution layer.
5. **Subtitles:** Hardsub Indonesian burned into the encodes. No separate
   .vtt/track elements on episode pages.
6. **Difficulty: Easy.** Plain SSR HTML + `?player=N` + iframe src regex.
   Only the strp2p/upns hash players need a follow-up resolver; Abyss is a
   known host.

## 2. Terbit21 / BioskopKeren — same stack as Nunadrama

1. **Domains (verified alive):** `terbit21.net` → redirects to
   **`terbit21.org`** (HTTP 200). This is the current front of the
   BioskopKeren network (their Telegram share links and branding point here).
2. **Tech stack:** WordPress + **MuviPro** theme — identical to Nunadrama.
3. **URL patterns:** Category archives like `/streaming-series-sub-indo/`,
   `/bioskop-streaming-subtitle-indonesia/page/<n>/`; WP search `?s=`.
   Title/episode structure follows the MuviPro conventions above.
4. **Player:** MuviPro tabbed player, same `?player=N` iframe pattern family.
5. **Subtitles:** Hardsub Indonesian.
6. **Difficulty: Easy.** A single "MuviPro" provider implementation should
   cover Nunadrama + Terbit21/BioskopKeren (and other MuviPro Indo sites)
   with only the base-domain differing.

## 3. LK21 / Layarkaca21 — clean public JSON API

1. **Domains:** Official fronts rotate (`lk21.de`, `tv12.lk21official.cc`
   seen in the wild Nov 2026); lk21.de itself is Cloudflare-gated and flaky
   from this VM. The practical integration point is the mirror
   **`lk21.mobile`** (HTTP 200, verified), which republishes LK21's catalog.
2. **Tech stack:** Custom PHP/Node-backed site (client-rendered lists) with a
   **public JSON REST API** — the site is itself a scraper of LK21
   (records carry `is_scraped`, `scraped_at`, `scrape_count`).
3. **API (verified live):**
   - Search: `GET https://lk21.mobile/api/v1/movies/?search=<q>` → JSON list
     (slug, title, year, rating, quality, genres, country…)
   - Detail: `GET https://lk21.mobile/api/v1/movies/<slug>` → full record
     including **`imdb_id`** (great for Nuvio's TMDB/IMDb matching) and
     **`streaming_servers: [{name, embed_url}]`**
   - Title page URL: `/<slug>-<year>/`. No `/series/` resource found under
     /api/v1 (probed series/tv/tv-shows/shows → "Endpoint not found");
     series appear to be folded into the movies resource.
4. **Player structure:** `streaming_servers` entries point at an embed
   aggregator: `https://videonode.de/iframe3/{p2p|cast|hydrax}/<token>`
   (server names in API: "P2P 1", "CAST", "HYDRAX 1"; some flagged
   `abyss_dead: true`). The videonode page is a thin JS player
   (`/script.min.js`) — resolving it to a direct file is one extra layer
   that still needs work at build time.
5. **Subtitles:** Hardsub Indonesian (LK21 encodes); the API exposes no
   subtitle tracks.
6. **Difficulty: Easy for metadata + embeds, Medium end-to-end** because of
   the videonode.de resolution layer. The `imdb_id` field makes title
   matching the most accurate of all candidates here.

## 4. Rebahin (+ SobatKeren / CSN network)

1. **Domains (verified alive):** **`rebahin.pintas.vip`** (HTTP 200) and
   `rebahinxxi3.mom`. Part of the SobatKeren/"CSN" network
   (assets on `cdn.assetcsn.site`); sibling fronts on the same stack include
   `animeku.pintas.vip` (Kuramanime-branded anime mirror). The network's own
   code comments reference `csncinema.live` as the reference implementation
   of the same mechanism — one provider likely covers the whole network.
2. **Tech stack:** Custom PHP site (not WordPress), server-rendered,
   TMDB-sourced metadata (posters via image.tmdb.org), hls.js player.
3. **URL patterns / search:** Titles at **/<slug>-<year`** (no trailing
   slash), home sections via `/?section=now-playing|tv-airing|…`,
   search at `/search?q=<q>` (and `/?s=` also responds 200).
4. **Player structure (verified from /js/player.js):** Play/server/episode
   buttons are `.play-thumb` elements carrying a **`data-token`** attribute
   inside `#player-container`. Clicking resolves the token server-side:
   **`GET /api/stream/source?token=<token>`** → JSON
   `{sources: [{url: <m3u8>}]}` played directly via hls.js.
   Caveat: in the raw SSR HTML fetched with curl, the `data-token`
   attributes were not present (container renders progressively) —
   re-verify token placement at build time; worst case the token list is
   embedded in an inline JSON block on the watch view.
5. **Subtitles:** Hardsub Indonesian; the stream API returns only video
   sources, no subtitle tracks.
6. **Difficulty: Easy–Medium.** The API returns ready-to-play m3u8 in one
   call — the cleanest final step of any candidate — pending confirmation
   of where tokens sit in the initial HTML.

## 5. DramaQu → rebranded Ganteng21

1. **Domains (verified alive):** DramaQu officially rebranded (Oct 2026) to
   **`ganteng21.com`** (HTTP 200). The homepage doubles as a hub linking
   sub-brands (/dramaqu/, /drakorindo/, /indoxxi/, /Layarkaca21/,
   /bioskopkeren/, /bos21/).
2. **Tech stack:** WordPress, theme `dramaXnews`. SSR HTML.
3. **URL patterns / search:** Posts at
   **`/nonton-<slug>-<year>-subtitle-indonesia/`**; WP search `?s=`;
   categories under `/category/<genre>/`.
4. **Player structure:** The watch iframe is server-rendered directly in the
   post HTML, pointing at a tokenized player API host:
   `https://getapi.gtghost.biz.id/api/v1/play/<long-token>`.
   Extracting the iframe is trivial; what that token endpoint returns
   (player page → stream) is an extra layer not yet peeled.
5. **Subtitles:** Hardsub Indonesian.
6. **Difficulty: Medium** — easy page scraping, unknown gtghost resolution
   layer.

## 6. Kuramanime (anime)

1. **Domains:** Rotates aggressively with a versioned-domain scheme
   (…v17.kuramanime.ink → currently redirecting to **v20.kuramanime.ing**,
   which 403s this VM — Cloudflare bot wall). `kuramanime.care` now just
   redirects to a shortlink landing. The working front from this VM is the
   mirror **`cache.kuramanime.work`** (HTTP 200, full site).
2. **Tech stack:** Custom PHP application (own assets under /assets/js,
   no WP/Next markers).
3. **URL patterns / search:** Very clean REST-ish paths:
   - Anime: `/anime/<id>/<slug>`
   - Episode: **`/anime/<id>/<slug>/episode/<n>`**
   - Search: GET form to `/anime` (search-anime-form).
4. **Player structure:** Server switching is JS-driven (`changeServer`);
   servers include their own host **Kuramadrive** plus **FileMoon** embeds.
   Download mirrors (Google Drive, MEGA, MediaFire, TeraBox) are a big part
   of the site's model.
5. **Subtitles:** Hardsub Indonesian (fansub encodes).
6. **Difficulty: Medium.** Clean URLs and an open mirror, but the main
   domain churn + JS server switching + FileMoon's own obfuscation add work.

## 7. Loklok

1. **Domains / fronts:** Web SPA at **`loklok.com` / `www.loklok.com`**
   (Vue/Vite app, verified 200) backed by `https://web-api.loklok.top/`
   (plus h5.loklok.site, h5.loklok.team, img.loklok.top). The web bundle
   mostly exposes CMS/config endpoints — the real catalog API is the
   **mobile app API**.
2. **Tech stack:** App-first platform (Android/iOS) with a documented
   JSON API used by the official apps.
3. **Mobile API (from a public client script; host verified alive):**
   - Base: `https://ga-mobile-api.loklok.tv`
   - Headers: `lang`, `versioncode: 33`, `clienttype: android_tem3`,
     `deviceid: <random hex>` — no signing in the documented client.
   - Search: `POST /cms/app/search/v2/searchWithKeyWord`
     `{searchKeyWord, size, sort, searchType}` →
     `data.searchResults[] {id, domainType, name, releaseTime, coverVerticalUrl}`
   - Details/episodes: `GET /cms/app/movieDrama/get?id=<id>&category=<domainType>`
     → `data.episodeVo[] {seriesNo, id, subtitlingList[].subtitlingUrl, definitionList[].code}`
   - Stream: `GET /cms/app/media/previewInfo?category=&contentId=&episodeId=&definition=`
     → `data.mediaUrl` (m3u8)
   - ⚠️ Live probe 8 Nov 2026: the API answers `code 00000 Success` but
     keyword search returned **empty results** with the documented
     (older) parameters — the current app has likely moved versioncode
     and/or added request signing. Needs a fresh capture from the current
     APK before building.
4. **Player structure:** No embeds — API returns direct m3u8 media URLs.
5. **Subtitles:** **Soft subtitles** — a separate `subtitlingUrl` per
   episode with multiple languages including Indonesian. Best subtitle
   support of all candidates (ideal for Nuvio's subtitle picker).
6. **Difficulty: Medium–Hard.** Perfect API shape and soft subs, but the
   current auth/version parameters must be re-reverse-engineered first.

## 8. LokTV

1. **Domains / fronts:** App-only. `loktv.com` and `loktv.app` respond 200
   but are download/landing pages; no web catalog found. Distributed via
   Google Play ("LOKTV: Watch Movies & Series", dev LOKTV DEV /
   Chongqing Jigu Jigu Technology) and APK mirrors (v1.11.0 seen).
2. **Tech stack:** Android/iOS/TV app. LokTV is the successor/rebrand of
   Loklok ("connects the user experience of the original Loklok" per its
   store copy) — a short-drama + movies/series platform.
3. **API:** No public web API located in this pass. It presumably talks to
   the same backend family as Loklok (`ga-mobile-api.loklok.tv`), but that
   is **unverified** — confirming it requires intercepting the current
   app's traffic.
4. **Subtitles:** Multi-language soft subs incl. Indonesian (in-app).
5. **Difficulty: Hard** (for now) — no web surface to scrape; entirely
   dependent on app-API reverse engineering, likely shared with Loklok.

## Not verified / skip

- **Dutamovie21** — current link found via link-list sites
  (`ww2.dutamovie21.mobi`), but the connection failed from this VM
  (HTTP 000). Not verified alive; historically a DooPlay-style WP site.
- **Pusatfilm21** — no verifiable live domain found for Nov 2026 (only old
  TLD references: .com/.org/.cc/.biz/.net). Effectively dormant/rotated
  beyond recognition.
- **FilmApik** — `filmapik.red` redirects to `filmyhub.live`, which returns
  **403 from this VM** (Cloudflare). Historically WP/DooPlay-style; could
  not be inspected.
- **Gomov** — `gomov.me` is now an unrelated cinema-ticket booking site;
  the streaming brand appears gone.
- **SobatKeren** — not a separate target: it is the network brand behind
  Rebahin (§4); its fronts share the CSN stack and `/api/stream/source`
  mechanism.

## Cross-cutting notes for provider builds

- **MuviPro is a force multiplier:** Nunadrama and Terbit21/BioskopKeren
  share the theme; a parameterized MuviPro provider (base URL + `?player=N`
  + iframe regex) covers multiple sites at once.
- **Title matching:** LK21's API is the only candidate exposing `imdb_id`
  directly; elsewhere match Nuvio's TMDB title/year against the site's
  slug patterns (all WP candidates use predictable `<slug>-<year>`).
- **Domain rotation is the norm:** every WP candidate needs a "gateway
  resolution" step (fetch the stable landing domain, discover the active
  host) baked into the provider, exactly like Nunadrama's
  nunadrama.space → s1.nunadrama.sbs.
- **Subtitle reality:** only Loklok/LokTV offer soft .vtt-style Indonesian
  subs; everything else is hardsub (fine for playback, no subtitle track
  to hand to Nuvio).
