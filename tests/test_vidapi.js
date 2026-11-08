(async () => {
  const v = require(process.env.HOME + '/workspace/your_files/personal-extensions/providers/vidapi.js');
  console.time('vidapi-qot');
  const s = await v.getStreams(215720, 'tv', 1, 1);
  console.timeEnd('vidapi-qot');
  console.log('QoT streams:', s.length);
  s.forEach(x => console.log(' -', x.name, '| subs:', ((x.subtitles||[]).map(y=>y.lang).join('+') || 'none')));
  console.time('vidapi-f1');
  const s2 = await v.getStreams(911430, 'movie');
  console.timeEnd('vidapi-f1');
  console.log('F1 streams:', s2.length);
  s2.forEach(x => console.log(' -', x.name, '| subs:', ((x.subtitles||[]).map(y=>y.lang).join('+') || 'none')));
})();
