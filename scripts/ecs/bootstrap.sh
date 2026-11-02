#!/usr/bin/env bash
# ECS 一次性初始化脚本（root 执行，只跑一次）
#
# 覆盖：Docker + compose 插件、防火墙、swap、日志轮转、应用目录、部署脚本
#
# 用法（在你的 ECS 上以 root 执行）：
#   curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/main/scripts/ecs/bootstrap.sh | bash
# 或先把仓库拉到机器上再执行：
#   bash scripts/ecs/bootstrap.sh
#
# 支持：Ubuntu 20.04+ / Debian 11+ / Alibaba Cloud Linux 3 / CentOS Stream 9

set -Eeuo pipefail

APP_DIR="/opt/interview"
APP_USER="deploy"
SWAP_SIZE="${SWAP_SIZE:-2G}"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

[[ $EUID -eq 0 ]] || { echo "必须以 root 执行"; exit 1; }

# ---------- 系统识别 ----------
. /etc/os-release
log "系统：$PRETTY_NAME"

# ---------- 时区 ----------
log "设置时区 Asia/Shanghai"
ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime || true
timedatectl set-timezone Asia/Shanghai 2>/dev/null || true

# ---------- swap（2G 内存的机器不放 swap，构建时会 OOM 杀掉 docker） ----------
if ! swapon --show | grep -q .; then
  log "创建 ${SWAP_SIZE} swap"
  fallocate -l "$SWAP_SIZE" /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  # 只在内存快满时才用 swap，别把 llm 请求挤到磁盘上
  sysctl -w vm.swappiness=10 >/dev/null
  grep -q 'vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf
else
  log "swap 已存在，跳过"
fi

# ---------- Docker ----------
if command -v docker >/dev/null 2>&1; then
  log "Docker 已安装：$(docker --version)"
else
  log "安装 Docker"
  install -m 0755 -d /etc/apt/keyrings 2>/dev/null || true
  if [[ -f /etc/debian_version ]]; then
    # 大陆机器优先走阿里云镜像，官方源会慢到超时
    if ! curl -fsS --max-time 6 -o /dev/null https://download.docker.com/linux/ubuntu/gpg; then
      log "官方源不可达，改用阿里云镜像"
      MIRROR="https://mirrors.aliyun.com/docker-ce"
    else
      MIRROR="https://download.docker.com"
    fi
    apt-get update -qq
    apt-get install -y -qq ca-certificates curl gnupg
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL "$MIRROR/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] $MIRROR/linux/${ID} ${VERSION_CODENAME} stable" \
      > /etc/apt/sources.list.d/docker.list
    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  else
    # Alibaba Cloud Linux / CentOS 系
    dnf install -y -q dnf-utils || yum install -y -q yum-utils
    dnf config-manager --add-repo https://mirrors.aliyun.com/docker-ce/linux/centos/docker-ce.repo 2>/dev/null \
      || yum-config-manager --add-repo https://mirrors.aliyun.com/docker-ce/linux/centos/docker-ce.repo
    dnf install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin \
      || yum install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi
  systemctl enable --now docker
fi

# 大陆 ECS 拉 docker hub 基本拉不动，配镜像加速（失效了就换，不要指望永久有效）
if [[ ! -f /etc/docker/daemon.json ]]; then
  log "配置 Docker 镜像加速与日志轮转"
  mkdir -p /etc/docker
  cat > /etc/docker/daemon.json <<'EOF'
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io",
    "https://dockerproxy.com",
    "https://mirror.ccs.tencentyun.com"
  ],
  "log-driver": "json-file",
  "log-opts": { "max-size": "20m", "max-file": "5" },
  "live-restore": true
}
EOF
  systemctl restart docker
fi

# ---------- 防火墙 ----------
log "放通 22 / 80 / 443"
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow 22/tcp >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 443/udp >/dev/null
elif command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld; then
  firewall-cmd --permanent --add-service=ssh >/dev/null
  firewall-cmd --permanent --add-service=http >/dev/null
  firewall-cmd --permanent --add-service=https >/dev/null
  firewall-cmd --add-port=443/udp >/dev/null
  firewall-cmd --reload >/dev/null
else
  echo "未检测到启用的本机防火墙；云厂商安全组必须单独放通 22/80/443"
fi

# ---------- 部署用户 ----------
if ! id "$APP_USER" >/dev/null 2>&1; then
  log "创建部署用户 $APP_USER"
  useradd -m -s /bin/bash "$APP_USER"
fi
usermod -aG docker "$APP_USER"
install -d -m 700 -o "$APP_USER" -g "$APP_USER" "/home/$APP_USER/.ssh"
touch "/home/$APP_USER/.ssh/authorized_keys"
chown "$APP_USER:$APP_USER" "/home/$APP_USER/.ssh/authorized_keys"
chmod 600 "/home/$APP_USER/.ssh/authorized_keys"

# ---------- 应用目录 ----------
log "准备 $APP_DIR"
install -d -m 755 -o "$APP_USER" -g "$APP_USER" "$APP_DIR"
cd "$APP_DIR"
for f in docker-compose.yml Caddyfile; do
  [[ -f "$f" ]] || { echo "缺少 $f —— 先把仓库里的这两个文件放到 $APP_DIR"; }
done
[[ -f deploy.env ]] || cat > deploy.env <<'EOF'
APP_IMAGE=
GIT_COMMIT=
DOMAIN=:80
EOF
# app.env 存密钥，权限收紧
[[ -f app.env ]] || { cat > app.env <<'EOF'
# 复制 .env.example 的键，填真实值。这个文件永远不进 git。
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.moonshot.cn/v1
DEEPSEEK_MODEL=kimi-k3
DEEPSEEK_TEMPERATURE=1
DEEPSEEK_MAX_TOKENS=32768
DEEPSEEK_REASONING=low
STEPFUN_API_KEY=
DATABASE_URL=
VITE_PARA_API_KEY=
VITE_CERT_ADDRESS=
VITE_ENVIO_GRAPHQL_URL=
EOF
}
chown "$APP_USER:$APP_USER" deploy.env app.env
chmod 600 app.env
chmod 644 deploy.env

if [[ -f scripts/ecs/deploy.sh ]]; then
  install -m 755 -o "$APP_USER" -g "$APP_USER" scripts/ecs/deploy.sh "$APP_DIR/deploy.sh"
fi

# ---------- 校验 ----------
log "环境自检"
docker --version
docker compose version
swapon --show || true
df -h / | tail -1
free -h | head -2

cat <<EOF

初始化完成。接下来：

1) 把 CI 的 SSH 公钥追加到部署用户：
     echo '<公钥>' >> /home/$APP_USER/.ssh/authorized_keys

2) 填 $APP_DIR/app.env 里的密钥（权限已是 600，不进 git）

3) 首个镜像需要先推到仓库，之后由 GitHub Actions 自动发布：
     cd $APP_DIR && ./deploy.sh <image>:<tag> <commit>

4) 有域名后把 $APP_DIR/deploy.env 里的 DOMAIN 改成你的域名，Caddy 会自动签证书：
     sed -i 's|^DOMAIN=.*|DOMAIN=interview.example.com|' $APP_DIR/deploy.env
     docker compose --env-file deploy.env up -d caddy

5) 云厂商安全组另行放通 80/443（本机防火墙已放通不代表安全组放通）
EOF
