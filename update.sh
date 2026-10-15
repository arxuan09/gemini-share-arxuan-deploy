#!/usr/bin/env bash
# gemini-share-arxuan 更新：拉取最新镜像并重建网关容器（在部署目录内运行）
set -euo pipefail

[ -f docker-compose.yml ] || { echo "请在部署目录内运行（找不到 docker-compose.yml）"; exit 1; }

# 本产品的镜像仓库和 compose 服务名。清理只针对它，绝不动 mysql / redis 或这台机器上的其它镜像。
IMAGE_REPO="arxuan09/gemini-share-arxuan"
SERVICE="gemini-share-arxuan"

# 更新前 latest 指向哪个镜像。拉完新的之后这个旧镜像就没有标签了，
# 不删就会一直占着盘。
old_image_id="$(docker image inspect --format '{{.Id}}' "${IMAGE_REPO}:latest" 2>/dev/null || true)"

docker compose pull "$SERVICE"

# 静态缓存（v1.0.41 起）写在容器的 /data/static-cache。容器以 app 用户（100:101）运行，
# docker 自动建的宿主目录属主是 root，不交给它的话缓存只能放容器临时目录、重启就丢。
mkdir -p data/gemini-share-arxuan
chown 100:101 data/gemini-share-arxuan 2>/dev/null \
  || echo "提示：无法修改 data/gemini-share-arxuan 的属主（需要 root），静态缓存在容器重启后会丢失。"

docker compose up -d "$SERVICE"
docker compose ps

# 清理放在容器起来之后：新版本没能启动时，旧镜像还在，可以直接回滚。
new_image_id="$(docker image inspect --format '{{.Id}}' "${IMAGE_REPO}:latest" 2>/dev/null || true)"

removed=0
remove_image() {
  # docker 会拒绝删除仍被容器引用的镜像，这正是我们要的保护：
  # 万一新容器没起来、还在用旧镜像，这里删不掉，脚本也不会中断。
  if docker image rm "$1" >/dev/null 2>&1; then
    removed=$((removed + 1))
  fi
}

if [ -n "$old_image_id" ] && [ "$old_image_id" != "$new_image_id" ]; then
  remove_image "$old_image_id"
fi

# 历次更新遗留的无标签旧镜像。只认「仓库摘要属于本产品」的那些：
# 本机自己构建的悬空镜像没有仓库摘要，别人的镜像摘要不是这个仓库，都不会被选中。
while read -r id; do
  [ -n "$id" ] || continue
  digests="$(docker image inspect "$id" --format '{{join .RepoDigests " "}}' 2>/dev/null || true)"
  case " $digests " in
    *" ${IMAGE_REPO}@"*) remove_image "$id" ;;
  esac
done < <(docker images -q --filter dangling=true 2>/dev/null || true)

# 有的 docker 版本会把丢了标签的镜像显示成「仓库名 + <none>」而不算悬空，一并收掉。
while read -r id; do
  [ -n "$id" ] || continue
  remove_image "$id"
done < <(docker images --format '{{.ID}} {{.Repository}}:{{.Tag}}' 2>/dev/null \
  | awk -v r="${IMAGE_REPO}:<none>" '$2==r {print $1}' || true)

if [ "$removed" -gt 0 ]; then
  echo "已清理 ${removed} 个旧镜像。"
fi
echo "更新完成。"
