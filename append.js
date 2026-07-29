const FEISHU_HOST = 'https://open.feishu.cn';

async function feishuJson(path, options = {}) {
  const url = path.startsWith('http') ? path : `${FEISHU_HOST}${path}`;
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
  return { status: res.status, data };
}

function extractBitableToken(input) {
  if (!input) return '';
  const s = String(input).trim();
  if (/^[A-Za-z0-9]+$/.test(s) && s.length < 40) return s;
  const m = s.match(/\/base\/([A-Za-z0-9]+)/);
  return m ? m[1] : '';
}

export async function onRequestPost(context) {
  try {
    const { access_token, app_token_or_url, table_id, records } = await context.request.json();
    if (!access_token) return Response.json({ error: 'missing access_token' }, { status: 401 });
    const appToken = extractBitableToken(app_token_or_url);
    if (!appToken) return Response.json({ error: '无法从 URL 提取 bitable app_token' }, { status: 400 });
    if (!table_id) return Response.json({ error: 'missing table_id' }, { status: 400 });
    if (!Array.isArray(records) || records.length === 0) return Response.json({ error: 'records 为空' }, { status: 400 });

    const inserted = [];
    for (let i = 0; i < records.length; i += 500) {
      const chunk = records.slice(i, i + 500);
      const r = await feishuJson(`/open-apis/bitable/v1/apps/${appToken}/tables/${table_id}/records/batch_create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${access_token}`
        },
        body: JSON.stringify({ records: chunk })
      });
      if (r.data.code !== 0) {
        return Response.json({ error: 'bitable append failed', detail: r.data, partial: inserted }, { status: 400 });
      }
      inserted.push(...((r.data.data && r.data.data.records) || []));
    }

    return Response.json({ inserted: inserted.length, records: inserted });
  } catch (err) {
    return Response.json({ error: 'internal', message: err.message }, { status: 500 });
  }
}
