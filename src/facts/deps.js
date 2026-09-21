/**
 * Dependency facts: what versions does the lockfile actually pin?
 *
 * This closes the INCONCLUSIVE gap for supply-chain claims (issue #8). A claim
 * like "the app depends on a vulnerable version of X" cannot be adjudicated
 * without knowing what version is actually in the tree, and the lockfile is the
 * deterministic ground truth for that. A model can guess at it from package.json
 * ranges; this producer reads the lockfile and reports the pinned versions.
 *
 * It never emits "vulnerable", "risky" or a severity: mapping a version to a CVE
 * is the adjudication layer's job, and the fact contract forbids verdict fields.
 * Absence is handled honestly too — a dep missing from a well-formed lockfile is
 * an established "not in the resolved tree" fact, never a silent skip.
 *
 * Tier 0 scope is three formats, all parseable with zero dependencies:
 *   - package-lock.json  (npm v1/v2/v3)
 *   - Cargo.lock         (Rust)
 *   - go.mod             (Go; the DECLARED requirement version, not the resolved one —
 *                         go.sum has no versions, so this producer says "declared",
 *                         never "locked", for Go)
 * Anything else found at auto-detect (pnpm/yarn/poetry/...) is reported as
 * notEvaluated with the filenames named, rather than guessed at.
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { makeFact, notEvaluated as notEvaluatedEntry, KIND, STATUS, shellQuote } from '../contract.js';

/** Formats this producer can parse, and the filenames that select them. */
const SUPPORTED = [
  { file: 'package-lock.json', type: 'npm' },
  { file: 'Cargo.lock', type: 'cargo' },
  { file: 'go.mod', type: 'go' }
];

/** Recognised formats we deliberately do not parse yet, named in the notEvaluated reason. */
const UNSUPPORTED = [
  'pnpm-lock.yaml',
  'yarn.lock',
  'poetry.lock',
  'composer.lock',
  'Gemfile.lock',
  'bun.lockb',
  'bun.lock'
];

/** 1-indexed line of the first line containing `needle`, or null. */
function lineOf(text, needle) {
  return lineOfAt(text, text.indexOf(needle));
}

/** 1-indexed line of the absolute text index, or null when it is not found. */
function lineOfAt(text, index) {
  if (index < 0) return null;
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (text[i] === '\n') line++;
  }
  return line;
}

/**
 * npm package-lock.json, any lockfileVersion. Returns [{version, location, line}].
 *
 * v2/v3: `packages` maps "node_modules/<name>" (possibly nested, and possibly
 * scoped "@scope/name") to metadata; the package name is the path segment after
 * the last "node_modules/". v1: a recursive `dependencies` tree.
 */
function resolveNpm(root, dep, text) {
  const found = [];

  if (root.packages && typeof root.packages === 'object') {
    for (const [key, meta] of Object.entries(root.packages)) {
      if (!key.includes('node_modules/')) continue;
      if (!meta || typeof meta !== 'object' || !meta.version) continue;
      if (key.split('node_modules/').pop() !== dep) continue;
      found.push({ version: meta.version, location: key, line: lineOf(text, `"${key}":`) });
    }
  }

  if (root.dependencies && typeof root.dependencies === 'object') {
    const walk = (tree) => {
      for (const [name, meta] of Object.entries(tree)) {
        if (!meta || typeof meta !== 'object') continue;
        if (name === dep && meta.version) {
          // Anchor at this dep's own block: a same-version string earlier in the
          // file (some other package) must not hijack the evidence pointer.
          const blockAt = text.indexOf(`"${name}":`);
          const verAt = blockAt < 0 ? -1 : text.indexOf(`"version": "${meta.version}"`, blockAt);
          found.push({
            version: meta.version,
            location: `dependencies.${name}`,
            line: lineOfAt(text, verAt)
          });
        }
        if (meta.dependencies && typeof meta.dependencies === 'object') walk(meta.dependencies);
      }
    };
    walk(root.dependencies);
  }

  return found;
}

/** Cargo.lock: [[package]] blocks with `name = "..."` and `version = "..."`. */
function resolveCargo(text, dep) {
  const found = [];
  for (const block of text.split('[[package]]')) {
    const name = /^\s*name\s*=\s*"([^"]+)"/m.exec(block);
    const version = /^\s*version\s*=\s*"([^"]+)"/m.exec(block);
    if (!name || !version || name[1] !== dep) continue;
    // Package names are unique in a Cargo.lock, so anchoring the version line
    // at this dep's own name block keeps the pointer on this crate even when a
    // different crate earlier in the file pins the same version string.
    const nameAt = text.indexOf(`name = "${dep}"`);
    const verAt = nameAt < 0 ? -1 : text.indexOf(`version = "${version[1]}"`, nameAt);
    found.push({
      version: version[1],
      location: `[[package]] ${dep}`,
      line: lineOfAt(text, verAt)
    });
  }
  return found;
}

/** go.mod require lines, single or inside a require (...) block. */
function resolveGo(text, dep) {
  const found = [];
  let inBlock = false;
  text.split('\n').forEach((raw, index) => {
    const line = raw.trim();
    if (line.startsWith('require (')) {
      inBlock = true;
      return;
    }
    if (line === ')') {
      inBlock = false;
      return;
    }
    let match = /^require\s+(\S+)\s+(v[\w.+-]+)/.exec(line);
    if (!match && inBlock) match = /^(\S+)\s+(v[\w.+-]+)/.exec(line);
    if (!match || match[1] !== dep) return;
    found.push({ version: match[2], location: `require ${dep}`, line: index + 1 });
  });
  return found;
}

/**
 * Build a per-dependency resolver for a parsed manifest, or throw on a format
 * that cannot be read. The throw happens once, up front, so a malformed file
 * becomes one notEvaluated reason instead of one failed fact per dependency.
 */
function makeResolver(type, text) {
  if (type === 'npm') {
    const root = JSON.parse(text); // throws on malformed JSON
    // A syntactically valid but structurally empty file (e.g. `{}`) is not a
    // lockfile; treating it as one would report every dependency as "absent"
    // and exit clean on garbage.
    if (
      !root ||
      typeof root !== 'object' ||
      (root.packages === undefined && root.dependencies === undefined && root.lockfileVersion === undefined)
    ) {
      throw new Error('package-lock.json 结构不完整（缺 lockfileVersion/packages/dependencies），不像真实的 npm 锁文件');
    }
    return (dep) => resolveNpm(root, dep, text);
  }
  if (type === 'cargo') {
    if (!/\[\[package\]\]|^version\s*=/m.test(text)) {
      throw new Error('Cargo.lock 结构不完整（无 [[package]] 块或 version 头），不像真实的 Cargo 锁文件');
    }
    return (dep) => resolveCargo(text, dep);
  }
  if (type === 'go') {
    if (!/^module\s+\S+/m.test(text)) {
      throw new Error('go.mod 结构不完整（无 module 行），不像真实的 go.mod');
    }
    return (dep) => resolveGo(text, dep);
  }
  throw new Error(`不受支持的依赖清单格式: ${type}`);
}

function typeForFile(name) {
  return SUPPORTED.find((s) => s.file === name)?.type ?? null;
}

async function detectIn(cwd) {
  const found = [];
  for (const spec of SUPPORTED) {
    const filePath = path.join(cwd, spec.file);
    try {
      await stat(filePath);
      found.push({ ...spec, path: filePath });
    } catch {
      // not present
    }
  }
  return found;
}

async function unsupportedIn(cwd) {
  const seen = [];
  for (const name of UNSUPPORTED) {
    try {
      await stat(path.join(cwd, name));
      seen.push(name);
    } catch {
      // not present
    }
  }
  return seen;
}

/**
 * Collect dependency facts.
 *
 * `measured` is false exactly when no lockfile could be read or parsed — never
 * when a dep is simply absent from a readable lockfile (that absence IS the
 * measurement, and the fact records it).
 *
 * @param {object} options
 * @param {string} [options.cwd]  directory to auto-detect in
 * @param {string} [options.lockfile]  explicit manifest path (overrides detection)
 * @param {string[]} options.deps  dependency names to query (repeatable)
 */
export async function collectDependencyFacts({ cwd = process.cwd(), lockfile, deps = [] } = {}) {
  const facts = [];
  const evaluated = [];
  const notEvaluated = [];
  let counter = 0;

  if (deps.length === 0) {
    notEvaluated.push(notEvaluatedEntry(KIND.DEPENDENCY, '没有指定要查询的依赖（--dep）'));
    return { facts, evaluated, notEvaluated, measured: false };
  }

  let target;
  if (lockfile) {
    const filePath = path.resolve(lockfile);
    const type = typeForFile(path.basename(filePath));
    try {
      await stat(filePath);
    } catch {
      notEvaluated.push(
        notEvaluatedEntry(KIND.DEPENDENCY, `无法读取依赖清单 ${filePath}: ENOENT`)
      );
      return { facts, evaluated, notEvaluated, measured: false };
    }
    if (!type) {
      notEvaluated.push(
        notEvaluatedEntry(
          KIND.DEPENDENCY,
          `${path.basename(filePath)} 不是受支持的依赖清单格式；本产出器支持 package-lock.json / Cargo.lock / go.mod`
        )
      );
      return { facts, evaluated, notEvaluated, measured: false };
    }
    target = { path: filePath, type };
  } else {
    const found = await detectIn(cwd);
    if (found.length === 0) {
      const unsupported = await unsupportedIn(cwd);
      const reason = unsupported.length
        ? `检测到 ${unsupported.join('、')}，但 Tier 0 暂不支持；本产出器支持 package-lock.json / Cargo.lock / go.mod`
        : '未找到受支持的依赖清单（package-lock.json / Cargo.lock / go.mod），没有可测量的锁定版本';
      notEvaluated.push(notEvaluatedEntry(KIND.DEPENDENCY, reason));
      return { facts, evaluated, notEvaluated, measured: false };
    }
    target = found[0];
    // A repo can carry both a supported and an unsupported lockfile (e.g. a
    // pnpm-lock.yaml alongside a leftover package-lock.json). The unsupported
    // one must still be named, so a reader knows the tree it measured is not
    // necessarily the tree the project actually installs from.
    const unsupported = await unsupportedIn(cwd);
    if (unsupported.length > 0) {
      notEvaluated.push(
        notEvaluatedEntry(
          KIND.DEPENDENCY,
          `同目录还检测到 ${unsupported.join('、')}（Tier 0 暂不支持），本次只测了 ${target.file}`
        )
      );
    }
  }

  let text;
  try {
    text = await readFile(target.path, 'utf8');
  } catch (error) {
    notEvaluated.push(
      notEvaluatedEntry(KIND.DEPENDENCY, `无法读取 ${target.path}: ${error.code ?? error.message}`)
    );
    return { facts, evaluated, notEvaluated, measured: false };
  }

  let resolver;
  try {
    resolver = makeResolver(target.type, text);
  } catch (error) {
    notEvaluated.push(
      notEvaluatedEntry(
        KIND.DEPENDENCY,
        `${target.path} 解析失败（${target.type}）：${error.message}`
      )
    );
    return { facts, evaluated, notEvaluated, measured: false };
  }

  const verb = target.type === 'go' ? '声明' : '锁定';
  const listLabel = target.type === 'go' ? 'go.mod' : 'lockfile';

  for (const dep of deps) {
    const hits = resolver(dep);
    const reproduce = `euthyna deps --lockfile ${shellQuote(target.path)} --dep ${shellQuote(dep)}`;

    if (hits.length > 0) {
      const versions = [...new Set(hits.map((h) => h.version))];
      const first = hits[0];
      facts.push(
        makeFact({
          id: `dependency-${++counter}`,
          kind: KIND.DEPENDENCY,
          statement:
            `依赖 ${dep} 在 ${listLabel}（${target.type}）中被${verb}为版本 ${versions.join(' / ')}` +
            (target.type === 'go'
              ? ' —— 这是声明的需求版本，非最终解析版本（go.sum 不含版本，无法在此验证解析结果）'
              : ''),
          status: STATUS.ESTABLISHED,
          evidence: { file: target.path, ...(first.line ? { line: first.line } : {}) },
          method: 'command',
          command: reproduce,
          detail: {
            lockfileType: target.type,
            dependency: dep,
            verb,
            // go.mod declares a requirement; calling it "resolved" would let a
            // consumer mistake it for the final build version. The field name
            // must not oversell what the source can prove.
            ...(target.type === 'go' ? { declaredVersions: versions } : { resolvedVersions: versions }),
            locations: hits.map((h) => h.location)
          }
        })
      );
    } else {
      facts.push(
        makeFact({
          id: `dependency-${++counter}`,
          kind: KIND.DEPENDENCY,
          statement: `依赖 ${dep} 未出现在 ${listLabel}（${target.type}）的依赖树中 —— 声称它影响本应用的声明在此被证伪`,
          status: STATUS.ESTABLISHED,
          evidence: { file: target.path },
          method: 'command',
          command: reproduce,
          detail: {
            lockfileType: target.type,
            dependency: dep,
            ...(target.type === 'go' ? { declaredVersions: [] } : { resolvedVersions: [] }),
            reason: 'absent_from_lockfile'
          }
        })
      );
    }
  }

  evaluated.push({ kind: KIND.DEPENDENCY, producer: 'euthyna-deps', count: deps.length });

  return { facts, evaluated, notEvaluated, measured: true };
}
