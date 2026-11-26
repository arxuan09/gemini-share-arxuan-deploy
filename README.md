# gemini-share-arxuan 部署文档

Gemini 号池共享网关。部署后用户通过你的业务系统登录、选车，直接使用 Gemini 网页版；你只需要准备授权码、Gemini 账号，以及（正式运营时）三个审计接口。

- [部署](#部署)：一键脚本 / Docker Compose 两种方式
- [配置说明（.env）](#配置说明env)
- [使用外部 MySQL / Redis](#使用外部-mysql--redis不启动自带实例)
- [更新与老版本迁移](#更新)
- [添加 Gemini 账号](#添加-gemini-账号)
- [对接你的用户中心（审计接口）](#对接你的用户中心审计接口)
- [业务系统对接](#业务系统对接)
- [多用户中心和多实例：两个不同的功能](#多用户中心和多实例两个不同的功能)
  - [进阶一：一套网关接多个站点（多用户中心）](#进阶一一套网关接多个站点多用户中心)
    - [把另一套已经在用的网关合并进来](#把另一套已经在用的网关合并进来)
  - [进阶二：多台服务器分担流量（多实例）](#进阶二多台服务器分担流量多实例)
- [管理接口（可选）](#管理接口可选)
- [常见问题](#常见问题)

**部署要求**：Linux 服务器、Docker 20.10+、Docker Compose v2（`docker compose` 命令）、能访问 Google。

---

## 部署

两种方式效果一样，选一种即可。所有配置都在 `.env` 文件里，**`docker-compose.yml` 不需要修改**。

### 方式一：一键部署脚本（推荐）

```bash
git clone https://github.com/arxuan09/gemini-share-arxuan-deploy.git
cd gemini-share-arxuan-deploy
./install.sh
```

脚本会：

1. 检查 Docker / Docker Compose；
2. 生成 `.env`，引导你填写授权码、后台密码（可选）和端口；
3. 准备数据目录、拉取镜像、启动；
4. 等网关和授权校验就绪后，打印管理台地址。

也可以免交互部署，把配置写在命令前面：

```bash
LICENSE_KEY=你的授权码 ADMIN_PASSWORD=后台密码 GATEWAY_PORT=19081 ./install.sh
```

`install.sh` 可以重复运行：已有的 `.env` 不会被覆盖，数据不会丢。改完 `.env` 后再跑一次就会按新配置重启。

### 方式二：Docker Compose

```bash
git clone https://github.com/arxuan09/gemini-share-arxuan-deploy.git
cd gemini-share-arxuan-deploy
cp .env.example .env
vim .env                 # 填 LICENSE_KEY；可选：后台密码、端口
mkdir -p data/gemini-share-arxuan && sudo chown 100:101 data/gemini-share-arxuan   # 网关进程要能写这个目录
docker compose up -d
```

启动后检查：

```bash
docker compose ps                                  # 三个容器都应是 healthy
docker compose logs -f gemini-share-arxuan         # 看日志，出现 license check: ok 即授权通过
```

### 部署完成后

1. 浏览器打开 `http://服务器IP:19081/admin/`，用后台密码登录管理台（没设置 `ADMIN_PASSWORD` 时就是授权码）；
2. 「设置 → 审计接口」填写你的用户中心接口（见[对接你的用户中心](#对接你的用户中心审计接口)），保存立即生效；
3. 「账号池」添加 Gemini 账号（**号池默认是空的**，见[添加 Gemini 账号](#添加-gemini-账号)）。

---

## 配置说明（.env）

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `LICENSE_KEY` | 是 | 授权码 |
| `ADMIN_PASSWORD` | 否 | 后台密码：管理台 `/admin/` 的登录密码，也是管理接口的 token。不填就用授权码；填了就只能用它登录，授权码不再能进后台 |
| `GATEWAY_PORT` | 否 | 对外端口，默认 `19081` |

数据库（默认用部署自带的 MySQL / Redis 容器，一般不用改）：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `MYSQL_HOST` | `mysql` | MySQL 地址。`mysql` 即自带容器；用外部 MySQL 时填它的地址 |
| `MYSQL_PORT` | `3306` | |
| `MYSQL_USER` | `root` | 自带 MySQL 只支持 `root` |
| `MYSQL_PASSWORD` | `gemini123` | 用自带 MySQL 时，只在第一次初始化（`data/mysql` 为空）时生效，之后**不要再改** |
| `MYSQL_DATABASE` | `gemini` | 库名。用外部 MySQL 时需要提前建好 |
| `REDIS_HOST` | `redis` | Redis 地址。`redis` 即自带容器 |
| `REDIS_PORT` | `6379` | |
| `REDIS_PASSWORD` | 空 | Redis 密码。用自带 Redis 时，填了会自动开启密码认证 |
| `REDIS_DB` | `0` | Redis 库编号（0–15）。同一个 Redis 上放着几套**互不相关**的网关时，用不同编号隔开；[多实例](#进阶二多台服务器分担流量多实例)的几台服务器是同一个网关，**必须用同一个编号** |

数据库密码不要包含 `@`、`/`、`:` 这类特殊字符。

多实例（只有[多台服务器一起跑](#进阶二多台服务器分担流量多实例)时才用，只有一台就不用管）：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `NODE_ROLE` | `primary` | `primary` 主实例（只能有一台）或 `replica` 副实例 |
| `NODE_ID` | 空 | 服务器的名字，管理台「节点」页显示用。不填时主实例叫 `main`，副实例自动生成 |
| `PRIMARY_LOST_TIMEOUT` | `3m` | 只对副实例生效：主实例消失多久后副实例下线，`0` 表示不下线 |
| `REPLICA_REQUIRE_PROXY` | `false` | 只对副实例生效：`true` 时副实例只用绑了代理的账号 |

[多用户中心](#进阶一一套网关接多个站点多用户中心)（一套网关给多个站点用）**不在 `.env` 里配置**，在管理台「用户中心」页配置。

修改后执行 `docker compose up -d`（或再跑一次 `./install.sh`）生效。

**审计接口（你的用户中心）不在 `.env` 里**，部署后到管理台「设置 → 审计接口」填写，保存立即生效、无需重启：

- `OAuth` 和 `Limit` 必须**同时填写**（正式运营）或**同时留空**（本地测试模式），`Notify` 可选；
- 还没填的时候是**本地测试模式**：不对接外部用户中心，改用管理台「测试用户」页建号登录，按模型限制每日次数。不做内容审核，只用于联调测试，不要用于正式运营。


### 使用外部 MySQL / Redis（不启动自带实例）

默认会启动自带的 MySQL 和 Redis 容器。已经有自己的 MySQL / Redis 时，可以改成连外部的，并且不再启动自带的实例（可以只换其中一个）。

**1. 准备外部服务**

- MySQL 8：提前建好库，账号要有这个库的全部权限（网关启动时会自动建表）：

  ```sql
  CREATE DATABASE gemini CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  ```

- Redis 6 及以上：确定要用的库编号（`REDIS_DB`，0–15）。同一个 Redis 上放着几套互不相关的网关时，每套用不同的编号（多实例的几台服务器算同一套，用同一个编号）。

**2. 改 `.env`**

填 `MYSQL_HOST` / `MYSQL_PORT` / `MYSQL_USER` / `MYSQL_PASSWORD` / `MYSQL_DATABASE`，以及 `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` / `REDIS_DB`。

网关跑在容器里：外部服务在同一台服务器上时，`HOST` 要填服务器的内网 IP，**不能填 `127.0.0.1` / `localhost`**；对应的 MySQL / Redis 也要监听这个 IP，并允许 Docker 网段（通常是 `172.16.0.0/12`）连接。

**3. 改 `docker-compose.yml`，去掉不用的自带服务**

- 用外部 MySQL：删掉整段 `mysql:` 服务，以及 `gemini-share-arxuan` 下 `depends_on` 里的 `mysql` 那一项；
- 用外部 Redis：删掉整段 `redis:` 服务，以及 `depends_on` 里的 `redis` 那一项；
- 两个都用外部：两段服务都删掉，`depends_on` 整个删掉。

**4. 启动**

```bash
docker compose up -d --remove-orphans     # --remove-orphans 会停掉并删除之前启动过的自带容器
docker compose logs --tail 50 gemini-share-arxuan    # 没有 database / redis 报错即连接成功
```

**之前用自带数据库跑过、要把数据搬过去**

- MySQL（账号、对话记录、设置都在这里）：先导出再导入外部库：

  ```bash
  docker exec gemini-share-arxuan-mysql mysqldump -uroot -p<原 MYSQL_PASSWORD> --single-transaction gemini > gemini.sql
  mysql -h <外部地址> -u <用户> -p <库名> < gemini.sql
  ```

- Redis 可以不迁移：账号 Cookie 在 MySQL 里有备份，网关会自动从 MySQL 恢复；只是用户的登录状态会失效，需要重新登录一次。

**以后更新**

因为本地改过 `docker-compose.yml`，`git pull` 前先暂存本地修改：

```bash
git stash && git pull && git stash pop && ./update.sh
```

`git stash pop` 提示冲突时，用新版的 `docker-compose.yml` 按第 3 步重新删一次即可。只更新镜像、不拉新部署文件的话，直接 `./update.sh` 就行。

---

## 更新

```bash
cd 部署目录
git pull
./update.sh
```

`update.sh` 只拉取并重建网关容器，不动 MySQL / Redis；新容器起来后自动删除本产品的旧镜像，不碰这台机器上的其它镜像。新版本启动失败时旧镜像还在，可以回滚。数据都在 `data/` 目录里，更新不会丢。

### 从老版本升级（配置还写在 docker-compose.yml 里的）

老版本需要直接改 `docker-compose.yml`，现在配置挪到了 `.env`。直接 `git pull` 会因为本地改过 `docker-compose.yml` 而冲突，按下面的顺序操作一次即可：

```bash
cd 部署目录
cp docker-compose.yml docker-compose.old.yml    # 1. 备份原配置
git checkout -- docker-compose.yml              # 2. 撤销本地修改
git pull                                        # 3. 拉取新版部署文件
./install.sh                                    # 4. 自动从 docker-compose.old.yml 生成 .env 并重启
```

> **暂时不想迁移也没关系**：新版本镜像完全兼容老的 `docker-compose.yml`。不要执行 `git pull`，直接在部署目录运行 `./update.sh`（或 `docker compose pull && docker compose up -d`）就能更新到最新版本，原来的配置照常生效。只是这样拿不到新的部署脚本和文档，想用新方式时再按上面四步迁移一次。

第 4 步会自动把授权码、端口（以及改过的数据库密码）写进 `.env`，不用手抄。审计接口地址早就保存在数据库里，不受影响；数据也不受影响。确认服务正常后可以删除 `docker-compose.old.yml`。之后的更新就是普通的 `git pull && ./update.sh`。

---

## 添加 Gemini 账号

推荐在管理台「账号池」里操作，有可视化界面。

### Cookie 怎么取

在浏览器里登录 Gemini（gemini.google.com），用开发者工具或 Cookie 导出插件，复制 **gemini.google.com 页面的完整 Cookie**（`名字=值; 名字=值; …` 这种整串）。

- **必须包含 `OSID` / `__Secure-OSID`**。Gemini 2026-11 起登录强依赖它，缺了账号会被判为未登录，而且系统刷新补不回来。只复制 `__Secure-1PSID` 那几个是不够的。
- 不要手动挑字段，整串一次性复制最稳妥。
- 管理台列表里标「需补 OSID」的号，需要重新完整导出 Cookie。

### 添加单个账号

「账号池 → 添加账号」，把完整 Cookie 粘进去保存即可：

- 名称可以不填，会自动生成；等级可以选「自动识别」，系统按账号订阅自动同步。
- 保存时会用这串 Cookie 打开一次 Gemini，**识别出它属于哪个 Google 邮箱**：
  - 号池里**已经有这个邮箱的号** → 自动按「更新」处理：只替换 Cookie，名称、代理、等级、备注不变；
  - 没有 → 新建；
  - Cookie 已失效（未登录） → 直接提示，不保存。
- 账号列表的名称下方会显示邮箱，搜索框也能按邮箱搜。

### 批量添加 / 更新

「账号池 → 批量加号 / 更新」，**一行粘贴一个号的完整 Cookie**，后台异步处理，弹窗里实时显示每一行的结果（新建 / 更新 / 失败 / 跳过）：

- 已有的号自动更新 Cookie，并按「导入后启用」重新启用（适合给掉线的号统一补 Cookie）；
- 新号可以选「智能分配代理」（每个新号挑一个最空闲的健康代理），或统一用某个代理、直连；
- 同一个号出现多行时只用最靠下的一行；失效的 Cookie 不会保存；一次最多 200 行。

### 给掉线的号补 Cookie

号池里的号掉线后（被自动停用 / 标「疑似掉线」），重新登录浏览器、导出完整 Cookie，用「批量加号 / 更新」粘进去即可，会自动认出是哪个号并更新、重新启用。

如果这个号是很早以前加的、还没记录过邮箱（列表里名称下方没有邮箱），先「编辑」它，在「Google 邮箱」里手动填上邮箱，再批量导入，就能正确匹配；否则会被当成新号新建。

---

## 对接你的用户中心（审计接口）

你需要实现三个 HTTP 接口，网关在用户登录、发消息前、对话完成后分别调用。

这里配置的是「默认用户中心」，大多数部署只有这一个。要让一套网关同时给好几个站点用（每个站点有自己的用户中心），见[进阶一：多用户中心](#进阶一一套网关接多个站点多用户中心)。

| 名词 | 含义 |
| --- | --- |
| **userToken** | 你的业务系统签发给最终用户的凭证。网关不签发也不解析，只转给你的接口验证。可以是 JWT / UUID / 任意字符串 |
| **user_id** | OAuth 接口返回的稳定用户标识，网关用它区分用户、记录对话归属 |
| **车 / 账号** | 号池里的一个 Gemini 账号 |

### OAuth：验证 userToken

**调用时机**：用户在登录页提交 userToken，或打开一键登录链接时。

```
POST <OAuth 地址>
Content-Type: application/x-www-form-urlencoded       ← 注意是 form 编码，不是 JSON

userToken=<用户提交的 token 原文>
```

期望响应（HTTP 200）：

```jsonc
{
  "code": 1,                       // 1 = 成功，其他 = 拒绝登录
  "user_id": "u_42",               // 必填，稳定的用户标识
  "email": "alice@example.com",    // 可选，会展示在管理台
  "status": "ok",                  // 可选，仅记日志
  "avatar": "https://..."          // 可选
}
```

- `code=1` 且 `user_id` 非空 → 登录成功，会话有效期 30 天；
- 其他情况（含你的接口返回 4xx/5xx） → 登录失败。

**拒绝时给用户看的提示**：拒绝登录时在响应里带上 `msg`，网关会把它原样显示给用户。比如没有权限、会员过期：

```jsonc
{
  "code": 0,                                   // 不为 1 即拒绝
  "msg": "您还没有开通 Gemini 权限，请联系客服"   // 展示给用户的一句话，最长 200 字
}
```

- `msg` 必须是字符串。没有 `msg` 时也会读 `message` 字段。
- 返回 HTTP 200 且 `code` 不为 1，或者返回 4xx 且内容是 JSON，都算「拒绝」：有 `msg` 显示 `msg`；没有时，一键登录显示「您还没有Gemini权限，请购买后使用」，登录页手动输入显示「登录失败，请检查 userToken 是否正确」。
- 返回 5xx、内容不是 JSON、连不上或超时，算「服务不可用」，统一显示「登录服务暂时不可用，请稍后重试」（5xx 里的错误信息不会给用户看，免得把数据库报错之类的内部信息露出去）。
- 调用 `POST /api/login` 的业务系统：失败时返回 HTTP 401 `{"error":"login_failed","message":"<上面这句提示>"}`。
- **一键登录**（`GET /api/login?user_token=...`，用户从你的系统点进来）失败时，不会出现输入 userToken 的登录页，而是显示一个只有这句提示的页面（拒绝返回 HTTP 403，服务不可用返回 503），**4 秒后自动跳回用户来的网站**。跳转地址：
  - 用户从你的网站点链接进来时，跳回你的网站首页（来源网站的根地址）。想跳回具体页面，在一键登录链接里带上 `&shareUrl=https://你的网站/某个页面`，**必须和用户来的网站同域名**才会生效。
  - 你的网站设置了不发送来源（`Referrer-Policy: no-referrer`）时，跳回用户上次成功进入 Gemini 时记下的首页地址；没有记录就只显示提示和「请返回首页重新进入」，不跳转。
- 用户在网关登录页手动输入 userToken 时，提示显示在输入框下方。

### Limit：发消息前准入 / 限速

**调用时机**：用户每次发送消息前。**同步阻塞**：不返回 `approved`，消息就不会发给 Gemini。

```
POST <Limit 地址>
Authorization: Bearer <userToken 原文>
Content-Type: application/json

{
  "action": "next",
  "model": "gemini-4-neon",        // 本轮使用的模型名，见下表
  "messages": [
    { "content": { "parts": ["用户这条消息的纯文本"] } }
  ]
}
```

期望响应（HTTP 200）：

```jsonc
{
  "status": "approved",            // 只有这个值算放行，其他任何值都算拒绝
  "error": "今日次数已用完"          // 拒绝时可选，会原样展示给用户（也可以用 message 字段）
}
```

- `status === "approved"` → 放行；
- 其他（含 4xx/5xx） → 用户看到你返回的 `error` / `message`，没有就显示通用提示。

典型实现：按 `user_id` + `model` 查今日已用次数，检查是否超限、关键词、并发，然后返回 `approved` 或拒绝原因。

### Notify：对话完成后计次（可选）

**调用时机**：一轮对话成功完成后，异步调用。不配置就不会调用。

请求格式和 Limit 完全一样，期望响应 `{"status": "recorded"}`。返回其他值只记日志，不影响用户，**不要**用它阻塞业务。

### 模型名

`model` 字段是网关识别出的模型名，用来按模型分别限速：

| `model` | 对应 Gemini 网页版 |
| --- | --- |
| `gemini-4-neon` | 4 Neon（更深入的分析） |
| `gemini-4-hydrogen` | 4 Hydrogen（日常帮助）；Workspace 号的 4 Hydrogen |
| `gemini-auto` | Pro 号的「自动」档 |
| `gemini-4-carbon` | 4 Carbon（代码和复杂工作，Ultra） |
| `gemini-4-argon` | 4 Argon |
| `gemini-4-hydrogen-thinking` | Workspace 号的 4 Hydrogen Thinking |
| `gemini-3-pro` | Workspace 号的 3.1 Pro |
| `gemini-3-flash` | 免费号的 Auto；Ultra 的 3.5 Flash-Lite |
| `gemini-3-flash-thinking` | Ultra 的 Flash Thinking |
| `gemini-default` | 识别不出模型时的兜底 |

- Google 会不定期调整模型，**以管理台「模型说明」页为准**，那里列出当前所有模型名及识别来源。
- 不想按模型区分时，打开管理台「设置 → 统一模型名」，所有请求都发 `gemini-default`。
- 开启「Pro 降级」时，被降级的请求按**实际使用的模型**发送。
- 限速服务里没有为某个模型名配置额度的话，等于对这个模型不限速。模型名变化时记得同步你那边的配置。

---

## 业务系统对接

### 一键登录直达 Gemini

```
GET /api/login?user_token=<token>&car=<账号名>
```

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `user_token` | 是 | 同 OAuth 里的 userToken |
| `car`（或 `car_id`） | 否 | 账号名称（管理台账号列表里的「名称」） |
| `shareUrl` | 否 | 登录失败时提示页跳回的地址，必须和用户来的网站同域名，见上文 OAuth 一节 |

结果：

| 情况 | 结果 |
| --- | --- |
| 没传 `user_token` | 302 跳到 `/login` |
| OAuth 验证失败 | 不跳登录页：显示提示页（403 / 503），4 秒后跳回用户来的网站，见上文 OAuth 一节 |
| 没传 `car`，或该账号不存在 / 已停用 / 没有 Cookie | `/select`（已登录，让用户自己选车） |
| `car` 是可用账号 | 直接进入 Gemini |

用法：你的业务后台拼好链接发给用户，例如 `https://你的域名/api/login?user_token=eyJhbGc...&car=mainbox`。

### 列出可用的车

```
GET /api/cars
```

公开接口，不需要鉴权，给你的选车界面用。**不要**在前端调用 `/api/admin/accounts/list`，那是管理接口，会返回账号的明文 Cookie。

```jsonc
{
  "accounts": [
    {
      "id": 1,
      "name": "mainbox",
      "enabled": true,
      "tier": "pro",
      "note": "main account",
      "has_cookies": true,
      "today_usage": { "pro": 12, "thinking": 5 },
      "daily_quota": { "pro": 100, "thinking": 300 },
      "load_percent": 12
    }
  ]
}
```

- `name`：一键登录链接里的 `car=`；
- `has_cookies=false`：这辆车缺 Cookie，一键登录传它会回到选车页；
- `load_percent`：负载百分比（100 = 用满）。优先按 Gemini 官方用量（5 小时 / 每周额度）计算，拿不到时按今日提问次数和等级配额估算（free 10/10、pro 100/300、ultra 500/1500）；
- 管理台开启了「虚拟车」时，列表里还会有按等级聚合的虚拟车，用户选它会被分到同等级负载最低的真车。

---

## 多用户中心和多实例：两个不同的功能

这两个都是进阶功能，**大多数部署一个都用不上**。它们解决的是完全不同的问题，可以单独用，也可以一起用：

| | 多用户中心 | 多实例 |
|---|---|---|
| 一句话 | **一套网关**给**多个站点**用 | **多台服务器**一起跑**同一个**网关 |
| 解决什么问题 | 你有好几个站点（好几套用户系统），想共用一个号池 | 一台服务器扛不住流量，或者想在不同地区各放一台 |
| 需要几台服务器 | 一台就够 | 至少两台 |
| 用户中心（审计接口） | **多套**，每个站点一套 | **一套**，所有服务器用同样的配置 |
| 用户和聊天记录 | 按站点隔开，互相看不到 | 不隔开：同一个用户走哪台服务器都一样 |
| 网关怎么区分 | 看用户访问的是哪个域名 | 不用区分，任何一台都能服务任何用户 |
| 怎么开启 | 管理台「用户中心」页新建 | 每台服务器的 `.env` 里设 `NODE_ROLE` |
| 管理台里对应的页面 | 用户中心 | 节点 |
| 授权 | 不需要额外授权 | 每台服务器的 IP 都要登记 |

怎么选：

- **想再接一个站点**（另一套用户系统、另一家客户）：用**多用户中心**。不需要第二台服务器，也不用改 `.env`。
- **流量太大、想加服务器**：用**多实例**。不需要建用户中心，所有服务器还是同一套用户。
- **两个都要**：比如两台服务器、三个站点。先按进阶二部署好多实例，再在主实例的管理台建用户中心；建一次，所有服务器都生效，用户访问哪台都按域名识别是哪个站点。

### 进阶一：一套网关接多个站点（多用户中心）

一套网关同时给多个站点用：**号池共用**，每个站点用自己的用户中心验证用户，**各站点的用户和聊天记录互相隔开**。

前面「对接你的用户中心」里配的审计接口就是**默认用户中心**。再接一个站点时：

1. **给新站点准备一个域名**（子域名就行，比如 `gemini.b.com`），解析到网关所在的服务器。网关就是靠访问的域名来区分站点的。
2. **nginx 加上这个域名**，转发到网关，并且必须带上 Host 头（不带的话网关认不出是哪个站点）：

   ```nginx
   server {
       server_name gemini.b.com;
       # listen / 证书配置照抄现有的
       location / {
           proxy_pass http://127.0.0.1:19081;
           proxy_set_header Host $host;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_http_version 1.1;
           proxy_set_header Connection "";
           proxy_buffering off;
           proxy_read_timeout 600s;
       }
   }
   ```

3. **管理台「用户中心」页 → 新建用户中心**：
   - 名称：随便起，管理台里看的；
   - 标识：小写字母、数字、`-`，比如 `b-site`，**建好不能改**；
   - 域名：第 1 步的域名，可以填多个；
   - 这个站点自己的 OAuth / limit / notify 地址，接口格式和[对接你的用户中心](#对接你的用户中心审计接口)完全一样。每个地址点一下「测试连接」确认能通。
4. 这个站点的[一键登录链接](#一键登录直达-gemini)用它自己的域名：`https://gemini.b.com/api/login?user_token=...`。

效果：

- 用户从哪个域名进来，就用哪个用户中心验证；没配置过的域名（包括直接用 IP 访问）都走默认用户中心。
- 不同站点里 user_id 相同的用户（比如都叫 `42`）是**两个人**，聊天记录互相看不到。
- 号池（账号、代理、选车）所有站点共用。
- 管理台「对话记录」可以按用户中心筛选；在「用户中心」页停用某个站点后，这个站点的用户立即无法登录和对话；有聊天记录的用户中心只能停用，不能删除。

注意：

- **新站点请用新域名**。把一个已经在用的域名改挂到新的用户中心，这个域名下的老用户会变成「新用户」，看不到以前的聊天记录。
- 同时用了多实例的话，**所有服务器都要升级到最新版**才能新建用户中心。还有旧版本的服务器在线时，管理台会拒绝新建。
- 你已经有另一套**单独部署、在用**的网关，想把它并进来：见下一节。

#### 把另一套已经在用的网关合并进来

适用场景：你有两套**单独部署**的网关 A 和 B，各有各的服务器、数据库、用户中心和聊天记录，想合并成一套，号池共用。

合并后的结果：

- **A 保留**，B 变成 A 里的一个用户中心，B 的用户中心配置原样搬过来；
- **B 的聊天记录完整迁移到 A**：B 的用户从 B 原来的域名进来，左侧历史里还能看到以前的对话，并且能接着聊；
- **B 的号并入 A 的号池**：A 已经有的号沿用 A 的，B 独有的号连同原来绑的代理一起导入；
- **B 原来的域名改指向 A**，B 的网关下线。B 的数据库保留 7 天，期间可以回滚。

前提和代价：

- A 的版本要 1.0.56 或更新，用了多实例的话每台服务器都要；B 的版本 1.0.50 或更新即可。
- **合并期间 B 要停机**，从停 B 到切完域名，一般几分钟到几十分钟。A 全程不停。
- B 的用户合并后要重新登录一次；从你的系统走一键登录的用户感觉不到。

怎么做：步骤写在 [docs/merge-instance.md](docs/merge-instance.md)，这份手册是写给 **AI agent**（比如 Claude Code）执行的。

1. 把这份手册交给 agent；
2. 按手册第 2 节准备好信息：两台服务器的登录方式、部署目录、两边的后台密码、B 的域名、一个用来测试的 userToken 等；
3. agent 会先只读检查，然后逐步执行。每一步会写数据的操作都会先问你同意，比如停 B、导入、切域名。

人也可以照着手册一步步做。

### 进阶二：多台服务器分担流量（多实例）

多台服务器跑同一个网关：所有服务器连**同一套 MySQL + Redis**，用的是**同一个号池、同一套用户中心、同一份聊天记录**。用户访问任何一台都一样，只是流量分摊到了几台服务器上。

多实例**不会**区分站点。想让不同站点用不同的用户中心，看[进阶一](#进阶一一套网关接多个站点多用户中心)，那个功能只需要一台服务器。

服务器分两种角色：

- **主实例**（只能有一台）：负责刷新所有账号的 Cookie、后台定时任务和数据库升级。管理台也只在主实例上能用。
- **副实例**（可以多台）：只转发用户流量，不刷新 Cookie。打开它的管理台会提示「这是副实例，请到主实例管理」。

**1. 部署主实例**

按上面的方式一或方式二正常部署。主实例的 MySQL / Redis 要能让副实例连上，两种做法：

- 推荐改用外部 MySQL / Redis，见[使用外部 MySQL / Redis](#使用外部-mysql--redis不启动自带实例)；
- 用自带的容器，就要自己把 3306 / 6379 端口开放给副实例服务器。这时**一定要设置 `REDIS_PASSWORD` 和强 MySQL 密码，并用防火墙只允许副实例 IP 访问**。

主实例的 `.env` 保持默认即可（`NODE_ROLE=primary`）。

**2. 部署副实例**

在副实例服务器上：

1. 拉部署文件，按「使用外部 MySQL / Redis」删掉自带的 `mysql` / `redis` 两个服务；
2. `.env` 里的 MySQL / Redis 配置**和主实例完全一样**，包括 `REDIS_DB`，地址填主实例能被访问到的地址；
3. 再改一行：

   ```bash
   NODE_ROLE=replica
   ```

4. 执行 `./update.sh`。它会创建数据目录、设置好权限再启动。不要直接 `docker compose up -d`，否则节点名保存不下来。

节点名 `NODE_ID` 可以不填：副实例第一次启动时会自动生成一个（比如 `node-3fa9c1`），保存在 `data/gemini-share-arxuan/node_id`，以后重启、升级都不变。想在「节点」页看到好认的名字，就填 `NODE_ID=hk-1` 这种，每台不同。

- 照抄主实例的 `.env` 也没关系：旧版本生成的 `.env` 里写着 `NODE_ID=main`，副实例会自动忽略这个名字（`main` 只给主实例用）。
- **不要连 `data` 目录一起复制到另一台**，否则两台会用同一个节点名。日志会报错提示，删掉复制过去的 `data/gemini-share-arxuan/node_id` 再重启即可。

**3. 授权**

所有服务器用**同一个** `LICENSE_KEY`。授权码默认只绑一个 IP，把每台副实例服务器的出口 IP 发给我登记成附加 IP（主实例管理台「节点」页能看到每台的出口 IP）。没登记的服务器会因为 IP 不符停止服务，不影响其他服务器。

**4. 确认**

打开主实例的管理台：

- 「节点」页能看到所有服务器、状态和最后心跳时间；
- 「对话记录」里有「节点」一列，能看出每段对话走的是哪台。

**注意事项**

- **建议所有账号都绑定代理**。
  - 没绑代理的账号，从哪台服务器转发，就用哪台的 IP 访问 Google。同一个号从多个 IP 访问更容易被风控。「节点」页会提示有几个号没绑代理。
  - 也可以在副实例的 `.env` 里加 `REPLICA_REQUIRE_PROXY=true`，让副实例只用绑了代理的号。
- **升级顺序：先升级主实例，再升级副实例。** 副实例比主实例新、需要新的数据库结构时，会先暂停服务（`/health` 返回 503），等主实例升级完自动恢复。
- **主实例挂了**：
  - 没有服务器刷新 Cookie，账号会逐渐失效。
  - 副实例在主实例消失 3 分钟后会自动下线：`/health` 返回 503，页面显示「服务维护中」。主实例恢复后，副实例自动恢复。
  - 想改这个时间，在副实例的 `.env` 里加 `PRIMARY_LOST_TIMEOUT=10m`，`0` 表示不下线。
- **主实例服务器坏了要换**：
  - 先确认原主实例已经停掉，再把某台副实例的 `.env` 改成 `NODE_ROLE=primary`，执行 `docker compose up -d`。它会接管成为主实例，管理台地址也换成这台。
  - 不小心同时开了两个 `primary`，后启动的会自动降级为副实例，不会两台同时刷新。

---

## 管理接口（可选）

> 大多数情况下不需要调用这些接口：管理台 `/admin/` 已经覆盖账号、代理、对话记录、设置等全部操作。下面只给想把管理操作集成进自己系统的场景参考。

全部是 `POST` + JSON body，鉴权头二选一（后台密码即 `ADMIN_PASSWORD`，没设置时是授权码）：

```
Authorization: Bearer <后台密码>
X-Admin-Token: <后台密码>
```

### 添加账号

`POST /api/admin/accounts/create`

```jsonc
{
  "cookie_header": "__Secure-1PSID=...; OSID=...; __Secure-OSID=...; SAPISID=...; ...",  // 完整 Cookie
  "name": "car-1",            // 可省，自动生成 10 位随机名
  "tier": "",                 // 可省 = 自动识别；或 free / pro / ultra
  "enabled": true,            // 可省，默认 true
  "proxy": "socks5://user:pass@ip:port",   // 可省 = 直连；支持 http / https / socks5 / socks5h
  "proxy_id": 3,              // 可省，引用代理池里的代理（优先于 proxy）
  "note": "备注"               // 可省
}
```

返回：

- `201 {"account": {...}, "matched": false, "email": "..."}`：新建；
- `200 {"account": {...}, "matched": true, "email": "..."}`：识别出是已有账号，已按更新处理；
- 识别不出邮箱（例如代理不通）时照常新建，并附带 `probe_error` 说明原因；
- 错误：`400 cookie_signed_out`（Cookie 已失效，未保存）、`409 account_name_taken`、`400 bad_request` / `proxy_not_found`。

### 编辑账号

`POST /api/admin/accounts/update`，只传要改的字段：

```jsonc
{
  "id": 1,
  "name": "car-1-renamed",
  "tier": "pro",
  "enabled": false,
  "proxy": "",               // 空字符串 = 改为直连；不传 = 不动
  "note": "...",
  "email": "abc@gmail.com",  // 手动指定 Google 邮箱（空字符串 = 清空）
  "cookie_header": "..."     // 换 Cookie，见下
}
```

- 不传 Cookie：只改资料，不影响登录状态；
- Cookie 里**带** `__Secure-1PSID`：视为换号，清空旧状态后用新 Cookie 重新登录；
- Cookie 里**不带** `__Secure-1PSID`（例如只补一个 `OSID=...`）：合并进现有 Cookie，不重置登录；
- 错误：`409 cookie_belongs_to_other_account`（这串 Cookie 属于另一个账号）、`409 account_email_taken`（邮箱已被其他账号使用）、`400 cookie_signed_out`。

### 批量添加 / 更新

```
POST /api/admin/accounts/batch-import         提交任务，立即返回 job
POST /api/admin/accounts/batch-import-status  查进度和逐行结果
```

```jsonc
// batch-import
{
  "cookies_text": "第一个号的完整 Cookie\n第二个号的完整 Cookie\n...",
  "mode": "smart",           // smart = 每个新号自动分配健康代理；不传则用 proxy_id / proxy，都不传 = 直连
  "enabled": true,
  "tier": "",
  "note": "11 月批次"
}
// batch-import-status
{ "job_id": "..." }          // 不传 job_id 返回最近一个任务
```

任务记录只保存在内存里（最近 20 个），网关重启后清空；已经处理完的行已经入库，不受影响。

### 其它账号接口

```
POST /api/admin/accounts/list       { "enabled": true, "q": "关键词" }   # q 匹配名称 / 备注 / 邮箱；返回含明文 Cookie
POST /api/admin/accounts/get        { "id": 1 }
POST /api/admin/accounts/delete     { "id": 1 }
POST /api/admin/accounts/bootstrap  { "id": 1 }     # 立即重新初始化
POST /api/admin/accounts/rotate     { "id": 1 }     # 立即换发一次 Cookie
POST /api/admin/accounts/batch-set-proxy  { "account_ids": [1,2], "mode": "smart" }   # mode: smart / fixed（带 proxy_id）/ clear
```

### 对话记录

网关会保存每位用户经过网关的对话，用于合规审查、客服回查。

```
POST /api/admin/turns/list     # 对话摘要列表（可按 user_id / account_id / conversation_id / q / model 过滤，limit / offset 分页）
POST /api/admin/turns/get      { "id": 123 }     # 详情，含每一轮的提问和回答全文
POST /api/admin/turns/delete   { "id": 123 }     # 删除一段对话及其全部消息
POST /api/admin/turns/cleanup  { "before_days": 90 }   # 删除 90 天前就不再活跃的对话
```

---

## 常见问题

**所有页面都返回 503**
授权校验没通过。确认 `.env` 里的 `LICENSE_KEY` 正确、这台服务器的公网 IP 已授权：`docker compose logs gemini-share-arxuan | grep -i license`。查出口 IP 用了多个公共接口互为备份，网络临时故障时 30 秒后自动重试。

**审计接口在哪改**
默认用户中心在管理台「设置 → 审计接口」改；其他站点的用户中心在「用户中心」页改。保存立即生效。

**两套单独部署的网关能不能合并成一套**
能，聊天记录完整保留，见[把另一套已经在用的网关合并进来](#把另一套已经在用的网关合并进来)。

**多用户中心和多实例有什么区别**
完全不同的两个功能：多用户中心是一套网关给多个站点用，多实例是多台服务器一起跑一个网关。见[多用户中心和多实例：两个不同的功能](#多用户中心和多实例两个不同的功能)。

**账号标「需补 OSID」/ 被自动停用 / 标「疑似掉线」**
重新登录浏览器，导出包含 `OSID` 的完整 Cookie，用「批量加号 / 更新」粘进去即可。

**想用域名 + HTTPS 访问**
在网关前面加 Nginx / Caddy 等反向代理，把你的域名转发到 `127.0.0.1:端口`，HTTPS 证书配在反向代理上。

**想用外部的 MySQL / Redis**
见[使用外部 MySQL / Redis](#使用外部-mysql--redis不启动自带实例)。

**数据在哪里、怎么备份**
全部在部署目录的 `data/` 下：`data/mysql`（账号、对话记录、设置）、`data/redis`（Cookie 和会话）、`data/gemini-share-arxuan`（静态资源缓存，可以不备份）。备份前先 `docker compose stop`。

**查看日志 / 重启**

```bash
docker compose logs -f --tail 200 gemini-share-arxuan
docker compose restart gemini-share-arxuan
```

**忘了后台密码**
看部署目录 `.env` 里的 `ADMIN_PASSWORD`；改了之后 `docker compose up -d` 生效。没设置时后台密码就是授权码。
