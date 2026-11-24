#!/usr/bin/env bash
# gemini-share-arxuan 一键部署（在部署目录内运行）：
#   1. 检查 Docker / Docker Compose
#   2. 没有 .env 时生成一份并引导填写（老版本升级：自动从 docker-compose.old.yml 读出原配置）
#   3. 准备数据目录、拉取镜像、启动
#   4. 等网关健康检查通过，打印访问地址
#
# 也可以免交互：LICENSE_KEY=xxx ADMIN_PASSWORD=xxx GATEWAY_PORT=19081 ./install.sh
# 重复运行是安全的：已有 .env 不会被覆盖，数据不会丢。
# 审计接口（用户中心）不在这里配置，部署后到管理台「设置 → 审计接口」填写。
set -euo pipefail

cd "$(dirname "$0")"

info() { printf '\033[32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[提示]\033[0m %s\n' "$*"; }
die()  { printf '\033[31m[错误]\033[0m %s\n' "$*" >&2; exit 1; }

# ---------- 1. 环境检查 ----------
command -v docker >/dev/null 2>&1 \
  || die "没有安装 Docker。可以用官方脚本安装：curl -fsSL https://get.docker.com | sh"
docker info >/dev/null 2>&1 \
  || die "无法连接 Docker（没启动，或当前用户没有权限）。请用 root 运行，或先 systemctl start docker"
docker compose version >/dev/null 2>&1 \
  || die "需要 Docker Compose v2（docker compose 命令）。请升级 Docker，或安装 docker-compose-plugin"
[ -f docker-compose.yml ] && [ -f .env.example ] \
  || die "请在部署目录内运行（找不到 docker-compose.yml / .env.example）"

# ---------- 2. 配置文件 .env ----------

# env_get KEY：读 .env 里 KEY 的值（去掉首尾引号）。
env_get() {
  [ -f .env ] || return 0
  sed -n "s/^$1=//p" .env | tail -n 1 | sed -e "s/^['\"]//" -e "s/['\"]$//"
}

# env_set KEY VALUE：写入 / 替换 .env 里的 KEY。值原样写入，不经过 sed 转义。
env_set() {
  local key=$1 value=$2 tmp
  tmp=$(mktemp)
  KEY="$key" VALUE="$value" awk '
    BEGIN { k = ENVIRON["KEY"]; v = ENVIRON["VALUE"]; done = 0 }
    index($0, k "=") == 1 { if (!done) { print k "=" v; done = 1 } ; next }
    { print }
    END { if (!done) print k "=" v }
  ' .env >"$tmp"
  cat "$tmp" >.env
  rm -f "$tmp"
}

# old_compose_get KEY：从老版本的 docker-compose.old.yml 里读环境变量（老版本配置直接写在 compose 里）。
old_compose_get() {
  [ -f docker-compose.old.yml ] || return 0
  sed -n "s/^[[:space:]]*$1:[[:space:]]*//p" docker-compose.old.yml | head -n 1 \
    | sed -e "s/[[:space:]]*$//" -e "s/^['\"]//" -e "s/['\"]$//"
}

is_tty() { [ -t 0 ] && [ -t 1 ]; }

# ask_secret KEY 提示语：不回显的输入（密码），回车保留当前值。
ask_secret() {
  local key=$1 prompt=$2 input
  read -r -s -p "$prompt: " input || true
  echo
  if [ -n "$input" ]; then env_set "$key" "$input"; fi
}

# ask KEY 提示语：交互式询问，回车保留当前值。
ask() {
  local key=$1 prompt=$2 cur input
  cur=$(env_get "$key")
  if [ -n "$cur" ]; then
    read -r -p "$prompt [当前：$cur，回车保留]: " input || true
  else
    read -r -p "$prompt: " input || true
  fi
  if [ -n "$input" ]; then env_set "$key" "$input"; fi
}

if [ -f .env ]; then
  info "使用已有的 .env（不会覆盖）"
else
  cp .env.example .env
  chmod 600 .env
  info "已生成 .env"

  if [ -f docker-compose.old.yml ]; then
    info "发现 docker-compose.old.yml，从老版本配置迁移"
    val=$(old_compose_get LICENSE_KEY)
    if [ -n "$val" ]; then env_set LICENSE_KEY "$val"; echo "    LICENSE_KEY 已迁移"; fi
    # 只认 ports 段里的「- "宿主端口:19081"」，别误匹配 GEMINI_GATEWAY_ADDR: 0.0.0.0:19081。
    old_port=$(grep -E '^[[:space:]]*-[[:space:]]*"?[0-9]+:19081"?[[:space:]]*$' docker-compose.old.yml \
      | head -n 1 | grep -oE '[0-9]+:19081' | cut -d: -f1 || true)
    if [ -n "$old_port" ]; then env_set GATEWAY_PORT "$old_port"; echo "    GATEWAY_PORT 已迁移（$old_port）"; fi
    # 数据库密码 / 时区不在 .env 模板里（compose 有默认值）。老部署改过的才写进 .env，
    # 否则数据库已按旧密码初始化，网关会连不上。
    val=$(old_compose_get MYSQL_ROOT_PASSWORD)
    if [ -n "$val" ] && [ "$val" != "gemini123" ]; then env_set MYSQL_PASSWORD "$val"; echo "    数据库密码已迁移"; fi
    val=$(old_compose_get TZ)
    if [ -n "$val" ] && [ "$val" != "Asia/Shanghai" ]; then env_set TZ "$val"; echo "    TZ 已迁移（$val）"; fi
    echo "    审计接口地址早已保存在数据库里，升级后不受影响"
  fi

  # 命令行传入的环境变量优先（免交互部署）
  for key in LICENSE_KEY ADMIN_PASSWORD GATEWAY_PORT; do
    if [ -n "${!key:-}" ]; then env_set "$key" "${!key}"; fi
  done

  if is_tty && [ ! -f docker-compose.old.yml ]; then
    echo
    echo "请填写配置（直接回车保留默认值，之后也可以编辑 .env 再重新运行本脚本）："
    ask LICENSE_KEY "授权码 LICENSE_KEY（必填）"
    ask_secret ADMIN_PASSWORD "后台密码（可选，回车跳过 = 用授权码登录后台）"
    ask GATEWAY_PORT "对外端口"
  fi
fi

# 兼容：v1.0.53 的 .env 里数据库密码叫 MYSQL_ROOT_PASSWORD，现在统一叫 MYSQL_PASSWORD。
if [ -n "$(env_get MYSQL_ROOT_PASSWORD)" ] && ! grep -q '^MYSQL_PASSWORD=' .env; then
  env_set MYSQL_PASSWORD "$(env_get MYSQL_ROOT_PASSWORD)"
  info "已把 .env 里的 MYSQL_ROOT_PASSWORD 改名为 MYSQL_PASSWORD"
fi

# 校验
[ -n "$(env_get LICENSE_KEY)" ] || die "LICENSE_KEY 还没填。请编辑 .env 填写后重新运行 ./install.sh"
for key in MYSQL_PORT REDIS_PORT REDIS_DB; do
  val=$(env_get "$key")
  case "$val" in *[!0-9]*) die "$key 必须是数字：$val" ;; esac
done
port=$(env_get GATEWAY_PORT); port=${port:-19081}
case "$port" in ''|*[!0-9]*) die "GATEWAY_PORT 必须是数字：$port" ;; esac

# ---------- 3. 启动 ----------
mkdir -p data/mysql data/redis data/gemini-share-arxuan
# 网关容器以 app 用户（100:101）运行；静态缓存目录要交给它，否则缓存只能放容器临时目录、重启就丢。
chown 100:101 data/gemini-share-arxuan 2>/dev/null \
  || warn "无法修改 data/gemini-share-arxuan 的属主（需要 root），静态缓存在容器重启后会丢失"

info "拉取镜像"
docker compose pull
info "启动服务"
docker compose up -d

# ---------- 4. 等待就绪 ----------
info "等待网关就绪（最多 3 分钟，首次启动要初始化数据库）"
ok=0
for _ in $(seq 1 90); do
  if curl -fsS -m 3 "http://127.0.0.1:${port}/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
docker compose ps
if [ "$ok" != 1 ]; then
  die "网关 3 分钟内没有就绪。查看日志：docker compose logs --tail 100 gemini-share-arxuan"
fi

# 授权校验在启动后异步进行（几秒到几十秒）。没通过时除 /health 外所有页面都返回 503。
info "等待授权校验"
licensed=0
for _ in $(seq 1 45); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "http://127.0.0.1:${port}/login" || true)
  if [ "$code" != "503" ] && [ "$code" != "000" ]; then licensed=1; break; fi
  sleep 2
done
if [ "$licensed" != 1 ]; then
  warn "授权校验还没通过（页面会返回 503）。请确认 .env 里的 LICENSE_KEY 正确、这台服务器的公网 IP 已授权，"
  warn "查看日志：docker compose logs --tail 50 gemini-share-arxuan | grep -i license"
  warn "改好 .env 后重新运行 ./install.sh 即可"
fi

ip=$(hostname -I 2>/dev/null | awk '{print $1}')
echo
info "部署完成"
if [ -n "$(env_get ADMIN_PASSWORD)" ]; then
  echo "    管理台：http://${ip:-服务器IP}:${port}/admin/   （用 .env 里的 ADMIN_PASSWORD 登录）"
else
  echo "    管理台：http://${ip:-服务器IP}:${port}/admin/   （用授权码 LICENSE_KEY 登录）"
fi
echo "    用户入口：http://${ip:-服务器IP}:${port}/"
echo "    下一步：1) 管理台「设置 → 审计接口」填写你的用户中心接口（不填 = 本地测试模式，仅供测试）"
echo "            2) 管理台「账号池」添加 Gemini 账号（号池默认是空的）"
if [ -f docker-compose.old.yml ]; then
  echo "    老版本配置已迁移到 .env，确认没问题后可以删除 docker-compose.old.yml"
fi
