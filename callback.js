const FEISHU_APP_ID = 'cli_aae3d417d878dbd8';
const FEISHU_HOST = 'https://open.feishu.cn';

async function feishuJson(path, options = {}) {
  const url = path.startsWith('http') ? path : `${FEISHU_HOST}${path}`;
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
  return { status: res.status, data };
}

async function getAppAccessToken(env) {
  const secret = env.FEISHU_APP_SECRET;
  if (!secret) throw new Error('FEISHU_APP_SECRET 未配置');
  const { data } = await feishuJson('/open-apis/auth/v3/app_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: FEISHU_APP_ID, app_secret: secret })
  });
  if (data.code !== 0 || !data.app_access_token) {
    throw new Error('获取 app_access_token 失败：' + JSON.stringify(data));
  }
  return data.app_access_token;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  if (!code) return new Response('missing code', { status: 400 });

  try {
    const appToken = await getAppAccessToken(env);
    const tokenResp = await feishuJson('/open-apis/authen/v1/oidc/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${appToken}`
      },
      body: JSON.stringify({ grant_type: 'authorization_code', code })
    });

    if (tokenResp.data.code !== 0) {
      return Response.json({ error: 'oauth failed', detail: tokenResp.data }, { status: 400 });
    }

    const d = tokenResp.data.data || {};
    const accessToken = d.access_token || '';
    const expiresIn = d.expires_in || 7200;
    const target = `${url.origin}/#fs_token=${encodeURIComponent(accessToken)}&fs_expires=${encodeURIComponent(String(expiresIn))}`;
    return Response.redirect(target, 302);
  } catch (err) {
    return new Response('OAuth callback error: ' + err.message, { status: 500 });
  }
}
