// md2wx 渲染回归测试
// 复用 assets/wx_template.html 中真实的 marked renderer + 渲染管线（renderToHtml），
// 用 DOM 桩在 Node 中跑通转换并断言输出结构。
// 用途：修改模板样式（如换主题色）后运行本脚本，快速确认各元素转换未被破坏。
//
// 分工：
//   本脚本           —— 渲染结构（DOM 桩，无额外依赖）
//   test_copysafe.js —— 复制阶段白名单 / 行号 DOM 化 / 勾选态（需 jsdom，见该文件）
//
// 依赖：marked@12.0.2、highlight.js@11.9.0（仅测试用，正式使用不需要）
// 运行：
//   NODE_PATH=<node_modules 目录> node scripts/test_renderer.js
// 依赖缺失时先安装：
//   npm install marked@12.0.2 highlight.js@11.9.0
const fs = require('fs');
const path = require('path');

function loadModule(name) {
  const extra = process.env.MD2WX_NODE_MODULES || process.env.NODE_PATH;
  const candidates = [name];
  if (extra) extra.split(path.delimiter).forEach(p => p && candidates.push(path.join(p, name)));
  for (const c of candidates) {
    try { return require(c); } catch (e) { /* 尝试下一个 */ }
  }
  console.error(`[md2wx-test] 找不到模块 ${name}，请先执行 npm install marked@12.0.2 highlight.js@11.9.0`);
  process.exit(2);
}

const { marked } = loadModule('marked');
const hljs = loadModule('highlight.js');

const SKILL = path.resolve(__dirname, '..');
const tpl = fs.readFileSync(path.join(SKILL, 'assets/wx_template.html'), 'utf8');
const baseMd = fs.readFileSync(path.join(SKILL, 'testdata/sample.md'), 'utf8');

// 追加回归用例：哨兵污染 / 任务列表勾选态 / 脚注。
// 注意不要追加代码块，否则会改变下方「代码块逐行 <code> 数量」的断言。
const extraMd = [
  '',
  '## 哨兵 / 勾选态 / 脚注回归',
  '',
  '- 列表内的字面量 %%M%% 与 `%%M%%` 必须原样保留',
  '- [x] 已完成项',
  '- [ ] 未完成项',
  '',
  '正文引用[^a]，另一处[^b]。',
  '',
  '[^a]: 脚注甲的内容。',
  '[^b]: 脚注乙的内容。',
  '',
].join('\n');
const md = baseMd + extraMd;

const script = tpl.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace('__MARKDOWN_JSON__', JSON.stringify(md).replace(/</g, '\\u003c'));

// --- DOM 桩：模板脚本只在浏览器中运行，测试时用最小实现替代 ---
const makeEl = () => ({
  style: {}, value: '', innerHTML: '', innerText: '',
  addEventListener() {}, appendChild() {}, prepend() {}, removeChild() {}, insertBefore() {},
  querySelectorAll: () => [], querySelector: () => makeEl(),
  cloneNode: () => makeEl(),
  attributes: [], tagName: 'DIV', children: [], parentNode: null, firstChild: null,
  removeAttribute() {},
});
global.document = {
  getElementById: () => makeEl(),
  createElement: () => makeEl(),
  createRange: () => ({ selectNodeContents() {} }),
  execCommand: () => true,
  body: { appendChild() {}, removeChild() {} },
  querySelector: () => ({ style: {}, innerText: '' }),
};
global.window = { getSelection: () => ({ removeAllRanges() {}, addRange() {} }) };
global.hljs = hljs;

// 执行模板脚本并取回渲染管线入口（脚本内部函数不会挂到全局，需显式返回）
const api = new Function('marked', 'hljs', 'document', 'window', 'console',
  script + '\n;return { renderToHtml: renderToHtml };')(marked, hljs, global.document, global.window, console);

const html = api.renderToHtml(md);

const checks = [
  ['H1 绿色下划线样式', html.includes('<h1 style="font-size: 22px') && html.includes('#07c160')],
  ['H2 加粗内联样式', /<h2 style="font-weight:bold/.test(html)],
  // 公众号编辑器会把「文本行后还有行内内容（图片等）」的 justify 块整体拉伸到整行宽，
  // 造成字距被均匀拉开（截图中 "3. 有 序 项…" 的现象），因此禁止任何 justify 上屏。
  ['已禁用两端对齐（防公众号拉伸）', !html.includes('text-align: justify') && !html.includes('inter-ideograph')],
  ['列表正文换行策略为 overflow-wrap', html.includes('overflow-wrap: break-word')],
  ['无序列表 marker 为 •', html.includes('>•</span>')],
  ['有序列表编号保留', html.includes('>1.</span>') && html.includes('>2.</span>')],
  ['列表项 flex 布局', html.includes('display: flex; align-items: flex-start')],
  ['行内代码渲染', html.includes('<code>inline code</code>')],
  ['代码块容器 code-snippet', html.includes('class="code-snippet__js code-snippet code-snippet_nowrap"')],
  ['代码块逐行 <code>', (html.match(/<code><span leaf="">/g) || []).length === 5],
  ['代码缩进转 &nbsp;', html.includes('\u00A0\u00A0')],
  ['代码高亮类名改写', html.includes('code-snippet__keyword') || html.includes('code-snippet__title')],
  ['引用块绿色左边框', html.includes('border-left: 4px solid #07c160')],
  ['表格渲染', html.includes('<table>') && html.includes('<th align="left">')],
  ['加粗 <strong>', html.includes('<strong>')],
  ['图片渲染', html.includes('<img')],
  // 图片宽度：无内联 max-width 时，原图超过正文宽度（677px）会横向溢出（预览与粘贴后均是）
  ['图片带内联 max-width:100%', (html.match(/<img [^>]*style="max-width: 100%; height: auto;"/g) || []).length > 0],
  ['分割线渲染', html.includes('<hr>')],
  // 旧断言为 `!html.includes('%%M%%')`，与占位符污染缺陷互为盲区：正文被吞反而更容易通过。
  // 正确做法是断言字面量「原样保留」，同时确认内部哨兵不泄漏。
  ['正文中的字面量 %%M%% 原样保留', (html.match(/%%M%%/g) || []).length === 2],
  ['内部哨兵不泄漏到输出', !html.includes('@@md2wx_')],
  // 任务列表勾选态：公众号不认 <input>，须渲染为文本符号
  ['任务列表渲染为 ☑/☐ 文本', html.includes('☑') && html.includes('☐')],
  ['任务列表不再产生 <input>', !html.includes('<input')],
  // 脚注：marked 会把 [^x]: 当引用式链接定义吞掉，需管线补齐
  ['脚注正文未丢失', html.includes('脚注甲的内容') && html.includes('脚注乙的内容')],
  ['脚注引用转上标', /<sup style="font-size: 75%/.test(html)],
  ['文末生成脚注参考区', html.includes('>参考</p>')],
  ['脚注未退化为乱码链接', !html.includes('href="%')],
];

let fail = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? '✅' : '❌'} ${name}`);
  if (!ok) fail++;
}
const dump = path.join(process.env.TEMP || '.', 'md2wx_render_fragment.html');
fs.writeFileSync(dump, html, 'utf8');
console.log(`\n${checks.length - fail}/${checks.length} 通过；渲染片段已写入 ${dump}`);
console.log('提示：复制阶段逻辑（标签/属性白名单、行号 DOM 化、勾选态）请运行 scripts/test_copysafe.js');
process.exit(fail ? 1 : 0);
