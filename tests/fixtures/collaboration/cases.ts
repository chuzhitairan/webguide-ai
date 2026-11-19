import type { FixtureCollaborationTarget, TutorialVersion } from '../../../packages/contracts/src/types.js';
import tutorial from './tutorial.json' with { type: 'json' };
import { fixtureOrigins } from './capabilities.js';

export function makeTutorialText(patch?: Partial<TutorialVersion>): string {
  return JSON.stringify({ ...tutorial, ...patch });
}

export function makeFixtureTarget(patch?: Partial<FixtureCollaborationTarget>): FixtureCollaborationTarget {
  return {
    profile: 'fixture_collaboration_v1',
    targetRevision: 1,
    repo: 'fixture-team/guide',
    issueNumber: 1,
    member: 'fixture-user',
    baseBranch: 'main',
    headBranch: 'practice/first-pr-001',
    documentPath: 'docs/practice/first-pr.md',
    expectedEdit: {
      before: '待补充：我的协作说明。',
      after: '已完成协作练习 WG-FIXTURE-001。',
      practiceMarker: 'WG-FIXTURE-001',
    },
    branchStart: null,
    commitAnchor: null,
    prBinding: null,
    origins: [...fixtureOrigins],
    ...patch,
  };
}
