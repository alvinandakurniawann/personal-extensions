# IDLIX Stream-Extraction Algorithm — Implementation Spec

Reverse-engineered from open-source CloudStream extensions (Kotlin), for
reimplementation in JavaScript (Nuvio provider). All steps verified against
source code on 2026-11-08.

## Sources

| Piece | Repo / file |
|---|---|
| Full flow (`invokeIdlix`, `createIdlixKey`) | `Makairamei/REPO` → `XSMovies/src/main/kotlin/com/xstream/XSMoviesExtractor.kt` |
| Data classes (`AesData.m`, `ResponseHash`) | `Makairamei/REPO` → `XSMovies/src/main/kotlin/com/xstream/XSMoviesParser.kt` |
| AES handler (`cryptoAESHandler`, `generateKeyAndIv`) | `recloudstream/cloudstream` → `library/src/commonMain/kotlin/com/lagradost/cloudstream3/extractors/helper/AesHelper.kt` |
| Independent confirmation (identical flow + `fixBloat`) | `Mohirufy/HiroStream` → `Idlix/src/main/kotlin/com/Idlix/Idlix.kt` |
| Jeniusplay follow-up extractor | `recloudstream/cloudstream` → `library/src/commonMain/kotlin/com/lagradost/cloudstream3/extractors/Jeniusplay.kt` |

Note: Michat88's Nuvio `idlix.js` provider is a **stub** — it stops before the
decryption step and always returns `[]`. The Kotlin implementations above are
the complete ones.

---

## 1. End-to-end flow

Site: WordPress + DooPlay theme. Current domain family: `tv10.idlixku.com`
(domain rotates; always take the final origin after redirects —
`getBaseUrl(response.url)` in Kotlin — and use it for the AJAX call).

1. Build the title-page URL from the TMDB title slug:
   - Movie: `<base>/movie/<slug>-<year>`
   - Episode: `<base>/episode/<slug>-season-<season>-episode-<episode>`
2. GET the page. From a `<script>` containing `window.idlix`, extract:
   - `window.idlixNonce` → hex string (regex `window\.idlixNonce=['"]([a-f0-9]+)['"]`)
   - `window.idlixTime` → digits (regex `window\.idlixTime=(\d+)`)
3. Collect every player option: `ul#playeroptionsul > li`, reading attributes
   `data-post`, `data-nume`, `data-type` from each `<li>`.
4. For **each** option, POST (form-urlencoded) to
   `<base>/wp-admin/admin-ajax.php` with headers
   `X-Requested-With: XMLHttpRequest`, `Accept: */*`, `Referer: <title page URL>`
   and fields:

   | field | value |
   |---|---|
   | `action` | `doo_player_ajax` |
   | `post` | data-post |
   | `nume` | data-nume |
   | `type` | data-type |
   | `_n` | idlixNonce |
   | `_p` | data-post (same as `post`) |
   | `_t` | idlixTime |

5. Response JSON (`ResponseHash`):

   ```json
   { "embed_url": "<stringified JSON, see §2>", "key": "<string, see §3>" }
   ```

6. `password = createIdlixKey(key, m)` where `m` comes from inside `embed_url`.
7. `decrypted = cryptoAESHandler(embed_url, password, encrypt=false)`
   → the real embed URL (after cleanup, §5).
8. Resolve that embed URL with the matching host extractor (§6).

---

## 2. The encrypted payload format (`embed_url`)

`embed_url` is a JSON string (CryptoJS-style) with these fields:

```json
{ "ct": "<base64 ciphertext>", "iv": "<hex>", "s": "<hex salt>", "m": "<metrix string>" }
```

- `ct` — ciphertext, **standard base64**.
- `iv` — hex string. ⚠️ Only its **length** is used (`ivLength = iv.length / 2`,
  normally 16). Its bytes are *not* used as the IV — see §4.
- `s` — salt, **hex** string (normally 8 bytes = 16 hex chars).
- `m` — the "metrix": an obfuscated index list used to build the password (§3).
  (The provider-side parser only declares `m`; the AES helper's own parser only
  declares `ct`/`iv`/`s`. Both parse the same JSON, each ignoring the rest.)

---

## 3. `createIdlixKey(r, m)` — password derivation (exact)

Inputs: `r` = the `key` field of the AJAX response; `m` = the `m` field of
`embed_url`.

`r` is a string of hex byte pairs separated by the **literal two characters**
`\x` (backslash + x), e.g. `"\x61\x62\x63..."`. `m` is the **character-reversed
base64** of a pipe-separated list of decimal indices.

Steps (Kotlin original, `XSMoviesExtractor.kt`):

```kotlin
private fun createIdlixKey(r: String, m: String): String {
    val rList = r.split("\\x").filter { it.isNotEmpty() }      // hex pairs
    var n = ""
    var reversedM = m.split("").reversed().joinToString("")    // un-reverse m
    while (reversedM.length % 4 != 0) reversedM += "="         // pad base64
    val decodedM = String(base64Decode(reversedM).toCharArray())
    for (s in decodedM.split("|")) {
        val index = Integer.parseInt(s)                        // skip on error
        if (index in rList.indices) n += "\\x" + rList[index]
    }
    return n
}
```

In plain steps:

1. `rList` = `r.split("\x")` (literal backslash-x), empty strings removed.
   Each element is one hex byte pair, e.g. `"a3"`.
2. Reverse `m` character-by-character → a base64 string. Append `"="` until
   its length is a multiple of 4.
3. Base64-decode (standard alphabet) → text `decodedM`, of the form
   `"3|0|12|5|..."` (decimal indices separated by `|`). If decoding throws,
   return `""` (decryption will then fail downstream).
4. For each token: parse as integer `index`; if `0 <= index < rList.length`,
   append the **literal characters** `\x` followed by `rList[index]` to `n`.
   Non-numeric tokens and out-of-range indices are silently skipped.
5. Return `n`.

⚠️ The returned password is the **ASCII escape text itself**
(e.g. the 8 characters `\x62\x61`), *not* the raw bytes it describes.
The AES layer receives `password.toByteArray()` = the UTF-8 bytes of that
ASCII string. Do not hex-decode it.

Worked micro-example (illustrative): `r = "\x61\x62"` → `rList = ["61","62"]`.
Let `decodedM = "1|0"` (so `m = reverse(base64("1|0")) = reverse("MXww") = "wwXM"`).
Indices 1,0 → `n = "\x62" + "\x61" = "\x62\x61"` (8 ASCII chars) → password
bytes are those 8 ASCII bytes.

---

## 4. `cryptoAESHandler` — AES decryption (exact)

From `AesHelper.kt` (CloudStream core). This is the classic **OpenSSL
`EVP_BytesToKey`** KDF (MD5, 1 iteration) + **AES-256-CBC** with PKCS#7
padding — the same scheme CryptoJS uses for password-based encryption.

```
parse embed_url JSON -> { ct, iv, s }
salt     = hexDecode(s)                       // saltLength = s.length / 2 bytes
ivLength = iv.length / 2                      // normally 16; iv bytes unused
(key, ivBytes) = EVP_BytesToKey(passwordBytes, salt, keyLen=32, ivLen=ivLength)
plaintext = AES-256-CBC-Decrypt(base64Decode(ct), key, ivBytes, PKCS7)
result    = UTF-8 string of plaintext          // the embed URL
```

`generateKeyAndIv` (EVP_BytesToKey, MD5, iterations = 1):

```
D = ""                       // running digest chain
generated = ""
while generated.length < keyLength + ivLength:        // 32 + 16 = 48 bytes
    D = MD5( D || password || salt )                  // D empty on first round
    generated += D                                    // +16 bytes per round
key = generated[0..32]
iv  = generated[32..48]
```

(The Kotlin code's inner `for (i in 1 until iterations)` loop never runs
because `iterations = 1` at the only call site.)

JS implementation note: the Nuvio sandbox has no Node `crypto`, so MD5 and
AES-CBC must be pure-JS (compact implementations are fine — payloads are
tiny). EVP_BytesToKey above is ~15 lines once MD5 exists.

---

## 5. Cleanup of the decrypted string

The decrypted text is the embed URL, sometimes wrapped in stray quotes /
backslashes and sometimes protocol-relative. HiroStream's variant defines it
explicitly:

```kotlin
private fun String.fixBloat(): String {
    return this.replace("\"", "").replace("\\", "")
}
```

i.e. delete **all** `"` and `\` characters. Then, in XSMovies' version:

```kotlin
val finalUrl = if (decrypted.startsWith("//")) "https:$decrypted" else decrypted
```

(applied on the jeniusplay branch; do the same generally).

---

## 6. After decryption — where the embed URL points

Branching in `invokeIdlix`:

1. **Contains `jeniusplay`** → Jeniusplay extractor (Indonesian host
   `jeniusplay.com`, IDLIX's own/first-party player):
   - The embed URL's last path segment, after `data=`, is the `hash`.
   - POST `<jeniusplay>/player/index.php?data=<hash>&do=getVideo` with form
     fields `hash=<hash>`, `r=<referer>`, header `X-Requested-With:
     XMLHttpRequest`, referer = the embed URL.
   - JSON response field `videoSource` = the final **m3u8** URL.
   - (The embed page may additionally contain a packed JW Player script with
     backup links/subtitles.)
2. **Contains `youtube`** → skipped (trailers).
3. **Anything else** → handed to CloudStream's generic `loadExtractor`, i.e.
   whichever registered extractor matches the host — in practice the usual
   file-host family seen across DooPlay sites (VidHide/FileLions, StreamWish,
   DoodStream, MixDrop, Voe, etc.). The host varies per title/server option;
   there is no fixed host list in the code.

Each `playeroptionsul` entry is one server option, so one title typically
yields a mix of the above.

---

## 7. Server names in `playeroptionsul`

Neither Kotlin implementation reads a human-readable server name: the `<li>`
elements are consumed purely via `data-post` / `data-nume` / `data-type`,
where `nume` is just DooPlay's numeric server index (1, 2, 3, …). Any visible
server label in the page HTML (DooPlay renders a title/span per option) is
ignored by the extractors. For a Nuvio provider, label streams by the
**resolved host after decryption** (e.g. "IDLIX - Jeniusplay") rather than by
`nume`.

---

## 8. Minimal JS reimplementation checklist

1. GET title page → regex nonce/time, regex the `<li>` options (no DOM lib
   needed; attributes are regular).
2. POST `admin-ajax.php` per option (form-urlencoded body exactly as §1.4).
3. `JSON.parse(embed_url)` → `{ct, iv, s, m}`.
4. `password = createIdlixKey(key, m)` per §3 — pure string ops + base64.
5. Pure-JS MD5 → EVP_BytesToKey (§4) → pure-JS AES-256-CBC decrypt of
   `base64Decode(ct)` → UTF-8 URL.
6. Strip `"` and `\`; prefix `https:` if it starts with `//`.
7. If host is jeniusplay → the `getVideo` POST in §6.1 returns the m3u8
   directly. Other hosts need their own resolver (FileLions-family unpack
   resolver already built for DramaAsia covers the morencius-style pages).
