type IssueGoal = { kind: 'issue'; number: string };
type ReadmeGoal = { kind: 'readme-entry' | 'readme-editor' };
type FigmaGoal = { kind: 'figma-auto-layout' };

export type GitHubGoal = IssueGoal | ReadmeGoal;
export type BoundGitHubGoal = (IssueGoal & { repo: string; path: string }) | (ReadmeGoal & { repo: string });
export type Goal = GitHubGoal | FigmaGoal;
export type BoundGoal = BoundGitHubGoal | (FigmaGoal & { file: string });

export type PageProgress =
  | { kind: 'guide'; prompt: string; notice?: string; returnHint?: string }
  | { kind: 'waiting' | 'finished'; text: string };

export interface HighlightFeedback {
  prefix: string;
  complete?: true;
}

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

export interface GuideReview {
  targetId: number;
  instruction: string;
  changedIds: number[];
}

export type Decision =
  | { kind: 'highlight'; targetId: number; instruction: string; reason?: string }
  | { kind: 'message'; instruction: string; reason?: string }
  | { kind: 'keep' };

export type PageUpdate =
  | { kind: 'page'; revision: number; page: PageSnapshot; progress: PageProgress; review?: GuideReview }
  | { kind: 'displayed'; revision: number; instruction: string; feedback?: HighlightFeedback }
  | { kind: 'observing' }
  | { kind: 'outside' };

export type PageCommand =
  | { kind: 'observe'; goal: BoundGoal }
  | { kind: 'decision'; revision: number; decision: Decision };

export interface ModelRequest {
  kind: 'choose-navigation';
  token: string;
  goal: string;
  page: PageSnapshot;
  review?: GuideReview;
}

export type ModelResponse = { decision: Decision } | { error: string };
