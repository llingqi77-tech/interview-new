#!/usr/bin/env bash
# ECS 侧部署脚本（由 GitHub Actions 通过 SSH 调用，也可手动执行）
#
# 职责：拉新镜像 → 启动 → 健康检查 → 失败自动回滚到上一个镜像
#
# 用法：
#   ./deploy.sh <image>:<tag> <commit-sha>
#
# 依赖：docker / docker compose v2；同目录下有 docker-compose.yml、Caddyfile、app.env

set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/interview}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/healthz}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-90}"

IMAGE="${1:?用法: deploy.sh <image>:<tag> <commit-sha>}"
COMMIT="${2:-unknown}"

cd "$APP_DIR"

if [[ ! -f deploy.env ]]; then
  echo "[deploy] deploy.env 不存在，从模板创建"
  cat > deploy.env <<'EOF'
APP_IMAGE=
GIT_COMMIT=
DOMAIN=:80
EOF
fi

# 记录当前镜像，作为回滚目标
PREV_IMAGE="$(grep -E '^APP_IMAGE=' deploy.env | cut -d= -f2- || true)"
echo "[deploy] previous image: ${PREV_IMAGE:-<none>}"
echo "[deploy] new image:      $IMAGE (commit $COMMIT)"

if [[ -n "$PREV_IMAGE" && "$PREV_IMAGE" != "$IMAGE" ]]; then
  echo "$PREV_IMAGE" > .previous_image
fi

set_env() {
  local key="$1" value="$2"
  if grep -qE "^${key}=" deploy.env; then
    sed -i.bak -E "s|^${key}=.*|${key}=${value}|" deploy.env && rm -f deploy.env.bak
  else
    echo "${key}=${value}" >> deploy.env
  fi
}

set_env APP_IMAGE "$IMAGE"
set_env GIT_COMMIT "$COMMIT"

echo "[deploy] pulling..."
docker compose --env-file deploy.env pull app

echo "[deploy] starting..."
# --no-deps：数据库与 Caddy 不在每次发布时重建，caddy 单独在首次部署时起
docker compose --env-file deploy.env up -d --no-deps app
docker compose --env-file deploy.env up -d caddy

wait_healthy() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT))
  while (( SECONDS < deadline )); do
    # 容器内探测，绕开宿主网络与端口映射差异
    if docker compose --env-file deploy.env exec -T app \
         node -e "fetch('$HEALTH_URL').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
      return 0
    fi
    sleep 3
  done
  return 1
}

echo "[deploy] waiting for health (timeout ${HEALTH_TIMEOUT}s)..."
if wait_healthy; then
  echo "[deploy] ✅ healthy: $IMAGE"
  docker image prune -f --filter "until=168h" >/dev/null 2>&1 || true
  exit 0
fi

echo "[deploy] ❌ health check failed"
docker compose --env-file deploy.env logs --tail=120 app || true

if [[ -s .previous_image ]]; then
  ROLLBACK_IMAGE="$(cat .previous_image)"
  echo "[deploy] rolling back to $ROLLBACK_IMAGE"
  set_env APP_IMAGE "$ROLLBACK_IMAGE"
  docker compose --env-file deploy.env pull app || true
  docker compose --env-file deploy.env up -d --no-deps app || true
  if wait_healthy; then
    echo "[deploy] ↩️  rolled back and healthy again"
  else
    echo "[deploy] ‼️  rollback also unhealthy, manual intervention required"
  fi
else
  echo "[deploy] no previous image recorded, cannot roll back"
fi

exit 1
