import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const production = 'apps/extension/.output/chrome-mv3';
const manifest = JSON.parse(await readFile(join(production, 'manifest.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.ok(manifest.side_panel?.default_path && manifest.background?.service_worker);
assert.equal(manifest.host_permissions?.length ?? 0, 0);
assert.equal(manifest.content_scripts?.length ?? 0, 0);
for (const path of ['page-agent.js', 'assets/page-agent-style.css', 'sidepanel.html', manifest.background.service_worker]) {
  await readFile(join(production, path));
}

async function checkFolder(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await checkFolder(path);
    else if (/\.(?:js|html|json)$/.test(entry.name)) {
      const source = await readFile(path, 'utf8');
      assert.doesNotMatch(source, /fixture-team\/guide|fixture\.collaboration\.first-pr|127\.0\.0\.1/, path);
      assert.doesNotMatch(source, /\beval\s*\(|\bnew\s+Function\s*\(/, path);
    }
  }
}
await checkFolder(production);
console.log('生产包验证通过：入口完整，无模拟站点或运行时校验编译。');