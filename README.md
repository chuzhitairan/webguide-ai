# WebGuide AI

WebGuide AI 是一款网页操作引导扩展。第一次用 GitHub 等工具协作时，组员可以直接说出想做的事。AI 根据眼前的页面给出高亮和提示，用户自己操作，扩展随后核对结果。

**当前进度**　实时引导原型已能试用，支持自然语言目标、局部补看、操作后复查和故障恢复。扩展用个人 API 密钥直连模型。GitHub、Figma 和维基百科已有实测记录。[工程进度](docs/README.md) · [真实站点验证](docs/design/导航Harness-真实站点验证-2026-11-23.md) · [试用新引导](#试用新引导)

## 课程设计检查

| 周次 | 教师检查内容与仓库入口 |
| --- | --- |
| **第 11 周 · 需求评审** | [课前检查与评审材料](docs/course/week11/README.md) · [SRS v0.3 正文](docs/requirements/WebGuideAI-SRS-v0.3.md) · [草稿 PR #37](https://github.com/chuzhitairan/webguide-ai/pull/37) · [23 条故事 Issue](https://github.com/chuzhitairan/webguide-ai/labels/story) |
| 第 10 周 · 需求调研 | [调研报告](docs/course/week10/调研报告.md) · [14 条用户故事初稿](docs/course/week10/用户故事.md) · [课堂演示材料](docs/course/week10/presentation/README.md) |
| 第 9 周 · 组队与立项 | [选题 Issue](https://github.com/chuzhitairan/webguide-ai/issues/1) · [调研计划](docs/course/week10/调研计划.md) · [仓库配置与提交](docs/course/week10/仓库配置与提交清单.md) |
| 课程全过程 | [课程资料总览](docs/course/README.md) · [教学时间表与最终交付物](docs/course/课程任务与时间节点.md) · [团队与 AI 使用台账](docs/course/week10/团队与过程台账.md) |

第 11 周以实时引导与经验复用为评审对象，当前实现和后续范围分期列在 SRS v0.3 草稿中。[原固定教程方案 v0.2](docs/requirements/WebGuideAI-SRS-v0.2.md) · [导航 Harness 设计](docs/design/WebGuideAI-导航-Harness-设计.md)

## 本机开发

1. 使用 Node 24.22.3 和 npm 11.19.1。在仓库根目录运行 `npm ci`。
2. 运行 `npm run check`，检查类型、运行测试并构建扩展与本机服务。
3. 在 Chrome 或 Edge 的扩展管理页打开开发者模式，加载 `apps/extension/.output/chrome-mv3`。已有本机安装时可点击「重新加载」。

- 首次执行浏览器测试前运行 `npx playwright install chromium`。随后运行 `npm run test:e2e`，在独立 Chromium 中验证侧栏和模拟引导。
- `npm run dev:api` 供本机服务实验使用。常规试用从扩展侧栏开始。

## 试用新引导

从 [v0.0.1 Release](https://github.com/chuzhitairan/webguide-ai/releases/tag/v0.0.1) 下载插件包并解压。在 Chrome 或 Edge 的扩展管理页打开开发者模式，选择「加载已解压的扩展」，打开含 `manifest.json` 的文件夹。

1. 加载扩展，在练习网页点击工具栏上的 WebGuide AI 图标。默认的同济 `DeepSeek-V4.1-Flash` 试用低推理强度。用其他兼容 Chat Completions 和 JSON 回复的服务时，在「模型设置」填写 HTTPS API 地址和模型名称，推理强度沿用服务默认设置。
2. 在侧栏填自己的模型 API 密钥和目标，例如「带我找到这个页面的导出设置」。点「开始引导」，首次使用该模型域名时允许扩展访问。输入的目标和必要的页面线索会发给这个模型服务。
3. 跟着蓝框和提示操作。定位到屏外控件后，扩展可以滚到它的位置再高亮。点击、输入和提交由你完成。密钥在本次浏览器会话中有效，退出浏览器后重新填写。模型地址和名称可以继续沿用。

想试用经验引导，在「模型设置」勾选「启用导航经验（试验）」后开始一次新引导。开关默认关闭。两条候选覆盖英文维基百科正文字号和 Figma 图层导出入口。[经验模块设计](docs/design/WebGuideAI-经验模块设计.md)

## 试用旧版实时引导

早期 GitHub 和 Figma 引导保存在[原型快照 `52a1b0e`](https://github.com/chuzhitairan/webguide-ai/tree/52a1b0e)。固定路线、协作练习和文件核对的设计见[旧版运行契约](docs/design/WebGuideAI-运行契约-v0.1.md)。

## 从哪里找文件

| 我想找 | 入口 |
| --- | --- |
| 实现 | [浏览器扩展](apps/extension/) · [模型协议与本机服务实验](apps/api/) |
| 自动化测试 | [浏览器测试](tests/e2e/) · [GitHub Actions](https://github.com/chuzhitairan/webguide-ai/actions) |
| 产品需求、设计与实施记录 | [项目文档](docs/README.md) |
| 早期实验和开源借鉴 | [可行性实验](experiments/)、[开源研究](research/README.md) |
| 如何参与开发 | [贡献流程](CONTRIBUTING.md)、[项目经验](docs/experience/README.md) |

## 项目章程

| 项目 | 内容 |
| --- | --- |
| 目标 | 帮助刚接触网页工具的组员完成自己的操作目标，从眼前的界面开始，一步步找到入口并核对结果。 |
| 当前增量 | 桌面 Chrome／Edge 扩展，覆盖自然语言目标、网页高亮、用户操作后的观察与恢复。以公开或练习页面验证实际任务。 |
| 后续范围 | 用试用记录验证经验积累和复用，逐步评估共享与维护。原固定教程方案及其操作用户、作者／维护者、管理员角色见[原项目提案](项目提案-WebGuideAI.md)和 [SRS v0.2](docs/requirements/WebGuideAI-SRS-v0.2.md)。 |
| 团队 | 五人，组长负责主线与集成，成员按实际参与认领可独立验收的工作包。[团队台账](docs/course/week10/团队与过程台账.md) |

## 过程模型与交付

采用增量迭代。每个增量围绕一段可以独立试用的功能，经过计划、构造、测试和评审后形成可交付版本。需求、模型、代码和验收通过 Issue 与 PR 关联。

网页会动态变化，模型也会在相同页面上作出不同判断。增量交付让组员尽早使用真实页面，按实际卡点安排下一版，并保留各版的测试和评审依据。

课程要求至少 3 个可交付增量、2 轮完整迭代。文档基线与软件版本分别记录，当前发布状态见 [Releases](https://github.com/chuzhitairan/webguide-ai/releases)。[课程数量要求](docs/course/课程任务与时间节点.md#4-必须满足的数量要求)

## 风险清单

| 风险 | 影响 | 应对与当前证据 |
| --- | --- | --- |
| 页面改版或控件被替换 | 指向错误位置 | 新一轮重新观察，绘制前复核控件及其归属，及时撤销已失效提示。 |
| 把中间步骤当成完成 | 用户停在错误终点 | 分别核对入口、实际到达和设置生效。测试覆盖过期证据、同名控件和未生效状态。 |
| 模型超时或返回无效结果 | 引导中断 | 控制重试与会话额度，侧栏可沿原目标恢复。 |
| 调研或评审证据不足 | 需求偏差、材料缺项 | 分别保留公开调研、组员试用、真人访谈与正式评审的实际记录。 |

## 仓库协作

改动通过 PR 合入 `main`。查看[贡献流程](CONTRIBUTING.md)了解验证、评审和合并方式。[仓库配置记录](docs/course/week10/仓库配置与提交清单.md)记录分支保护、看板和里程碑。

本地 `research/repos/` 为上游学习副本，`软工设计课/` 为教师原始资料，`tmp/` 为临时数据，均不进入课程仓库。研究结论、来源链接与必要的原创实验保留。访谈只提交获准的匿名摘要。既有实验的运行说明见各实验目录。

## AI 使用

AI 辅助研究、文档与实现草稿；成员负责理解、核读、真人访谈、需求与设计确认、评审及放行。按[过程台账](docs/course/week10/团队与过程台账.md)持续记录用途、核查和实际修改案例。[助手协作说明](AGENTS.md)
