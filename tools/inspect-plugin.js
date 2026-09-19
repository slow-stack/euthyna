// Inspect specific plugins of interest in detail.
const d = require(require('path').join(__dirname, '..', 'data', 'dsh-plugins.json'));
const want = process.argv.slice(2);
for (const w of want) {
  const p = d.plugins.find((x) => x.name.toLowerCase() === w.toLowerCase() || x.name.toLowerCase().includes(w.toLowerCase()));
  if (!p) { console.log(`MISSING: ${w}`); continue; }
  console.log(`=== ${p.name}`);
  console.log(`  owner   : ${p.owner}`);
  console.log(`  category: ${p.category}`);
  console.log(`  repo    : ${p.url}`);
  if (p.page) console.log(`  page    : ${p.page}`);
  console.log(`  npm     : ${p.npm || '-'}   version=${p.version || '-'}   stars=${p.stars || 0}   dl=${p.downloads || 0}`);
  console.log(`  added   : ${p.added || '-'}`);
  console.log(`  install : ${p.install || '-'}`);
  console.log(`  zh      : ${(p.description && p.description.zh) || '-'}`);
  console.log(`  en      : ${(p.description && p.description.en) || '-'}`);
  console.log('');
}
