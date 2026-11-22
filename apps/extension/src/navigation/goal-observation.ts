import { readPage } from '../page/navigation-snapshot.js';
import { figmaLocationFeedback, figmaProgress, observeFigmaGoal } from './figma-goal.js';
import { githubHighlightFeedback, githubProgress, isGoalLink, isPreferredControl } from './github-goal.js';
import type { BoundGoal, HighlightFeedback, PageProgress } from './protocol.js';

interface GoalObservation extends ReturnType<typeof readPage> {
  progress: PageProgress;
  keepsCurrent: boolean;
  equivalentRoutes?: (previous?: string, next?: string) => boolean;
  feedback(element: Element): HighlightFeedback | undefined;
}

// 站点决定观察范围和任务证据，页面脚本只负责判断何时发布和渲染。
export function observeGoalPage(document: Document, url: URL, goal: BoundGoal, current?: Element): GoalObservation {
  if (goal.kind === 'figma-auto-layout') {
    const { candidates, destination } = observeFigmaGoal(document);
    const snapshot = readPage(document, url, () => true, candidates);
    return {
      ...snapshot,
      // 设计稿的名称和地址留在浏览器本地。
      page: { path: '/design', title: 'Figma Design', controls: snapshot.page.controls },
      progress: figmaProgress,
      keepsCurrent: !current || candidates.includes(current),
      feedback: element => element === destination ? figmaLocationFeedback : undefined,
    };
  }

  return {
    ...readPage(document, url, (element, path) => element === current || isPreferredControl(element, path, url, goal)),
    progress: githubProgress(document, url, goal),
    keepsCurrent: true,
    equivalentRoutes: (previous, next) => isGoalLink(previous, goal) && isGoalLink(next, goal),
    feedback: element => githubHighlightFeedback(element, url, goal),
  };
}
