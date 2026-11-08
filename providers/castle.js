// Castle provider untuk Nuvio
// Sumber: backend aplikasi Castle (api.hlowb.com) — API JSON terenkripsi:
//   GET  /v0.1/system/getSecurityKey/1                     -> {data: "<kunci>"}
//   GET  /film-api/v1.1.0/movie/searchByKeyword?keyword=   -> data terenkripsi
//   GET  /film-api/v1.9.9/movie?movieId=                   -> detail + episode + tracks bahasa
//   POST /film-api/v2.0.1/movie/getVideo2                  -> {videoUrl (HLS bertanda tangan), videos[], subtitles[]}
// Semua respons (selain security key) terenkripsi AES-128-CBC:
//   kunci = 16 byte pertama dari Base64Decode(securityKey) + "T!BgJB", IV = kunci yang sama.
//   Dekripsi pure-JS (blok AES yang sama dengan provider IDLIX, terverifikasi).
// Pencocokan: TMDB -> judul+Inggris -> search Castle dengan judul+tahun; judul persis diutamakan.
// Resolusi diminta per level (1=480p, 2=720p; 3=1080p premium -> permissionDenied, dilewati)
//   supaya label kualitas selalu sesuai URL aslinya.
// Subtitle bawaan Castle difilter ke id/en; kekurangannya dilengkapi FirKaizen (helper di bawah).

const TMDB_API_KEY = "b030404650f279792a8d3287232358e3";
const TMDB_BASE = "https://api.themoviedb.org/3";
const CASTLE_BASE = "https://api.hlowb.com";
const PKG = "com.external.castle";
const CHANNEL = "IndiaA";
const CLIENT = "1";
const LANG = "en-US";
const APK_SIGN = "ED0955EB04E67A1D9F3305B95454FED485261475";
const API_UA = "okhttp/4.9.3";
const API_HEADERS = { "User-Agent": API_UA, "Accept": "application/json", "Accept-Language": "en-US,en;q=0.9", "Referer": CASTLE_BASE };
const PLAYBACK_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
    "Accept": "video/webm,video/ogg,video/*;q=0.9,application/ogg;q=0.7,audio/*;q=0.6,*/*;q=0.5",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "identity",
    "Connection": "keep-alive"
};
const UA = API_UA;

function fetchTextOnce(url, headers, timeoutMs, opts) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || 12000);
    var hdrs = Object.assign({ "User-Agent": UA }, headers || {});
    if (opts && opts.headers) Object.assign(hdrs, opts.headers);
    var o = { headers: hdrs, signal: ctrl.signal };
    if (opts && opts.method) o.method = opts.method;
    if (opts && opts.body) o.body = opts.body;
    return fetch(url, o).then(function (r) {
        clearTimeout(timer);
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text();
    }).catch(function (e) { clearTimeout(timer); throw e; });
}

function fetchText(url, headers, timeoutMs, opts) {
    return fetchTextOnce(url, headers, timeoutMs, opts).catch(function () {
        return new Promise(function (res) { setTimeout(res, 400); }).then(function () {
            return fetchTextOnce(url, headers, timeoutMs, opts);
        });
    });
}

function fetchJson(url, headers, timeoutMs, opts) {
    return fetchText(url, headers, timeoutMs, opts).then(function (t) { return JSON.parse(t); });
}

// ---------- byte helpers (dari IDLIX, terverifikasi) ----------
function utf8Bytes(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
        var c = str.charCodeAt(i);
        if (c < 0x80) out.push(c);
        else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); }
        else { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
    }
    return out;
}
function bytesToUtf8(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    try { return decodeURIComponent(escape(s)); } catch (e) { return s; }
}
function hexToBytes(hex) {
    var out = [];
    for (var i = 0; i + 1 < hex.length; i += 2) out.push(parseInt(hex.substr(i, 2), 16));
    return out;
}
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function b64decodeToBytes(input) {
    var str = String(input).replace(/=+$/, "");
    var out = [], bits = 0, val = 0;
    for (var i = 0; i < str.length; i++) {
        var idx = B64.indexOf(str.charAt(i));
        if (idx < 0) continue;
        val = (val << 6) | idx; bits += 6;
        if (bits >= 8) { bits -= 8; out.push((val >> bits) & 0xff); }
    }
    return out;
}
function b64decodeToString(input) { return bytesToUtf8(b64decodeToBytes(input)); }

// ---------- AES pure-JS (dari IDLIX, terverifikasi) ----------
function gfMul(a, b) {
    var p = 0;
    for (var i = 0; i < 8; i++) {
        if (b & 1) p ^= a;
        var hi = a & 0x80;
        a = (a << 1) & 0xff;
        if (hi) a ^= 0x1b;
        b >>= 1;
    }
    return p;
}
const SBOX = [], INV_SBOX = [];
(function buildSbox() {
    for (var i = 0; i < 256; i++) {
        var inv = 0;
        if (i !== 0) { for (var j = 1; j < 256; j++) { if (gfMul(i, j) === 1) { inv = j; break; } } }
        var s = inv ^ ((inv << 1) | (inv >>> 7)) ^ ((inv << 2) | (inv >>> 6)) ^ ((inv << 3) | (inv >>> 5)) ^ ((inv << 4) | (inv >>> 4)) ^ 0x63;
        s &= 0xff;
        SBOX.push(s); INV_SBOX[s] = i;
    }
})();
const RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36, 0x6c, 0xd8, 0xab, 0x4d];

function aesExpandKey(key) {
    var Nk = key.length / 4, Nr = Nk + 6;
    var w = [];
    for (var i = 0; i < key.length; i++) w.push(key[i]);
    for (var n = Nk; n < 4 * (Nr + 1); n++) {
        var temp = [w[4 * (n - 1)], w[4 * (n - 1) + 1], w[4 * (n - 1) + 2], w[4 * (n - 1) + 3]];
        if (n % Nk === 0) {
            temp = [SBOX[temp[1]] ^ RCON[n / Nk - 1], SBOX[temp[2]], SBOX[temp[3]], SBOX[temp[0]]];
        } else if (Nk > 6 && n % Nk === 4) {
            temp = [SBOX[temp[0]], SBOX[temp[1]], SBOX[temp[2]], SBOX[temp[3]]];
        }
        for (var k = 0; k < 4; k++) w.push(w[4 * (n - Nk) + k] ^ temp[k]);
    }
    return { w: w, Nr: Nr };
}
function aesDecryptBlock(block, expanded) {
    var w = expanded.w, Nr = expanded.Nr;
    var s = block.slice();
    function addRoundKey(round) { for (var i = 0; i < 16; i++) s[i] ^= w[round * 16 + i]; }
    function invShiftRows() {
        var t = s.slice();
        // state is column-major: s[4*col + row]
        for (var row = 0; row < 4; row++) {
            for (var col = 0; col < 4; col++) {
                s[4 * col + row] = t[4 * ((col - row + 4) % 4) + row];
            }
        }
    }
    function invSubBytes() { for (var i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]]; }
    function invMixColumns() {
        for (var col = 0; col < 4; col++) {
            var i0 = 4 * col;
            var a0 = s[i0], a1 = s[i0 + 1], a2 = s[i0 + 2], a3 = s[i0 + 3];
            s[i0] = gfMul(a0, 14) ^ gfMul(a1, 11) ^ gfMul(a2, 13) ^ gfMul(a3, 9);
            s[i0 + 1] = gfMul(a0, 9) ^ gfMul(a1, 14) ^ gfMul(a2, 11) ^ gfMul(a3, 13);
            s[i0 + 2] = gfMul(a0, 13) ^ gfMul(a1, 9) ^ gfMul(a2, 14) ^ gfMul(a3, 11);
            s[i0 + 3] = gfMul(a0, 11) ^ gfMul(a1, 13) ^ gfMul(a2, 9) ^ gfMul(a3, 14);
        }
    }
    addRoundKey(Nr);
    for (var round = Nr - 1; round >= 1; round--) {
        invShiftRows(); invSubBytes(); addRoundKey(round); invMixColumns();
    }
    invShiftRows(); invSubBytes(); addRoundKey(0);
    return s;
}
function aesCbcDecrypt(ctBytes, key, iv) {
    var expanded = aesExpandKey(key);
    var out = [];
    var prev = iv.slice();
    for (var off = 0; off < ctBytes.length; off += 16) {
        var block = ctBytes.slice(off, off + 16);
        var dec = aesDecryptBlock(block, expanded);
        for (var i = 0; i < 16; i++) out.push(dec[i] ^ prev[i]);
        prev = block;
    }
    // PKCS7 strip
    if (out.length) {
        var pad = out[out.length - 1];
        if (pad >= 1 && pad <= 16) out = out.slice(0, out.length - pad);
    }
    return out;
}

// ---------- Dekripsi Castle ----------
function decryptCastle(cipherB64, secKey) {
    var kb = b64decodeToBytes(secKey).concat(utf8Bytes("T!BgJB"));
    while (kb.length < 16) kb.push(0);
    if (kb.length > 16) kb = kb.slice(0, 16);
    var plain = aesCbcDecrypt(b64decodeToBytes(cipherB64), kb, kb.slice());
    return bytesToUtf8(plain);
}

function cipherFromText(t) {
    var s = String(t || "").trim();
    if (!s) throw new Error("empty response");
    try {
        var j = JSON.parse(s);
        if (j && typeof j.data === "string") return j.data.trim();
    } catch (e) {}
    return s;
}

function castleApi(path, secKey, opts) {
    return fetchText(CASTLE_BASE + path, API_HEADERS, 15000, opts).then(function (t) {
        return JSON.parse(decryptCastle(cipherFromText(t), secKey));
    });
}

function getSecurityKey() {
    var url = CASTLE_BASE + "/v0.1/system/getSecurityKey/1?channel=" + CHANNEL + "&clientType=" + CLIENT + "&lang=" + LANG;
    return fetchJson(url, API_HEADERS, 12000).then(function (j) {
        if (!j || j.code !== 200 || !j.data) throw new Error("security key failed");
        return j.data;
    });
}

function tmdbDetails(tmdbId, mediaType) {
    var kind = mediaType === "tv" ? "tv" : "movie";
    var url = TMDB_BASE + "/" + kind + "/" + tmdbId + "?api_key=" + TMDB_API_KEY + "&append_to_response=external_ids";
    return fetchJson(url, null, 10000).then(function (d) {
        var date = kind === "tv" ? d.first_air_date : d.release_date;
        return {
            title: (kind === "tv" ? d.name : d.title) || "",
            originalTitle: (kind === "tv" ? d.original_name : d.original_title) || "",
            year: date ? parseInt(String(date).slice(0, 4), 10) : null
        };
    });
}

function normTitle(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }

function searchCastle(secKey, keyword) {
    var qs = "channel=" + CHANNEL + "&clientType=" + CLIENT + "&keyword=" + encodeURIComponent(keyword) +
        "&lang=" + LANG + "&mode=1&packageName=" + PKG + "&page=1&size=30";
    return castleApi("/film-api/v1.1.0/movie/searchByKeyword?" + qs, secKey).then(function (j) {
        var d = (j && j.data && typeof j.data === "object") ? j.data : (j || {});
        return d.rows || [];
    }).catch(function () { return []; });
}

function findCastleId(secKey, info) {
    var keywords = [];
    if (info.year) keywords.push(info.title + " " + info.year);
    keywords.push(info.title);
    if (info.originalTitle && info.originalTitle !== info.title) {
        if (info.year) keywords.push(info.originalTitle + " " + info.year);
        keywords.push(info.originalTitle);
    }
    var firstRow = null;
    var chain = Promise.resolve(null);
    keywords.forEach(function (kw) {
        chain = chain.then(function (found) {
            if (found) return found;
            return searchCastle(secKey, kw).then(function (rows) {
                if (!rows.length) return null;
                if (!firstRow) firstRow = rows[0];
                var target = normTitle(kw.replace(/ \d{4}$/, ""));
                var exact = null, partial = null;
                rows.forEach(function (row) {
                    var cand = normTitle(row.title || row.name);
                    if (!cand) return;
                    if (!exact && cand === target) exact = row;
                    else if (!partial && target && (cand.indexOf(target) >= 0 || target.indexOf(cand) >= 0)) partial = row;
                });
                var hit = exact || partial;
                if (hit && (hit.id || hit.redirectId || hit.redirectIdStr)) return String(hit.id || hit.redirectId || hit.redirectIdStr);
                return null;
            });
        });
    });
    return chain.then(function (found) {
        if (found) return found;
        if (firstRow && (firstRow.id || firstRow.redirectId || firstRow.redirectIdStr)) return String(firstRow.id || firstRow.redirectId || firstRow.redirectIdStr);
        return null;
    });
}

function getDetails(secKey, movieId) {
    var path = "/film-api/v1.9.9/movie?channel=" + CHANNEL + "&clientType=" + CLIENT + "&lang=" + LANG +
        "&movieId=" + encodeURIComponent(movieId) + "&packageName=" + PKG;
    return castleApi(path, secKey).then(function (j) {
        return (j && j.data && typeof j.data === "object") ? j.data : (j || {});
    });
}

var RES_LABEL = { 1: "480p", 2: "720p", 3: "1080p" };

function getVideo(secKey, movieId, episodeId, resolution, languageId) {
    var path = "/film-api/v2.0.1/movie/getVideo2?clientType=" + CLIENT + "&packageName=" + PKG + "&channel=" + CHANNEL + "&lang=" + LANG;
    var body = {
        mode: "1", appMarket: "GuanWang", clientType: CLIENT, woolUser: "false",
        apkSignKey: APK_SIGN, androidVersion: "13",
        movieId: String(movieId), episodeId: String(episodeId),
        isNewUser: "true", resolution: String(resolution), packageName: PKG
    };
    if (languageId) body.languageId = String(languageId);
    return castleApi(path, secKey, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        .then(function (j) { return (j && j.data && typeof j.data === "object") ? j.data : (j || {}); });
}

function normSubLang(sub) {
    var ab = String((sub && sub.abbreviate) || "").toLowerCase().trim();
    var ti = String((sub && sub.title) || "").toLowerCase().trim();
    if (ab === "id" || ab === "ind" || ab === "in" || ti.indexOf("indonesia") === 0 || ti.indexOf("bahasa") === 0) return "id";
    if (ab === "en" || ab === "eng" || ti.indexOf("english") === 0) return "en";
    return "";
}

function pickSubs(subs) {
    var out = [];
    (subs || []).forEach(function (s) {
        if (!s || !s.url) return;
        var lang = normSubLang(s);
        if (!lang) return;
        if (out.some(function (x) { return x.lang === lang; })) return;
        out.push({ id: "castle-sub-" + lang, url: s.url, lang: lang });
    });
    return out;
}

function formatSize(n) {
    if (typeof n !== "number" || !(n > 0)) return "Unknown";
    if (n > 1000000000) return (n / 1000000000).toFixed(2) + " GB";
    return Math.round(n / 1000000) + " MB";
}

function sizeForResolution(vd, resolution) {
    var list = (vd && vd.videos) || [];
    for (var i = 0; i < list.length; i++) {
        if (list[i].resolution === resolution) return formatSize(list[i].size);
    }
    return formatSize(vd && vd.size);
}

function qualityRank(q) {
    var n = parseInt(q, 10);
    return isFinite(n) ? n : 0;
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    return tmdbDetails(tmdbId, mediaType).then(function (info) {
        if (!info.title) return [];
        return getSecurityKey().then(function (secKey) {
            return findCastleId(secKey, info).then(function (movieId) {
                if (!movieId) return [];
                return getDetails(secKey, movieId).then(function (detail) {
                    var workId = movieId;
                    var detP = Promise.resolve(detail);
                    if (mediaType === "tv") {
                        var seasons = detail.seasons || [];
                        var sHit = null;
                        seasons.forEach(function (s) { if (s.number === (seasonNum || 1)) sHit = s; });
                        if (sHit && sHit.movieId && String(sHit.movieId) !== String(movieId)) {
                            workId = String(sHit.movieId);
                            detP = getDetails(secKey, workId);
                        }
                    }
                    return detP.then(function (det) {
                        var eps = det.episodes || [];
                        if (!eps.length) return [];
                        var ep = null;
                        if (mediaType === "tv") {
                            eps.forEach(function (e) { if (e.number === (episodeNum || 1)) ep = e; });
                        } else {
                            ep = eps[0];
                        }
                        if (!ep || !ep.id) return [];
                        var label = info.title + (info.year ? " (" + info.year + ")" : "");
                        if (mediaType === "tv") label += " S" + (seasonNum || 1) + "E" + (episodeNum || 1);
                        var tracks = (ep.tracks || []).filter(function (t) { return t.existIndividualVideo && t.languageId; }).slice(0, 6);
                        var streams = [];
                        function pushFrom(vd, resolution, langLabel) {
                            if (!vd || vd.permissionDenied || !vd.videoUrl) return;
                            var quality = RES_LABEL[resolution] || (resolution + "p");
                            var st = {
                                name: "Castle" + (langLabel ? " [" + langLabel + "]" : "") + " " + quality,
                                title: label,
                                url: vd.videoUrl,
                                quality: quality,
                                size: sizeForResolution(vd, resolution),
                                headers: PLAYBACK_HEADERS,
                                provider: "castle"
                            };
                            var subs = pickSubs(vd.subtitles);
                            if (subs.length) st.subtitles = subs;
                            streams.push(st);
                        }
                        var jobs;
                        if (tracks.length) {
                            jobs = tracks.reduce(function (acc, t) {
                                return acc.then(function () {
                                    return getVideo(secKey, workId, ep.id, 2, t.languageId).then(function (vd) {
                                        pushFrom(vd, 2, t.languageName || t.abbreviate || "");
                                        return getVideo(secKey, workId, ep.id, 1, t.languageId).then(function (vd1) {
                                            pushFrom(vd1, 1, t.languageName || t.abbreviate || "");
                                        }).catch(function () {});
                                    }).catch(function () {});
                                });
                            }, Promise.resolve());
                        } else {
                            jobs = getVideo(secKey, workId, ep.id, 2, null).then(function (vd) {
                                pushFrom(vd, 2, "");
                                return getVideo(secKey, workId, ep.id, 1, null).then(function (vd1) {
                                    pushFrom(vd1, 1, "");
                                }).catch(function () {});
                            }).catch(function () {});
                        }
                        return jobs.then(function () {
                            streams.sort(function (a, b) { return qualityRank(b.quality) - qualityRank(a.quality); });
                            return streams;
                        });
                    });
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
