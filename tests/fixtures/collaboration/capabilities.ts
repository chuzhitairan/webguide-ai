import type { AdapterCapabilities, Capabilities } from '../../../packages/contracts/src/types.js';

export const fixtureOrigins = ['http://127.0.0.1:43131', 'http://127.0.0.1:43132'] as const;

const fileRoles = ['repository-file', 'file-editor'];
const prRoles = ['pull-request', 'pull-request-files', 'pull-request-commits'];
const prFormScope = {
  readRoles: ['comparison', ...prRoles],
  observationKinds: ['fixture.comparison', 'fixture.pr', 'fixture.diff', 'fixture.pr-commits'],
};
const adapter: AdapterCapabilities = {
  parameterProfiles: ['fixture_collaboration_v1'],
  roles: ['issue', 'repository-branch', ...fileRoles, 'commit', 'comparison', ...prRoles],
  locatorIds: [
    'issue-summary', 'assignees-or-assigned-status', 'branch-menu', 'branch-name',
    'create-branch-or-branch-status', 'edit-file', 'document-editor', 'commit-or-saved-status',
    'comparison-summary', 'pr-description', 'create-pr-or-existing-link', 'pr-summary',
  ].map(id => 'fixture.' + id),
  checkers: {
    'fixture.issue-context': { readRoles: ['issue'], observationKinds: ['fixture.issue'] },
    'fixture.issue-assigned': { readRoles: ['issue'], observationKinds: ['fixture.issue'] },
    'fixture.branch-form': { readRoles: ['repository-branch'], observationKinds: ['fixture.branch'] },
    'fixture.branch-name-ready': { readRoles: ['repository-branch'], observationKinds: ['fixture.branch'] },
    'fixture.branch-ready': { readRoles: ['repository-branch'], observationKinds: ['fixture.branch'] },
    'fixture.editor-open': { readRoles: fileRoles, observationKinds: ['fixture.file', 'fixture.editor'] },
    'fixture.edit-context': { readRoles: fileRoles, observationKinds: ['fixture.file', 'fixture.editor'] },
    'fixture.commit-saved': { readRoles: [...fileRoles, 'commit'], observationKinds: ['fixture.file', 'fixture.commit', 'fixture.editor'] },
    // 从任一步恢复到 Draft，都能读取 PR 的文件差异和提交列表。
    'fixture.comparison-ready': prFormScope,
    'fixture.pr-description-ready': prFormScope,
    'fixture.pr-created': prFormScope,
    'fixture.pr-handoff': { readRoles: ['issue', 'repository-file', 'commit', ...prRoles], observationKinds: ['fixture.issue', 'fixture.file', 'fixture.commit', 'fixture.pr', 'fixture.diff', 'fixture.pr-commits'] },
  },
  finalVerifierIds: ['fixture.pr-handoff'],
};

export const fixtureCapabilities: Capabilities = {
  mode: 'runtime',
  adapters: { fixture_collaboration_v1: adapter },
};
