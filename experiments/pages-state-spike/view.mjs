import {summarize} from './state.mjs';
export function render(observations, config, now) {
  const result = summarize(observations, config, now);
  document.getElementById('target').textContent = config.repository;
  document.getElementById('outcome').textContent = result.complete ? '本次练习已验证' : '尚未完成';
  document.getElementById('outcome').className = result.complete ? 'success' : '';
  document.getElementById('next').textContent = result.next;
  const steps = document.getElementById('steps'); steps.replaceChildren();
  for (const [i,step] of result.steps.entries()) {
    const row = document.createElement('article'); row.className='step';
    const num = document.createElement('span'); num.className='number';num.textContent=String(i+1);
    const block = document.createElement('div');
    const name = document.createElement('h2');name.textContent=step.name;
    const label = document.createElement('p');label.textContent=step.label;
    block.append(name,label);row.append(num,block);steps.append(row);
  }
  document.getElementById('evidence').textContent = JSON.stringify(observations,null,2);
  return result;
}
