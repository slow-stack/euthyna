'use strict';

/**
 * Scaling benchmark for the `history` producer.
 *
 * The producer blames each deleted range sequentially
 * (`src/facts/history.js`: one `git blame` per range), so its cost grows with
 * the number of deleted ranges. This script builds synthetic repositories and
 * measures the producer at increasing deletion sizes, so a change to batching
 * or parallelization has a baseline to be judged against — and a reader can see
 * at a glance whether the current shape is linear.
 *
 * The deleted lines are interleaved (every other line in a region), which
 * produces one single-line range per deletion — the worst case for a sequential
 * blamer. The file size is held fixed while the deletion count grows, so the
 * ms/deleted-line ratio isolates the sequential per-range cost from the
 * (separate) cost of blaming a bigger file. Absolute numbers are
 * machine-dependent; the ratio is the number that matters.
 *
 *   node bench/perf.js [--total 12000] [--min 250] [--max 4000] [--steps 5]
 *
 * 默认档实测 4000 个删除区间约 80s（~21ms/区间，线性）；全程 5 档 + 造仓约
 * 2-3 分钟。要快速看曲线就调小 --max/--total。
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : Number(args[i + 1]);
};
const TOTAL = opt('--total', 12000);
const MIN = opt('--min', 250);
const MAX = opt('--max', 4000);
const STEPS = opt('--steps', 5);

function git(cwd, argv) {
  return execFileSync('git', argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

/**
 * Build a repo whose last commit deletes `deletedLines` single-line ranges.
 * The lines were added across COMMIT_CHUNKS commits, so blame does real
 * provenance work instead of attributing everything to one commit.
 */
async function buildRepo({ totalLines, deletedLines }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'euthyna-perf-'));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'bench@example.com']);
  git(dir, ['config', 'user.name', 'Perf Bench']);

  const file = path.join(dir, 'work.js');
  const COMMIT_CHUNKS = 10;
  const chunk = Math.ceil(totalLines / COMMIT_CHUNKS);

  let all = [];
  for (let c = 0; c < COMMIT_CHUNKS; c++) {
    for (let i = 0; i < chunk && all.length < totalLines; i++) {
      all.push(`export const v${all.length} = ${all.length}; // chunk ${c}`);
    }
    fs.writeFileSync(file, all.join('\n') + '\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', `feat: chunk ${c}`]);
  }
  const base = git(dir, ['rev-parse', 'HEAD']);

  // Delete every other line in the first `deletedLines * 2` region: each
  // deletion is a single-line range, separated by kept lines.
  const region = deletedLines * 2;
  const kept = all.filter((_, i) => i >= region || i % 2 === 0);
  fs.writeFileSync(file, kept.join('\n') + '\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'refactor: drop interleaved lines']);
  const head = git(dir, ['rev-parse', 'HEAD']);

  return { dir, base, head, deletedLines };
}

async function main() {
  const { collectHistoryFacts } = await import('../src/facts/history.js');

  // A misconfigured run must fail loudly, not generate a NaN-size benchmark that
  // "runs" and prints meaningless numbers (--steps 1 divides by zero).
  const numericOptions = [TOTAL, MIN, MAX, STEPS];
  if (
    !numericOptions.every(Number.isFinite) ||
    !numericOptions.every(Number.isInteger) ||
    STEPS < 2 ||
    MIN < 1 ||
    MAX <= MIN
  ) {
    throw new Error('--total/--min/--max/--steps 必须是正整数，且 --steps >= 2、--max > --min');
  }

  if (MAX * 2 > TOTAL) {
    throw new Error(`--max (${MAX}) 需要满足 --max*2 <= --total (${TOTAL})，否则区域超出文件`);
  }

  const sizes = [];
  for (let i = 0; i < STEPS; i++) {
    const size = Math.round(MIN * Math.pow(MAX / MIN, i / (STEPS - 1)));
    if (!sizes.includes(size)) sizes.push(size);
  }

  const rows = [];
  for (const deletedLines of sizes) {
    const repo = await buildRepo({ totalLines: TOTAL, deletedLines });
    try {
      const start = process.hrtime.bigint();
      await collectHistoryFacts({ cwd: repo.dir, base: repo.base, head: repo.head });
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      rows.push({ deletedLines, ms });
      process.stdout.write(
        `  ${String(deletedLines).padStart(5)} 删除行  ${ms.toFixed(0).padStart(6)} ms  ` +
          `(${(ms / deletedLines).toFixed(2)} ms/行)\n`
      );
    } finally {
      // Never leak the synthetic repo, even when the producer throws or the
      // run is interrupted mid-measurement.
      fs.rmSync(repo.dir, { recursive: true, force: true });
    }
  }

  const ratios = rows.filter(r => r.ms > 0).map(r => r.ms / r.deletedLines);
  const spread = ratios.length > 1 ? Math.max(...ratios) / Math.min(...ratios) : Infinity;

  console.log('\n结论:');
  if (ratios.length < 2) {
    console.log('  样本不足，无法判断缩放方向。');
  } else if (spread < 1.5) {
    const biggest = rows[rows.length - 1];
    console.log(
      '  每删除行的耗时基本恒定 —— 确认是顺序 blame 的线性缩放。' +
        `实测 ${biggest.deletedLines} 个删除区间约 ${(biggest.ms / 1000).toFixed(1)}s，` +
        '即真实 PR 里删几千个分散行会达到分钟级——这是当前实现的实际天花板。' +
        '升级路径: 按文件批量 blame、或对单行区间做并发。'
    );
  } else if (ratios[ratios.length - 1] > ratios[0]) {
    console.log(
      '  每删除行耗时在变大 —— 超线性，说明除 blame 外还有逐行开销在放大。' +
        '值得先压出是哪一步（diff 解析 / commit 汇总 / 事实构造）。'
    );
  } else if (ratios[ratios.length - 1] < ratios[0]) {
    console.log(
      '  每删除行耗时在变小 —— 次线性，说明固定开销（造仓/首档预热）在小规模测量中占比较高。'
    );
  } else {
    console.log('  每删除行耗时方向不明确（两端持平但中间波动）。');
  }
  console.log('  绝对数值依赖机器；横向比较 ms/行 而非 ms。');
}

main().catch((error) => {
  console.error(`bench/perf.js: ${error.message}`);
  process.exitCode = 1;
});
