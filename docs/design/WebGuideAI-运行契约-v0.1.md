# WebGuide AI 运行契约 v0.1

更新：2026-11-18。T03 设计草案，衔接[核心设计](WebGuideAI-核心设计-v0.1.md)与[完整 SRS](../requirements/WebGuideAI-SRS-v0.2.md)。本文定义通用引导运行机制，由 GitHub 协作与 Pages 两份教程样例检验格式边界；当前首场景是 GitHub 协作。教程获取、编辑发布和探索模块随后接入同一内容版本，不在此定义其全部业务接口。

2026-11-18 场景更新：发起人已将 [GitHub 小组协作入门](../requirements/首场景调整-GitHub协作-2026-11-17.md)调整为首个交付及展示场景。[协作适配契约](GitHub协作适配契约-v0.1.md)已补充 SC02 的任务身份、页面观察、能力注册和终验；本文的 Pages 专有部分保留适用范围，通用消息与会话机制由两种适配器复用。

当前输入为 [SC02 路径与验收草案](../requirements/GitHub协作首场景规格-v0.1.md)。格式 v2 在独立 Schema 中新增 input 动作；格式 v1 与 Pages 样例保持兼容。两者都不授权扩展代替用户填表或提交。

阅读顺序：第 1–2 节看通用格式，第 4–7 节看运行；SC02 专有部分看协作适配契约，第 3、8 节为 Pages，第 9 节为共用后端边界。结构源文件为[v1 Schema](contracts/tutorial.schema.json)、[v2 Schema](contracts/tutorial-v2.schema.json)、[Pages 样例](contracts/pages.tutorial.json)和[协作样例](contracts/collaboration.tutorial.json)。这是设计输入，尚未创建正式工程或验证真实 GitHub 定位器。

## 1. 采用的结构与责任

沿用已讨论的“通用步骤骨架＋已注册的适配器／任务校验器”。相比把 Pages 逻辑散落到运行器，它便于复用；相比通用表达式语言，它保留较小实现范围。模型只解释和生成候选，不参与运行时状态写入。

| 对象 | 保存什么 | 写入者／不放什么 |
| --- | --- | --- |
| TutorialVersion | 固定版本的步骤、定位依据、检查引用、来源、适用环境 | 维护者提供，后续由发布模块交付；不放本次仓库、提交、元素实例或进度 |
| TaskTarget | 用户确认的任务对象、版本意图、内容预期及后续确认的绑定 | 会话协调器；不随网页新提交静默改目标 |
| PageBinding | 标签、窗口、文档、导航修订、页面角色和对象身份 | 协调器根据浏览器发送端元数据和适配器结果建立；不信任消息自报身份 |
| Observation | 某时刻的必要字段、来源、采集身份和有效期 | 页面采集后由协调器接纳；不保存 DOM 节点、整页 HTML 或输入框内容 |
| SessionCheckpoint | 固定教程身份、目标、展示步骤、主状态、可保留证据和请求修订 | 协调器唯一写入；不放端口、元素引用、密钥或整个后端会话 |
| Decision／Answer | 规则结论／非权威解释，分别保存 | 本地规则／模型适配返回；AI 回答没有推进状态的入口 |

教程 JSON 只引用能力名称和有限数据条件，不接受 JavaScript、函数、远程脚本或任意条件表达式。Schema 与本文以外的未知字段拒绝加载；新增格式升 schemaVersion。未知适配器、规则、定位器引用或运行器版本不满足时提示不支持，不能执行一半后假装通过。

## 2. 最小教程格式

| 字段 | 含义 |
| --- | --- |
| schemaVersion／tutorialId／version | 格式版本、稳定教程 ID、内容版本；三者不与 taskId 混用 |
| title／goal／environment | 面向用户的说明及浏览器／页面语言范围 |
| adapterId／parameterProfile | 随扩展打包的适配器与参数格式；Pages 为 github_pages_v1／pages_branch_v1，协作为 github_collaboration_v1／collaboration_pr_v1 |
| sources | 来源 ID、标题、URL；步骤 sourceIds 必须引用其中项目 |
| steps | 有序步骤；每项有稳定 id、pageRole、说明、动作类型、target、check 和 sourceIds |
| finalVerifierId | 已注册的最终校验器；不因最后一项步骤通过就完成任务 |

Step 的 action 在 v1 中为 select、click、inspect、wait，v2 增加 input，表示用户应做什么，不指挥扩展点击或填表。input 的局部检查最多证明输入／预览条件，持久保存需后续独立结果证据。按 schemaVersion 分派校验器，未知版本明确拒绝，不把 v2 内容塞入 v1。target 为已注册 locatorId，或受限 CSS＋可选精确文本；后者为后续录制／编辑提供数据入口。CSS 仅在已获准页面内查找主文档目标，不执行代码；首版跨 frame／封闭 Shadow DOM 目标不支持时明确提示。定位结果分 unique-visible、missing、ambiguous、not-visible、unsupported、read-error，只有唯一且可见时可以展示指示。

check 有两种：dom 使用 exists／visible／text-equals／value-equals，可用 check.target 指定检查对象，省略时检查步骤 target；adapter 引用已注册的专有 checkerId。dom 断言只证明它检查的局部条件，不能证明保存、部署或业务成功；终验交给当前教程 finalVerifierId 对应的已注册校验器。

step.pageRole 表示当前操作／高亮所在页面，不要求它等于结果页面。每个已注册 checker 声明可读的 readRoles、所需观察种类及关联约束；协调器只向符合声明和目标身份的页面发检查请求。例如从设置页点击部署链接，指示留在设置页链接上，完成条件是关联 run 的工作流页面已打开；不能把任意工作流标签页当作成功。跨页等待期间先撤销旧指示，再在结果页面核对或显示具体导航提示。

加载除 Schema 外还要检查：step id 唯一、pageRole 属于所选适配器、所有引用可解析、定位依据语法可用、条件的参数存在及类型相符。具体 CSS／页面提取规则放在版本化适配器定位表，样例的 locatorId 不是已经验证的 GitHub 选择器。内容 hash 固定加载的文件；同一版本标识下内容不同则拒绝复用，后续发布按 SRS 的独立修订规则处理。

## 3. Pages 任务参数与版本锚点

TaskTarget 包含 targetRevision（从 1 递增）、repo={owner,name}、branch、directory（/ 或 /docs）、intent（latest-branch 或 specified-deployment）、expectedContent、siteBinding、commitAnchor。参数不写进教程 JSON。

expectedContent={text, locator?}：用户确认的有辨识度内容，text 非空；有 locator 时限于该区域，没有时由站点适配器在可见主文档文本中本地匹配，不默认发送正文到模型。#verification 只是可选定位依据，不强制用户修改首页或使用实验标记。站点匹配不单独证明提交版本。

| 时点 | 绑定规则 |
| --- | --- |
| 初次开始 | 确认仓库、分支、目录、内容和核对意图；commitAnchor／siteBinding 可为空，允许固定指引，终验保持待确认 |
| latest-branch | 在获准的目标分支页面读取完整提交 SHA，核对仓库与分支来源；显示“核对这次读取到的分支版本”供用户确认，记录 SHA、来源观察 ID 和确认时刻后固定 |
| specified-deployment | 用户明确选择某次部署并确认这是预期版本；核对所属仓库、Pages 工作流与完整 SHA 后固定。该模式明确是在核对所选部署是否对应当前发布，不等同于核对分支最新修改 |
| 读不到完整 SHA | 给出进入目标分支页或指定部署页重查的路径；不拿任意成功 run 的 SHA 静默填充 latest-branch 目标，不要求新手先手工寻找 SHA |
| 确认站点 | 从目标仓库 Pages 配置／关联部署读取 URL，规范化 HTTPS 主机和路径、展示确认；首次发布可在此时补齐。实际主机授权另行请求，自定义域名首版提示不支持 |
| 目标变化 | 新仓库创建新任务；同仓库改分支、目录、锚点、预期内容或重绑定站点，先停止指示，再显式确认并增加 targetRevision，使此前证据退出当前终验集合，历史另存 |

commitAnchor={sha, intent, sourceObservationId, confirmedAt}，完整 SHA 来自页面中可核对的完整提交链接等明确来源，不把短 SHA 补齐成猜测。确认的 siteBinding={url,sourceObservationId,confirmedAt} 不接受任务范围以外的跳转；修改主机需要新授权。用户取消补充绑定时可以暂停／退出，不能无限显示“核对中”。

目标确认卡属于任务参数流程，不把仓库／分支／内容输入复制成每份教程的固定步骤。辅助绑定 latest-branch 时，pages.branch-head 检查器只读取已核对的 repository-branch 角色；需要用户切分支或打开完整提交时，同样遵循唯一目标高亮和结果核对。参数确认完成后，样例从目标仓库 Settings、Pages 入口开始；已在目标设置页时按检查跳过已满足的导航，不重复要求点击。

## 4. 会话快照与有效证据

| 字段组 | 字段与规则 |
| --- | --- |
| 身份 | checkpointSchema=1、taskId、tutorial={id,version,contentHash}、target |
| 业务状态 | state=ready/checking/guiding/waiting/blocked/pending/paused/ended；result=null/system-verified/user-confirmed/incomplete；endedReason 单独记录 |
| 步骤 | displayStepId、frontierStepId、navigationIntent=advance/review；frontier 是尚需推进核对的位置，不等于展示指针 |
| 修订 | sessionRevision：每次已提交快照递增；contextRevision：步骤／页面／目标／暂停等使在途请求失效时递增；evidenceRevision：当前证据集合改变时递增 |
| 页面与界面 | owner={windowId,uiInstanceId} 或 null；bindings 记录必要 PageBinding；旧实例不能接管新 owner |
| 记录 | observations、stepChecks、stopStatus、updatedAt；answer 只保留经允许的最小结果，不存模型凭据 |

Observation 公共字段：id、taskId、targetRevision、tutorialIdentity、kind、pageBindingId、documentId、navigationRevision、requestId、observedAt、expiresAt、status（ok／unknown／read-error）、payload、invalidatedReason。observedAt／expiresAt 由协调器接纳时赋值，页面只能提交自己的采集时间作辅助。

当前可用证据必须来自已接纳请求、匹配目标修订、未过期且无已知相反证据。默认设计候选有效期 **5 分钟**，可配置并在正式结果检查前校准，独立于实验的 15 分钟或蓝框 10 秒租期。长时间部署需要重新核对前序证据；用户能看到哪些项需要更新。

重查范围由 targetRevision＋观察种类＋对象键定义，例如某仓库的配置、某个 runId 的工作流或某个站点 URL。派发该范围的新一轮检查时，旧观察退出当前判定集合并标为待更新；新结果 unknown／read-error 或超时，不能回退采用旧成功。旧请求的迟到消息不能覆盖新结果或再次失效它。历史继续可查；未获准或不相关的标签页在派发前拒绝，不借此覆盖目标对象的观察。

文档离开会使元素引用及该页面在途请求失效，不自动证明已经保存的历史配置观察为假；跨页终验可使用有效期内的历史快照。已知相关配置／内容变化则使相应证据失效。targetRevision 改变一律不跨目标复用。历史观察可以继续显示，但必须保留时间、失效状态，与当前证据集合分开。

首版并发设计建议：同一浏览器会话只保留一个活动引导 owner，暂停任务可留历史。其他窗口不能通过打开侧栏自动接管；用户明确暂停原任务后才可继续另一任务或转移窗口。UI_HELLO 只建立连接，继续动作才取得 owner；旧 owner 的断开事件不得暂停新 owner。后续多任务并发可另扩展，不把此实现取舍当作完整产品的功能上限。

## 5. 事件处理与推进

协调器每个任务串行处理短事件；网络采集／模型请求异步派发，不能占住队列等待整个请求。更新状态后先提交检查点，再向页面发允许采集／显示的命令。页面侧发现目标失效时先撤销本页指示，再上报；这一停止动作不需要等待协调器或模型。

| 事件 | 处理与约束 |
| --- | --- |
| USER_CONTINUE | 核对 owner 和目标，增加上下文修订，进入 checking；重新确认页面与证据后显示指示 |
| USER_BACK | displayStepId 后退、navigationIntent=review，失效旧请求并重查；不清空历史、不撤销网站操作；即使旧步骤已满足也不自动跳回前方或结束 |
| USER_ADVANCE | review 时返回 frontier 并重查；advance 时按当前步骤规则评估，不靠按钮直接写通过 |
| CHECK_RESULT | 先验证身份／顺序，再接纳证据与评估；pass 允许按步骤顺序推进；actionable 表示正常未满足且有明确可操作目标，进入 guiding；wait／blocked／unknown 分别进入等待／受阻／待确认 |
| LOCATION_INVALIDATED | 撤销目标引用，更新导航修订并失效相应请求；与变化有关的证据失效，重新定位不携带旧坐标 |
| USER_PAUSE／UI_LOST／EXIT | 立即停止本地指示，增加 contextRevision、取消可取消请求，提交暂停／结束并向所有关联页面发停止命令；端口断开只表述为连接中断 |
| AI_RESULT | 只更新匹配当前回答槽位的解释；不改步骤、规则结论和任务结果 |

终验只有 navigationIntent=advance、全部必要步骤条件及最终条件成立时才可形成 system-verified。已保存配置等重复步骤可在新检查明确满足时前进；review 模式下仅显示已满足。user-confirmed 与 incomplete 由用户明确结束意图产生，不能显示为系统验证成功。

## 6. 扩展消息与页面身份

协议版本为 1。公共信封为 {protocolVersion,type,messageId,coordinatorEpoch,taskId,contextRevision,payload}；初次 HELLO 不带 epoch／任务身份，握手返回当前 epoch；后续消息必须回带它。停止消息另带 stopEpoch，见下文。消息大小候选上限 64 KiB，超限拒绝，不能截断后仍当作完整证据。

| 方向 | 消息 | 主要字段 |
| --- | --- | --- |
| 界面→协调器 | UI_HELLO／USER_* | uiInstanceId、由连接确认的窗口、expectedSessionRevision；同一 epoch 内重复 messageId 返回原提交结果，不重复执行命令 |
| 页面→协调器 | PAGE_HELLO | capability 信息；协调器从 sender 取 tabId、windowId、frameId、documentId、URL／origin，核对主 frame、当前对象与权限后建立 bindingId |
| 协调器→页面 | CHECK_REQUEST | requestId、checkSequence、bindingId、documentId、navigationRevision、targetRevision、stepId、checkerId、必要参数；页面在读取前再次核对地址及本地活动上下文 |
| 页面→协调器 | OBSERVATION／LOCATION_INVALIDATED | 原请求身份、bindingId、导航修订及结构化字段；documentId 与 tab 身份仍以浏览器端点为准 |
| 协调器→页面 | SHOW_GUIDE／STOP | SHOW 绑定当前目标、请求与页面修订；STOP 带 stopEpoch 和原因，页面先清除指示／采集再应答 |
| 页面→协调器 | STOP_ACK | stopEpoch、bindingId、原文档身份、已停止或失败；只解除对应文档的等待项 |
| 协调器→界面 | SESSION_SNAPSHOT／ERROR | 已提交 sessionRevision、业务状态、当前证据与停止状态；UI 不自行合并不同版本进度 |

接纳观察时同时核对 coordinatorEpoch、taskId、targetRevision、教程内容身份、contextRevision、binding、浏览器发送端文档及窗口、navigationRevision、原 requestId、当前 checkSequence 和数据格式。checkSequence 在同一任务的检查范围内单调递增，只有该范围最新且仍有效的请求能写入。旧消息不写当前状态；同一检查的重复 observationId 只接纳一次。缺少可靠文档身份时停止本页自动检查，给出重新打开页面等补充路径。

普通 USER_* 修订冲突返回最新快照，UI 明确核对后重发。当前已授权 owner 的 PAUSE／EXIT 属于停止意图，不因 UI 的 expectedSessionRevision 落后而被拒绝；旧 owner 或旧 epoch 仍拒绝。重启不恢复内存去重结果，旧 epoch 命令必须重新握手后由用户核对意图，不盲目重放。

普通整页导航换 documentId；SPA 路由或相关 DOM 目标失效增加 navigationRevision，即使 URL 不变也使旧定位失效。滚动只更新仍有效目标的位置，不增加全任务修订。监听组合与定位表是适配实现细节，但必须提供 URL 变化和 DOM 替换两条失效入口；不能只监听 DOMContentLoaded。

## 7. 暂停、重启与权限

stopStatus={epoch,pendingBindings,failedBindings}。发 STOP 后未收到 ACK 的页面保持“停止确认中”，不能把界面 paused 文案当作全部页面停止证明。旧文档断开按已失联记录，不把它算成已收到 ACK；页面在失联时自行清除指示并停止任务观察。正常消息恢复前先核对检查点；失联兜底的有限指示／采集租期及更新时间在正式页面实现中明确，不能沿用实验 10 秒作为产品承诺。

页面按 coordinatorEpoch／contextRevision 和单调 stopEpoch 核对显示与停止命令。恢复后旧上下文的 STOP 不得清除新上下文指示；旧 ACK 只更新它对应的停止记录，不把新会话改回暂停。新 epoch 握手先清除页面旧任务上下文，再取得新授权。

会话检查点使用 storage.session，按 taskId 保存一个完整快照。协调器是唯一写者，保存失败则拒绝发布新的可操作快照并保守停止；不将多个 key 的读写当作跨记录事务。内存有在途序号，检查点只存足够重建的信息，不存 pending Promise。任务数、观察历史与存储配额上限在工程配置中给出，达到上限提示清理，不能静默删除仍用于当前结果的证据。

首轮容量策略仅清理已过期／明确失效且不用于当前结论的历史；仍超限则拒绝新增任务／观察，暂停活动引导并提示用户清理。不做优先级裁剪、压缩或归档，容量满也不能拒绝暂停／退出。stopStatus 采用已绑定文档的待确认／失败集合，页面租期采用单一有限计时器；保留旧上下文隔离，不增加通用重试调度。具体限额和租期取值见[当前实施计划](首轮工程实施计划-2026-11-18.md)。

service worker 启动生成 coordinatorEpoch，检查点中活动任务先恢复为 paused/recovery-required；不重建旧 pending 请求。页面和 UI 重新握手，用户明确继续后重查；原 paused／ended 保持不动。缺失／格式不兼容／损坏快照不推断成功，提示重新开始。本轮未测的真实后台恢复不阻止契约成稿，测试放在正式实现中。

权限设计建议为 sidePanel、storage、scripting，加任务所需的可选主机授权：github.com 与实际发布站点主机。按任务需要动态注册内容脚本、启动时核对注册状态，注册本身不允许采集；页面读取另受当前任务、仓库／URL 路径、角色与状态约束。指定 persistAcrossSessions=false 并处理既有打开页面注入；暂停停止观察，退出清理任务注册，用户可撤销浏览器授权。不要默认申请整个 *.github.io；Github 主机授权也不允许读取其他仓库。

## 8. 本地校验器契约与 Pages 终验

调用形态为 evaluate({tutorialIdentity,target,stepId,intent,observations,locations,now}) → Decision，**纯函数、无网络和页面写入**。locations 是经过身份核对的定位摘要，含 binding／文档／导航修订、目标定位结果及可操作状态，不含 DOM 节点。采集由页面适配器完成；运行器调用已注册 checker 或 finalVerifier，校验器不能自己访问 storage、推进会话或调用模型。

Decision={status:pass/actionable/wait/blocked/unknown,reasonCodes,evidenceIds,missing,conflicts,allowedNextStepId?}。actionable 用于条件尚未满足、必要前提已知且当前操作目标唯一可见的情况，如分支未选对或修改待保存；校验器不替代定位模块认定目标可操作。缺失／歧义目标进入 unknown，外部部署进行中为 wait，已知权限不足或部署失败为 blocked。普通 DOM 断言未满足不自动等于 blocked；能否操作仍须结合步骤和定位结果判断。

allowedNextStepId 仅是建议，须属于教程声明的顺序或已注册恢复路径，协调器核对推进意图后决定。finalVerifier 不返回 actionable，其 pass 也要经过协调器的最终完成守卫。DOM exists／visible 不能替代下面的专业字段。

| Pages 观察种类 | 最小业务字段 |
| --- | --- |
| dom | 页面角色、检查目标描述、断言、匹配数、可见性及必要匹配值；不持久化节点实例 |
| branch-head | repo、branch、完整 sha、来源 URL／完整提交链接；用于锚点候选 |
| settings | repo、sourceMode、selectedBranch／directory、savedConfiguration 或 unknown、关联部署 runId 或 unknown、liveSiteUrl 或 unknown |
| workflow | repo、runId、workflowKind、branch、完整 commitSha、status、siteUrl；未知／缺失字段不补猜测 |
| site | 规范化当前 URL、内容匹配结果、匹配范围、必要短证据；不从正文中推测提交 SHA |

savedConfiguration 必须有与对应值关联的已保存来源，例如新加载页面的明确配置报告或保存确认；单靠下拉框当前值、Save 灰显或“currently being built”字符串不够。运行时保留 selected 与 saved 的区别，无法确认就 unknown。

终验依次检查：①目标锚点及站点已确认；②三类当前可用观察匹配同一 targetRevision；③配置为目标分支／目录且已保存；④设置关联 runId 与工作流一致，确为该仓库 Pages 部署，完整 SHA 等于锚点；⑤工作流成功且站点 URL 与确认目标及内容观察一致；⑥预期内容匹配且无已知更新／冲突。条件不足 unknown，排队运行 wait，已确认失败／配置冲突 blocked，全部满足 pass。这是各时刻观察的一致性核对，不是远端网站的原子快照。

首版适配器注册表至少声明以下能力，名称与样例一致：

| checkerId | readRoles | 条件与关联 |
| --- | --- | --- |
| pages.branch-head | repository-branch | 参数确认阶段读取已确认仓库／分支的完整 SHA 候选，不从部署倒推 latest-branch |
| pages.settings-open | repository、repository-settings、pages-settings | 目标仓库设置或其 Pages 页已就绪；否则在仓库页指示 Settings 链接 |
| pages.pages-open | repository-settings、pages-settings | 目标仓库 Pages 设置已就绪；否则在设置侧栏指示 Pages 链接 |
| pages.source-mode／pages.branch-selected／pages.directory-selected | pages-settings | 分别核对发布方式、选中分支、选中目录；未满足且可操作时 actionable |
| pages.config-saved | pages-settings | 核对持久配置；待保存且按钮可操作时 actionable，保存中 wait，无法证明则 unknown |
| pages.workflow-open | pages-settings、pages-workflow | 由目标配置取得关联 run，目标工作流页已就绪；源页可点击而结果页未打开时 actionable |
| pages.deployment-status | pages-workflow | run 与目标版本匹配；运行中 wait、失败 blocked、成功 pass |
| pages.site-open | pages-workflow、published-site | 从关联部署取得并确认站点 URL，获准的目标站点页已就绪；链接可操作而尚未打开时 actionable |
| pages.content-match | published-site | 已确认 URL 与预期可见内容匹配；已知不符给出冲突，不推断属于哪个提交 |

页面切换与打开新标签时，协调器按声明的 readRoles 发现并绑定结果页面，既有标签页也须核对对象身份；不是把目的页面当作源页的高亮目标。pages.save-or-saved-status 定位器按明确状态选择唯一可点击 Save 或已保存状态区域；两者不明时不高亮。配置、run 和内容的关联只在 github_pages_v1 终验器产生完整结论。配置冲突可指向前序步骤供用户选择处理，不由校验器自动重新保存。

## 9. AI 请求与返回

首版建议后端本机运行，模型凭据在后端配置；POST /api/v1/answers 提供一次完整 JSON 返回。开发访问凭据与模型凭据分开，接口要求 Bearer 开发令牌并核对扩展来源；[工程配置第 6 节](WebGuideAI-工程配置与开发方式-v0.1.md#6-本机后端与模型配置)拟定地址、令牌录入与 Origin 缺失时的处理。它不是完整平台的作者身份方案，公开部署前另完成认证及额度设计。

| 请求字段 | 约束 |
| --- | --- |
| requestId／contextToken | 本次请求和不透明上下文标识；本地映射到 taskId、教程身份、stepId、contextRevision、页面导航身份及请求序号，服务器不用接收浏览器 tabId |
| tutorial／step／question | 固定内容版本、当前步骤的必要说明和用户问题；问题最长 2,000 字符的候选上限，超限明确提示 |
| ruleSnapshot | 当前确定性状态、原因码、缺失项；仅用于解释，返回中没有可写 ruleState 字段 |
| evidenceSummaries／sources | 经程序过滤的证据 ID、必要摘要、时间和教程来源；默认不传整页、账号信息、完整私人仓库 URL、输入框、Cookie 或令牌 |

返回 {requestId,contextToken,facts,inferences,unknowns,suggestions,sourceIds}。facts 每项含文字及 evidenceIds／sourceIds 至少一种可解析依据；推测单独列出，未发现的问题保持 unknowns。程序检查格式与引用存在性，不能仅凭引用 ID 存在保证回答内容真实，仍按 B10/B11 样例评估。

每任务同一时间保留一个当前答疑槽位；新请求、前进／返回、导航、暂停、目标重设或 coordinatorEpoch 更换使旧槽位失效。拒绝过期返回作为当前解释；仅答疑不改变合法高亮。取消用本地 Abort 信号并使请求失效，不能承诺远端已停止计费。错误统一 {requestId,code,retryable,message}；400 格式、401 未授权、429 限额、502 提供方错误、504 超时。普通答疑候选 30 秒超时、用户明确重试，长生成／探索不适用此值。

反馈只在此保留投影 {tutorialIdentity,stepId?,taskId?,description,previewedAttachments}，正式提交前补 O01 可见范围、O02 保留／删除和实际接收接口；本机草稿不能显示“维护者已收到”。教程平台的发布／撤下与作者权限接口另按后续交付设计，不将本运行格式当作全部平台数据库模型。

## 10. 样例走读与未决实现项

| 场景 | 按本契约应得到的结果 |
| --- | --- |
| 首次发布 | 参数确认→分支 HEAD 候选确认→逐项指引与保存→关联 run→等待→站点核对→终验；首次绑定站点后更新目标修订并重取终验所需证据 |
| 分支未选好／配置待保存 | 返回 actionable，定位唯一可见控件后进入 guiding；不把正常操作步骤显示为受阻 |
| 核对已有结果 | 重查时已保存配置可依规则通过，无须重复保存；目标意图先确认，不能从一个成功 run 倒推用户想核对哪个版本 |
| 只打开站点 | 只有 site 观察，missing 配置／run／锚点，保持 pending |
| 其他提交的成功 run | commit 不符，给冲突及目标版本说明，不用其他成功替代 |
| 成功观察后重查失败 | 该范围旧成功退出当前集合，显示待确认与重查路径，不沿用旧成功 |
| 回退、暂停期间旧响应到达 | review 不自动推进，旧上下文结果不写当前状态 |
| 暂停后页面未确认停止 | 业务 paused，stopStatus 保留待确认或失败，页面重连先确认暂停 |
| 后台进程重启 | 新 epoch、活动任务转恢复待确认，用户继续后重查，旧消息／答案不重接 |
| DOM 缺失／多目标／范围外页 | 撤销旧指示，分别返回 missing／ambiguous／unsupported 等实际原因，不自动点替代元素 |

对应实现前仍需验证实际依赖组合、定位／持久状态提取、主机授权与注入，并补齐模型提供方、反馈接收和保留方案；版本／构建、访问配置及有限租期／容量初值已见[工程配置](WebGuideAI-工程配置与开发方式-v0.1.md)，不再作为尚无设计的重复待决项。O01–O06 的其他完整产品范围保持原待决状态。未决定项不写成已实现，也不继续追加用户手动小验证。

2026-11-17 独立设计走读：补齐 actionable → guiding、跨页源目标与结果检查分离、重查失败撤下同范围旧成功后，未发现阻止制定实施计划的新问题。工程配置与交互方案仍按上列时点补齐。

设计借鉴：[固定源码索引](../../research/notes/源码阅读索引.md)中的 OnTheWay 步骤／跨页思路、Usertour 定位与条件监测、Nanobrowser 文档身份；未复制其源码。Driver.js 保留为渲染组件候选，通过适配层接收目标／说明，不能成为会话写入者。

格式与浏览器机制依据：[JSON Schema 2020-12](https://json-schema.org/draft/2020-12/json-schema-core)、[runtime MessageSender](https://developer.chrome.com/docs/extensions/reference/api/runtime#type-MessageSender)、[脚本注册](https://developer.chrome.com/docs/extensions/reference/api/scripting#type-RegisteredContentScript)。这些资料支持格式与 API 含义，本契约的字段命名和默认值为本稿设计建议。
