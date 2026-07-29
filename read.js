const FEISHU_HOST = 'https://open.feishu.cn';

async function feishuJson(path, options = {}) {
  const url = path.startsWith('http') ? path : `${FEISHU_HOST}${path}`;
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
  return { status: res.status, data };
}

function extractSpreadsheetToken(input) {
  if (!input) return '';
  const s = String(input).trim();
  if (/^[A-Za-z0-9]+$/.test(s) && s.length < 40) return s;
  const m = s.match(/\/sheets\/([A-Za-z0-9]+)/);
  return m ? m[1] : '';
}

function colLetter(n) {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export async function onRequestPost(context) {
  try {
    const { access_token, url_or_token, range } = await context.request.json();
    if (!access_token) return Response.json({ error: 'missing access_token' }, { status: 401 });
    const sheetToken = extractSpreadsheetToken(url_or_token);
    if (!sheetToken) return Response.json({ error: '无法从 URL 提取 spreadsheet token' }, { status: 400 });

    const authH = { 'Authorization': `Bearer ${access_token}` };
    const meta = await feishuJson(`/open-apis/sheets/v3/spreadsheets/${sheetToken}/sheets/query`, { headers: authH });
    if (meta.data.code !== 0 || !meta.data.data || !meta.data.data.sheets || !meta.data.data.sheets.length) {
      return Response.json({ error: '读取 sheet 元信息失败', detail: meta.data }, { status: 400 });
    }

    const first = meta.data.data.sheets[0];
    const sheetId = first.sheet_id;
    const rowCount = (first.grid_properties && first.grid_properties.row_count) || 200;
    const colCount = (first.grid_properties && first.grid_properties.column_count) || 20;
    const effectiveRange = range || `${sheetId}!A1:${colLetter(Math.max(colCount, 1))}${Math.max(rowCount, 1)}`;

    const valuesResp = await feishuJson(
      `/open-apis/sheets/v2/spreadsheets/${sheetToken}/values/${encodeURIComponent(effectiveRange)}?valueRenderOption=ToString&dateTimeRenderOption=FormattedString`,
      { headers: authH }
    );
    if (valuesResp.data.code !== 0) {
      return Response.json({ error: '读取表格数据失败', detail: valuesResp.data }, { status: 400 });
    }

    const values = valuesResp.data.data && valuesResp.data.data.valueRange && valuesResp.data.data.valueRange.values || [];
    return Response.json({ spreadsheet_token: sheetToken, sheet_id: sheetId, sheet_title: first.title, values });
  } catch (err) {
    return Response.json({ error: 'internal', message: err.message }, { status: 500 });
  }
}
