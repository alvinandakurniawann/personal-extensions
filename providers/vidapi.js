// VidAPI provider untuk Nuvio
// Sumber: VidAPI (streamdata.vaplayer.ru) — API data di balik zxcstream "Backup IV"
// dan provider PlayIMDb di repo D3adlyRocket. Satu panggilan API per judul:
//   GET api.php?tmdb=<id>&type=movie
//   GET api.php?tmdb=<id>&type=tv&season=<s>&episode=<e>
//   (wajib header Origin/Referer nextgencloudfabric.com)
// Baliknya: stream m3u8 langsung + default_subs (sering ada Indonesia + Inggris).
// Pencocokan murni TMDB id (API mengembalikan imdb_id yang cocok) — anti salah judul.
// Subtitle id/en yang kosong dilengkapi dari API FirKaizen (helper di bawah).

const API_BASE = "https://streamdata.vaplayer.ru/api.php";
const PLAYER_ORIGIN = "https://nextgencloudfabric.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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

function pickSubs(defaultSubs) {
    var out = [];
    (defaultSubs || []).forEach(function (s) {
        if (!s || !s.url) return;
        var code = String(s.code || "").toLowerCase();
        var lang = "";
        if (code === "id" || code === "ind" || /indonesia/.test(String(s.lang || "").toLowerCase())) lang = "id";
        else if (code === "en" || code === "eng" || /^english/.test(String(s.lang || "").toLowerCase())) lang = "en";
        if (!lang) return;
        if (out.some(function (x) { return x.lang === lang; })) return;
        out.push({ id: "vidapi-sub-" + lang, url: s.url, lang: lang });
    });
    return out;
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    var url = API_BASE + "?tmdb=" + tmdbId + "&type=" + (mediaType === "tv" ? "tv" : "movie");
    if (mediaType === "tv") url += "&season=" + (seasonNum || 1) + "&episode=" + (episodeNum || 1);
    var headers = { "Origin": PLAYER_ORIGIN, "Referer": PLAYER_ORIGIN + "/" };
    return fetchJson(url, headers, 15000).then(function (j) {
        var d = (j && j.data) || {};
        var urls = d.stream_urls || [];
        if (!urls.length) return [];
        var qM = String(d.file_name || "").match(/(\d{3,4})p/);
        var quality = qM ? qM[1] + "p" : "Auto";
        var subs = pickSubs(j.default_subs);
        var title = d.title || "";
        var streams = urls.filter(function (u) { return typeof u === "string" && u.indexOf("http") === 0; }).map(function (u, i) {
            var st = {
                name: "VidAPI " + quality + (urls.length > 1 ? " (" + (i + 1) + ")" : ""),
                title: title,
                url: u,
                quality: quality,
                size: "Unknown",
                headers: { "User-Agent": UA, "Referer": PLAYER_ORIGIN + "/" },
                provider: "vidapi"
            };
            if (subs.length) st.subtitles = subs.slice();
            return st;
        });
        return streams;
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
