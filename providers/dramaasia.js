// DramaAsia provider for Nuvio (personal use)
// Drama Korea/China/dll subtitle Indonesia dari situs sumber berbasis
// WordPress (v2.oppadrama.cc). Cara kerja:
// TMDB id -> judul (TMDB) -> tebak slug halaman series/film di situs sumber
// -> buka halaman episode/film -> ambil daftar server (dropdown mirror,
// base64) -> resolve server Vidara via API-nya -> m3u8.
// Server lain (Origin, FileLions) belum didukung di versi ini.
// Subtitle umumnya hardsub (menyatu di video).

const BASE_URL = "https://v2.oppadrama.cc";
const VIDARA_BASE = "https://vidara.to";
const TMDB_API_KEY = "b030404650f279792a8d3287232358e3"; // public read-only key, sama seperti provider komunitas lain

const UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const SITE_HEADERS = { "User-Agent": UA, "Referer": BASE_URL + "/" };

function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise(function (_, reject) { setTimeout(function () { reject(new Error("timeout")); }, ms || 15000); })
    ]);
}

function fetchText(url, headers) {
    return withTimeout(fetch(url, { headers: headers || SITE_HEADERS }).then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.text();
    }), 20000);
}

function fetchJson(url, opts) {
    return withTimeout(fetch(url, opts || { headers: SITE_HEADERS }).then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
    }), 20000);
}

function slugify(title) {
    return String(title || "").toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-");
}

// Base64 decode tanpa atob/Buffer (aman di sandbox)
function b64decode(input) {
    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var str = String(input).replace(/=+$/, "");
    var out = "";
    var bits = 0, val = 0;
    for (var i = 0; i < str.length; i++) {
        var idx = chars.indexOf(str.charAt(i));
        if (idx < 0) continue;
        val = (val << 6) | idx;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out += String.fromCharCode((val >> bits) & 0xff);
        }
    }
    try { return decodeURIComponent(escape(out)); } catch (e) { return out; }
}

// Ambil semua embed server dari halaman tonton: iframe default + dropdown mirror
function extractEmbeds(html) {
    var out = [];
    var seen = {};
    function add(url, label) {
        if (!url || seen[url]) return;
        seen[url] = true;
        out.push({ url: url, label: label || "" });
    }
    var holder = html.match(/<div id="embed_holder"[\s\S]*?<iframe[^>]*src="([^"]+)"/);
    if (holder) add(holder[1], "Server 1");
    var select = html.match(/<select class="mirror"[\s\S]*?<\/select>/);
    if (select) {
        var optRe = /<option value="([A-Za-z0-9+/=]{40,})"[^>]*>([\s\S]*?)<\/option>/g;
        var m;
        while ((m = optRe.exec(select[0])) !== null) {
            var decoded = b64decode(m[1]);
            var src = decoded.match(/src="([^"]+)"/);
            var label = m[2].replace(/<[^>]+>/g, "").trim();
            if (src) add(src[1], label);
        }
    }
    return out;
}

function isWatchPage(html) {
    return html.indexOf('class="mirror"') !== -1 || html.indexOf('embed_holder') !== -1;
}

// Resolve embed Vidara -> m3u8
function resolveVidara(embedUrl) {
    var m = embedUrl.match(/vidara\.to\/e\/([A-Za-z0-9]+)/);
    if (!m) return Promise.resolve(null);
    var filecode = m[1];
    return fetchJson(VIDARA_BASE + "/api/stream", {
        method: "POST",
        headers: {
            "User-Agent": UA,
            "Content-Type": "application/json",
            "Referer": embedUrl
        },
        body: JSON.stringify({ filecode: filecode, device: "mobile", codecs: [] })
    }).then(function (json) {
        if (!json || !json.streaming_url) return null;
        return { url: json.streaming_url, subtitles: json.subtitles || null };
    }).catch(function () { return null; });
}

// Unpack skrip ter-packer (Dean Edwards) -> teks JS asli
function unpackPacked(html) {
    var m = html.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\}\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)/);
    if (!m) return null;
    var payload = m[1], radix = parseInt(m[2], 10), count = parseInt(m[3], 10);
    var words = m[4].split("|");
    var digits = "0123456789abcdefghijklmnopqrstuvwxyz";
    function base(n) {
        if (n < radix) return n < 36 ? digits.charAt(n) : String.fromCharCode(n + 29);
        return base(Math.floor(n / radix)) + base(n % radix);
    }
    var sym = {};
    for (var i = 0; i < count; i++) {
        var tok = base(i);
        sym[tok] = (i < words.length && words[i]) ? words[i] : tok;
    }
    return payload.replace(/\b[0-9a-zA-Z]+\b/g, function (w) { return sym[w] || w; });
}

// Resolve embed keluarga FileLions/VidHide (morencius dll): unpack -> var links
function resolveFilelions(embedUrl) {
    return fetchText(embedUrl, { "User-Agent": UA, "Referer": BASE_URL + "/" }).then(function (html) {
        var un = unpackPacked(html);
        if (!un) return null;
        var lm = un.match(/var links=\{([^}]+)\}/);
        if (!lm) return null;
        var hls2 = lm[1].match(/"hls2":"([^"]+)"/);
        if (hls2) return { url: hls2[1] };
        var hls4 = lm[1].match(/"hls4":"([^"]+)"/);
        if (hls4) {
            var origin = embedUrl.match(/^https?:\/\/[^/]+/)[0];
            return { url: hls4[1].charAt(0) === "/" ? origin + hls4[1] : hls4[1] };
        }
        return null;
    }).catch(function () { return null; });
}

function qualityFromPlaylist(url) {
    return fetchText(url, { "User-Agent": UA, "Referer": VIDARA_BASE + "/" }).then(function (txt) {
        var max = 0;
        var re = /RESOLUTION=\d+x(\d+)/g, mm;
        while ((mm = re.exec(txt)) !== null) { var h = parseInt(mm[1], 10); if (h > max) max = h; }
        return max ? max + "p" : "Unknown";
    }).catch(function () { return "Unknown"; });
}

function findEpisodeUrl(html, baseSlug, seasonNum, episodeNum) {
    // Kumpulkan link episode dari halaman hub series
    var links = [];
    var re = new RegExp('href="(https://v2\\.oppadrama\\.cc/' + baseSlug + '[^"]*)"', "g");
    var m;
    while ((m = re.exec(html)) !== null) links.push(m[1]);
    var want;
    if (seasonNum === 0) {
        want = new RegExp("-special-episode-" + episodeNum + "(/|-|$)");
    } else {
        want = new RegExp("-episode-" + episodeNum + "(/|-|$)");
    }
    var exact = links.filter(function (u) { return want.test(u) && u.indexOf("-special-") === (seasonNum === 0 ? 0 : -1) || (seasonNum !== 0 && want.test(u) && u.indexOf("-special-") === -1); });
    if (exact.length) return exact[0];
    var any = links.filter(function (u) { return want.test(u); });
    return any.length ? any[0] : null;
}

function tryWatchPage(url) {
    return fetchText(url).then(function (html) {
        return isWatchPage(html) ? html : null;
    }).catch(function () { return null; });
}

function resolveFromWatchHtml(html, titleLabel) {
    var embeds = extractEmbeds(html);
    var vidara = embeds.filter(function (e) { return e.url.indexOf("vidara.to") !== -1; });
    var lions = embeds.filter(function (e) { return e.url.indexOf("vidara.to") === -1 && /\/v\/[A-Za-z0-9]+/.test(e.url); });
    var jobs = [];
    if (vidara.length) {
        jobs.push(resolveVidara(vidara[0].url).then(function (r) {
            if (!r) return null;
            return qualityFromPlaylist(r.url).then(function (q) {
                return {
                    name: "DramaAsia - Vidara " + q,
                    title: titleLabel,
                    url: r.url,
                    quality: q,
                    size: "Unknown",
                    headers: { "User-Agent": UA, "Referer": VIDARA_BASE + "/" },
                    provider: "dramaasia"
                };
            });
        }).catch(function () { return null; }));
    }
    if (lions.length) {
        jobs.push(resolveFilelions(lions[0].url).then(function (r) {
            if (!r) return null;
            return {
                name: "DramaAsia - FileLions",
                title: titleLabel,
                url: r.url,
                quality: "Unknown",
                size: "Unknown",
                headers: { "User-Agent": UA, "Referer": lions[0].url },
                provider: "dramaasia"
            };
        }).catch(function () { return null; }));
    }
    return Promise.all(jobs).then(function (results) {
        return results.filter(function (s) { return !!s; });
    });
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    var kind = mediaType === "movie" ? "movie" : "tv";
    var tmdbUrl = "https://api.themoviedb.org/3/" + kind + "/" + tmdbId + "?api_key=" + TMDB_API_KEY;

    return fetchJson(tmdbUrl, { headers: { "User-Agent": UA } })
        .then(function (tm) {
            var title = tm.title || tm.name || "";
            var original = tm.original_title || tm.original_name || "";
            var year = (tm.release_date || tm.first_air_date || "").substring(0, 4);
            if (!title) return [];
            var slugs = [];
            [title, original].forEach(function (t) {
                var s = slugify(t);
                if (s && slugs.indexOf(s) === -1) slugs.push(s);
            });
            var label = title + (kind === "tv" ? " S" + (seasonNum || 1) + "E" + (episodeNum || 1) : (year ? " (" + year + ")" : ""));

            function attemptMovie(slug) {
                var candidates = [];
                if (year) candidates.push(BASE_URL + "/movie-" + slug + "-" + year + "-webdl/");
                if (year) candidates.push(BASE_URL + "/" + slug + "-" + year + "/");
                candidates.push(BASE_URL + "/" + slug + "/");
                var chain = Promise.resolve(null);
                candidates.forEach(function (u) {
                    chain = chain.then(function (html) { return html || tryWatchPage(u); });
                });
                return chain.then(function (html) {
                    return html ? resolveFromWatchHtml(html, label) : [];
                });
            }

            function attemptTv(slug) {
                var s = seasonNum || 1;
                var e = episodeNum || 1;
                var direct = [];
                if (s === 0) direct.push(BASE_URL + "/" + slug + "-special-episode-" + e + "/");
                else if (s > 1) direct.push(BASE_URL + "/" + slug + "-season-" + s + "-episode-" + e + "/");
                direct.push(BASE_URL + "/" + slug + "-episode-" + e + "/");
                var chain = Promise.resolve(null);
                direct.forEach(function (u) {
                    chain = chain.then(function (html) { return html || tryWatchPage(u); });
                });
                return chain.then(function (html) {
                    if (html) return resolveFromWatchHtml(html, label);
                    // Lewat halaman hub series
                    var hubs = [BASE_URL + "/" + slug + "/"];
                    if (s > 1) hubs.unshift(BASE_URL + "/" + slug + "-season-" + s + "/");
                    var hchain = Promise.resolve(null);
                    hubs.forEach(function (u) {
                        hchain = hchain.then(function (found) {
                            if (found) return found;
                            return fetchText(u).then(function (hubHtml) {
                                var epUrl = findEpisodeUrl(hubHtml, slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), s, e);
                                return epUrl ? tryWatchPage(epUrl) : null;
                            }).catch(function () { return null; });
                        });
                    });
                    return hchain.then(function (epHtml) {
                        return epHtml ? resolveFromWatchHtml(epHtml, label) : [];
                    });
                });
            }

            var all = Promise.resolve([]);
            slugs.forEach(function (slug) {
                all = all.then(function (streams) {
                    if (streams.length) return streams;
                    return kind === "movie" ? attemptMovie(slug) : attemptTv(slug);
                });
            });
            return all;
        })
        .then(function (streams) { return attachFirkaizen(streams, tmdbId, mediaType, seasonNum, episodeNum); })
        .catch(function (err) {
            console.error("[DramaAsia] Error:", err && err.message);
            return [];
        });
}

if (typeof module !== "undefined" && 
module.exports) {
    module.exports = { getStreams: getStreams };
} else {
    global.DramaAsiaScraperModule = { getStreams: getStreams };
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

