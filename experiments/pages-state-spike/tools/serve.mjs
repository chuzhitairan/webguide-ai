import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const types={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8'};
http.createServer(async(req,res)=>{
  try {
    if(req.method!=='GET'){res.writeHead(405).end();return;}
    const url=new URL(req.url,'http://127.0.0.1');
    const file=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/harness.html':url.pathname));
    if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    const ext=path.extname(file);if(!types[ext]){res.writeHead(404).end();return;}
    const data=await readFile(file);
    res.writeHead(200,{'Content-Type':types[ext],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end(data);
  } catch {res.writeHead(404).end();}
}).listen(4178,'127.0.0.1',()=>console.log('Preview: http://127.0.0.1:4178/harness.html (loopback only)'));
