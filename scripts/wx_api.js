// md2wx 微信公众号 API 客户端：access_token 管理 / 素材上传 / 草稿箱
//
// 依赖：Node 18+ 原生 fetch / FormData / Blob，无第三方依赖。
// 凭证来源（按优先级）：
//   1. loadConfig 显式传入的配置文件路径
//   2. 环境变量 WX_APPID / WX_SECRET
//   3. 技能目录下 wx_config.json（{ "appid": "...", "secret": "..." }）
//
// 凭证获取与 IP 白名单配置说明见 SKILL.md「自动发布模式」一节。
'use strict';
const fs = require('fs');
const path = require('path');

const SKILL = path.resolve(__dirname, '..');
const TOKEN_CACHE = path.join(SKILL, '.wx_token_cache.json');
const API_BASE = 'https://api.weixin.qq.com';

// 常见 errcode 的人话解释（40164 的 message 自带"无效 IP"提示，原样透传）
const ERR_HINTS = {
  40001: 'access_token 无效或 appsecret 错误：检查 wx_config.json 中的 secret 是否为公众号后台「基本配置」里的 AppSecret',
  40013: 'appid 无效：检查 appid 是否属于目标公众号',
  40125: 'AppSecret 无效或已被重置：到公众号后台「基本配置」重新查看/重置 AppSecret',
  40164: '调用接口的机器 IP 不在公众号白名单内：登录 mp.weixin.qq.com → 设置与开发 → 基本配置 → IP白名单，把本机公网 IP 加进去后等 5 分钟再试',
  41004: '缺少 appsecret 参数',
  42001: 'access_token 已过期（正常现象，客户端会自动刷新重试）',
  45009: '接口调用次数超过每日配额：素材/草稿接口有每日限额，明天再试或减少调用',
  40007: 'media_id 无效：确认素材已上传成功且 media_id 拷贝完整',
  48001: '当前公众号没有该 API 权限：未认证订阅号不支持部分接口，确认账号类型',
  53401: '封面图片尺寸不符合要求',
  53402: '标题长度超限（草稿标题 ≤ 64 字）',
  53404: '正文内容为空或过短',
  53405: '封面图缺失：draft/add 必须提供 thumb_media_id（可传 --cover 让脚本自动上传）'
};

function wxError(payload) {
  const code = payload && payload.errcode;
  const hint = ERR_HINTS[code] || '';
  const err = new Error(`微信接口错误 errcode=${code}: ${payload && payload.errmsg || '未知错误'}${hint ? '\n  → ' + hint : ''}`);
  err.errcode = code;
  return err;
}

// ---------- 配置 ----------

function readConfigFile(p) {
  let raw;
  try { raw = fs.readFileSync(p, 'utf8'); } catch (e) { return null; }
  try {
    const j = JSON.parse(raw);
    if (j && j.appid && j.secret) return { appid: String(j.appid), secret: String(j.secret), source: p };
  } catch (e) {
    throw new Error(`配置文件 ${p} 不是合法 JSON（应为 {"appid":"wx...","secret":"..."}）：${e.message}`);
  }
  return null;
}

// 解析凭证；找不到时返回 null（调用方负责提示配置方法）
function loadConfig(explicitPath) {
  if (explicitPath) {
    const cfg = readConfigFile(explicitPath);
    if (!cfg) throw new Error(`指定的配置文件 ${explicitPath} 不存在或缺少 appid/secret 字段`);
    return cfg;
  }
  if (process.env.WX_APPID && process.env.WX_SECRET) {
    return { appid: process.env.WX_APPID, secret: process.env.WX_SECRET, source: 'env' };
  }
  return readConfigFile(path.join(SKILL, 'wx_config.json'));
}

function configHelpText() {
  return [
    '尚未配置公众号凭证。请任选其一：',
    '',
    '① 配置文件（推荐）：在技能目录创建 wx_config.json：',
    '   { "appid": "wx1234567890abcdef", "secret": "你的AppSecret" }',
    '   并用 --config 参数指定路径（默认查找技能目录下的 wx_config.json）',
    '',
    '② 环境变量：',
    '   set WX_APPID=wx1234567890abcdef',
    '   set WX_SECRET=你的AppSecret',
    '',
    '凭证获取：登录 mp.weixin.qq.com → 设置与开发 → 基本配置 →',
    '  开发者ID(AppID) 与 开发者密码(AppSecret)（首次需启用并扫码）。',
    '',
    '【重要】IP 白名单：同一页面下方「IP白名单」点击修改，把本机公网 IP 加进去',
    '（公网 IP 可用 `curl ifconfig.me` 或访问 ip138 查询），否则调用报 errcode=40164。',
    '家庭/办公网络 IP 会变动，变动后需重新加入白名单。'
  ].join('\n');
}

// ---------- access_token（磁盘缓存，提前 5 分钟过期） ----------

function readTokenCache() {
  try {
    const j = JSON.parse(fs.readFileSync(TOKEN_CACHE, 'utf8'));
    if (j && j.token && j.expireAt > Date.now() && j.appid) return j;
  } catch (e) { /* 缓存不存在或损坏，走刷新 */ }
  return null;
}

async function getAccessToken(cfg, { force = false } = {}) {
  if (!force) {
    const cached = readTokenCache();
    if (cached && cached.appid === cfg.appid) return cached.token;
  }
  const url = `${API_BASE}/cgi-bin/token?grant_type=client_credential`
    + `&appid=${encodeURIComponent(cfg.appid)}&secret=${encodeURIComponent(cfg.secret)}`;
  const res = await fetch(url);
  const j = await res.json();
  if (!j.access_token) throw wxError(j);
  const record = { token: j.access_token, appid: cfg.appid, expireAt: Date.now() + Math.max((j.expires_in || 7200) - 300, 60) * 1000 };
  try { fs.writeFileSync(TOKEN_CACHE, JSON.stringify(record), 'utf8'); } catch (e) { /* 缓存写失败不影响流程 */ }
  return record.token;
}

// 带一次性 40001/42001 自动刷新重试的请求包装
async function withToken(cfg, fn) {
  let token = await getAccessToken(cfg);
  try {
    return await fn(token);
  } catch (e) {
    if (e.errcode === 40001 || e.errcode === 42001) {
      token = await getAccessToken(cfg, { force: true });
      return await fn(token);
    }
    throw e;
  }
}

async function getJSON(url) {
  const res = await fetch(url);
  const j = await res.json();
  if (j.errcode && j.errcode !== 0) throw wxError(j);
  return j;
}

// ---------- 素材上传 ----------

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.bmp': 'image/bmp' };

// input: 本地文件路径 | { buffer, filename }；返回 { media_id, url }
// url 即 mmbiz.qpic.cn 域名地址，可直接用于正文 <img src>；thumb 封面用 media_id
async function uploadImage(cfg, input) {
  let buffer, filename;
  if (typeof input === 'string') {
    buffer = fs.readFileSync(input);
    filename = path.basename(input);
  } else {
    buffer = input.buffer;
    filename = input.filename || 'image.png';
  }
  const type = MIME[path.extname(filename).toLowerCase()] || 'image/jpeg';
  return withToken(cfg, async (token) => {
    const fd = new FormData();
    fd.append('media', new Blob([buffer], { type }), filename);
    const res = await fetch(`${API_BASE}/cgi-bin/material/add_material?access_token=${encodeURIComponent(token)}&type=image`, { method: 'POST', body: fd });
    const j = await res.json();
    if (!j.media_id) throw wxError(j);
    return j;
  });
}

// ---------- 草稿箱 ----------

// article: { title, author?, digest?, content, thumb_media_id, content_source_url?, need_open_comment?, only_fans_can_comment? }
async function createDraft(cfg, article) {
  return withToken(cfg, async (token) => {
    const res = await fetch(`${API_BASE}/cgi-bin/draft/add?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ articles: [article] })
    });
    const j = await res.json();
    if (!j.media_id) throw wxError(j);
    return j; // 草稿 media_id，可在公众号后台草稿箱看到
  });
}

async function draftCount(cfg) {
  return withToken(cfg, (token) => getJSON(`${API_BASE}/cgi-bin/draft/count?access_token=${encodeURIComponent(token)}`));
}

// ---------- CLI（用于连通性自检与手工上传） ----------
// node wx_api.js check                     检查凭证 + token + IP 白名单是否可用
// node wx_api.js upload <图片路径>          上传单张图片，打印 media_id 与 url
// node wx_api.js draft-count               查询草稿箱数量
if (require.main === module) {
  const [, , cmd, arg] = process.argv;
  (async () => {
    try {
      const cfg = loadConfig(process.env.WX_CONFIG_PATH);
      if (!cfg) { console.error(configHelpText()); process.exit(2); }
      console.error(`[wx_api] 凭证来源: ${cfg.source === 'env' ? '环境变量' : cfg.source}（appid=${cfg.appid.slice(0, 6)}***）`);
      if (cmd === 'check') {
        const token = await getAccessToken(cfg, { force: true });
        console.log('[wx_api] access_token 获取成功，凭证与 IP 白名单均有效');
        console.log('[wx_api] token 前 8 位: ' + token.slice(0, 8) + '...');
        const c = await draftCount(cfg);
        console.log(`[wx_api] 草稿箱当前数量: ${c.total_count}`);
      } else if (cmd === 'upload' && arg) {
        const r = await uploadImage(cfg, arg);
        console.log('media_id: ' + r.media_id);
        console.log('url: ' + r.url);
      } else if (cmd === 'draft-count') {
        const c = await draftCount(cfg);
        console.log(JSON.stringify(c));
      } else {
        console.error('用法: node wx_api.js <check | upload <图片> | draft-count>');
        process.exit(1);
      }
    } catch (e) {
      console.error('[wx_api] ' + e.message);
      process.exit(1);
    }
  })();
}

module.exports = { loadConfig, configHelpText, getAccessToken, uploadImage, createDraft, draftCount, SKILL };
