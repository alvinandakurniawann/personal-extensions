(async () => {
  const v = require(process.env.HOME + '/workspace/your_files/personal-extensions/providers/castle.js');
  console.time('castle-qot');
  const s = await v.getStreams(215720, 'tv', 1, 1);
  console.timeEnd('castle-qot');
  console.log('QoT streams:', s.length);
  s.forEach(x => console.log(' -', x.name, '| size:', x.size, '| url:', String(x.url).slice(0,70), '| subs:', ((x.subtitles||[]).map(y=>y.lang).join('+') || 'none')));
  console.time('castle-f1');
  const s2 = await v.getStreams(911430, 'movie');
  console.timeEnd('castle-f1');
  console.log('F1 streams:', s2.length);
  s2.forEach(x => console.log(' -', x.name, '| size:', x.size, '| title:', x.title, '| url:', String(x.url).slice(0,70), '| subs:', ((x.subtitles||[]).map(y=>y.lang).join('+') || 'none')));
})();
