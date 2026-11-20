export interface Control {
  id: number;
  label: string;
  role: string;
  region?: string;
  path?: string;
}

export interface PageSnapshot {
  path: string;
  title: string;
  controls: Control[];
}

export type Decision =
  | { kind: 'highlight'; targetId: number; instruction: string }
  | { kind: 'message'; instruction: string };

export type PageUpdate =
  | { kind: 'page'; revision: number; page: PageSnapshot; reached: boolean }
  | { kind: 'displayed'; revision: number; instruction: string }
  | { kind: 'outside' };

export type PageCommand =
  | { kind: 'observe'; issuePath: string }
  | { kind: 'decision'; revision: number; decision: Decision };

export interface ModelRequest {
  kind: 'choose-navigation';
  token: string;
  goal: string;
  page: PageSnapshot;
}

export type ModelResponse = { decision: Decision } | { error: string };
