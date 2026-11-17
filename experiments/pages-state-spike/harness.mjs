import {task} from './config.mjs';
import {samples} from './fixtures.mjs';
import {render} from './view.mjs';
render([],task);
for (const button of document.querySelectorAll('[data-sample]')) button.addEventListener('click',()=>{
  render(samples()[button.dataset.sample],task);
  document.getElementById('notice').textContent=`当前为模拟样本：${button.textContent}。尚未进行扩展实测。`;
});
