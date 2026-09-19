// Positioning probe for euthyna: does anyone already occupy our claimed niche?
//
// Difference from probe-gaps.js: that one only prints names, so a Chinese
// description containing "判定" looks like a hit even when the plugin is a
// routing suite. This one prints the MATCHING SNIPPET with context, so each
// candidate can be judged instead of guessed. Also reads the in-repo snapshot.
//
// Usage: node tools/probe-audit-space.js [--out data/audit-space.txt]

const path = require('path');
const fs = require('fs');

const SNAPSHOT = path.join(__dirname, '..', 'data', 'dsh-plugins.json');
const d = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));

// Each concept = one claim we might make about the ecosystem.
// `re` runs over name + owner + en + zh; `snippet` controls how much context to show.
const CONCEPTS = [
  {
    key: 'verdict',
    claim: '结论裁定 / 可利用性判定（euthyna 的核心主张）',
    re: /\bexploitab|\bexploitabilit|false[- ]positive|误报|可利用|adjudicat|裁定|\bverdict\b|triage|分诊|真阳性|true[- ]positive/i,
  },
  {
    key: 'taint',
    claim: '数据流 / 污点追踪（判定层依赖的确定性事实之一）',
    re: /data[- ]?flow|数据流|taint|污点|source[- ]to[- ]sink|propagat/i,
  },
  {
    key: 'githist',
    claim: 'git 历史回归分析（git log -S 追溯 + 重加检测）',
    re: /git blame|regression|回归|bisect|重加|re-?added|history analysis|历史分析|历史追溯/i,
  },
  {
    key: 'callgraph',
    claim: '调用图 / 爆炸半径（确定性事实之二）',
    re: /call[- ]?graph|调用图|blast[- ]?radius|爆炸半径|波及|impact analy|调用方|callers?\b|影响面|依赖图/i,
  },
  {
    key: 'coverage',
    claim: '测试覆盖映射（确定性事实之三）',
    re: /coverage|覆盖率|untested|未测试|测试缺口|covering test|测试映射/i,
  },
  {
    key: 'sarif',
    claim: '发现归一化 / SARIF 输出（交付契约）',
    re: /\bsarif\b|归一化|normaliz|\bfindings?\b.*(schema|format|report)|发现格式/i,
  },
  {
    key: 'orchestration',
    claim: '审计编排（多工具/多阶段串成一次审计）',
    re: /orchestrat|编排|审计流程|audit (pipeline|workflow|orchestr)|multi[- ]?(tool|agent).*audit/i,
  },
  {
    key: 'stopgate',
    claim: '交付前门禁 / 不许收工（Stop hook 强制）',
    re: /stop hook|不许收工|门禁|gatekeeper|delivery gate|收工|definition of done|完成定义/i,
  },
  {
    key: 'supplychain',
    claim: '依赖供应链审计（阶段 A）',
    re: /supply[- ]?chain|供应链|dependency audit|依赖审计|\bSBOM\b|lockfile|依赖漏洞|osv|trivy/i,
  },
  {
    key: 'securityskill',
    claim: '安全审计技能包整体（直接竞品）',
    re: /security audit|安全审计|代码审计|code audit|vulnerabilit|漏洞|penetration|渗透|pentest|red ?team|红队/i,
  },
];

const INTERESTING = new Set(['security', 'git', 'skill', 'tools', 'dev', 'workflow', 'agi']);

function haystack(p) {
  return [p.name, p.owner, (p.description && p.description.en) || '', (p.description && p.description.zh) || ''].join(' \u0001 ');
}

function snippet(p, re) {
  const src = [
    ['en', (p.description && p.description.en) || ''],
    ['zh', (p.description && p.description.zh) || ''],
  ];
  for (const [tag, text] of src) {
    const m = text.match(re);
    if (m) {
      const i = Math.max(0, m.index - 60);
      const frag = text.slice(i, i + 220).replace(/\s+/g, ' ');
      return `[${tag}] …${frag}…`;
    }
  }
  return `[name] ${p.name}`;
}

const lines = [];
const log = (s) => lines.push(s);

log(`# euthyna 定位探针 — 全类目（无 category 过滤）`);
log(`快照: ${SNAPSHOT}`);
log(`目录 updated=${d.updated} count=${d.plugins.length}`);
log('');

const summary = [];
for (const c of CONCEPTS) {
  const hits = d.plugins
    .filter((p) => c.re.test(haystack(p)))
    .sort(
      (a, b) =>
        (b.stars || 0) - (a.stars || 0) || (b.downloads || 0) - (a.downloads || 0),
    );

  const byCat = {};
  for (const p of hits) byCat[p.category] = (byCat[p.category] || 0) + 1;
  const catStr = Object.entries(byCat)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}:${v}`)
    .join(' ');

  summary.push({ key: c.key, n: hits.length, catStr, claim: c.claim });

  log(`\n${'='.repeat(100)}`);
  log(`## ${c.key} — ${c.claim}`);
  log(`全类目 ${hits.length} 命中 | 类目分布: ${catStr || '-'}`);
  log('='.repeat(100));

  const securityish = hits.filter((p) => INTERESTING.has(p.category));
  const show = securityish.slice(0, 22);
  for (const p of show) {
    log(
      `\n  [${p.category}] ${p.name}  ${p.stars || 0}*  dl=${p.downloads || 0}  ` +
        `${p.npm || 'no-npm'}`,
    );
    log(`    repo: ${p.url}`);
    log(`    ${snippet(p, c.re)}`);
  }
  const rest = hits.length - show.length;
  if (rest > 0) {
    log(`\n  … 另有 ${rest} 条命中在 ${[...new Set(hits.slice(show.length).map((p) => p.category))].join('/')} 等类目（低星/低下载，见 --all）`);
  }
}

log(`\n\n${'#'.repeat(100)}`);
log(`# 汇总`);
log('#'.repeat(100));
for (const s of summary) log(`${s.key.padEnd(14)} ${String(s.n).padStart(4)} 命中 | ${s.catStr}`);

const out = lines.join('\n');
const outArgIdx = process.argv.indexOf('--out');
const outPath = outArgIdx >= 0 ? process.argv[outArgIdx + 1] : null;
if (outPath) {
  fs.writeFileSync(path.resolve(outPath), out, 'utf8');
  console.log(`written: ${path.resolve(outPath)}  (${out.length} bytes)`);
} else {
  console.log(out);
}
