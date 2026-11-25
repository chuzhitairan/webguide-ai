import type { ReadQuery } from '../../../api/src/guide-protocol.js';
import type { PageDecision, PageProof } from './session.js';

export const guidePort = 'webguide-guide';

export type PageCommand =
  | { kind: 'snapshot'; newRound: boolean }
  | { kind: 'read'; queries: ReadQuery[] }
  | { kind: 'apply'; decision: PageDecision }
  | { kind: 'verify'; proofs: PageProof[]; finish?: string }
  | { kind: 'track-scroll'; id?: number }
  | { kind: 'clear' };

export type PageSignal = 'action' | 'boundary' | 'changed' | 'scroll' | 'lost';

export type PageRequest = { id: number; command: PageCommand };
export type PageResponse = { id: number; value: unknown } | { event: PageSignal };
