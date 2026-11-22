export interface Evidence {
  id: number;
  role: string;
  label: string;
  viewport: boolean;
  available: boolean;
  region?: number;
  expanded?: boolean;
  selected?: boolean;
  checked?: boolean;
  canScrollUp?: boolean;
  canScrollDown?: boolean;
}

export interface Observation {
  title: string;
  site: string;
  nodes: Evidence[];
  truncated: boolean;
}

export type ReadQuery =
  | { type: 'region'; id: number; includeOffscreen?: boolean }
  | { type: 'search'; query: string; region?: number }
  | { type: 'inspect'; id: number };

export interface ReadResult {
  query: ReadQuery;
  nodes: Evidence[];
  truncated: boolean;
  status: 'ok' | 'empty' | 'unavailable';
}

export interface EvidenceCheck {
  id: number;
  field: 'label' | 'selected' | 'checked' | 'expanded' | 'available' | 'viewport';
  equals: string | boolean;
}

export interface GuideRequest {
  goal: string;
  page: Observation;
  reads: ReadResult[];
  finishOnly: boolean;
  previous?: { instruction: string; target?: Evidence };
  feedback?: string;
  userAnswer?: string;
}

export type Decision =
  | { kind: 'observe'; queries: ReadQuery[] }
  | { kind: 'highlight'; targetId: number; instruction: string }
  | { kind: 'message'; instruction: string; scrollRegion?: number }
  | { kind: 'wait' | 'ask' | 'blocked'; instruction: string }
  | { kind: 'keep' }
  | { kind: 'complete'; instruction: string; targetId?: number; checks: EvidenceCheck[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}

function isId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isText(value: unknown, limit: number, allowBlank = true): value is string {
  return typeof value === 'string' && value.length <= limit && (allowBlank || value.trim().length > 0);
}

function isReadQuery(value: unknown): value is ReadQuery {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case 'region':
      return hasOnlyKeys(value, ['type', 'id', 'includeOffscreen']) && isId(value.id)
        && (value.includeOffscreen === undefined || typeof value.includeOffscreen === 'boolean');
    case 'search':
      return hasOnlyKeys(value, ['type', 'query', 'region']) && isText(value.query, 120, false)
        && (value.region === undefined || isId(value.region));
    case 'inspect':
      return hasOnlyKeys(value, ['type', 'id']) && isId(value.id);
    default:
      return false;
  }
}

function parseCheck(value: unknown): EvidenceCheck | undefined {
  if (!isRecord(value) || !isId(value.id)) return;
  const { id, field, equals } = value;
  switch (field) {
    case 'label':
      return isText(equals, 240) ? { id, field, equals } : undefined;
    case 'selected':
    case 'checked':
    case 'expanded':
    case 'available':
    case 'viewport':
      return typeof equals === 'boolean' ? { id, field, equals } : undefined;
  }
}

// 只从允许的字段重建决定。编号是否属于当前轮由调用方根据现场证据核对。
export function parseDecision(value: unknown): Decision | undefined {
  if (!isRecord(value)) return;
  const { kind, targetId } = value;
  if (kind === 'keep') return { kind };
  if (kind === 'observe') {
    const { queries } = value;
    if (Array.isArray(queries) && queries.length >= 1 && queries.length <= 3 && queries.every(isReadQuery)) {
      return { kind, queries };
    }
    return;
  }

  if (!isText(value.instruction, 500, false)) return;
  const instruction = value.instruction.trim();
  switch (kind) {
    case 'highlight':
      return isId(targetId) ? { kind, targetId, instruction } : undefined;
    case 'message': {
      const { scrollRegion } = value;
      if (scrollRegion === undefined) return { kind, instruction };
      return isId(scrollRegion) ? { kind, instruction, scrollRegion } : undefined;
    }
    case 'wait':
    case 'ask':
    case 'blocked':
      return { kind, instruction };
    case 'complete': {
      const { checks } = value;
      if (!Array.isArray(checks) || checks.length === 0 || checks.length > 8) return;
      if (targetId !== undefined && !isId(targetId)) return;
      const parsed = checks.map(parseCheck);
      if (!parsed.every(check => check !== undefined)) return;
      return targetId === undefined
        ? { kind, instruction, checks: parsed }
        : { kind, instruction, targetId, checks: parsed };
    }
  }
}

const optionalStates = ['expanded', 'selected', 'checked', 'canScrollUp', 'canScrollDown'] as const;

function isEvidence(value: unknown): value is Evidence {
  return isRecord(value)
    && hasOnlyKeys(value, ['id', 'role', 'label', 'viewport', 'available', 'region', ...optionalStates])
    && isId(value.id) && isText(value.role, 64, false) && isText(value.label, 240)
    && typeof value.viewport === 'boolean' && typeof value.available === 'boolean'
    && (value.region === undefined || isId(value.region))
    && optionalStates.every(key => value[key] === undefined || typeof value[key] === 'boolean');
}

function isObservation(value: unknown): value is Observation {
  return isRecord(value) && hasOnlyKeys(value, ['title', 'site', 'nodes', 'truncated'])
    && isText(value.title, 300) && isText(value.site, 300)
    && /^(?:https?:\/\/)?[^/?#@\s]*$/i.test(value.site)
    && typeof value.truncated === 'boolean'
    && Array.isArray(value.nodes) && value.nodes.length <= 200 && value.nodes.every(isEvidence);
}

function isReadResult(value: unknown): value is ReadResult {
  return isRecord(value) && hasOnlyKeys(value, ['query', 'nodes', 'truncated', 'status'])
    && isReadQuery(value.query) && typeof value.truncated === 'boolean'
    && (value.status === 'ok' || value.status === 'empty' || value.status === 'unavailable')
    && Array.isArray(value.nodes) && value.nodes.length <= 100 && value.nodes.every(isEvidence);
}

function isPrevious(value: unknown): value is NonNullable<GuideRequest['previous']> {
  return isRecord(value) && hasOnlyKeys(value, ['instruction', 'target'])
    && isText(value.instruction, 500, false) && (value.target === undefined || isEvidence(value.target));
}

// 严格限制发送给上游的证据字段和长度，拒绝附带完整地址、页面源码等额外数据。
export function isGuideRequest(value: unknown): value is GuideRequest {
  return isRecord(value) && hasOnlyKeys(value, ['goal', 'page', 'reads', 'finishOnly', 'previous', 'feedback', 'userAnswer'])
    && isText(value.goal, 500, false) && isObservation(value.page) && typeof value.finishOnly === 'boolean'
    && Array.isArray(value.reads) && value.reads.length <= 9 && value.reads.every(isReadResult)
    && (value.previous === undefined || isPrevious(value.previous))
    && (value.feedback === undefined || isText(value.feedback, 500))
    && (value.userAnswer === undefined || isText(value.userAnswer, 500));
}
