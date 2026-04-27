#!/bin/bash

# AirPortal 打包脚本
# 用法: ./build.sh [version]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VERSION=${1:-"1.0.0"}
BUILD_DIR="$SCRIPT_DIR/dist"
PACKAGE_NAME="airportal-$VERSION"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
    echo -e "${BLUE}[STEP]${NC} $1"
}

# 清理构建目录
clean() {
    log_step "清理构建目录..."
    rm -rf "$BUILD_DIR"
    rm -rf "$SCRIPT_DIR/packages/server/dist"
    rm -rf "$SCRIPT_DIR/packages/web/dist"
}

# 安装依赖
install_deps() {
    log_step "安装依赖..."
    cd "$SCRIPT_DIR"
    pnpm install --frozen-lockfile
    if [ $? -ne 0 ]; then
        log_error "依赖安装失败"
        exit 1
    fi
}

# 生成 Prisma Client
generate_prisma() {
    log_step "生成 Prisma Client..."
    cd "$SCRIPT_DIR/packages/server"
    pnpm db:generate
    if [ $? -ne 0 ]; then
        log_error "Prisma Client 生成失败"
        exit 1
    fi
}

# 构建后端
build_server() {
    log_step "构建后端..."
    cd "$SCRIPT_DIR/packages/server"

    # TypeScript 编译
    pnpm tsc
    if [ $? -ne 0 ]; then
        log_error "后端构建失败"
        exit 1
    fi

    log_info "后端构建完成"
}

# 构建前端
build_web() {
    log_step "构建前端..."
    cd "$SCRIPT_DIR/packages/web"

    pnpm build
    if [ $? -ne 0 ]; then
        log_error "前端构建失败"
        exit 1
    fi

    log_info "前端构建完成"
}

# 创建部署包
create_package() {
    log_step "创建部署包..."

    mkdir -p "$BUILD_DIR/$PACKAGE_NAME"

    # 复制后端文件
    log_info "复制后端文件..."
    mkdir -p "$BUILD_DIR/$PACKAGE_NAME/server"
    cp -r "$SCRIPT_DIR/packages/server/dist" "$BUILD_DIR/$PACKAGE_NAME/server/"
    cp -r "$SCRIPT_DIR/packages/server/prisma" "$BUILD_DIR/$PACKAGE_NAME/server/"
    cp "$SCRIPT_DIR/packages/server/package.json" "$BUILD_DIR/$PACKAGE_NAME/server/"

    # 复制前端文件
    log_info "复制前端文件..."
    mkdir -p "$BUILD_DIR/$PACKAGE_NAME/web"
    cp -r "$SCRIPT_DIR/packages/web/dist" "$BUILD_DIR/$PACKAGE_NAME/web/"

    # 复制配置文件
    log_info "复制配置文件..."
    cp "$SCRIPT_DIR/config.json" "$BUILD_DIR/$PACKAGE_NAME/"
    cp "$SCRIPT_DIR/.env.example" "$BUILD_DIR/$PACKAGE_NAME/.env.example"

    # 创建必要的目录
    mkdir -p "$BUILD_DIR/$PACKAGE_NAME/server/data"
    mkdir -p "$BUILD_DIR/$PACKAGE_NAME/server/uploads"
    mkdir -p "$BUILD_DIR/$PACKAGE_NAME/logs"

    # 创建启动脚本
    log_info "创建启动脚本..."
    cat > "$BUILD_DIR/$PACKAGE_NAME/start.sh" << 'EOF'
#!/bin/bash
cd "$(dirname "$0")"

# 复制环境变量示例（如果不存在）
if [ ! -f .env ]; then
    cp .env.example .env
    echo "已创建 .env 文件，请根据需要修改配置"
fi

# 初始化数据库
cd server
node dist/index.js
EOF
    chmod +x "$BUILD_DIR/$PACKAGE_NAME/start.sh"

    # 创建停止脚本
    cat > "$BUILD_DIR/$PACKAGE_NAME/stop.sh" << 'EOF'
#!/bin/bash
lsof -ti:3000 | xargs kill -9 2>/dev/null
echo "服务已停止"
EOF
    chmod +x "$BUILD_DIR/$PACKAGE_NAME/stop.sh"

    # 创建部署说明
    cat > "$BUILD_DIR/$PACKAGE_NAME/README.md" << EOF
# AirPortal 部署说明

## 版本
$VERSION

## 目录结构
\`\`\`
airportal/
├── server/          # 后端服务
│   ├── dist/        # 编译后的代码
│   ├── prisma/      # 数据库模型
│   ├── data/        # SQLite 数据库（自动创建）
│   └── uploads/     # 上传文件存储
├── web/             # 前端静态文件
├── logs/            # 日志目录
├── config.json      # 配置文件
├── .env             # 环境变量（需手动创建）
├── start.sh         # 启动脚本
└── stop.sh          # 停止脚本
\`\`\`

## 部署步骤

1. 安装 Node.js 18+
2. 安装依赖：
   \`\`\`bash
   cd server
   npm install --production
   \`\`\`

3. 复制并修改环境变量：
   \`\`\`bash
   cp .env.example .env
   # 编辑 .env 文件，修改 JWT_SECRET 等配置
   \`\`\`

4. 初始化数据库：
   \`\`\`bash
   npx prisma db push
   \`\`\`

5. 启动服务：
   \`\`\`bash
   ./start.sh
   # 或
   cd server && node dist/index.js
   \`\`\`

## 配置说明

编辑 \`config.json\` 或 \`.env\` 文件修改：
- 端口：PORT
- JWT 密钥：JWT_SECRET
- 取件码有效期：DEFAULT_EXPIRY
- 文件大小限制：MAX_FILE_SIZE
- 安全配置：FILE_VALIDATION, IP_BLACKLIST_ENABLED 等

## 访问地址

- 前端：http://localhost:5173 (开发模式)
- API：http://localhost:3000/api
- 健康检查：http://localhost:3000/api/health

## 生产部署建议

1. 使用 PM2 管理进程：
   \`\`\`bash
   npm install -g pm2
   pm2 start server/dist/index.js --name airportal
   \`\`\`

2. 使用 Nginx 反向代理：
   \`\`\`nginx
   server {
       listen 80;
       server_name your-domain.com;

       location / {
           root /path/to/airportal/web;
           try_files \$uri \$uri/ /index.html;
       }

       location /api {
           proxy_pass http://127.0.0.1:3000;
           client_max_body_size 50M;
       }
   }
   \`\`\`

EOF

    log_info "部署包创建完成"
}

# 打包压缩
compress() {
    log_step "压缩部署包..."
    cd "$BUILD_DIR"

    tar -czvf "$PACKAGE_NAME.tar.gz" "$PACKAGE_NAME"
    if [ $? -ne 0 ]; then
        log_error "压缩失败"
        exit 1
    fi

    # 生成 SHA256 校验
    sha256sum "$PACKAGE_NAME.tar.gz" > "$PACKAGE_NAME.tar.gz.sha256"

    log_info "压缩包: $BUILD_DIR/$PACKAGE_NAME.tar.gz"
}

# 显示结果
show_result() {
    echo ""
    echo "======================================"
    echo "        构建完成"
    echo "======================================"
    echo ""
    echo "版本: $VERSION"
    echo "输出目录: $BUILD_DIR"
    echo ""
    echo "文件列表:"
    ls -lh "$BUILD_DIR/"
    echo ""
    echo "部署包大小:"
    du -sh "$BUILD_DIR/$PACKAGE_NAME"
    echo ""
}

# 主流程
main() {
    echo ""
    echo "======================================"
    echo "   AirPortal 构建脚本 v$VERSION"
    echo "======================================"
    echo ""

    clean
    install_deps
    generate_prisma
    build_server
    build_web
    create_package
    compress
    show_result

    log_info "构建完成！"
}

main
