// LK21 (LayarKaca21) provider untuk Nuvio — khusus film (API situs belum punya endpoint series).
// Sumber: API JSON publik mirror lk21.mobile.
//   GET /api/v1/movies/?search=<q>            -> kandidat (slug, title, year)
//   GET /api/v1/movies/<slug>                 -> detail + imdb_id + streaming_servers[]
// Pencocokan judul diverifikasi pakai imdb_id dari TMDB — bukan tebak judul.
// Server "P2P" (videonode.de) diurai:
//   POST videonode.de/api.php {host=p2p, id=<token>} -> {embedUrl: playcdn.de/<token2>}
//   GET  playcdn.de/verify/<token2>                  -> {fileUrl: playlist .m3u8}
// Server lain (TURBO VIP mati menurut LK21 sendiri, CAST, HYDRAX) belum didukung.

const TMDB_API_KEY = "b030404650f279792a8d3287232358e3";
const TMDB_BASE = "https://api.themoviedb.org/3";
const API_BASE = "https://lk21.mobile";
const UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

function fetchTextOnce(url, opts, timeoutMs) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || 12000);
    var o = Object.assign({}, opts || {});
    o.headers = Object.assign({ "User-Agent": UA }, (opts && opts.headers) || {});
    o.signal = ctrl.signal;
    return fetch(url, o).then(function (r) {
        clearTimeout(timer);
        return r.text();
    }).catch(function (e) { clearTimeout(timer); throw e; });
}

function fetchText(url, opts, timeoutMs) {
    return fetchTextOnce(url, opts, timeoutMs).catch(function () {
        return new Promise(function (res) { setTimeout(res, 500); }).then(function () {
            return fetchTextOnce(url, opts, timeoutMs);
        });
    });
}

function fetchJsonLoose(url, opts, timeoutMs) {
    // API LK21 menjawab JSON valid walau status HTTP 403 — baca body apa adanya.
    return fetchText(url, opts, timeoutMs).then(function (t) { return JSON.parse(t); });
}

function tmdbDetails(tmdbId) {
    var url = TMDB_BASE + "/movie/" + tmdbId + "?api_key=" + TMDB_API_KEY;
    return fetchJsonLoose(url, null, 10000).then(function (d) {
        return {
            title: d.title || "",
            originalTitle: d.original_title || "",
            year: String(d.release_date || "").slice(0, 4),
            imdbId: d.imdb_id || ""
        };
    });
}

function normTitle(s) {
    return String(s || "").toLowerCase().replace(/\((?:19|20)\d{2}\)/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function titleScore(candidateTitle, info) {
    var cand = normTitle(candidateTitle);
    var targets = [normTitle(info.title), normTitle(info.originalTitle)].filter(Boolean);
    for (var i = 0; i < targets.length; i++) {
        if (cand === targets[i]) return 3;
        if (cand.indexOf(targets[i]) === 0 || targets[i].indexOf(cand) === 0) return 2;
        if (cand.indexOf(targets[i]) >= 0) return 1;
    }
    return 0;
}

function searchCandidates(info) {
    var q = encodeURIComponent(info.title || info.originalTitle);
    return fetchJsonLoose(API_BASE + "/api/v1/movies/?search=" + q, null, 12000).then(function (j) {
        var rows = (j && j.data) || [];
        var scored = rows.map(function (r) {
            var score = titleScore(r.title, info);
            if (info.year && String(r.year) === info.year) score += 2;
            return { slug: r.slug, title: r.title, year: String(r.year || ""), score: score };
        }).filter(function (c) { return c.score >= 2; });
        scored.sort(function (a, b) { return b.score - a.score; });
        return scored.slice(0, 3);
    }).catch(function () { return []; });
}

function lastSegment(url) {
    var clean = String(url || "").split(/[?#]/)[0].replace(/\/+$/, "");
    var parts = clean.split("/");
    return parts[parts.length - 1] || "";
}

function resolveP2pServer(server) {
    var tokens = [];
    if (server.p2p_embed_url) tokens.push(lastSegment(server.p2p_embed_url));
    if (server.embed_url) tokens.push(lastSegment(server.embed_url));
    tokens = tokens.filter(function (v, i, a) { return v && a.indexOf(v) === i; });
    var chain = Promise.resolve(null);
    tokens.forEach(function (tok) {
        chain = chain.then(function (found) {
            if (found) return found;
            var body = "host=p2p&id=" + encodeURIComponent(tok);
            return fetchJsonLoose("https://videonode.de/api.php", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded", "Referer": "https://videonode.de/" },
                body: body
            }, 12000).then(function (j) {
                var embed = (j && (j.embedUrl || j.embed_url)) || "";
                if (!embed || embed.indexOf("playcdn") < 0) return null;
                var playToken = lastSegment(embed);
                return fetchJsonLoose("https://playcdn.de/verify/" + encodeURIComponent(playToken), {
                    headers: { "Referer": "https://playcdn.de/" + playToken }
                }, 12000).then(function (v) {
                    if (v && v.status === "success" && v.fileUrl) return { fileUrl: v.fileUrl, title: v.title || "" };
                    return null;
                }).catch(function () { return null; });
            }).catch(function () { return null; });
        });
    });
    return chain;
}

function detailToStreams(detail, info) {
    var servers = ((detail && detail.streaming_servers) || []).filter(function (s) {
        return s && /^P2P/i.test(s.name || "") && (s.embed_url || s.p2p_embed_url) &&
            String(s.embed_url || s.p2p_embed_url).indexOf("videonode") >= 0;
    }).slice(0, 3);
    var jobs = servers.map(function (s) {
        return resolveP2pServer(s).then(function (r) {
            if (!r) return null;
            var hM = r.fileUrl.match(/\/(\d{3,4})\.m3u8/);
            var quality = hM ? hM[1] + "p" : "Unknown";
            return {
                name: "LK21 - " + s.name + " " + quality,
                title: r.title || (info.title + (info.year ? " (" + info.year + ")" : "")),
                url: r.fileUrl,
                quality: quality,
                size: "Unknown",
                headers: { "User-Agent": UA, "Referer": "https://playcdn.de/" },
                provider: "lk21"
            };
        });
    });
    return Promise.all(jobs).then(function (arr) {
        var seen = {}, out = [];
        arr.forEach(function (s) {
            if (s && !seen[s.url]) { seen[s.url] = true; out.push(s); }
        });
        return out;
    });
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    if (mediaType === "tv") return Promise.resolve([]);
    return tmdbDetails(tmdbId).then(function (info) {
        if (!info.title) return [];
        return searchCandidates(info).then(function (cands) {
            var chain = Promise.resolve([]);
            cands.forEach(function (cand) {
                chain = chain.then(function (streams) {
                    if (streams.length) return streams;
                    return fetchJsonLoose(API_BASE + "/api/v1/movies/" + encodeURIComponent(cand.slug), null, 12000).then(function (j) {
                        var detail = (j && j.data) || j || {};
                        // Verifikasi IMDb bila kedua sisi punya datanya.
                        if (info.imdbId && detail.imdb_id && detail.imdb_id !== info.imdbId) return [];
                        return detailToStreams(detail, info);
                    }).catch(function () { return []; });
                });
            });
            return chain;
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
