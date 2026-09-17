# Changelog

本文件记录用户可感知的变化。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [1.0.6] - 2026-09-17

### 修复
- **公众号 text-align 校验告警**：列表项与脚注参考区的 lign-items: flex-start 会被公众号编辑器校验规则 #2.6（对齐属性含 start/end 词素判为非标准值）标记。移除该属性改用 flex 默认 stretch，视觉等价（标记符仍顶部对齐），预览/粘贴两侧同源

### 新增
- 测试：`test_renderer.js` +1（内联样式零 start/end 对齐词素断言）、SKILL.md 规则表写入硬约束

## [1.0.5] - 2026-09-17

### 修复
- **表格内容溢出**：预览侧表格单元格缺断行规则，长 URL / 无空格长串的 min-content 宽度把表格撑出容器。补 `.wx-article th, td { word-break: break-all; }`，与粘贴侧 copySafe 注入的规则同源

### 新增
- 测试：`test_renderer.js` +1（表格断行预览侧同源断言）

## [1.0.4] - 2026-09-17

### 修复
- **图片宽度溢出**：marked 默认输出的 `<img>` 无任何宽度约束，原图超过正文宽度（677px）时预览与粘贴后都会横向溢出。新增 `renderer.image()` 钩子，输出内联 `max-width: 100%; height: auto;`（只缩不放、等比缩放）；预览侧补 `.wx-article img` CSS；粘贴侧 `copySafe()` 联动 `height: auto` 防变形

### 新增
- 测试：`test_renderer.js` +1（图片内联宽度断言）、`test_copysafe.js` +1（height:auto 联动断言）

## [1.0.3] - 2026-09-17

### 修复
- **字距拉伸**：移除正文/列表的 `text-align: justify`、`text-justify: inter-ideograph`、`word-break: break-all`。此前文本行后还有行内内容（图片、分割线等）时，公众号会把整行字符均匀拉开占满一行
- 长文本溢出改用 `overflow-wrap: break-word` 兜底，英文单词不再被拆散

### 新增
- `copySafe()` 复制时检测外链图片（非 mmbiz.qpic.cn 域名）并 `console.warn` 提醒——外链图片粘贴到公众号后会被拦截为占位空白
- 测试：`test_renderer.js` 新增「禁用 justify」回归断言

### 变更
- 正文与列表改为左对齐（两端对齐在公众号环境下有整行拉伸风险）

## [1.0.2] - 2026-09-17

### 修复
- **列表序号与正文重叠**：标记符不再写死 15px，改为按组内最大编号位数自适应（`markerWidth()`），组内统一宽度保证正文左边缘对齐。旧实现中 `10.` 溢出 9.09px、`100.` 压住正文 14.53px
- **代码行号栏**：宽度按最高行号位数自适应（`lnGutter()`），修复三位数行号首字被裁切；预览侧与粘贴侧同源调用，修复两侧相差 20px 的「所见非所得」
- 脚注参考区序号宽度同步接入自适应

### 新增
- `scripts/test_numbering.js`（18 项）：锁死宽度公式与安全余量

## [1.0.1] - 2026-09-17

### 修复
- **列表占位符污染**：废除固定 `%%M%%` 标记符中转（正文中出现同名文本会被静默替换为 `•`，含行内代码内部），改为渲染期动态随机哨兵 + 消费校验
- **任务列表勾选态丢失**：`- [x]`/`- [ ]` 改为输出 `☑`/`☐` 文本符号（公众号不认表单元素且会剥离其属性），任务项不再额外占用编号
- **脚注正文消失**：`[^x]: 定义` 被 marked 当引用式链接定义吞掉，现自行接管——解析前抽取定义（跳过围栏/缩进/行内代码，防止误抽代码示例），解析后回填上标并在文末生成「参考」区
- **缺标签白名单**：`copySafe()` 补标签级过滤——危险标签（script/iframe/input 等）连内容移除，未知标签（details/summary 等）拆壳留文字
- 代码行号写入由 `innerText` 改 `textContent`（不依赖布局，可被自动化测试覆盖）

### 新增
- `scripts/test_copysafe.js`（26 项，jsdom 真实 DOM）+ `testdata/copysafe.md`
- 抽出 `renderToHtml()` 作为可独立调用的渲染管线入口

## [1.0.0] - 2026-09-17

### 首个版本
- Markdown → 微信公众号富文本转换模板（全部行内样式 + 双重白名单）
- 支持标题、行内样式、列表（含任务列表）、代码高亮 + 行号、表格、引用、图片、分割线、脚注、原始 HTML 白名单过滤
- `scripts/build_wx_page.py` 一键构建可复制页面；`scripts/test_renderer.js` 渲染回归（DOM 桩）

