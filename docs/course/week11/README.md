# 第 11 周 · 需求评审与 SRS 定稿

第三次课按现有排课推算为 2026-11-27。第 2 课补充讲义要求故事相关的仓库材料在下次课前一天 24:00 前入库，按此推算为 11 月 26 日 24:00。课堂安排以教师最新通知为准。[第 11 周 Milestone](https://github.com/chuzhitairan/webguide-ai/milestone/2)

## 课前与课堂检查

| 检查项 | 对应材料和状态 |
| --- | --- |
| 上周遗留检查：至少 20 条用户故事 Issue，其中性能、安全、可用性至少各 1 条。给每条写 Given/When/Then，打 `story` 标签，指派负责人，链接调研证据。 | [已有 14 条故事初稿](../week10/用户故事.md)，含 Given/When/Then。[GitHub 用户故事 Issue](https://github.com/chuzhitairan/webguide-ai/issues?q=is%3Aissue+label%3Astory) 待建与分派。已有用例编号和需求草稿可以作为整理依据。 |
| 完整用例图应标明主、次参与者，课堂讲解场景与非功能需求。 | [原方案业务流程和 20 个用例](../../requirements/WebGuideAI-SRS-v0.2.md#附录-a完整用例规格)可供评审参考。[两项详细非功能验收用例](../../requirements/WebGuideAI-SRS-v0.2.md#81-两个非功能需求详细验收用例)分别是及时更新／撤销高亮和页面敏感数据处理。可用性故事仍需补齐并对应验收，完整用例图和用例范围待按评审口径确认。 |
| 课前提交 SRS 草稿 PR。 | [SRS v0.2 评审稿](../../requirements/WebGuideAI-SRS-v0.2.md)已入库，覆盖固定教程完整方案。当前原型按[实时引导范围](../../design/WebGuideAI-导航-Harness-设计.md#1-用户会怎样使用它)推进。待确认二者的交付边界并提交本周专门的 SRS 草稿 PR。 |

## 评审后交付

| 交付 | 已有依据和下一步 |
| --- | --- |
| SRS v1.0 Release，附变更记录 | 课堂评审关注需求是否可测试、完整、一致。评审签字后再定稿发布，请从 [Releases](https://github.com/chuzhitairan/webguide-ai/releases)核对状态。 |
| 需求追溯矩阵 v0 | [SRS 第 9.2 节](../../requirements/WebGuideAI-SRS-v0.2.md#92-功能来源与验证追溯)已有原方案的需求 ID、用例和验收映射，待按正式评审范围确认并作为追溯矩阵基线。 |
| 需求变更记录及 Issue＋PR 通道 | 已有[协作约定](../../../CONTRIBUTING.md)、[Issue 模板](../../../.github/ISSUE_TEMPLATE/)和 [PR 模板](../../../.github/pull_request_template.md)。待随正式 SRS 基线整理本轮变更及对应评审证据。 |

课堂可用[当前工程进度](../../README.md)和[真实站点验证](../../design/导航Harness-真实站点验证-2026-11-23.md)说明已实现的引导闭环。调研出处、上周故事与演示见[第 1–2 次课材料](../week10/README.md)。

**要求出处**　教师资料《第 02 课：教师与学生的对话》第 4 页给出故事 Issue 检查点，《第 03 课：学生讲解项目需求》第 1 页给出用例图、评审、基线与追溯要求。[课程时间表与来源索引](../课程任务与时间节点.md)
