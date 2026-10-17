/**
 * The plugin half is what makes `dsh plugin add euthyna` mount the skill, and
 * the marketplace's CI reads `dsh.bundle` before it looks at anything else.
 * Three pieces have to agree — the manifest, the patch file and the entry
 * module — and a rename in one of them is exactly the change that looks
 * harmless alone. This pins them together.
 *
 * It does not boot the plugin: the official filesystem provider is a peer the
 * harness supplies, and it is not installed in this repository. What is checked
 * here is the shape the host reads, plus the bundle path the entry expects.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { satisfies } from './semver-range.js';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (rel) => readFile(path.join(ROOT, rel), 'utf8');
const pkg = async () => JSON.parse(await read('package.json'));

describe('the package is installable as a dsh plugin', () => {
  test('package.json declares dsh.bundle.patch, not only dsh.client', async () => {
    const manifest = (await pkg()).dsh;
    assert.equal(manifest?.bundle?.patch, './cordis.patch.yml', 'a bundle without dsh.bundle.patch fails to boot');
    assert.equal(manifest?.client, undefined, 'this plugin ships no browser UI');
  });

  test('the declared patch exists and inserts this package by name', async () => {
    const patch = await read('cordis.patch.yml');
    const { name } = await pkg();
    assert.match(patch, /id:\s*euthyna/, 'the patch row needs a stable id');
    assert.match(patch, new RegExp(`name:\\s*'?"?${name}'?"?`), 'the patch must insert this package');
  });

  test('main points at the entry module the host resolves', async () => {
    const manifest = await pkg();
    assert.equal(manifest.main, './plugin/index.js');
    const entry = await read('plugin/index.js');
    assert.match(entry, /export const name = '/, 'a cordis plugin exports its name');
    assert.match(entry, /export const inject = \['skills', 'commands'\]/, 'the skills and commands services must be injected');
    assert.match(entry, /export function apply\(ctx/, 'a cordis plugin exports apply(ctx)');
    assert.match(entry, /registerProvider/, 'the entry must register the provider');
    assert.match(entry, /ctx\.commands\.register/, 'the entry must register the /euthyna command');
  });

  test('the entry serves the skill bundle it expects to exist', async () => {
    // The entry resolves `<package>/.agents/skills` at runtime; the bundle it
    // looks for there has to be the one this repository authors.
    await access(path.join(ROOT, '.agents', 'skills', 'euthyna', 'SKILL.md'));
    const entry = await read('plugin/index.js');
    assert.match(entry, /'\.agents', 'skills'/, 'the entry must resolve the packaged skill root');
  });

  test('the tarball ships the entry, the patch and the skill', async () => {
    const { files } = await pkg();
    for (const entry of ['plugin/', 'cordis.patch.yml', '.agents/skills/euthyna/', '.claude/commands/']) {
      assert.ok(files.includes(entry), `${entry} must be in the published files list`);
    }
  });
});

describe('the declared peer stays resolvable on prerelease harness builds', () => {
  test('the range carries explicit prerelease branches', async () => {
    // node-semver only lets a prerelease satisfy a range when some comparator
    // shares its major.minor.patch tuple AND itself carries a prerelease tag.
    // A single "^0.1.5-rc.2" therefore silently excludes 0.1.6-rc.*, and the
    // user meets an ERESOLVE instead of a plugin. The published convention is
    // one branch per tuple — keep more than one.
    const { peerDependencies, peerDependenciesMeta } = await pkg();
    const range = peerDependencies?.['@deepseek-ai/dsh-skill-filesystem'];
    assert.equal(typeof range, 'string', 'the provider this plugin imports must be a declared peer');
    assert.ok(range.includes('||'), `one branch cannot cover the prerelease tuples in use: ${range}`);
    assert.ok((range.match(/-(rc|alpha|beta)\./g) ?? []).length >= 2, `each covered tuple needs its own prerelease comparator: ${range}`);
    assert.equal(peerDependenciesMeta?.['@deepseek-ai/dsh-skill-filesystem']?.optional, true, 'the CLI install must not pull the harness in');
  });

  test('the range reaches the 0.2.x harness line and stays readable by the market', async () => {
    // Two separate ceilings bit this package on the 0.2.0 release of the harness.
    // The host checks the peer range against its OWN version (app-boot's
    // unmetRequirements), so a range that stopped at 0.1.x denied the plugin at
    // install time; and the plugin market's discovery cache refuses a range over
    // MAX_RANGE_LENGTH = 256 characters outright (dshmarket's
    // discovery-compatibility.js), so widening past that trades one silent
    // rejection for another. Neither failure shows up as a test elsewhere.
    const { peerDependencies } = await pkg();
    const range = peerDependencies?.['@deepseek-ai/dsh-skill-filesystem'];
    assert.ok(/[><]=\s*0\.2\./.test(range), `the 0.2.x harness line must have its own branch: ${range}`);
    assert.ok(range.length < 256, `the market drops ranges this long: ${range.length} chars`);
  });

  test('the range actually admits the harness versions it claims, not just their text', async () => {
    // The text assertions above are necessary and not sufficient. A range can
    // carry "0.2." and be short and still reject every 0.2.x prerelease:
    // `>=0.2.0-0 <0.2.1-0` passes both checks and refuses 0.2.1-rc.2. The
    // property that matters is admission, so it is asserted directly.
    //
    // Both admission rules are checked because the plugin meets both. The host
    // compares with includePrerelease:true (app-boot's unmetRequirements), which
    // is how a mount is allowed at startup; plain `npm install` uses the default
    // rule, which is how the install either resolves or throws ERESOLVE. A
    // range that satisfies only the first is a package that installs nowhere.
    const { peerDependencies } = await pkg();
    const range = peerDependencies?.['@deepseek-ai/dsh-skill-filesystem'];
    for (const version of ['0.1.6-rc.0', '0.1.7-rc.1', '0.2.0-rc.1', '0.2.1-rc.1', '0.2.1-rc.2', '0.2.1', '0.2.5']) {
      assert.ok(satisfies(version, range, { includePrerelease: true }),
        `the harness at ${version} must be admitted: ${range}`);
    }
    // The default rule has to admit the plain releases and the prereleases whose
    // tuple has its own branch. This is the rule `npm install` applies.
    for (const version of ['0.1.6-0', '0.1.7-0', '0.2.0-0', '0.2.1-0', '0.2.1-rc.2', '0.2.1']) {
      assert.ok(satisfies(version, range, { includePrerelease: false }),
        `npm's own rule must admit ${version}, or the install fails with ERESOLVE: ${range}`);
    }
    for (const version of ['0.0.9', '0.1.1', '0.3.0-0', '0.3.0', '1.0.0']) {
      assert.ok(!satisfies(version, range, { includePrerelease: true }),
        `${version} was never checked and must stay out: ${range}`);
    }
  });

  test('a -0 floor covers its own tuple only, and the suite states that boundary', async () => {
    // Regression lock on the wording in AGENTS.md. `-0` sorts below every
    // prerelease of ITS tuple, so `>=0.2.1-0 <0.3.0-0` admits 0.2.1-alpha.1
    // without a new branch. It does NOT reach the next tuple's prereleases: the
    // host's includePrerelease rule admits 0.2.2-alpha.1, npm's default rule
    // does not. Writing the second half as if it also held is what an earlier
    // draft of the AGENTS.md note did, so the true boundary is pinned here.
    const branch = '>=0.2.1-0 <0.3.0-0';
    for (const version of ['0.2.1-0', '0.2.1-alpha.1', '0.2.1-rc.1', '0.2.1', '0.2.2']) {
      assert.ok(satisfies(version, branch, { includePrerelease: false }), `${version} shares the tuple and must be admitted`);
    }
    assert.ok(satisfies('0.2.2-alpha.1', branch, { includePrerelease: true }), 'the host rule reaches the next tuple');
    assert.ok(!satisfies('0.2.2-alpha.1', branch, { includePrerelease: false }),
      'the npm rule does not: a later tuple needs its own branch');
  });
});
