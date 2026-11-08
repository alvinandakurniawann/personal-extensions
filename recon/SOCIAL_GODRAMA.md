# Recon: Godrama (godrama.id) — kandidat dari sosmed

- **Tanggal:** 2026-11-08 (fetch-based recon dari VM; tanpa live browser)
- **Situs:** https://godrama.id/ — "GODRAMA - Nonton Drama Pendek Online Lengkap Subtitle Indonesia"
- **Niche:** drama pendek vertikal (micro-drama gaya ReelShort/DramaWave), mayoritas China, sebagian Korea/Barat; sub/dub Indonesia; update harian.

## 1. Struktur katalog & URL

- Homepage SSR (~398 KB) memuat ±390 kartu judul. Pola URL judul:
  `https://godrama.id/movie/<slug-judul-bahasa-indonesia>-<idNumerik>`
  contoh: `/movie/aku-kehilangan-suami-jin-ku-4582`, `/movie/main-lemah-tapi-kuat-5613`, `/movie/menikah-dengan-raja-naga-tersembunyi-sulih-suara-5132`.
- Judul **hanya** tampil dengan nama terjemahan Indonesia. Tidak ada judul bahasa asli, tidak ada ID TMDB/IMDb di mana pun (halaman, JSON-LD, maupun API).
- Kartu katalog membawa atribut internal `data-key="<slug>-<kodePlatform>_<contentIdPlatform>"` untuk banyak judul. Kode yang teramati di homepage: `id_` (65), `pd_` (60), `ns_` (25), `dw_` (25), `rs_` (19), `dx_` (15), `dn_` (13), `sl_` (12), `fr_` (10), `gd_` (8) — katalog ini agregasi ±10 platform short-drama. `rs_` = ReelShort (terbukti dari watermark "R" di video sampel); tebakan wajar: `ns_` NetShort, `dw_` DramaWave. Poster di-hotlink dari CDN platform asal (v-img.crazymaplestudios.com, akamai-static.shorttv.live, asset.vigloo.com, assets.stardust-tv.com, cdn.joyreels.com, file-cdn.flextv.cc, awscover.netshort.com, img.mebilu.com, img.nartodrama-api.online, bsy-cdp-img.wolftv.online), **tapi videonya di-host ulang di CDN milik Godrama sendiri**.
- Halaman judul = halaman player (tidak ada halaman episode terpisah). Isi SSR-nya:
  - `<source src="https://cdn.godrama.online/<id>-1.mp4">` (episode 1 langsung terpasang)
  - tombol episode: `<div class="episode" data-id="<id>" data-epi="<n>">`, plus `data-episodes="<total>"`
  - JSON-LD `TVSeries`: name (Indonesia), genre, `numberOfEpisodes`, `inLanguage: "id"`, poster `https://godrama.id/resources/posters/<id>.jpg`
- Jumlah episode per judul besar (sampel: 51 dan 50 episode), durasi ±5 menit/episode.
- Pencarian situs bersifat client-side: `/search/<q>` mengembalikan fallback homepage; JS memanggil API `getMovieSearch` (parameter persisnya tidak tertangkap — lihat §3).
- Hiasan anti-intip: `/js/dvdt.js` adalah devtools-detector (mengalihkan manusia yang membuka devtools) + JS inline ter-obfuscate. Tidak relevan untuk provider berbasis fetch.

## 2. Sumber video (terverifikasi langsung)

- **Pola file deterministik:** `https://cdn.godrama.online/<titleId>-<episode>.mp4`, episode 1..N.
  - 4582 ep1: HTTP 206/200, `Content-Type: video/mp4`, 27.740.226 byte, ffprobe: h264 540×960 (vertikal 9:16) + AAC, durasi 283 detik. Hanya 2 stream — **tidak ada stream subtitle di dalam MP4**.
  - 4582 ep52 → 404 (judul ini 51 episode) → pola + batas episode akurat.
  - 5613 ep1 juga terpasang di SSR halaman judulnya (`5613-1.mp4`, 50 episode).
- **Hotlink protection:** CDN menolak request tanpa `Referer: https://godrama.id/` (HTTP 403, termasuk request HEAD). Dengan Referer itu → 206 Partial Content, Range didukung penuh. Provider wajib memasang header Referer pada stream.
- Tidak ada HLS/m3u8 — file MP4 progresif per episode pendek.

## 3. API situs (godrama.id/api/)

Endpoint tunggal bergaya RPC, tanpa auth:

```
GET https://godrama.id/api/?type=getMovieData&id=<id>&epi=<n>
→ { id, title, desc, genre, episodes, poster, poster_tmp, views, likes,
    source: "https://cdn.godrama.online/<id>-<n>.mp4",
    subs: [ "<nama file subtitle>", ... ] }
```

- Terverifikasi bekerja untuk id 4582 ep1 & ep2 (respons JSON lengkap seperti di atas).
- **Throttle agresif teramati:** setelah ±2 panggilan sukses, semua panggilan berikutnya (id/episode lain, bahkan retest id yang sama setelah jeda ±20 detik) membalas `[]`. Kemungkinan rate-limit per-IP yang ketat dari IP datacenter; dari IP rumahan mungkin normal, tapi tidak bisa dibuktikan dari VM. Untungnya provider **tidak butuh** API ini (lihat §6).
- Tipe lain yang terlihat di JS: `addViews`, `addLikes` (POST, housekeeping), `getMovieList`, `getMovieSearch` (parameter tidak tertangkap; ikut membalas `[]` selama jendela throttle).
- Host API-ish lain dari bocoran sosmed, `nartodrama-api.online`, hanya muncul sebagai host poster — bukan API yang dipakai situs ini.

## 4. Subtitle — bentuknya CAMPURAN, per judul

Sistem player (Plyr) mendukung **soft track**: JS membangun caption track dari field `subs` API — file yang mengandung `_id` menjadi track `{kind:"captions", label:"Indonesia", srclang:"id", src:"https://godrama.id/resources/subtitles/<file>", default:true}`; ada fungsi `changeSubtitle(lang)` → sebagian judul punya beberapa bahasa.

Namun judul sampel 4582 (sumber ReelShort): `subs: [""]` (kosong) dan MP4-nya tanpa stream subtitle — ternyata **hardsub**: frame di detik ke-150 yang diekstrak dengan ffmpeg jelas memuat teks Indonesia yang terbakar di gambar ("nggak perlu khawatirin uang lagi!"). Sebagian judul lain **dubbing Indonesia** (slug berakhiran `sulih-suara`, mis. id 5132).

Kesimpulan subtitle: selalu Indonesia-first, tapi bentuknya beda-beda per judul — hardsub, soft VTT (di `/resources/subtitles/`), atau dub. Untuk Nuvio: hardsub/dub = otomatis terbawa video; soft track bisa dipasang dari `subs` API bila tersedia.

## 5. Geografi CDN

- Video: **BunnyCDN** (`Server: BunnyCDN-IL1-1067`, `CDN-PullZone: 6040466`, `CDN-StorageServer: SYD-690` = storage Sydney). BunnyCDN itu anycast global dengan PoP Asia Tenggara (Singapura/Jakarta), jadi dari Indonesia seharusnya dilayani edge dekat — tapi yang teramati dari VM hanyalah storage Sydney + kode edge IL1; edge persis untuk user Indonesia tidak bisa dibuktikan dari sini.
- Poster upstream: Akamai (shorttv.live), Cloudflare-ish, dan berbagai CDN platform — tidak penting untuk streaming.

## 6. Verdict kelayakan provider Nuvio

**Teknis: MUDAH. Praktis: TERBLOKIR oleh pencocokan (matching) — jangan dibangun sebagai provider standar.**

Alur teknisnya trivial (fetch saja, tanpa crypto/auth):
1. Terima `(tmdbId, mediaType, season, episode)` dari Nuvio.
2. Satu-satunya jalan mencocokkan: ambil judul TMDB (Inggris/original) → tebak/cari padanannya di katalog Godrama (API `getMovieSearch` atau sitemap katalog) → dapat `<id>` Godrama.
3. Bangun URL langsung: `https://cdn.godrama.online/<id>-<episodeNum>.mp4` dengan header `Referer: https://godrama.id/`; kualitas label "540p"; pasang soft sub dari `subs` API bila ada (file `_id` → lang `id`).

Kenapa praktisnya mentok:
- **Katalog Godrama sepenuhnya mandiri** — kunci internal numerik + nama Indonesia saja; tidak ada TMDB/IMDb ID. Provider Nuvio hanya menerima TMDB ID, jadi pencocokan harus fuzzy lewat judul.
- **Mayoritas micro-drama seperti ini tidak ada di TMDB sama sekali**, dan tidak pernah dengan struktur 30–80 episode × ±5 menit seperti di sini. Judul yang diklik alvin di Nuvio (dari katalog TMDB) hampir tidak akan pernah punya padanan di Godrama.
- Nama di Godrama adalah **terjemahan Indonesia** dari judul asli China/Inggris — fuzzy match dari judul TMDB rawan meleset total, melanggar kriteria "judul yang diklik harus benar isinya".
- Risiko tambahan: throttle API situs ini agresif (dari pengamatan VM), dan file 540p saja (tidak ada pilihan kualitas).

Rekomendasi: **skip** untuk repo personal-extensions dalam bentuk `getStreams` standar. Godrama hanya masuk akal bila suatu hari Nuvio mendukung sumber berbasis browse/search di luar TMDB — atau sebagai tontonan terpisah di browser, bukan lewat plugin.
