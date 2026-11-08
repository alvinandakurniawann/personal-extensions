// IDSub provider for Nuvio
// Film & series subtitle Indonesia (personal use)
// Cara kerja: TMDB id -> judul/tahun (TMDB) -> cari slug di API situs sumber
// -> panggil API stream internal situs sumber -> dapat playlist HLS (m3u8)
// + subtitle Indonesia (.vtt). Tanpa library eksternal, murni fetch.

const BASE_URL = "https://movie.nakal.id";
const TMDB_API_KEY = "b030404650f279792a8d3287232358e3"; // public read-only key, sama seperti provider komunitas lain

const UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const SITE_HEADERS = { "User-Agent": UA, "Referer": BASE_URL + "/" };

function fetchJson(url, headers) {
    return fetch(url, { headers: headers || SITE_HEADERS }).then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status + " " + url);
        return res.json();
    });
}

// Cari slug situs sumber dari judul. kind: 'movie' | 'tv' (di situs sumber tv = 'series')
function searchSource(query, kind, year) {
    var wantType = kind === "movie" ? "movie" : "series";
    var url = BASE_URL + "/api/search?q=" + encodeURIComponent(query);
    return fetchJson(url).then(function (json) {
        var results = (json && json.data) || [];
        var typed = results.filter(function (r) { return r.type === wantType; });
        var pool = typed.length ? typed : results;
        if (!pool.length) return null;
        if (year) {
            var byYear = pool.filter(function (r) { return String(r.year) === String(year); });
            if (byYear.length) return byYear[0];
            var bySlug = pool.filter(function (r) { return r.slug && r.slug.endsWith("-" + year); });
            if (bySlug.length) return bySlug[0];
        }
        return pool[0];
    }).catch(function () { return null; });
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    var kind = mediaType === "movie" ? "movie" : "tv";
    var tmdbUrl = "https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "?api_key=" + TMDB_API_KEY;

    return fetchJson(tmdbUrl, { "User-Agent": UA })
        .then(function (tm) {
            var title = tm.title || tm.name || "";
            var original = tm.original_title || tm.original_name || "";
            var year = (tm.release_date || tm.first_air_date || "").substring(0, 4);
            if (!title) return [];
            return searchSource(title, kind, year).then(function (hit) {
                if (hit || !original || original === title) return { hit: hit, title: title };
                return searchSource(original, kind, year).then(function (hit2) {
                    return { hit: hit2, title: title };
                });
            });
        })
        .then(function (ctx) {
            if (!ctx || !ctx.hit) {
                console.log("[IDSub] tidak ketemu di situs sumber untuk tmdb " + tmdbId);
                return [];
            }
            var slug = ctx.hit.slug;
            var apiUrl;
            if (kind === "movie") {
                apiUrl = BASE_URL + "/api/stream/movie/" + slug;
            } else {
                apiUrl = BASE_URL + "/api/stream/series/" + slug + "/" + (seasonNum || 1) + "/" + (episodeNum || 1);
            }
            console.log("[IDSub] stream API:", apiUrl);
            return fetchJson(apiUrl).then(function (json) {
                if (!json || !json.success || !json.data || !json.data.streamUrl) return [];
                var d = json.data;
                var quality = d.maxHeight ? d.maxHeight + "p" : "1080p";
                var stream = {
                    name: "IDSub - " + quality,
                    title: d.title || ctx.title,
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
                return [stream];
            });
        })
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
