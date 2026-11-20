# WebGuide AI 工程配置与开发方式 v0.1

初稿于 2026-11-17，工程状态更新于 2026-11-20。本页说明已有工程如何运行。实时引导沿用这里的扩展和后端，具体职责及本轮目标见[浏览器导航原型](WebGuideAI-浏览器导航原型.md)。

## 1. 采用方式及理由

采用 **npm workspaces 单仓库，扩展本地运行，Fastify 后端作为单个进程**。扩展负责观察页面和显示提示，后端负责与模型通信。

| 选择 | 本项目取舍 |
| --- | --- |
| npm workspaces | 扩展和后端共用一份锁文件与检查入口 |
| 扩展与后端分仓 | 边界独立，但当前一人主导、契约仍在共同演进，同步版本和 CI 的成本较高 |
| Java 后端 | 能对应一类实习方向，但当前需要先完成浏览器引导，已选 TypeScript／Node.js，共享类型和调试更直接；后续接口不依赖 Node 专有传输 |

以上沿用方案 A。npm、目录、开发端口及下列初值是本稿具体建议，不回写为发起人逐项指定的决定。实习可迁移经验落实在 TypeScript、React、HTTP 接口、鉴权边界、自动化测试、Git 协作和 CI 的实际交付中。

## 2. 版本与依赖

| 项目 | 项目基线 | 落地方式 |
| --- | --- | --- |
| Node.js | 24 LTS；首次工程基线 24.22.3 | 项目记录 `.node-version` 和 CI 版本；不直接替换全局 Node |
| npm | 11.19.1 | 根 `package.json` 记录版本，使用 `npm ci` 按同一份锁文件安装 |
| WXT | 0.21.5 | React 模块按依赖声明配套 |
| TypeScript／React | TypeScript 5.9.3、React 19.3.1 | 扩展使用 Bundler 解析，后端采用 NodeNext ESM |
| Fastify | 5.12.8 | 已有健康检查接口，后端提供 app 工厂用于测试 |
| Driver.js | 1.12.1 | 由渲染层负责高亮和气泡，保留第三方许可 |
| 检查 | Vitest、Playwright、ESLint | 精确版本见根目录 `package-lock.json` |

2026-11-19 已通过 NVM 并行安装并运行 Node 24.22.3／npm 11.19.1。本机默认仍为 Node 25.5.0／npm 11.15.0，项目检查调用 Node 24 的可执行文件。首轮已按锁文件完成干净安装和构建。调整运行时补丁时，同步更新本地说明与 CI。

Node 24 是仍受支持、较成熟的 LTS 选择，并非当日最新主版本。依据：[Node 24.22.3 发布记录](https://nodejs.org/en/blog/release/v24.22.3)、[Node 发布计划](https://github.com/nodejs/Release)。WXT 的安装与测试入口见[安装文档](https://wxt.dev/guide/installation)、[单元测试](https://wxt.dev/guide/essentials/unit-testing)；Fastify 按其[支持策略](https://fastify.dev/docs/latest/Reference/LTS/)核对运行时。

## 3. 目录与依赖方向

以下是已有的仓库目录和职责。

```text
软件工程课程设计/
├─ apps/
│  ├─ extension/                 WXT、侧栏、元素检查、页面观察、高亮
│  └─ api/                       Fastify 健康服务，后续从这里接入模型
├─ tests/e2e/                    独立 Chromium 的扩展加载检查
├─ scripts/                      扩展构建产物检查
├─ docs/                         需求、设计和开发记录
├─ research/                     保留资料；repos/ 不加入产品版本控制
├─ experiments/                  保留实验历史，不被产品 import
└─ package.json / package-lock.json / 配置文件
```

扩展和后端可分别运行和构建。接入模型时再定义两端共用的请求与响应格式。

2026-11-18 更新：课程 Git 仓库已经建立，文档基线通过组长直接验收的 PR #3 交付；工程实施沿用现有仓库，从合入 main 的基线创建独立 codex/ 分支，不重复初始化。可提交范围为 apps、packages、scripts、tests、docs、必要根配置与研究摘要。research/repos、课程原件、tmp、浏览器配置、构建输出、依赖、日志与 .env 排除；已有课程文件保持原位。提交前核对实际暂存清单，不运行无差别 git add .。

固定路线的 Schema 和样例保存在 `docs/design/contracts/`，可结合旧版代码查阅。[协作契约](GitHub协作适配契约-v0.1.md) · [当前开发顺序](../requirements/版本交付范围-2026-11-17.md#当前开发顺序)

## 4. 构建与开发入口

下列脚本已在根目录 `package.json` 定义，在仓库根目录运行。首次安装用 `npm ci`。

| 命令 | 含义 |
| --- | --- |
| npm run dev:extension | WXT 开发模式，默认不自动打开浏览器 |
| npm run dev:api | 仅监听 127.0.0.1:43130；端口占用明确报错 |
| npm run check | 依次运行类型检查、静态检查、单元测试、生产构建和产物核对 |
| npm run test:e2e | 构建生产扩展，在独立 Chromium 配置中检查侧栏 |

WXT 设置关闭自动启动浏览器，避免进入个人 Edge 配置；需要调试时显式选择独立配置。正式 Edge 加载仍是发布前的兼容检查，不把它分解成连续要求用户操作的小实验。[WXT 浏览器启动配置](https://wxt.dev/guide/essentials/config/browser-startup)提供关闭自动启动的入口；[Playwright 扩展文档](https://playwright.dev/docs/chrome-extensions)说明使用其配套 Chromium 与持久化上下文，不能依赖个人 Edge 的命令行加载。

CI 使用 `.node-version` 指定的 Node 版本，执行 `npm ci` 和 `npm run check`。浏览器作业使用锁定版本的 Playwright 容器，执行 `npm run test:e2e`。Windows 含中文与空格的路径由本机检查覆盖。

构建输出为 `apps/extension/.output/chrome-mv3`。浏览器测试通过普通扩展标签页打开同一个侧栏页面。

## 5. 页面工具与扩展权限

- 扩展当前使用 `sidePanel` 权限打开侧栏。接入页面读取时再加入当前标签页所需的权限。[Chrome 的 activeTab 权限说明](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- `apps/extension/src/page/` 提供控件可用性判断、页面变化监听和高亮。Driver.js 只显示单个目标和纯文本提示，用户可以继续操作网页。Driver 样式单独打包，页面工具会在接入实时导航时使用。

## 6. 本机后端与模型配置

当前后端只提供 `GET /health`，返回 `{"status":"ok","ai":"disabled"}`。本机可按 `apps/api/.env.example` 设置 `WG_PORT`，默认地址为 `127.0.0.1:43130`。下一个切片接入实时视觉引导，扩展与本机后端之间的请求格式随该切片确定。[浏览器导航原型](WebGuideAI-浏览器导航原型.md)

原型先用同济大学人工智能服务平台的 `DeepSeek-V4.1-Flash`，通过 `https://agi.tongji.edu.cn/v1/chat/completions` 调用。2026-11-20 用模拟仓库首页和 Issues 列表验证了真实模型能选中 `Issues` 入口和指定编号，并返回可解析 JSON。试用参数保存在本机的 `apps/api/.env`，该文件由 Git 忽略。[模型详情](https://agi.tongji.edu.cn/models/hub/125)

本机关闭代理虚拟网卡后，直连短请求返回 HTTP 200。开启虚拟网卡且已设同济域名直连规则时，正常解析和用 `curl --resolve` 分别指定两个已解析的地址，模型调用都返回 `403` 和「当前网络环境不支持」。Windows 路由只能看到连接进入虚拟网卡。排查这个 403 时，先在代理客户端的连接日志里确认是否匹配了直连规则。若其他校内服务出现域名解析错误，再比较虚拟网卡开关前后的 DNS 结果。当前可用的办法是调用同济模型时关闭虚拟网卡。

以下配置来自原固定教程答疑设计，供接入模型时参考。

| 所在位置 | 内容 | 生命周期 |
| --- | --- | --- |
| 后端未入库的 .env | WG_HOST=127.0.0.1、WG_PORT=43130、WG_CLIENT_TOKEN、WG_ALLOWED_EXTENSION_ORIGINS、WG_MODEL_MODE、模型地址／名称／密钥 | 后端加载；.env.example 只有说明与空占位，缺必要值拒绝启用模型接口 |
| 扩展设置页 | 固定本机后端地址、开发访问令牌 | 当前浏览器 storage.session；令牌不放构建环境变量、教程、页面消息或反馈 |

扩展 service worker 发后端请求，页面代理不持有令牌。模型接口必须验证 Bearer 访问令牌、Host 和请求大小；Origin 存在时必须在允许的扩展 origin 列表中，浏览器预检只回显精确允许项，不使用通配符。Origin 缺失不能代替令牌认证，CORS 本身也不是身份认证；拒绝客户端自行指定模型上游地址。扩展打包后的变量可被读取，不能把模型密钥写进 VITE_*／WXT_* 等前端变量。

首轮开发令牌通过本机配置渠道传递，扩展重载／浏览器重启后按实际丢失情况重新填写。公开部署、作者账户和团队权限属于后续设计，不以这一令牌方案对外提供服务。健康检查只报告运行状态，不返回令牌、模型地址或请求内容。

## 7. 旧教程运行限制记录

以下参数用于原固定教程，保留作设计参考。

| 参数 | 设计初值 | 处理方式 |
| --- | --- | --- |
| 同时活动引导 | 1 个 owner | 打开另一界面先展示占用说明；显式暂停后再转移 |
| 同会话保留任务 | 最多 5 个，含活动任务 | 满额要求明确清理旧任务；不静默丢弃 |
| 每任务观察记录 | 最多 100 条；快照总量软上限 1 MiB | 当前证据不被挤出；只可裁剪已失效历史，并提示裁剪；仍超限则停止新检查并提示清理 |
| 单条协议消息 | 64 KiB | 超限拒绝，不截断后假装完整 |
| 观察有效期 | 5 分钟 | 重查相关范围，最新失败撤下旧成功，见运行契约 |
| 页面活动租期／续期 | 6,000 ms／2,000 ms | 仅活动且界面连接有效时续期；失联或文档隐藏先清除；不依赖后台常驻 |
| 本地采集请求超时 | 3,000 ms | 撤销本次资格，标为待确认，不重用旧成功 |
| 问答超时／最长问题 | 30,000 ms／2,000 字符 | 固定引导继续可用，显式重试 |

租期是可调度条件下的失联兜底，冻结页面恢复执行时先核对到期再展示，不能承诺冻结期间精确撤销。恢复／继续必须取得当前上下文的新租期。参数在纯逻辑假时钟测试中固定，真实性能与调度行为在正式实现测量后校准；它们不是本轮已验证的产品指标。

会话快照保持单写者、逐任务单记录；容量按 UTF-8 序列化估算并处理实际存储拒绝，不假定软上限等于浏览器配额。清空任务先发停止并记录 ACK 情况，再删除对应本地会话；不扩大为删除后端记录。

## 8. 首轮切片与团队任务

原协作练习、固定路线和文件核对集中保留在本地 `codex/github-raw-source` 分支。[11 月 18 日实施记录](首轮工程实施计划-2026-11-18.md)

下一轮用两条 GitHub 短路线验证 AI 能否根据当前页面选择要高亮的控件，并跟上用户操作。完整 SC02 协作、提交和 PR 核对、反馈及作者工具按各自场景安排。[当前开发顺序](../requirements/版本交付范围-2026-11-17.md#当前开发顺序)

## 9. 开工前检查与小组接入

### 本机验证记录（2026-11-19）

| 项目 | 结果与覆盖范围 |
| --- | --- |
| 项目运行时 | NVM 已并行安装 Node 24.22.3／npm 11.19.1，在含中文路径的工作区用该 Node 跑既有两个实验的 26 项 Node 检查，全部通过。 |
| 依赖解析 | 预检用 `--package-lock-only --ignore-scripts --engine-strict --strict-peer-deps` 检查版本组合。首轮已通过 `npm ci` 和 `npm run check`，精确版本以根目录 `package-lock.json` 为准。 |
| 浏览器自动化 | 使用宿主 Playwright 1.62.1 与新取得的配套 Chromium 151.0.7922.34（修订 1234），在独立临时配置加载本地 MV3 生命周期实验。实际验证了后台与页面连接、高亮出现、主动暂停撤销、恢复，以及关闭扩展测试页后断连暂停并撤销高亮。 |
| 适用范围 | 预检使用实验的 `panel.html` 与本机模拟页。首轮工程已用 `npm run test:e2e` 加载 WXT 构建并跑通练习。Edge 原生侧栏和真实 GitHub 采集待验证。 |
| 开源复用 | 9 个本地上游副本的 HEAD 均与[来源清单](../../research/sources.json)一致。Driver.js 为渲染依赖候选，具体许可与可移植代码见[源码阅读索引](../../research/notes/源码阅读索引.md)。 |

原版可从 `codex/github-raw-source` 运行首轮协作检查。要单独验证页面生命周期，可按[实验说明](../../experiments/extension-lifecycle-spike/README.md)运行。

### 开工后的接入顺序

1. Windows 成员可用 NVM 选择项目 Node 版本，确认 `node --version` 和 `npm --version` 后从根目录运行 `npm ci`。本地与 CI 使用同一版本和检查命令，升级通过独立 PR 验证。
2. 仅需要浏览器测试的成员配置项目 Playwright 配套 Chromium。版本以项目锁文件为准，隔离测试配置按每次运行创建；在 Windows 检查带空格和中文的路径。原生 Edge 兼容检查保留本机路径。
3. 共享契约和会话协调由组长统筹。边界确定后，可按实际投入分出模拟页与反例、页面高亮与侧栏、Fastify 健康接口、测试复现与验收记录。每个工作包用 Issue 写清依赖接口、产物与完成条件，沿用[仓库协作约定](../../CONTRIBUTING.md)，当前保留为可选分工。
4. 首轮用本机 Node 运行 Fastify 健康接口和模拟服务。后端需要数据库等配套服务或统一部署时，再考虑用 Docker Compose 固定服务与版本。浏览器扩展开发仍使用本机浏览器和独立测试配置。
