// KissKH provider untuk Nuvio
// Sumber: kisskh.ovh (KissKH — drama/film Asia, terkenal dengan subtitle multi-bahasa).
// Alur API situs sendiri:
//   GET /api/DramaList/Search?q=<judul>&type=0          -> kandidat drama
//   GET /api/DramaList/Drama/<id>?isq=false             -> daftar episode
//   GET <generator kunci publik> ?id=<episodeId>         -> {key}  (kkey wajib)
//   GET /api/DramaList/Episode/<episodeId>.png?...&kkey=<key> -> {Video: m3u8}
// Pencocokan: judul persis + tahun rilis diverifikasi dari detail drama.
// Subtitle lunak id+en dipasang dari API FirKaizen (helper di bawah).

const TMDB_API_KEY = "b030404650f279792a8d3287232358e3";
const TMDB_BASE = "https://api.themoviedb.org/3";
const MAIN_URL = "https://kisskh.ovh";
const KEY_URL = "https://script.google.com/macros/s/AKfycbzn8B31PuDxzaMa9_CQ0VGEDasFqfzI5bXvjaIZH4DM8DNq9q6xj1ALvZNz_JT3jF0suA/exec?id=";
const UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

function fetchTextOnce(url, headers, timeoutMs) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || 12000);
    var opts = { headers: Object.assign({ "User-Agent": UA }, headers || {}), signal: ctrl.signal };
    return fetch(url, opts).then(function (r) {
        clearTimeout(timer);
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text();
    }).catch(function (e) { clearTimeout(timer); throw e; });
}

function fetchText(url, headers, timeoutMs) {
    return fetchTextOnce(url, headers, timeoutMs).catch(function () {
        return new Promise(function (res) { setTimeout(res, 400); }).then(function () {
            return fetchTextOnce(url, headers, timeoutMs);
        });
    });
}

function fetchJson(url, headers, timeoutMs) {
    return fetchText(url, headers, timeoutMs).then(function (t) { return JSON.parse(t); });
}

function normTitle(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tmdbDetails(tmdbId, mediaType) {
    var kind = mediaType === "tv" ? "tv" : "movie";
    var url = TMDB_BASE + "/" + kind + "/" + tmdbId + "?api_key=" + TMDB_API_KEY;
    return fetchJson(url, null, 10000).then(function (d) {
        return {
            title: d.title || d.name || "",
            originalTitle: d.original_title || d.original_name || "",
            year: String(d.release_date || d.first_air_date || "").slice(0, 4)
        };
    });
}

function findDrama(info) {
    var titles = [info.title, info.originalTitle].filter(function (v, i, a) { return v && a.indexOf(v) === i; });
    var chain = Promise.resolve(null);
    titles.forEach(function (title) {
        chain = chain.then(function (found) {
            if (found) return found;
            var url = MAIN_URL + "/api/DramaList/Search?q=" + encodeURIComponent(title) + "&type=0";
            return fetchJson(url, null, 12000).then(function (list) {
                if (!Array.isArray(list)) return null;
                var exact = null, partial = null;
                list.forEach(function (item) {
                    var cand = normTitle(item.title);
                    if (!exact && cand === normTitle(title)) exact = item;
                    else if (!partial && (cand.indexOf(normTitle(title)) >= 0 || normTitle(title).indexOf(cand) >= 0)) partial = item;
                });
                return exact || partial || null;
            }).catch(function () { return null; });
        });
    });
    return chain.then(function (item) {
        if (!item) return null;
        // Verifikasi tahun lewat detail (search tidak memberi tahun).
        return fetchJson(MAIN_URL + "/api/DramaList/Drama/" + item.id + "?isq=false", null, 12000).then(function (detail) {
            if (info.year && detail.releaseDate && String(detail.releaseDate).slice(0, 4) !== info.year) {
                // Tahun beda: tetap pakai bila judulnya persis sama (beda region rilis bisa geser setahun).
                if (normTitle(detail.title) !== normTitle(info.title)) return null;
            }
            return detail;
        }).catch(function () { return null; });
    });
}

function pickEpisode(detail, mediaType, episodeNum) {
    var eps = (detail && detail.episodes) || [];
    if (!eps.length) return null;
    if (mediaType === "movie") {
        var main = eps.filter(function (e) { return parseFloat(e.number) === 1; });
        return (main[0] || eps[eps.length - 1]).id;
    }
    for (var i = 0; i < eps.length; i++) {
        if (parseFloat(eps[i].number) === episodeNum) return eps[i].id;
    }
    return null;
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    return tmdbDetails(tmdbId, mediaType).then(function (info) {
        if (!info.title) return [];
        return findDrama(info).then(function (detail) {
            if (!detail) return [];
            var epsId = pickEpisode(detail, mediaType, episodeNum || 1);
            if (!epsId) return [];
            return fetchJson(KEY_URL + epsId + "&version=2.8.10", null, 15000).then(function (keyData) {
                if (!keyData || !keyData.key) return [];
                var videoApi = MAIN_URL + "/api/DramaList/Episode/" + epsId + ".png?err=false&ts=&time=&kkey=" + encodeURIComponent(keyData.key);
                return fetchJson(videoApi, { "Referer": MAIN_URL + "/" }, 12000).then(function (sources) {
                    var streams = [];
                    var label = info.title + (info.year ? " (" + info.year + ")" : "");
                    if (mediaType === "tv") label += " S" + (seasonNum || 1) + "E" + (episodeNum || 1);
                    [sources && sources.Video].forEach(function (link) {
                        if (link && link.indexOf(".m3u8") >= 0) {
                            streams.push({
                                name: "KissKH",
                                title: label,
                                url: link,
                                quality: "Auto",
                                size: "Unknown",
                                headers: { "User-Agent": UA, "Referer": MAIN_URL + "/", "Origin": MAIN_URL },
                                provider: "kisskh"
                            });
                        } else if (link && link.indexOf(".mp4") >= 0) {
                            streams.push({
                                name: "KissKH MP4",
                                title: label,
                                url: link,
                                quality: "Auto",
                                size: "Unknown",
                                headers: { "User-Agent": UA, "Referer": MAIN_URL + "/" },
                                provider: "kisskh"
                            });
                        }
                    });
                    return streams;
                });
            });
        });
    }).then(function (streams) { return attachFirkaizen(streams, tmdbId, mediaType, seasonNum, episodeNum); })
      .catch(function () { return []; });
}

// ---- Subtitle lunak id+en dari API terbuka FirKaizen (berbasis TMDB id) ----
// Dipasang ke stream hasil provider ini; bahasa yang sudah ada tidak diduplikasi.
function firkaizenSubs(tmdbId, mediaType, seasonNum, episodeNum) {
    var langs = ["id", "en"];
    var jobs = langs.map(function (lang) {
        var u = "https://play.firkaizen.id/api/subtitles/file?tmdb_id=" + tmdbId +
            "&media_type=" + (mediaType === "tv" ? "tv" : "movie") + "&language=" + lang;
        if (mediaType === "tv") u += "&season=" + (seasonNum || 1) + "&episode=" + (episodeNum || 1);
        function attempt() {
            var ctrl = new AbortController();
            var timer = setTimeout(function () { ctrl.abort(); }, 6000);
            return fetch(u, { signal: ctrl.signal }).then(function (r) {
                clearTimeout(timer);
                if (!r.ok) return null;
                if (r.body && r.body.cancel) { try { r.body.cancel(); } catch (e) {} }
                return { id: "firkaizen-" + lang, url: u, lang: lang };
            }).catch(function () { clearTimeout(timer); return null; });
        }
        return attempt().then(function (hit) {
            if (hit) return hit;
            return new Promise(function (res) { setTimeout(res, 400); }).then(attempt);
        });
    });
    return Promise.all(jobs).then(function (arr) {
        return arr.filter(function (x) { return !!x; });
    });
}

function attachFirkaizen(streams, tmdbId, mediaType, seasonNum, episodeNum) {
    if (!streams || !streams.length) return Promise.resolve(streams);
    return firkaizenSubs(tmdbId, mediaType, seasonNum, episodeNum).then(function (subs) {
        if (subs.length) {
            streams.forEach(function (s) {
                var existing = s.subtitles || [];
                var have = {};
                existing.forEach(function (x) { have[x.lang] = true; });
                var add = subs.filter(function (x) { return !have[x.lang]; });
                if (add.length) s.subtitles = existing.concat(add);
            });
        }
        return streams;
    }).catch(function () { return streams; });
}

module.exports = { getStreams };
