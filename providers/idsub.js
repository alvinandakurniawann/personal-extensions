// IDSub provider for Nuvio
// Film & series subtitle Indonesia (personal use)
// Cara kerja: TMDB id -> judul/tahun (TMDB) -> tebak slug situs sumber
// -> panggil API stream internalnya -> playlist HLS (m3u8) + subtitle .vtt.
// Kalau tebakan slug meleset, fallback ke API pencarian situs sumber.
// Semua request dikasih timeout biar tidak menggantung.

const BASE_URL = "https://movie.nakal.id";
const TMDB_API_KEY = "b030404650f279792a8d3287232358e3"; // public read-only key, sama seperti provider komunitas lain

const UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const SITE_HEADERS = { "User-Agent": UA, "Referer": BASE_URL + "/" };

function fetchJson(url, headers, timeoutMs) {
    var ctrl = (typeof AbortController !== "undefined") ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs || 15000) : null;
    var opts = { headers: headers || SITE_HEADERS };
    if (ctrl) opts.signal = ctrl.signal;
    return fetch(url, opts).then(function (res) {
        if (timer) clearTimeout(timer);
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
    }).catch(function (e) {
        if (timer) clearTimeout(timer);
        throw e;
    });
}

function slugify(title, year) {
    var s = String(title || "").toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-");
    return year ? s + "-" + year : s;
}

function streamApiUrl(kind, slug, seasonNum, episodeNum) {
    if (kind === "movie") return BASE_URL + "/api/stream/movie/" + slug;
    return BASE_URL + "/api/stream/series/" + slug + "/" + (seasonNum || 1) + "/" + (episodeNum || 1);
}

function toStream(json, fallbackTitle) {
    if (!json || !json.success || !json.data || !json.data.streamUrl) return null;
    var d = json.data;
    var quality = d.maxHeight ? d.maxHeight + "p" : "1080p";
    var stream = {
        name: "IDSub - " + quality,
        title: d.title || fallbackTitle,
        url: d.streamUrl,
        quality: quality,
        size: "Unknown",
        headers: { "User-Agent": UA, "Referer": BASE_URL + "/" },
        provider: "idsub"
    };
    if (d.subtitles && d.subtitles.length) {
        stream.subtitles = d.subtitles.map(function (s, i) {
            return { id: "idsub-sub-" + i, url: s.url, lang: s.lang || "id" };
        });
    }
    return stream;
}

// Cari slug lewat API pencarian situs sumber. kind: 'movie' | 'tv'
function searchSource(query, kind, year) {
    var wantType = kind === "movie" ? "movie" : "series";
    var url = BASE_URL + "/api/search?q=" + encodeURIComponent(query);
    return fetchJson(url, null, 10000).then(function (json) {
        var results = (json && json.data) || [];
        var typed = results.filter(function (r) { return r.type === wantType; });
        var pool = typed.length ? typed : results;
        if (!pool.length) return null;
        if (year) {
            var byYear = pool.filter(function (r) { return String(r.year) === String(year); });
            if (byYear.length) return byYear[0].slug;
            var bySlug = pool.filter(function (r) { return r.slug && r.slug.endsWith("-" + year); });
            if (bySlug.length) return bySlug[0].slug;
        }
        return pool[0].slug;
    }).catch(function () { return null; });
}

function tryStream(kind, slug, seasonNum, episodeNum, title) {
    if (!slug) return Promise.resolve(null);
    var url = streamApiUrl(kind, slug, seasonNum, episodeNum);
    console.log("[IDSub] stream API:", url);
    return fetchJson(url, null, 30000)
        .then(function (json) { return toStream(json, title); })
        .catch(function () { return null; });
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    var kind = mediaType === "movie" ? "movie" : "tv";
    var tmdbUrl = "https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "?api_key=" + TMDB_API_KEY;

    return fetchJson(tmdbUrl, { "User-Agent": UA }, 10000)
        .then(function (tm) {
            var title = tm.title || tm.name || "";
            var original = tm.original_title || tm.original_name || "";
            var year = (tm.release_date || tm.first_air_date || "").substring(0, 4);
            if (!title) return null;
            // Jalur cepat: tebak slug dari judul TMDB (pola situs: judul-tahun)
            return tryStream(kind, slugify(title, year), seasonNum, episodeNum, title)
                .then(function (stream) {
                    if (stream) return stream;
                    if (original && original !== title) {
                        return tryStream(kind, slugify(original, year), seasonNum, episodeNum, title);
                    }
                    return null;
                })
                .then(function (stream) {
                    if (stream) return stream;
                    // Fallback: cari slug lewat API pencarian
                    return searchSource(title, kind, year)
                        .then(function (slug) { return tryStream(kind, slug, seasonNum, episodeNum, title); })
                        .then(function (s2) {
                            if (s2) return s2;
                            if (original && original !== title) {
                                return searchSource(original, kind, year)
                                    .then(function (slug) { return tryStream(kind, slug, seasonNum, episodeNum, title); });
                            }
                            return null;
                        });
                });
        })
        .then(function (stream) { return stream ? [stream] : []; })
        .catch(function (err) {
            console.error("[IDSub] Error:", err && err.message);
            return [];
        });
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { getStreams: getStreams };
} else {
    global.IDSubScraperModule = { getStreams: getStreams };
}
