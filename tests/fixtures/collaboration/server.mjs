import { createServer } from 'node:http';
import { URL, URLSearchParams, pathToFileURL } from 'node:url';
import { createState, applyAction, canonicalComparison, renderPage } from './fixture-state.mjs';

const ports = [43131,43132], prefix = '/fixture-team/guide/';

function createHandler(state,port) {
  // 只服务自有回环页面。状态变动通过用户提交的表单，GET 只读取。
  const origin='http://127.0.0.1:'+port;
  return async (req,res)=>{
    const send=(code,body,headers={})=>{res.writeHead(code,{'cache-control':'no-store','content-type':'text/plain; charset=utf-8',...headers});res.end(body);};
    if (req.headers.host !== '127.0.0.1:'+port) {send(403,'未知请求来源');return;}
    try {
      const url=new URL(req.url,origin);
      if(url.origin!==origin){send(403,'未知请求来源');return;}
      if(req.method==='GET') {
        if (url.pathname==='/') {send(302,'',{location:prefix+'issue?number=1'});return;}
        const canonical=canonicalComparison(state,url);
        if(canonical){send(302,'',{location:canonical});return;}
        send(200,renderPage(state,url),{'content-type':'text/html; charset=utf-8'});return;
      }
      if(req.method==='POST' && url.pathname.startsWith(prefix+'action/')) {
        if (req.headers.origin && req.headers.origin !== origin) {send(403,'来源与模拟页不一致');return;}
        if (!req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) {send(415,'请使用模拟页表单');return;}
        const chunks=[];let size=0;
        for await(const chunk of req){size+=chunk.length;if(size>1024*1024){send(413,'表单过大');return;}chunks.push(chunk);}
        const location=applyAction(state,url.pathname.slice((prefix+'action/').length),new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
        send(303,'',{location});return;
      }
      send(404,'没有这个模拟入口');
    } catch (error) {send(req.method==='POST' ? 409 : 404,error.message);}
  };
}

// 两个端口必须都可用，不能悄悄改到另一来源。关闭会释放此实例创建的所有监听。
export async function startFixtureServers() {
  const state=createState(), servers=[];
  try {
    for(const port of ports) {
      const server=createServer(createHandler(state,port));
      await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
      servers.push(server);
    }
  } catch (error) {
    await Promise.all(servers.map(server=>new Promise(resolve=>server.close(resolve))));throw error;
  }
  return {close:()=>Promise.all(servers.map(server=>new Promise(resolve=>server.close(resolve))))};
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const running=await startFixtureServers();
    console.log('开发模拟已启动 http://127.0.0.1:43131/fixture-team/guide/issue?number=1 （43132 共用状态）');
    for(const signal of ['SIGTERM','SIGINT']) process.once(signal,()=>void running.close());
  } catch (error) {console.error('模拟服务启动失败：'+error.message);process.exitCode=1;}
}
