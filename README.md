# gemini-share-arxuan

```bash
# 1. 拉到目标机
cd /root
git clone https://github.com/arxuan09/gemini-share-arxuan-deploy.git
cd gemini-share-arxuan-deploy

# 2. 改配置（直接编辑 docker-compose.yml）
vim docker-compose.yml
# 把 gemini-share-arxuan.environment 里这四个值改成你的：
#   LICENSE_KEY:               我给你的授权码
#   GEMINI_AUDIT_OAUTH_URL:    你的OAUTH接口
#   GEMINI_AUDIT_LIMIT_URL:    你的发消息限速接口
#   GEMINI_AUDIT_NOTIFY_URL:   你的计次回调接口（不用就不填）

# 3. 起服务
docker compose up -d
```

---

## 加 Gemini 账号

部署起来后号池是**空的**，必须用 admin 接口添加账号才能用。

```bash
curl -X POST http://127.0.0.1:19081/api/admin/accounts/create \
  -H "Authorization: Bearer $LICENSE_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "tier": "ultra",
    "note": "main account",
    "proxy": "socks5://user:pass@ip:port",
    "secure_1psid": "g.a000xxxxxx...",
    "secure_1psidts": "sidts-xxxxx..."
  }'
```

字段说明：

- `name` 可省，后端自动生成 10 位随机串
- `tier` 必须是 `free` / `pro` / `ultra` 之一
- `proxy` 可省（直连）；支持 `http://` / `https://` / `socks5://` / `socks5h://`
- `secure_1psid` 必填；`secure_1psidts` 浏览器开发者工具能看到就填，看不到就不填（系统会自己刷出）
- 创建带 cookie 后会**自动**异步初始化，几秒后账号即可使用

---

## 概念

| 名词 | 含义 |
| --- | --- |
| **userToken** | 你的业务系统签发给最终用户的凭证。镜像本身不签发也不解析它，只把它转给你的 audit 接口验真。形态可以是 JWT / UUID / 任意字符串 |
| **user_id** | audit OAuth 接口返回的稳定用户标识。镜像用它做用户区分和对话归属判断 |
| **车 / account** | Gemini 账号池里的一辆车，由 admin 接口添加，包含 cookies + tier + proxy |
| **LICENSE_KEY** | 同时作为 admin 接口 token，没单独 admin token |

---

## 你需要实现的 3 个 audit 接口

### OAuth — 验证 userToken

**触发时机**：用户在 `/login` 页提交 userToken 时。

`POST $GEMINI_AUDIT_OAUTH_URL`

请求（**注意是 form 编码**，不是 JSON）：

```
Content-Type: application/x-www-form-urlencoded

userToken=<用户提交的 token 原文>
```

期望响应（HTTP 200）：

```jsonc
{
  "code": 1,                              // 1 = 成功，其他 = 拒绝登录
  "status": "ok",                         // 仅作日志，可选
  "user_id": "u_42",                      // 必填，稳定的用户标识
  "email": "alice@example.com",           // 可选，会展示在管理台
  "avatar": "https://.../alice.png"       // 可选
}
```

行为：

- `code=1` 且 `user_id` 非空 → 登录成功（会话有效期 30 天），用户跳转选车页
- `code != 1` 或 `user_id` 为空 → 镜像返回 401，前端提示登录失败
- 你的接口返回 4xx/5xx → 镜像也返回 401，但带原始 message

### Limit — 发消息前限速 / 内容审核

**触发时机**：用户每次点"发送"前，镜像先调一次。这个接口是**强同步阻塞**：你不返回 `approved`，消息就不会发给 Gemini。

`POST $GEMINI_AUDIT_LIMIT_URL`

请求：

```
Authorization: Bearer <userToken 原文>
Content-Type: application/json

{
  "action": "next",
  "model": "gemini-3-pro",                 // 镜像解析的可读模型 ID（见下表）
  "messages": [
    { "content": { "parts": ["用户这条 prompt 的纯文本"] } }
  ]
}
```

| `model` 值 | 含义 |
| --- | --- |
| `gemini-3-pro` | 标准 / Plus / Advanced 通用 |
| `gemini-3-flash` | Flash 模型 |
| `gemini-3-flash-thinking` | Thinking 模型 |
| `gemini-default` | 兜底（解析不到模型头时） |

期望响应（HTTP 200）：

```jsonc
{
  "status": "approved",       // 字面值；其他任意值都视为拒绝
  "user_id": "u_42",          // 可选
  "model": "gemini-3-pro"     // 可选回显
}
```

行为：

- `status === "approved"` → 放行
- 其他 → 镜像返回 403 `audit_rejected` + 你接口里的 message
- 你的接口 4xx/5xx → 镜像同样 403

**典型实现**：

- 按 `user_id` 维度查当日已用次数
- 检查超限 / 黑名单关键词 / 并发限流
- 通过 → 返回 `approved`；拒绝 → 返回 `{status:"limited", message:"今日次数已用完"}`

### Notify — 计次 / 扣费回调（可选）

**触发时机**：镜像把 Gemini 响应回写给浏览器之后，异步通知你"这次对话用掉了 1 次"。

`docker-compose.yml` 里 `GEMINI_AUDIT_NOTIFY_URL` 留空 / 删除整行 → 这个接口不会被调，可以不实现。

`POST $GEMINI_AUDIT_NOTIFY_URL`

请求和 Limit 完全一样：

```
Authorization: Bearer <userToken 原文>
Content-Type: application/json

{ "action": "next", "model": "gemini-3-pro", "messages": [...] }
```

期望响应：

```json
{ "status": "recorded" }
```

行为：

- `status === "recorded"` → 计次成功
- 其他 → 镜像端忽略，不影响用户。**不要**用这个接口阻塞业务

---

## 系统对接（你的业务系统调）

### 一键登录直达 Gemini

`GET /api/login?user_token=<token>&car=<account_name>`

参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `user_token` | 是 | 等同 POST 登录里那个 userToken |
| `car` / `car_id` | 否 | 账号名称（账号名是唯一的，admin 接口创建时返回 `name` 字段） |

响应：3xx 重定向，没有 JSON body。

| 命中条件 | 跳转目标 |
| --- | --- |
| `user_token` 为空 | `/login` |
| OAuth 校验失败 | `/login?error=login_failed` |
| 没传 `car` 或 `car` 校验失败 | `/select`（已登录态，让用户自己选车） |
| `car` 命中可用账号 | `/gemini.google.com/app`（已登录 + 已选车，直接进 Gemini） |

`car` 校验失败的情况：账号不存在 / 已停用 / 没 cookie（`has_cookies=false`）。

典型用法：你的业务后台拼一个链接发给用户：

```
https://your-host:19081/api/login?user_token=eyJhbGc...&car=mainbox
```

用户点开 → 镜像走 OAuth → 设置 session → 进入指定的 Gemini 账号。

### 列出可用车辆（系统对接用）

`GET /api/cars`

> 选车界面 / 业务侧拉车辆列表请用这个接口。**不要**用 `/api/admin/accounts/list` —— 那个是 admin 接口，会把每个账号的明文 cookies（`__Secure-1PSID` / `__Secure-1PSIDTS` 等）一并返回，敏感信息会泄露到前端。

```jsonc
{
  "accounts": [
    {
      "id": 1,
      "name": "mainbox",
      "enabled": true,
      "tier": "ultra",
      "note": "main account",
      "has_cookies": true,
      "today_usage": { "pro": 12, "thinking": 5 },
      "daily_quota": { "pro": 500, "thinking": 1500 },
      "load_percent": 1
    }
  ]
}
```

字段语义：

- `name`：在一键登录链接里当 `car=` 用
- `tier`：`free` / `pro` / `ultra`
- `has_cookies`：false 表示这台车 cookie 缺失，**一键登录传它会回退到选车页**
- `today_usage`：今日各模型已用 prompt 数
- `daily_quota`：tier 配额，free=10/10、pro=100/300、ultra=500/1500（Fast 不限不在内）
- `load_percent`：按总配额加权计算的当天负载百分比；100 = 已经用完

典型用法：业务后台展示当前可选车辆 + 各车今日剩余额度，让用户挑或者由你的系统自动选最空闲的那辆，再用一键登录链接送过去。

---

## 管理 gemini 账号和消息的接口

全部 `POST`，所有参数走 JSON body。鉴权头**二选一**：

```
Authorization: Bearer $LICENSE_KEY
# 或
X-Admin-Token: $LICENSE_KEY
```

不带 / 错误 → HTTP 401 `unauthorized`。

### 账号列表

`POST /api/admin/accounts/list`

```jsonc
{
  "enabled": true,         // 可选，过滤启用状态
  "q": "car-1"             // 可选，按 name / note 模糊匹配
}
```

响应：

```jsonc
{
  "accounts": [
    {
      "id": 1,
      "name": "g7Hk2mQ4Bx",
      "enabled": true,
      "tier": "ultra",
      "proxy": "socks5://...",
      "note": "main",
      "last_error": "",
      "last_bootstrap_at": "2026-05-06T21:17:51+08:00",
      "created_at": "...",
      "updated_at": "...",
      "has_cookies": true,
      "cookies": {                                  // ← admin 列表会带明文 cookies
        "__Secure-1PSID": { "value": "g.a000...", "expires_at": 1782999999 },
        "__Secure-1PSIDTS": { "value": "sidts-..." }
      }
    }
  ]
}
```

### 创建账号

`POST /api/admin/accounts/create`

```jsonc
{
  "name": "car-1",                          // 可省；省略则后端生成 10 位 [A-Za-z0-9]
  "enabled": true,                          // 可省，默认 true
  "tier": "ultra",                          // free / pro / ultra
  "proxy": "socks5://user:pass@ip:port",    // 可省（直连）
  "note": "main account",                   // 可省
  "secure_1psid": "g.a000xxxxxx...",        // 必填
  "secure_1psidts": "sidts-xxxxx..."        // 开发者工具能看到就填，看不到就不填
}
```

返回 201。**带 cookie 创建** → 自动异步初始化，几秒后账号即可使用。

错误：

- 409 `account_name_taken` —— 名称冲突
- 400 `bad_request` —— tier 非法 / proxy URL 无效

### 编辑账号

`POST /api/admin/accounts/update`

```jsonc
{
  "id": 1,
  "name": "car-1-renamed",         // 可省
  "tier": "pro",                   // 可省
  "proxy": "",                     // 传空字符串 = 改为直连；省略 = 不动
  "note": "...",                   // 可省
  "enabled": false,                // 可省
  "secure_1psid": "g.a000...",     // 可省；传了就自动重新初始化
  "secure_1psidts": "sidts-..."    // 开发者工具能看到就填，看不到就不填
}
```

`secure_1psid` 字段一旦传入（即使和原值相同）就会触发账号重新初始化；只想改名字 / tier / proxy / note 时**不要**带这两个字段。

### 详情 / 删除 / 重新初始化 / 强制刷新

```
POST /api/admin/accounts/get        { "id": 1 }     # 同 list 单条
POST /api/admin/accounts/delete     { "id": 1 }     # 删除账号
POST /api/admin/accounts/bootstrap  { "id": 1 }     # 强制重新初始化
POST /api/admin/accounts/rotate     { "id": 1 }     # 强制让 Google 给一组新 cookie
```

### 对话审计

镜像会自动落库每个用户和 Gemini 的对话，admin 可以查询、删除。常用于内容合规、客服回查、用户清空请求。

#### turns/list — 列对话摘要

`POST /api/admin/turns/list`

请求体（所有参数可选；不传任何参数返回全量分页结果）：

```jsonc
{
  "user_id": "u_42",                  // 精确过滤某用户
  "account_id": 1,                    // 精确过滤某车
  "conversation_id": "c_xxx",         // 精确匹配
  "cid": "...",                       // 同 conversation_id，但会同时匹配最近一次的候选 id
  "request_uuid": "...",              // 精确匹配最近一次请求 id
  "q": "...",                         // 按对话标题模糊搜索
  "model": "gemini-3-pro",            // 模型名 LIKE 过滤
  "limit": 100,                       // 默认 100
  "offset": 0                         // 默认 0
}
```

响应：

```jsonc
{
  "turns": [
    {
      "id": 123,
      "user_id": "u_42",
      "account_id": 1,
      "conversation_id": "c_1f3f50e2302be440",
      "title": "Brainstorm 命名",
      "model_id": "gemini-3-pro",
      "model_tail": 0,
      "status_code": 200,
      "turn_count": 7,
      "last_request_id": "req-...",
      "last_response_id": "resp-...",
      "last_candidate_id": "...",
      "created_at": "2026-05-06T20:00:00+08:00",
      "updated_at": "2026-05-06T20:30:00+08:00"
    }
  ]
}
```

> 列表只返回对话**摘要**，不带每一轮的 prompt / assistant 全文。要看正文用 `turns/get`。

#### turns/get — 详情（含全部消息）

`POST /api/admin/turns/get`

```json
{ "id": 123 }
```

响应：在 list 单条的基础上多一个 `messages` 数组，每条是一轮 prompt + assistant：

```jsonc
{
  "turn": {
    "id": 123,
    "user_id": "u_42",
    "account_id": 1,
    "conversation_id": "c_1f3f50e2302be440",
    "title": "Brainstorm 命名",
    "model_id": "gemini-3-pro",
    "turn_count": 7,
    "created_at": "...",
    "updated_at": "...",
    "messages": [
      {
        "id": 1001,
        "sequence": 1,
        "request_uuid": "req-...",
        "model_hint": "gemini-3-pro",
        "model_id": "gemini-3-pro",
        "language": "zh-CN",
        "status_code": 200,
        "created_at": "...",
        "prompt": "用户的原始问题文本",
        "assistant_text": "Gemini 的完整回复文本"
      }
    ]
  }
}
```

`prompt` 和 `assistant_text` 是该轮对话的完整明文。

#### turns/delete — 删除一条对话

`POST /api/admin/turns/delete`

```json
{ "id": 123 }
```

响应：

```json
{ "deleted": 1 }
```

会同时删掉这个对话下所有轮次的消息记录。
