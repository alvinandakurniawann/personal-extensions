(async () => {
  const k = require(process.env.HOME + '/workspace/your_files/personal-extensions/providers/kisskh.js');
  console.time('kisskh-qot');
  const s = await k.getStreams(215720, 'tv', 1, 1);
  console.timeEnd('kisskh-qot');
  console.log('QoT E1 streams:', s.length);
  s.forEach(x => console.log(' -', x.name, '| subs:', ((x.subtitles||[]).map(y=>y.lang).join('+') || 'none'), '|', x.url.slice(0, 70)));
})();
