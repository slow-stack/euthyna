/**
 * Dependency facts.
 *
 * The behaviour worth defending here is what the producer refuses to say and
 * where it refuses to guess. It emits versions from the lockfile and nothing
 * else: no "vulnerable", no severity, no verdict — mapping a version to a CVE is
 * the adjudication layer's job. A dep absent from a readable lockfile is an
 * established "not in the tree" fact, never a silent skip; a lockfile that
 * cannot be read or parsed is notEvaluated, never "clean".
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { collectDependencyFacts } from '../src/facts/deps.js';
import { STATUS, KIND } from '../src/contract.js';

let dir;

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'euthyna-deps-'));
});

after(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

// Each fixture lives in its own subdirectory so it can use the canonical
// lockfile filename — type detection keys off the filename, exactly as the real
// package managers do.
let fixtureCount = 0;
async function writeLockfile(name, content) {
  const fixtureDir = path.join(dir, `f${++fixtureCount}`);
  await mkdir(fixtureDir, { recursive: true });
  const file = path.join(fixtureDir, name);
  await writeFile(file, content, 'utf8');
  return file;
}

const NPM_V3 = `{
  "name": "app",
  "version": "1.0.0",
  "lockfileVersion": 3,
  "packages": {
    "": { "name": "app", "version": "1.0.0", "dependencies": { "lodash": "^4.17.20" } },
    "node_modules/lodash": { "version": "4.17.21", "resolved": "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz" },
    "node_modules/foo/node_modules/lodash": { "version": "4.17.20" }
  }
}
`;

describe('dependency facts — npm package-lock.json (v3)', () => {
  test('a pinned dependency is established with its resolved version', async () => {
    const file = await writeLockfile('package-lock.json', NPM_V3);

    const { facts, evaluated } = await collectDependencyFacts({
      lockfile: file,
      deps: ['lodash']
    });

    assert.equal(facts.length, 1);
    assert.equal(facts[0].status, STATUS.ESTABLISHED);
    assert.equal(facts[0].kind, KIND.DEPENDENCY);
    assert.deepEqual(facts[0].detail.resolvedVersions, ['4.17.21', '4.17.20']);
    assert.match(facts[0].statement, /被锁定为版本 4\.17\.21 \/ 4\.17\.20/);
    assert.equal(facts[0].evidence.file, file);
    assert.ok(facts[0].command.startsWith('euthyna deps'), 'the fact must be reproducible');
    assert.equal(evaluated[0].count, 1);
  });

  test('a dependency absent from the tree is established as absent, not skipped', async () => {
    const file = await writeLockfile('package-lock.json', NPM_V3);

    const { facts, notEvaluated } = await collectDependencyFacts({
      lockfile: file,
      deps: ['axios']
    });

    assert.equal(facts.length, 1);
    assert.equal(facts[0].status, STATUS.ESTABLISHED);
    assert.equal(facts[0].detail.reason, 'absent_from_lockfile');
    assert.match(facts[0].statement, /未出现在 lockfile/);
    assert.equal(notEvaluated.length, 0);
  });

  test('the only fact a dep query can emit is a version fact — never a verdict', async () => {
    const file = await writeLockfile('package-lock.json', NPM_V3);

    const { facts } = await collectDependencyFacts({ lockfile: file, deps: ['lodash'] });
    assert.doesNotMatch(
      JSON.stringify(facts),
      /"severity"|"risk"|"vulnerable"|"exploitable"|"verdict"/i,
      'a version fact must not smuggle in an adjudication field'
    );
  });

  test('a scoped dependency resolves by its full name', async () => {
    const file = await writeLockfile(
      'package-lock.json',
      JSON.stringify({
        name: 'app',
        lockfileVersion: 3,
        packages: {
          'node_modules/@babel/core': { version: '7.24.0' },
          'node_modules/@babel/core/node_modules/lodash': { version: '4.17.20' }
        }
      })
    );

    const { facts } = await collectDependencyFacts({ lockfile: file, deps: ['@babel/core', 'lodash'] });
    assert.equal(facts.length, 2);
    assert.equal(facts[0].detail.dependency, '@babel/core');
    assert.deepEqual(facts[0].detail.resolvedVersions, ['7.24.0']);
  });
});

describe('dependency facts — npm package-lock.json (v1)', () => {
  test('the recursive dependencies tree is walked', async () => {
    const file = await writeLockfile(
      'package-lock.json',
      JSON.stringify({
        name: 'app',
        version: '1.0.0',
        lockfileVersion: 1,
        dependencies: {
          lodash: { version: '4.17.21', dependencies: { 'lodash.defaultsdeep': { version: '4.6.1' } } }
        }
      })
    );

    const { facts } = await collectDependencyFacts({ lockfile: file, deps: ['lodash', 'lodash.defaultsdeep'] });
    assert.equal(facts.length, 2);
    assert.deepEqual(facts.find((f) => f.detail.dependency === 'lodash').detail.resolvedVersions, ['4.17.21']);
    assert.deepEqual(facts.find((f) => f.detail.dependency === 'lodash.defaultsdeep').detail.resolvedVersions, ['4.6.1']);
  });
});

describe('dependency facts — Cargo.lock', () => {
  test('a crate pinned in [[package]] blocks is established', async () => {
    const file = await writeLockfile(
      'Cargo.lock',
      `# This file is automatically @generated by Cargo.
# It is not intended for manual editing.
version = 3

[[package]]
name = "regex"
version = "1.10.2"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "abc"

[[package]]
name = "serde"
version = "1.0.203"
source = "registry+https://github.com/rust-lang/crates.io-index"
`
    );

    const { facts } = await collectDependencyFacts({ lockfile: file, deps: ['regex', 'axum'] });
    assert.equal(facts.length, 2);
    assert.equal(facts[0].status, STATUS.ESTABLISHED);
    assert.deepEqual(facts[0].detail.resolvedVersions, ['1.10.2']);
    assert.equal(facts[1].detail.reason, 'absent_from_lockfile');
  });
});

describe('dependency facts — go.mod', () => {
  test('declared requirement versions are reported as declared, not locked', async () => {
    const file = await writeLockfile(
      'go.mod',
      `module example.com/app

go 1.22

require (
	github.com/foo/bar v1.2.3
	golang.org/x/net v0.5.0 // indirect
)

require github.com/single/dep v2.0.0
`
    );

    const { facts } = await collectDependencyFacts({
      lockfile: file,
      deps: ['github.com/foo/bar', 'github.com/single/dep', 'github.com/missing/pkg']
    });

    assert.equal(facts.length, 3);
    const bar = facts.find((f) => f.detail.dependency === 'github.com/foo/bar');
    assert.equal(bar.status, STATUS.ESTABLISHED);
    assert.deepEqual(bar.detail.declaredVersions, ['v1.2.3']);
    assert.ok(
      !('resolvedVersions' in bar.detail),
      'a go.mod fact must not label declared versions as resolved'
    );
    assert.match(bar.statement, /被声明为版本 v1\.2\.3/);
    assert.match(bar.statement, /声明的需求版本/);
    const single = facts.find((f) => f.detail.dependency === 'github.com/single/dep');
    assert.deepEqual(single.detail.declaredVersions, ['v2.0.0']);
  });
});

describe('dependency facts — unmeasurable cases are notEvaluated, never clean', () => {
  test('no supported lockfile found is not evaluated', async () => {
    const empty = await mkdtemp(path.join(tmpdir(), 'euthyna-deps-empty-'));
    const { facts, notEvaluated, measured } = await collectDependencyFacts({
      cwd: empty,
      deps: ['lodash']
    });

    assert.equal(facts.length, 0);
    assert.equal(measured, false);
    assert.equal(notEvaluated.length, 1);
    assert.match(notEvaluated[0].reason, /未找到受支持的依赖清单/);
  });

  test('an unsupported lockfile is named in the reason, not guessed at', async () => {
    const dir2 = await mkdtemp(path.join(tmpdir(), 'euthyna-deps-pnpm-'));
    await writeFile(path.join(dir2, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n', 'utf8');

    const { facts, notEvaluated, measured } = await collectDependencyFacts({
      cwd: dir2,
      deps: ['lodash']
    });

    assert.equal(facts.length, 0);
    assert.equal(measured, false);
    assert.match(notEvaluated[0].reason, /pnpm-lock\.yaml/);
    assert.match(notEvaluated[0].reason, /暂不支持/);
  });

  test('a malformed package-lock.json is not evaluated, with the parse error named', async () => {
    const file = await writeLockfile('package-lock.json', '{ this is not json');
    const { facts, notEvaluated, measured } = await collectDependencyFacts({
      lockfile: file,
      deps: ['lodash']
    });

    assert.equal(facts.length, 0);
    assert.equal(measured, false);
    assert.equal(notEvaluated.length, 1);
    assert.match(notEvaluated[0].reason, /解析失败/);
  });

  test('a structurally empty lockfile (e.g. {}) is not evaluated, never clean', async () => {
    const file = await writeLockfile('package-lock.json', '{}');
    const { facts, notEvaluated, measured } = await collectDependencyFacts({
      lockfile: file,
      deps: ['lodash']
    });

    assert.equal(facts.length, 0);
    assert.equal(measured, false);
    assert.equal(notEvaluated.length, 1);
    assert.match(notEvaluated[0].reason, /结构不完整/);
  });

  test('a coexisting unsupported lockfile is named even when a supported one is measured', async () => {
    const dir2 = await mkdtemp(path.join(tmpdir(), 'euthyna-deps-coexist-'));
    await writeFile(path.join(dir2, 'package-lock.json'), NPM_V3, 'utf8');
    await writeFile(path.join(dir2, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n', 'utf8');

    const { facts, notEvaluated, measured } = await collectDependencyFacts({
      cwd: dir2,
      deps: ['lodash']
    });

    assert.equal(measured, true);
    assert.equal(facts.length, 1);
    assert.ok(
      notEvaluated.some((n) => /pnpm-lock\.yaml/.test(n.reason)),
      'the unsupported lockfile must be named even though a supported one was measured'
    );
  });

  test('an explicit --lockfile pointing at a missing file is not evaluated', async () => {
    const { facts, notEvaluated, measured } = await collectDependencyFacts({
      lockfile: path.join(dir, 'nope.json'),
      deps: ['lodash']
    });

    assert.equal(facts.length, 0);
    assert.equal(measured, false);
    assert.match(notEvaluated[0].reason, /ENOENT/);
  });

  test('asking for no dependencies is not evaluated', async () => {
    const file = await writeLockfile('package-lock.json', NPM_V3);
    const { facts, notEvaluated, measured } = await collectDependencyFacts({ lockfile: file, deps: [] });

    assert.equal(facts.length, 0);
    assert.equal(measured, false);
    assert.match(notEvaluated[0].reason, /没有指定要查询的依赖/);
  });
});

describe('dependency facts — CLI exit code contract', () => {
  test('a measured run exits 0 even when a dep is absent', async () => {
    const { main } = await import('../src/cli.js');
    const file = await writeLockfile('package-lock.json', NPM_V3);
    assert.equal(
      await main(['deps', '--lockfile', file, '--dep', 'lodash', '--json']),
      0
    );
    assert.equal(
      await main(['deps', '--lockfile', file, '--dep', 'axios', '--json']),
      0,
      'absent is a measurement, not a failure'
    );
  });

  test('deps with no --dep is a usage error', async () => {
    const { main } = await import('../src/cli.js');
    assert.equal(await main(['deps', '--json']), 1);
  });

  test('an unmeasurable deps run exits 2, which must not read as clean', async () => {
    const { main } = await import('../src/cli.js');
    const empty = await mkdtemp(path.join(tmpdir(), 'euthyna-deps-cli-'));
    const code = await main(['deps', '--repo', empty, '--dep', 'lodash', '--json']);
    assert.equal(code, 2);
    assert.notEqual(code, 0);
  });
});
