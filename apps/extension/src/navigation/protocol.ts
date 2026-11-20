type IssueGoal = { kind: 'issue'; number: string };
type ReadmeGoal = { kind: 'readme-entry' | 'readme-editor' };

export type Goal = IssueGoal | ReadmeGoal;
export type BoundGoal = (IssueGoal & { repo: string; path: string }) | (ReadmeGoal & { repo: string });
export type PagePhase = 'guide' | 'arrived' | 'waiting-issue' | 'waiting-editor' | 'fork-required' | 'login-required';

export interface Control {
  id: number;
  label: string;
  role: string;
  region?: string;
  path?: string;
  expanded?: boolean;
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
  | { kind: 'page'; revision: number; page: PageSnapshot; phase: PagePhase }
  | { kind: 'displayed'; revision: number; instruction: string; readmeEntry: boolean }
  | { kind: 'outside' };

export type PageCommand =
  | { kind: 'observe'; goal: BoundGoal }
  | { kind: 'decision'; revision: number; decision: Decision };

export interface ModelRequest {
  kind: 'choose-navigation';
  token: string;
  goal: string;
  page: PageSnapshot;
}

export type ModelResponse = { decision: Decision } | { error: string };
