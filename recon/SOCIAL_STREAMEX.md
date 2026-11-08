# Recon: StreamEx (streamex.net → streamex.hn) — 2026-11-08

Deep fetch-based recon (curl + bundle analysis + webcrack deobfuscation). No live browser used.
Test titles carried end-to-end successfully: **F1** (movie, TMDB 911430) and **Queen of Tears S1E1** (TV, TMDB 215720).

## What the site is

A Next.js (Turbopack) SPA at `https://www.streamex.hn/` (streamex.net 301s there). It is a
**TMDB-frontend aggregator**: all catalog data comes from TMDB through the site's own
server-side proxy, and playback is delegated to a registry of third-party embed players.
Same site also carries anime (AniList/HiAnime), manga, music and live sections — out of scope here.

## Data API (catalog) — keyed by TMDB id, exact matching

- `GET https://www.streamex.hn/api/tmdb/<tmdb-api-path>` is a transparent TMDB proxy
  (server-side embedded key; the client never sees a key).
  Verified: `/api/tmdb/movie/911430` → F1 metadata JSON; `/api/tmdb/search/movie?query=F1` → TMDB search JSON.
- Routes: `/movie`, `/tv`, `/search`, `/watch/[type]/[id]` — the watch route id **is the TMDB id**.
- On the watch page the app also fetches `…/api/tmdb/{movie|tv}/<id>/external_ids` to obtain the
  IMDb id, because some embed templates take `{imdbId}` (fallback: TMDB id). Movie/TV templates
  below all use `{id}` = TMDB id.

## Player registry (from the site bundle, module 86844)

14 movie/TV embed servers, URL templates with `{id}` / `{season}` / `{episode}`:

| name | movie template | recommended |
|---|---|---|
| streamex | `https://play.xpass.top/e/movie/{id}` | ★ |
| core | `https://vidcore.net/movie/{id}` (→ vidcore.io) | ★ |
| vidsrc | `https://vsembed.ru/embed/movie/{id}` | ★ |
| zxcstream | `https://www.zxcstream.xyz/player/movie/{id}` | ★ |
| vidy | `https://vidy.st/movie/{id}?color=FFFF` | |
| bingr | `https://bingr.one/watch/movie/{id}` | |
| zoryva | `https://zoryva.me/embed/movie/{id}?…` | |
| cinemaos | `https://cinemaos.tech/player/{id}` (sandboxed iframe) | |
| peach | `https://peachify.top/embed/movie/{id}` | |
| mapi | `https://vidzen.fun/movie/{id}` | |
| stellar | `https://stellar.rip/en/watch/embed/movie/{id}` | |
| framex | `https://framextv.tech/embed/movie/{id}?autoplay=1` | |
| french | `https://frembed.buzz/api/film.php?id={id}` | |
| spanish / italian | `play.modocine.com/…`, `vixsrc.to/movie/{id}?lang=it` | |

TV templates are the same hosts with `/tv/{id}/{season}/{episode}` shape.
Anime uses a separate registry (megaplay.buzz, tryembed.us.cc, vidnest.fun) keyed by AniList id.

**The real scrape target is the site's own #1 server, "streamex" = play.xpass.top (the 1x2.space
family)** — it is the only one whose full chain was cracked end-to-end (below). The others are
generic embed shells; spot checks from the VM: vsembed.ru → Cloudflare 403, zxcstream.xyz →
unreachable, vidcore.io → separate SPA (not followed).

## The xpass chain (fully solved, verified live)

1. `GET https://play.xpass.top/e/movie/<tmdbId>` (or `/e/tv/<tmdbId>/<season>/<episode>`)
   → small HTML page (JW Player shell) containing:
   - `var dataUrl = "/data/movie/<tmdbId>?autostart=false&token=<embedded token>"`
     (TV: `/data/tv/<tmdbId>/<season>/<episode>?…`). Token format: `<part>.<64-hex>`.
     A fresh token is minted per page view — just parse it from the HTML, no login/session.
   - `var suburl = "https://sub.1x2.space/api/movie/<tmdbId>"` (subtitle API, see below).
   - `/static/mainmini.js` is only an anti-sandbox loader; it injects the real player script
     `/static/<random-name>.js` (obfuscator.io-packed; deobfuscated during this recon).
2. `GET https://play.xpass.top<dataUrl>` → base64url blob (encrypted).
   Decryption (from the deobfuscated player, reimplemented and **verified working**):
   - `keyMaterial = "spv3-data-response|" + BUILD + "|" + pathname + "|" + token`
     where `pathname` is the dataUrl path without query (`/data/movie/911430`) and
     `BUILD = "spv3-build-1787821613-50e5fc97c9dce367"` (build id baked into the player JS —
     see maintenance risk below).
   - `key = SHA-256(keyMaterial)` (raw 32 bytes) → AES-256-GCM.
   - payload bytes: IV = first 12 bytes, rest = ciphertext+16-byte GCM tag (WebCrypto layout).
   - Plaintext = JSON array of sources, e.g. F1:
     `[{"id":"…","name":"TIK 1","url":"/mdata/<id>/1/playlist.json"}, {"name":"VIP 1","url":"/vip/<token>/1/playlist.json"}, {"name":"FIL 1",…}, …]`
     (QoT first source was "VIP 1".) Source names observed: TIK, VIP, FIL, VID — multiple mirrors.
3. `GET https://play.xpass.top<sources[i].url>` → JW playlist JSON:
   `{"playlist":[{"sources":[{"file":"https://tik.1x2.space/playlist/<hash>/master.m3u8"}], "tracks":[]}]}`
   - F1 → `https://tik.1x2.space/playlist/<hash>/master.m3u8`
   - QoT S1E1 → `https://vip.1x2.space/playlist/<hash>/master.m3u8`
   - `tracks` in the playlist JSON is empty — subtitles are NOT in the playlist; they come from
     the separate subtitle API (step "Subtitles").
4. The master.m3u8 is real HLS (F1: 720p variant seen, BANDWIDTH≈1.17 Mb/s; QoT: 360p + 720p
   variants). **Playback requires header `Referer: https://play.xpass.top/`** (or the embed URL):
   with that referer → HTTP 200; with Referer streamex.hn or none → 403.

## Subtitles — excellent, standalone open API

`GET https://sub.1x2.space/api/movie/<tmdbId>` and `/api/tv/<tmdbId>/<season>/<episode>`
→ JSON array `[{label, language, status:"cached", size, url:"/subtitle/movie/<id>/<Lang>.vtt"}]`.
**No token/auth needed** (bare curl returned 200).

- F1: 9 languages incl. **Indonesian** (183,829 B) and **English** (93,236 B).
  The Indonesian VTT was downloaded and inspected — genuine Indonesian cues.
- Queen of Tears S1E1: 17 entries incl. **Indonesian** (74,991 B) and English (77,413 B).
- Files live at `https://sub.1x2.space/subtitle/…` as plain WEBVTT.

This API is independently useful: it is a second FirKaizen-style subtitle source keyed purely
by TMDB id (movie + TV with season/episode), even if the stream side is never ported.

## CDN geography

- Stream hosts: `*.1x2.space` (tik / vip / sub / …) — all behind **Cloudflare** (Server:
  cloudflare, cf-cache-status headers). Anycast → an Indonesian viewer should land on a
  Singapore/Jakarta edge. Not directly measurable from this VM (its egress was routed to a
  Miami CF edge, which also explains the initial 403 confusion — that was the missing Referer,
  not geo-blocking).
- play.xpass.top itself is also Cloudflare-fronted (challenge-platform script in the page).

## Feasibility verdict: MEDIUM

A Nuvio provider would implement exactly the chain above with fetch only:

```
getStreams(tmdbId, type, s, e):
  html   = GET play.xpass.top/e/{movie|tv}/…            (parse dataUrl + token via regex)
  blob   = GET play.xpass.top + dataUrl
  key    = SHA256("spv3-data-response|" + BUILD + "|" + pathname + "|" + token)
  srcs   = AES-256-GCM-decrypt(base64url(blob), key, iv=blob[0..12])
  for each source (cap ~3): pl = GET play.xpass.top + src.url → file = pl.playlist[0].sources[0].file
  subs   = GET sub.1x2.space/api/… → keep Indonesian + English
  emit streams with headers { Referer: "https://play.xpass.top/" }
```

Why not "easy":
- **AES-GCM + SHA-256 in the sandbox.** The site uses WebCrypto; whether Nuvio's JS sandbox
  exposes `crypto.subtle` is unknown. If it doesn't, the provider needs pure-JS SHA-256
  (small, known quantity — the Goated port already needed one) plus pure-JS AES-GCM
  (AES block cipher already exists in pure JS in this repo's IDLIX provider; the GCM/GHASH
  layer is ~100 extra lines). Doable, but it's the one real work item.
- **BUILD id rotation (maintenance risk).** The `spv3-build-…` string is baked into the
  obfuscated player script under a randomized filename; it is NOT greppable in the raw file
  (only recoverable by deobfuscation). When xpass redeploys its player, a hardcoded BUILD
  silently breaks the provider until someone re-deobfuscates and updates it.
- Token is per-view but trivially parsed from the embed HTML — not a blocker.
- Referer-locked CDN is handled by setting the playback header (normal for this repo).

Why not "hard": matching is exact TMDB id end-to-end (no title search, no wrong-title risk);
every step is a plain GET; the crypto scheme is fully deterministic with no server-side
session, cookies, or PoW; and the whole chain was executed successfully from this VM for both
test titles. The subtitle API alone rates "easy" and can ship independently of the stream side.

## Raw recon artifacts

Working dir `/tmp/streamex/` (ephemeral): homepage + 42 bundle chunks, embed pages,
`e2e_xpass.js` (the working end-to-end proof), deobfuscated xpass player in `player_deob/`.
