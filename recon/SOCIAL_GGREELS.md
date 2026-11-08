# Recon: GGReels (v1.ggreels.site)

- **Date:** 2026-11-08
- **Domains:** v1.ggreels.site (main, Indonesian UI under `/id/`; the `/id` prefix is optional — canonical URLs are root-level), ggreels.my.id (small landing/hub, ~7.5 KB), ggreels.web.id (backup, not probed).
- **Stack:** Server-rendered pages (Alpine.js + ArtPlayer + hls.js), JSON-LD structured data, ad scripts (popunder networks). No public API found; everything needed is in SSR HTML.
- **Nature:** An aggregator of ~39 short-drama platform catalogs plus separate Drakor, Anime, Anichin (Chinese animation), BonusTV, WeTV, and Movie sections.

## URL map

Short-drama platforms (nav sections): `/id/<platform>` where platform ∈ cashdrama, dotdrama, dramabite, dramaboxv3, dramanova, dramapops, dramarush, flareflow, flextv, flickreels, freereels, goodshort, happyshort, idrama, melolo, meloshort, microdrama, minishort, moboreels, netshort, playlet, rapidtv, raptdrama, reelbuzz, reelshort, sereal, shorten, shortmax, shortsky, shortwave, shotshort, snackshort, stardusttv, starshort, storyreel, vibeshort, bonustv.

| Section | Listing | Detail | Watch |
|---|---|---|---|
| Short drama | `/id/<platform>` | `/<platform>/detail/<slug>.<numericId>` (+ query params `title`, `poster`, `episodesCount`, `description` — display metadata only) | `/<platform>/watch/<numericId>?ep=<n>` (slug form also works) |
| Drakor | `/id/drakor` (+ `/ongoing`, `/complete`) | `/drakor/detail/<english-slug>-<year>` | `/drakor/watch/<slug>?episode=<n>` |
| Anime | `/id/anime` (+ `/ongoing`) | `/anime/detail/<romaji-slug>` | `/anime/watch/<slug>-episode-<nn>-subtitle-indonesia` |
| Movie | `/id/movie` (+ subcats trending/hollywood/kdrama/anime/indonesian-movies/indonesian-drama/short-tv/western-tv) | `/id/movie/detail/<slug>-<opaqueId>` | `/movie/watch/<slug>-<opaqueId>?season=<s>&episode=<e>` |
| Search | `/id/search?q=<title>` — results are NOT in the SSR HTML (loaded client-side; endpoint not found in page source) | | |

## The player mechanism (short-drama + movie sections)

Watch pages embed an ArtPlayer config in an inline script:

```js
const videoUrl = "/api/cors-proxy.php?url=<double-base64>&drm_key=<token>"; // short-drama
const videoUrl = "/api/proxy/<double-base64>";                              // movie section
```

- The `url` value is the real stream URL encoded in base64 twice.
- **The proxy is the key asset.** Fetching the proxy URL returns the playlist with *every* inner URL rewritten back through the same proxy: variant playlists, segments, and even the HLS `EXT-X-KEY` URI. For Tencent-VOD "SimpleAES" titles, the proxy performs the license exchange server-side — a plain GET of the rewritten key URI returned exactly 16 bytes (`application/octet-stream`), i.e. the raw AES-128 key. From a player's perspective the whole chain is bog-standard HLS (or plain MP4), so a Nuvio provider only has to hand over the `videoUrl` string scraped from the watch page.

## Per-source results (all verified by fetch, 2026-11-08)

### CashDrama (short drama) — Tencent Cloud VOD, Singapore
- Example: "Pekerja Bangunan Terkuat" (site id 22343, 100 eps).
- Decoded stream: `https://cashdrama-vod.jowo.tv/c86bf524vodtranssgp1500039468/<fileId>/adp.112.m3u8?encdomain=cmv1` — bucket names contain `sgp` = Tencent VOD Singapore region; appId 1500039468 (from the page's DRM-token payload structure).
- Master playlist: single 1080x1920 (vertical) variant. Variant playlist: segments are AES-128 encrypted, key URI `https://drm.vod2.myqcloud.com/getlicense/v1?drmType=SimpleAES` (plain GET → 403; token POST required — the GGReels proxy handles this, see above).
- Via the proxy: playable end-to-end (master → variant → 16-byte key all served).

### DramaRush (short drama) — ShortTV on Akamai
- Example: "[Dijuluki] Sang Manusia Abadi" (id 8497, 55 eps); covers on `akamai-static.shorttv.live`.
- Decoded stream: `https://akamai-static.shorttv.live/hls/<uuid>_1080/main.m3u8?auth_key=<...>` — that URL is itself a media playlist (10 s segments, no encryption, no subtitle renditions).
- Direct Akamai fetch is denied (signed URL is bound to the proxy path); through the GGReels proxy the playlist + segments flow fine.

### DramaBox (dramaboxv3) — Huawei Cloud signed MP4
- Example: "Istri yang Diremehkan" (DramaBox content id 42000030762); covers on `hwztchapter.dramaboxdb.com`.
- Decoded stream: `https://hwztvideo.dramaboxdb.com/.../701769935.720p.narrowv3.mp4?Expires=<...>&Signature=<...>` — direct progressive MP4, no DRM token. Range probe returned HTTP 206 with real MP4 bytes (`ftyp isom`). Cleanest source on the site.
- `qualities` array was populated (multiple resolutions, also via proxy); `subtitles` empty.

### Movie section — direct MP4 on an Indo CDN
- Example: "Pay Later" S1E1 (Indonesian series; the section mixes films and series).
- Decoded stream: `https://bcdnxw.hakunaymatata.com/resource/<hash>.mp4?sign=<...>&t=<...>` — signed direct MP4 via the `/api/proxy/` variant. No DRM.

### Drakor section — embed shell over DrakorID
- Example: "Sunshine through the Rain (2026)" ep 1. Watch page carries an Alpine `servers` array with double-base64 URLs that decode to third-party embeds:
  - `Cita (Indo)` → `https://drakorid.store/?v=<id>` (DrakorID's own player)
  - `Kangguru` → `https://bysesayeveum.com/e/<id>/drakorid-720p-<slug>-ep<n>` (FileLions-family embed host; the filename betrays that the catalog is DrakorID's uploads)
- GGReels adds no stream of its own here; any provider value belongs to a DrakorID/FileLions resolver, not to GGReels.

### Anime section — embed shell over AnimeKompi + Blogger + Abyss
- Example: "Black Clover 2nd Season" ep 1; server list decodes to:
  - `HD Hemat` → `blogger.com/video.g?token=<...>` (Google-hosted)
  - `HD Hemat 2` → `player.abyssplayer.com/<id>` (the known Abyss embed wall)
  - `Pixel HD` → `https://v10.animekompi.sbs/api/episodes/stream/<signed-id>` (AnimeKompi backend API)
- Same conclusion as Drakor: scrape the upstream (AnimeKompi), not GGReels.

## Subtitles

- **No soft subtitle tracks observed anywhere.** On both player pages inspected, the ArtPlayer config had `subtitles = []` and no `.vtt` URL exists in the pages; the ShortTV playlist has no subtitle renditions.
- Indonesian is delivered **burned-in (hardsub) or as Indonesian dub**: title prefixes like `[Dijuluki]` / `[Dubbing]` mark dubbed editions; untagged short dramas carry Indonesian synopses and on-video text.
- The player code contains logic to auto-select an Indonesian soft track *if* a platform ever provides one (prefers lang id/in/ind) — none of the sampled titles did.
- Drakor/Anime subs are whatever the upstream embeds carry (DrakorID = Indonesian hardsub; AnimeKompi = Indonesian hardsub).

## Matching reality (the decisive part)

A Nuvio provider receives a **TMDB id + season/episode** and must find the same title here.

- **Short dramas (the site's core): NOT matchable.** These titles are not on TMDB; GGReels lists them under Indonesian-translated titles with platform numeric ids (CashDrama 22343; DramaBox 42000030762). Nuvio will simply never ask for them via its TMDB-driven catalogs. The playback chain is trivial to scrape, but there is no key to match on.
- **Drakor: partially matchable.** Slugs are the TMDB-style English title + year (`sunshine-through-the-rain-2026`); the catalog leans heavily to Chinese dramas (the two samples were C-dramas, and a search for "Queen of Tears" surfaced no result link — big K-dramas may be absent). Even when a slug matches, the streams are DrakorID/FileLions embeds needing their own resolvers.
- **Anime: weakly matchable.** Romaji slugs (`black-clover-2nd-season`) diverge from TMDB naming/seasoning; streams are upstream embeds anyway.
- **Movie: weakly matchable.** English-title slugs but opaque id suffixes and a small curated catalog; matching would need the client-side search (endpoint unknown) or crawling the SSR subcategory listings.
- No TMDB or IMDb id appears anywhere in the site's HTML (0 mentions).

## CDN geography

- CashDrama: Tencent Cloud VOD **Singapore** (`sgp` buckets) — close to Indonesia. ✔
- ShortTV: Akamai anycast (global, incl. Indonesian edges). ✔
- DramaBox: Huawei Cloud (`hwzt*.dramaboxdb.com`); region not confirmable from fetches, DramaBox typically serves Asia from SG/HK. ~
- Movie CDN `bcdnxw.hakunaymatata.com`: unknown operator, used by several Indonesian streaming sites. ?
- Playback for Indonesian users in practice goes through GGReels' own proxy host (v1.ggreels.site), whose location was not measured.

## Feasibility verdict

- **Short-drama playback chain: EASY to scrape** — `GET /<platform>/watch/<id>?ep=<n>` → regex the ArtPlayer `videoUrl` → return it as the stream URL (the proxy handles playlists, segments, and even Tencent SimpleAES key exchange). Verified end-to-end for CashDrama (Tencent SG), DramaRush/ShortTV (Akamai), DramaBox (direct MP4).
- **As a Nuvio provider: BLOCKED by matching, not by technology.** Nuvio is TMDB-keyed; the site's unique content (short dramas) has no TMDB presence, and its TMDB-matchable sections (drakor/anime) are embed shells over DrakorID/AnimeKompi, which should be scraped directly instead.
- **Portable lesson:** if a future target uses Tencent VOD SimpleAES, a playlist/key-rewriting proxy of this shape makes it playable — GGReels' `/api/cors-proxy.php` is a working reference implementation of that pattern.

### Exact flow, if it were ever built (e.g. for a non-TMDB catalog source)
1. From a GGReels platform + numeric id + episode: `fetch https://v1.ggreels.site/<platform>/watch/<id>?ep=<episode>`.
2. Regex `videoUrl = "..."` from the inline ArtPlayer script; unescape `\/`.
3. Return `[{ name: "GGReels <platform>", url: <site origin + videoUrl>, quality: "Auto" }]` — do NOT decode the base64; the proxy URL is the playable asset (it is also minted per page-load, so fetch fresh each time).

## Not tested / open

- `/id/wetv`, `/id/bonustv`, `/id/anichin` flows (likely same patterns: WeTV-sourced titles could be TMDB-matchable — worth a look only if a WeTV-shaped gap appears).
- The client-side search endpoint (results absent from SSR HTML).
- Whether any of the other ~36 short-drama platforms attach soft subs (player supports it; none sampled did).
- ggreels.web.id backup behavior.
