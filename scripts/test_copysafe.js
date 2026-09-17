// md2wx 剪贴板白名单回归测试（真实 DOM）
//
// 分工说明：
//   test_renderer.js  —— 用 DOM 桩覆盖「渲染结构」（无额外依赖，快）
//   test_copysafe.js  —— 用 jsdom 覆盖「复制阶段」逻辑（属性白名单 / 标签白名单 /
//                        代码行号 DOM 化 / 任务列表勾选态），这些逻辑在 DOM 桩下不可测
//
// 依赖：marked@12.0.2、highlight.js@11.9.0、jsdom
// 运行：NODE_PATH=<node_modules 目录> node scripts/test_copysafe.js
//   缺少 jsdom 时：npm install jsdom
const fs = require('fs');
const path = require('path');

function loadModule(name) {
  const extra = process.env.MD2WX_NODE_MODULES || process.env.NODE_PATH;
  const candidates = [name];
  if (extra) extra.split(path.delimiter).forEach(p => p && candidates.push(path.join(p, name)));
  for (const c of candidates) {
    try { return require(c); } catch (e) { /* 尝试下一个 */ }
  }
  return null;
}

const markedMod = loadModule('marked');
const hljs = loadModule('highlight.js');
const jsdomMod = loadModule('jsdom');
if (!markedMod || !hljs) {
  console.error('[md2wx-test] 缺少 marked / highlight.js，请先执行 npm install marked@12.0.2 highlight.js@11.9.0');
  process.exit(2);
}
if (!jsdomMod) {
  console.error('[md2wx-test] 缺少 jsdom，剪贴板测试无法运行：npm install jsdom');
  process.exit(2);
}

const { marked } = markedMod;
const { JSDOM } = jsdomMod;

const SKILL = path.resolve(__dirname, '..');
const tpl = fs.readFileSync(path.join(SKILL, 'assets/wx_template.html'), 'utf8');
const md = fs.readFileSync(path.join(SKILL, 'testdata/copysafe.md'), 'utf8');

// 用真实 DOM 打开模板；outside-only 表示不执行页面内任何脚本，由我们手动 eval
const dom = new JSDOM(tpl, { runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
window.marked = marked;
window.hljs = hljs;
window.alert = () => {};
// jsdom 未实现选区与 execCommand，用最小实现替代（不改变被测样式逻辑）
window.getSelection = () => ({ removeAllRanges() {}, addRange() {} });
let copiedHtml = null;
let copiedNode = null;
window.document.execCommand = () => {
  // copySafe 会把离线克隆节点挂到 body 末尾，execCommand 是复制前的最后一步，此时抓取快照
  copiedNode = window.document.body.lastElementChild;
  copiedHtml = copiedNode.outerHTML;
  return true;
};

const script = tpl.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace('__MARKDOWN_JSON__', JSON.stringify(md).replace(/</g, '\\u003c'));
window.eval(script);

window.document.getElementById('editor').value = md;
window.render();

// 追加一个 105 行的合成代码块：行号栏宽度必须随位数加宽（3 位 -> 28px 栏 + 58px 代码缩进）。
// 旧实现固定 40px/50px，既与预览侧（20px）不一致，位数再多会失效。
const outEl = window.document.getElementById('output');
const longPre = window.document.createElement('pre');
longPre.className = 'code-snippet';
for (let i = 1; i <= 105; i++) {
  const c = window.document.createElement('code');
  c.textContent = 'line ' + i;
  longPre.appendChild(c);
}
outEl.appendChild(longPre);

window.copySafe();

const rendered = window.document.getElementById('output').innerHTML;
const clip = copiedHtml || '';
// jsdom 会把内联样式里的颜色规范化成 rgb(...)，浏览器不会。比对前统一还原为 hex，避免误判。
const toHex = (s) => s.replace(/rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)/g,
  (m, r, g, b) => '#' + [r, g, b].map(n => (+n).toString(16).padStart(2, '0')).join(''));
const clipN = toHex(clip);
const has = (s) => clipN.includes(s);
const rHas = (s) => rendered.includes(s);
// 已脱离文档的克隆节点仍可用 DOM API 查询，比字符串比对更稳
const hr = copiedNode ? copiedNode.querySelector('hr') : null;
const lineSpans = copiedNode ? copiedNode.querySelectorAll('pre.code-snippet code') : [];
// 行号栏宽度自适应：短代码块（1 位行号）维持 20px 基准，长代码块（3 位行号）加宽到 28px
const pres = copiedNode ? copiedNode.querySelectorAll('pre.code-snippet') : [];
const shortCode = pres.length ? pres[0].querySelector('code') : null;
const longPreClone = pres.length > 1 ? pres[pres.length - 1] : null;
const longCode = longPreClone ? longPreClone.querySelector('code') : null;
const styleOf = (el, prop) => (el && el.style ? el.style[prop] : '');

const checks = [
  // 任务列表勾选态（旧实现会因属性白名单剥离 type/checked/disabled 而全丢）
  ['勾选态渲染为 ☑ 文本', rHas('☑')],
  ['未勾选渲染为 ☐ 文本', rHas('☐')],
  ['剪贴板中 checkbox 不依赖 <input>', has('☑') && has('☐') && !has('<input')],
  // 标签白名单
  ['危险标签 <script> 连内容移除', !has('危险脚本内容') && !has('<script')],
  ['未知标签 <details> 已拆壳', !has('<details') && !has('<summary')],
  ['<details> 内容被保留', has('折叠内容必须保留') && has('折叠标题')],
  ['<meter> 内容被保留', has('70%') && !has('<meter')],
  ['<progress> 内容被保留', has('30%') && !has('<progress')],
  ['<marquee> 内容被保留', has('跑马灯文字') && !has('<marquee')],
  ['白名单标签 <kbd>/<abbr> 保留', has('<kbd') && has('<abbr')],
  // 属性白名单
  ['事件属性 onclick 被剥离', !has('onclick')],
  ['img onerror 被剥离', !has('onerror')],
  ['非白名单属性 id/data-* 被剥离', !has('id="raw"') && !has('data-x')],
  ['白名单属性 src/style 保留', has('src=') && has('style=')],
  ['链接 href 保留', has('href=')],
  // 代码块行号 DOM 化
  ['代码块容器内联样式', has('background: #f8f8f8') && has('border: 1px solid #e0e0e0')],
  ['代码行号 span 已注入', has('border-right: 1px solid #ddd')],
  // 行号 span 是 copySafe 用 prepend 注入的，故为每个 <code> 的第一个子元素
  ['代码行号从 1 开始且逐行递增', lineSpans.length >= 2
    && lineSpans[0].firstElementChild && lineSpans[0].firstElementChild.textContent === '1'
    && lineSpans[1].firstElementChild && lineSpans[1].firstElementChild.textContent === '2'],
  // 行号栏宽度随位数自适应（旧实现固定 40px，位数增长后与预览/正文的关系失控）
  ['1 位行号栏维持 20px 基准', styleOf(shortCode, 'paddingLeft') === '50px'
    && shortCode && shortCode.firstElementChild && styleOf(shortCode.firstElementChild, 'width') === '20px'],
  ['3 位行号栏加宽至 28px', !!longCode && styleOf(longCode, 'paddingLeft') === '58px'
    && longCode.firstElementChild && styleOf(longCode.firstElementChild, 'width') === '28px'],
  ['预览侧 --lnw 变量不进入剪贴板', !clip.includes('--lnw')],
  ['表格强制左对齐断行', has('word-break: break-all') && has('border-collapse: collapse')],
  // 图片 / 分割线
  ['图片 max-width 内联', has('max-width: 100%')],
  ['图片 height:auto 等比联动', has('height: auto')],
  // 分割线：jsdom 会把 border 简写展开成长属性，浏览器则保留简写，故只断言结构性特征
  ['分割线样式内联', /border[^;]*solid/.test(hr ? hr.style.cssText : '') && /#e0e0e0/.test(toHex(hr ? hr.style.cssText : ''))],
  // 行内代码
  ['行内代码样式内联', has('border-radius: 6px')],
  // 哨兵不得泄漏到剪贴板
  ['无内部哨兵泄漏', !clip.includes('@@md2wx_')],
];

let fail = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? '✅' : '❌'} ${name}`);
  if (!ok) fail++;
}
const dump = path.join(process.env.TEMP || '.', 'md2wx_copysafe_dump.html');
fs.writeFileSync(dump, clip, 'utf8');
console.log(`\n${checks.length - fail}/${checks.length} 通过；剪贴板快照已写入 ${dump}`);
process.exit(fail ? 1 : 0);
