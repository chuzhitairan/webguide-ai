# WebGuide AI 开源项目学习资料

已下载 9 个官方公开源码仓库，并完成一轮围绕核心路径的静态阅读。原始项目提案未改动。

当前产品基线与实施入口见[项目文档](../docs/README.md)。本目录的早期记录保留当时的 Pages 场景与选型背景。

- [调研结论与 WebGuide AI 实现建议](./notes/WebGuideAI-开源项目调研.md)：功能重合、关键设计、范围建议与验证方法。
- [实现难度与复用方案](./notes/WebGuideAI-实现难度与复用方案.md)：按主动复用评估模块难度、三档交付范围和工期。
- [源码阅读索引](./notes/源码阅读索引.md)：每个项目的具体文件、行号和固定提交链接。
- [下载与版本清单](./sources.json)：仓库来源、提交 SHA、分支、文件数量、许可记录及关键文件 SHA-256。
- [公开用户反馈首轮调研](./notes/公开用户反馈-首轮调研.md)：教程与界面不一致、完成状态误判及教程维护的公开证据。
- [GitHub 与 Figma 使用经历及需求线索](./notes/GitHub与Figma-公开使用经历与需求线索.md)：2026-11-16 新增 9 个讨论主题、复核 2 个既有主题，整理任务候选与验证建议。
- [需求草案 v0.1](../docs/requirements/WebGuideAI-需求草案-v0.1.md)：将提案与公开调研转成场景、需求、用户故事和验收初稿，区分文档核对与实际验证。
- [完整系统 SRS v0.2（当前评审入口）](../docs/requirements/WebGuideAI-SRS-v0.2.md)：按完整业务组织 20 项功能与用例、信息／外部交互、9 项非功能需求及验收追溯，含具体未决项。
- [版本交付范围](../docs/requirements/版本交付范围-2026-11-17.md)：首场景为 GitHub 小组协作，记录后续能力分组及历史 Pages 验收的追溯关系。
- [浏览器场景走查](../docs/requirements/浏览器场景走查-2026-11-16.md)：Pages 发布、PR Pending review 与 Figma 自动布局的现场证据及需求修正。
- [Pages 扩展可行性实验进度](../docs/requirements/Pages扩展可行性实验-2026-11-16.md)：首轮采集收尾；用户文本支持固定练习的成功路径、清空、单项不足与范围外拒绝和保留，列有真实异常与生命周期缺口。
- [第一阶段需求评审与交付范围](../docs/requirements/第一阶段需求评审与交付范围-2026-11-16.md)：已确认 Pages 引导闭环优先，列出验收建议、第一阶段剩余工作及环境搭建时点。
- [Pages 首版验收清单](../docs/requirements/Pages首版验收清单-2026-11-16.md)：四点首版范围已确认，B01–B12 作为后续设计与验收的工作细则。
- [Pages 首次引导体验](../docs/requirements/Pages首次引导体验-2026-11-16.md)：已取得人工引导截图与反馈，记录后续页面内可视指引要求；不在第一阶段追加实现。
- [第一阶段范围评审记录](../docs/requirements/第一阶段范围评审记录-2026-11-16.md)：助手一致性核对、问题修订及发起人四点范围确认。
- [第一阶段总结与设计输入](../docs/requirements/第一阶段总结与设计输入-2026-11-16.md)：第一阶段按既有证据收尾；记录阶段产出、证据边界及下一阶段输入。
- [第二阶段整体规划](../docs/design/第二阶段整体规划-2026-11-16.md)：设计、风险验证、原型试用、正式工程与实施移交的工作顺序和完成条件。
- [核心设计 v0.1](../docs/design/WebGuideAI-核心设计-v0.1.md)：已选“扩展本地运行＋模块化后端”的职责初稿、架构图、教程及会话两张状态图和复用候选；T02 选型继续进行。
- [运行契约 v0.1](../docs/design/WebGuideAI-运行契约-v0.1.md)：T03 草案，定义教程、目标绑定、会话、消息身份、Pages 校验和 AI 答疑；附[教程 Schema](../docs/design/contracts/tutorial.schema.json)与[Pages 样例](../docs/design/contracts/pages.tutorial.json)。
- [工程配置与开发方式](../docs/design/WebGuideAI-工程配置与开发方式-v0.1.md)及[引导交互稿](../docs/design/WebGuideAI-引导交互-v0.1.md)：目录、构建／开发入口、配置与侧栏／高亮行为；均为设计稿。
- [当前首轮工程实施计划](../docs/design/首轮工程实施计划-2026-11-18.md)：五项协作模拟闭环任务及真实源码预检安排，正式工程待启动。
- [扩展生命周期实验](../experiments/extension-lifecycle-spike/README.md)：本轮手动验证已收尾，E01–E04 汇总侧栏、跨页和失效记录；未测项分配到后续设计与实现检查。
- [Pages 场景补充规格（现名首版 SRS 工作稿）](../docs/requirements/WebGuideAI-SRS-v0.1.md)：包含适用需求、三条详细用例、B01–B12 追溯表和待设计问题；整体 SRS 另行补齐。
- [整体需求清单与缺口表](../docs/requirements/整体需求清单与缺口表-2026-11-17.md)：核对全部 20 项功能、6 项非功能需求，列出跨流程缺口、产品待决问题和整体 SRS 补齐顺序。
- [完整业务流程与用例工作稿](../docs/requirements/完整业务流程与用例-2026-11-17.md)：保留整体规格的形成过程；流程、用例、业务规则及权限边界已纳入 SRS v0.2，以 SRS 为现行入口。

## 下载的项目

| 本地目录 | 官方来源 | 学习重点 |
| --- | --- | --- |
| [repos/ontheway](./repos/ontheway) | [jiusanzhou/ontheway](https://github.com/jiusanzhou/ontheway) | 录制、AI 生成、引导 SDK |
| [repos/usertour](./repos/usertour) | [usertour/usertour](https://github.com/usertour/usertour) | 完整引导平台与条件监测 |
| [repos/driver.js](./repos/driver.js) | [kamranahmedse/driver.js](https://github.com/kamranahmedse/driver.js) | 高亮、事件推进、等待和回退 |
| [repos/shepherd](./repos/shepherd) | [shipshapecode/shepherd](https://github.com/shipshapecode/shepherd) | 声明式流程与异步步骤 |
| [repos/rrweb](./repos/rrweb) | [rrweb-io/rrweb](https://github.com/rrweb-io/rrweb) | 页面录制、回放与脱敏配置 |
| [repos/nanobrowser](./repos/nanobrowser) | [nanobrowser/nanobrowser](https://github.com/nanobrowser/nanobrowser) | 扩展、页面感知与元素身份 |
| [repos/browser-use](./repos/browser-use) | [browser-use/browser-use](https://github.com/browser-use/browser-use) | Agent 运行预算与结果契约 |
| [repos/stagehand](./repos/stagehand) | [browserbase/stagehand](https://github.com/browserbase/stagehand) | observe/act/extract 接口 |
| [repos/OpenAdapt](./repos/OpenAdapt) | [OpenAdaptAI/OpenAdapt](https://github.com/OpenAdaptAI/OpenAdapt) | 示范编译、验证与修复候选 |

## 下载和分析范围

各目录是 `git clone --depth 1 --single-branch` 得到的源码工作树，保留仓库元数据和原有许可。未下载完整历史，未额外拉取子模块或 Git LFS 独立资源，未安装依赖、启动服务、加载扩展或运行模型。因此这些目录是可继续研究的源码，不是已经部署的产品。

采用 GitHub 直连完成下载；代理覆盖参数只作用于当次 Git 命令，没有修改全局代理设置。研究阶段只读取第三方代码，不执行其安装脚本。

## 版本与索引核对

从当前工作区根目录运行以下自有脚本，可以重新收集本地提交、检查已跟踪文件是否缺失/修改，并生成版本清单与源码索引：

```powershell
node research/collect-sources.mjs
```

该脚本仅使用 Node.js 自带模块和 Git；不加载下载项目的模块。调研正文中的判断对应清单记录的版本。以后更新第三方源码后，应重新核对正文，再更新索引。
