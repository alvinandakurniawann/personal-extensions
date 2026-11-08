(async () => {
  const v = require(process.env.HOME + '/workspace/your_files/personal-extensions/providers/cineby.js');
  console.time('cineby-f1');
  const s2 = await v.getStreams(911430, 'movie');
  console.timeEnd('cineby-f1');
  console.log('F1 streams:', s2.length);
  s2.forEach(x => console.log(' -', x.name, '| url:', String(x.url).slice(0,80), '| subs:', ((x.subtitles||[]).map(y=>y.lang).join('+') || 'none')));
  console.time('cineby-qot');
  const s = await v.getStreams(215720, 'tv', 1, 1);
  console.timeEnd('cineby-qot');
  console.log('QoT streams:', s.length);
  s.forEach(x => console.log(' -', x.name, '| url:', String(x.url).slice(0,80), '| subs:', ((x.subtitles||[]).map(y=>y.lang).join('+') || 'none')));
})();
