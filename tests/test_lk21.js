(async () => {
  const lk = require(process.env.HOME + '/workspace/your_files/personal-extensions/providers/lk21.js');
  console.time('lk21-f1');
  const s = await lk.getStreams(911430, 'movie');
  console.timeEnd('lk21-f1');
  console.log('F1 streams:', s.length);
  s.forEach(x => console.log(' -', x.name, '|', x.quality, '| subs:', ((x.subtitles||[]).map(y=>y.lang).join('+') || 'none'), '|', x.url.slice(0, 80)));
  const s2 = await lk.getStreams(215720, 'tv', 1, 1);
  console.log('TV request (harus 0):', s2.length);
})();
