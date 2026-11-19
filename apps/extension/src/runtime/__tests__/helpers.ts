import type {
  Capabilities, CheckRequest, Decision, Effect, EvaluationInput, PageBinding, SessionCheckpoint,
  TrustedSender, TutorialVersion,
} from '@webguide/contracts';
import { vi } from 'vitest';
import { makeFixtureTarget } from '../../../../../tests/fixtures/collaboration/cases.js';
import { createCoordinator } from '../coordinator.js';

export const owner = { kind: 'ui', windowId: 1, uiInstanceId: 'panel-a' } as const;
export const binding: PageBinding = {
  id: 'binding-a', tabId: 2, windowId: 1, frameId: 0, documentId: 'doc-a',
  url: 'http://127.0.0.1:43131/issue', origin: 'http://127.0.0.1:43131',
  pageRole: 'issue', objectKey: 'fixture-team/guide#1', navigationRevision: 1,
};
export function page(b = binding): TrustedSender {
  return { kind: 'page', ...b };
}

export const identity = { id: 'sample', version: '1', contentHash: 'a'.repeat(64) };
const tutorial: TutorialVersion = {
  schemaVersion: 2, tutorialId: 'sample', version: '1', title: '示例', goal: '完成',
  environment: { browsers: [], pageLanguages: [], instructionLanguage: 'zh' }, sources: [],
  adapterId: 'fixture_collaboration_v1', parameterProfile: 'fixture_collaboration_v1',
  finalVerifierId: 'final',
  steps: ['read', 'submit'].map(id => ({
    id, title: id, instruction: '请核对页面', pageRole: 'issue', action: 'inspect',
    target: { locatorId: 'test' }, check: { type: 'adapter', checkerId: 'read' }, sourceIds: [],
  })),
};
const capabilities: Capabilities = {
  mode: 'runtime', adapters: {
    fixture_collaboration_v1: { roles: ['issue'], locatorIds: ['test'],
      parameterProfiles: ['fixture_collaboration_v1'], finalVerifierIds: ['final'],
      checkers: { read: { readRoles: ['issue'], observationKinds: ['issue'] } },
    },
  },
};

export function harness(initial: SessionCheckpoint[] = []) {
  const records = new Map(initial.map(record => [record.taskId, structuredClone(record)]));
  const store = {
    readAll: async () => [...records.values()].map(x => structuredClone(x)),
    write: async (record: SessionCheckpoint) => { records.set(record.taskId, structuredClone(record)); },
    remove: async (id: string) => { records.delete(id); },
  };
  const effects: Effect[] = [];
  const publications: SessionCheckpoint[] = [];
  const evaluations: EvaluationInput[] = [];
  const decide = vi.fn((input: EvaluationInput): Decision => {
    const recent = input.observations.at(-1);
    const passed = recent?.payload.pass === true;
    return { status: passed ? 'pass' : recent ? 'actionable' : 'unknown',
      reasonCodes: [], evidenceIds: recent ? [recent.id] : [], missing: [], conflicts: [] };
  });
  let count = 0;
  const deps = {
    store, capabilities, clock: { now: () => Date.now() }, makeId: () => 'id-' + (++count),
    emit: (effect: Effect) => { effects.push(effect); },
    publish: (snapshot: SessionCheckpoint) => { publications.push(snapshot); },
    evaluate: (input: EvaluationInput) => { evaluations.push(input); return decide(input); },
    resolveTutorial: (id: string, version: string) =>
      id === identity.id && version === identity.version ? { identity, tutorial } : undefined,
  };
  const coordinator = createCoordinator(deps);
  const snap = () => coordinator.snapshot()!;
  const start = (marker = 'WG123') => coordinator.handle({
    type: 'USER_START', messageId: 'start-' + marker, coordinatorEpoch: coordinator.epoch,
    tutorialId: 'sample', version: '1', target: makeFixtureTarget({
      expectedEdit: { before: 'before', after: 'after ' + marker, practiceMarker: marker },
    }),
  }, owner);
  const hello = (b = binding) => coordinator.handle({ type: 'PAGE_HELLO', binding: b }, page(b));
  const command = (type: 'USER_PAUSE' | 'USER_BACK' | 'USER_CONTINUE' | 'USER_RECHECK' | 'USER_ADVANCE' | 'EXIT',
    sender: TrustedSender = owner, revision = snap().sessionRevision) =>
    coordinator.handle({ type, coordinatorEpoch: coordinator.epoch, messageId: 'cmd-' + (++count),
      taskId: snap().taskId, expectedSessionRevision: revision }, sender);
  const request = () => effects.filter((e): e is CheckRequest => e.type === 'CHECK_REQUEST').at(-1)!;
  const result = (pass = false, status: 'ok' | 'read-error' = 'ok', req = request(), sender = page()) =>
    coordinator.handle({ type: 'CHECK_RESULT', request: req, observation: {
      kind: 'issue', objectKey: req.objectKey, status, payload: { pass }, location: { status: 'found' },
    } }, sender);
  return { coordinator, records, store, deps, effects, publications, evaluations, decide,
    start, snap, hello, command, request, result };
}
