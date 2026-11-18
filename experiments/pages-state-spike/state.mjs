export function assess(snapshot, config) {
  if (!snapshot || snapshot.taskId !== config.id) return {code: 'unknown', label: '缺少有效观察'};
  if (snapshot.readFailed) return {code: 'unknown', label: '最近一次读取失败，状态待确认'};
  const root = `https://github.com/${config.repository}`;
  if (snapshot.kind === 'settings' && snapshot.url === `${root}/settings/pages`) {
    // An initially disabled source can still have an enabled Save button.
    if (snapshot.disabled && snapshot.branch === 'None') return {code: 'unconfigured', label: '发布源未启用'};
    // Save enabled may mean a changed form. Never mistake selected values for persisted values.
    if (snapshot.saveEnabled === true) return {code: 'unsaved', label: '表单尚待保存或核对'};
    if (snapshot.disabled) return {code: 'unconfigured', label: '发布源未启用'};
    if (snapshot.branch !== config.branch || snapshot.directory !== config.directory
      || snapshot.saveEnabled !== false) return {code: 'unknown', label: '发布源证据不足或不匹配'};
    if (snapshot.liveSite === config.site) return {code: 'source-ready', label: '来源匹配，设置页报告站点已上线'};
    if (snapshot.sourceConfiguredText) return {code: 'source-ready', label: '来源匹配，实时部署状态待查'};
    return {code: 'unknown', label: '无法确认发布源状态'};
  }
  if (snapshot.kind === 'workflow'
    && new RegExp(`^${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/actions/runs/\\d+/?$`).test(snapshot.url)) {
    if (!snapshot.isPagesWorkflow || snapshot.commit !== config.commit) return {code: 'unknown', label: '工作流或提交不匹配'};
    if (['queued', 'in progress', 'waiting', 'pending'].includes(snapshot.status)) return {code: 'building', label: '工作流排队或运行中'};
    if (['failure', 'cancelled'].includes(snapshot.status)) return {code: 'blocked', label: '工作流失败或已取消'};
    if (snapshot.status === 'success' && snapshot.siteLinked) return {code: 'deployed', label: '目标提交的 Pages 部署成功'};
    return {code: 'unknown', label: '工作流结果证据不足'};
  }
  if (snapshot.kind === 'site' && snapshot.url === config.site) {
    return snapshot.marker === config.marker
      ? {code: 'content-verified', label: '目标站点显示预期内容标记'}
      : {code: 'content-mismatch', label: '页面可读，预期内容尚未匹配'};
  }
  return {code: 'unsupported', label: '当前页面不属于本次练习'};
}

export function summarize(observations, config, now = Date.now()) {
  const fresh = observations.filter(s => s.taskId === config.id && Number.isFinite(s.observedAt)
    && s.observedAt <= now && now - s.observedAt <= config.maxAgeMs);
  const latest = kind => fresh.filter(s => s.kind === kind).sort((a,b) => b.observedAt-a.observedAt)[0];
  const settings = latest('settings'), workflow = latest('workflow'), site = latest('site');
  const source = assess(settings, config), deploy = assess(workflow, config), content = assess(site, config);
  // A saved source pointing at a particular run must agree with the inspected run.
  const linked = !!settings?.deploymentUrl && settings.deploymentUrl.replace(/\/$/,'') === workflow?.url.replace(/\/$/,'');
  const complete = source.code === 'source-ready' && deploy.code === 'deployed'
    && content.code === 'content-verified' && linked;
  let next = '在练习仓库的 Pages 设置页检查发布源。';
  if (source.code === 'unsaved') next = '先检查当前选项，并由你决定是否保存；保存后重新检查。';
  else if (source.code === 'unconfigured') next = '选择 main 与根目录并保存，然后重新检查。';
  else if (source.code === 'source-ready') {
    next = '打开设置页的 deployed 工作流链接，再点击扩展检查。';
    if (deploy.code === 'building') next = '工作流尚在运行，稍后在同一工作流页面重新检查。';
    else if (deploy.code === 'blocked') next = '查看该工作流错误信息，任务保持未完成。';
    else if (deploy.code === 'deployed' && linked) next = '打开测试站点，再点击扩展核对内容标记。';
    if (content.code === 'content-mismatch') next = '站点内容不匹配；核对部署与页面版本，不重复提交。';
  }
  if (complete) next = '三项观察匹配，本次练习通过；这是最近观察的结果，页面变化后请重新检查。';
  return {complete, source, deploy, content, linked, next,
    steps: [{name:'发布源',...source},{name:'工作流',...deploy},{name:'站点内容',...content}]};
}
