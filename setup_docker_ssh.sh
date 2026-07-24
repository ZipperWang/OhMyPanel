#!/bin/bash
# 快速创建带 SSH + systemd 的 Ubuntu Docker 容器
# 用法: bash setup_docker_ssh.sh [容器名] [SSH端口]

CONTAINER_NAME="${1:-ubuntu-ssh}"
SSH_PORT="${2:-2222}"
IMAGE="ubuntu:latest"
TEMP_IMAGE="${CONTAINER_NAME}-with-systemd"

echo "==> 拉取镜像 $IMAGE"
docker pull "$IMAGE"

echo "==> 创建临时容器 $CONTAINER_NAME"
docker run -d \
  -p "$SSH_PORT:22" \
  -v /www/wwwroot/test:/www/wwwroot/test \
  --name "$CONTAINER_NAME" \
  "$IMAGE" sleep infinity

echo "==> 安装 systemd + openssh-server"
docker exec "$CONTAINER_NAME" bash -c "apt update && apt install -y systemd openssh-server"

echo "==> 配置 SSH"
docker exec "$CONTAINER_NAME" bash -c '
mkdir -p /run/sshd
sed -i "s/#PermitRootLogin.*/PermitRootLogin yes/" /etc/ssh/sshd_config
echo "root:root123" | chpasswd
'

echo "==> 停止容器并提交为新镜像"
docker stop "$CONTAINER_NAME"
docker commit "$CONTAINER_NAME" "$TEMP_IMAGE"
docker rm "$CONTAINER_NAME"

echo "==> 用 /sbin/init 重新启动容器（systemd 可用）"
docker run -d \
  -p "$SSH_PORT:22" \
  -v /www/wwwroot/test:/www/wwwroot/test \
  --cap-add SYS_ADMIN \
  --name "$CONTAINER_NAME" \
  "$TEMP_IMAGE" /sbin/init

echo ""
echo "==> 完成！连接命令："
echo "    ssh -p $SSH_PORT root@localhost"
echo "    密码: root123"
echo "    挂载目录: /www/wwwroot/test"
echo ""
echo "容器内现在可以使用 systemctl 了，例如："
echo "    systemctl start nginx"
echo "    systemctl start php8.1-fpm"
echo "    systemctl start mysql"
