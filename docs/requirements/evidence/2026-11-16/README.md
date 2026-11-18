# 2026-11-16 场景证据索引

对应[场景走查报告](../../浏览器场景走查-2026-11-16.md)。所有截图均为本次浏览器实际页面，未作图像编辑。文本为页面可访问性状态，不是网页源码、API 响应或产品测试日志。

## SC01 Pages

| 状态 | 截图 | 文本 | 文本说明 |
| --- | --- | --- | --- |
| 初始 Pages 禁用 | [JPEG](sc01-pages-disabled.jpg) | [TXT](sc01-pages-disabled.txt) | 增量快照，无完整页面内容；以截图为主 |
| 首页已有、发布源仍未配置 | — | [TXT](sc01-file-present-pages-disabled.txt) | 增量快照，正文由报告记录；不宜单独作为完整证明 |
| 保存配置、构建中 | [JPEG](sc01-source-saved-building.jpg) | [TXT](sc01-source-saved-building.txt) | 增量快照，无完整页面内容；以截图为主 |
| 工作流成功 | [JPEG](sc01-deployment-success.jpg) | [TXT](sc01-deployment-success.txt) | 增量快照，保留工作流 URL；以截图为主 |
| 实际站点与测试标记 | [JPEG](sc01-site-verified.jpg) | [TXT](sc01-site-verified.txt) | 完整状态 |

## SC02 PR review

| 状态 | 截图 | 完整文本 |
| --- | --- | --- |
| Pending 评论 | [JPEG](sc02-review-pending.jpg) | [TXT](sc02-review-pending.txt) |
| 刷新后仍 Pending | — | [TXT](sc02-pending-after-reload.txt) |
| 已提交 review 及原评论 | [JPEG](sc02-review-submitted.jpg) | [TXT](sc02-review-submitted.txt) |

## SC03 Figma

| 状态 | 截图 | 完整文本 |
| --- | --- | --- |
| 原标签页可读但操作超时 | — | [TXT](sc03-browser-blocked.txt) |
| Draw 中 Frame 的自动布局入口可用 | [JPEG](sc03-draw-frame-auto-layout-available.jpg) | [TXT](sc03-draw-frame-auto-layout-available.txt) |
| Draw 中自动布局已启用 | [JPEG](sc03-draw-auto-layout-enabled.jpg) | [TXT](sc03-draw-auto-layout-enabled.txt) |
| 切回 Design 保持布局状态 | — | [TXT](sc03-design-auto-layout-enabled.txt) |
| 未选中对象，显示 Page 面板 | [JPEG](sc03-no-selection-page-panel.jpg) | [TXT](sc03-no-selection-page-panel.txt) |
| 文件重命名并重新选中 Frame | [JPEG](sc03-frame-reselected-final.jpg) | [TXT](sc03-frame-reselected-final.txt) |

原标签页超时的文本只能证明当时页面可读，不能证明超时根因。部分截图未含浏览器地址栏，页面地址由同状态文本和报告提供。全部观察只对应当时的单一账号、对象与界面；数字元素编号不可用作长期定位依据。
