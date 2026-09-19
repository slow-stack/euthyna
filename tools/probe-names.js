// Probe which candidate plugin names are already taken in the DSH ecosystem.
const d = require(require('path').join(__dirname, '..', 'data', 'dsh-plugins.json'));
const probes = ['audit', 'verdict', 'conductor', 'gate', 'proof', 'finding', 'engine',
  'blast', 'impact', 'trace', 'ledger', 'witness', 'adjudicate', 'tribunal',
  'jury', 'sentinel', 'gavel', 'seal', 'attest', 'orchestrat', 'verif', 'corrobor'];

for (const w of probes) {
  const hits = d.plugins.filter((p) => p.name.toLowerCase().includes(w));
  console.log(`\n== "${w}"  (${hits.length})`);
  hits.sort((a, b) => (b.stars || 0) - (a.stars || 0));
  for (const p of hits.slice(0, 8)) {
    console.log(`   ${p.name.padEnd(48)} [${p.category}] ${p.stars || 0}*`);
  }
}
