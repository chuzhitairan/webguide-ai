# GitHub 协作适配契约 v0.1

日期：2026-11-18。SC02 设计草案，输入为[首场景规格](../requirements/GitHub协作首场景规格-v0.1.md)，复用[通用运行契约](WebGuideAI-运行契约-v0.1.md)的消息、会话与证据机制。本文确定接口和核对方法，真实 GitHub 定位表在实现中验证。

## 1. 采用方式与格式

沿用“通用步骤骨架＋任务专用校验器”：运行器管理步骤和会话，`github_collaboration_v1` 负责 GitHub 对象关联。把所有跨页条件做成通用 DSL 会增加首轮工作量；把 GitHub 逻辑放进协调器会妨碍复用，因此均不采用。这是既有架构在 SC02 上的适配。

- [v2 Schema](contracts/tutorial-v2.schema.json)仅新增 `action: input`，表示用户输入，扩展不替用户填表。所有字段沿用 v1，仍拒绝未知字段。
- [v1 Schema](contracts/tutorial.schema.json)与 [Pages 样例](contracts/pages.tutorial.json)原样保留。加载器按 `schemaVersion` 分派独立校验器；v1 不接受 input，其他版本返回 `UNSUPPORTED_SCHEMA_VERSION`，不静默迁移。
- [协作样例](contracts/collaboration.tutorial.json)包含 12 个操作步骤，对应 SC02-A 的 8 个业务步骤。一个业务步骤可拆成打开、输入和提交；教程不固定仓库、账号、Issue 或期望文本。
- 定位器和 checker 必须在运行构建中注册。设计描述表只用于校验样例引用；未实现的能力不能因此开放运行。

页面内说明按纯文本显示，目标动态取任务卡中的参数；不引入可执行模板或任意变量表达式。多控件表单由适配器按本地已观察阶段选择一个定位器分支，阶段明确且恰有一个可见目标时才指示，否则待确认。它只决定本步指向哪里，不能另行改变全局步骤。

### 业务阶段与教程步骤对照

| SC02-A 业务阶段 | 协作样例的稳定 step id（按执行顺序） |
| --- | --- |
| 1 确认任务 | inspect-issue |
| 2 认领任务 | claim-issue |
| 3 创建工作分支 | open-branch-menu → name-working-branch → create-working-branch |
| 4 编辑文档 | open-document-editor → edit-document |
| 5 提交修改 | commit-document |
| 6 准备 PR | inspect-comparison |
| 7 发起 PR | describe-pr → create-pr |
| 8 核对并交接 | verify-handoff |

本表用于规格追溯和阅读，不新增 stageId 或改变 v1／v2 Schema；运行器按 steps 顺序执行。首轮侧栏可只显示 12 步，后续确需通用分组时再设计格式，不把这份 SC02 对照写进通用协调器。

## 2. 任务与自动绑定

`CollaborationTarget` 是 TaskTarget 的一个 profile，字段如下。`unknown` 与空集合区分：未读到负责人不是“无人负责”，未读全文件不是“没有其他文件”。

| 字段 | 定义 |
| --- | --- |
| profile、targetRevision | 固定 `collaboration_pr_v1`；修订从 1 递增 |
| repo、issueNumber、member | 仓库 owner/name、正整数 Issue 编号、目标登录名；已登录账号另读并匹配 |
| baseBranch、headBranch、documentPath | 用户确认的基准／工作分支和相对 Markdown 路径；head 与 base 不同，不允许跳出仓库的路径 |
| expectedEdit | `{before,after,practiceMarker}`；非空、before≠after，marker 为本任务唯一文本且包含于 after、不得包含于 before |
| reviewer、projectUrl | 可选，仅用于交接／概念说明；不是通过前提 |
| branchStart | `{sha,sourceObservationIds}` 或 null；新建时记录确认的 base HEAD 与创建后 head 相同的完整提交身份 |
| commitAnchor | `{sha,sourceObservationIds,confirmedAt}` 或 null；保存后自动提出候选、显示修改摘要，由用户确认“核对这次修改”后固定 |
| prBinding | `{number,url,sourceObservationId}` 或 null；已建立的真实 PR；比较页不能填入 |

本稿建议将首轮练习限定为：一个 UTF-8 Markdown 文件，base 文件中 before 恰好出现一次，本次预期文件为替换一次后的精确结果。只规范 CRLF 为 LF，不 trim、不忽略其他修改；完整文件最大 **128 KiB**（规范换行前后的 UTF-8 均不超限）。这让“只做了约定修改”可计算，不试图评估文档语义质量。真实访谈、代码重构等以后使用其他任务 profile。

分支来源优先用创建前后的观察证明；已有分支无法从名称推断创建来源。恢复同一任务可使用有效历史与重查结果；首次导入已有进度时，用户确认目标分支／提交，重新核对当前 base/head、完整差异与唯一练习标记。无法证明旧分支的创建动作则显示“已有分支已核对”，不补造创建历史。已有 PR 的提交锚点从其提交列表及对应文件结果提出，仍需同样确认。

新仓库／成员／Issue 建新任务；改分支、路径、预期修改、锚点或 PR 对象要显示影响并确认，增加 targetRevision，旧关联证据退出当前集合。base/head 自身更新是“发现版本变化”，先撤销结论并重查，不自动替换锚点。后续提交仍包含已确认修改时，用户可明确重绑新锚点。

## 3. 页面角色、采集与最小字段

公共 Observation 信封沿用运行契约。payload 只包含下表字段及 `availability`；每种对象键由可信绑定和目标参数共同确认。完整 SHA 必须来自可核对的完整提交链接等明确来源，短 SHA 不补猜。

| role／kind | 对象键 | 必要 payload |
| --- | --- | --- |
| issue／collab.issue | repo+issueNumber | number、state、assignees、loggedInMember；负责人列表完整性 |
| repository-branch／collab.branch | repo+branch | branch、headSha；分支表单的 sourceBranch/sourceSha、nameMatches、collision 状态（可未知） |
| repository-file／collab.file | repo+baseSha+headSha+path+side | side=base/head、commitSha、path、contentHash、byteLength、complete；base 另给 beforeCount、markerAbsent、expectedHeadHash，见下文 |
| file-editor／collab.editor | repo+headBranch+path | contextMatches、editorReadable、dirty=true/false/unknown、previewMatches=true/false/unknown、formStage；提交对话框另读 commitMode=current-branch/new-branch/unknown、destinationBranch 或 unknown，不返回输入正文／提交说明 |
| commit／collab.commit | repo+commitSha | sha、parentShas、branchContext、目标文件读取引用；父提交列表完整性 |
| comparison／collab.comparison | repo+baseSha+headSha | base/head 分支及完整 tip SHA、completeFiles、files[{oldPath,path,status}]、completeCommits、commitShas、fileObservationIds、formStage、titlePresent、issueReferenceMatches |
| pull-request／collab.pr | repo+number | author、base/head 仓库和分支、baseSha/headSha、state、isDraft、issueReferenceMatches、reviewRequests、reviewState、checksState；未知字段单列 |
| pull-request-files／collab.diff | repo+PR号+baseSha+headSha | complete、fileCount、files[{oldPath,path,status}]、expectedEditMatches、相关文件证据 ID |
| pull-request-commits／collab.pr-commits | repo+PR号+headSha | complete、commitShas；是否包含锚点须从完整列表核对 |

同一 URL 根据内容可能处在分支查看、比较或提交表单阶段；角色需验证仓库／对象，不能仅凭路径猜成功。Commit 对话框仍属于 file-editor；PR 提交表单属于 comparison。适配器从浏览器 sender 取得 URL、文档和标签身份，继承 SPA／新标签绑定规则。

采集器按当前步骤按需读取已授权目标页面；补证页可显示明确入口，用户自行导航。未保存输入为 true 或 unknown 时先提醒保存／保留，扩展不自动跳页。提交后核对文件／commit／PR 的补证可以跨标签；不要求当场同时打开所有页。

完整正文只在页面内存用于本地比对，采集返回摘要。128 KiB 是本地文件读取上限，单条消息仍为 64 KiB，不传正文绕过消息限额。折叠／截断／分页未遍历完、文件过大／二进制／重命名、无法读取原始文本或完整 SHA，均返回 unknown 和具体补查位置。首轮不解析隐藏框架内部状态、不申请 GitHub API 令牌；真实 DOM 无法支持的项明确列入适配缺口，不能让 AI 代判。

### 不可变文件的源码读取路径

首个真实 GitHub 适配方案使用用户可见的 **Code 源码视图**：从已核对的提交／比较／PR 对象取得完整 baseSha、headSha 和指定路径，给出相应不可变文件页的补证入口，由用户打开并在需要时切到 Code。采集器重新确认仓库、完整提交身份、路径和源码视图，只在本地读取完整原文；Markdown Preview 或渲染后的段落不作原文来源。GitHub 的视图区别见[非代码文件说明](https://docs.github.com/en/repositories/working-with-files/using-files/working-with-non-code-files)。

Code 视图存在不等于 complete=true：须在真实页面验证完整性，包括空行、Unicode 和末尾换行。不得把行号、折叠提示或加载占位混入正文，也不依据惯例补造末尾换行。无法可靠读取任一部分即 read-incomplete／unknown，提示缺哪一份源码，不反复要求用户重做提交。补证仍属于当前步骤，不另计为业务阶段；编辑器有未保存输入时先提示保留，再由用户决定导航。

把“不可变 SHA 身份＋Code 原文读取”作为[工程启动后的短验证](首轮工程实施计划-2026-11-18.md#真实-github-源码短验证)，在模拟采集与页面接线前尝试。发现缺口时先记录并确定补证路径，再扩展真实 GitHub 适配。页面上下文 fetch／Raw 是后续备选，须分别验证私有仓库授权、重定向／实际来源、响应为原文及读取边界后再修订契约。模拟页显式提供同一不可变版本的源码／预览切换，用来验证视图选择和摘要规则。

PR 文件列表和提交列表必须完整；只看到第一项不能设置 complete。文件比对读取 baseSha 和 headSha 指向的不可变版本（禁止拿最新分支正文冒充某 SHA 的文件）；完整 changed-files 列表仅有指定路径且状态为 modified。比较／PR 版本变化使这些摘要失效。

跨页比对不搬运正文：CHECK_REQUEST 的必要参数带 `{baseSha,headSha,path,side,expectedEdit}`，先核对当前文档确属其中 side 的不可变版本。base 页面在本地检查 before 恰好出现一次、整个 base 正文不存在 practiceMarker，再计算规范 LF 后原文的 contentHash 和替换一次后的 expectedHeadHash；head 页面只计算规范 LF 后正文的 contentHash。两者用 SHA-256，UTF-8 输入。纯校验器要求同 repo/baseSha/headSha/path/targetRevision、两份 complete、beforeCount=1、markerAbsent=true，且 head.contentHash=base.expectedHeadHash，才产生 expectedEditMatches；既不让单个页面自报这个跨页结论，也不需要协调器保存原文。diff payload 中的 expectedEditMatches 由本地校验器产生，不接受网页同名字段作为依据。

## 4. 注册能力与步骤检查

下表 locatorId 均以 `collab.` 开头，checkerId 同样以 `collab.` 开头；名称与样例一一对应。定位表具体 CSS／可访问名称在实现任务中固定并回归。

| checkerId 后缀 | readRoles | locatorId 后缀／通过条件 |
| --- | --- | --- |
| issue-context | issue | issue-summary；正确开放 Issue、账号与目标匹配 |
| issue-assigned | issue | assignees-or-assigned-status；完整负责人列表中包含 member 且没有未处理的他人占有冲突 |
| branch-form | repository-branch | branch-menu；正确 base 的分支表单可用，或已有已确认 head |
| branch-name-ready | repository-branch | branch-name；来源及名称匹配、无已知冲突，或已有已确认 head |
| branch-ready | repository-branch | create-branch-or-branch-status；实际 head 已建立，来源观察或已有进度导入已确认 |
| editor-open | repository-file、file-editor | edit-file；正确 head/path 的编辑器已就绪，或已取得有效提交证据 |
| edit-context | file-editor、repository-file | document-editor；正确可读编辑器中的约定修改本地预览匹配，或有效已提交文件匹配；仅证明可进入提交步骤 |
| commit-saved | file-editor、repository-file、commit | commit-or-saved-status；本次锚点已确认，匹配的不可变文件已保存，不能用 dirty=false 或提示条代替 |
| comparison-ready | comparison、pull-request-files、pull-request-commits、pull-request | comparison-summary；base/head 与完整差异符合第 3 节，提交列表含锚点；已存在正确 PR 可用同条件跳过新建 |
| pr-description-ready | comparison、pull-request | pr-description；标题非空、正文普通引用目标 Issue，或已存在正确 PR；不持久化填写正文 |
| pr-created | comparison、pull-request | create-pr-or-existing-link；实际 PR 身份、作者、分支及普通引用匹配；尚无 PR 时可引导创建，Draft 时可指示用户确认内容后 Ready，但本步保持未交付 |
| pr-handoff | issue、repository-file、commit、pull-request、pull-request-files、pull-request-commits | pr-summary；调用下节终验器 |

缺少结果页面但当前操作前提满足、唯一目标可操作时返回 actionable；正在提交且结果未定返回 wait，提供查现有结果路径；缺关键字段返回 unknown。已知对象冲突／失败返回 blocked。普通已完成步骤可以新查后跳过；返回查看旧步骤遵守 review 模式，不重复网站操作。输入步骤通过不等于保存步骤通过，最终判断不依赖点击记录。

原生表单可能多次局部重绘。`commit-or-saved-status` 在编辑器按钮、提交对话框说明输入、提交去向、确认按钮、已保存摘要中选择唯一明确的当前阶段；每阶段先核对目标分支。打开提交对话框后，只有 commitMode=current-branch 且 destinationBranch=headBranch 时才指示最终提交；选中 new-branch 时先指示用户改为提交到当前工作分支，去向读不清返回 unknown。选项不可改或当前分支不符时返回 blocked；不要求关闭分支保护。用户已经另建分支并提交时明确报告目标偏离，保留已保存结果入口；只有用户确认改目标、增加 targetRevision 并重查后才能绑定新分支，不静默接纳。

`pr-description` 在标题缺失时指标题，否则指正文；`create-pr-or-existing-link` 在尚无结果时指创建入口，已知 Draft 且其内容证据已满足时可指 Ready for review，普通 PR 只提供实际 PR 链接／摘要。选择规则不能靠“取第一个可见按钮”，读不清阶段即停止指示。提交去向符合只是操作前提，commit-saved 仍需锚点及已保存文件结果。提交选项的平台依据见[编辑文件](https://docs.github.com/en/repositories/working-with-files/managing-files/editing-files)。

## 5. 终验与版本一致性

`evaluateCollaboration(input: EvaluationInput): Decision` 是本地纯函数，与通用 evaluate 输入一致；由已注册 `github_collaboration_v1` 终验器调用。共同过滤器先剔除不匹配的任务、目标修订、文档、请求、时间与未知／失败观察。

按顺序要求：①Issue 开放、实际指派符合；②确认的提交与工作分支／指定文件匹配；③实际 PR 同仓库、作者=member、base/head=目标且不同；④当前 PR 的 headSha 等于确认的 commitAnchor.sha，完整提交列表包含它；⑤PR 当前 baseSha/headSha 对应的完整单文件差异符合 expectedEdit；⑥普通引用指向同仓库的正确 Issue；⑦PR Open 且非 Draft。七项全部成立时在 `reasonCodes` 加 `submission-verified`，`evidenceIds` 保留本轮提交证据。当前无已知交接阻塞时返回 `pass`，正常路径显示“本段提交已验证，等待成员评审”，并展示 PR 与证据时刻。协调器按通用完成守卫写最终结果。

这里采用“锚点等于本次已核对 head”简化首轮版本关联。head 追加提交后，即使原锚点仍在列表，也先失效重查并提示确认新版本；base 更新同样使差异重查。新鲜证据不代表远端原子快照：终验前重查 PR tip 身份，再复用相同不可变 SHA 的文件摘要；检查期间有已知更新则重启本轮检查。

普通引用只接受正文中可解析的 `#编号`、`owner/repo#编号` 或目标 Issue URL，并规范化为目标对象；不把代码块／行内代码中的示例、其他仓库相同编号或评论区引用当作正文引用。不要求 closing keyword，也不声称建立了自动关闭关系。

| 条件／reasonCode | Decision／展示 |
| --- | --- |
| evidence-missing、evidence-stale、read-incomplete | unknown；列出缺项和补证页，不使用旧成功 |
| submit-in-flight | wait；核对现有提交／PR，不连续重复创建 |
| object-mismatch、extra-files、unexpected-edit、assignee-conflict | blocked；展示具体差异，保留用户更正路径 |
| anchor-changed | unknown；撤销旧通过，需确认并核对新的提交 |
| pr-draft | 步骤 checker 在内容证据符合且 Ready 入口唯一可用时返回 actionable；终验始终 unknown，草稿未交付 |
| pr-closed | blocked；已关闭未合并，不重复新建 |
| pr-merged | 终验 unknown＋historical-merged；独立展示历史已合并状态，用户选择结束后协调器才写 ended／incomplete |
| review-changes-requested／checks-failed | 先核对七项提交证据。全部成立时仍保留 `submission-verified` 和相应证据，并在 `reasonCodes` 加入当前交接阻塞原因；两项同时出现时均保留。终验返回 `blocked`，会话停在交接步骤，用户处理后重查。 |

终验只返回 `pass`／`wait`／`blocked`／`unknown`。提交证据缺失、过期或冲突时优先报告对应结论，本轮 `reasonCodes` 不含 `submission-verified`。带 `submission-verified` 的 `blocked` 表示当前提交证据齐全、交接待处理，此时协调器保持 `state=blocked`、`result=null`。用户主动退出则遵循通用退出规则，已核对的历史依据保留观察时间。Reviewer 未配置／未请求／已请求、尚未评审／已批准、CI 未知／运行／通过及 Project 状态依实际观察显示。pr-merged 路径由协调器接纳明确结束意图后结束，用户也可保留历史查看。

## 6. UI 与 AI 投影

侧栏任务卡显示仓库、Issue、member、base→head、路径、预期改动摘要和提交段终点。用户输入、网页保存、规则核对分开显示。关键文案包括“输入尚未提交”“已建立草稿，尚未交付评审”“未请求评审”“核对新提交版本”。Project Open 解释为看板尚未关闭。

本地可读必要账号与私有仓库身份，默认 AI 只收到匿名对象别名、步骤、规则原因及匹配布尔摘要；不送账号、私有 URL、文件正文、diff 或编辑器输入。任务卡原文和 expectedEdit 默认也不发模型。AI 不可用时保留固定概念说明与操作提示；回答绑定通用 contextToken，旧上下文返回不覆盖当前步。仅答疑不清除仍合法的高亮。

首轮工程切片不接收反馈，可先提供本机草稿预览、删减、导出及清除，并明确“尚未发送维护者”；最简反馈仍是完整首版要求，接收端及可见范围／保留约定应在该能力实现前明确，并在首版发布前完成实际接收与清除验收。与[交付范围](../requirements/版本交付范围-2026-11-17.md)一致，不能用草稿声称正式反馈闭环已完成。

## 7. 实现顺序与验收归属

按[更新实施计划](首轮工程实施计划-2026-11-18.md)先建立共享加载器和通用运行闭环，期间提早核对真实 Code 视图的可读性。模拟协作适配器使用独立 fixture profile／adapter；基于短验证结果，沿同一接口接入真实 GitHub 定位与采集，随后集成 AI、反馈并安排真人首次试用。

SC02-AC01–10 主要由目标、采集与校验器实现；AC11–12 由通用协调器、页面代理和 UI 实现；AC02／13 的模型部分及 AC14 的反馈清除在后续切片落实。当前文件定义预期，没有实际通过记录。

复用：Driver.js 负责单目标高亮；参考[源码索引](../../research/notes/源码阅读索引.md)中 OnTheWay 的步骤组织、Usertour 的定位监测和 Nanobrowser 的页面身份；不搬整套 SaaS／Agent 工程。GitHub 流程依据沿用[SC02 的官方来源](../requirements/GitHub协作首场景规格-v0.1.md#7-核查来源)。
