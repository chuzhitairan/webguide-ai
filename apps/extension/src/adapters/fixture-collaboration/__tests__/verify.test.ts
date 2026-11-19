import { describe, expect, it } from 'vitest';
import type { EvaluationInput, Observation } from '../../../../../../packages/contracts/src/types.js';
import { makeFixtureTarget } from '../../../../../../tests/fixtures/collaboration/cases.js';
import { evaluateFixtureCollaboration } from '../verify.js';

const base = 'a'.repeat(40);
const head = 'b'.repeat(40);
const hash = 'c'.repeat(64);
const tutorial = { id: 'fixture.collaboration.first-pr', version: '1', contentHash: 'f'.repeat(64) };
const target = makeFixtureTarget({
  commitAnchor: { sha: head, sourceObservationIds: ['commit'], confirmedAt: 1 },
  prBinding: { number: 1, url: 'http://127.0.0.1:43131/fixture-team/guide/pr?number=1', sourceObservationId: 'pr' },
});
const path = target.documentPath;
const file = { oldPath: path, path, status: 'modified' };
function observation(kind: string, role: string, key: string[], payload: Record<string, unknown>): Observation {
  return {
    id: [kind,...key].join(':'), taskId: 'one', tutorialIdentity: tutorial, targetRevision: 1,
    pageBindingId: role, documentId: role, navigationRevision: 0, requestId: 'request',
    observedAt: 1, expiresAt: 100, invalidatedReason: null, status: 'ok', kind: 'fixture.' + kind,
    objectKey: JSON.stringify([target.repo,role,...key]), payload: {repo:target.repo,...payload},
  };
}
function current(): EvaluationInput {
  const pair = { baseSha: base, headSha: head };
  return {target, now: 10, tutorialIdentity:tutorial, stepId:'verify-handoff',checkerId:'fixture.pr-handoff',final:true,intent:'advance',locations:[], observations:[
    observation('issue','issue',['1'],{number:1,state:'open',assignees:[target.member],assigneesComplete:true,loggedInMember:target.member}),
    observation('commit','commit',[head],{sha:head,branchContext:target.headBranch,parentShas:[base],parentsComplete:true,path}),
    observation('file','repository-file',[base,head,path,'base'],{...pair,side:'base',path,commitSha:base,complete:true,byteLength:24,contentHash:'d'.repeat(64),beforeCount:1,markerAbsent:true,expectedHeadHash:hash}),
    observation('file','repository-file',[base,head,path,'head'],{...pair,side:'head',path,commitSha:head,complete:true,byteLength:32,contentHash:hash}),
    observation('pr','pull-request',['1'],{...pair,number:1,url:target.prBinding!.url,author:target.member,baseRepo:target.repo,headRepo:target.repo,baseBranch:target.baseBranch,headBranch:target.headBranch,state:'open',isDraft:false,issueReferenceMatches:true,reviewState:'unreviewed',checksState:'pending'}),
    observation('diff','pull-request-files',['1',base,head],{...pair,number:1,complete:true,fileCount:1,files:[file]}),
    observation('pr-commits','pull-request-commits',['1',head],{number:1,headSha:head,complete:true,commitShas:[head]}),
  ]};
}
function change(input: EvaluationInput, index:number, patch:Record<string,unknown>) {
  Object.assign(input.observations[index].payload,patch);
}
it('记录新分支起点，起点取自实际分支页的完整提交', () => {
  const branch = observation('branch', 'repository-branch', [target.headBranch], {
    branch: target.headBranch, sourceBranch: target.baseBranch, sourceSha: base,
    headSha: base, createdFromSource: true,
  });
  const input: EvaluationInput = {
    ...current(), target: makeFixtureTarget(), final: false, stepId: 'create-working-branch',
    checkerId: 'fixture.branch-ready', observations: [branch],
  };
  expect(evaluateFixtureCollaboration(input)).toMatchObject({
    status: 'pass', branchStart: { sha: base, sourceObservationIds: [branch.id] },
  });
  branch.payload.headSha = head;
  expect(evaluateFixtureCollaboration(input).branchStart).toBeUndefined();
});
describe('fixture PR 核对',()=>{
  it('uses all seven current evidence objects for a regular submitted PR',()=>{
    const input=current();
    const decision=evaluateFixtureCollaboration(input);
    expect(decision).toMatchObject({status:'pass',reasonCodes:['submission-verified']});
    expect(new Set(decision.evidenceIds)).toEqual(new Set(input.observations.map(o=>o.id)));
  });
  it.each([
    [0,{state:'closed'}], [0,{assignees:['someone']}], [0,{number:2}], [0,{assigneesComplete:false}],
    [1,{sha:head.slice(0,7)}], [1,{branchContext:'different'}], [1,{parentsComplete:false}],
    [2,{beforeCount:2}], [2,{markerAbsent:false}], [2,{path:'wrong.md'}], [3,{contentHash:'e'.repeat(64)}],
    [3,{byteLength:131073}], [3,{complete:false}], [3,{commitSha:base}],
    [4,{author:'other'}], [4,{headRepo:'other/guide'}], [4,{baseBranch:'other'}], [4,{headBranch:'other'}],
    [4,{issueReferenceMatches:false}], [4,{isDraft:true}], [4,{state:'closed'}], [4,{state:'merged'}],
    [4,{headSha:'d'.repeat(40)}], [4,{baseSha:'e'.repeat(40)}],
    [5,{complete:false}],[5,{files:[file,file],fileCount:2}],[5,{files:[{...file,status:'renamed'}]}],
    [6,{complete:false}],[6,{commitShas:[base]}],
  ] as [number,Record<string,unknown>][])('rejects contradictory evidence at %i %j',(index, patch)=>{
    const input=current(); change(input,index,patch);
    const d=evaluateFixtureCollaboration(input);
    expect(d.status).not.toBe('pass'); expect(d.reasonCodes).not.toContain('submission-verified');
  });
  it.each([
    ['changes-requested','pending',['review-changes-requested']],
    ['approved','failed',['checks-failed']],
    ['changes-requested','failed',['review-changes-requested','checks-failed']],
  ] as [string,string,string[]][])('SC02-AC09 retains verified submission while handoff is blocked', (reviewState,checksState,reasons)=>{
    const input=current();change(input,4,{reviewState,checksState});
    expect(evaluateFixtureCollaboration(input)).toMatchObject({status:'blocked',reasonCodes:expect.arrayContaining(['submission-verified',...reasons]),evidenceIds:expect.arrayContaining(input.observations.map(o=>o.id))});
    input.observations[2].expiresAt=9;
    expect(evaluateFixtureCollaboration(input).reasonCodes).not.toContain('submission-verified');
  });
  it('requires an explicitly confirmed saved anchor and an actual bound PR',()=>{
    for(const patch of [{commitAnchor:null},{prBinding:null}]){
      const input=current();input.target={...target,...patch};
      expect(evaluateFixtureCollaboration(input).reasonCodes).not.toContain('submission-verified');
    }
  });
  it('new failed read displaces success and a different PR cannot supply its file list',()=>{
    const input=current();const previous=input.observations[5];
    input.observations=[...input.observations,{...previous,id:'failed',observedAt:2,status:'read-error',payload:{}}];
    expect(evaluateFixtureCollaboration(input).status).toBe('unknown');
    input.observations=[...current().observations];
    input.observations[5].objectKey=JSON.stringify([target.repo,'pull-request-files','2',base,head]);
    expect(evaluateFixtureCollaboration(input).status).toBe('unknown');
  });
});
