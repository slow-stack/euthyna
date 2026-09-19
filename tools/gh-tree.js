// List a GitHub repo tree (recursive) through the local proxy CONNECT tunnel.
const http = require('http');
const https = require('https');

const PROXY = { host: '127.0.0.1', port: 7897 };

function get(target, path) {
  return new Promise((resolve, reject) => {
    const cr = http.request({
      host: PROXY.host, port: PROXY.port, method: 'CONNECT',
      path: `${target}:443`, headers: { host: `${target}:443` },
    });
    cr.on('connect', (res, socket) => {
      if (res.statusCode !== 200) return reject(new Error(`CONNECT ${res.statusCode}`));
      const r = https.request(
        { socket, agent: false, servername: target, path, method: 'GET',
          headers: { host: target, 'user-agent': 'dsh-research', accept: 'application/vnd.github+json' } },
        (resp) => {
          const chunks = [];
          resp.on('data', (c) => chunks.push(c));
          resp.on('end', () => resolve({ status: resp.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
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
  for (const repo of process.argv.slice(2)) {
    console.log(`\n########## ${repo}`);
    const res = await get('api.github.com', `/repos/${repo}/git/trees/HEAD?recursive=1`);
    if (res.status !== 200) { console.log(`  HTTP ${res.status}`); continue; }
    const j = JSON.parse(res.body);
    const files = j.tree.filter((t) => t.type === 'blob');
    const byExt = {};
    for (const f of files) {
      const ext = (f.path.match(/\.[a-z0-9]+$/i) || ['(none)'])[0].toLowerCase();
      byExt[ext] = byExt[ext] || { n: 0, bytes: 0 };
      byExt[ext].n++;
      byExt[ext].bytes += f.size || 0;
    }
    console.log(`  total files=${files.length} truncated=${j.truncated}`);
    console.log('  --- by extension (count, KB) ---');
    for (const [ext, v] of Object.entries(byExt).sort((a, b) => b[1].bytes - a[1].bytes)) {
      console.log(`    ${ext.padEnd(10)} ${String(v.n).padStart(4)}  ${(v.bytes / 1024).toFixed(1)} KB`);
    }
    console.log('  --- top-level tree ---');
    const seen = new Set();
    for (const f of files) {
      const top = f.path.split('/').slice(0, 2).join('/');
      if (seen.has(top)) continue;
      seen.add(top);
      if (seen.size <= 45) console.log(`    ${f.path}`);
    }
  }
})();
