/**
 * The Hermes plugin surface: plugin.yaml + __init__.py at the repo root are what
 * `hermes plugins install slow-stack/euthyna` discovers (the discovery reads
 * `<root>/plugin.yaml`), and the /euthyna slash command forwards to four CLI
 * subcommands. A CLI subcommand rename is the harmless-looking change that
 * breaks the command silently — this pins the two together, and pins the files
 * the npm tarball must carry.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (rel) => readFile(path.join(ROOT, rel), 'utf8');

describe('the package is installable as a Hermes plugin', () => {
  test('plugin.yaml exists at the repo root with the expected name', async () => {
    await access(path.join(ROOT, 'plugin.yaml'));
    const manifest = await read('plugin.yaml');
    assert.match(manifest, /^name: euthyna$/m, 'the installer keys the plugin on this name');
    assert.match(manifest, /^license: Apache-2\.0$/m);
  });

  test('__init__.py exists beside it and registers the slash command', async () => {
    const py = await read('__init__.py');
    assert.match(py, /def register\(ctx\)/, 'Hermes imports __init__.py and calls register(ctx)');
    assert.match(py, /ctx\.register_command\(\s*\n?\s*"euthyna"/, 'the in-session command is /euthyna');
  });

  test('the CLI subcommands the slash command forwards to are exactly the ones bin/euthyna.js dispatches', async () => {
    const py = await read('__init__.py');
    const cli = await read('src/cli.js');
    const declared = [...py.matchAll(/"(\w+)"/g)].map((m) => m[1])
      .filter((w) => ['history', 'coverage', 'deps', 'gate'].includes(w));
    for (const sub of ['history', 'coverage', 'deps', 'gate']) {
      assert.ok(declared.includes(sub), `/euthyna forwards ${sub}`);
      assert.match(cli, new RegExp(`command === '${sub}'`), `the CLI dispatches ${sub}`);
    }
  });

  test('the npm tarball carries both plugin files', async () => {
    const pkg = JSON.parse(await read('package.json'));
    assert.ok(pkg.files.includes('plugin.yaml'), 'plugin.yaml must ship in the package');
    assert.ok(pkg.files.includes('__init__.py'), '__init__.py must ship in the package');
  });
});
