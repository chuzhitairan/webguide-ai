# 第 11 周 · 需求评审与 SRS 定稿

按现有排课，第三次课为 2026-11-27。故事材料应于 11 月 26 日 24:00 前入库。老师安排每组约 8 分钟讲解完整需求，随后逐组评审。

**课堂投屏**　[代讲讲稿](../week10/presentation/week11/代讲讲稿.md) · [7 页 PPTX](../week10/presentation/week11/WebGuideAI-第11周需求评审.pptx) · [SRS v0.3](../../requirements/WebGuideAI-SRS-v0.3.md) · [评审材料总览](评审材料.md)

[SRS 草稿 PR #37](https://github.com/chuzhitairan/webguide-ai/pull/37) · [评审 Issue #36](https://github.com/chuzhitairan/webguide-ai/issues/36) · [本周 Milestone](https://github.com/chuzhitairan/webguide-ai/milestone/2)

## 课前与课堂检查

| 检查项 | 对应材料和状态 |
| --- | --- |
| 至少 20 条用户故事 Issue，性能、安全、可用性各至少 1 条。每条有 Given/When/Then、`story` 标签、负责人及依据链接。 | [已登记 23 条](https://github.com/chuzhitairan/webguide-ai/labels/story)，含 20 条功能、3 条质量故事，已分派给五名组员。[完整故事清单](用户故事.md) |
| 完整用例图，标明主、次参与者。 | [20 个功能用例图](../../../models/WebGuideAI-用例图.svg)含 3 个主参与者、2 个次参与者和三阶段边界。[PlantUML 源](../../../models/WebGuideAI-用例图.puml) |
| 提交 SRS 草稿 PR。功能要求应有编号、描述和验收标准。 | [PR #37](https://github.com/chuzhitairan/webguide-ai/pull/37)已提交。[SRS 附录 A](../../requirements/WebGuideAI-SRS-v0.3.md#附录-a-功能用例规格)逐条列出 20 个用例的需求、流程和通过条件。 |
| 讲解典型场景、非功能需求与约束，供其他组提问。 | SRS 有 [4 个细化场景](../../requirements/WebGuideAI-SRS-v0.3.md#4-典型场景)及 [3 类非功能要求](../../requirements/WebGuideAI-SRS-v0.3.md#5-非功能需求)。[验收与证据](验收与证据.md)含复现条件、已有结果和待测项。 |

## 评审后交付

| 交付 | 已有依据和下一步 |
| --- | --- |
| 评审意见与签字 | 在 [Issue #36](https://github.com/chuzhitairan/webguide-ai/issues/36)记录实际意见、处理结果及确认。评审核对需求是否完整、可测试和前后一致。 |
| SRS v1.0 Release，附变更记录 | 评审通过后根据确认结果定稿，发 [Release](https://github.com/chuzhitairan/webguide-ai/releases)。 |
| 需求追溯矩阵 v0 | [矩阵草稿](追溯矩阵-v0.md)逐条关联需求、用例、故事 Issue、验收和来源，随定稿确认基线。 |
| 需求变更走 Issue 与 PR | [变更记录](../../requirements/需求变更记录.md)已有本轮来源和影响。[需求变更模板](../../../.github/ISSUE_TEMPLATE/requirement-change.md) · [协作约定](../../../CONTRIBUTING.md#需求变更) |

课堂可用[当前工程进度](../../README.md)和[真实站点验证](../../design/导航Harness-真实站点验证-2026-11-23.md)说明已实现的引导闭环。调研出处、上周故事与演示见[第 1–2 次课材料](../week10/README.md)。

**要求出处**　《第02课-教师与学生的对话》第 4 页给出故事 Issue 检查点。《第03课-学生讲解项目需求》第 1 页给出用例图、讲解、评审、基线及追溯要求。[课程时间表与来源索引](../课程任务与时间节点.md)
