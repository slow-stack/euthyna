'use strict';

/**
 * Scaling benchmark for the `history` producer.
 *
 * The producer blames deleted ranges in batches (`src/facts/history.js`: one
 * `git blame` process per ~400 ranges, one `-L` flag per range). This script
 * builds synthetic repositories and measures the producer at increasing
 * deletion sizes, so a change to the batching has a baseline to be judged
 * against — and a reader can see at a glance how the shape moves.
 *
 * The deleted lines are interleaved (every other line in a region), which
 * produces one single-line range per deletion — the case that used to cost one
 * process per range (measured ~48 ms/行 linear on this machine, 2000 ranges
 * ≈ 97 s) and now costs one process per 400. The file size is held fixed while
 * the deletion count grows. Absolute numbers are machine-dependent; the ratio
 * is the number that matters.
 *
 *   node bench/perf.js [--total 12000] [--min 250] [--max 4000] [--steps 5]
 *   node bench/perf.js --files 200 [--lines 100]
 *
 * --files 测另一条成本轴：`git blame` 一次只收一个文件，所以每 (文件, 提交)
 * 对至少一个进程，`-L` 批处理只在文件内合并——进程数的下限是文件数，不是
 * 行数。上面的单文件扫档看不到这条轴。真实世界里的对应形状是「一次依赖
 * 升级把打进仓库的 vendored 树整片删掉」（数百个文件、每文件几十行）。
 * 要横向比较的量是 ms/文件。
 *
 * 实测（--files 200 --lines 100）：串行 65.2s（326 ms/文件）→ 8 路并发
 * 54.9s（275 ms/文件）；并发在热对象上拿到 ~20×（同一仓库 32 个 blame
 * 8.77s → 431ms），但首次冷遍历 ~250 ms/文件是并发救不了的下限——对比
 * blame 相关改动时必须钉住缓存状态，否则测的是缓存不是改动。完整记录见
 * AGENTS.md 的 pitfalls 表。
 *
 * 分批后实测（--total 8000 --max 2000 --steps 4）：2000 个删除区间约 3.7s
 * （~1.9ms/行，次线性）。默认全程 5 档 + 造仓约 2-3 分钟（估算，未逐档实测）。
 * 要快速看曲线就调小 --max/--total。
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
const FILES = opt('--files', 0);
const LINES_PER_FILE = opt('--lines', 100);

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

/**
 * The file path for a generated module name, bounded to the repo directory.
 * The names are build-generated (`modNNNN.js`), but the bound is asserted
 * rather than assumed — same fail-loudly principle as the option validation.
 */
function boundedFile(dir, name) {
  const target = path.join(dir, name);
  if (path.dirname(target) !== dir) {
    throw new Error(`bench/perf.js: generated name escapes the repo dir: ${name}`);
  }
  return target;
}

/**
 * Build a repo with `fileCount` files whose last commit deletes `linesPerFile`
 * interleaved lines from every file — the vendored-tree shape. Files are
 * written across COMMIT_CHUNKS commits so blame has more than one candidate
 * owner; each file's lines all come from one commit, which is realistic for
 * vendored content and keeps the repo build cheap.
 */
async function buildMultiFileRepo({ fileCount, linesPerFile }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'euthyna-perf-files-'));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'bench@example.com']);
  git(dir, ['config', 'user.name', 'Perf Bench']);

  const COMMIT_CHUNKS = 3;
  const names = [];
  for (let f = 0; f < fileCount; f++) names.push(`mod${String(f).padStart(4, '0')}.js`);
  const perChunk = Math.ceil(fileCount / COMMIT_CHUNKS);

  let written = 0;
  for (let c = 0; c < COMMIT_CHUNKS; c++) {
    for (let i = 0; i < perChunk && written < fileCount; i++, written++) {
      const lines = [];
      for (let l = 0; l < linesPerFile * 2; l++) {
        lines.push(`export const f${written}v${l} = ${l}; // chunk ${c}`);
      }
      fs.writeFileSync(boundedFile(dir, names[written]), lines.join('\n') + '\n');
    }
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', `feat: chunk ${c}`]);
  }
  const base = git(dir, ['rev-parse', 'HEAD']);

  for (const name of names) {
    const file = boundedFile(dir, name);
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l !== '');
    fs.writeFileSync(file, lines.filter((_, i) => i % 2 === 0).join('\n') + '\n');
  }
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'refactor: drop interleaved lines in every file']);
  const head = git(dir, ['rev-parse', 'HEAD']);

  return { dir, base, head, deletedLines: fileCount * linesPerFile };
}

/** The multi-file scenario: one measurement, ms/file is the number to compare. */
async function filesMode() {
  const { collectHistoryFacts } = await import('../src/facts/history.js');
  if (
    !Number.isInteger(FILES) ||
    FILES < 1 ||
    !Number.isInteger(LINES_PER_FILE) ||
    LINES_PER_FILE < 1
  ) {
    throw new Error('--files/--lines 必须是正整数');
  }

  const repo = await buildMultiFileRepo({ fileCount: FILES, linesPerFile: LINES_PER_FILE });
  try {
    const start = process.hrtime.bigint();
    await collectHistoryFacts({ cwd: repo.dir, base: repo.base, head: repo.head });
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    process.stdout.write(
      `  ${FILES} 文件 × ${LINES_PER_FILE} 删除行/文件  ${ms.toFixed(0).padStart(6)} ms  ` +
        `(${(ms / FILES).toFixed(1)} ms/文件)\n`
    );
    console.log('  绝对数值依赖机器；这一场景横向比较 ms/文件，进程下限是文件数。');
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
}

async function main() {
  if (FILES > 0) return filesMode();

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
      '  每删除行的耗时基本恒定 —— 线性缩放。' +
        `实测 ${biggest.deletedLines} 个删除区间约 ${(biggest.ms / 1000).toFixed(1)}s。` +
        '若回到分钟级，先查 blame 是否退化成了每区间一个进程。'
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
