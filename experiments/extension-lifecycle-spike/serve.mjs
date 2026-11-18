import http from 'node:http';
import {readFile} from 'node:fs/promises';
const base = '/webguide-lifecycle/';
const routes = {43117: new Set(['settings.html', 'workflow.html']), 43118: new Set(['site.html'])};
const servers = [];
for (const port of [43117, 43118]) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const name = url.pathname.slice(base.length);
    if (req.method !== 'GET' || !url.pathname.startsWith(base) ||
        (!routes[port].has(name) && name !== 'fixture.js')) {
      res.writeHead(404).end('Not found'); return;
    }
    try {
      const file = name === 'fixture.js' ? name : 'fixture.html';
      let data = await readFile(new URL(`./fixtures/${file}`, import.meta.url), 'utf8');
      if (file === 'fixture.html') data = data.replaceAll('{{ROLE}}', name.replace('.html', ''));
      res.writeHead(200, {'Content-Type': file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8',
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}).end(data);
    } catch { res.writeHead(500).end('Fixture read failed'); }
  });
  server.on('error', (error) => { console.error(`Local fixture ${port}: ${error.message}`); process.exitCode = 1;
    for (const s of servers) s.close(); });
  servers.push(server);
  server.listen(port, '127.0.0.1', () => console.log(`Fixture: http://127.0.0.1:${port}${base}${[...routes[port]][0]}`));
}
process.on('SIGINT', () => { for (const s of servers) s.close(); });
