// Cineby provider untuk Nuvio
// Sumber: backend "Wings" API (keluarga Cineby/Videasy). Host lama
// api.speedracelight.com mati total (semua route 404); deployment yang hidup
// ditemukan lewat player vidy.st (dari recon Donkey, 2026-11-08):
//   GET https://api.wecollege.net/seed?mediaId=<tmdbId>    -> {seed, ttlMs}
//   GET https://api.wecollege.net/<city>/sources?title&mediaType&year&totalSeasons
//        &episodeId&seasonId&tmdbId&imdbId&enc=2&seed      -> payload terenkripsi
// Gate Cloudflare: hanya lolos dengan Referer/Origin https://www.vidy.st/
// Payload didekripsi lokal: base64url -> XOR keystream(seed, tmdbId) -> cek magic "mvm1" -> JSON
//   {sources:[{url,quality}], subtitles:[{url,lang}], playlist}
// Dekripsi terverifikasi byte-for-byte lawan implementasi asli + live lawan host ini.
// Pencocokan murni TMDB id + IMDb id. Kota dicoba berurutan sampai ada sumber;
// cakupan per kota per judul tidak merata (sebagian kota 401/500 untuk judul tertentu).
// Subtitle payload difilter ke id/en; kekurangannya dilengkapi FirKaizen (helper di bawah).

const TMDB_API_KEY = "b030404650f279792a8d3287232358e3";
const TMDB_BASE = "https://api.themoviedb.org/3";
const API_HOST = "https://api.wecollege.net";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const PLAY_HEADERS = { "User-Agent": UA, "Referer": "https://www.vidy.st/", "Origin": "https://www.vidy.st" };
const CITIES = ["miami", "boise", "nashville", "berlin", "paris", "munich", "chicago", "vegas", "cancun", "portland", "phoenix", "dallas"];

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

// ---- Kripto payload Wings (custom XOR keystream) ----
var SHA256_CONSTANTS = [1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993, 2453635748, 2870763221, 3624381080, 310598401, 607225278, 1426881987, 1925078388, 2162078206, 2614888103, 3248222580];
var MAGIC_BYTES = [109, 118, 109, 49]; // "mvm1"

function isCustomBranch(i) { return ((i * (i + 1)) & 1) === 0; }

function fmix32(x) {
    x = x >>> 0;
    x ^= x >>> 16;
    x = Math.imul(x, 2246822507) >>> 0;
    x ^= x >>> 13;
    x = Math.imul(x, 3266489909) >>> 0;
    return (x ^ (x >>> 16)) >>> 0;
}

function rotl32(x, n) {
    x = x >>> 0;
    n &= 31;
    if (n === 0) return x >>> 0;
    return ((x << n) | (x >>> (32 - n))) >>> 0;
}

var BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function pureBase64Decode(s) {
    var clean = "";
    for (var i = 0; i < s.length; i++) {
        var c = s.charAt(i);
        if (c !== "=" && BASE64_CHARS.indexOf(c) !== -1) clean += c;
    }
    var out = "";
    for (var j = 0; j < clean.length; j += 4) {
        var a = BASE64_CHARS.indexOf(clean.charAt(j));
        var b = BASE64_CHARS.indexOf(clean.charAt(j + 1));
        var cc = (j + 2 < clean.length) ? BASE64_CHARS.indexOf(clean.charAt(j + 2)) : -1;
        var d = (j + 3 < clean.length) ? BASE64_CHARS.indexOf(clean.charAt(j + 3)) : -1;
        out += String.fromCharCode((a << 2) | (b >> 4));
        if (cc !== -1) out += String.fromCharCode(((b & 15) << 4) | (cc >> 2));
        if (d !== -1) out += String.fromCharCode(((cc & 3) << 6) | d);
    }
    return out;
}

function base64UrlToBytes(s) {
    var b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    var bin = (typeof atob === "function") ? atob(b64) : pureBase64Decode(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

function fnv1a32(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0;
    }
    return fmix32(h);
}

function makeKeystreamState(seedStr, tmdbId) {
    var slots = new Array(61);
    var x = fmix32(fnv1a32(seedStr) ^ fmix32((tmdbId >>> 0) ^ -1640531527)) >>> 0;
    for (var i = 0; i < 8; i++) {
        if (isCustomBranch(i)) {
            var idx = x % 61;
            x = rotl32((x + 2654435769) >>> 0, 7 + (i & 7));
            slots[idx] = (x ^ fmix32(x)) >>> 0;
            x = fmix32((x + idx) >>> 0);
        } else {
            slots[i] = SHA256_CONSTANTS[i & 15];
        }
    }
    return { slots: slots, acc: fmix32(x ^ -1515870811) >>> 0 };
}

function nextKeystreamWord(state, counter) {
    var pos = state.acc % 61;
    var hole = (pos in state.slots) ? -1 : 0;
    var slotVal = state.slots[pos] >>> 0;
    var mixed = (slotVal ^ (Math.imul(2654435769, counter + 1) >>> 0)) >>> 0;
    var joined = (((state.acc ^ mixed) >>> 0) | ((state.acc & mixed & hole) >>> 0)) >>> 0;
    var rolled = (rotl32((joined + state.acc) >>> 0, pos & 31) ^ rotl32(state.acc, Math.imul(pos, 7) & 31)) >>> 0;
    var out = fmix32((rolled + 2654435769) >>> 0);
    state.slots[pos] = out;
    state.acc = out;
    return out >>> 0;
}

function generateKeystream(seedStr, tmdbId, len) {
    var state = makeKeystreamState(seedStr, tmdbId);
    var out = new Uint8Array(len);
    var pos = 0, counter = 0;
    while (pos < len) {
        var w = nextKeystreamWord(state, counter++);
        out[pos++] = w & 255;
        if (pos < len) out[pos++] = (w >>> 8) & 255;
        if (pos < len) out[pos++] = (w >>> 16) & 255;
        if (pos < len) out[pos++] = (w >>> 24) & 255;
    }
    return out;
}

function utf8BytesToString(bytes) {
    var out = "", i = 0;
    while (i < bytes.length) {
        var c = bytes[i++];
        if (c < 128) {
            out += String.fromCharCode(c);
        } else if ((c & 224) === 192) {
            var c2 = bytes[i++];
            out += String.fromCharCode(((c & 31) << 6) | (c2 & 63));
        } else if ((c & 240) === 224) {
            var d2 = bytes[i++], d3 = bytes[i++];
            out += String.fromCharCode(((c & 15) << 12) | ((d2 & 63) << 6) | (d3 & 63));
        } else if ((c & 248) === 240) {
            var e2 = bytes[i++], e3 = bytes[i++], e4 = bytes[i++];
            var cp = ((c & 7) << 18) | ((e2 & 63) << 12) | ((e3 & 63) << 6) | (e4 & 63);
            cp -= 65536;
            out += String.fromCharCode(55296 + (cp >> 10), 56320 + (cp & 1023));
        } else {
            out += String.fromCharCode(c);
        }
    }
    return out;
}

function decryptSourcesPayload(payload, seedStr, tmdbId) {
    var bytes = base64UrlToBytes(payload);
    var ks = generateKeystream(seedStr, tmdbId, bytes.length);
    var plain = new Uint8Array(bytes.length);
    for (var i = 0; i < bytes.length; i++) plain[i] = bytes[i] ^ ks[i];
    for (var j = 0; j < MAGIC_BYTES.length; j++) {
        if (plain[j] !== MAGIC_BYTES[j]) throw new Error("decrypt failed: bad seed or tampered payload");
    }
    return utf8BytesToString(plain.subarray(MAGIC_BYTES.length));
}

// ---- Alur utama ----

function tmdbMeta(tmdbId, mediaType) {
    var kind = mediaType === "tv" ? "tv" : "movie";
    var url = TMDB_BASE + "/" + kind + "/" + tmdbId + "?api_key=" + TMDB_API_KEY + "&append_to_response=external_ids";
    return fetchJson(url, null, 10000).then(function (d) {
        return {
            title: (kind === "tv" ? d.name : d.title) || "",
            year: String((kind === "tv" ? d.first_air_date : d.release_date) || "").slice(0, 4),
            imdbId: (d.external_ids && d.external_ids.imdb_id) || d.imdb_id || "",
            totalSeasons: d.number_of_seasons || 1
        };
    });
}

function normSubLang(raw) {
    var s = String(raw || "").toLowerCase().trim();
    if (!s) return "";
    if (s === "id" || s === "ind" || s === "in" || s.indexOf("indonesia") === 0 || s.indexOf("bahasa") === 0) return "id";
    if (s === "en" || s === "eng" || s.indexOf("english") === 0) return "en";
    return "";
}

function pickSubs(subs) {
    var out = [];
    (subs || []).forEach(function (s) {
        if (!s || !s.url) return;
        var lang = normSubLang(s.lang || s.language || s.label || s.name);
        if (!lang) return;
        if (out.some(function (x) { return x.lang === lang; })) return;
        out.push({ id: "cineby-sub-" + lang, url: s.url, lang: lang });
    });
    return out;
}

function qualityRank(q) {
    if (!q) return 0;
    if (/4k/i.test(String(q))) return 2160;
    var n = parseInt(q, 10);
    return isFinite(n) ? n : 0;
}

function fetchSeed(idNum) {
    return fetchJson(API_HOST + "/seed?mediaId=" + idNum, PLAY_HEADERS, 12000).then(function (j) {
        return (j && j.seed) ? j.seed : null;
    }).catch(function () { return null; });
}

function tryCity(city, meta, idNum, isTv, seasonNum, episodeNum, seed) {
    var qs = "title=" + encodeURIComponent(meta.title) +
        "&mediaType=" + (isTv ? "tv" : "movie") +
        "&year=" + encodeURIComponent(meta.year || "") +
        "&totalSeasons=" + encodeURIComponent(String(meta.totalSeasons || 1)) +
        "&episodeId=" + encodeURIComponent(String(isTv ? (episodeNum || 1) : 1)) +
        "&seasonId=" + encodeURIComponent(String(isTv ? (seasonNum || 1) : 1)) +
        "&tmdbId=" + encodeURIComponent(String(idNum)) +
        "&imdbId=" + encodeURIComponent(meta.imdbId || "") +
        "&enc=2&seed=" + encodeURIComponent(seed);
    // Sekali jalan tanpa retry generik: kota yang gagal langsung diganti kota berikutnya.
    return fetchTextOnce(API_HOST + "/" + city + "/sources?" + qs, PLAY_HEADERS, 20000).then(function (payload) {
        var parsed = JSON.parse(decryptSourcesPayload(String(payload).trim(), seed, idNum));
        var sources = (parsed && parsed.sources) || [];
        if (!sources.length && parsed && parsed.playlist) {
            sources = [{ url: parsed.playlist, quality: "Auto" }];
        }
        if (!sources.length) return null;
        return { parsed: parsed, sources: sources };
    }).catch(function () { return null; });
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    var idNum = parseInt(tmdbId, 10);
    if (!idNum) return Promise.resolve([]);
    var isTv = mediaType === "tv";
    return tmdbMeta(idNum, mediaType).then(function (meta) {
        if (!meta || !meta.title) return [];
        return fetchSeed(idNum).then(function (seed) {
            if (!seed) return [];
            var label = meta.title + (meta.year ? " (" + meta.year + ")" : "");
            if (isTv) label += " S" + (seasonNum || 1) + "E" + (episodeNum || 1);
            var chain = Promise.resolve(null);
            CITIES.forEach(function (city) {
                chain = chain.then(function (hit) {
                    if (hit) return hit;
                    return tryCity(city, meta, idNum, isTv, seasonNum, episodeNum, seed).then(function (r) {
                        if (r) return r;
                        // Seed berumur pendek (ttl 30 dtk) — segarkan sekali lalu coba kota ini lagi.
                        return fetchSeed(idNum).then(function (seed2) {
                            if (!seed2 || seed2 === seed) return null;
                            seed = seed2;
                            return tryCity(city, meta, idNum, isTv, seasonNum, episodeNum, seed2);
                        });
                    });
                });
            });
            return chain.then(function (hit) {
                if (!hit) return [];
                var subs = pickSubs(hit.parsed.subtitles);
                var streams = hit.sources.filter(function (s) { return s && typeof s.url === "string" && s.url.indexOf("http") === 0; }).map(function (s) {
                    var quality = s.quality ? String(s.quality) : "Auto";
                    if (/^\d+$/.test(quality)) quality = quality + "p";
                    var st = {
                        name: "Cineby " + quality,
                        title: label,
                        url: s.url,
                        quality: quality,
                        size: "Unknown",
                        headers: { "User-Agent": UA, "Referer": "https://www.vidy.st/", "Origin": "https://www.vidy.st" },
                        provider: "cineby"
                    };
                    if (subs.length) st.subtitles = subs.slice();
                    return st;
                });
                streams.sort(function (a, b) { return qualityRank(b.quality) - qualityRank(a.quality); });
                return streams;
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
