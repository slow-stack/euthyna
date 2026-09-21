#!/usr/bin/env node
/**
 * euthyna CLI entry point.
 *
 * Kept trivial on purpose: argument handling and exit codes live in src/cli.js
 * so they can be exercised by tests without spawning a process.
 */
import process from 'node:process';
import { main } from '../src/cli.js';
import { safeTextLines } from '../src/contract.js';

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  // An unexpected throw is a measurement failure, not a clean result. Saying so
  // is the whole point of having a distinct exit code for it.
  //
  // stderr boundary: an error message inherits repo-controlled text (git embeds
  // filenames and refs in its stderr), so the stack is made terminal-safe at
  // this write, exactly once, like the report channel at its render boundary.
  process.stderr.write(
    safeTextLines(`euthyna: 测量过程抛出异常，结果不可用\n${error?.stack ?? error}\n`)
  );
  process.exitCode = 2;
}
