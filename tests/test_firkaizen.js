(async () => {
  const da = require(process.env.HOME + '/workspace/your_files/personal-extensions/providers/dramaasia.js');
  const s2 = await da.getStreams(215720, 'tv', 1, 1);
  console.log('DramaAsia QoT E1:', s2.length, 'streams');
  s2.forEach(x => console.log(' -', x.name, '| subs:', ((x.subtitles||[]).map(y=>y.lang).join('+') || 'none')));
  const reb = require(process.env.HOME + '/workspace/your_files/personal-extensions/providers/rebahin.js');
  const s = await reb.getStreams(1423191, 'movie');
  console.log('Rebahin RE:', s.length, 'stream; subs:', ((s[0]||{}).subtitles || []).map(y=>y.lang).join('+') || 'none');
})();
