# 执行手册：把一个网关实例合并进另一个实例（给 agent 用）

> 读者：在客户服务器上执行合并操作的 agent（人也可以照着做）。
> 适用场景：两套**单独部署**的网关（各有自己的数据库和聊天记录），要合并成一套，被合并的那套变成保留那套里的一个「用户中心」（多用户中心功能）。这和「多实例」（多台服务器跑同一个网关）是两回事。
> 本手册只讲怎么做、怎么检查、出错怎么退回。网关版本要求 1.0.56 及以上。

## 0. 你要完成什么

两台服务器上各有一套 gemini-share-arxuan 网关：

- **A = 保留的实例**。合并后继续运行，全程不停机。
- **B = 被合并的实例**。合并后 B 变成 A 里的一个「用户中心（租户）」，B 的网关下线。

合并完成的标准（全部满足才算完成）：

1. B 的用户访问 B 原来的域名，打到的是 A；用 B 的用户中心登录成功。
2. B 的用户能在 Gemini 左侧历史里看到合并前的对话，并且能接着聊。
3. B 的号都在 A 的号池里，绑的代理和原来一样（B 上直连的号除外，见 6.4），启用 / 停用状态和 B 一致；A 原有的号和 Cookie 没有被改动（6.4 里说明的 `no_email` 例外）。
4. B 的所有网关进程（含副实例）都已停止，并且不会被重启。B 的数据库和 Redis 数据原样保留（用于回滚）。
5. 你交给运营一份报告（模板见第 9 节）。

## 1. 安全规则（违反任何一条都要停下来问人）

1. **不要用号池的 Cookie 直接访问 Google**（浏览器、curl、脚本都不行）。所有和账号有关的操作都通过 A 网关的管理接口完成。用独立浏览器打开号池 Cookie 会触发 Cookie 轮换，号会掉线。
2. **同一个 Google 号在同一时间只能有一个网关在刷新。** 把 B 的号导入 A 之前，B 的网关必须已经停掉（第 5 步）。B 的网关一旦停了，在回滚之前不要再启动它。
3. **不要改 A 已有账号的 Cookie。** A 已经有的号（`plan` 标成 `matched`）不导入、不更新。批量导入只喂 `b_only_import.json` 里的号。唯一的例外：`no_email` 分组里的号，B 那边没记录邮箱，导入时才识别出来，有可能就是 A 已有的号，导入结果会是 `updated`，也就是 A 那个号的 Cookie 被换成了 B 的。这时 B 已经停机，同一个号只有 A 在刷新，不会冲突，可以接受，但要写进报告。
4. **只有这些步骤会写数据，执行前都要先得到人的明确同意**：
   - 停 B 的网关（开始停机）
   - 在 A 上建租户
   - 建代理和导入账号
   - `merge import --apply`
   - 切域名
   - 回滚
5. **敏感文件**：Cookie 文件、数据库导出文件、管理密码。
   - 文件权限设为 `600`，只放在本手册指定的目录里。
   - 报告和聊天里不要贴出它们的内容。
   - 收尾时按第 8 节删除。
6. 任何一步的输出和本手册写的「预期」不一致，先停下来，把实际输出摘要报告给人，不要自己猜着往下做。

## 2. 开始前向人要的信息

| 编号 | 信息 | 用途 |
|---|---|---|
| I1 | A、B 两台服务器的 SSH 登录方式 | 执行命令 |
| I2 | A、B 的部署目录（`docker-compose.yml` 和 `.env` 所在目录，下文记作 `$A_DIR` / `$B_DIR`） | 执行命令 |
| I3 | A 的管理后台密码（A 的 `.env` 里的 `ADMIN_PASSWORD`，没设置时是 `LICENSE_KEY`），下文记作 `$A_ADMIN` | 调 A 的管理接口 |
| I4 | 给 B 起的租户 key（小写字母、数字、`-`，建好后不能改，例如 `b`）和显示名，下文记作 `$TENANT` | 建租户 |
| I5 | B 的用户访问网关用的全部域名（B 有副实例时，包括所有副实例的域名） | 建租户、切域名 |
| I6 | B 的域名由谁、在哪里解析，nginx 和证书在哪台机器上；证书能不能复制到 A（或者能在 A 上用 DNS 验证申请） | 切域名 |
| I9 | B 的管理后台密码，下文记作 `$B_ADMIN` | 查 B 有没有副实例 |
| I7 | 允许的停机窗口 | 第 5 步开始停机 |
| I8 | 一个 B 用户中心的**测试 userToken**（最好有历史对话） | 验收 |

缺任何一项就先问，不要开始。

## 3. 预检（只读）

在 A 上执行：

```bash
cd $A_DIR
docker compose ps                                     # gemini-share-arxuan、mysql、redis 都是 healthy
PORT=$(grep -E '^GATEWAY_PORT=' .env | cut -d= -f2); PORT=${PORT:-19081}
curl -s http://127.0.0.1:$PORT/health
curl -s -X POST -H "Authorization: Bearer $A_ADMIN" http://127.0.0.1:$PORT/api/admin/nodes/list -d '{}' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); [print(n["id"], n["version"], "在线" if n["online"] else "离线") for n in d["nodes"]]'
curl -s -X POST -H "Authorization: Bearer $A_ADMIN" http://127.0.0.1:$PORT/api/admin/settings/get -d '{}' | grep -o '"turn_retention_days":[0-9]*'
```

- **预期**：服务都是 healthy；**A 的每一个在线节点**版本都 **≥ 1.0.56**。多租户和合并工具从这个版本开始有；还有旧版本节点在线时，A 会拒绝新建用户中心。
- 版本更低时**不要运行 `merge` 命令**：旧版本不认识这个子命令，会在容器里再启动一个网关。先让人决定是否升级 A（`git pull && ./update.sh`），升级后从第 3 步重新开始。
- 接口返回 401 说明 `$A_ADMIN` 不对；返回 404 说明版本低于 1.0.54，同样需要升级。
- `turn_retention_days` 大于 0 时，A 会自动删除超过这么多天的聊天记录，导入的 B 的老记录也会被删。告诉人，请他决定先把保留天数改成 0 或更大的值。`merge import` 也会检查这一点，有记录会被删时拒绝导入。

在 B 上执行：

```bash
cd $B_DIR
docker compose ps
docker exec gemini-share-arxuan-mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -N -e "SELECT VERSION()"' 2>/dev/null
grep -E '^(MYSQL_HOST|MYSQL_DATABASE|REDIS_HOST|REDIS_DB|GATEWAY_PORT)=' .env
BPORT=$(grep -E '^GATEWAY_PORT=' .env | cut -d= -f2); BPORT=${BPORT:-19081}
curl -s -X POST -H "Authorization: Bearer $B_ADMIN" http://127.0.0.1:$BPORT/api/admin/nodes/list -d '{}' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); [print(n["id"], n["role"], n["version"], n["egress_ip"], "在线" if n["online"] else "离线") for n in d["nodes"]]'
```

- 记下 B 的库名（`MYSQL_DATABASE`，默认 `gemini`，下文记作 `$B_DB`）和 `REDIS_DB`（默认 `0`，下文记作 `$B_RDB`）。
- 如果 B 的 `MYSQL_HOST` / `REDIS_HOST` 不是 `mysql` / `redis`，说明 B 用的是外部数据库。下面所有 `docker exec gemini-share-arxuan-mysql` / `-redis` 的命令都要改成直接连那个外部地址。先告诉人，再改。
- B 的网关版本低于 1.0.50 时，账号表里没有邮箱列，没法按邮箱对号。先让人把 B 升级到最新版，再等 10 分钟，让启动刷新把邮箱补上。
- `nodes/list` 返回 404 说明 B 低于 1.0.54，没有多实例，只有这一台。
- **列出了不止一个节点，说明 B 有副实例**。把每台副实例的服务器、部署目录和域名都问清楚，补进 I1 / I2 / I5。第 5 步要把它们全部停掉。

**备份（必须做）：**

```bash
# A 上
cd $A_DIR && mkdir -p backup && chmod 700 backup
docker exec gemini-share-arxuan-mysql sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --set-gtid-purged=OFF "$MYSQL_DATABASE"' > backup/a_before_merge.sql
ls -lh backup/a_before_merge.sql
```

- **预期**：文件不是空的，最后一行是 `-- Dump completed`（`tail -1` 看一下）。
- A 自带 MySQL 容器的环境变量里有 `MYSQL_DATABASE`；外部 MySQL 时，库名换成 `.env` 里的值。

## 4. 在 A 上建租户（写操作，先征得同意）

先在 B 上读出 B 的审计地址：

```bash
docker exec gemini-share-arxuan-mysql sh -c "mysql -uroot -p\"\$MYSQL_ROOT_PASSWORD\" -N $B_DB -e \"SELECT \\\`key\\\`, value FROM gemini_settings WHERE \\\`key\\\` IN ('audit_oauth_url','audit_limit_url','audit_notify_url','audit_unify_model_name')\"" 2>/dev/null
```

- OAuth 和 limit 地址如果是空的，说明 B 用的是本地兜底模式（测试用户）。合并工具不支持把本地测试用户迁成租户，**停下来报告**。

然后在 A 的管理台「用户中心」页点「新建用户中心」：
- 「标识」填 `$TENANT`，「名称」随意，「域名」填 I5（一行一个）。
- OAuth、limit、notify 地址照抄 B 的。B 的 `audit_unify_model_name` 是 `true` 时勾上「审计统一模型名」。
- 每个地址点一下「测试连接」，确认 OAuth 和 limit 都能连通。

也可以用接口建：

```bash
curl -s -X POST -H "Authorization: Bearer $A_ADMIN" http://127.0.0.1:$PORT/api/admin/tenants/create -d '{
  "tenant_key": "<TENANT>", "name": "<显示名>", "domains": ["<B 的域名>"],
  "oauth_url": "<B 的 OAuth>", "limit_url": "<B 的 limit>", "notify_url": "<B 的 notify，可空>",
  "unify_model_name": false, "enabled": true, "note": "从 B 实例合并"}'
```

- 返回「默认用户中心里已经有用户 ID 以「<TENANT>:」开头」时，换一个标识。

此时 B 的域名还解析在 B 上，A 上的这个租户暂时不会有人访问，不影响任何用户。

## 5. 冻结 B（写操作，开始停机，先征得同意）

B 有副实例时，**先在每台副实例上**执行下面的命令，最后再在 B 的主实例上执行。主实例上只停网关，MySQL / Redis 保持运行：

```bash
cd <这台的部署目录>
docker compose stop gemini-share-arxuan
docker update --restart=no gemini-share-arxuan            # 服务器重启后也不会自己起来
mv docker-compose.yml docker-compose.yml.merged-into-A    # 防止有人随手 docker compose up / ./update.sh 又把它拉起来
echo "这台网关已合并进 A（$(date '+%F %T')）。回滚步骤见合并报告，不要直接启动。" > MERGED_INTO_A.txt
docker ps --filter name=gemini-share-arxuan --format '{{.Names}} {{.Status}}'   # 网关不在运行（mysql / redis 在主实例上仍在运行）
```

- 改名以后，`docker compose` 命令在这个目录里就不能直接用了。后面需要操作 B 的 MySQL / Redis 时，一律用 `docker exec gemini-share-arxuan-mysql ...` / `docker exec gemini-share-arxuan-redis ...`。
- 让人关掉 B 上任何会自动执行 `update.sh` / `install.sh` 的定时任务。
- **从这一刻起，B 的用户无法使用，直到第 7 步切完域名。** 在报告里记下开始时间。
- 停掉以后，B 的 Redis 里的 Cookie 就是这些号最新的 Cookie。MySQL 里的冷备最多落后 60 秒，所以下面以 Redis 为准。

## 6. 导出、规划、导入

### 6.1 在 B 上导出数据库和 Cookie

```bash
cd $B_DIR && mkdir -p merge-export && chmod 700 merge-export
docker exec gemini-share-arxuan-mysql sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --set-gtid-purged=OFF "$MYSQL_DATABASE"' > merge-export/b.sql
tail -1 merge-export/b.sql                     # 应为 -- Dump completed ...

docker exec -e B_RDB=$B_RDB gemini-share-arxuan-redis sh -c '
  set -e
  [ -n "$REDIS_PASSWORD" ] && export REDISCLI_AUTH="$REDIS_PASSWORD"   # 没设密码时不能传空密码，否则 redis-cli 直接报错
  redis-cli -n "$B_RDB" --scan --pattern "gemini:account:*:cookies" > /tmp/keys
  for k in $(cat /tmp/keys); do
    id=${k#gemini:account:}; id=${id%:cookies}
    printf "%s\t%s\n" "$id" "$(redis-cli -n "$B_RDB" --raw GET "$k")"
  done
  echo "exported $(wc -l < /tmp/keys) keys" >&2' > merge-export/b_cookies.tsv
chmod 600 merge-export/*
wc -l merge-export/b_cookies.tsv               # 必须和上面打印的 exported 数一致，且大于 0
```

### 6.2 传到 A，并导入到临时库

```bash
# 从 B 传到 A（按实际 SSH 方式调整）
scp $B_DIR/merge-export/b.sql $B_DIR/merge-export/b_cookies.tsv <A服务器>:$A_DIR/backup/

# 在 A 上：把 B 的库导入一个临时库 gemini_merge_b
cd $A_DIR
docker exec gemini-share-arxuan-mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "CREATE DATABASE gemini_merge_b CHARACTER SET utf8mb4"'
docker exec -i gemini-share-arxuan-mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" gemini_merge_b' < backup/b.sql

# 合并工具在 A 的网关容器里跑，工作文件放在容器里能看到的 /data/merge
mkdir -p data/gemini-share-arxuan/merge
cp backup/b_cookies.tsv data/gemini-share-arxuan/merge/
sudo chown -R 100:101 data/gemini-share-arxuan/merge && chmod 700 data/gemini-share-arxuan/merge
```

在 A 的网关容器里，B 临时库的连接串（下文记作 `$SRC`）是：

```
root:<A 的 MYSQL_PASSWORD>@tcp(mysql:3306)/gemini_merge_b?charset=utf8mb4&parseTime=true
```

A 用外部 MySQL 时，换成外部地址。

### 6.3 检查和规划（只读）

```bash
M="docker exec gemini-share-arxuan /app/gemini-share merge"
$M inspect --source-dsn "$SRC" --source-cookies /data/merge/b_cookies.tsv
$M plan    --source-dsn "$SRC" --source-cookies /data/merge/b_cookies.tsv --out /data/merge/
```

- `inspect` 列出 B 的版本、各表行数、账号列表。把行数记进报告。
- `plan` 生成以下文件：
  - `account_map.csv`
  - `b_only_import.json`：B 独有的号，按原来绑的代理分组，每组带 Cookie
  - `b_proxies.json`
- 把汇总报给人，**等确认后再继续**：
  - `matched` 几个：A 已经有、不会导入，沿用 A 的 Cookie
  - `b_only` 几个：要导入 A
  - `no_email` 几个：导入时再识别（见安全规则 3 的例外）
  - `duplicate` 几个：B 里重复的号，不导入，映射到同一个号
  - `no_cookie` 几个：B 里没有 Cookie 的号
  - `cookies_from_mysql_backup` 不为 0：有号在导出文件里没有，用的是 MySQL 冷备（可能旧几十秒）。说明 6.1 的导出不完整，先查清楚
  - `import_groups` 里标着「直连」的分组：这些号在 B 上从 B 服务器的 IP 出去，导入后会改从 A 服务器的 IP 出去。问人要不要先给它们绑一个代理
- 特别注意：B 里有号在 A 里也有（matched），说明两边之前在共用同一批 Google 号，这批号的 Cookie 可能已经被两边互相冲掉过。报告里列出来，提醒运营合并后关注这些号的状态。

### 6.4 建代理、导入 B 独有的号（写操作，先征得同意）

读 `b_only_import.json`，对每个分组按下面的步骤做：

按文件里的顺序处理分组（`no_email` 的分组排在最后）。

1. **分组的代理**：
   - `a_proxy_id` 不为 0：A 里已经有 URL 完全相同（含账号密码）的代理，直接用这个编号。
   - `a_proxy_id` 为 0：新建一个，`POST /api/admin/proxies/create {"name": "<proxy_name>", "url": "<proxy_url>"}`，名称重名时加后缀 `-b`。**不要**按代理列表里脱敏后的地址（`url_masked`）去对，同一个 host:port 可能是不同的出口。
   - 建好后测活：`POST /api/admin/proxies/check {"id": <proxy_id>}`，返回里 `ok` 必须是 `true`，`egress_ip` 要和 B 上这个代理最近测出的出口 IP 一致（在 B 的临时库 `gemini_merge_b` 里查：`SELECT name, egress_ip FROM gemini_proxies`）。测不通常见的原因是代理只给 B 的服务器开了 IP 白名单，**停下来报告**，不要先导入。
2. **提交批量导入**：每次最多 200 行，超过就分几次提交：

```bash
curl -s -X POST http://127.0.0.1:<A端口>/api/admin/accounts/batch-import \
  -H "Authorization: Bearer $A_ADMIN" -H 'Content-Type: application/json' \
  --data-binary @<这一组的请求体文件>
# 请求体：{"cookies_text": "<这一组的 Cookie，一行一个>", "proxy_id": <id>, "enabled": <这一组的 enabled>, "note": "merged from <TENANT>"}
# 没有代理的分组不传 proxy_id：导入后从 A 服务器的 IP 直连（6.3 已经问过人）
```

3. **等任务完成**：提交返回的 `job.id` 就是任务编号。每 5 秒调一次 `POST /api/admin/accounts/batch-import-status {"job_id": "<job.id>"}`，直到 `job.status` 变成 `done`。
4. **检查逐行结果**：
   - `created`（新建），且提示里没有「没识别出是哪个 Google 号」：正常。
   - `created`，但提示「没识别出是哪个 Google 号」：探测没成功（多半是代理不通），号已经建了但很可能用不了。**停下来报告**。
   - `updated`（更新）：
     - 出现在 `no_email` 分组里：这个号在 A 里本来就有，按安全规则 3 的例外处理，记入报告。
     - 出现在其他分组里：邮箱对号漏掉了。**停下来报告**。
   - `failed`（失败）：这个号的 Cookie 已失效，记入报告，后面它会是 `unmapped`。
   - `skipped`（跳过）：同一批里有重复的号。记入报告。

请求体文件里有 Cookie，放在 `$A_DIR/backup/`，权限设为 600，用完即删。

### 6.5 定账号映射（只读）

```bash
$M finalize-map --source-dsn "$SRC" --source-cookies /data/merge/b_cookies.tsv --out /data/merge/
```

- 打印最终映射：每个 B 账号对应 A 的哪个编号。`unmapped` 的号上的对话能看、不能续聊。
- 把 `unmapped` 列表报给人。人可以让运营补 Cookie 后重新导入，再跑一次 `finalize-map`；也可以接受现状。

### 6.6 导入聊天记录（先预演，再写入）

```bash
$M import --tenant $TENANT --source-dsn "$SRC" --account-map /data/merge/account_map.csv            # 预演
```

- **预期**：没有冲突，映射表没有缺行，打印出将要导入的对话数、消息数、Gem 数，和 `inspect` 的行数一致。
- 有冲突或缺行时停下来报告。不要手改数据库绕过。常见的冲突：
  - 保留期：A 的聊天记录保留天数会删掉 B 的老记录。让人改 A 的设置。
  - B 自己配了用户中心：不支持合并，停下来。
  - `conversation_id` 已经存在：两边之前共用过同一批 Google 号。停下来报告。

预演通过、并得到人的同意后执行写入：

```bash
$M import --tenant $TENANT --source-dsn "$SRC" --account-map /data/merge/account_map.csv --apply
$M verify --tenant $TENANT --source-dsn "$SRC"
```

- **预期**：`verify` 显示每张表的行数都一致，抽查全部通过。
- 不通过时执行 `$M purge --tenant $TENANT --apply`，然后报告。不要重复导入。

## 7. 切域名（写操作，先征得同意）

1. **在 A 前面的 nginx（或其他反代）里加上 B 的域名**，转发到 A 的网关端口，并且必须带上 Host 头。
   - **证书**：DNS 还指向 B，A 没法用 HTTP 验证给 B 的域名申请证书。两种办法：把 B 的 nginx 用着的证书和私钥复制到 A（权限 600）；或者在 A 上用 DNS 验证申请。都做不到时，先只配 http，切完 DNS 再申请证书，第 2 步的检查改用 `http://`。问人选哪种。

```nginx
server {
    server_name <B 的域名>;
    # listen / ssl 配置照抄 A 现有的 server 块
    location / {
        proxy_pass http://127.0.0.1:<A 的网关端口>;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_read_timeout 600s;
    }
}
```

   先 `nginx -t`，再 reload。

2. **切换前，用 hosts 文件或 `curl --resolve` 把 B 的域名指到 A，先验证一遍：**

```bash
curl -s --resolve <B域名>:443:<A的IP> https://<B域名>/health   # 证书还没配好时临时加 -k
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' --resolve <B域名>:443:<A的IP> "https://<B域名>/api/login?user_token=<I8 测试 token>"
```

   **预期**：`/health` 返回 ok；一键登录返回 302/303，跳到选车页或 Gemini 页面。如果返回 403 提示页，说明这个域名没识别成租户 `$TENANT`，或者 B 的用户中心拒绝了这个 token，停下来查。

3. **把 B 域名的 DNS 改成 A 的 IP**（或者改 B 那边的 nginx，转发到 A）。等 DNS 生效：`dig +short <B域名>` 返回 A 的 IP。
4. **验收**（让人或你用浏览器操作。注意：用的是测试 userToken 登录网关，不是直接用号池 Cookie 访问 Google，所以不违反安全规则 1）：
   - 用测试 userToken 走一键登录，进入 Gemini；
   - 左侧历史里能看到这个用户合并前的对话；
   - 打开一段旧对话，发一句话，能正常回复；
   - A 管理台「对话记录」里按用户中心 `$TENANT` 筛选，能看到这段对话，节点和用户中心两列正确。
5. 在报告里记下停机结束时间。

## 8. 收尾

- **B 的网关保持停止**：第 5 步已经关掉自动重启，并把 compose 文件改了名。B 的 MySQL、Redis 和 `$B_DIR` 下的文件至少保留 7 天，用于回滚。到期后由人决定是否删除，你不要删。
- **删除敏感文件**：
  - A：`$A_DIR/backup/b_cookies.tsv`、`$A_DIR/backup/b.sql`、批量导入的请求体文件。`$A_DIR/data/gemini-share-arxuan/merge/` 等回滚期（7 天）过了再删，回滚时 `restore-cookies` 要用里面的 `account_map.csv`
  - B：`$B_DIR/merge-export/`

  `backup/a_before_merge.sql` 保留 7 天。
- **临时库 `gemini_merge_b`**：保留 7 天，供 `verify` 复查。到期后执行 `DROP DATABASE gemini_merge_b`，执行前要征得人同意。
- **观察 24 小时**：
  - A 管理台账号页里，导入的号有没有被自动停用；
  - 6.3 提到的 matched 号状态是否正常；
  - A 的日志里有没有 `audit` 相关报错：`docker compose logs --since 1h gemini-share-arxuan | grep -i audit`。

## 9. 回滚

先看清楚：第 6.4 步之后，A 已经在刷新导入的号，**B 自己 Redis 里的 Cookie 已经作废**（被 A 换发过）。直接启动 B，这些号会掉线。所以回滚一定要先把 A 手里最新的 Cookie 还给 B。

**通用步骤（在 6.4 之后的任何时候回滚都要做）：**

1. 在 A 上导出 A 手里这些号的最新 Cookie（只读）：

```bash
$M restore-cookies --source-dsn "$SRC" --source-cookies /data/merge/b_cookies.tsv --out /data/merge/
# 生成 /data/merge/b_restore_cookies.tsv（宿主机上是 $A_DIR/data/gemini-share-arxuan/merge/b_restore_cookies.tsv）
```

2. 在 A 管理台把第 6.4 步导入的号（备注是 `merged from <TENANT>`）**全部停用**，让 A 不再刷新它们。**停用之后**再执行第 3 步。
3. 把文件传到 B，写回 B 的 Redis：

```bash
docker exec -i -e B_RDB=$B_RDB gemini-share-arxuan-redis sh -c '
  [ -n "$REDIS_PASSWORD" ] && export REDISCLI_AUTH="$REDIS_PASSWORD"
  while IFS="	" read -r id json; do
    [ -n "$id" ] && printf "%s" "$json" | redis-cli -n "$B_RDB" -x SET "gemini:account:$id:cookies" >/dev/null
  done' < b_restore_cookies.tsv
```

4. 在 A 管理台停用用户中心 `$TENANT`。
5. 恢复 B：把 `docker-compose.yml.merged-into-A` 改回 `docker-compose.yml`，删掉 `MERGED_INTO_A.txt`，执行 `docker update --restart=unless-stopped gemini-share-arxuan`。先启动主实例的网关 `docker compose start gemini-share-arxuan`，确认 healthy 后再启动各副实例。

**在第 7 步切域名之前**回滚：另外执行 `$M purge --tenant $TENANT --apply`，删掉导入 A 的聊天记录。这时 B 的用户还没在 A 上产生过任何数据。

**切域名之后**回滚：先把 DNS / nginx 改回 B，等生效后再做通用步骤。**不要执行 purge**：purge 会删掉这个用户中心在 A 上的全部对话，包括合并后 B 的用户在 A 上新聊的。这些对话留在 A 上（用户中心已停用，没人能访问），B 那边看不到，在报告里写清楚有多少段（A 管理台「对话记录」按用户中心筛选、看更新时间）。

## 10. 报告模板

```
合并报告：<B 的名称> → <A 的名称>（租户 key：<TENANT>）
- A 版本：<x.y.z>   B 版本：<x.y.z>
- 停机：<开始时间> ～ <结束时间>（共 <N> 分钟）
- B 数据：对话 <n>，消息 <n>，Gem <n>，账号 <n>（其中有 Cookie 的 <n>）
- 账号：matched <n>（沿用 A，列出邮箱），导入 <n>，失败/unmapped <n>（列出 B 的名称和邮箱）
- 代理：新建 <n> 个（名称），沿用 <n> 个
- 导入：对话 <n> / 消息 <n> / Gem <n>，verify 结果：<通过 / 不通过及原因>
- 域名：<列表>，DNS / nginx 改动：<说明>
- 验收：一键登录 <通过/失败>，历史可见 <通过/失败>，续聊 <通过/失败>
- 保留到 <日期> 的回滚材料：B 服务器上的数据、A 的 backup/a_before_merge.sql、临时库 gemini_merge_b
- 需要人跟进的事项：<unmapped 账号、matched 号的状态观察等>
```

报告里不要出现 Cookie、管理密码、userToken。
