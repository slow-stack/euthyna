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
});
