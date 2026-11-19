import { readFileSync } from 'node:fs';

const repo = 'fixture-team/guide', prefix = '/' + repo + '/';
const member = 'fixture-user', path = 'docs/practice/first-pr.md', initialSha = 'a'.repeat(40);
const templates = Object.fromEntries(['issue','repository','file','editor','commit','compare','pr'].map(name =>
  [name,readFileSync(new URL('./' + name + '.html',import.meta.url),'utf8')]));
const escape = value => String(value).replace(/[&<>"'\r]/g,char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','\r':'&#13;'}[char]));
const href = (route,params) => prefix + route + '?' + new URLSearchParams(params);
const link = (id,label,url) => '<a id="' + id + '" href="' + escape(url) + '">' + label + '</a>';
const items = list => list.map(value=>'<li>'+escape(value)+'</li>').join('');
const version = (s,sha) => {const v=s.versions.get(sha); if (!v) throw Error('没有这次提交'); return v;};
const branch = (s,name) => {const b=s.branches.get(name); if (!b) throw Error('没有这个分支'); return b;};
const checked = (condition,message) => {if (!condition) throw Error(message);};

// 两个端口使用同一份内存仓库。版本表只追加；输入框的临时内容只存在用户当前页面中。
export function createState() {
  return {assigned:false, sequence:0, branches:new Map([['main',{sha:initialSha,source:'main',sourceSha:initialSha}]]),
    versions:new Map([[initialSha,{parent:null,branch:'main',path,content:'待补充：我的协作说明。\n'}]]),prs:new Map()};
}

export function applyAction(s,action,form) {
  const field = k => form.get(k) ?? '';
  if (action === 'assign') {
    s.assigned=true;
    return href('issue',{number:1});
  }
  if (action === 'branch') {
    const name=field('branch'), source=field('source'), from=branch(s,source);
    checked(name.trim() && !s.branches.has(name),'分支名为空或已存在');
    s.branches.set(name,{sha:from.sha,source,sourceSha:from.sha});
    return href('repository',{branch:name});
  }
  if (action === 'commit') {
    const original=field('branch'), from=branch(s,original), mode=field('mode');
    checked(field('path')===path && field('message').trim() && ['current-branch','new-branch'].includes(mode),'请核对文档和提交表单');
    checked(!field('previous') || field('previous')===from.sha,'当前分支已经更新，请重新核对');
    const dest=mode==='current-branch' ? original : field('newBranch'), previous=from.sha;
    if (mode==='new-branch') {
      checked(dest.trim() && !s.branches.has(dest),'新分支名称已存在或为空');
      s.branches.set(dest,{sha:previous,source:original,sourceSha:previous});
    }
    const sha=(++s.sequence).toString(16).padStart(40,'0');
    // HTML 表单把换行编码成 CRLF。夹具使用 LF 保存 Markdown，提交号只用于本机重复试验。
    const content=field('content').replaceAll('\r\n','\n');
    s.versions.set(sha,{parent:previous,branch:dest,path,content}); branch(s,dest).sha=sha;
    return href('commit',{sha});
  }
  if (action === 'pr') {
    const base=field('base'),head=field('head'); branch(s,base);branch(s,head);
    checked(base!==head && field('title').trim(),'请核对 PR 标题和分支');
    checked(![...s.prs.values()].some(p=>p.base===base && p.head===head),'此分支对已有 PR，请打开现有结果');
    const number=s.prs.size+1;
    s.prs.set(number,{number,base,head,author:member,title:field('title'),body:field('body'),draft:field('draft')==='on',state:'open',review:'unreviewed',checks:'pending'});
    return href('pr',{number});
  }
  if (action==='ready' || action==='pr-settings') {
    const number=Number(field('number')), pr=s.prs.get(number);checked(pr,'找不到此 PR');
    if (action==='ready') pr.draft=false;
    else {
      const base=field('base'),head=field('head'),state=field('state'),review=field('review'),checks=field('checks');
      branch(s,base);branch(s,head);
      checked(['open','closed','merged'].includes(state) && ['unreviewed','approved','changes-requested'].includes(review)
        && ['pending','passed','failed'].includes(checks),'无法识别模拟状态');
      Object.assign(pr,{base,head,state,review,checks,draft:field('draft')==='on'});
    }
    return href('pr',{number});
  }
  throw Error('未知模拟操作');
}

function lists(s,baseSha,headSha) {
  const before=version(s,baseSha), after=version(s,headSha), changed=before.content !== after.content;
  const ancestors=new Set(); for(let k=baseSha;k;k=version(s,k).parent) ancestors.add(k);
  const commits=[]; for(let k=headSha;k && !ancestors.has(k);k=version(s,k).parent) commits.push(k);
  return {files:'<p>文件数 <span id="file-count">'+Number(changed)+'</span></p><ul id="files" data-complete="true">'
    +(changed ? '<li data-status="modified" data-path="'+path+'" data-old-path="'+path+'">修改 '+path+'</li>' : '')+'</ul>',
    commits:'<ul id="commits" data-complete="true">'+items(commits)+'</ul>'};
}
function sources(base,head) {
  return '<nav aria-label="不可变源码">'+link('base-source','查看 base 的 Code 源码',href('file',{base,head,path,side:'base'}))+' · '
    +link('head-source','查看 head 的 Code 源码',href('file',{base,head,path,side:'head'}))+'</nav>';
}
function comparisonUrl(s,base,head) {return href('compare',{base,head,baseSha:branch(s,base).sha,headSha:branch(s,head).sha});}
export function canonicalComparison(s,url) {
  if (url.pathname !== prefix+'compare') return null;
  const base=url.searchParams.get('base'),head=url.searchParams.get('head'), canonical=comparisonUrl(s,base,head);
  return url.searchParams.get('baseSha') === branch(s,base).sha && url.searchParams.get('headSha') === branch(s,head).sha ? null : canonical;
}
function tips(base,head,baseSha,headSha) {
  return '<dl><dt>基准分支</dt><dd id="base-branch">'+escape(base)+'</dd><dt>工作分支</dt><dd id="head-branch">'+escape(head)
    +'</dd><dt>base SHA</dt><dd id="base-sha">'+baseSha+'</dd><dt>head SHA</dt><dd id="head-sha">'+headSha+'</dd></dl>';
}
function options(values,current) {return [...values].map(v=>'<option'+(v===current?' selected':'')+'>'+escape(v)+'</option>').join('');}
function render(s,url) {
  const route=url.pathname.slice(prefix.length), p=url.searchParams, param=k=>p.get(k)??'';
  const h=(name)=>escape(param(name));
  if(route==='issue'){
    checked(param('number')==='1','没有这个 Issue');
    return ['issue','issue',{assignees:s.assigned?items([member]):'',assign:s.assigned?'':'<form method="post" action="action/assign"><button id="assign">认领任务 · Assign yourself</button></form>',repository:href('repository',{branch:'main'})}];
  }
  if(route==='repository'){
    const name=param('branch'), b=branch(s,name);
    return ['repository','repository-branch',{branch:escape(name),sha:b.sha,sourceBranch:escape(b.source),sourceSha:b.sourceSha,
      status:name==='main'?'':'<p id="branch-status">分支已创建</p>',branches:items(s.branches.keys ? [...s.branches.keys()] : []),fileUrl:escape(href('file',{branch:name,path}))}];
  }
  if(route==='editor' || route==='file'){
    checked(param('path')===path,'没有这个文件'); const name=param('branch'), side=param('side');
    const sha=name ? branch(s,name).sha : param(side); const v=version(s,sha);
    if(route==='editor'){
      checked(name,'编辑必须使用分支');return ['editor','file-editor',{branch:escape(name),path,sha,content:escape(v.content)}];
    }
    if(!name){checked(['base','head'].includes(side),'缺少版本方向');version(s,param('base'));version(s,param('head'));}
    const preview=new URL(url), code=new URL(url);
    preview.searchParams.set('view','preview');code.searchParams.delete('view');
    const source=param('view')==='preview'?'<article id="preview"><h2>Markdown Preview</h2><p>'+escape(v.content)+'</p></article>':
      '<pre><code id="source" data-view="code" data-complete="true" data-bytes="'+Buffer.byteLength(v.content)
      +'" data-lines="'+v.content.split('\n').length+'" data-trailing-lf="'+String(v.content.endsWith('\n'))+'">'+escape(v.content)+'</code></pre>';
    return ['file','repository-file',{path,sha,source,branchLabel:name?'<p>当前分支 <span id="current-branch">'+escape(name)+'</span></p>':'',
      views:link('code-view','Code',code.pathname+code.search)+' · '+link('preview-view','Preview',preview.pathname+preview.search),
      actions:name?link('edit-file','编辑文档',href('editor',{branch:name,path})):''}];
  }
  if(route==='commit'){
    const sha=param('sha'),v=version(s,sha);checked(v.parent,'初始提交没有父版本');
    return ['commit','commit',{sha,branch:escape(v.branch),path,parents:items([v.parent]),sources:sources(v.parent,sha),compare:escape(comparisonUrl(s,'main',v.branch))}];
  }
  if(route==='compare'){
    const base=param('base'),head=param('head'),baseSha=branch(s,base).sha,headSha=branch(s,head).sha;
    const existing=[...s.prs.values()].find(pr=>pr.base===base && pr.head===head);
    const form=existing?link('existing-pr','查看实际 PR',href('pr',{number:existing.number})):
      '<form method="post" action="action/pr"><input type="hidden" name="base" value="'+h('base')+'"><input type="hidden" name="head" value="'+h('head')
      +'"><label>PR 标题 <input name="title" id="pr-title" required></label><label>PR 说明 <textarea name="body" id="pr-body" rows="3"></textarea></label><label><input name="draft" type="checkbox"> 创建草稿 Draft</label><button id="create-pr">创建 PR</button></form>';
    return ['compare','comparison',{tips:tips(base,head,baseSha,headSha),...lists(s,baseSha,headSha),sources:sources(baseSha,headSha),form}];
  }
  const number=Number(param('number')), pr=s.prs.get(number);checked(pr,'找不到此 PR');
  const baseSha=branch(s,pr.base).sha,headSha=branch(s,pr.head).sha, summary=tips(pr.base,pr.head,baseSha,headSha);
  if (route==='pr-files' || route==='pr-commits') {
    checked(param('head')===headSha && (route!=='pr-files' || param('base')===baseSha),'PR 版本已变更，请回到实际 PR 重新核对');
    const list=lists(s,baseSha,headSha);
    return ['pr',route==='pr-files'?'pull-request-files':'pull-request-commits',{title:route==='pr-files'?'文件变更':'提交记录',number,
      body:summary+(route==='pr-files'?list.files:list.commits)+sources(baseSha,headSha)+link('open-pr','返回实际 PR',href('pr',{number}))}];
  }
  checked(route==='pr','未知页面');
  const details=[['pr-author','作者',pr.author],['base-repo','基准仓库',repo],['head-repo','工作仓库',repo],['pr-state','PR 状态',pr.state],
    ['pr-type','PR 类型',pr.draft?'draft':'regular'],['review-state','评审结果',pr.review],['checks-state','检查状态',pr.checks]];
  const controls='<details><summary>调整模拟 PR 状态</summary><form method="post" action="action/pr-settings"><input type="hidden" name="number" value="'+number+'">'
    +[['base','基准分支',s.branches.keys(),pr.base],['head','工作分支',s.branches.keys(),pr.head],['state','PR 状态',['open','closed','merged'],pr.state],
    ['review','评审状态',['unreviewed','approved','changes-requested'],pr.review],['checks','检查结果',['pending','passed','failed'],pr.checks]]
    .map(([n,label,values,value])=>'<label>'+label+' <select name="'+n+'">'+options(values,value)+'</select></label>').join('')
    +'<label><input type="checkbox" name="draft"'+(pr.draft?' checked':'')+'> Draft</label><button>应用模拟状态</button></form></details>';
  return ['pr','pull-request',{title:escape(pr.title),number,body:summary+'<dl>'+details.map(([id,label,v])=>'<dt>'+label+'</dt><dd id="'+id+'">'+escape(v)+'</dd>').join('')+'</dl>'
    +'<h2>PR 说明</h2><p id="pr-description">'+escape(pr.body)+'</p><h2>评审请求</h2><ul id="review-requests"></ul><nav>'
    +link('pr-files','查看 PR 文件差异',href('pr-files',{number,base:baseSha,head:headSha}))+' · '+link('pr-commits','查看 PR 提交列表',href('pr-commits',{number,head:headSha}))+'</nav>'
    +sources(baseSha,headSha)+(pr.draft?'<form method="post" action="action/ready"><input type="hidden" name="number" value="'+number+'"><button id="ready-review">Ready for review</button></form>':'')+controls}];
}

export function renderPage(state,url) {
  checked(url.pathname.startsWith(prefix),'没有这个仓库');
  const [template,role,values]=render(state,url), content=templates[template].replace(/{{(\w+)}}/g,(_,key)=>values[key]);
  return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>协作练习 · WebGuide AI</title>'
    +'<style>body{font:16px/1.6 system-ui,sans-serif;color:#183449;background:#f5f7f9;margin:0}header,main{max-width:780px;margin:auto;padding:20px 32px}header{color:#376175;border-bottom:1px solid #cbdbe2}h1{font-size:28px}h2{font-size:19px}dt{font-weight:650}dd{overflow-wrap:anywhere}label,textarea{display:block;margin:.6em 0}button,input,select,textarea,summary{font:inherit}textarea{width:95%}button,summary,a{cursor:pointer}button{padding:5px 12px}nav,fieldset,details,pre{margin:1em 0}nav a,a{color:#154e80}pre{white-space:pre-wrap;background:white;padding:16px}fieldset{border:1px solid #ccd5dc}details{padding:.5em 0}</style>'
    +'<header>WebGuide AI · 开发模拟 / '+repo+'</header><main data-fixture-role="'+role+'" data-repo="'+repo+'">'+content+'</main></html>';
}
