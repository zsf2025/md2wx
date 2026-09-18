---
name: md2wx
display_name: Markdown 转公众号排版
description: 将 Markdown 转换为微信公众号编辑器可直接复制粘贴的富文本内容。当用户要求"转公众号"、"md2wx"、"markdown 转公众号"、"把这篇文章转成公众号格式"、"生成公众号排版"等时使用。支持标题、加粗、斜体、列表（含任务列表勾选态）、代码块（高亮+行号）、引用、表格、图片、分割线、脚注，输出全部使用行内样式，并做标签+属性双重白名单过滤以兼容公众号编辑器。可选自动发布模式：图片自动上传公众号素材库、文章自动存入草稿箱。
version: 1.0.8
author: fu914
license: MIT
tags: 公众号, markdown, 排版, 富文本, 内容创作
agent_created: true
---

# md2wx — Markdown 转微信公众号富文本

## Overview

将 Markdown 文档转换为公众号编辑器可用的富文本。核心原理：公众号编辑器粘贴时只保留**行内样式**（style 属性）且剔除不认识的标签/属性，因此转换产物必须满足：

1. 所有样式写进 `style` 属性（不依赖任何 `<style>` 标签或 class）
2. **标签**白名单过滤：危险标签（script/style/iframe/input/...）连内容移除，未知标签「拆壳」保留内容
3. **属性**白名单过滤（仅保留 `style, src, href, width, height, leaf, class, data-lang, rowspan, colspan, type, checked, disabled`）
4. 代码块按行拆成独立 `<code>` 元素并用 `&nbsp;` 保留空格缩进、用 DOM 元素实现行号（CSS counter 粘贴后失效）
5. 表格单元格强制左对齐 + `word-break: break-all`，避免文字被等距拉伸
6. 列表标记符/脚注用**渲染期动态随机哨兵**中转，禁止使用固定字符串做占位符（会与正文冲突）

以上逻辑已完整实现在 `assets/wx_template.html` 模板中，不要重新造轮子。

## 触发词

"转公众号"、"md2wx"、"markdown 转公众号"、"公众号排版"、"转成公众号格式"。只要用户提供了 Markdown 内容（文本、文件）并希望粘贴进公众号编辑器，即使用此 Skill。"发到公众号"、"自动发布"、"上传素材库"、"存草稿"、"帮我发表"等则在预览交付后走「执行流程」第 2/3 步。

## 执行流程（三步引导，v1.0.8 起）

**第 1 步 · 生成预览（默认行为，不动图片）**：

1. **获取 Markdown**：用户直接粘贴的文本写入临时 `.md` 文件（UTF-8）；用户给的文件路径直接使用。
2. **生成转换页面**：
   ```bash
   python "<skill-dir>/scripts/build_wx_page.py" <input.md> [-o output.wx.html]
   ```
   脚本会把 Markdown 以 JSON 形式安全注入模板（自动处理 `</script>`、引号、换行、emoji 等特殊字符），输出 `output.wx.html`。
3. **交付**：用 present_files 打开生成的 `output.wx.html`。页面左侧为可编辑的 Markdown，右侧为公众号效果实时预览（最大宽度 677px，与公众号正文一致）。
4. **告知操作**：用户点击页面右上角绿色「**复制到公众号**」按钮，然后到公众号编辑器 Ctrl+V 粘贴，排版即保留。若修改了左侧 Markdown，需重新点击复制按钮。

**预览阶段不替换图片、不上传素材库、绝不调用发布脚本**——预览 HTML 在本地浏览器打开，外链图可以正常显示；只有粘贴进公众号编辑器时外链图才会被拦截（页面会 console.warn 提醒）。

**第 2 步 · 顺带告知可自动发布**：交付预览后附一句：「也可以由我直接发布到公众号草稿箱（图片自动上传素材库），需要的话回复确认即可。」**不主动展开配置细节**。用户未确认前不做任何发布动作。

**第 3 步 · 用户确认后发布（不生成预览 HTML，减少输出）**：

1. **直接运行发布脚本**（脚本内置凭证/IP 检测，不必先跑 check）：
   ```bash
   NODE_PATH="<node_modules 目录>" node "<skill-dir>/scripts/publish_wx.js" article.md --title "标题"
   ```
   建议先加 `--dry-run` 试跑一次（只渲染不调接口，秒回）。
2. **检测通过** → 脚本自动上传图片、存入草稿箱，输出极简 JSON（`draft_media_id` / `title` / `uploaded` / `reused`）。向用户转述结果即可：**草稿已创建 + 到公众号后台草稿箱预览确认后群发**。不要生成预览 HTML、不要粘贴正文内容。
3. **检测不通过**（脚本退出码 2 并打印配置指引）→ 把指引原样转述给用户（AppID/AppSecret 获取、IP 白名单配置，见下节），用户配置好后回到第 1 小步重跑。

## 自动发布模式（图片上传素材库 + 存入草稿箱）

发布流程详见「执行流程」第 2/3 步。本节是配置方法与脚本参考——**仅在用户确认要发布、且脚本检测不通过时**才把这里的内容转述给用户。流程：渲染 HTML（与复制粘贴同一套管线）→ 正文图片自动上传永久素材并替换为 mmbiz 地址 → `draft/add` 存入草稿箱 → 用户到后台人工预览后群发。

### ⚠️ 使用前必须引导用户完成一次性配置（务必先向用户说明再执行）

1. **获取凭证**：登录 [mp.weixin.qq.com](https://mp.weixin.qq.com) → 左侧「设置与开发」→「基本配置」→ 查看 **开发者ID(AppID)** 与 **开发者密码(AppSecret)**（AppSecret 首次需点击"启用"并扫码获取，重置后旧值立即失效）。订阅号/服务号均可，**未认证的个人订阅号也开放素材与草稿 API 权限**。
2. **配置 IP 白名单**（最常见的失败点，errcode=40164）：仍在「基本配置」页面下方找到「**IP白名单**」→ 点击修改 → 加入**本机公网 IP**（可在本机执行 `curl ifconfig.me` 查询，或访问 ip138.com 查看）。**家庭/办公网络的公网 IP 会变动，IP 变了必须重新加入白名单**。修改后约需 5 分钟生效。
3. **写入配置**（二选一，不要把 secret 写进任何会提交/分享的文件）：
   - 技能目录下创建 `wx_config.json`：`{ "appid": "wx1234567890abcdef", "secret": "你的AppSecret" }`
   - 或环境变量 `WX_APPID` / `WX_SECRET`
4. **自检连通性**（可选；脚本运行时也会自动检测。check 会同时验证凭证与 IP 白名单）：
   ```bash
   NODE_PATH="<node_modules 目录>" node "<skill-dir>/scripts/wx_api.js" check
   ```
   输出"access_token 获取成功"即配置完成。

### 发布命令

```bash
NODE_PATH="<node_modules 目录>" node "<skill-dir>/scripts/publish_wx.js" article.md \
  --title "文章标题" --author "作者" --digest "摘要（不传则自动截取正文前 54 字）" \
  [--cover <图片路径|URL|media_id:xxx>] [--config <配置文件>] [--dry-run] [--verbose]
```

- **先 `--dry-run` 再真发**：dry-run 只渲染并报告"将上传哪些图片"，不调任何接口。
- **输出极简**：默认只输出一行 JSON（`draft_media_id`/`title`/`uploaded`/`reused`），`--verbose` 才输出完整图片清单——发布模式下不要加 `--save-html`，不要生成预览 HTML，减少 token 消耗。
- **标题回退**：不传 `--title` 时取 Markdown 首个 `# 一级标题`（≤64 字）。
- **封面**：`draft/add` 强制要求 `thumb_media_id`。`--cover` 传本地路径或 URL 会自动上传取 media_id；不传则自动用正文第一张本次上传的图片；正文无图且未指定时报错。
- **图片自动上传**：正文里的本地图片与外链图片（http/https）自动上传永久素材（≤10MB，jpg/png/gif/bmp），`src` 替换为返回的 mmbiz.qpic.cn 地址；已是素材库域名的图片原样保留。已上传的图按 `src` 记入 `<skill-dir>/.wx_upload_cache.json`，重复发布不重复上传（改图后同名路径命中旧缓存时，删除该缓存条目即可强制重传）。
- **产出**：草稿 media_id + 上传图片数。**群发不在脚本内做**（订阅号每天仅 1 次群发），完成后告知用户到后台「内容与互动 → 草稿箱」预览确认。

### 常见错误速查

| errcode | 含义与处理 |
|---|---|
| 40164 | 本机 IP 不在白名单（错误 message 会带微信判定的 IP）→ 加白名单后等 5 分钟 |
| 40001 / 40125 | AppSecret 错误或已被重置 → 后台重新查看/重置 |
| 42001 | token 过期（脚本自动刷新重试，若仍报则检查系统时间） |
| 45009 | 当日接口配额用完 → 次日再试 |
| 48001 | 公众号无该 API 权限 → 确认账号类型 |
| 53405 | 缺封面 → 传 `--cover` |

相关文件：`scripts/wx_api.js`（token 缓存/素材上传/草稿 API，含 `check`/`upload`/`draft-count` 自检子命令）、`scripts/publish_wx.js`（发布主流程）。正文 HTML 由模板管线生成、经 copySafe 同源清洗，`draft/add` 的 `content` 字段要求纯内联样式 HTML——与复制粘贴产物完全一致，无需额外转换。

## 转换规则（模板内已实现，供排障参考）

| Markdown 元素 | 处理方式 |
|---|---|
| `#` 一级标题 | 22px 加粗 + 绿色 (#07c160) 底部分割线 |
| `##` 及以下 | 16px 加粗，上下 20px/10px 间距 |
| 正文段落 | 16px / 行高 1.75（左对齐，**禁用两端对齐**，原因见注意事项） |
| 无序/有序列表 | flex 布局 section（**禁用 align-items: flex-start/flex-end**——公众号校验规则 #2.6 会把对齐属性中含 start/end 词素的值标记为非标准值，用默认 stretch 等价替代），绿色标记符 `•` / `1.`，列表项间距 0 修复；标记符经动态哨兵中转 |
| 列表标记符宽度 | **按本组最大编号位数自适应**（`markerWidth()`：位数×0.62em + 0.45em，组内统一宽度保证正文左边缘对齐）。禁止写死像素宽——固定 15px 时 `10.`（实测 24.09px）会压住正文 5.09px、`100.` 压 14.53px |
| 任务列表 | 渲染为文本符号 `☑` / `☐`（不输出 `<input>`，公众号不认表单元素且会剥离其属性），且不额外加 `•` 圆点 |
| 行内代码 | 85% 字号 + 浅灰背景圆角 |
| 代码块 | highlight.js 高亮，类名 `code-snippet__*`，每行独立 `<code><span leaf="">`，DOM 行号（`textContent` 写入），`&nbsp;` 保留缩进 |
| 代码行号栏 | 宽度按最高行号位数自适应（`lnGutter()`：≤2 位 20px，之后每位 +8px；代码缩进 = 栏宽 + 30px）。预览侧走 `--lnw` CSS 变量 + `calc()`，粘贴侧走内联样式，**两侧必须用同一个函数**，否则预览与发布效果不一致 |
| 引用 | 浅灰背景 + 左侧 4px 绿色边框 |
| 表格 | 复制时注入 collapse 边框、th 灰底、单元格左对齐可断行。**断行规则必须预览/粘贴两侧同源**：粘贴侧 copySafe 注入 `word-break: break-all`，预览侧靠 `.wx-article th, td` CSS——缺预览侧规则时长 URL/无空格长串会把表格撑出容器 |
| 图片 | max-width 100% + height:auto（只缩不放、等比缩放）、居中、圆角。**必须用公众号素材库图片**（mmbiz.qpic.cn），外链图片粘贴后会被公众号拦截为占位空白，表现为"文本之间出现大块间隔" |
| 分割线 | 1px 浅灰上边框，上下 24px |
| 脚注 | `[^x]` 转上标 `[1]`，`[^x]: 内容` 抽取后在文末生成「参考」区（marked 原生会把定义行当引用式链接定义吞掉，必须自行接管） |
| 空格/缩进 | 文本空格转 `&nbsp;`，防止公众号编辑器吞掉。**代码块内所有空格**（含行中）都会转 `&nbsp;` |
| 原始 HTML | 白名单内标签保留；`details/summary/meter/progress/marquee` 等拆壳留文字；`script/iframe/input` 等连内容移除 |

渲染依赖 CDN：marked 12.0.2 + highlight.js 11.9.0（cdnjs，含常用语言），需联网打开页面。

## 样式定制

主题色 `#07c160`（微信绿）在模板 `S` 常量与若干 style 字符串中硬编码。若用户要求换主题色，用 Edit 工具在模板中全局替换色值即可。

改动模板后跑回归测试，确认各元素转换未被破坏。**两个脚本分工不同，改动了哪一侧就至少跑对应那个**：

```bash
# 1) 渲染结构（DOM 桩，无额外依赖）
NODE_PATH="<node_modules 目录>" node scripts/test_renderer.js        # 27 项

# 2) 复制阶段白名单 / 代码行号 DOM 化 / 勾选态（需真实 DOM，用 jsdom）
NODE_PATH="<node_modules 目录>" node scripts/test_copysafe.js        # 27 项

# 3) 序号/行号栏宽度自适应（DOM 桩，锁死 markerWidth/lnGutter 公式与余量）
NODE_PATH="<node_modules 目录>" node scripts/test_numbering.js       # 18 项
```

测试复用模板中的真实 renderer 与 `renderToHtml` 管线。依赖仅测试时需要：`npm install marked@12.0.2 highlight.js@11.9.0 jsdom`。脚本按 `MD2WX_NODE_MODULES` → `NODE_PATH` → 裸 `require` 的顺序解析模块，任一方式可用即可。

`test_copysafe.js` 用 `runScripts: 'outside-only'` 打开模板、手动 eval 模板脚本，并在 `execCommand` 被调用的瞬间抓取离线克隆节点做断言（jsdom 会把内联颜色规范化成 `rgb()`，断言前需还原为 hex）。**不要把它退回成 DOM 桩**——`copySafe()` 里的 DOM 遍历、白名单、行号注入在桩下全是空操作，等于没测。

## 注意事项

- 页面使用 `document.execCommand('copy')` 复制富文本到剪贴板——这是浏览器中复制带样式 HTML 的唯一可靠方式。
- 若在内嵌预览面板中点击复制按钮无反应或提示失败（部分宿主会因剪贴板权限策略拦截 iframe 内的写剪贴板），提示用户用系统浏览器直接打开该 HTML 文件后再复制。
- 代码高亮仅覆盖 highlight.js 常用语言包，冷门语言自动降级为纯文本。
- **禁用 `text-align: justify` / `text-justify` / `word-break: break-all`**（正文与列表）。公众号编辑器里，块内文本行后面只要还有行内内容（图片、行内块等），该行就不是"最后一行"，justify 会把整行字符均匀拉开到满宽——表现为"每个字之间出现大空隙"；break-all 还会把英文单词拆散。长 URL 溢出用 `overflow-wrap: break-word` 兜底。表格单元格因无 justify 可保留 break-all。
- 外链图片会被公众号编辑器拦截，粘贴后显示为一块占位空白（"文本之间大间隔"的常见根因）。`copySafe()` 已加检测并 console.warn 提醒；图片必须先上传到公众号素材库（或用 v1.0.7+ 的自动发布模式，脚本会自动上传替换）。属平台限制，代码无法绕过。
- 公众号编辑器不支持外部链接跳转（`<a>` 会被转为纯文本），属平台限制，无需处理。
- **任何随内容增长的序号都不能写死宽度**。列表标记符、代码行号栏、脚注参考区序号都按「组内最大位数」计算宽度并留 ≥10% 余量（兼容公众号端字体差异）。历史上标记符写死 15px，编号过两位数就压住正文；代码行号栏预览侧写死 20px，三位数行号首字被 `overflow-x` 裁掉。改动宽度逻辑后，用真实浏览器量一下（`getBoundingClientRect` + Range 量文字宽），DOM 桩和 jsdom 都没有布局引擎，量不出重叠。
- **预览侧与粘贴侧的行号栏必须同源**：预览用 CSS 计数器 + `--lnw` 变量，粘贴用 DOM span + 内联宽度，两者都调 `lnGutter()`。改了其中一侧而不同步另一侧，用户会"所见非所得"。`--lnw` 变量在 `copySafe()` 里会被清除，不会混进剪贴板。
- **不要用固定字符串做占位符**。历史上列表标记符用 `%%M%%` 中转，正文里出现同名文本就会被替换成 `•`（连行内代码内部也替换），属静默内容损坏。现在统一走 `makeToken()` 生成渲染期随机哨兵（含标记符宽度槽位 `TOK.w`），并在渲染结束后校验哨兵已全部消费。
- 脚注是自行接管的：`preprocessFootnotes()` 会在解析前抽出定义行。**处理时必须跳过围栏代码块、缩进代码块与行内代码**，否则代码示例里的 `[^x]: ...` 会被误当定义抽走——这属于同一类静默内容损坏。
- 页面只对**剪贴板内容**做白名单清洗；左侧预览是直接 `innerHTML` 渲染的，Markdown 里的原始 HTML（如 `<img onerror=...>`）在预览页内会原样生效。当前输入均为用户自有内容，未做预览侧净化；若将来要渲染他人提供的 Markdown，需先净化再 `innerHTML`。
- 公众号编辑器不支持 `details/summary/meter/progress` 等标签，模板会拆壳只留文字，属预期行为。

