# Pages 状态读取实验（throwaway spike）

日期：2026-11-16。此目录用于回答“最小浏览器扩展能否读取 SC01 的关键状态”，不作为正式产品架构或可发布版本。无需安装依赖、构建工具、模型密钥或后端。

## 当前完成度

| 验证层级 | 结果 |
| --- | --- |
| 纯逻辑反例与权限清单 | 16 项 Node 测试通过 |
| 实际网页 DOM 可读取性 | 同一 `collector.mjs` 经浏览器只读 DOM 工具取得 Pages 配置、关联工作流与站点标记；[原始结果](evidence/live-dom-observations.json)、[分类结果](evidence/live-dom-assessment.json) |
| 普通网页中的界面 | 6 个模拟状态经 Edge 操作核对；[记录](evidence/preview-checks.json) |
| 真正的扩展运行 | 用户代测的 T02–T04 输出符合预期：[完整成功文本及数据核对](evidence/user-reported-complete.json)；补测[清空与仅站点的面板文本](evidence/user-reported-reset-and-site-only.json)也符合预期。[范围外补测](evidence/user-reported-out-of-scope-recheck.json)同时显示拒绝和站点观察保留；此前空数组原因仍未知。首轮采集收尾；非截图或独立浏览器复现，其他异常待核验 |
| 未配置／运行中真实状态 | 已有上轮走查资料，本轮使用人工样本验证逻辑；尚未通过已加载扩展采集 |

DOM 工具核对只能说明采集逻辑对这些页面结构有效，不能证明扩展 API、权限链路或其他版本已通过。模拟界面始终标注“尚未加载浏览器扩展”。

本轮检查中补充了初始 None + Save 可点击的样本，复现并修正其被误归为“未保存”的问题。该修正后的 Node 检查通过；六个模拟界面的浏览器操作记录采集于此修正之前，未配置样本需在加载扩展时再做现场复核。

## 实验取舍

- 选择 MV3 + 原生 JavaScript 模块，避免在未知可行性上先引入完整框架。
- 选择手动 `activeTab` 读取，用户在 Pages 设置、关联工作流、站点三个标签页分别打开扩展检查。与持续网站权限相比，多一次手动动作，但能先验证必要数据。[activeTab 官方说明](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)、[scripting 官方说明](https://developer.chrome.com/docs/extensions/reference/api/scripting)。
- `storage.session` 仅在浏览器当前会话保留三个结构化观察，读取/打开时按 15 分钟有效期过滤，可清空；重启或扩展重新加载后会丢失。不做后台监听或持续 DOM 观察。
- 不接 GitHub API：本实验先验证网页读取，避免把 API 结果误当作网页状态可观察的证明。
- 本次任务配置固定于已有练习仓库、首页提交、站点地址与内容标记，见 [config.mjs](config.mjs)。不把此实验当作任意仓库支持。

## 权限与数据流

实际清单：[manifest.json](manifest.json)。仅有 `activeTab`、`scripting`、`storage`；无 `host_permissions`、常驻 content script 或后台 service worker。

点击扩展，再点击“检查当前标签页”时，在注入之前核对地址，仅允许：

1. 指定练习仓库 `/settings/pages`。
2. 指定练习仓库 `/actions/runs/<数字>` 详情。
3. 该练习站点首页。

`collector.mjs` 在目标页面再次核对地址。读取可见的分支、目录、Save 状态、部署链接、工作流名称/状态/提交和 `#verification` 的文本；不读输入框、隐藏表单、Cookie 或页面内部 JavaScript 状态。扩展没有网络发送代码，扩展页面 CSP 为 `connect-src 'none'`。使用 `textContent` 呈现证据，页面文字不作为 HTML 执行。

`activeTab` 本身是浏览器对当前页的临时访问授权，代码中的目标限定不等于浏览器级域名沙箱。不要把未知后续代码直接替换进已获授权的目录；本次只评审与加载当前版本。

## 判断规则

发布源配置、工作流成功、站点标记匹配三项必须齐全，工作流还须与设置页 deployed 链接及固定预期提交相符。观察缺失、过期、读取失败、未保存、失败或内容不匹配均不算完成。

**本次新增的重要反例**：站点已上线且工作流 Success 时，Pages 的分支段落仍写着“currently being built from the main branch”。这是构建来源说明，不能单独判定实时构建中。`state.mjs` 只在具体工作流状态为 Queued / In progress 等时报告等待。

内容标记校验与工作流关联提供实用的练习证据，不是密码学证明；没有检验 HTTP 缓存头或站点构件摘要。每次重新发布目标，应同步修改预期提交和内容标记。

## 本地运行与核验

在项目根目录运行：

```powershell
node --test experiments/pages-state-spike/tests/state.test.mjs
node experiments/pages-state-spike/tools/serve.mjs
```

预览为 `http://127.0.0.1:4178/harness.html`，仅监听本机。`harness.html` 使用模拟数据，不能代替扩展。当前会话曾因进程/网络环境导致连接超时，改以隐藏本机进程启动后 Edge 可访问；根因尚未完全定位，不归因为扩展错误。

## 加载后的实测步骤（待执行）

用户已明确批准加载当前 v0.0.1 并继续实测，无需重复确认。2026-11-16，操作工具的浏览器安全策略拒绝访问 `edge://extensions` 并禁止绕过，用户随后报告已手动加载且在设置页点击检查。当前改由用户代为操作和截图，依据[手动实测与截图清单](手动实测与截图清单.md)核验；不需要重复安装。以下保留 [Edge 官方加载流程](https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/extension-sideloading)供以后重建环境：在扩展页启用开发者模式，选择“加载解压缩的扩展”，目录为：

```text
C:\Users\chuzh\Desktop\软件工程课程设计\experiments\pages-state-spike
```

加载后依次执行：

1. 打开练习仓库 Pages 设置，点击扩展 → 检查。应显示来源匹配，整体尚未完成。
2. 打开设置页 deployed 所指工作流，再检查。应识别预期提交 Success，整体仍未完成。
3. 打开练习站点首页，再检查。三项匹配时才显示本次练习已验证。
4. 在无关页面点击检查，应拒绝读取；清空后重新检查站点，只有内容匹配仍不能完成。
5. 在授权的练习操作中补采未配置和运行中状态，不能只用本地样本宣称该链路通过。

不自动保存设置、重跑部署、提交或发布内容。观察本身不修改 GitHub。需要改变练习仓库时，另按已授权范围操作并记录实际影响。

## 文件入口

- `collector.mjs`：只读 DOM 采集；函数无模块外部依赖，可被 `executeScript` 序列化。
- `state.mjs`：单页判断、时间有效性和跨页证据关联。
- `popup.mjs`：实际扩展 API 路径、失败处理和会话存储。
- `view.mjs` / `popup.html` / `style.css`：实验界面。
- `harness.html` / `fixtures.mjs`：明确标注的模拟样本界面。
- `tests/state.test.mjs`：关键反例；不是浏览器 API 的替身测试。

没有初始化 Git、创建远端产品仓库或提交代码。本目录尚未决定保留为正式产品源码；下一轮根据扩展实测结果再选择产品架构。
