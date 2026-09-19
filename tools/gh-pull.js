// Batch-download raw files from a GitHub repo through the local proxy CONNECT tunnel.
// Usage: node gh-pull.js <owner/repo> <branch> <outDir> <path1> <path2> ...
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PROXY = { host: '127.0.0.1', port: 7897 };
const [repo, branch, outDir, ...files] = process.argv.slice(2);

function get(target, p) {
  return new Promise((resolve, reject) => {
    const cr = http.request({
      host: PROXY.host, port: PROXY.port, method: 'CONNECT',
      path: `${target}:443`, headers: { host: `${target}:443` },
    });
    cr.on('connect', (res, socket) => {
      if (res.statusCode !== 200) return reject(new Error(`CONNECT ${res.statusCode}`));
      const r = https.request(
        { socket, agent: false, servername: target, path: p, method: 'GET',
          headers: { host: target, 'user-agent': 'dsh-research' } },
        (resp) => {
          const chunks = [];
          resp.on('data', (c) => chunks.push(c));
          resp.on('end', () => resolve({ status: resp.statusCode, body: Buffer.concat(chunks) }));
        }
      );
      r.on('error', reject);
      r.end();
    });
    cr.on('error', reject);
    cr.end();
  });
}

(async () => {
  let ok = 0, fail = 0;
  for (const f of files) {
    const url = `/${repo}/${branch}/${f}`;
    try {
      const res = await get('raw.githubusercontent.com', url);
      if (res.status !== 200) { console.log(`FAIL ${res.status} ${f}`); fail++; continue; }
      const dest = path.join(outDir, f.replace(/[\/\\]/g, '__'));
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(dest, res.body);
      console.log(`OK ${String(res.body.length).padStart(7)} B  ${f}`);
      ok++;
    } catch (e) { console.log(`ERR ${f}: ${e.message}`); fail++; }
  }
  console.log(`\ndone: ok=${ok} fail=${fail} -> ${outDir}`);
})();
