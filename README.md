# md2wx — Markdown 转微信公众号富文本

一个 [WorkBuddy](https://www.workbuddy.cn) 技能（Skill）：把 Markdown 一键转换为微信公众号编辑器可直接粘贴的富文本，保留标题、列表、代码高亮 + 行号、表格、引用、图片、脚注等排版。

![version](https://img.shields.io/badge/version-1.0.5-green) ![license](https://img.shields.io/badge/license-MIT-blue)

## 工作原理

公众号编辑器粘贴时只保留**行内样式**（`style` 属性），并剔除不认识的标签/属性。本技能的核心是一份自包含的 HTML 模板（`assets/wx_template.html`）：

1. 所有样式写入 `style` 属性，不依赖 `<style>` 标签或 class
2. 标签 + 属性双重白名单过滤：危险标签（`script`/`iframe`/`input`…）连内容移除，未知标签「拆壳」保留文字
3. 代码块按行拆成独立元素，`&nbsp;` 保留缩进，DOM 行号（CSS counter 粘贴后失效）
4. 列表标记符 / 脚注 / 行号栏宽度均按内容位数**自适应**，杜绝序号压住正文或被裁切
5. 渲染期动态随机哨兵中转标记符，杜绝固定占位符与正文冲突

## 使用

### 在 WorkBuddy 中使用

将本仓库克隆到技能目录（或通过 SkillHub 安装）：

```bash
git clone https://github.com/<you>/md2wx.git ~/.workbuddy/skills/md2wx
```

然后对 WorkBuddy 说「把这篇文章转成公众号格式」即可。生成页面后点击右上角「**复制到公众号**」，到公众号编辑器 Ctrl+V 粘贴。

### 单独使用（无需 WorkBuddy）

```bash
python scripts/build_wx_page.py article.md -o article.wx.html
```

用浏览器打开 `article.wx.html`，左侧编辑 Markdown，右侧实时预览公众号效果，点「复制到公众号」粘贴。

## 特性

| 元素 | 处理方式 |
|---|---|
| 标题体系 | H1 绿色底部分割线，H2+ 加粗分级 |
| 列表 | flex 布局，标记符宽度按最大编号位数自适应，任务列表输出 `☑`/`☐` |
| 代码块 | highlight.js 高亮 + 自适应 DOM 行号，预览与粘贴侧同源函数保证所见即所得 |
| 表格 | 复制时注入边框、灰底表头、单元格左对齐断行 |
| 脚注 | 自行接管解析（marked 原生会吞掉定义行），文末生成「参考」区 |
| 安全 | 剪贴板内容标签 + 属性双重白名单，事件属性（`onclick` 等）全部剥离 |

## 已知平台限制（代码无法绕过）

- **外链图片会被公众号拦截**，粘贴后显示为占位空白——图片必须先上传到公众号素材库（复制时已自动检测并警告）
- 外部链接 `<a>` 会被转为纯文本
- `details/summary/meter/progress` 等标签拆壳只留文字

## 开发与测试

```bash
npm install marked@12.0.2 highlight.js@11.9.0 jsdom

# 渲染结构回归（DOM 桩，25 项）
NODE_PATH=<node_modules> node scripts/test_renderer.js

# 复制阶段白名单 / 行号 / 勾选态（jsdom 真实 DOM，26 项）
NODE_PATH=<node_modules> node scripts/test_copysafe.js

# 序号 / 行号栏宽度公式（18 项）
NODE_PATH=<node_modules> node scripts/test_numbering.js
```

模块解析顺序：`MD2WX_NODE_MODULES` → `NODE_PATH` → 裸 `require`。

## Changelog

见 [CHANGELOG.md](CHANGELOG.md)。

## License

[MIT](LICENSE)

