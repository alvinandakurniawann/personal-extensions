// Nunadrama provider for Nuvio (personal use)
// Drama Korea/China/Jepang subtitle Indonesia (WordPress MuviPro).
// Alur: gateway nunadrama.space -> host aktif (s*.nunadrama.*) ->
// halaman judul/episode -> iframe tiap server (?player=N) -> resolver:
//  - host p2p (upns/strp2p): GET /api/public/resolve?file1=<hash> -> URL player
//  - abyssplayer & host lain: scan halaman embed (m3u8 plaintext / datas b64 /
//    skrip ter-packer var links) — media Abyss yang terenkripsi penuh tidak
//    bisa dibuka tanpa menjalankan JS mereka (batasan jujur).
// Subtitle: hardsub Indonesia.

const GATEWAY = "https://nunadrama.space";
const FALLBACK_HOSTS = ["https://s1.nunadrama.sbs"];
const TMDB_API_KEY = "b030404650f279792a8d3287232358e3";
const UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

function withTimeout(promise, ms) {
    return Promise.race([promise, new Promise(function (_, rej) { setTimeout(function () { rej(new Error("timeout")); }, ms || 20000); })]);
}
function fetchText(url, referer) {
    return withTimeout(fetch(url, { headers: { "User-Agent": UA, "Referer": referer || GATEWAY + "/" } }).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text();
    }));
}
function slugify(t) { return String(t || "").toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-"); }

const B64C = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function b64ToString(input) {
    var str = String(input).replace(/=+$/, "");
    var out = "", bits = 0, val = 0;
    for (var i = 0; i < str.length; i++) {
        var idx = B64C.indexOf(str.charAt(i));
        if (idx < 0) continue;
        val = (val << 6) | idx; bits += 6;
        if (bits >= 8) { bits -= 8; out += String.fromCharCode((val >> bits) & 0xff); }
    }
    try { return decodeURIComponent(escape(out)); } catch (e) { return out; }
}

function unpackPacked(html) {
    var m = html.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\}\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)/);
    if (!m) return null;
    var payload = m[1], radix = parseInt(m[2], 10), count = parseInt(m[3], 10);
    var words = m[4].split("|");
    var digits = "0123456789abcdefghijklmnopqrstuvwxyz";
    function base(n) { if (n < radix) return n < 36 ? digits.charAt(n) : String.fromCharCode(n + 29); return base(Math.floor(n / radix)) + base(n % radix); }
    var sym = {};
    for (var i = 0; i < count; i++) { var tok = base(i); sym[tok] = (i < words.length && words[i]) ? words[i] : tok; }
    return payload.replace(/\b[0-9a-zA-Z]+\b/g, function (w) { return sym[w] || w; });
}

// Scan generik satu halaman embed -> m3u8 atau null
function scanEmbedHtml(html) {
    var m = html.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
    if (m) return m[1];
    var datas = html.match(/const\s+datas\s*=\s*["']([A-Za-z0-9+/=]{40,})["']/);
    if (datas) {
        var dec = b64ToString(datas[1]);
        var m2 = dec.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/);
        if (m2) return m2[0];
    }
    var un = unpackPacked(html);
    if (un) {
        var lm = un.match(/var links=\{([^}]+)\}/);
        if (lm) {
            var h2 = lm[1].match(/"hls2":"([^"]+)"/);
            if (h2) return h2[1];
        }
        var m3 = un.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/);
        if (m3) return m3[0];
    }
    var f = html.match(/["']file["']\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i);
    if (f) return f[1];
    return null;
}

function resolveGenericEmbed(embedUrl, referer) {
    return fetchText(embedUrl, referer).then(function (html) { return scanEmbedHtml(html); }).catch(function () { return null; });
}

// Resolver host p2p: /api/public/resolve?file1=<hash> -> {url} -> halaman player tujuan
function resolveP2p(embedUrl, referer) {
    var hash = (embedUrl.split("#")[1] || "").trim();
    if (!hash) return Promise.resolve(null);
    var origin = embedUrl.match(/^https?:\/\/[^/]+/)[0];
    return withTimeout(fetch(origin + "/api/public/resolve?file1=" + encodeURIComponent(hash), {
        headers: { "User-Agent": UA, "Referer": origin + "/" }
    }).then(function (r) { return r.json(); })).then(function (j) {
        if (!j || !j.url) return null;
        if (j.url.indexOf(".m3u8") !== -1) return j.url;
        return resolveGenericEmbed(j.url, embedUrl);
    }).catch(function () { return null; });
}

function hostLabel(url) {
    var h = (url.match(/^https?:\/\/([^/]+)/) || [])[1] || "Server";
    if (h.indexOf("abyssplayer") !== -1) return "Abyss";
    if (h.indexOf("emturbovid") !== -1) return "TurboVid";
    if (h.indexOf("upns") !== -1 || h.indexOf("strp2p") !== -1) return "P2P";
    return h.split(".")[0];
}

function resolveEmbed(embedUrl, referer) {
    if (embedUrl.indexOf("#") !== -1 && /upns|strp2p/.test(embedUrl)) return resolveP2p(embedUrl, referer);
    return resolveGenericEmbed(embedUrl, referer);
}

function discoverBase() {
    return fetchText(GATEWAY + "/").then(function (html) {
        var m = html.match(/https?:\/\/s\d+\.nunadrama\.[a-z]+/);
        return m ? m[0] : FALLBACK_HOSTS[0];
    }).catch(function () { return FALLBACK_HOSTS[0]; });
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    var kind = mediaType === "movie" ? "movie" : "tv";
    return withTimeout(fetch("https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "?api_key=" + TMDB_API_KEY, { headers: { "User-Agent": UA } }).then(function (r) { return r.json(); }))
        .then(function (tm) {
            var title = tm.title || tm.name || "";
            var original = tm.original_title || tm.original_name || "";
            var year = (tm.release_date || tm.first_air_date || "").substring(0, 4);
            if (!title) return [];
            var slugs = [];
            [title, original].forEach(function (t) { var s = slugify(t); if (s && slugs.indexOf(s) === -1) slugs.push(s); });
            var label = title + (kind === "tv" ? " S" + (seasonNum || 1) + "E" + (episodeNum || 1) : (year ? " (" + year + ")" : ""));

            return discoverBase().then(function (base) {
                function watchPaths(slug) {
                    if (kind === "movie") {
                        var arr = [];
                        if (year) arr.push("/" + slug + "-" + year + "/");
                        arr.push("/" + slug + "/");
                        return arr;
                    }
                    var s = seasonNum || 1, e = episodeNum || 1, out = [];
                    if (s > 1) out.push("/eps/" + slug + "-season-" + s + "-episode-" + e + "/");
                    out.push("/eps/" + slug + "-episode-" + e + "/");
                    return out;
                }

                function tryWatch(url) {
                    // Ambil iframe dari varian player default + ?player=2..4 (paralel)
                    var variants = [url, url + "?player=2", url + "?player=3", url + "?player=4"];
                    return Promise.all(variants.map(function (v) {
                        return fetchText(v, base + "/").then(function (html) {
                            var ifr = html.match(/<iframe[^>]*src="(https?:\/\/[^"]+)"/);
                            return ifr ? ifr[1] : null;
                        }).catch(function () { return null; });
                    })).then(function (found) {
                        var embeds = [];
                        found.forEach(function (u) { if (u && embeds.indexOf(u) === -1) embeds.push(u); });
                        return embeds;
                    }).then(function (embeds) {
                        if (!embeds.length) return null;
                        var jobs = embeds.slice(0, 4).map(function (eu) {
                            return resolveEmbed(eu, url).then(function (m3u8) {
                                return m3u8 ? {
                                    name: "Nunadrama - " + hostLabel(eu),
                                    title: label,
                                    url: m3u8,
                                    quality: "Unknown",
                                    size: "Unknown",
                                    headers: { "User-Agent": UA, "Referer": eu },
                                    provider: "nunadrama"
                                } : null;
                            });
                        });
                        return Promise.all(jobs).then(function (rs) { return rs.filter(function (x) { return !!x; }); });
                    });
                }

                var all = Promise.resolve(null);
                slugs.forEach(function (slug) {
                    watchPaths(slug).forEach(function (p) {
                        all = all.then(function (found) {
                            if (found && found.length) return found;
                            return tryWatch(base + p);
                        });
                    });
                });
                return all.then(function (found) { return found || []; });
            });
        })
        .then(function (streams) { return attachFirkaizen(streams, tmdbId, mediaType, seasonNum, episodeNum); })
        .catch(function (err) { console.error("[Nunadrama] Error:", err && err.message); return []; });
}

if (typeof module !== "undefined" && 
module.exports) { module.exports = { getStreams: getStreams }; }
else { global.NunadramaScraperModule = { getStreams: getStreams }; }

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

