// md2wx 自动发布：Markdown → 图片自动上传素材库 → 微信 HTML → 公众号草稿箱
//
// 用法：
//   node publish_wx.js article.md --title "标题" [--author "作者"] [--digest "摘要"]
//        [--cover <图片路径|URL|media_id:xxx>] [--config <配置文件>] [--dry-run] [--save-html out.html]
//
// 流程（详见 SKILL.md「自动发布模式」）：
//   1. 复用 wx_template.html 的渲染管线 + copySafe 白名单清洗，产出公众号兼容的内联样式 HTML
//   2. 提取正文全部 <img>：外链/本地图片自动下载读取 → 上传永久素材 → src 替换为 mmbiz.qpic.cn 地址
//      （已上传过的图按 src 记入 .wx_upload_cache.json，重复发布不重复上传）
//   3. 封面：--cover 指定则上传取 media_id；未指定则用正文第一张本次上传的图；都没有则报错
//   4. draft/add 存入草稿箱，返回草稿 media_id；群发请到后台人工预览后操作
//
// 依赖：marked@12.0.2、highlight.js@11.9.0、jsdom（同回归测试），Node 18+。
'use strict';
const fs = require('fs');
const path = require('path');
const { loadConfig, configHelpText, uploadImage, createDraft, SKILL } = require('./wx_api.js');

const UPLOAD_CACHE = path.join(SKILL, '.wx_upload_cache.json');
const WX_IMG_HOSTS = ['mmbiz.qpic.cn', 'mp.weixin.qq.com'];

// ---------- 参数 ----------
function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (key === 'dry-run') { opts.dryRun = true; continue; }
      opts[key] = argv[++i];
    } else opts._.push(a);
  }
  return opts;
}

function loadModule(name) {
  const extra = process.env.MD2WX_NODE_MODULES || process.env.NODE_PATH;
  const candidates = [name];
  if (extra) extra.split(path.delimiter).forEach(p => p && candidates.push(path.join(p, name)));
  for (const c of candidates) {
    try { return require(c); } catch (e) { /* 尝试下一个 */ }
  }
  return null;
}

// ---------- 渲染：复用模板管线，抓取 copySafe 清洗后的 DOM ----------
// 与 test_copysafe.js 同一套路：jsdom outside-only 打开模板 → 手动 eval → execCommand 处抓快照。
// 这样正文 HTML 与用户复制粘贴到编辑器的内容完全同源（同一套白名单/行号/样式逻辑）。
function renderClipboardHtml(md) {
  const markedMod = loadModule('marked');
  const hljs = loadModule('highlight.js');
  const jsdomMod = loadModule('jsdom');
  if (!markedMod || !hljs) throw new Error('缺少 marked / highlight.js（npm install marked@12.0.2 highlight.js@11.9.0）');
  if (!jsdomMod) throw new Error('缺少 jsdom（npm install jsdom）');

  const tpl = fs.readFileSync(path.join(SKILL, 'assets/wx_template.html'), 'utf8');
  const { JSDOM } = jsdomMod;
  const dom = new JSDOM(tpl, { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.marked = markedMod.marked;
  window.hljs = hljs;
  window.alert = () => {};
  window.getSelection = () => ({ removeAllRanges() {}, addRange() {} });
  let node = null;
  window.document.execCommand = () => {
    node = window.document.body.lastElementChild;
    return true;
  };
  const script = tpl.match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace('__MARKDOWN_JSON__', JSON.stringify(md).replace(/</g, '\\u003c'));
  window.eval(script);
  window.document.getElementById('editor').value = md;
  window.render();
  window.copySafe();
  if (!node) throw new Error('渲染失败：未能捕获 copySafe 输出');
  // 取 .wx-article 容器的 innerHTML（外层定位样式只是复制用的，不进正文）
  return node.innerHTML;
}

// ---------- 图片处理 ----------
function readUploadCache() {
  try { return JSON.parse(fs.readFileSync(UPLOAD_CACHE, 'utf8')); } catch (e) { return {}; }
}
function writeUploadCache(cache) {
  try { fs.writeFileSync(UPLOAD_CACHE, JSON.stringify(cache, null, 2), 'utf8'); } catch (e) { /* 缓存写失败不影响流程 */ }
}

const isWxImg = (src) => WX_IMG_HOSTS.some(h => src.includes(h));
const isRemote = (src) => /^https?:\/\//i.test(src);

async function downloadImage(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`下载图片失败 HTTP ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const m = (res.headers.get('content-type') || '').match(/image\/(jpeg|png|gif|bmp)/i);
  const ext = m ? m[1].toLowerCase() : (path.extname(new URL(url).pathname).replace('.', '').toLowerCase() || 'png');
  if (ext === 'jpg') return { buffer: buf, filename: 'image.jpg' };
  if (['jpeg', 'png', 'gif', 'bmp'].includes(ext)) return { buffer: buf, filename: `image.${ext}` };
  return { buffer: buf, filename: 'image.png' };
}

function extractImgSrcs(html) {
  const out = [];
  const re = /<img[^>]*\ssrc="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

// 把正文全部图片换成素材库地址；返回 { html, uploads, firstUploadedMediaId, uploadedCount, reusedCount }
async function processImages(html, cfg, mdDir, { dryRun, log }) {
  const srcs = extractImgSrcs(html);
  const cache = readUploadCache();
  const uploads = [];
  let firstUploadedMediaId = null;
  let uploadedCount = 0, reusedCount = 0;
  let out = html;

  for (const src of srcs) {
    if (isWxImg(src)) { log(`跳过（已是素材库图片）: ${src.slice(0, 80)}`); continue; }
    const cached = cache[src];
    if (cached && cached.media_id && cached.url) {
      out = out.split(`src="${src}"`).join(`src="${cached.url}"`);
      if (!firstUploadedMediaId) firstUploadedMediaId = cached.media_id;
      reusedCount++;
      uploads.push({ src, ...cached, reused: true });
      log(`命中上传缓存: ${src.slice(0, 60)} → ${cached.url.slice(0, 60)}`);
      continue;
    }
    if (dryRun) {
      log(`[dry-run] 待上传: ${src}`);
      continue;
    }
    let img;
    if (isRemote(src)) img = await downloadImage(src);
    else {
      const localPath = path.resolve(mdDir, decodeURIComponent(src.replace(/^file:\/\//i, '')));
      if (!fs.existsSync(localPath)) throw new Error(`本地图片不存在: ${localPath}`);
      img = { buffer: fs.readFileSync(localPath), filename: path.basename(localPath) };
    }
    if (img.buffer.length > 10 * 1024 * 1024) throw new Error(`图片超过公众号 10MB 限制: ${src}`);
    const r = await uploadImage(cfg, img);
    cache[src] = { media_id: r.media_id, url: r.url, uploadedAt: new Date().toISOString() };
    out = out.split(`src="${src}"`).join(`src="${r.url}"`);
    if (!firstUploadedMediaId) firstUploadedMediaId = r.media_id;
    uploads.push({ src, media_id: r.media_id, url: r.url });
    uploadedCount++;
    log(`已上传素材库: ${path.basename(isRemote(src) ? new URL(src).pathname : src)} → ${r.url.slice(0, 70)}`);
  }
  if (!dryRun) writeUploadCache(cache);
  return { html: out, uploads, firstUploadedMediaId, uploadedCount, reusedCount };
}

// ---------- 摘要 ----------
function stripTags(html) {
  return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
}

// ---------- 主流程 ----------
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const mdPath = opts._[0];
  if (!mdPath) {
    console.error('用法: node publish_wx.js <article.md> --title "标题" [--author x] [--digest x] [--cover <路径|URL|media_id:xx>] [--config cfg.json] [--dry-run] [--save-html out.html] [--verbose]');
    process.exit(1);
  }
  const mdFile = path.resolve(mdPath);
  const md = fs.readFileSync(mdFile, 'utf8');
  const mdDir = path.dirname(mdFile);
  const log = (s) => console.error('[publish] ' + s);

  // 1. 渲染 + 白名单清洗（与复制粘贴同源）
  log('渲染 Markdown → 公众号 HTML ...');
  let html = renderClipboardHtml(md);

  // 2. 标题/摘要
  const h1 = md.match(/^\s*#\s+(.+)$/m);
  const title = (opts.title || (h1 && h1[1].trim()) || '').slice(0, 64);
  if (!title) throw new Error('缺少标题：传 --title 或在 Markdown 首行提供 # 一级标题');
  const digest = ((opts.digest || stripTags(html).slice(0, 54)) || '点击阅读').slice(0, 120);

  // 3. 图片上素材库
  const cfg = opts.dryRun ? null : loadConfig(opts.config);
  if (!cfg && !opts.dryRun) { console.error(configHelpText()); process.exit(2); }
  log(`图片处理开始（共 ${extractImgSrcs(html).length} 张，dry-run=${!!opts.dryRun}）...`);
  const { html: finalHtml, uploads, firstUploadedMediaId, uploadedCount, reusedCount } = await processImages(html, cfg, mdDir, { dryRun: opts.dryRun, log });

  if (opts['save-html']) { const htmlOut = path.resolve(opts['save-html']); fs.writeFileSync(htmlOut, finalHtml, 'utf8'); log('正文 HTML 已保存: ' + htmlOut); }

  // 4. 封面
  let thumbMediaId = null;
  if (opts.cover) {
    if (opts.dryRun) log(`[dry-run] 封面将使用: ${opts.cover}`);
    else if (opts.cover.startsWith('media_id:')) thumbMediaId = opts.cover.slice(9);
    else {
      const img = isRemote(opts.cover) ? await downloadImage(opts.cover)
        : { buffer: fs.readFileSync(path.resolve(opts.cover)), filename: path.basename(opts.cover) };
      const r = await uploadImage(cfg, img);
      thumbMediaId = r.media_id;
      log(`封面上传成功: ${r.url.slice(0, 70)}`);
    }
  } else if (firstUploadedMediaId) {
    thumbMediaId = firstUploadedMediaId;
    log('未指定 --cover，自动使用正文第一张图片作为封面（公众号后台可再调整裁剪）');
  } else if (!opts.dryRun) {
    throw new Error('缺少封面：draft/add 必须提供 thumb_media_id。请传 --cover <图片路径|URL|media_id:xxx>，或确保正文含至少一张本地/外链图片');
  }

  // 5. 草稿
  const article = {
    title, digest, content: finalHtml,
    author: opts.author || '',
    need_open_comment: 1,
    only_fans_can_comment: 0
  };
  if (thumbMediaId) article.thumb_media_id = thumbMediaId;

  // 输出默认极简（减少下游 token 消耗）：只报关键结果；--verbose 才输出完整图片清单
  const verbose = !!opts.verbose;
  if (opts.dryRun) {
    log(`[dry-run] 完成。标题="${title}" 摘要="${digest.slice(0, 30)}..."`);
    console.log(JSON.stringify({ dryRun: true, title, images: extractImgSrcs(html).length }));
    return;
  }
  log('调用 draft/add 存入草稿箱 ...');
  const r = await createDraft(cfg, article);
  log(`✅ 草稿创建成功！`);
  log('请到公众号后台 mp.weixin.qq.com → 内容与互动 → 草稿箱 预览确认后再群发。');
  const result = {
    draft_media_id: r.media_id,
    title,
    cover: thumbMediaId ? 'auto/指定' : '无',
    uploaded: uploadedCount,
    reused: reusedCount
  };
  if (verbose) result.uploads = uploads;
  console.log(JSON.stringify(result));
}

main().catch(e => { console.error('[publish] ' + e.message); process.exit(1); });
