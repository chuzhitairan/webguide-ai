import {task} from './config.mjs';
import {collectPage} from './collector.mjs';
import {render} from './view.mjs';
const key = 'pages-spike-observations';
const inspect = document.getElementById('inspect');
const reset = document.getElementById('reset');
const notice = document.getElementById('notice');
let observations = [];
async function restore() {
  const stored = (await chrome.storage.session.get(key))[key];
  observations = Array.isArray(stored) ? stored.filter(s=>s.taskId===task.id && Date.now()-s.observedAt<=task.maxAgeMs) : [];
  render(observations,task);
}
inspect.addEventListener('click',async()=>{
  inspect.disabled=true;reset.disabled=true;
  notice.textContent='正在读取当前练习页面…';
  let attempted = null;
  try {
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
    const root=`https://github.com/${task.repository}`;
    const u = new URL(tab?.url || 'about:blank');
    const url=u.origin+u.pathname;
    if (!(url===task.site || url===`${root}/settings/pages` || new RegExp(`^https://github\\.com/${task.repository}/actions/runs/\\d+/?$`).test(url))) {
      notice.textContent='未读取：请打开指定练习仓库的 Pages 设置、工作流详情或测试站点。';return;
    }
    attempted = {taskId:task.id,url,kind:url===task.site?'site':url.endsWith('/settings/pages')?'settings':'workflow'};
    const [execution] = await chrome.scripting.executeScript({target:{tabId:tab.id},func:collectPage,args:[task],world:'ISOLATED'});
    const snapshot=execution?.result;
    if (!snapshot || snapshot.kind==='unsupported') throw new Error('unsupported');
    observations = observations.filter(s=>s.kind!==snapshot.kind && Date.now()-s.observedAt<=task.maxAgeMs);
    observations.push(snapshot);
    await chrome.storage.session.set({[key]:observations});
    render(observations,task);
    notice.textContent='已读取本次页面；没有修改目标网站。';
  } catch {
    if (attempted) {
      observations=observations.filter(s=>s.kind!==attempted.kind);
      observations.push({...attempted,observedAt:Date.now(),readFailed:true});
      await chrome.storage.session.set({[key]:observations}).catch(()=>{});
    } else observations=[];
    notice.textContent='本次读取失败，对应状态待确认；请重新打开扩展再试。';
    render(observations,task);
  } finally {inspect.disabled=false;reset.disabled=false;}
});
reset.addEventListener('click',async()=>{
  observations=[];await chrome.storage.session.remove(key);render(observations,task);notice.textContent='观察已清空。';
});
restore().catch(()=>{notice.textContent='会话存储不可用，请重新加载扩展。';render([],task);});
