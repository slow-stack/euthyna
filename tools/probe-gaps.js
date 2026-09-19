// Re-verify "gap" claims across ALL categories (no category filter).
// The earlier analysis filtered to category==='security', which silently
// excluded cross-category tools like dsh-blast-radius (git).
const d = require('D:/deepseek harness/dsh-plugins.json');

const PATTERNS = {
  '可通过性/可利用性判定': /exploitab|可利用|false.?positive|误报|triage|分诊|verdict|裁定|判定/i,
  '数据流/污点分析': /data.?flow|数据流|taint|污点|source.?to.?sink/i,
  'git历史/回归分析': /git blame|回归|regression|bisect|历史分析|log -S|重加|re-?added/i,
  '调用图/爆炸半径/波及面': /call.?graph|调用图|blast|波及|影响面|callers?|调用者|impact analy/i,
  '测试覆盖映射': /coverage|覆盖率|untested|未测试|测试缺口|covering test/i,
  '发现归一化/SARIF': /sarif|归一化|normaliz|发现格式|findings? (schema|format)/i,
  '审计编排': /orchestrat|编排|总览|编排层/i,
};

for (const [label, re] of Object.entries(PATTERNS)) {
  const hits = d.plugins.filter((p) => {
    const s = [p.name, p.npm, (p.description && p.description.zh) || '', (p.description && p.description.en) || ''].join(' ');
    return re.test(s);
  });
  console.log(`\n### ${label}  — 全类目 ${hits.length} 命中`);
  hits.sort((a, b) => (b.stars || 0) - (a.stars || 0) || (b.downloads || 0) - (a.downloads || 0));
  for (const p of hits.slice(0, 14)) {
    console.log(`  [${p.category.padEnd(9)}] ${p.name.padEnd(44)} ${String(p.stars || 0).padStart(4)}*  dl=${p.downloads || 0}`);
  }
  if (hits.length === 0) console.log('  （全类目 0 命中）');
}
