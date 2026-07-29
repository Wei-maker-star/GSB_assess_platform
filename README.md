# GSB Eval · 飞书集成版

一个可以在飞书里使用的 A/B 评估平台。前端是一个纯静态 `index.html`，后端是极简 Express 服务（Vercel serverless function），负责飞书 OAuth 换 token、Sheets / Bitable API 转发。

## 功能一览

- ✅ **飞书免密登录**：飞书客户端里静默 OAuth；浏览器里点按钮跳转飞书授权页
- ✅ **三种角色**：产品 / CQC（普通评分员）、管理员（可创建/取消任务）
  - 管理员白名单在 `index.html` 里硬编码，见 `ADMIN_USER_IDS`
- ✅ **飞书表格一键导入**：粘贴 Sheet 分享链接，后端读取全部数据（含图片）
- ✅ **飞书多维表格导出**：每题一条记录，评分人、时间、维度分数写回 Bitable
- ✅ **多人并发**：所有数据都落在飞书多维表格，互不覆盖
- ✅ **本地评估功能保留完整**：手机预览、文风表达/组织逻辑两个维度、5 档评分、GSB 独立总分、评价理由、产品卡片渲染、导出 JSON/CSV

## 目录结构

```
.
├── index.html          ← 前端（单文件）
├── server/
│   ├── index.js        ← Express 后端
│   └── package.json    ← 后端依赖
├── vercel.json         ← Vercel 部署路由
└── README.md
```

## 快速开始

### 1. 在飞书开放平台创建自建应用

1. 打开 [飞书开放平台](https://open.feishu.cn/app)，创建"企业自建应用"。
2. 记下 **App ID** 和 **App Secret**。本项目已内置 App ID `cli_aae3d417d878dbd8`；如需换应用，改 `index.html` 里的 `FS_APP_ID` 和后端环境变量 `FEISHU_APP_ID`。
3. **凭证与基础信息 → 添加重定向 URL**：填入你部署后的域名根路径。
   - 例：`https://your-app.vercel.app/`
   - 本地调试可先加：`http://localhost:3000/`
4. **权限管理 → 开通以下权限**（都在"应用能力"或"API 权限"里搜索）：

   | 权限点 | 用途 |
   |---|---|
   | `authen:user_info` / `contact:user.base:readonly` | 读取当前用户信息 |
   | `sheets:spreadsheet:readonly` / `sheets:spreadsheet` | 读取电子表格 |
   | `bitable:app` | 读写多维表格 |

5. **应用能力 → 网页应用**：勾选"启用"，桌面端主页 URL 填部署后的域名。这样在飞书客户端里点应用就会自动免密登录。
6. **版本管理与发布**：提交审核，通过后才能生效。

### 2. 部署到 Vercel

1. 把本仓库推到 GitHub。
2. 进入 [Vercel Dashboard](https://vercel.com) → New Project → 选择仓库。
3. **Environment Variables** 添加：
   - `FEISHU_APP_SECRET` = 你在飞书开放平台看到的 App Secret（必填）
   - `FEISHU_APP_ID` = `cli_aae3d417d878dbd8`（可选，代码里已经有默认值）
   - `FEISHU_HOST` = 可选。国内飞书用默认 `https://open.feishu.cn`；海外 Lark 填 `https://open.larksuite.com`
4. **Framework Preset** 选 "Other"，不需要 build 命令。
5. 点 Deploy。

部署成功后，你会拿到一个 `https://xxx.vercel.app` 的域名。**记得把这个域名回填到飞书开放平台的"重定向 URL"和"网页应用主页 URL"**。

### 3. 填写管理员白名单

首次登录后，在浏览器 DevTools 里跑：

```js
JSON.parse(localStorage.fsAuth).user
// -> { user_id, open_id, union_id, name, ... }
```

复制 `open_id`（推荐）或 `user_id`，填到 `index.html` 里：

```js
const ADMIN_USER_IDS = [
  'ou_你的open_id',
  // 可以填多个
];
```

再次登录后就能选择"管理员"角色。

### 4. 准备飞书多维表格

- 新建一份多维表格，字段建议：
  - `任务ID`（文本）
  - `任务名称`（文本）
  - `题号`（数字）
  - `query`（多行文本）
  - `回答A` / `回答B`（多行文本；图片会以链接形式写入）
  - `文风表达分` / `组织逻辑分` / `整体GSB分`（单选：A更优 / A略优 / 持平 / B略优 / B更优）
  - `评价理由`（多行文本）
  - `评分人` / `评分人ID` / `评分角色`（文本）
  - `评分时间`（日期或文本，代码传的是 ISO 字符串）

在结果页点击 **☁️ 同步到飞书多维表格**，第一次会提示输入：
- 多维表格 URL（形如 `https://xxx.feishu.cn/base/bxxxxxxxxxxxxxxxx`）
- table_id（多维表格右上角 `···` → 复制表格 ID）

之后会记忆到本地，不用再输入。

## 本地开发

```bash
# 后端
cd server
npm install
FEISHU_APP_SECRET=你的_secret node index.js

# 前端（另开一个终端，用任意静态服务器；只要能访问同一域名下的 /api 就行）
# 简单起见，让 Express 顺带托管 index.html：或者用 vercel dev 直接跑 vercel.json
npx vercel dev
```

`vercel dev` 会同时提供静态文件和 `/api/*` 转发，最接近生产环境。

## 权限矩阵

| 操作 | 产品 | CQC | 管理员 |
|---|:---:|:---:|:---:|
| 登录、查看任务列表 | ✅ | ✅ | ✅ |
| 评分、写评价理由 | ✅ | ✅ | ✅ |
| 查看结果页 | ✅ | ✅ | ✅ |
| 同步到飞书多维表格 | ✅ | ✅ | ✅ |
| 创建任务 / 删除任务 / 清空数据 / 导入表格 | ❌ | ❌ | ✅ |

> 前端通过 `.no-perm` 灰化 + `pointer-events:none` 实现门禁。如果需要更强保证，可以再让后端在写入 Bitable 前校验角色。

## 前后端接口约定

| Endpoint | 方法 | Body | 用途 |
|---|---|---|---|
| `/api/feishu/config` | GET | – | 前端拿 App ID |
| `/api/feishu/login` | POST | `{ code }` | 用授权 code 换 user_access_token + 用户信息 |
| `/api/feishu/refresh` | POST | `{ refresh_token }` | 刷新过期 token |
| `/api/feishu/sheets/read` | POST | `{ access_token, url_or_token, range? }` | 读取表格数据 |
| `/api/feishu/bitable/append` | POST | `{ access_token, app_token_or_url, table_id, records }` | 批量写多维表格 |
| `/api/feishu/proxy` | POST | `{ access_token, path, method, body }` | 通用透传（调试用） |
| `/api/health` | GET | – | 健康检查 |

## 常见问题

**Q: 点登录跳到飞书后回来还是白屏。**
A: 检查飞书开放平台的重定向 URL 是否精确匹配（含协议、末尾斜杠）。浏览器 DevTools 看 `/api/feishu/login` 的响应。

**Q: 后端报 `FEISHU_APP_SECRET 未配置`。**
A: 在 Vercel Project Settings → Environment Variables 补上，然后重新 deploy（改环境变量不会自动重启）。

**Q: 拉取飞书表格返回 91403 / 权限不足。**
A: 需要在飞书表格里点右上角 `···` → 更多设置 → 添加协作者，把应用（不是你自己）加进去。多维表格同理。

**Q: 我不用 Vercel，能部署到别的地方吗？**
A: 后端只是一个 Express app，任何 Node 服务器都行。把 `server/index.js` 里 `if (require.main === module) app.listen(...)` 跑起来，前端指向同一域名即可。或者用 nginx 把 `/api/*` 反代到后端。

## License

内部使用。数据仅落飞书，不写第三方。
