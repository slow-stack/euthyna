/**
 * The Hermes plugin surface: plugin.yaml + __init__.py at the repo root are what
 * `hermes plugins install slow-stack/euthyna` discovers (the discovery reads
 * `<root>/plugin.yaml`), and the /euthyna slash command forwards to the CLI's
 * dispatched subcommands. A CLI subcommand rename or a newly dispatched command
 * is the harmless-looking change that breaks the command silently — this pins
 * the two together, and pins the files the npm tarball must carry.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cliSubcommands } from './cli-commands.js';

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

  test('the subcommands /euthyna forwards are exactly the ones the CLI dispatches', async () => {
    const py = await read('__init__.py');
    // Derived, not hand-written: a whitelist here is what let `audit` ship in
    // 0.4.0 without this guard noticing. The tuple is read wherever the handler
    // keeps it today, so the comparison fails on the real gap rather than on the
    // absence of a marker.
    const tuple = /_FORWARDS = \(([^)]*)\)/s.exec(py)?.[1] ?? /\bnot in \(([^)]*)\)/.exec(py)?.[1];
    assert.ok(tuple, 'the handler declares the subcommands it forwards in one tuple');
    const forwarded = [...tuple.matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]).sort();
    const dispatched = await cliSubcommands(ROOT);
    assert.ok(dispatched.length > 0, 'the dispatch list derived from src/cli.js');
    assert.deepEqual(forwarded, dispatched, 'every CLI command reachable from /euthyna, and nothing else');
  });

  test('the usage text names every subcommand the CLI dispatches', async () => {
    const py = await read('__init__.py');
    const usage = /_USAGE = """([\s\S]*?)"""/.exec(py)?.[1] ?? '';
    for (const sub of await cliSubcommands(ROOT)) {
      assert.ok(usage.includes(`/euthyna ${sub} `), `/euthyna ${sub} is documented in the usage text`);
    }
  });

  test('the npm tarball carries both plugin files', async () => {
    const pkg = JSON.parse(await read('package.json'));
    assert.ok(pkg.files.includes('plugin.yaml'), 'plugin.yaml must ship in the package');
    assert.ok(pkg.files.includes('__init__.py'), '__init__.py must ship in the package');
  });
});
