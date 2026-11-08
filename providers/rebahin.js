// Rebahin provider untuk Nuvio
// Sumber: rebahin (jaringan CSN — situs streaming sub Indo).
// Halaman judul /<slug>-<tahun> memuat tombol putar berisi data-token;
// token ditukar lewat API situs sendiri:
//   GET /api/stream/source?token=<token> -> { sources: [{name, url}] }
// URL sumber sudah berupa playlist HLS langsung (mayoritas e2e.majorplay.net).
// Catatan: tidak semua judul tersedia (sebagian halaman "belum tersedia").

const TMDB_API_KEY = "b030404650f279792a8d3287232358e3";
const TMDB_BASE = "https://api.themoviedb.org/3";
const UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

// Domain bisa berganti; urutan ini dicoba satu-satu.
const BASES = [
    "https://rebahin.pintas.vip",
    "https://rebahinxxi3.mom"
];

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
    // Gangguan soket sesaat cukup sering terjadi di jaringan situs seperti ini;
    // satu kali percobaan ulang menolong banyak.
    return fetchTextOnce(url, headers, timeoutMs).catch(function () {
        return new Promise(function (res) { setTimeout(res, 500); }).then(function () {
            return fetchTextOnce(url, headers, timeoutMs);
        });
    });
}

function fetchJson(url, headers, timeoutMs) {
    return fetchText(url, headers, timeoutMs).then(function (t) { return JSON.parse(t); });
}

function slugify(title) {
    return String(title || "").toLowerCase()
        .replace(/[''ʼ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
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

function probePlaylist(url, referer) {
    // Ambil master playlist: tentukan kualitas maks + trek subtitle bila ada.
    return fetchText(url, { "Referer": referer }, 10000).then(function (text) {
        if (text.indexOf("#EXTM3U") !== 0) return { quality: null, subtitles: [] };
        var maxH = 0;
        var re = /RESOLUTION=\d+x(\d+)/g, m;
        while ((m = re.exec(text)) !== null) { var h = parseInt(m[1], 10); if (h > maxH) maxH = h; }
        var subs = [];
        var lines = text.split("\n");
        for (var i = 0; i < lines.length; i++) {
            var ln = lines[i];
            if (ln.indexOf("#EXT-X-MEDIA:") === 0 && ln.indexOf("TYPE=SUBTITLES") >= 0) {
                var uriM = ln.match(/URI="([^"]+)"/);
                var langM = ln.match(/LANGUAGE="([^"]+)"/);
                var nameM = ln.match(/NAME="([^"]+)"/);
                if (uriM) {
                    var abs = uriM[1];
                    if (abs.indexOf("http") !== 0) {
                        var originM = url.match(/^(https?:\/\/[^\/]+)(\/.*)?$/);
                        if (originM) abs = originM[1] + (abs.charAt(0) === "/" ? abs : "/" + abs);
                    }
                    subs.push({ url: abs, lang: (langM ? langM[1] : "") || (nameM ? nameM[1] : "id") });
                }
            }
        }
        return { quality: maxH ? maxH + "p" : null, subtitles: subs };
    }).catch(function () { return { quality: null, subtitles: [] }; });
}

function sourcesToStreams(base, pageUrl, sources, fallbackTitle) {
    var jobs = (sources || []).filter(function (s) { return s && s.url && /\.m3u8|config-[^\/]+\.json/.test(s.url) || (s && s.url && s.url.indexOf(".m3u8") >= 0); })
        .map(function (s) {
            var cleanName = String(s.name || "Server").replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "").trim() || "Server";
            return probePlaylist(s.url, pageUrl).then(function (probe) {
                var st = {
                    name: "Rebahin - " + cleanName + (probe.quality ? " " + probe.quality : ""),
                    title: fallbackTitle,
                    url: s.url,
                    quality: probe.quality || "Unknown",
                    size: "Unknown",
                    headers: { "User-Agent": UA, "Referer": base + "/" },
                    provider: "rebahin"
                };
                if (probe.subtitles.length) {
                    st.subtitles = probe.subtitles.map(function (sb, i) {
                        return { id: "rebahin-sub-" + i, url: sb.url, lang: sb.lang };
                    });
                }
                return st;
            });
        });
    return Promise.all(jobs);
}

function resolveToken(base, pageUrl, token) {
    var url = base + "/api/stream/source?token=" + encodeURIComponent(token);
    return fetchJson(url, { "Referer": pageUrl }, 15000).then(function (j) {
        return (j && j.sources) || [];
    }).then(function (streams) { return attachFirkaizen(streams, tmdbId, mediaType, seasonNum, episodeNum); }).catch(function () { return []; });
}

function findMovieToken(html) {
    var m = html.match(/class="play-thumb"[^>]*data-token="([^"]+)"/) || html.match(/data-token="([^"]+)"[^>]*class="play-thumb"/);
    return m ? m[1] : null;
}

function findEpisodeToken(html, seasonNum, episodeNum) {
    // Tombol episode: .ep-btn dengan data-token; nomor dari atribut data-* atau teks tombol.
    var tagRe = /<(?:a|button)[^>]*class="[^"]*ep-btn[^"]*"[^>]*>([\s\S]*?)<\/(?:a|button)>/g;
    var m, candidates = [];
    while ((m = tagRe.exec(html)) !== null) {
        var tag = m[0], inner = m[1].replace(/<[^>]+>/g, " ").trim();
        var tokM = tag.match(/data-token="([^"]+)"/);
        if (!tokM) continue;
        var sM = tag.match(/data-season="(\d+)"/);
        var eM = tag.match(/data-episode="(\d+)"/) || inner.match(/(\d{1,3})/);
        candidates.push({
            token: tokM[1],
            season: sM ? parseInt(sM[1], 10) : null,
            episode: eM ? parseInt(eM[1], 10) : null
        });
    }
    for (var i = 0; i < candidates.length; i++) {
        if (candidates[i].episode === episodeNum && (candidates[i].season === null || candidates[i].season === seasonNum)) return candidates[i].token;
    }
    // Cadangan: urutan tombol = urutan episode (season tunggal).
    if (candidates.length >= episodeNum && episodeNum >= 1 && candidates.every(function (c) { return c.season === null || c.season === seasonNum; })) {
        return candidates[episodeNum - 1].token;
    }
    return null;
}

function tryBase(base, info, mediaType, seasonNum, episodeNum) {
    var titles = [info.title, info.originalTitle].filter(function (v, i, a) { return v && a.indexOf(v) === i; });
    var slugs = [];
    titles.forEach(function (t) {
        if (info.year) slugs.push(slugify(t) + "-" + info.year);
        slugs.push(slugify(t));
    });
    var chain = Promise.resolve(null);
    slugs.forEach(function (slug) {
        chain = chain.then(function (found) {
            if (found) return found;
            var pageUrl = base + "/" + slug;
            return fetchText(pageUrl, null, 12000).then(function (html) {
                if (/belum tersedia/i.test(html)) return null;
                var token = mediaType === "tv" ? findEpisodeToken(html, seasonNum, episodeNum) : findMovieToken(html);
                if (!token) return null;
                return { pageUrl: pageUrl, token: token };
            }).catch(function () { return null; });
        });
    });
    return chain.then(function (found) {
        if (!found) return [];
        return resolveToken(base, found.pageUrl, found.token).then(function (sources) {
            if (!sources.length) return [];
            var label = info.title + (info.year ? " (" + info.year + ")" : "");
            if (mediaType === "tv") label += " S" + seasonNum + "E" + episodeNum;
            return sourcesToStreams(base, found.pageUrl, sources, label);
        });
    });
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    return tmdbDetails(tmdbId, mediaType).then(function (info) {
        if (!info.title) return [];
        var chain = Promise.resolve([]);
        BASES.forEach(function (base) {
            chain = chain.then(function (streams) {
                if (streams && streams.length) return streams;
                return tryBase(base, info, mediaType, seasonNum || 1, episodeNum || 1).catch(function () { return []; });
            });
        });
        return chain;
    }).catch(function () { return []; });
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
