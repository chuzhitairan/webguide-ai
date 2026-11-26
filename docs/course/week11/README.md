# 第 11 周 · 需求评审与 SRS 定稿

第三次课按现有排课推算为 2026-11-27。第 2 课补充讲义要求故事相关的仓库材料在下次课前一天 24:00 前入库，按此推算为 11 月 26 日 24:00。课堂安排以教师最新通知为准。[第 11 周 Milestone](https://github.com/chuzhitairan/webguide-ai/milestone/2)

2026-11-26 已登记故事并提交评审稿。[评审材料总览](https://github.com/chuzhitairan/webguide-ai/blob/400db9d/docs/course/week11/评审材料.md) · [SRS v0.3 草稿 PR #37](https://github.com/chuzhitairan/webguide-ai/pull/37) · [评审跟踪 Issue #36](https://github.com/chuzhitairan/webguide-ai/issues/36)

## 课前与课堂检查

| 检查项 | 对应材料和状态 |
| --- | --- |
| 上周遗留检查：至少 20 条用户故事 Issue，其中性能、安全、可用性至少各 1 条。给每条写 Given/When/Then，打 `story` 标签，指派负责人，链接调研证据。 | [已登记 23 条](https://github.com/chuzhitairan/webguide-ai/labels/story)，每条已链接依据、用例与验收，并分派给五个组员账号。第 10 周的 [14 条初稿](../week10/用户故事.md)随历史材料归档。 |
| 完整用例图应标明主、次参与者，课堂讲解场景与非功能需求。 | [20 个功能用例图](https://github.com/chuzhitairan/webguide-ai/blob/400db9d/models/WebGuideAI-用例图.svg)标明 3 个主参与者和 2 个次参与者。评审稿有 3 个细化场景及 3 个非功能验收用例。 |
| 课前提交 SRS 草稿 PR。 | [PR #37](https://github.com/chuzhitairan/webguide-ai/pull/37)已提交，待实际评审。草稿区分组内预览原型和后续的本机经验、共享经验。 |

## 评审后交付

| 交付 | 已有依据和下一步 |
| --- | --- |
| SRS v1.0 Release，附变更记录 | 课堂评审关注需求是否可测试、完整、一致。评审签字后再定稿发布，请从 [Releases](https://github.com/chuzhitairan/webguide-ai/releases)核对状态。 |
| 需求追溯矩阵 v0 | [矩阵草稿](https://github.com/chuzhitairan/webguide-ai/blob/400db9d/docs/course/week11/追溯矩阵-v0.md)逐条关联需求 ID、用例、故事 Issue 和依据，正式基线待评审确认。 |
| 需求变更记录及 Issue＋PR 通道 | PR #37 含[变更记录](https://github.com/chuzhitairan/webguide-ai/blob/400db9d/docs/requirements/需求变更记录.md)和[需求变更模板](https://github.com/chuzhitairan/webguide-ai/blob/400db9d/.github/ISSUE_TEMPLATE/requirement-change.md)。已有[协作约定](../../../CONTRIBUTING.md)和 [PR 模板](../../../.github/pull_request_template.md)。 |

课堂可用[当前工程进度](../../README.md)和[真实站点验证](../../design/导航Harness-真实站点验证-2026-11-23.md)说明已实现的引导闭环。调研出处、上周故事与演示见[第 1–2 次课材料](../week10/README.md)。

**要求出处**　教师资料《第 02 课：教师与学生的对话》第 4 页给出故事 Issue 检查点，《第 03 课：学生讲解项目需求》第 1 页给出用例图、评审、基线与追溯要求。[课程时间表与来源索引](../课程任务与时间节点.md)
