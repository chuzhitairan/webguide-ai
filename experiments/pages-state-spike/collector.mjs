// Self-contained: executeScript serializes this function without its module scope.
// Reads rendered DOM only; never reads inputs, hidden fields, cookies, or page JS state.
export function collectPage(config) {
  const url = new URL(location.href);
  const githubRoot = `https://github.com/${config.repository}`;
  const canonical = url.origin + url.pathname;
  const visible = e => !!e && e.getClientRects().length > 0
    && getComputedStyle(e).visibility !== 'hidden';
  const text = e => visible(e) ? e.innerText.replace(/\s+/g, ' ').trim() : null;
  const base = {taskId: config.id, url: canonical, observedAt: Date.now()};
  if (canonical === `${githubRoot}/settings/pages`) {
    const branchButton = document.getElementById('pages_select_branch-button');
    const form = branchButton?.closest('form');
    const paragraphs = [...(form?.querySelectorAll('p') || [])].filter(visible).map(text);
    const save = [...(form?.querySelectorAll('button') || [])]
      .find(e => text(e) === 'Save');
    const visit = [...document.querySelectorAll('a')]
      .find(e => text(e) === 'Visit site');
    const liveBox = visit?.parentElement?.parentElement;
    const liveText = text(liveBox) || '';
    const deployment = [...(liveBox?.querySelectorAll('a') || [])]
      .find(e => text(e) === 'deployed');
    return {...base, kind: 'settings',
      branch: text(branchButton), directory: text(document.getElementById('pages_select_dir-button')),
      saveEnabled: save ? !save.disabled : null,
      disabled: paragraphs.some(p => /GitHub Pages is currently disabled\./.test(p)),
      sourceConfiguredText: paragraphs.some(p => /currently being built from/.test(p)),
      liveSite: /Your site is live at/.test(liveText) && visible(visit) ? visit.href : null,
      deploymentUrl: visible(deployment) ? deployment.href : null,
    };
  }
  if (canonical.startsWith(`${githubRoot}/actions/runs/`)
    && /^\d+\/?$/.test(canonical.slice(`${githubRoot}/actions/runs/`.length))) {
    const summaries = [...document.querySelectorAll('[aria-label="Workflow run summary"]')].filter(visible);
    const summary = summaries.length === 1 ? summaries[0] : null;
    const raw = text(summary) || '';
    const status = raw.match(/\bStatus\s+(Success|Failure|In progress|Queued|Cancelled|Waiting|Pending)\b/i)?.[1]?.toLowerCase() || null;
    const commits = [...(summary?.querySelectorAll('a') || [])]
      .filter(e => visible(e) && e.href.startsWith(`${githubRoot}/commit/`))
      .map(e => e.href.split('/commit/')[1]);
    const headings = [...document.querySelectorAll('h1')].filter(visible).map(text);
    const siteLinks = [...document.querySelectorAll('a')].filter(e => visible(e) && e.href === config.site);
    return {...base, kind: 'workflow', status,
      isPagesWorkflow: headings.length === 1 && /^pages build and deployment\s+#\d+$/i.test(headings[0]),
      commit: commits.length === 1 ? commits[0] : null,
      siteLinked: siteLinks.length > 0,
    };
  }
  if (canonical === config.site) {
    const marker = document.getElementById('verification');
    return {...base, kind: 'site', marker: text(marker)};
  }
  return {...base, kind: 'unsupported'};
}
