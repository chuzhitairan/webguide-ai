import { C, F, shape, text, line, arrow, cursor } from '../source/style.mjs';

const source = {
  brief: '教师《第03课-学生讲解项目需求》第 1 页；docs/course/week11/评审材料.md',
  scope: 'docs/requirements/WebGuideAI-SRS-v0.3.md 第 1–3 节；docs/course/week10/发起人体验记录.md',
  useCases: 'models/WebGuideAI-用例图.svg；docs/requirements/WebGuideAI-SRS-v0.3.md 第 2–3 节。',
  figma: 'NAV-UC06。docs/course/week11/验收与证据.md 第 1 节。',
  github: 'NAV-UC07；docs/design/导航Harness-真实站点验证-2026-11-23.md「从列表打开 PR 详情」',
  quality: 'docs/requirements/WebGuideAI-SRS-v0.3.md 第 5 节；GitHub Issues #33–#35；tests/e2e/guide.spec.ts 第一个用例',
  trace: 'docs/course/week11/追溯矩阵-v0.md；https://github.com/chuzhitairan/webguide-ai/issues/19；https://github.com/chuzhitairan/webguide-ai/pull/37；https://github.com/chuzhitairan/webguide-ai/issues/36',
};

function notes(slide, seconds, script, reference) {
  slide.speakerNotes.text = '建议用时 ' + seconds + ' 秒\n\n' + script + '\n\n材料来源\n' + reference;
}

function page(presentation, title, subtitle) {
  const slide = presentation.slides.add({ width: 1280, height: 720 });
  slide.background.fill = C.paper;
  text(slide, title, 65, 47, 1150, 66, 44, C.ink, true);
  if (subtitle) text(slide, subtitle, 67, 115, 1148, 35, 22, C.muted);
  return slide;
}

function flow(slide, steps, y) {
  const left = 66;
  const stepWidth = 1150 / steps.length;
  steps.forEach(([title, detail], index) => {
    const x = left + index * stepWidth;
    line(slide, x, y, stepWidth - 38, C.teal, 3);
    text(slide, title, x, y + 18, stepWidth - 47, 46, 29, C.ink, true);
    text(slide, detail, x, y + 68, stepWidth - 50, 57, 21, C.muted);
    if (index + 1 < steps.length) arrow(slide, x + stepWidth - 32, y + 33, 19);
  });
}

export async function build(presentation, diagram) {
  presentation.theme.defaultFont = F;

  // 1 · Cover. The highlight is the product's central interaction.
  {
    const s = presentation.slides.add({ width: 1280, height: 720 });
    s.background.fill = C.deep;
    text(s, '第 11 周需求评审', 69, 76, 670, 35, 24, C.soft);
    text(s, 'WebGuide AI', 65, 153, 870, 119, 87, C.white, true);
    text(s, '在眼前的网页上找到下一步', 72, 312, 1124, 72, 46, C.mint, true);
    text(s, '实时网页引导与经验复用', 73, 408, 870, 48, 27, C.soft);
    shape(s, 946, 165, 218, 99, 'none', C.mint, 4, 3);
    cursor(s, 1126, 242, 1);
    line(s, 73, 559, 1126, C.mid);
    text(s, '软件需求规格说明书 v0.3', 74, 582, 1100, 39, 22, C.soft);
    notes(s, 20, '大家好，我们的项目是 WebGuide AI。它是一个浏览器扩展，帮刚接触网页工具的用户在当前界面找到下一步。我先讲用例和范围，再用两个场景说明系统怎样判断用户真的走到了目标，最后说我们的验收标准。', source.brief);
  }

  // 2 · One story introduces the interaction contract before the whole system.
  {
    const s = page(presentation, '用户操作，扩展跟着页面变化', '从小组协作里遇到的一个具体问题开始');
    shape(s, 66, 187, 6, 105, C.teal);
    text(s, '「带我打开这个仓库的第 1 号 PR 详情。」', 88, 183, 1120, 53, 34, C.ink, true);
    text(s, '用户说出目的，扩展在当前页面指出可操作的位置。', 89, 244, 1102, 42, 23, C.muted);
    flow(s, [['说目标', '从正在浏览的页面开始'], ['看指引', '扩展观察页面并高亮控件'],
      ['自己操作', '用户点击、滚动或输入'], ['核对结果', '读新页面，再继续或收尾']], 385);
    text(s, '点击、输入和提交由用户决定。', 68, 585, 1145, 50, 25, C.teal, true);
    notes(s, 55, '课程让我们用 GitHub 小组协作。我刚接触仓库里的 Issue、PR 和 Projects 时，也需要先弄清它们的用途和入口。这里用练习仓库的第 1 号 PR 举例。在列表页说出目标后，扩展会读当前页面，缺线索就补看，然后给我一个蓝框和一句提示。我自己点击。进入下一页后，扩展会再次观察，判断任务是否完成。用户可以照着建议走，也可以自己换路。', source.scope);
  }

  // 3 · The submitted figure is kept intact below its original title header.
  {
    const s = page(presentation, '完整用例图涵盖三个阶段');
    shape(s, 475, 131, 740, 551, C.white, C.line, 6);
    s.images.add({
      blob: diagram, contentType: 'image/png', fit: 'contain',
      alt: '完整功能用例图，包含 20 个功能用例、三个主参与者、两个次参与者',
      position: { left: 483, top: 137, width: 724, height: 539 },
    });
    text(s, '主参与者', 66, 145, 364, 34, 20, C.teal, true);
    const roles = [
      ['操作用户', '组内预览 · 13', '提出目标并跟随网页指引'],
      ['经验维护者', '本机经验 · 4', '整理并验证候选经验'],
      ['发布管理员', '共享经验 · 3', '管理共享经验的发布与回退'],
    ];
    roles.forEach(([title, phase, desc], i) => {
      const y = 193 + i * 112;
      line(s, 66, y, 364);
      text(s, title, 67, y + 13, 215, 42, 28, C.ink, true);
      text(s, phase, 264, y + 17, 167, 32, 19, C.teal, true, 'right');
      text(s, desc, 66, y + 57, 364, 40, 21, C.muted);
    });
    text(s, '次参与者', 66, 551, 364, 33, 20, C.teal, true);
    text(s, '模型服务、目标网页', 66, 587, 364, 35, 24, C.ink, true);
    text(s, '完整图可在 SRS 中放大查看', 66, 644, 364, 30, 17, C.muted);
    notes(s, 95, '【依次指图中三个阶段。】这是完整用例图，有二十个功能用例。最上面是当前组内预览的范围。操作用户可以配置自己的模型，从正在看的网页提出目标，也能澄清、暂停和恢复。中间是后续的本机经验。用户自愿按最小范围记录，维护者整理候选，再验证它能否帮助新任务。下面是共享阶段，用户贡献候选，管理员决定发布、停用和回退。【指右侧，上面是模型服务，下面是目标网页。】模型提出下一步，目标网页提供可核对的控件和状态，扩展复查控件后再高亮。', source.useCases);
  }

  // 4 · Figma: two matching labels belong to different objects.
  {
    const s = page(presentation, '找到指定图层的导出入口', 'Figma · NAV-UC06');
    text(s, '「帮我找到 Frame 1 的导出设置入口。」', 66, 181, 1150, 59, 35, C.ink, true);
    text(s, '验收样例中有两个同名按钮，扩展要核对它们的归属。', 68, 244, 1148, 40, 23, C.muted);
    line(s, 66, 338, 517);
    text(s, '页面级导出', 67, 360, 500, 45, 30, C.muted, true);
    text(s, 'Export 区', 68, 422, 148, 53, 28, C.muted);
    shape(s, 229, 414, 52, 48, C.white, C.line, 4);
    text(s, '＋', 229, 418, 52, 42, 28, C.muted, true, 'center');
    shape(s, 630, 323, 585, 165, C.pale, 'none', 5);
    text(s, 'Frame 1 图层', 650, 351, 535, 50, 32, C.ink, true);
    text(s, 'Export 区', 652, 422, 156, 53, 28, C.ink);
    shape(s, 817, 414, 52, 48, C.white, C.teal, 4, 3);
    text(s, '＋', 817, 418, 52, 42, 28, C.teal, true, 'center');
    text(s, '看到按钮所属图层，画出正确蓝框后收尾。', 66, 567, 1150, 65, 28, C.ink, true);
    notes(s, 75, '【指向两个加号。】用户想找到 Frame 1 的导出入口。验收样例里，页面级和图层级的加号都叫 Add export settings。扩展先确认用户选中了 Frame 1。已经定位到属于这个图层的屏外加号时，就滚动属性面板，复查后高亮。线索不足时先补看，或请用户滚动。验收时要看蓝框落在正确加号上，侧栏也报告已找到。真实 Figma 复测曾出现滚动后指对、侧栏仍未收尾，所以这两项分开记录。', source.figma);
  }

  // 5 · GitHub: the goal is a page state and completion follows navigation.
  {
    const s = page(presentation, '打开 PR 后再核对详情', 'GitHub · NAV-UC07');
    text(s, '「带我进入第 1 号 PR 的详情页。」', 66, 180, 1145, 60, 35, C.ink, true);
    flow(s, [['定位条目', '找编号对应的链接'],
      ['用户打开', '跟着蓝框点击进入'], ['核对详情', '查详情标识和同区可用控件']], 333);
    shape(s, 67, 536, 8, 79, C.teal);
    text(s, '核对通过后，侧栏才显示已到达。', 90, 545, 1110, 60, 29, C.ink, true);
    notes(s, 75, '第二个场景的关键词是进入详情，终点是实际页面。扩展会补看列表，核对第 1 号对应的条目，再给出真实链接。点进页面以后，扩展核对 PR 标题，以及同一区域里可用的控件，例如复制分支名。【指向核对详情。】从列表看到标题只能证明入口存在。如果打开的是登录页或别的 PR，还要继续。我们把从列表开始和已在详情页两个起点都放进了验收。', source.github);
  }

  // 6 · Each quality requirement includes a concrete, auditable check.
  {
    const s = page(presentation, '性能、安全和可用性如何验收', '三条非功能需求分别对应可执行的检查');
    const quality = [
      ['性能', '验收目标', '页面就绪时，1 秒内显示连接或观察状态。', '控制模型延迟并计时。单次上限 15 秒，单轮预算 45 秒。'],
      ['安全', '组合样页待测', '模型只收到目标和必要页面线索。', '往样页加入测试密码和表单值，检查请求正文与日志。'],
      ['可用性', '已有浏览器回归', '超时且重试失败后，点继续能保留原目标。', '暂停期间改动页面，继续时核对新状态并收尾。'],
    ];
    quality.forEach(([name, status, criterion, check], i) => {
      const y = 194 + i * 145;
      line(s, 66, y, 1148);
      text(s, name, 66, y + 13, 242, 50, 34, C.ink, true);
      text(s, status, 67, y + 65, 237, 38, 19, C.teal, true);
      text(s, criterion, 317, y + 13, 897, 49, 28, C.ink, true);
      text(s, check, 318, y + 68, 890, 40, 22, C.muted);
    });
    notes(s, 100, '非功能需求也写成可以检查的行为。性能方面，页面已经可以开始时，一秒内应该看到连接或观察状态。这是验收目标，还要独立计时。单次等待上限十五秒，一轮预算四十五秒，用可控模型分别复测。安全方面，给模拟网页放入测试用的密码、表单值、Cookie 和干扰文字，检查发出的请求正文与日志。密钥只用来请求自己选择的模型域名。组合样页仍待测。可用性方面，已经有 Chromium 回归。让第一次请求实际超时，重试时返回无效结果，扩展暂停。暂停期间把控件改掉，点继续后要保留原目标，并基于新页面的控件完成指引。', source.quality);
  }

  // 7 · An actual story, use case, expected result and evidence.
  {
    const s = page(presentation, '一条需求怎样追溯到实测', '以「进入指定 PR 详情」为例');
    flow(s, [['故事 #19', '确认进入了指定对象的界面'],
      ['用例 NAV-UC07', '列表定位，用户打开，再核对'],
      ['验收与实测', '对应详情出现后才报告已到达']], 226);
    text(s, '同一 PR 实测，从列表进入和已在详情页各通过 2/2。', 67, 369, 1147, 45, 24, C.teal, true);
    line(s, 66, 444, 1147);
    text(s, '本次评审确认', 67, 474, 320, 52, 33, C.ink, true);
    text(s, '交付范围、验收条件、模型 API 是否算外部集成。', 396, 479, 818, 45, 26, C.muted);
    text(s, 'SRS 草稿 PR #37', 68, 572, 342, 43, 22, C.teal, true);
    text(s, '追溯矩阵 v0', 463, 572, 331, 43, 22, C.teal, true);
    text(s, '评审跟踪 Issue #36', 849, 572, 365, 43, 22, C.teal, true);
    notes(s, 60, '最后用一条追溯链收尾。故事来自 GitHub Issue 十九，组员需要确认自己打开了正确详情。它对应 NAV-UC07，验收要求核对对应详情后才显示完成。我们从列表和已在详情页两个起点各跑两次，各通过两次，结果可以从追溯矩阵查到。这次请老师和同学确认三件事：交付分期、验收条件、扩展直连的模型 API 是否满足课程外部集成要求。评审意见和签字记在 Issue 三十六，确认后再定稿发布 SRS v1.0。', source.trace);
  }
}
