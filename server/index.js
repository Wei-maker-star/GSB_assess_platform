/**
 * GSB Eval · Minimal Express backend
 *
 * 职责：
 *   1. 处理飞书 OAuth：用授权 code 换 user_access_token + user_info
 *   2. 代理飞书 Sheets / Bitable API，避免浏览器 CORS
 *   3. 暴露 App ID 给前端（App Secret 只在后端持有）
 *
 * 环境变量：
 *   FEISHU_APP_ID       (可选，默认使用 cli_aae3d417d878dbd8)
 *   FEISHU_APP_SECRET   (必填)
 *   FEISHU_HOST         (可选，默认 https://open.feishu.cn；海外飞书用 https://open.larksuite.com)
 *
 * 本地运行：
 *   FEISHU_APP_SECRET=xxx node index.js
 *
 * Vercel：作为 serverless function 使用，module.exports = app
 */

const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const FEISHU_APP_ID = process.env.FEISHU_APP_ID || 'cli_aae3d417d878dbd8';
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || '';
const FEISHU_HOST = (process.env.FEISHU_HOST || 'https://open.feishu.cn').replace(/\/+$/, '');

/* ------------------------------- 工具方法 ------------------------------- */

// Node 18+ 自带 fetch，兜底 dynamic import 兼容 Node 16
const fetchFn = (...args) =>
  (globalThis.fetch ? globalThis.fetch(...args) : import('node-fetch').then(m => m.default(...args)));

async function feishuFetch(path, options = {}) {
  const url = path.startsWith('http') ? path : `${FEISHU_HOST}${path}`;
  const res = await fetchFn(url, options);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
  return { status: res.status, data };
}

// 应用级 access_token 缓存（有效期 2 小时，提前 5 分钟刷新）
let appTokenCache = { token: '', expireAt: 0 };
async function getAppAccessToken() {
  if (!FEISHU_APP_SECRET) throw new Error('FEISHU_APP_SECRET 未配置');
  const now = Date.now();
  if (appTokenCache.token && appTokenCache.expireAt > now) return appTokenCache.token;
  const { data } = await feishuFetch('/open-apis/auth/v3/app_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: FEISHU_APP_ID, app_secret: FEISHU_APP_SECRET })
  });
  if (data.code !== 0 || !data.app_access_token) {
    throw new Error('获取 app_access_token 失败: ' + JSON.stringify(data));
  }
  appTokenCache = {
    token: data.app_access_token,
    // expire 秒数，减 300 秒余量
    expireAt: now + ((data.expire || 7200) - 300) * 1000
  };
  return appTokenCache.token;
}

// 从飞书表格 URL 提取 spreadsheetToken
function extractSpreadsheetToken(input) {
  if (!input) return '';
  const s = String(input).trim();
  // 已经是 token
  if (/^[A-Za-z0-9]+$/.test(s) && s.length < 40) return s;
  const m = s.match(/\/sheets\/([A-Za-z0-9]+)/);
  return m ? m[1] : '';
}

function extractBitableToken(input) {
  if (!input) return '';
  const s = String(input).trim();
  if (/^[A-Za-z0-9]+$/.test(s) && s.length < 40) return s;
  const m = s.match(/\/base\/([A-Za-z0-9]+)/);
  return m ? m[1] : '';
}

/* --------------------------------- 路由 --------------------------------- */

// 前端读取 App ID（不要放 secret）
app.get('/api/feishu/config', (req, res) => {
  res.json({
    app_id: FEISHU_APP_ID,
    host: FEISHU_HOST,
    // 前端可用 window.location.origin 拼接 redirect_uri
    // 授权链接示例:
    // {FEISHU_HOST}/open-apis/authen/v1/authorize?app_id=xxx&redirect_uri=xxx&state=xxx
  });
});

/**
 * OAuth 第 1 步之后：前端拿到 code，POST 到这里
 * body: { code, redirect_uri }
 * 返回: { access_token, refresh_token, expires_in, user: {...} }
 */
app.post('/api/feishu/login', async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: 'missing code' });

    const appToken = await getAppAccessToken();

    // 用 code 换 user_access_token
    const tokenResp = await feishuFetch('/open-apis/authen/v1/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${appToken}`
      },
      body: JSON.stringify({ grant_type: 'authorization_code', code })
    });

    if (tokenResp.data.code !== 0) {
      return res.status(400).json({ error: 'oauth exchange failed', detail: tokenResp.data });
    }
    const tokenData = tokenResp.data.data || {};

    // 拉一次 user_info（有些字段 token 响应里就有，这里再校验一次拿完整信息）
    const uinfoResp = await feishuFetch('/open-apis/authen/v1/user_info', {
      headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
    });
    const userInfo = (uinfoResp.data && uinfoResp.data.data) || {};

    res.json({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_in: tokenData.expires_in,
      token_type: tokenData.token_type,
      user: {
        user_id: userInfo.user_id || tokenData.user_id || '',
        open_id: userInfo.open_id || tokenData.open_id || '',
        union_id: userInfo.union_id || tokenData.union_id || '',
        name: userInfo.name || tokenData.name || '',
        en_name: userInfo.en_name || tokenData.en_name || '',
        avatar_url: userInfo.avatar_url || tokenData.avatar_url || '',
        email: userInfo.email || ''
      }
    });
  } catch (err) {
    console.error('/api/feishu/login', err);
    res.status(500).json({ error: 'internal', message: err.message });
  }
});

/**
 * 刷新 user_access_token（token 通常 2 小时过期）
 * body: { refresh_token }
 */
app.post('/api/feishu/refresh', async (req, res) => {
  try {
    const { refresh_token } = req.body || {};
    if (!refresh_token) return res.status(400).json({ error: 'missing refresh_token' });
    const appToken = await getAppAccessToken();
    const r = await feishuFetch('/open-apis/authen/v1/refresh_access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${appToken}`
      },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token })
    });
    if (r.data.code !== 0) return res.status(400).json({ error: 'refresh failed', detail: r.data });
    res.json(r.data.data || {});
  } catch (err) {
    console.error('/api/feishu/refresh', err);
    res.status(500).json({ error: 'internal', message: err.message });
  }
});

/**
 * 读取飞书电子表格数据
 * body: { access_token, url_or_token, range? }
 * 若不传 range，会自动读取第一张表的全部数据
 */
app.post('/api/feishu/sheets/read', async (req, res) => {
  try {
    const { access_token, url_or_token, range } = req.body || {};
    if (!access_token) return res.status(401).json({ error: 'missing access_token' });
    const sheetToken = extractSpreadsheetToken(url_or_token);
    if (!sheetToken) return res.status(400).json({ error: '无法从 URL 提取 spreadsheet token' });

    const authH = { 'Authorization': `Bearer ${access_token}` };

    // 拿到表的元信息，找第一个 sheet_id
    let firstSheetId = '';
    let firstSheetTitle = '';
    let rowCount = 0, colCount = 0;
    const meta = await feishuFetch(
      `/open-apis/sheets/v3/spreadsheets/${sheetToken}/sheets/query`,
      { headers: authH }
    );
    if (meta.data.code === 0 && meta.data.data && meta.data.data.sheets && meta.data.data.sheets.length) {
      const first = meta.data.data.sheets[0];
      firstSheetId = first.sheet_id;
      firstSheetTitle = first.title;
      rowCount = (first.grid_properties && first.grid_properties.row_count) || 200;
      colCount = (first.grid_properties && first.grid_properties.column_count) || 20;
    } else {
      return res.status(400).json({ error: '读取 sheet 元信息失败', detail: meta.data });
    }

    // 组装 range: sheetId!A1:{col}{row}
    const colLetter = (n) => {
      let s = '';
      while (n > 0) {
        const r = (n - 1) % 26;
        s = String.fromCharCode(65 + r) + s;
        n = Math.floor((n - 1) / 26);
      }
      return s;
    };
    const effectiveRange = range || `${firstSheetId}!A1:${colLetter(Math.max(colCount, 1))}${Math.max(rowCount, 1)}`;

    // v2 读单元格值（支持字符串/富文本/图片对象）
    const valuesResp = await feishuFetch(
      `/open-apis/sheets/v2/spreadsheets/${sheetToken}/values/${encodeURIComponent(effectiveRange)}?valueRenderOption=ToString&dateTimeRenderOption=FormattedString`,
      { headers: authH }
    );
    if (valuesResp.data.code !== 0) {
      return res.status(400).json({ error: '读取表格数据失败', detail: valuesResp.data });
    }

    const values = (valuesResp.data.data && valuesResp.data.data.valueRange && valuesResp.data.data.valueRange.values) || [];

    res.json({
      spreadsheet_token: sheetToken,
      sheet_id: firstSheetId,
      sheet_title: firstSheetTitle,
      values
    });
  } catch (err) {
    console.error('/api/feishu/sheets/read', err);
    res.status(500).json({ error: 'internal', message: err.message });
  }
});

/**
 * 批量写入多维表格（Bitable）记录
 * body: { access_token, app_token_or_url, table_id, records: [{ fields: {...} }] }
 */
app.post('/api/feishu/bitable/append', async (req, res) => {
  try {
    const { access_token, app_token_or_url, table_id, records } = req.body || {};
    if (!access_token) return res.status(401).json({ error: 'missing access_token' });
    const appToken = extractBitableToken(app_token_or_url);
    if (!appToken) return res.status(400).json({ error: '无法从 URL 提取 bitable app_token' });
    if (!table_id) return res.status(400).json({ error: 'missing table_id' });
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'records 为空' });
    }

    // Bitable 批量创建，单次最多 500 条
    const chunks = [];
    for (let i = 0; i < records.length; i += 500) chunks.push(records.slice(i, i + 500));

    const results = [];
    for (const chunk of chunks) {
      const r = await feishuFetch(
        `/open-apis/bitable/v1/apps/${appToken}/tables/${table_id}/records/batch_create`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${access_token}`
          },
          body: JSON.stringify({ records: chunk })
        }
      );
      if (r.data.code !== 0) {
        return res.status(400).json({ error: 'bitable append failed', detail: r.data, partial: results });
      }
      results.push(...((r.data.data && r.data.data.records) || []));
    }

    res.json({ inserted: results.length, records: results });
  } catch (err) {
    console.error('/api/feishu/bitable/append', err);
    res.status(500).json({ error: 'internal', message: err.message });
  }
});

/**
 * 通用透传（可选，用于调试或扩展）
 * body: { access_token, path, method, body }
 */
app.post('/api/feishu/proxy', async (req, res) => {
  try {
    const { access_token, path, method = 'GET', body } = req.body || {};
    if (!access_token || !path) return res.status(400).json({ error: 'missing access_token or path' });
    const r = await feishuFetch(path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${access_token}`
      },
      body: body ? JSON.stringify(body) : undefined
    });
    res.status(r.status).json(r.data);
  } catch (err) {
    console.error('/api/feishu/proxy', err);
    res.status(500).json({ error: 'internal', message: err.message });
  }
});

// 健康检查
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now(), app_id: FEISHU_APP_ID }));

/**
 * 飞书 OAuth 回调：用 code 换 user_access_token，然后 302 跳回前端并带 hash 参数
 * 飞书授权页跳回 /api/feishu/callback?code=xxx
 */
app.get('/api/feishu/callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).send('missing code');

    const appToken = await getAppAccessToken();

    // 用 code 换 user_access_token
    const tokenResp = await feishuFetch('/open-apis/authen/v1/oidc/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${appToken}`
      },
      body: JSON.stringify({ grant_type: 'authorization_code', code })
    });

    if (tokenResp.data.code !== 0) {
      return res.status(400).json({ error: 'oauth failed', detail: tokenResp.data });
    }

    const d = tokenResp.data.data || {};
    const accessToken = d.access_token || '';
    const expiresIn = d.expires_in || 7200;

    // 拼接 hash 参数跳回前端首页
    const origin = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : (req.headers.referer ? new URL(req.headers.referer).origin : `http://localhost:${PORT}`);
    const redirectUrl = `${origin}/#fs_token=${encodeURIComponent(accessToken)}&fs_expires=${expiresIn}`;
    res.redirect(302, redirectUrl);
  } catch (err) {
    console.error('/api/feishu/callback', err);
    res.status(500).send('OAuth callback error: ' + err.message);
  }
});

// 本地开发直接监听端口；Vercel 上作为 serverless function 使用
const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`GSB Eval server running on http://localhost:${PORT}`);
    if (!FEISHU_APP_SECRET) console.warn('⚠️  FEISHU_APP_SECRET 未设置，OAuth 会失败');
  });
}

module.exports = app;
