// 教程描述可读的提示和检查引用，实际功能由页面适配器注册。
export type TargetSpec = { locatorId: string } | { css: string; textEquals?: string };
export type StepCheck = { type: 'adapter'; checkerId: string }
  | { type: 'dom'; assertion: 'exists' | 'visible' | 'text-equals' | 'value-equals'; target?: TargetSpec; expected?: string };

export interface TutorialStep {
  id: string;
  pageRole: string;
  title: string;
  instruction: string;
  action: 'select' | 'click' | 'inspect' | 'wait' | 'input';
  target: TargetSpec;
  check: StepCheck;
  sourceIds: string[];
}

export interface TutorialVersion {
  schemaVersion: 1 | 2;
  tutorialId: string;
  version: string;
  title: string;
  goal: string;
  environment: { browsers: string[]; pageLanguages: string[]; instructionLanguage: string };
  adapterId: string;
  parameterProfile: string;
  sources: { id: string; title: string; url: string }[];
  steps: TutorialStep[];
  finalVerifierId: string;
}

export interface TutorialIdentity {
  id: string;
  version: string;
  contentHash: string;
}

export interface CheckerCapability {
  readRoles: readonly string[];
  observationKinds: readonly string[];
}
export interface AdapterCapabilities {
  parameterProfiles: readonly string[];
  roles: readonly string[];
  locatorIds: readonly string[];
  checkers: Readonly<Record<string, CheckerCapability>>;
  finalVerifierIds: readonly string[];
}
export interface Capabilities {
  mode: 'description' | 'runtime';
  adapters: Readonly<Record<string, AdapterCapabilities>>;
}

export interface ExpectedEdit { before: string; after: string; practiceMarker: string }
export interface CommitCandidate { sha: string; sourceObservationIds: string[] }
export interface CommitAnchor extends CommitCandidate { confirmedAt: number }
export interface PullRequestBinding { number: number; url: string; sourceObservationId: string }

interface CollaborationFields {
  targetRevision: number;
  repo: string;
  issueNumber: number;
  member: string;
  baseBranch: string;
  headBranch: string;
  documentPath: string;
  expectedEdit: ExpectedEdit;
  reviewer?: string;
  projectUrl?: string;
  branchStart: CommitCandidate | null;
  commitAnchor: CommitAnchor | null;
  prBinding: PullRequestBinding | null;
}
export interface CollaborationTarget extends CollaborationFields { profile: 'collaboration_pr_v1' }
export interface FixtureCollaborationTarget extends CollaborationFields {
  profile: 'fixture_collaboration_v1';
  origins: string[];
}
export interface PagesTarget {
  profile: 'pages_branch_v1';
  targetRevision: number;
  repo: string;
  branch: string;
  directory: string;
  intent: 'latest-branch' | 'specified-deployment';
  expectedContent: string;
  commitAnchor: CommitAnchor | null;
  siteBinding: { url: string; sourceObservationId: string } | null;
}
export type TaskTarget = PagesTarget | CollaborationTarget | FixtureCollaborationTarget;

export interface Owner { windowId: number; uiInstanceId: string }
export interface PageBinding {
  id: string;
  tabId: number;
  windowId: number;
  frameId: number;
  documentId: string;
  url: string;
  origin: string;
  pageRole: string;
  objectKey: string;
  navigationRevision: number;
}

export type TrustedSender = { kind: 'ui' } & Owner
  | { kind: 'page'; tabId: number; windowId: number; frameId: number; documentId: string; url: string }
  | { kind: 'system' };

export interface RequestIdentity {
  coordinatorEpoch: string;
  taskId: string;
  contextRevision: number;
  targetRevision: number;
  tutorialIdentity: TutorialIdentity;
  bindingId: string;
  documentId: string;
  navigationRevision: number;
  requestId: string;
  checkSequence: number;
}

export interface CheckRequest extends RequestIdentity {
  type: 'CHECK_REQUEST';
  stepId: string;
  checkerId: string;
  pageRole: string;
  objectKey: string;
  target: TaskTarget;
  targetSpec: TargetSpec;
  check: StepCheck;
}

export type LocationResult =
  | { status: 'found'; element: Element }
  | { status: 'missing' | 'ambiguous' | 'unavailable' };

export interface LocationSummary {
  status: 'found' | 'missing' | 'ambiguous' | 'unavailable';
  target?: TargetSpec;
  bindingId?: string;
}

export interface ObservationPayloadResult {
  status: 'ok' | 'unknown' | 'read-error';
  kind: string;
  objectKey: string;
  payload: Record<string, unknown>;
  location?: LocationSummary;
  reason?: string;
}

export interface Observation extends ObservationPayloadResult {
  id: string;
  taskId: string;
  targetRevision: number;
  tutorialIdentity: TutorialIdentity;
  pageBindingId: string;
  documentId: string;
  navigationRevision: number;
  requestId: string;
  observedAt: number;
  expiresAt: number;
  invalidatedReason: string | null;
}

export interface Decision {
  status: 'pass' | 'actionable' | 'wait' | 'blocked' | 'unknown';
  reasonCodes: string[];
  evidenceIds: string[];
  missing: string[];
  conflicts: string[];
  allowedNextStepId?: string;
  branchStart?: CommitCandidate;
  commitCandidate?: CommitCandidate;
  prCandidate?: PullRequestBinding;
}

export interface EvaluationInput {
  tutorialIdentity: TutorialIdentity;
  target: TaskTarget;
  stepId: string;
  checkerId: string;
  intent: 'advance' | 'review';
  final: boolean;
  observations: readonly Observation[];
  locations: readonly LocationSummary[];
  now: number;
}

export interface StopStatus {
  epoch: number;
  pendingBindings: string[];
  failedBindings: string[];
}

export interface SessionCheckpoint {
  checkpointSchema: 1;
  taskId: string;
  tutorial: TutorialIdentity;
  target: TaskTarget;
  state: 'ready' | 'checking' | 'guiding' | 'waiting' | 'blocked' | 'pending' | 'paused' | 'ended';
  result: 'system-verified' | 'user-confirmed' | 'incomplete' | null;
  endedReason: string | null;
  displayStepId: string;
  frontierStepId: string;
  navigationIntent: 'advance' | 'review';
  sessionRevision: number;
  contextRevision: number;
  evidenceRevision: number;
  owner: Owner | null;
  bindings: PageBinding[];
  observations: Observation[];
  stepChecks: Record<string, Decision>;
  decision: Decision | null;
  stopStatus: StopStatus;
  updatedAt: number;
}

export interface ShowGuide extends RequestIdentity {
  type: 'SHOW_GUIDE';
  target: TargetSpec;
  copy: { title: string; instruction: string };
  leaseMs: number;
}

export interface Stop {
  type: 'STOP';
  coordinatorEpoch: string;
  taskId: string;
  contextRevision: number;
  bindingId: string;
  documentId: string;
  stopEpoch: number;
  reason: string;
}

export interface CancelRequest extends RequestIdentity { type: 'CANCEL_REQUEST'; reason: string }
export type Effect = CheckRequest | ShowGuide | Stop | CancelRequest;

interface TaskCommand {
  taskId: string;
  coordinatorEpoch: string;
  messageId: string;
  expectedSessionRevision: number;
}
export type RuntimeEvent =
  | { type: 'USER_START'; coordinatorEpoch: string; messageId: string; tutorialId: string; version: string; target: TaskTarget }
  | ({ type: 'USER_CONTINUE' | 'USER_BACK' | 'USER_ADVANCE' | 'USER_RECHECK' | 'USER_PAUSE' | 'EXIT' } & TaskCommand)
  | ({ type: 'USER_CONFIRM_ANCHOR'; sha: string } & TaskCommand)
  | { type: 'UI_LOST' }
  | { type: 'PAGE_HELLO'; binding: PageBinding }
  | { type: 'PAGE_LOST'; bindingId: string }
  | { type: 'LOCATION_INVALIDATED'; request: RequestIdentity; reason: 'page-left' | 'target-changed' }
  | { type: 'CHECK_RESULT'; request: RequestIdentity; observation: ObservationPayloadResult }
  | { type: 'CHECK_TIMEOUT'; request: RequestIdentity }
  | { type: 'STOP_ACK'; coordinatorEpoch: string; taskId: string; bindingId: string; documentId: string; contextRevision: number; stopEpoch: number; status: 'stopped' | 'failed' };
