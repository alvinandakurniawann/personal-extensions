# Recon: Jomflix (jomflix.web.id → tv1.jomflix.web.id)

- **Date:** 2026-11-08 (fetch-based recon from VM; no live browser)
- **Site:** https://tv1.jomflix.web.id/ — "Jomflix - Nonton Streaming Film & Series Subtitle Indonesia Gratis"
- **Found via:** Facebook comment threads; users asked for working links, author supplied the tv1 subdomain.

## Stack

- **Custom SPA** (vanilla JS, NOT WordPress/DooPlay): single bundle `/static/app.bundle.js?v=6.4.1` (~382 KB) + `hls.min.js` (HLS.js player). HTML shell has no catalog markup — everything renders from a same-origin JSON API.
- Backend is **Vercel** (response headers: `x-vercel-id: sfo1::sin1::…`, `x-vercel-cache`) behind **Cloudflare** (`Server: cloudflare`). The `sin1` token in the Vercel id indicates the function region is **Singapore** — a good Asia-proximity signal, and stream manifests are proxied through the same infra (below).
- Frontend mirrors (from the bundle's "BLOKIR FAILOVER ENGINE"): `tv1.jomflix.web.id`, `id1.jomflix.web.id`, `tv2.jomflix.web.id`, `jomflix.web.id`, `jomflix.vercel.app`. A separate host `stream.jomflix.web.id` exists but is explicitly excluded for web (likely the Android-app host; it answers with a Cloudflare "Attention Required!" bot-block 403 from this VM under both browser and okhttp UAs).
- Ads are present on the site (magsrv/pemsrv VAST via `/api/ads/vast-proxy`), and playback has an ad-gate (below) — the site's monetization is the ~15 s unlock countdown.

## API map (all observed live unless noted)

Catalog (verified live, HTTP 200, no auth/cookies needed):

- `GET /api/home`, `GET /api/genres`, `GET /api/collections[/<slug>]`, `GET /api/recent-episodes?limit=15`
- `GET /api/movies?genre=&sort=latest|popularity|rating&year=&page=&limit=` and same for `/api/series`
- `GET /api/search?q=<query>` → `{results:[{slug, title, tmdbId|null, …}], total, order}`
- `GET /api/movies/<slug>` → full detail: internal UUID `id`, `tmdbId` (present for F1: 911430), `imdbId: null` (field exists but was null in samples), title/originalTitle, overview (Indonesian), poster/backdrop paths (TMDB image paths), `quality: "WEB-DL"`, runtime, genres, cast (with tmdbPersonId), releaseDate.
- `GET /api/series/<slug>` → detail + `allSeasons[].episodes[]` each with its own UUID `id`, season/episode numbers. QoT: tmdbId null in its record, 1 season × 16 episodes.
- `GET /api/series/<slug>/season/<s>/episode/<e>` → `{series:{…}, episode:{id (UUID), seasonNumber, episodeNumber, …}, season:{…}, allSeasons:[…]}`.

Streaming (endpoints + payload schema extracted from the site bundle; **live calls fail from this VM — see Blocker**):

- `GET /api/stream/instant?content_type=movie|episode&content_id=<UUID>` — content_id is the detail UUID for movies, the episode UUID for episodes.
  - If `{mode:"instant", streamUrl, …}` → play immediately.
  - Else returns `{gateToken, sessionCookies, unlockAt, serverNow}` — an ad gate: default unlock ≈ **15 s** later; the client waits, then redeems.
- `POST /api/stream/claim-and-redeem` JSON `{gateToken, sessionCookies}` → stream data (sessionCookies are handed back in the instant response JSON, so no browser cookie jar is required).
- Stream data shape (from bundle code): `{streamUrl, rawStreamUrl, token, expiresAt, subtitles:[{url|path, lang, label}]}`. `streamUrl` is **site-relative**: the player loads `${origin}${streamUrl}`, and the URL is of the form `/api/stream/manifest?url=<urlencoded upstream m3u8>` with a `t=<token>` parameter inside the target — i.e. **Jomflix proxies an upstream HLS manifest through its own domain**, it does not expose third-party embeds. The true upstream host only appears inside that `url=` parameter, obtainable only from a successful instant/claim response.
- `POST /api/stream/refresh-token` JSON `{contentType, contentId}` → fresh streamUrl/token (bundle schedules refresh 10 min before expiry; default expiry ≈ 3000 s). Irrelevant for a one-shot provider call.
- `GET /api/stream/subtitle-proxy?url=<urlencoded>` — used by the player to fetch non-relative subtitle files (it sanitizes/converts to WEBVTT).

## Matching model

- **TMDB-anchored but not TMDB-complete.** Search and detail records carry `tmdbId` when the site has it (F1 movie: exact 911430) but popular series may lack it (Queen of Tears: tmdbId null in both search and detail). No IMDb ids observed (field exists, null).
- Practical provider matching: TMDB title (+ original title) → `/api/search` → prefer a result whose `tmdbId` equals the requested id; otherwise exact normalized title match verified against detail `releaseDate`/`firstAirDate` year. Same discipline as the repo's KissKH/Castle providers. Slug pattern: `<title-slug>-<year>`.

## Streams & subtitles

- **Streams:** direct HLS via the site's own manifest proxy (HLS.js in the player; the site's download modal even exposes the full .m3u8 URL to users). No third-party embed hosts (no FileLions/VidHide/Jeniusplay-style resolvers) — Jomflix itself is the resolver/proxy layer; the hidden upstream behind `manifest?url=` is the only unknown.
- **Subtitles: soft WEBVTT tracks, Indonesian-first.** Bundle evidence: player state `activeSubtitleTrack: 'id'` by default; subtitle objects carry `lang` ('id'/'en') and/or `label` ('Indonesian'/'English'); the track picker explicitly classifies `lang==='id'` or label containing "indonesia" as the Indonesian track and likewise for English; non-relative subtitle URLs are fetched via `/api/stream/subtitle-proxy` and normalized to WEBVTT. So both id + en soft subs are part of the stream payload when a title has them. (Per-title availability could not be sampled live — see Blocker.)

## CDN geography

- API origin on Vercel with Singapore (`sin1`) function region; Cloudflare in front. Because the manifest itself is proxied via `/api/stream/manifest`, at minimum playlist traffic rides this Vercel/Cloudflare path (anycast + SG origin). Segment hosts sit behind the proxied manifest and are unknown until a stream payload is captured.

## Blocker (why the last step is unverified)

From this VM, **every** `/api/stream/*` route on tv1 returns Cloudflare `502` ("error code: 502", 16-byte body) — instant (movie + episode), claim, refresh-token, and even a nonsense manifest probe — while all catalog routes on the same host return 200. Apex `jomflix.web.id` redirects to tv1 and 502s identically; tv2/id1 don't connect from here; `stream.jomflix.web.id` is Cloudflare bot-blocked (403). Retried with a warmed session (home + detail calls first) and Referer headers — same 502. This matches the project's known pattern of datacenter-IP blocks (cf. FileLions CDN, Loklok) **or** a genuinely down stream micro-service; fetch-based recon cannot distinguish the two. A test from a residential connection (alvin's phone browser opening any title) settles it in seconds.

## Feasibility verdict: MEDIUM — buildable, pending one live-stream confirmation

Everything a provider needs is documented and fetch-only (no DOM, no crypto, no account):

1. `GET /api/search?q=<TMDB title>` → pick result (tmdbId match first, else exact title + year via detail).
2. Movie: `GET /api/movies/<slug>` → UUID. TV: `GET /api/series/<slug>/season/<s>/episode/<e>` → `episode.id` UUID.
3. `GET /api/stream/instant?content_type=movie|episode&content_id=<UUID>` → if `mode:"instant"`, use payload; else wait until `unlockAt` (~15 s), then `POST /api/stream/claim-and-redeem {gateToken, sessionCookies}`.
4. Emit stream with `url = https://tv1.jomflix.web.id + streamData.streamUrl`, quality from detail `quality`/"Auto"; subtitles from `streamData.subtitles` mapped to id/en (absolute sub URLs wrapped in `/api/stream/subtitle-proxy?url=…` like the site's own player does); attach FirKaizen as backup as with the repo's other providers.

Costs/risks: the ~15 s ad-gate wait makes this one of the slower providers when a title is gated (instant-mode titles are fast); the stream backend's health from residential IPs is unconfirmed (the 502 above); mirror hosts rotate (bundle already ships a failover list — provider should pin tv1 and could fall back to the apex).
