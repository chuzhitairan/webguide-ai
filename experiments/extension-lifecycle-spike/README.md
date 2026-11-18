# 扩展生命周期实验 v0.0.1

日期：2026-11-17。可丢弃的 T05 浏览器机制实验；不作为正式工程骨架保留。**本轮手动实验已按发起人要求收尾**，E01–E04 及遗留项见准备检查记录。以下操作卡保留为复现资料，当前不要求继续执行。

## 目的与边界

核对 Edge 侧栏事件、界面连接断开、跨标签／跨源任务身份、高亮失效和 service worker 重启恢复。使用原生 MV3 JavaScript 排除构建框架的干扰；技术栈方向仍为 TypeScript＋React＋WXT、Node.js＋Fastify。此实验没有验证或安装 WXT、React、Driver.js、后端或模型。

只使用本机 `127.0.0.1` 的三个模拟页面，不读取 GitHub、真实仓库或用户输入，不点击目标页面操作，不调用网络服务。页面模块只报告目标是否唯一可见、页面角色和身份，不采集页面正文。诊断保存于 `storage.session`，日志最多 100 条；清空按钮清除本实验会话及日志，重载／禁用／更新扩展或重启浏览器也可能清空。

权限为 `sidePanel`、`storage` 及 `http://127.0.0.1/*` 的本机访问；没有 debugger、scripting、clipboard、downloads 或整个浏览器历史权限。主机权限包含该主机的各端口，脚本路径进一步限制为 `/webguide-lifecycle/*`，运行时精确核对下方三个 URL，其他端口、查询参数及路径不进行任务读取。没有 web_accessible_resources 或外部通信入口。

## 启动与第一轮操作

1. 在工作区根目录运行以下命令并保持窗口开启（若助手已启动，则直接使用；端口占用时不要重复启动）：

   ```powershell
   node experiments/extension-lifecycle-spike/serve.mjs
   ```

2. Edge 打开 `edge://extensions`，通过“加载解压缩的扩展”选择本 README 所在目录 `experiments/extension-lifecycle-spike`，不是之前的 `pages-state-spike`。
3. 打开[本机模拟设置页](http://127.0.0.1:43117/webguide-lifecycle/settings.html)，点击扩展工具栏图标打开侧栏。
4. 点击“开始新实验任务”。预期看到短暂蓝框、`active`、一项 `settings` 观察。复制侧栏下方诊断记录，先核对 `capabilities`、`bootId` 及事件；如果加载或打开失败，记录实际错误。

服务只绑定回环地址 `127.0.0.1`，不对局域网开放。手动启动时 Ctrl+C 停止；助手启动的进程可由助手停止。尚未准备好做后续实验时，可直接暂停或关闭侧栏。

## 逐项实验卡

每次高亮最长 **10 秒**，到期自动撤销；这不是关闭检测成功。测试关闭、移除或导航时，先点击“核对当前页”，随后立即操作，并记录是否在 10 秒到期前撤销。

| 项目 | 操作 | 应核对的结果 |
| --- | --- | --- |
| 能力与首次高亮 | 执行首轮操作 | 能加载／打开侧栏；记录实际 UA 和 sidePanel、onOpened、onClosed、storage.session 能力，不能据能力标志代替行为结果 |
| 主动暂停与继续 | 高亮时点暂停，再点继续 | 暂停撤销蓝框；继续明确重查，taskId 不变；保留观察是历史记录，不是持续有效的高亮 |
| 关闭并重开侧栏 | 核对后立即用浏览器侧栏关闭按钮关闭，再通过扩展图标打开 | 蓝框撤销；重开不自动继续，查看 `panel-connection-lost` 或其他实际原因；分别记录 native-panel-closed 和 panel-disconnected，有一个事件不冒充另一个 |
| 同源导航与目标重建 | 打开模拟工作流页，手动核对；再移除／重建目标 | 同一 taskId 下增加 workflow 观察；换页撤销旧框；重建后不会沿用旧元素，需重新核对 |
| SPA 式变化 | 核对后点击“模拟无刷新导航” | URL 与 DOM 改变后蓝框撤销；带查询参数地址被拒绝核对；点原始页面链接回到允许地址 |
| 跨源新标签／范围外 | 从页面链接新开模拟站点，核对；再切到范围外空白页核对 | site 在第二端口，是不同 origin；仍属于原 taskId；空白页不读取、不高亮、不自动换目标；需在原任务窗口操作 |
| 第二窗口与面板重建 | 第二窗口打开侧栏尝试核对；回到原窗口重开／刷新面板 | 其他窗口不接管原任务；新面板需明确继续；旧实例断开不应暂停已确认的新实例。按实际事件次序记录 |
| 后台自然终止与恢复 | 先暂停操作，关闭扩展开发者工具，等待约 45–60 秒，再刷新诊断记录；若未发生终止则记未覆盖 | 比较 bootId 和 background-boot；若确实重启，检查点中的活动任务转暂停，页面指示不自动恢复；没有新 bootId 不能说重启验证通过 |

如需强制停止 service worker，另按本机 Edge 实际可用入口安排；“重新加载整个扩展”会清空会话，不能拿来替代仅后台重启测试。自然终止是否发生依浏览器而定，等待时长不是通过条件。

## 实验实现的限制

- 换页／切标签后手动核对；尚未实现正式版的自动重新定位和推进。
- 蓝框是简单固定定位边框，不是 Driver.js，也没有气泡、无障碍完成验收或真实 GitHub 页面兼容结论。
- DOM 变化保守撤销，滚动／缩放只更新位置；纯 URL 改变还有 200 ms 的本地检查，不能作为正式“立即撤销”时序保证。
- 页面端收到断开信号即撤销，另有有限高亮租期兜底；后台不轮询保活。连接信号的到达时间、侧栏关闭以及停止消息是否到达，均需在真实 Edge 验证，逻辑暂停标签不等于所有页面已经确认停止。
- 跨源仅验证不同端口，后续仍需实际目标主机的可选授权与重新注入实验。相同任务下的三类观察不意味着 Pages 配置、SHA 和站点内容已经联合验证。
- 不接入模型，不展示发布成功，不修改既有 Pages 实验。正式源码是否复用，等实验结果回写设计后决定。

## 本机检查与证据

```powershell
node --test experiments/extension-lifecycle-spike/state.test.mjs experiments/extension-lifecycle-spike/content.test.mjs
```

10 项检查覆盖 URL 范围、恢复／暂停、面板拥有权、迟到观察及模拟 DOM 中的高亮撤销；模拟 DOM 使用 Node VM 和受控对象，不是浏览器自动化。

| 检查类别 | 2026-11-17 当前结果 |
| --- | --- |
| Node 状态与模拟 DOM 检查 | 10 项通过；不涵盖实际 chrome.* API 行为 |
| JavaScript 语法、manifest 入口文件、本机服务路由 | 见[准备检查记录](准备检查记录-2026-11-17.md) |
| Edge 首次加载与页面检查 | 用户诊断文本支持侧栏／页面连接、首次命中与 10 秒租期撤销；详见准备检查记录 E01，视觉位置待确认 |
| Edge 单窗口关闭并重开侧栏 | 用户日志与视觉反馈支持断开后暂停、蓝框随关闭撤销、重开仍暂停；见准备检查记录 E02，未观察到原生 onClosed 回调 |
| Edge 同源换页与本机跨源新标签 | E03 的三类观察属于同一任务；同标签文档已换、新标签使用第二端口；用户确认工作流及站点均有蓝框 |
| Edge DOM／地址变化 | E04 支持 DOM 变化撤销、重新核对及改变地址后的拒绝路径；具体操作级视觉验证不据日志扩展认定 |
| 未覆盖项 | 本轮不继续手动测试；后台恢复、多窗口、真实主机授权和组件适配按准备检查记录中的后续时点处理 |

浏览器事实依据：[sidePanel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)、[连接生命周期](https://developer.chrome.com/docs/extensions/develop/concepts/messaging#port-lifetime)、[后台生命周期](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)、[会话存储](https://developer.chrome.com/docs/extensions/reference/api/storage)。事件存在性由实际浏览器能力记录，Chrome 文档不替代 Edge 实测。
