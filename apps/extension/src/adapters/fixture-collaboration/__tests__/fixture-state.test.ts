import { describe, expect, it } from 'vitest';
// @ts-expect-error The fixture is also a standalone Node server, written in native ESM.
import { createState, applyAction, renderPage } from '../../../../../../tests/fixtures/collaboration/fixture-state.mjs';
const repo='http://127.0.0.1:43131/fixture-team/guide/';
describe('shared simulated repository',()=>{
  it('creates an immutable new version only on the user commit and binds a PR only after creation',()=>{
    const s=createState(),branch='practice/first-pr-001',path='docs/practice/first-pr.md';
    const post=(act:string,form:Record<string,string>)=>applyAction(s,act,new URLSearchParams(form));
    const page=(href:string)=>renderPage(s,new URL(href,repo));
    expect(page(repo+'issue?number=1')).toContain('id="assign"');
    post('assign',{});post('branch',{branch,source:'main'});
    expect(page(repo+'file?branch='+branch+'&path='+path)).toContain('待补充：我的协作说明。');
    const change=post('commit',{branch,path,mode:'current-branch',message:'更新',content:'已完成协作练习 WG-FIXTURE-001。\n'});
    const sha=new URL(change,repo).searchParams.get('sha');
    expect(sha).toMatch(/^[a-f\d]{40}$/);
    const commit=page(change);
    expect(commit).toContain('id="head-source"');
    expect(commit).toContain('id="base-source"');
    expect(page(repo+'compare?base=main&head='+branch)).toContain('id="create-pr"');
    const pr=post('pr',{base:'main',head:branch,title:'文档练习',body:'关联 #1'});
    expect(page(pr)).toContain('id="pr-summary"');
    expect(page(new URL(pr,repo).href.replace('43131','43132'))).toContain('文档练习');
    expect(()=>post('pr',{base:'main',head:branch,title:'重复',body:'#1'})).toThrow();
  });
});
