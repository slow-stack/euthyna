// Verify that LICENSE is the canonical Apache-2.0 text.
//
// Why this is a script rather than a sentence in NOTICE.md: "this project uses
// Apache-2.0" is a claim anyone can repeat, and a licence file that has been
// edited - even by one line - is no longer the licence it names. Comparing it
// against the upstream text keeps the claim falsifiable instead of asserted.
//
// One difference is expected and correct: the appendix copyright placeholder
// `[yyyy] [name of copyright owner]`, which this project fills in with its own
// attribution. Every other line must match the canonical text exactly.
//
// Run: node tools/check-license-text.mjs [--file <path>]
//
// `--file` defaults to the LICENSE at the repository root. It exists so the
// failure paths can be exercised against a deliberately altered copy: a checker
// that has never been observed to fail has not been verified in the half that
// matters.
//
// Exit codes:
//   0  verified - the only difference is the copyright line
//   1  differs from the canonical text; every differing line is printed
//   2  could not verify (the fetch failed). This is NOT a pass - see the exit
//      code contract in src/cli.js for why "could not measure" is kept distinct
//      from "clean".
//
// Requires the local proxy (see the pitfall table in AGENTS.md). Override with
// EUTHYNA_PROXY=host:port if the tunnel listens elsewhere.

import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const UPSTREAM_HOST = 'www.apache.org';
const UPSTREAM_PATH = '/licenses/LICENSE-2.0.txt';

const EXIT = { VERIFIED: 0, DIFFERS: 1, UNVERIFIED: 2 };

const [proxyHost, proxyPort] = (process.env.EUTHYNA_PROXY ?? '127.0.0.1:7897').split(':');

/**
 * GET through the local CONNECT tunnel.
 *
 * Node's global fetch cannot use this tunnel without an undici dispatcher, and
 * a direct connection fails here: DNS is fake-ip, so upstream hostnames resolve
 * to 198.18.x.x and the request never leaves the machine.
 */
function get(target, requestPath) {
  return new Promise((resolve, reject) => {
    const connect = httpRequest({
      host: proxyHost,
      port: Number(proxyPort),
      method: 'CONNECT',
      path: `${target}:443`,
      headers: { host: `${target}:443` }
    });
    connect.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`proxy CONNECT returned ${res.statusCode}`));
      }
      const req = httpsRequest(
        {
          socket,
          agent: false,
          servername: target,
          path: requestPath,
          method: 'GET',
          headers: { host: target, 'user-agent': 'euthyna-check-license-text' }
        },
        (resp) => {
          const chunks = [];
          resp.on('data', (c) => chunks.push(c));
          resp.on('end', () =>
            resolve({ status: resp.statusCode, body: Buffer.concat(chunks) })
          );
        }
      );
      req.on('error', reject);
      req.end();
    });
    connect.on('error', reject);
    connect.setTimeout(30000, () => connect.destroy(new Error('proxy connect timeout')));
    connect.end();
  });
}

/** The appendix line that names the copyright holder; the one line we may change. */
const isCopyrightLine = (line) => /^ {3}Copyright \S/.test(line ?? '');

async function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');

  const fileArg = process.argv.indexOf('--file');
  const licensePath =
    fileArg >= 0 && process.argv[fileArg + 1] ? resolve(process.argv[fileArg + 1]) : join(root, 'LICENSE');

  let upstreamRaw;
  try {
    const res = await get(UPSTREAM_HOST, UPSTREAM_PATH);
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    upstreamRaw = res.body.toString('utf8');
  } catch (error) {
    process.stderr.write(
      `无法验证 LICENSE：取不到官方原文（${error.message}）\n` +
        `这不是通过。代理默认 127.0.0.1:7897，可用 EUTHYNA_PROXY=host:port 覆盖。\n`
    );
    return EXIT.UNVERIFIED;
  }

  const localRaw = readFileSync(licensePath, 'utf8');

  // Compare with line endings normalised. A checkout may be CRLF while the
  // canonical file and the git blob are LF; that difference is not a licence
  // difference, and .gitattributes pins checkouts to LF anyway.
  const upstream = upstreamRaw.replace(/\r\n/g, '\n');
  const local = localRaw.replace(/\r\n/g, '\n');

  const a = upstream.split('\n');
  const b = local.split('\n');

  const differs = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) differs.push(i);
  }

  const wrapper = (k, v) => String(k).padEnd(22) + v;
  process.stdout.write(wrapper('官方原文', `https://${UPSTREAM_HOST}${UPSTREAM_PATH}`) + '\n');
  process.stdout.write(wrapper('本地文件', licensePath) + '\n');
  process.stdout.write(wrapper('官方原文字节', `${Buffer.byteLength(upstream)} (LF)`) + '\n');
  process.stdout.write(
    wrapper('本地 LICENSE 字节', `${Buffer.byteLength(local)} (LF), 检出为 ${localRaw.includes('\r\n') ? 'CRLF' : 'LF'}`) + '\n'
  );
  process.stdout.write(wrapper('行数', `官方 ${a.length} / 本地 ${b.length}`) + '\n\n');

  if (a.length !== b.length) {
    process.stderr.write(
      `行数不同（官方 ${a.length}，本地 ${b.length}），逐行比对没有意义。\n` +
        `本地 LICENSE 可能被删行或截断。\n`
    );
    return EXIT.DIFFERS;
  }

  const unexpected = differs.filter((i) => !isCopyrightLine(a[i]));
  const copyrightIndex = differs.find((i) => isCopyrightLine(a[i]));

  if (copyrightIndex === undefined) {
    process.stderr.write(
      `未找到被填写的版权行——附录里的占位符仍是官方原文，说明署名没有填进去。\n`
    );
    return EXIT.DIFFERS;
  }

  process.stdout.write(
    wrapper(
      `差异行 ${copyrightIndex + 1}`,
      `官方 ${JSON.stringify(a[copyrightIndex])}\n` +
        ' '.repeat(22) +
        `本地 ${JSON.stringify(b[copyrightIndex])}`
    ) + '\n'
  );

  const delta = Buffer.byteLength(local) - Buffer.byteLength(upstream);
  const explained =
    Buffer.byteLength(b[copyrightIndex]) - Buffer.byteLength(a[copyrightIndex]);
  process.stdout.write(wrapper('字节差', `${delta}，版权行长度差 ${explained}`) + '\n\n');

  if (unexpected.length > 0) {
    process.stderr.write(`除版权行外还有 ${unexpected.length} 行与官方原文不同：\n`);
    for (const i of unexpected.slice(0, 20)) {
      process.stderr.write(`  第 ${i + 1} 行\n`);
      process.stderr.write(`    官方: ${JSON.stringify(a[i])}\n`);
      process.stderr.write(`    本地: ${JSON.stringify(b[i])}\n`);
    }
    process.stderr.write('\n本文件已不是 Apache-2.0 原文，NOTICE.md 的许可声明不再成立。\n');
    return EXIT.DIFFERS;
  }

  if (delta !== explained) {
    process.stderr.write(
      `字节差 ${delta} 与版权行长度差 ${explained} 不符，说明还有未解释的差异。\n`
    );
    return EXIT.DIFFERS;
  }

  process.stdout.write(
    `VERIFIED — 除版权行外，LICENSE 与官方原文逐字节一致（${a.length} 行）。\n`
  );
  return EXIT.VERIFIED;
}

process.exitCode = await main();
