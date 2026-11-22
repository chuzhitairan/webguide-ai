import { figmaFileAt } from './figma-goal.js';
import { bindGoal as bindGitHubGoal, repositoryAt } from './github-goal.js';
import type { BoundGoal, Goal } from './protocol.js';

export function bindGoal(address: string | undefined, goal: Goal): BoundGoal | undefined {
  if (goal.kind !== 'figma-auto-layout') return bindGitHubGoal(address, goal);
  const file = figmaFileAt(address);
  if (file) return { ...goal, file };
}

export function isGoalPage(address: string | undefined, goal: BoundGoal): boolean {
  if (goal.kind === 'figma-auto-layout') return figmaFileAt(address) === goal.file;
  return repositoryAt(address)?.toLowerCase() === goal.repo.toLowerCase();
}
