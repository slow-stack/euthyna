/**
 * The command names the CLI actually dispatches, read out of src/cli.js.
 *
 * Both parity guards restrict `euthyna <word>` mentions to real commands, and they
 * need the same list to mean the same thing: a hand-written whitelist in one of
 * them would let a newly dispatched command escape that guard's comparison while
 * the other guard still saw it.
 *
 * The derivation has to fail loudly. If the dispatch were re-written into a shape
 * this pattern does not read, the set would come back short or empty, every
 * mention would be filtered out of *both* sides of a comparison, and the guard
 * would pass on nothing. So both forms the repository could use are matched (a
 * `===` chain today, `case` if it becomes a switch), and skill-mirror.test.js
 * cross-checks the result against the command section of the CLI's own help, in
 * both languages — which turns even a *partial* miss into a red run.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function cliSubcommands(root) {
  const cli = await readFile(path.join(root, 'src/cli.js'), 'utf8');
  const names = [...cli.matchAll(/(?:command ===|case)\s*'([a-z][a-z0-9-]*)'/g)].map((m) => m[1]);
  return [...new Set(names)].sort();
}
