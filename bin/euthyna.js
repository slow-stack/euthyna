#!/usr/bin/env node
/**
 * euthyna CLI entry point.
 *
 * Kept trivial on purpose: argument handling and exit codes live in src/cli.js
 * so they can be exercised by tests without spawning a process.
 */
import process from 'node:process';
import { main } from '../src/cli.js';

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  // An unexpected throw is a measurement failure, not a clean result. Saying so
  // is the whole point of having a distinct exit code for it.
  process.stderr.write(`euthyna: 测量过程抛出异常，结果不可用\n${error?.stack ?? error}\n`);
  process.exitCode = 2;
}
