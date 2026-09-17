// md2wx 序号宽度回归测试
//
// 覆盖缺陷：编号位数增长时标记符/行号与内容重叠。
//   旧实现 list_marker 写死 width: 15px，"10."（实测 24.09px）、"100."（33.53px）都会溢出盒子
//   压到正文（重叠 5.09px / 14.53px）；代码行号栏同理。
//   现在宽度由 markerWidth() / lnGutter() 按位数计算，本脚本锁死这两个公式与余量。
//
// 分工：
//   test_renderer.js  —— 渲染结构（DOM 桩）
//   test_copysafe.js  —— 复制阶段（jsdom）
//   本脚本            —— 序号栏宽度（DOM 桩，纯公式与产物断言）
//
// 运行：NODE_PATH=<node_modules 目录> node scripts/test_numbering.js
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

const md = [
  '## 一位数编号',
  '',
  '1. 甲',
  '2. 乙',
  '3. 丙',
  '',
  '## 三位数编号（跨 100 边界）',
  '',
  '100. 甲',
  '101. 乙',
  '102. 丙',
  '',
  '## 从 98 起（跨 99 -> 100）',
  '',
  '98. 甲',
  '99. 乙',
  '100. 丙',
  '',
  '## 无序列表',
  '',
  '- 甲',
  '- 乙',
  '',
  '## 任务列表',
  '',
  '- [x] 已完成',
  '- [ ] 未完成',
  '',
  '## 脚注（两位数序号）',
  '',
  Array.from({ length: 12 }, (_, i) => `引用${i + 1}[^n${i + 1}]`).join(' ') ,
  '',
  ...Array.from({ length: 12 }, (_, i) => `[^n${i + 1}]: 第 ${i + 1} 条。`),
  '',
].join('\n');

// --- DOM 桩（与 test_renderer.js 一致，只覆盖模板脚本用到的 API） ---
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

const script = tpl.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace('__MARKDOWN_JSON__', JSON.stringify(md).replace(/</g, '\\u003c'));

const api = new Function('marked', 'hljs', 'document', 'window', 'console',
  script + '\n;return { renderToHtml: renderToHtml, markerWidth: markerWidth, lnGutter: lnGutter };'
)(marked, hljs, global.document, global.window, console);

const html = api.renderToHtml(md);

// 抽取所有标记符宽度（列表项 + 脚注参考区）
const widthsHtml = html.match(/width: [\d.]+em/g) || [];
const widths = widthsHtml.map(s => parseFloat(s.slice(7)));
const uniqWidths = [...new Set(widths)].sort((a, b) => a - b);
const countWidth = (src, em) => (src.match(new RegExp('width: ' + em.toFixed(2) + 'em', 'g')) || []).length;

// 实测拟合：粗体 16px 下每位数字 ≈ 0.59em、句点 ≈ 0.33em（下表由真实浏览器量得，见 md2wx-numbug/measured.*.txt）
const estEm = (digits) => digits * 0.59 + 0.33;
const marginOf = (em) => {
  const digits = Math.round((em - 0.45) / 0.62);
  return +(em - estEm(digits)).toFixed(2);
};

const g20 = api.lnGutter(5);
const g100 = api.lnGutter(110);
const g1000 = api.lnGutter(1234);

const checks = [
  // 标记符宽度公式：1 位 1.07em / 2 位 1.69em / 3 位 2.31em（16px 下 = 17.1 / 27.0 / 37.0px）
  ['一位数标记符宽度 1.07em', uniqWidths.includes(1.07)],
  ['两位数标记符宽度 1.69em', uniqWidths.includes(1.69)],
  ['三位数标记符宽度 2.31em', uniqWidths.includes(2.31)],
  // 关键回归点：不能再出现写死的 15px
  ['标记符不再使用固定 15px 宽度', !html.includes('width: 15px')],
  ['标记符未残留 min-width 旧写法', !html.includes('min-width: 15px')],
  // 每个宽度都要留出安全余量（≥0.12em），否则换字体后仍会溢出
  ['各档宽度均留有 ≥0.12em 余量', uniqWidths.every(w => marginOf(w) >= 0.12)],
  // 同组宽度一致：同一列表内的标记符宽度值数量应等于「位数档位数」（本例 1/2/3 位各一档）
  ['宽度档位数与位数档一致（1/2/3 位）', uniqWidths.length === 3],
  // 同组宽度一致：宽度按「组内最大编号位数」分配，因此 21 个标记符应恰好落在 3 个档位，
  // 且各档出现次数 = 该档的列表项数（1位×7、2位×12、3位×6）。逐项漂移会立刻打破计数。
  ['各档宽度按组分配（1位×7 / 2位×12 / 3位×6）',
    countWidth(html, 1.07) === 7 && countWidth(html, 1.69) === 12 && countWidth(html, 2.31) === 6],
  // 脚注参考区同样自适应
  ['脚注参考区使用自适应宽度', /display: inline-block; width: [\d.]+em; text-align: right/.test(html)],
  // 动态哨兵（含宽度槽位 TOK.w）不得泄漏
  ['宽度槽位哨兵未泄漏', !html.includes('@@md2wx_')],
  ['列表标记符仍为 •', html.includes('>•</span>')],
  ['任务列表勾选态仍在', html.includes('☑') && html.includes('☐')],
  // 行号栏公式：位数 ≤2 维持 20px 基准，位数增长时同步加宽，且行号栏到正文恒为 21px
  ['行号栏 ≤2 位维持 20px', g20.box === 20 && g20.padLeft === 50],
  ['行号栏 3 位加宽至 28px', g100.box === 28 && g100.padLeft === 58],
  ['行号栏 4 位加宽至 36px', g1000.box === 36 && g1000.padLeft === 66],
  ['行号栏到正文空隙恒为 21px',
    g20.padLeft - (g20.box + 9) === 21 && g100.padLeft - (g100.box + 9) === 21 && g1000.padLeft - (g1000.box + 9) === 21],
  ['预览行号栏宽度改用变量', tpl.includes('width: var(--lnw, 20px)') && tpl.includes('calc(var(--lnw, 20px) + 30px)')],
  ['渲染时按块设置 --lnw', /applyLineNumberGutter/.test(tpl) && /setProperty\('--lnw'/.test(tpl)],
];

let fail = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? '✅' : '❌'} ${name}`);
  if (!ok) fail++;
}
console.log(`\n宽度档位：${uniqWidths.join('em / ')}em；余量：${uniqWidths.map(marginOf).join(' / ')}em`);
console.log(`行号栏：≤2位 ${g20.box}px / 3位 ${g100.box}px / 4位 ${g1000.box}px`);
console.log(`\n${checks.length - fail}/${checks.length} 通过`);
process.exit(fail ? 1 : 0);
