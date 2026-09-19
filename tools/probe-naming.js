// Analyze plugin naming conventions in the DSH catalog.
const d = require('D:/deepseek harness/dsh-plugins.json');
const all = d.plugins;

const isDshPrefix = (n) => /^dsh[-_]/i.test(n) || /^@[^/]+\/dsh[-_]/i.test(n);
const prefixed = all.filter((p) => isDshPrefix(p.name));
const rest = all.filter((p) => !isDshPrefix(p.name));

console.log(`total=${all.length}`);
console.log(`dsh-prefixed = ${prefixed.length}  (${(prefixed.length / all.length * 100).toFixed(1)}%)`);
console.log(`other        = ${rest.length}  (${(rest.length / all.length * 100).toFixed(1)}%)`);

console.log('\n=== 非 dsh- 前缀且 stars>=5 的（按星排序，前 40）===');
rest.filter((p) => (p.stars || 0) >= 5)
  .sort((a, b) => (b.stars || 0) - (a.stars || 0))
  .slice(0, 40)
  .forEach((p) => console.log(`  ${String(p.stars || 0).padStart(6)}*  [${p.category.padEnd(9)}] ${p.name}`));

console.log('\n=== 名字里含 codex / claude / harness 的 ===');
all.filter((p) => /codex|claude|harness/i.test(p.name))
  .sort((a, b) => (b.stars || 0) - (a.stars || 0))
  .slice(0, 20)
  .forEach((p) => console.log(`  ${String(p.stars || 0).padStart(6)}*  [${p.category.padEnd(9)}] ${p.name}`));

console.log('\n=== 带 # 的（疑似多目标适配/子包）===');
all.filter((p) => p.name.includes('#'))
  .slice(0, 25)
  .forEach((p) => console.log(`  [${p.category.padEnd(9)}] ${p.name}  ->  ${p.url}`));
