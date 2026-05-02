#!/bin/bash

# AirPortal 一键部署脚本
# 用法: ./deploy.sh [install-dir]
# 示例: ./deploy.sh /opt/airportal

set -e

# 配置变量
DEFAULT_INSTALL_DIR="/opt/airportal"
INSTALL_DIR="${1:-$DEFAULT_INSTALL_DIR}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=3000

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step() { echo -e "${BLUE}[STEP]${NC} $1"; }

# 检查是否为 root 用户
check_root() {
    if [ "$EUID" -eq 0 ]; then
        log_warn "不建议使用 root 用户运行此脚本"
        read -p "是否继续? (y/N) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
}

# 检测操作系统
detect_os() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS=$ID
        OS_VERSION=$VERSION_ID
    elif [ -f /etc/redhat-release ]; then
        OS="centos"
    else
        OS="unknown"
    fi
    log_info "检测到操作系统: $OS $OS_VERSION"
}

# 检查命令是否存在
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# 安装 Node.js
install_nodejs() {
    if command_exists node; then
        NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$NODE_VERSION" -ge 18 ]; then
            log_info "Node.js $(node -v) 已安装"
            return 0
        else
            log_warn "Node.js 版本过低 (需要 18+)，正在升级..."
        fi
    fi

    log_step "安装 Node.js 20.x..."

    case $OS in
        ubuntu|debian)
            curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
            sudo apt install -y nodejs
            ;;
        centos|rhel|rocky|almalinux)
            curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
            sudo yum install -y nodejs
            ;;
        *)
            log_error "不支持的操作系统: $OS"
            log_error "请手动安装 Node.js 20+"
            exit 1
            ;;
    esac

    log_info "Node.js $(node -v) 安装完成"
}

# 安装 pnpm
install_pnpm() {
    if command_exists pnpm; then
        log_info "pnpm $(pnpm -v) 已安装"
        return 0
    fi

    log_step "安装 pnpm..."
    npm install -g pnpm
    log_info "pnpm $(pnpm -v) 安装完成"
}

# 安装 PM2
install_pm2() {
    if command_exists pm2; then
        log_info "PM2 $(pm2 -v) 已安装"
        return 0
    fi

    log_step "安装 PM2..."
    npm install -g pm2
    log_info "PM2 安装完成"
}

# 创建安装目录
create_install_dir() {
    log_step "创建安装目录: $INSTALL_DIR"

    sudo mkdir -p "$INSTALL_DIR"
    sudo chown "$USER:$USER" "$INSTALL_DIR"

    # 创建子目录
    mkdir -p "$INSTALL_DIR"/{data,uploads,logs}
}

# 复制项目文件
copy_files() {
    log_step "复制项目文件..."

    # 如果是 git 仓库，使用 git clone
    if [ -d "$SCRIPT_DIR/.git" ]; then
        # 检查是否已存在
        if [ -d "$INSTALL_DIR/.git" ]; then
            cd "$INSTALL_DIR"
            git pull
        else
            # 复制整个目录
            cp -r "$SCRIPT_DIR"/* "$INSTALL_DIR/"
            cp "$SCRIPT_DIR"/.gitignore "$INSTALL_DIR/" 2>/dev/null || true
        fi
    else
        # 直接复制
        cp -r "$SCRIPT_DIR"/* "$INSTALL_DIR/"
    fi

    cd "$INSTALL_DIR"
}

# 配置环境变量
setup_env() {
    log_step "配置环境变量..."

    cd "$INSTALL_DIR"

    if [ -f "packages/server/.env" ]; then
        log_info ".env 文件已存在，跳过"
        return 0
    fi

    # 从示例文件复制
    if [ -f ".env.example" ]; then
        cp .env.example packages/server/.env
    else
        # 创建基本的 .env 文件
        cat > packages/server/.env << 'EOF'
# 服务配置
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# 数据库
DATABASE_URL=file:./data/airportal.db
EOF
    fi

    # 生成安全的 JWT 密钥
    JWT_SECRET=$(openssl rand -hex 32)

    # 更新 .env 文件
    if grep -q "JWT_SECRET=" packages/server/.env; then
        sed -i "s|JWT_SECRET=.*|JWT_SECRET=$JWT_SECRET|" packages/server/.env
    else
        echo "JWT_SECRET=$JWT_SECRET" >> packages/server/.env
    fi

    # 设置 NODE_ENV
    if grep -q "NODE_ENV=" packages/server/.env; then
        sed -i "s|NODE_ENV=.*|NODE_ENV=production|" packages/server/.env
    else
        echo "NODE_ENV=production" >> packages/server/.env
    fi

    log_info "JWT_SECRET 已自动生成"
}

# 安装依赖
install_dependencies() {
    log_step "安装项目依赖..."

    cd "$INSTALL_DIR"
    pnpm install --frozen-lockfile

    # 生成 Prisma Client
    log_step "生成 Prisma Client..."
    pnpm db:generate
}

# 初始化数据库
init_database() {
    log_step "初始化数据库..."

    cd "$INSTALL_DIR/packages/server"

    # 确保 data 目录存在
    mkdir -p data

    # 设置环境变量并初始化数据库
    export DATABASE_URL="file:./data/airportal.db"
    npx prisma db push --skip-generate 2>/dev/null || true

    log_info "数据库初始化完成"
}

# 构建项目
build_project() {
    log_step "构建项目..."

    cd "$INSTALL_DIR"
    pnpm build

    log_info "构建完成"
}

# 创建 systemd 服务（可选）
create_systemd_service() {
    log_step "创建 systemd 服务..."

    SERVICE_FILE="/etc/systemd/system/airportal.service"

    sudo bash -c "cat > $SERVICE_FILE" << EOF
[Unit]
Description=AirPortal - Secure File Transfer Service
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$INSTALL_DIR/packages/server/.env
ExecStart=$(which pnpm) start
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

    sudo systemctl daemon-reload
    sudo systemctl enable airportal

    log_info "systemd 服务已创建"
}

# 启动服务
start_service() {
    log_step "启动服务..."

    cd "$INSTALL_DIR"

    # 停止现有服务
    pm2 delete airportal 2>/dev/null || true
    sudo systemctl stop airportal 2>/dev/null || true

    # 使用 PM2 启动 (在 monorepo 根目录执行 pnpm start)
    pm2 start pnpm --name airportal -- start

    # 保存 PM2 配置
    pm2 save

    # 设置 PM2 开机自启
    pm2 startup | tail -1 | sudo bash || true

    log_info "服务已启动"
}

# 配置防火墙
setup_firewall() {
    log_step "配置防火墙..."

    if command_exists ufw; then
        sudo ufw allow 22/tcp   # SSH
        sudo ufw allow $PORT/tcp
        sudo ufw --force enable
        log_info "UFW 防火墙已配置"
    elif command_exists firewall-cmd; then
        sudo firewall-cmd --permanent --add-port=22/tcp
        sudo firewall-cmd --permanent --add-port=$PORT/tcp
        sudo firewall-cmd --reload
        log_info "Firewalld 防火墙已配置"
    else
        log_warn "未检测到防火墙，请手动配置"
    fi
}

# 显示部署结果
show_result() {
    # 获取服务器 IP
    SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || echo "YOUR_SERVER_IP")

    echo ""
    echo "======================================"
    echo "       AirPortal 部署完成!"
    echo "======================================"
    echo ""
    echo "安装目录: $INSTALL_DIR"
    echo "服务端口: $PORT"
    echo ""
    echo "访问地址:"
    echo "  http://$SERVER_IP:$PORT"
    echo ""
    echo "管理命令:"
    echo "  查看状态: pm2 status airportal"
    echo "  查看日志: pm2 logs airportal"
    echo "  重启服务: pm2 restart airportal"
    echo "  停止服务: pm2 stop airportal"
    echo ""
    echo "配置文件:"
    echo "  环境变量: $INSTALL_DIR/packages/server/.env"
    echo "  运行配置: $INSTALL_DIR/config.json"
    echo ""
    echo "数据目录:"
    echo "  数据库: $INSTALL_DIR/packages/server/data/"
    echo "  上传文件: $INSTALL_DIR/packages/server/uploads/"
    echo "  日志: $INSTALL_DIR/logs/"
    echo ""
}

# 主流程
main() {
    echo ""
    echo "======================================"
    echo "   AirPortal 一键部署脚本"
    echo "======================================"
    echo ""
    echo "安装目录: $INSTALL_DIR"
    echo ""

    check_root
    detect_os

    # 安装依赖
    install_nodejs
    install_pnpm
    install_pm2

    # 部署
    create_install_dir
    copy_files
    setup_env
    install_dependencies
    init_database
    build_project

    # 可选: 创建 systemd 服务
    read -p "是否创建 systemd 服务? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        create_systemd_service
    fi

    # 启动
    start_service

    # 配置防火墙
    read -p "是否配置防火墙? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        setup_firewall
    fi

    show_result
}

main "$@"
