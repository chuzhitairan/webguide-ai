# WebGuide AI 项目文档

更新于 2026-11-20。

**当前方向**　把扩展做成 AI 浏览器导航的运行层。AI 根据当前页面选择高亮目标和提示，扩展在网页上显示，用户自己操作。优先验证实时指路和经验复用。[浏览器导航原型](design/WebGuideAI-浏览器导航原型.md)

**已有进度**　`codex/ai-navigation` 已整理出扩展侧栏、通用页面工具和本机服务。下一步接入实时模型。固定路线、协作练习和文件核对可在旧分支 `codex/github-raw-source` 查阅。[浏览器导航原型](design/WebGuideAI-浏览器导航原型.md)

## 接手原型先看这里

| 想了解什么 | 文档 |
| --- | --- |
| AI 怎么看网页、选高亮和提示，经验如何复用 | [浏览器导航原型](design/WebGuideAI-浏览器导航原型.md) |
| 接下来做什么、用什么场景验证 | [版本交付范围](requirements/版本交付范围-2026-11-17.md#当前开发顺序) |
| 怎么运行项目、调试扩展 | [工程配置](design/WebGuideAI-工程配置与开发方式-v0.1.md) · [浏览器扩展经验](experience/浏览器扩展.md) |
| 旧版固定路线和协作练习是怎么做的 | [首轮实施记录](design/首轮工程实施计划-2026-11-18.md) · [固定教程运行契约 v0.1](design/WebGuideAI-运行契约-v0.1.md) |

[项目经验](experience/README.md)记录协作、扩展与演示做法。[课堂资料](course/README.md)汇总时间表、交付包和演示。

## 原有教程方案与场景资料

- 最初的完整方案以教程为入口，涵盖教程生成、现场高亮和 AI 纠偏。运行契约和 Schema 可与旧版本对照查阅。[原始提案](../项目提案-WebGuideAI.md) · [SRS v0.2](requirements/WebGuideAI-SRS-v0.2.md) · [核心设计 v0.1](design/WebGuideAI-核心设计-v0.1.md) · [引导交互 v0.1](design/WebGuideAI-引导交互-v0.1.md)
- 完整 GitHub 协作练习包括认领 Issue、修改指定文档、创建可评审 PR。已有本机模拟流程，真实 GitHub 的 14 项验收待执行。文件、提交和 PR 核对已有专项工具入口。[GitHub 协作场景 SC02](requirements/GitHub协作首场景规格-v0.1.md) · [协作适配契约](design/GitHub协作适配契约-v0.1.md)
- 原方案的需求来源、用户故事和首轮评审记录，以及仍可用于原型的可行性实验和开源研究。[需求调研报告](course/week10/调研报告.md) · [原方案用户故事](course/week10/用户故事.md) · [PR #3](https://github.com/chuzhitairan/webguide-ai/pull/3) · [可行性实验](../experiments/) · [开源研究](../research/README.md)

原型结果出来后，再决定完整协作、教程作者工具和公共经验库的推进顺序。
