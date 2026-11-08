const p = require("../providers/streamex.js");
async function run(label, id, type, s, e) {
  const t = Date.now();
  const streams = await p.getStreams(id, type, s, e);
  console.log(`${label}: ${((Date.now() - t) / 1000).toFixed(1)}s\n${label} streams: ${streams.length}`);
  streams.slice(0, 8).forEach(x => console.log(" -", x.name, "| url:", String(x.url).slice(0, 78), "| subs:", (x.subtitles || []).map(y => y.lang).join("+") || "none"));
}
(async () => {
  await run("streamex-f1", 911430, "movie");
  await run("streamex-qot", 215720, "tv", 1, 1);
})();
