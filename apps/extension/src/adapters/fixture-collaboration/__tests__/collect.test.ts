import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { CheckRequest, EvaluationInput } from '../../../../../../packages/contracts/src/types.js';
import { makeFixtureTarget } from '../../../../../../tests/fixtures/collaboration/cases.js';
import { identifyFixtureUrl } from '../capabilities.js';
import { collectFixture, matchesIssueReference } from '../collect.js';
import { evaluateFixtureCollaboration } from '../verify.js';

const target=makeFixtureTarget(), base='a'.repeat(40), head='b'.repeat(40);
const root='http://127.0.0.1:43131/fixture-team/guide/';
const source='开头\n\n'+target.expectedEdit.before+'\n';
const url=root+'file?base='+base+'&head='+head+'&side=base&path='+target.documentPath;
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
function makeDoc(address:string,role:string,body:string){
  return new JSDOM('<main data-fixture-role="'+role+'" data-repo="'+target.repo+'">'+body+'</main>',{url:address}).window.document;
}
function request(address:string,checker='fixture.commit-saved',locator='fixture.commit-or-saved-status'):CheckRequest{
  const page=identifyFixtureUrl(address,target)!;
  return {type:'CHECK_REQUEST',taskId:'one',coordinatorEpoch:'one',contextRevision:1,targetRevision:1,
    tutorialIdentity:{id:'fixture.collaboration.first-pr',version:'1',contentHash:'test'},bindingId:'one',documentId:'one',navigationRevision:0,
    requestId:'one',checkSequence:1,stepId:'commit-document',checkerId:checker,check:{type:'adapter',checkerId:checker},...page,target,targetSpec:{locatorId:locator}};
}
function sourceDoc(){
  const doc=makeDoc(url,'repository-file','<p id="commit-sha"></p><p id="file-path"></p><pre><code id="source"></code></pre>');
  doc.querySelector('#commit-sha')!.textContent=base;
  doc.querySelector('#file-path')!.textContent=target.documentPath;
  const code=doc.querySelector<HTMLElement>('#source')!;
  code.textContent=source;Object.assign(code.dataset,{view:'code',complete:'true',bytes:String(Buffer.byteLength(source)),lines:String(source.split('\n').length),trailingLf:'true'});
  return {doc,code};
}
describe('read only the bound visible fixture object',()=>{
  it('uses both loopback origins and rejects cross-origin, unrelated repo, role and key',()=>{
    expect(identifyFixtureUrl(url.replace('43131','43132'),target)?.objectKey).toBe(identifyFixtureUrl(url,target)?.objectKey);
    for(const from of [url.replace('127.0.0.1','localhost'),url.replace('43131','43133'),url.replace('guide/','other/'),url.replace(base,'abc'),url.replace('http:','https:')]){
      expect(identifyFixtureUrl(from,target)).toBeNull();
    }
    const {doc}=sourceDoc();
    expect(collectFixture({...request(url),objectKey:'other'},doc).status).not.toBe('ok');
    expect(collectFixture({...request(url),pageRole:'issue'},doc).status).not.toBe('ok');
  });
  it('locally computes both exact SHA256 summaries, preserves blank lines, returns no source',()=>{
    const {doc,code}=sourceDoc();code.textContent=source.replaceAll('\n','\r\n');code.dataset.bytes=String(Buffer.byteLength(code.textContent));
    const result=collectFixture(request(url),doc);
    expect(result).toMatchObject({status:'ok',kind:'fixture.file',payload:{side:'base',commitSha:base,beforeCount:1,markerAbsent:true,contentHash:digest(source),expectedHeadHash:digest(source.replace(target.expectedEdit.before,target.expectedEdit.after))}});
    expect(JSON.stringify(result)).not.toContain(target.expectedEdit.before);
    code.textContent=source.replace('\n\n',' \n\n');code.dataset.bytes=String(Buffer.byteLength(code.textContent));
    expect(collectFixture(request(url),doc).payload.contentHash).not.toBe(digest(source));
  });
  it.each(['preview','missing-line','trailing-lf','wrong-sha','over-limit','hidden'])('refuses %s source',condition=>{
    const {doc,code}=sourceDoc();
    if(condition==='preview')code.dataset.view='preview';
    if(condition==='missing-line')code.textContent=source.replace('\n\n','\n');
    if(condition==='trailing-lf')delete code.dataset.trailingLf;
    if(condition==='wrong-sha')doc.querySelector('#commit-sha')!.textContent=head;
    if(condition==='over-limit'){code.textContent='文'.repeat(44000)+'\n';code.dataset.bytes=String(Buffer.byteLength(code.textContent));code.dataset.lines='2';}
    if(condition==='hidden')code.hidden=true;
    expect(collectFixture(request(url),doc)).toMatchObject({status:'unknown'});
  });
  it('distinguishes ordinary issue references from code and other repositories',()=>{
    for(const body of ['处理 #1。','fixture-team/guide#1','https://github.com/fixture-team/guide/issues/1',root+'issue?number=1'])expect(matchesIssueReference(body,target)).toBe(true);
    for(const body of ['`#1`','~~~md\n#1\n~~~','other/team#1','https://github.com/other/team/issues/1','#12','https://example.com/foo#1','    #1'])expect(matchesIssueReference(body,target)).toBe(false);
  });
  it('guides correction or confirmation only for a readable destination, never counts dialog as saved',()=>{
    const address=root+'editor?branch='+target.headBranch+'&path='+target.documentPath;
    const doc=makeDoc(address,'file-editor','<span id="file-path"></span><span id="current-branch"></span><textarea id="document-editor"></textarea><form id="commit-form"><input id="commit-message" value="更新"><input type="radio" name="mode" id="commit-current" value="current-branch"><input type="radio" name="mode" id="commit-new" value="new-branch" checked><input id="new-branch-name" value="other"><button id="confirm-commit">提交</button></form>');
    doc.querySelector('#file-path')!.textContent=target.documentPath;doc.querySelector('#current-branch')!.textContent=target.headBranch;
    const edit=doc.querySelector('textarea')!;edit.defaultValue=target.expectedEdit.before+'\n';edit.value=target.expectedEdit.after+'\n';
    const req=request(address);
    const collect=()=>collectFixture(req,doc);
    expect(collect()).toMatchObject({payload:{commitMode:'new-branch',destinationBranch:'other'},location:{target:{css:'#commit-current'}}});
    doc.querySelector<HTMLInputElement>('#commit-current')!.checked=true;
    const result=collect();
    expect(result).toMatchObject({payload:{commitMode:'current-branch',destinationBranch:target.headBranch},location:{target:{css:'#confirm-commit'}}});
    const input:EvaluationInput={target,now:2,tutorialIdentity:req.tutorialIdentity,checkerId:req.checkerId,stepId:req.stepId,intent:'advance',final:false,locations:[result.location!],observations:[{...result,id:'one',taskId:'one',tutorialIdentity:req.tutorialIdentity,targetRevision:1,pageBindingId:'one',documentId:'one',navigationRevision:0,requestId:'one',observedAt:1,expiresAt:100,invalidatedReason:null}]};
    expect(evaluateFixtureCollaboration(input).status).toBe('actionable');
    doc.querySelector<HTMLInputElement>('#commit-current')!.checked=false;
    expect(collect().location?.target).toBeUndefined();
  });
});
