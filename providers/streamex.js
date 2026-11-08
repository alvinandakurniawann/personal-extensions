// StreamEx provider untuk Nuvio
// Sumber: StreamEx (streamex.hn) — frontend TMDB murni; server putar pertamanya
// "streamex" = play.xpass.top (keluarga 1x2.space). Rantai (terverifikasi live):
//   GET play.xpass.top/e/movie/<tmdbId>  (TV: /e/tv/<id>/<s>/<e>)
//        -> HTML berisi var dataUrl="/data/...?token=<token per-view>"
//   GET play.xpass.top<dataUrl> -> blob base64url terenkripsi AES-256-GCM:
//        key = SHA-256("spv3-data-response|" + BUILD + "|" + pathname + "|" + token),
//        IV = 12 byte pertama payload; tag GCM diverifikasi (BUILD basi -> tag gagal -> []).
//        Plaintext: JSON daftar sumber [{name, url}] (TIK/VIP/FIL/VID).
//   GET play.xpass.top<source.url> -> playlist JW {playlist:[{sources:[{file: master.m3u8}]}]}
//   master.m3u8 di *.1x2.space (Cloudflare) — wajib header Referer: https://play.xpass.top/
// Kripto SHA-256 + AES-GCM ditulis pure-JS (blok AES dari IDLIX + lapisan GHASH),
// terverifikasi lawan WebCrypto/Node pada payload hidup.
// CATATAN MAINTENANCE: string BUILD tertanam di player xpass; bila mereka redeploy
// player dan provider ini mendadak kosong, BUILD perlu diperbarui dari player baru.
// Subtitle: API terbuka sub.1x2.space (WEBVTT per bahasa, tanpa auth) — difilter id/en;
// kekurangan dilengkapi FirKaizen. Pencocokan murni TMDB id, nol risiko salah judul.

const TMDB_API_KEY = "b030404650f279792a8d3287232358e3";
const TMDB_BASE = "https://api.themoviedb.org/3";
const XPASS = "https://play.xpass.top";
const SUB_HOST = "https://sub.1x2.space";
const BUILD = "spv3-build-1787821613-50e5fc97c9dce367";
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

// ---------- AES key schedule + S-box (dari IDLIX, terverifikasi) ----------
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

// ---------- SHA-256 (pure-JS) ----------
var SHA256_K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
function rotr32(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }
function sha256Bytes(msg) {
    var H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    var ml = msg.length;
    var padded = msg.slice();
    padded.push(0x80);
    while (padded.length % 64 !== 56) padded.push(0);
    var bitLen = ml * 8;
    for (var i = 7; i >= 0; i--) padded.push(Math.floor(bitLen / Math.pow(2, 8 * i)) & 0xff);
    var w = new Array(64);
    for (var off = 0; off < padded.length; off += 64) {
        for (var t = 0; t < 16; t++) {
            w[t] = ((padded[off + 4 * t] << 24) | (padded[off + 4 * t + 1] << 16) | (padded[off + 4 * t + 2] << 8) | padded[off + 4 * t + 3]) >>> 0;
        }
        for (var t2 = 16; t2 < 64; t2++) {
            var s0 = (rotr32(w[t2 - 15], 7) ^ rotr32(w[t2 - 15], 18) ^ (w[t2 - 15] >>> 3)) >>> 0;
            var s1 = (rotr32(w[t2 - 2], 17) ^ rotr32(w[t2 - 2], 19) ^ (w[t2 - 2] >>> 10)) >>> 0;
            w[t2] = (w[t2 - 16] + s0 + w[t2 - 7] + s1) >>> 0;
        }
        var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
        for (var r = 0; r < 64; r++) {
            var S1 = (rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25)) >>> 0;
            var ch = ((e & f) ^ (~e & g)) >>> 0;
            var temp1 = (h + S1 + ch + SHA256_K[r] + w[r]) >>> 0;
            var S0 = (rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22)) >>> 0;
            var maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
            var temp2 = (S0 + maj) >>> 0;
            h = g; g = f; f = e; e = (d + temp1) >>> 0;
            d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
        }
        H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
        H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    var out = [];
    H.forEach(function (x) { out.push((x >>> 24) & 0xff, (x >>> 16) & 0xff, (x >>> 8) & 0xff, x & 0xff); });
    return out;
}

// ---------- AES encrypt block (arah maju, untuk GCM) ----------
function aesEncryptBlock(block, expanded) {
    var w = expanded.w, Nr = expanded.Nr;
    var s = block.slice();
    function addRoundKey(round) { for (var i = 0; i < 16; i++) s[i] ^= w[round * 16 + i]; }
    function subBytes() { for (var i = 0; i < 16; i++) s[i] = SBOX[s[i]]; }
    function shiftRows() {
        var t = s.slice();
        for (var row = 0; row < 4; row++) {
            for (var col = 0; col < 4; col++) {
                s[4 * col + row] = t[4 * ((col + row) % 4) + row];
            }
        }
    }
    function mixColumns() {
        for (var col = 0; col < 4; col++) {
            var i0 = 4 * col;
            var a0 = s[i0], a1 = s[i0 + 1], a2 = s[i0 + 2], a3 = s[i0 + 3];
            s[i0] = gfMul(a0, 2) ^ gfMul(a1, 3) ^ a2 ^ a3;
            s[i0 + 1] = a0 ^ gfMul(a1, 2) ^ gfMul(a2, 3) ^ a3;
            s[i0 + 2] = a0 ^ a1 ^ gfMul(a2, 2) ^ gfMul(a3, 3);
            s[i0 + 3] = gfMul(a0, 3) ^ a1 ^ a2 ^ gfMul(a3, 2);
        }
    }
    addRoundKey(0);
    for (var round = 1; round < Nr; round++) {
        subBytes(); shiftRows(); mixColumns(); addRoundKey(round);
    }
    subBytes(); shiftRows(); addRoundKey(Nr);
    return s;
}

// ---------- GHASH + AES-GCM decrypt ----------
function gf128Mul(x, y) {
    var z = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
    var v = y.slice();
    for (var i = 0; i < 128; i++) {
        if ((x[i >> 3] >> (7 - (i & 7))) & 1) {
            for (var j = 0; j < 16; j++) z[j] ^= v[j];
        }
        var lsb = v[15] & 1;
        for (var k = 15; k > 0; k--) v[k] = ((v[k] >>> 1) | ((v[k - 1] & 1) << 7)) & 0xff;
        v[0] = v[0] >>> 1;
        if (lsb) v[0] ^= 0xe1;
    }
    return z;
}
function ghash(H, data) {
    var Y = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
    for (var off = 0; off < data.length; off += 16) {
        for (var i = 0; i < 16; i++) Y[i] ^= (data[off + i] || 0);
        Y = gf128Mul(Y, H);
    }
    return Y;
}
function inc32(ctr) {
    var out = ctr.slice();
    var n = ((out[12] << 24) | (out[13] << 16) | (out[14] << 8) | out[15]) >>> 0;
    n = (n + 1) >>> 0;
    out[12] = (n >>> 24) & 0xff; out[13] = (n >>> 16) & 0xff; out[14] = (n >>> 8) & 0xff; out[15] = n & 0xff;
    return out;
}
function aesGcmDecrypt(key, payload) {
    // payload: IV(12) || ciphertext || tag(16)
    if (payload.length < 12 + 16) throw new Error("payload too short");
    var iv = payload.slice(0, 12);
    var tag = payload.slice(payload.length - 16);
    var ct = payload.slice(12, payload.length - 16);
    var expanded = aesExpandKey(key);
    var H = aesEncryptBlock([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], expanded);
    var J0 = iv.concat([0, 0, 0, 1]);
    // Verifikasi tag: GHASH atas ct (AAD kosong) + blok panjang
    var lenBlock = [0,0,0,0,0,0,0,0];
    var ctBits = ct.length * 8;
    for (var i = 7; i >= 0; i--) lenBlock.push(Math.floor(ctBits / Math.pow(2, 8 * i)) & 0xff);
    // CT harus di-pad ke kelipatan 16 byte DULU sebelum blok panjang ditempel.
    var ctPad = ct.slice();
    while (ctPad.length % 16 !== 0) ctPad.push(0);
    var S = ghash(H, ctPad.concat(lenBlock));
    var EJ0 = aesEncryptBlock(J0, expanded);
    for (var j = 0; j < 16; j++) {
        if ((S[j] ^ EJ0[j]) !== tag[j]) throw new Error("GCM tag mismatch");
    }
    // Dekripsi CTR
    var out = [];
    var ctr = J0;
    for (var off = 0; off < ct.length; off += 16) {
        ctr = inc32(ctr);
        var ks = aesEncryptBlock(ctr, expanded);
        for (var b = 0; b < 16 && off + b < ct.length; b++) out.push(ct[off + b] ^ ks[b]);
    }
    return out;
}

function b64urlToBytes(s) {
    var clean = String(s).replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
    return b64decodeToBytes(clean);
}


// ---------- Alur utama ----------
function tmdbMeta(tmdbId, mediaType) {
    var kind = mediaType === "tv" ? "tv" : "movie";
    var url = TMDB_BASE + "/" + kind + "/" + tmdbId + "?api_key=" + TMDB_API_KEY;
    return fetchJson(url, null, 10000).then(function (d) {
        return {
            title: (kind === "tv" ? d.name : d.title) || "",
            year: String((kind === "tv" ? d.first_air_date : d.release_date) || "").slice(0, 4)
        };
    }).catch(function () { return { title: "", year: "" }; });
}

function subApiSubs(tmdbId, mediaType, seasonNum, episodeNum) {
    var url = SUB_HOST + (mediaType === "tv"
        ? "/api/tv/" + tmdbId + "/" + (seasonNum || 1) + "/" + (episodeNum || 1)
        : "/api/movie/" + tmdbId);
    return fetchJson(url, null, 10000).then(function (list) {
        var out = [];
        (Array.isArray(list) ? list : []).forEach(function (e) {
            if (!e || !e.url) return;
            var name = String(e.language || e.label || "").toLowerCase();
            var lang = "";
            if (name.indexOf("indonesia") >= 0) lang = "id";
            else if (name.indexOf("english") >= 0) lang = "en";
            if (!lang) return;
            if (out.some(function (x) { return x.lang === lang; })) return;
            var u = String(e.url);
            if (u.indexOf("http") !== 0) u = SUB_HOST + (u.charAt(0) === "/" ? "" : "/") + u;
            out.push({ id: "streamex-sub-" + lang, url: u, lang: lang });
        });
        return out;
    }).catch(function () { return []; });
}

function resolveSourceFile(src, embedUrl) {
    var u = String(src.url || "");
    if (!u) return Promise.resolve(null);
    if (u.indexOf("http") !== 0) u = XPASS + (u.charAt(0) === "/" ? "" : "/") + u;
    return fetchJson(u, { "Referer": embedUrl }, 10000).then(function (j) {
        var item = null;
        if (j && Array.isArray(j.playlist) && j.playlist.length) item = j.playlist[0];
        else if (Array.isArray(j) && j.length) item = j[0];
        else item = j;
        var srcs = (item && item.sources) || [];
        for (var i = 0; i < srcs.length; i++) {
            if (srcs[i] && srcs[i].file && String(srcs[i].file).indexOf("http") === 0) return srcs[i].file;
        }
        return null;
    }).catch(function () { return null; });
}

function expandMaster(masterUrl, srcName, label, subs) {
    return fetchText(masterUrl, { "Referer": XPASS + "/" }, 10000).then(function (txt) {
        var lines = String(txt).split("\n");
        var streams = [];
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (line.indexOf("#EXT-X-STREAM-INF") !== 0) continue;
            var rm = line.match(/RESOLUTION=\d+x(\d+)/);
            var next = (lines[i + 1] || "").trim();
            if (!next || next.charAt(0) === "#") continue;
            var vu = next;
            if (vu.indexOf("http") !== 0) {
                var baseUrl = masterUrl.slice(0, masterUrl.lastIndexOf("/") + 1);
                vu = baseUrl + vu;
            }
            var quality = rm ? rm[1] + "p" : "Auto";
            var st = {
                name: "StreamEx " + srcName + " " + quality,
                title: label,
                url: vu,
                quality: quality,
                size: "Unknown",
                headers: { "User-Agent": UA, "Referer": XPASS + "/" },
                provider: "streamex"
            };
            if (subs.length) st.subtitles = subs.slice();
            streams.push(st);
        }
        if (streams.length) return streams;
        var fallback = {
            name: "StreamEx " + srcName + " Auto",
            title: label,
            url: masterUrl,
            quality: "Auto",
            size: "Unknown",
            headers: { "User-Agent": UA, "Referer": XPASS + "/" },
            provider: "streamex"
        };
        if (subs.length) fallback.subtitles = subs.slice();
        return [fallback];
    }).catch(function () {
        var fallback = {
            name: "StreamEx " + srcName + " Auto",
            title: label,
            url: masterUrl,
            quality: "Auto",
            size: "Unknown",
            headers: { "User-Agent": UA, "Referer": XPASS + "/" },
            provider: "streamex"
        };
        if (subs.length) fallback.subtitles = subs.slice();
        return [fallback];
    });
}

function qualityRank(q) {
    var n = parseInt(q, 10);
    return isFinite(n) ? n : 0;
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    var idNum = parseInt(tmdbId, 10);
    if (!idNum) return Promise.resolve([]);
    var isTv = mediaType === "tv";
    var embedUrl = XPASS + (isTv
        ? "/e/tv/" + idNum + "/" + (seasonNum || 1) + "/" + (episodeNum || 1)
        : "/e/movie/" + idNum);
    return Promise.all([
        tmdbMeta(idNum, mediaType),
        subApiSubs(idNum, mediaType, seasonNum, episodeNum),
        fetchText(embedUrl, { "Referer": "https://www.streamex.hn/" }, 12000)
    ]).then(function (res) {
        var meta = res[0], subs = res[1], html = res[2];
        var label = (meta.title || "StreamEx") + (meta.year ? " (" + meta.year + ")" : "");
        if (isTv) label += " S" + (seasonNum || 1) + "E" + (episodeNum || 1);
        var m = String(html).match(/var dataUrl="([^"]+)"/) || String(html).match(/dataUrl\s*=\s*"([^"]+)"/);
        if (!m) return [];
        var dataUrl = m[1];
        var qIdx = dataUrl.indexOf("?");
        var pathname = qIdx >= 0 ? dataUrl.slice(0, qIdx) : dataUrl;
        var tokenM = dataUrl.match(/[?&]token=([^&"]+)/);
        if (!tokenM) return [];
        var token = decodeURIComponent(tokenM[1]);
        return fetchText(XPASS + dataUrl, { "Referer": embedUrl }, 12000).then(function (blobTxt) {
            var payload = b64urlToBytes(String(blobTxt).trim());
            var key = sha256Bytes(utf8Bytes("spv3-data-response|" + BUILD + "|" + pathname + "|" + token));
            var plain;
            try {
                plain = aesGcmDecrypt(key, payload);
            } catch (e) { return []; }
            var sources;
            try {
                sources = JSON.parse(bytesToUtf8(plain));
            } catch (e) { return []; }
            if (!Array.isArray(sources) || !sources.length) return [];
            var picked = sources.slice(0, 3);
            var chain = Promise.resolve([]);
            picked.forEach(function (src) {
                chain = chain.then(function (acc) {
                    return resolveSourceFile(src, embedUrl).then(function (file) {
                        if (!file) return acc;
                        return expandMaster(file, String(src.name || "Server").trim(), label, subs).then(function (vs) {
                            return acc.concat(vs);
                        });
                    });
                });
            });
            return chain.then(function (streams) {
                var seen = {};
                streams = streams.filter(function (s) {
                    if (seen[s.url]) return false;
                    seen[s.url] = true;
                    return true;
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
