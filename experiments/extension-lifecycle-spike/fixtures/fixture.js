document.querySelector('#remove').onclick = () => {
  document.querySelector('#wg-lifecycle-target')?.remove();
  document.querySelector('#result').textContent = '目标已移除；蓝框应撤销。';
};
document.querySelector('#replace').onclick = () => {
  document.querySelector('#wg-lifecycle-target')?.remove();
  const target = document.createElement('div');
  target.id = 'wg-lifecycle-target';
  target.textContent = '这是重新创建的目标；请重新核对。';
  document.querySelector('nav').after(target);
};
document.querySelector('#spa').onclick = () => {
  history.pushState({}, '', '?spa=changed');
  document.querySelector('#result').textContent = 'URL 已改变且未整页重载；此地址不在核对清单，蓝框应撤销。刷新后仍需回到上方原始页面链接。';
};
