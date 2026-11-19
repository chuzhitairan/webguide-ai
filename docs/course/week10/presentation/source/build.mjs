import fs from 'node:fs/promises';
import path from 'node:path';
import {ROOT,C,F,shape,text,line,dot,pill,arrow,cursor,footer,heading,browser} from './style.mjs';

const source={research:'docs/course/week10/调研报告.md §4–6；docs/course/week10/发起人体验记录.md',scene:'docs/requirements/GitHub协作首场景规格-v0.1.md；docs/design/GitHub协作适配契约-v0.1.md',stories:'docs/course/week10/用户故事.md；docs/requirements/WebGuideAI-SRS-v0.2.md',design:'docs/design/WebGuideAI-核心设计-v0.1.md；docs/design/WebGuideAI-工程配置与开发方式-v0.1.md'};
function note(s,time,t,src){s.speakerNotes.text=`建议用时：${time}\n\n${t}\n\n材料来源：${src}`;}
function proto(s,dark=false){text(s,'概念原型',1092,625,123,25,15,dark?C.soft:C.muted,false,'right');}
function number(s,t,x,y,dark=false){dot(s,x,y,36,dark?C.mid:C.pale);text(s,t,x,y,36,36,18,dark?C.mint:C.teal,true,'center');}

export async function build(p){
 p.theme.defaultFont=F;
 const add=()=>p.slides.add({width:1280,height:720});

 // 1: Preserve the original cover composition.
 {
 const s=add();s.background.fill=C.deep;
 text(s,'网页任务引导与教程平台',66,50,950,30,20,C.soft);
 text(s,'WebGuide AI',64,157,900,110,84,C.white,true);
 text(s,'让教程落到当前网页上',69,292,1100,80,50,C.mint,true);
 text(s,'在页面上找到目标，理解操作，核对结果',70,392,1030,42,28,C.soft);
 shape(s,949,154,250,119,'none',C.mint,0,3);
 for(const [x,y]of [[943,148],[1193,148],[943,267],[1193,267]])shape(s,x,y,12,12,C.mint);
 cursor(s,1147,249,1.1);line(s,70,558,1140,C.mid);
 text(s,'2026.11.20',940,589,269,34,22,C.soft,false,'right');
 note(s,'20 秒','大家好，我们的项目叫 WebGuide AI。我们想做一个浏览器里的任务引导工具：需要操作的时候，直接在当前页面指出位置，说明原因，并帮助用户确认结果。先从我们自己接触到的 GitHub 小组协作讲起。',source.research);
 }

 // 2: Actual historical screenshot, with questions rather than a personal quote.
 {
 const s=add();heading(s,2,'打开仓库以后，从哪里开始？');
 text(s,'小组要协作完成项目，新成员先看到的是一套陌生的任务管理界面。',65,133,1149,34,24,C.muted);
 const bytes=await fs.readFile(path.join(ROOT,'docs/course/week10/evidence/course-board-2026-11-17.jpg'));
 s.images.add({blob:new Uint8Array(bytes),contentType:'image/jpeg',alt:'2026-11-17 仓库初始化时保存的真实 GitHub Projects 看板，上部局部截图',fit:'cover',crop:{left:0,top:0,right:0,bottom:0.35},position:{left:65,top:191,width:1150,height:365}});
 const xx=[65,463,861],qq=['我该先认领哪个任务？','文档应该在哪里修改？','怎样把改动交给同伴？'];
 xx.forEach((x,j)=>{text(s,String(j+1).padStart(2,'0'),x,601,40,32,20,C.teal,true);text(s,qq[j],x+47,599,315,36,24,C.ink,true);});
 note(s,'55 秒','这是我们初始化小组仓库时保存的真实看板。对熟悉 GitHub 的人，任务卡片和状态列很直观；但第一次参与协作的人，可能还不知道从哪张卡片开始，也不清楚接到任务以后去哪里改、改完又怎么交给同伴。这里真正要解决的，不只是某一个按钮叫什么，而是如何沿着当前界面完成一件具体的事。下一页就用一次文档修改，把这条路径展开。','docs/course/week10/evidence/course-board-2026-11-17.jpg；'+source.research+'。展示历史初始化视图，图片裁掉下方区域以突出任务与状态。');
 }

 // 3: Continue the same scenario instead of switching to public research.
 {
 const s=add();heading(s,3,'一次文档修改的协作流程','例如：为小组仓库补充一段快速上手说明');
 const xs=[65,301,537,773,1009];
 const data=[['Issue','明确要做什么','认领任务，了解要求'],['分支','单独开展修改','为本次工作建立分支'],['提交','保存一版改动','把文档修改记入分支'],['Pull request','请同伴检查改动','说明改动与修改原因'],['评审与合并','确认后纳入主线','采纳反馈后合并']];
 data.forEach(([name,meaning,action],j)=>{const x=xs[j];number(s,String(j+1),x,222);text(s,name,x,292,207,48,j===3?27:31,C.ink,true);text(s,meaning,x,369,207,42,25,C.teal,true);text(s,action,x,433,207,72,22,C.muted);if(j<4)arrow(s,(x+18+xs[j+1]+18)/2-27/2,232.5,27);});
 line(s,65,553,1150);text(s,'知道流程以后，每次切页仍要判断：下一步在哪，当前这一步是否已经做完。',65,580,1150,55,26,C.ink,true);
 note(s,'65 秒','假设任务是给小组仓库补一段快速上手说明。Issue 是任务单，分支给修改一个独立位置，提交记录改动，PR 把改动交给同伴检查，之后再评审合并。但知道这套流程，实际操作时仍然有一道坎：到了眼前这个页面，该点哪里？已经有了分支或提交，要从哪一步继续？现在的结果到底对不对？这就是我们做 WebGuide AI 的直接动机：把教程和用户正在做的那次任务连接起来，让引导跟上实际页面和进度。接下来看看哪些基础能力可以借鉴。',source.scene+'；https://docs.github.com/en/get-started/using-github/github-flow');
 }

 // 4: Keep the original three-column typography; explain the reuse roles.
 {
 const s=add();heading(s,4,'已有项目的能力与复用方向','从成熟项目借鉴能力，再围绕实际任务组织起来',true);
 const xs=[66,463,858];
 const data=[['Driver.js','页面引导','高亮目标，展示提示气泡','用于页面上的指示与说明'],['OnTheWay','教程制作','录制操作，组织教程步骤','借鉴从示范形成教程的流程'],['Usertour','教程管理','编辑、发布与条件监测','借鉴教程维护和运行机制']];
 data.forEach(([name,role,cap,use],j)=>{const x=xs[j];text(s,role,x,218,347,35,23,C.mint,true);text(s,name,x,278,348,65,39,C.white,true);text(s,cap,x,369,347,77,26,C.soft);line(s,x,467,347,C.mid);text(s,use,x,494,347,72,23,C.mint,true);if(j<2)shape(s,x+367,225,1,324,C.mid);});
 text(s,'我们的切入点',65,574,1148,29,18,C.mint,true);
 text(s,'围绕用户当前的任务，持续判断下一步，并核对每次操作的结果。',65,610,1148,36,25,C.white,true);
 note(s,'55 秒','页面高亮、操作录制和教程管理，已有值得复用的项目。Driver.js 可以作为高亮与提示气泡的基础，OnTheWay 的示范转教程流程、Usertour 的编辑发布和维护机制，也给我们提供了参考。我们的切入点是围绕一次具体任务，把这些能力和当前页面、用户进度、实际结果接起来。比如用户已经建好分支，就从合适的位置继续；选错分支，要提醒修正；PR 建立后，还要核对它是不是这次任务的结果。这也把下一页的需求串起来了。',source.research+'；research/sources.json；research/notes/源码阅读索引.md。上述为本项目产品定位与设计目标；未据此声称参照项目缺乏这些能力。');
 }

 // 5: User needs in ordinary language.
 {
 const s=add();heading(s,5,'核心需求：定位、理解与核对','引导随页面与任务状态变化，持续回应操作中的具体问题');
 const rows=[['01','找到位置','告诉我该操作哪个入口','换页或进度改变后，重新找到当前需要的目标。'],['02','理解步骤','告诉我为什么现在要这样做','围绕当前步骤解释答疑，保留这次任务的上下文。'],['03','确认结果','告诉我这一步是否真正完成','发现选错分支、尚未提交等情况，提示修正后继续。']];
 rows.forEach(([n,title,want,detail],j)=>{const y=206+j*142;text(s,n,65,y,45,40,26,C.teal,true);text(s,title,128,y-1,200,42,30,C.ink,true);text(s,want,386,y-2,820,46,29,C.teal,true);text(s,detail,389,y+54,815,38,24,C.muted);if(j<2)line(s,128,y+117,1087);});
 note(s,'55 秒','因此，我们提炼了三项相互配合的需求。定位要跟着页面和实际进度更新；解释要知道用户正在做哪一步，答疑时不用重新交代整段经历；核对则要看操作后的实际结果，比如分支选错了、修改还没有提交，就指出问题，帮助用户继续。它们共同服务于同一件事：帮助用户完成眼前的任务。这些行为已整理为用户故事，并配有具体的验收条件。接下来直接看这些需求如何呈现在用户当前的页面上。',source.stories+'，重点 US03–US06。');
 }

 // 6: Refine the existing two-panel concept instead of adding a new visual style.
 {
 const s=add();heading(s,6,'该点哪里，直接在当前页面告诉你','页面高亮帮助定位，侧栏解释当前步骤',true);
 browser(s,65,202,702,391,'GitHub Issue');
 text(s,'Update the quick-start guide',90,264,650,46,29,C.ink,true);
 text(s,'Assignees',90,334,500,32,22,C.muted);
 shape(s,81,383,269,61,C.pale,C.teal,6,3);text(s,'assign yourself',103,393,240,43,28,C.teal,true);cursor(s,328,428,.66,C.teal);
 text(s,'让团队知道这项任务由你处理',91,484,621,47,24,C.muted);
 shape(s,798,202,417,391,C.white,'none',10);
 text(s,'第 1 / 12 步',822,219,359,31,19,C.teal,true);
 text(s,'认领这个 Issue',822,271,365,47,31,C.ink,true);
 text(s,'点击 assign yourself，\n把这项任务分派给自己。',823,333,365,70,24,C.muted);
 line(s,823,424,365);dot(s,824,444,10,C.teal);text(s,'规则核对：待认领',846,429,336,39,22,C.teal,true);
 text(s,'AI 答疑',823,490,365,31,19,C.ink,true);
 shape(s,822,534,368,41,C.paper,C.line,6);text(s,'为什么要先认领任务？',836,536,331,36,19,C.muted);
 text(s,'规则检查：指派结果包含当前用户，才确认这一步完成。',65,613,990,36,24,C.soft);proto(s,true);
 note(s,'90 秒','假设现在进行到认领任务。左侧就是用户正在用的网页，高亮框指向 assign yourself；右侧说明当前步骤，解释为什么要认领，并显示规则检查还在等待认领结果。如果用户不理解，可以在同一个侧栏继续问 AI，不用离开当前任务去组织一遍问题。用户仍然自己操作网页，规则根据页面结果更新进度，AI 负责解释和答疑。比如认领任务这一步，点击之后还要读取指派结果，包含当前用户时才确认完成。页面变化或者目标失效时，需要先撤掉旧高亮，再重新核对位置。后续的分支、文档提交和 PR 检查也沿用这种交互，首版先带用户走到正确的 PR 已建立，再交给同伴评审。',source.design+'；docs/design/WebGuideAI-引导交互-v0.1.md；'+source.stories+' US03–US05。概念原型。');
 }

 // 7: Full system naturally follows the reusable task example.
 {
 const s=add();heading(s,7,'教程的创建、使用与维护','GitHub 协作是第一份教程，教程的创建与维护构成完整系统');
 const xs=[65,465,865];
 const cards=[['01','形成教程草稿','录制示范操作\n或依据资料生成草稿'],['02','编辑、验证、发布','补齐前提与完成条件\n在目标页面验证后发布'],['03','现场引导与核对','引导用户完成任务\n解释步骤并检查结果']];
 cards.forEach(([n,title,body],j)=>{const x=xs[j];shape(s,x,245,350,211,j===2?C.pale:C.white,j===2?C.teal:C.line,8);text(s,n,x+22,262,302,31,20,C.teal,true);text(s,title,x+22,310,307,48,29,C.ink,true);text(s,body,x+22,378,306,61,24,C.muted);if(j<2)arrow(s,x+359,342,29);});
 s.shapes.add({geometry:'downArrow',position:{left:1034,top:472,width:18,height:29},fill:C.teal,line:{fill:'none',width:0}});
 shape(s,465,512,750,62,C.deep,'none',7);text(s,'用户反馈卡点，作者修订或撤下失效教程',487,525,708,35,24,C.white,true);
 s.shapes.add({geometry:'upArrow',position:{left:630,top:475,width:18,height:29},fill:C.teal,line:{fill:'none',width:0}});
 text(s,'教程作者',65,591,350,35,22,C.muted);text(s,'作者与维护者',465,591,350,35,22,C.muted);text(s,'学习者',865,591,350,35,22,C.teal,true);
 note(s,'75 秒','前面的例子，展示的是学习者如何使用一份教程。完整系统还要回答：这份教程从哪里来，页面变了又由谁修。作者可以先录制一次示范，或者依据资料形成草稿，再补齐步骤、适用前提和完成条件。经过目标页面验证后，发布一个可用版本。学习者使用时，如果卡住了，可以反馈到维护环节，由作者修订，或者撤下已经失效的教程。所以 GitHub 协作是我们先打通的一份教程，后面还会建设教程创建、发布和维护能力，让经验可以反复使用。',source.stories+' US07–US13；'+source.design+' §1–6。');
 }

 // 8: Implementation follows the complete tutorial lifecycle.
 {
 const s=add();heading(s,8,'实现思路与下一步');
 shape(s,65,204,722,290,C.white,C.line,10);text(s,'浏览器扩展',88,224,674,43,31,C.ink,true);text(s,'WXT / React / TypeScript',89,279,675,35,24,C.teal,true);
 const xx=[89,320,551],tt=['页面观察','会话与规则','侧栏与高亮'];
 xx.forEach((x,j)=>{shape(s,x,344,211,113,C.paper,C.line,8);text(s,tt[j],x+13,365,185,42,25,C.ink,true);});
 shape(s,877,204,338,290,C.deep,'none',10);text(s,'模块化后端',900,226,291,43,31,C.white,true);text(s,'Node.js / Fastify',901,284,290,35,24,C.mint,true);text(s,'模型接入与答疑\n后续教程与反馈管理',900,355,291,85,23,C.soft);arrow(s,813,335,38);
 text(s,'已有基础',65,530,152,35,23,C.teal,true);text(s,'页面状态读取、跨页关联，以及高亮的失效撤销。',225,530,990,35,23,C.ink);
 text(s,'下一步',65,590,152,35,23,C.teal,true);text(s,'完成 GitHub 协作原型，再请新手试走，依据卡点修订。',225,585,990,54,23,C.ink);
 note(s,'65 秒','最后，这套方案怎样落地？浏览器扩展负责眼前页面的观察、任务进度、规则检查和高亮，让交互及时响应；后端统一接入模型，随后承接教程与反馈管理。技术方向是扩展端 WXT、React、TypeScript，后端 Node.js 和 Fastify。我们已经做过页面状态读取、跨页关联和扩展生命周期的基础实验。下一步会把这些机制接到 GitHub 协作的真实页面，先交付一条可用的任务引导，再请新手试走，根据实际卡点修订。后续沿用同一套教程结构，继续建设创建和维护能力。我们希望最终让使用者在当前网页上知道该做什么，也知道自己是否做成。',source.design+'；experiments/pages-state-spike/README.md；experiments/extension-lifecycle-spike/README.md。');
 }
 return p;
}
