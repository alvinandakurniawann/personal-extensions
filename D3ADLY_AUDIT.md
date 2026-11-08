# Audit: D3adlyRocket "All-in-One" Nuvio Plugin Repo

- **Repo:** github.com/D3adlyRocket/All-in-One-Nuvio (manifest v1.0.0, 66 providers)
- **Date:** 2026-11-08
- **Method:** Static analysis only — no provider was executed. Obfuscated files were deobfuscated locally (webcrack) purely to read the code; all findings below come from reading the source.
- **Scope:** 23 general movie/series providers (anime-only, Hindi/Desi, Persian, cartoon, and torrent providers excluded).

## Results table

| Provider | Upstream (type) | Matching | Subtitles attached | Stream form | Proxy / 3rd-party dependency | Size & character | Speed class |
|---|---|---|---|---|---|---|---|
| **playimdb** | VidAPI data API — `streamdata.vaplayer.ru/api.php?tmdb=<id>` (JSON API client) | **TMDB id direct** | **Yes** — API's `default_subs[]` mapped onto streams (languages are per-title, from VidAPI) | Direct m3u8 URLs | None beyond the upstream API itself | 11.8 KB, obfuscated but simple logic | **Fastest** — 1 API call |
| **videasy** | "Wings" API `api.speedracelight.com` (vidking.net front), ~10 sub-sources (cdn, tejo, neon2, mb-flix, m4uhd, superflix…) via `sources-with-title` endpoints; AES-encrypted payloads decrypted locally | **TMDB id + IMDb id** | **Yes** — payload subtitles mapped with proper language codes | Direct URLs per source | API host learned at runtime from a **third-party GitHub config** (`sapariyaneel/nuvio-plugin/domains.json`) | 23.3 KB, obfuscated | Few API calls × several servers |
| **cineby** | Same Wings API (`api.speedracelight.com`, cineby.at front): `/seed?mediaId=<tmdbId>` + `/cdn/sources-with-title`; AES decrypt locally | **TMDB id + IMDb id** | **Yes** — from decrypted payload (url + lang) | Direct URLs (also fetches each HLS to estimate size) | Same third-party `domains.json` config | 19.7 KB, obfuscated | Few API calls + playlist probes |
| **castle** | Castle app backend `api.hlowb.com` — `searchByKeyword`, movie details, `getVideo2` (JSON API client) | TMDB id → TMDB title+year → **title search** on Castle (query includes year; title compared, else first result) | **Yes** — per-language subtitle tracks from the video payload; provider iterates every language version the title has | Direct video URLs (multi-resolution) with playback headers | None (own app API; fetches a "security key" from same API) | 23.5 KB, obfuscated | Several API calls (key, search, details, video per language) |
| **goated** | `api.reallyfast.xyz` — `/api/challenge`, `/api/resolve`, `/api/subtitles` (JSON API client) | **TMDB/IMDb id** (has TMDB find-by-IMDb) | **Yes** — separate subtitles endpoint, filtered + mapped | Direct URLs | API host from same third-party `domains.json` (sapariyaneel) | 21.6 KB, obfuscated | Few API calls + anti-bot challenge step |
| **moviebox** | MovieBox app API `api*.aoneroom.com` (host pool incl. **`api4sg` = Singapore**) + moviebox.ph web playback pages; CloudFront-signed stream URLs | TMDB id → **title search** + `findBestMatch` with **year verification** | **Yes** — dedicated `fetchSubtitles()` per stream/language | Direct HLS + DASH (CloudFront CDN = global anycast) | Token bootstrap from its own app API (`apig.inmoviebox.com`) | 29.7 KB, mostly readable bundle | Moderate chain (search → match → playback page → links → subs) |
| **mapple** | mapple.fun — session handshake + **Proof-of-Work** (`/api/request-token`, `/api/playback-init` with `mediaId = tmdbId`) | **TMDB id direct** | **Yes** — Wyzie (`sub.wyzie.io`, OpenSubtitles aggregator): **all returned languages attached**, incl. Indonesian when it exists | Direct HLS (master parsed into quality variants) | Wyzie subtitle service (public aggregator) | 16.2 KB, readable TS-style code | Session + PoW + a few calls — slower start |
| **vidlink** | vidlink.pro JSON API `/api/b/movie/<encId>`, `/api/b/tv/<encId>/<s>/<e>` → `stream.playlist` | **TMDB id** (encrypted before use) | **No** — provider does not extract VidLink's subs | Direct m3u8 (master parsed into variants) | **⚠️ External crypto helper `enc-dec.app`** called on every request to encrypt the id | 14.4 KB, obfuscated | Few calls (TMDB + enc-dec + API + playlist) |
| **vidrock** | vidrock.net JSON API `/api/movie/<encId>`, `/api/tv/<encId>/<s>/<e>` → server map; stream URLs decrypted locally | **TMDB id** (encoded locally; IMDb→TMDB find supported) | **No** (`subtitles: []` hardcoded, never filled) | Direct URLs per server | API host from third-party `domains.json` (sapariyaneel) | 21.4 KB, obfuscated | Few API calls — fast |
| **showbox** | FebBox (febbox.com): TMDB→share mapping API, then `to_share_page` → `file_share_list` → `video_quality_list` (API client) | **TMDB id** via mapping API | **No** | Direct file URLs, multiple quality renditions | **⚠️ Mapping API is a third-party proxy on HuggingFace (`id-mapping-api-showbox-proxy.hf.space`)**; TripleDES-encrypted responses | 27.2 KB, obfuscated | Few API calls |
| **dooflix** | Panel API `panel.watchkaroabhi.com/api/3/movie/<tmdbId>/links`, `/api/3/tv/<tmdbId>/…/links` (hardcoded API key) | **TMDB id direct** | **No** | ⚠️ **Uncertain** — provider returns whatever one HTTP redirect (from molop.art-fronted links) resolves to; final target may be a file host or an embed | Obscure personal panel backend | 6.3 KB, obfuscated | 1 API call + 1 redirect probe per link — fast |
| **netmirror** | NetMirror mirrors on `net52.cc` (`/mobile/search.php`, Prime/Hotstar variants `/mobile/pv/`, `/mobile/hs/`) — JSON-ish mobile endpoints | TMDB id → title → **title search**, normalized title compare | **No** | Direct files from mirror playlist (labelled quality, `hd=on` cookie) | None | 18.4 KB, readable | Search + playlist per platform, up to 4 platforms tried |
| **moonflix** | Backends on **Railway.app** (`series-production-…`, `hvhyu-…`, `confident-harmony-…`) + player.moonflix.website | **TMDB id** in API paths | **No** | Direct URLs from those backends | **⚠️ Streams depend on someone's personal Railway hobby deployments** | 13.2 KB, obfuscated | Few API calls, but fragile infra |
| **vidsrc** | vidsrc.me classic chain: embed page → `/rcp/<hash>` → `/prorcp/<…>` on rotating rcp domain (whisperingauroras.com) — HTML scraper | **IMDb id** (via TMDB external_ids) in embed URL | **No** (`subtitles: []` hardcoded) | Direct m3u8 after 3–4 page hops | None | 21.6 KB, obfuscated | Heavy scraping chain |
| **vidfast** | vidfast.vc pages + token extraction — HTML/API hybrid scraper | **TMDB id** in page URL | **No** | Direct m3u8 after decryption | **⚠️ `enc-dec.app` called twice per request** (`enc-vidfast` + `dec-vidfast`) | 12.9 KB, obfuscated | Heavy chain (5–6 fetches + 2 external decrypt calls) |
| **vixsrc** | VixSrc/VixCloud embed page scrape → master playlist extracted from embed HTML, token appended with `lang=it` | **TMDB id** | **No** | Direct m3u8 (via embed scrape) | Optional MediaFlow-style proxy fields; bundle oddly references an unrelated Indonesian domain (`komiknostalgia.id`), role not determinable statically | **1.08 MB webpack bundle** (bundled Stremio addon + undici) — by far the heaviest file | Embed scrape (few fetches, huge parse) |
| **purstream** | purstream API `api.purstream.<tld>/api/v1` — `/search-bar/search/…`, `/media/<id>/sheet`, `/stream/<id>/episode` | **Title search** | **No** (site is French VF/VOSTFR — subs are French, not attached as tracks) | Direct m3u8/mp4 | API host from third-party `domains.json` (wooodyhood) | 15.9 KB, obfuscated | Few API calls |
| **1shows** | viduki API `api.viduki.net` (`/download-token`, `/download/movie/<tmdbId>`, `/download/tv/<tmdbId>/<s>/<e>`) → resolves file-hoster download sources (Pixeldrain, Streamtape, unlock flows…) | **TMDB id direct**; results filtered by year-in-label check | **No** | Direct file URLs from download hosters (download-oriented, often large files) | Hoster sites (Pixeldrain etc.) | 53.8 KB, obfuscated, big extractor toolkit | Heavy multi-hoster chain |
| **onlykdrama** | onlykdrama.shop HTML scrape (og:title/year parsing, URL scoring) → FilePress API (`new5.filepress.wiki/api/file/downlaod*`) | **Title/URL scoring** — most error-prone in this list | **No** | Direct file URL from FilePress | FilePress hoster | 19.9 KB, semi-readable bundle | Heavy scraping chain; K-drama only |
| **cinefreak** | cinefreak.nl WordPress API search (`/wp-json/wp/v2/search`) → post page → CineCloud file host (`new5.cinecloud.site/f/<id>`) | **Title search** (TMDB title) | **No** (MKV files may contain subs internally — not exposed) | Direct MKV file links | None | 30.3 KB, semi-readable | Moderate scraping chain; Dutch site |
| **fibwatch** | fibwatch.art HTML scrape: `/search?keyword=` → title page → `/ajax/resolution_switcher.php`, `/ajax/episodes.php`; regex-extracts file URLs | **Title search** | **No** | Direct m3u8/mp4/mkv URLs regexed out of page data | Domain list from third-party GitHub config (phisher98/TVVVV) | 8.1 KB, readable | Moderate scraping chain |
| **allmovieland** | allmovieland.you (DataLife Engine) HTML scrape: `index.php?story=…&do=search` → post → embed "p3 JSON" → playlist | **Title search** | **No** | Direct URLs from embed playlist JSON | None | 14.5 KB, obfuscated | Moderate-heavy scraping chain |
| **cinemacity** | cinemacity.cc — finds title pages via the site **sitemap** (`news_pages.xml`) + an ID-mapping service (`animemapping.realbestia.com`), scrapes pages/hoster embeds (e.g. MixDrop) | Sitemap **title search** with TMDB/IMDb mapping cross-checks | **No** | Hoster stream links extracted from embed pages | Third-party ID-mapping service | 49.2 KB, obfuscated, complex | Heavy scraping chain |

## Red flags & dependencies worth knowing

- **`enc-dec.app`** (vidlink, vidfast): every request phones a stranger's crypto-as-a-service to encrypt/decrypt ids. If it dies or turns hostile, both providers break; it also learns what you watch.
- **`hf.space` mapping proxy** (showbox): the TMDB→FebBox mapping — the single point of failure — is a third-party HuggingFace Space, not ShowBox infrastructure.
- **Railway hobby backends** (moonflix): stream resolution depends on three personal `*.up.railway.app` deployments.
- **Third-party `domains.json` configs** (videasy, cineby, vidrock, goated, purstream, fibwatch): at runtime these fetch a JSON from someone else's GitHub repo (sapariyaneel, wooodyhood, phisher98) to learn which API host to call. Whoever edits that file redirects the provider. Porting any of these should pin the host in code.
- **vixsrc**: 1 MB bundle (an entire Stremio addon + HTTP library), Italian-language bias (`lang=it` hardcoded), and an unexplained reference to `komiknostalgia.id`.
- **dooflix**: hardcoded API key against an obscure personal panel (`panel.watchkaroabhi.com`); final stream URL is whatever a redirect lands on — the only provider whose output form can't be confirmed from code.
- Nothing in the 23 phones home with user credentials or tokens; the embedded TMDB keys are the usual public/shared ones. Several providers set `skipSizeCheck` and custom playback headers — normal for this ecosystem.

## Ranked shortlist — best candidates to port

Criteria applied: free only · Indonesian + English subtitles preferred (English-only acceptable) · good quality without constant buffering · stream CDN close to Indonesia (Singapore/Asia edge or global anycast) · exact title matching.

### Tier 1

1. **PlayIMDb (VidAPI)** — The cleanest fit: one TMDB-keyed API call returns direct m3u8 streams **with subtitle tracks attached by the API itself** (VidAPI is known to carry Indonesian + English subs on many titles). Tiny, fast, exact matching. Porting is trivial — it's a single-endpoint client.
2. **Videasy** — TMDB+IMDb-keyed aggregation over ~10 sources behind one API, with **real subtitle attachment incl. language codes** and locally decrypted payloads (no external crypto service). Pin the API host instead of trusting the third-party domains.json.
3. **Cineby** — Videasy's simpler sibling on the same backend: one source family, encrypted payload decrypted locally, subtitles attached, TMDB+IMDb keyed. Less coverage than Videasy, less to go wrong.
4. **Castle** — The only other provider with **genuine per-language subtitle tracks built in**: it iterates every language version Castle carries and attaches that version's subs (Castle's catalog is SEA-oriented, so Indonesian subs are plausibly common — per-title, not guaranteed). Direct multi-resolution streams. Its one weakness vs the criteria: matching is a title+year search, not id-keyed.
5. **Goated** — Id-keyed resolve + a dedicated subtitles endpoint on the same API, direct streams. Ranked below the Wings pair only because of the extra anti-bot challenge step and the same third-party domain-config dependency.

### Tier 2 (port with a compensating move)

6. **MovieBox** — Best CDN story in the list (CloudFront anycast + a Singapore API host), dedicated subtitle fetching, and its title search is disciplined (year must match). Heavier flow (web playback pages, signed cookies) and search-based matching keep it out of Tier 1.
7. **Mapple** — Exact TMDB matching and **Wyzie subtitles (every language Wyzie/OpenSubtitles has, incl. Indonesian) attached to all streams**. The PoW + session handshake makes it slower to first stream, and it's a single smaller hoster.
8. **VidLink** — Fast, exact, direct m3u8 with quality variants — but no subtitles extracted and it depends on `enc-dec.app`. Portable only if the id-encryption is reimplemented locally or the dependency is accepted; the personal repo's existing FirKaizen subtitle attach would cover subs.
9. **VidRock** — Same shape as VidLink minus the external crypto service (decryption is local) but also subtitle-free; FirKaizen attach compensates. Pin the API host when porting.
10. **ShowBox** — Historically excellent direct-file quality in several renditions and exact TMDB mapping, but no subtitles (FirKaizen attach compensates) and the mapping depends on a third-party HuggingFace proxy that could vanish — port with that risk written on the label.

### Not recommended for this repo

- **vidsrc / vidfast** — heavy embed chains; vidfast also depends on enc-dec.app twice per call; neither attaches subtitles.
- **netmirror, fibwatch, allmovieland, cinemacity, onlykdrama, cinefreak** — title-search HTML scrapers with no subtitle support; mismatch-prone (onlykdrama's URL-scoring is the worst offender) or region-locked catalogs (cinefreak = Dutch, cinemacity leans anime-mapping).
- **purstream** — French-dubbed/subbed catalog; wrong subtitle languages for this owner.
- **moonflix** — streams resolve through personal Railway hobby servers; reliability and provenance are unacceptable for a curated repo.
- **dooflix** — no subtitles, opaque panel backend, and its output is a blind redirect target (may be an unplayable embed).
- **1shows** — download-hoster files (Pixeldrain etc.) rather than streaming-optimized HLS; heavy, no subtitles.
- **vixsrc** — 1 MB bundled addon, Italian bias, no attached subtitles, unexplained third-party domain reference.

## What static analysis cannot verify

- **Actual playback quality and buffering** — no provider was run. "Good quality" above is inferred from stream form (direct HLS/file vs embed) and advertised renditions only.
- **True stream-CDN geography** — code reveals hosts, not edge locations. CloudFront (MovieBox) and the `api4sg` host are the only hard Singapore/anycast signals; for the API-based providers (VidAPI, Wings/speedracelight, hlowb) the video CDN sits behind the API response and can't be geolocated from source.
- **Per-title Indonesian subtitle availability** — providers marked "Yes" attach whatever the upstream returns for that title; whether a given film actually has an Indonesian track is only knowable at request time. The personal repo's FirKaizen subtitle attach remains a useful safety net for every port.
- **Longevity** — several upstreams rotate domains (hence the runtime `domains.json` pattern); a provider that is accurate today can silently degrade when its config or backend moves.
