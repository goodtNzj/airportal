#!/bin/bash

# AirPortal 服务管理脚本
# 用法: ./airportal.sh {start|stop|restart|status}

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$SCRIPT_DIR/.airportal.pid"
LOG_DIR="$SCRIPT_DIR/logs"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查服务是否运行
is_running() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE" 2>/dev/null)
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            return 0
        fi
    fi
    return 1
}

# 检查端口是否被占用
check_port() {
    local port=$1
    if lsof -i:"$port" >/dev/null 2>&1; then
        return 0
    fi
    return 1
}

# 等待端口可用
wait_for_port() {
    local port=$1
    local max_wait=10
    local count=0
    while ! check_port "$port" && [ $count -lt $max_wait ]; do
        sleep 1
        count=$((count + 1))
    done
    if check_port "$port"; then
        return 0
    fi
    return 1
}

# 启动服务
start() {
    if is_running; then
        log_warn "服务已在运行中"
        exit 0
    fi

    # 检查端口
    if check_port 3000; then
        log_error "端口 3000 已被占用"
        exit 1
    fi
    if check_port 5173; then
        log_error "端口 5173 已被占用"
        exit 1
    fi

    # 创建日志目录
    mkdir -p "$LOG_DIR"

    log_info "正在启动服务..."

    # 启动后端
    cd "$SCRIPT_DIR/packages/server"
    pnpm dev > "$LOG_DIR/server.log" 2>&1 &
    BACKEND_PID=$!

    # 等待后端启动
    sleep 3

    # 启动前端
    cd "$SCRIPT_DIR/packages/web"
    pnpm dev > "$LOG_DIR/web.log" 2>&1 &
    FRONTEND_PID=$!

    # 保存主进程 PID（使用后端 PID 作为主 PID）
    echo "$BACKEND_PID" > "$PID_FILE"

    # 等待服务启动
    sleep 5

    if wait_for_port 3000 && wait_for_port 5173; then
        log_info "服务启动成功!"
        echo ""
        echo "======================================"
        echo "  前端: http://localhost:5173"
        echo "  后端: http://localhost:3000/api"
        echo "======================================"
        echo ""
        echo "日志目录: $LOG_DIR"
        echo "PID 文件: $PID_FILE"
    else
        log_error "服务启动失败，请检查日志"
        cat "$LOG_DIR/server.log"
        exit 1
    fi
}

# 停止服务
stop() {
    if ! is_running; then
        log_warn "服务未运行"
        # 清理可能残留的进程
        lsof -ti:3000 | xargs kill -9 2>/dev/null
        lsof -ti:5173 | xargs kill -9 2>/dev/null
        [ -f "$PID_FILE" ] && rm -f "$PID_FILE"
        exit 0
    fi

    log_info "正在停止服务..."

    # 停止所有相关进程
    lsof -ti:3000 | xargs kill -9 2>/dev/null
    lsof -ti:5173 | xargs kill -9 2>/dev/null

    # 清理 PID 文件
    rm -f "$PID_FILE"

    log_info "服务已停止"
}

# 重启服务
restart() {
    stop
    sleep 2
    start
}

# 查看状态
status() {
    echo ""
    echo "======================================"
    echo "           AirPortal 状态"
    echo "======================================"

    if is_running; then
        local pid=$(cat "$PID_FILE" 2>/dev/null)
        echo -e "状态: ${GREEN}运行中${NC}"
        echo "PID: $pid"
    else
        echo -e "状态: ${RED}已停止${NC}"
    fi

    echo ""

    # 检查后端
    if check_port 3000; then
        echo -e "后端 (3000): ${GREEN}运行中${NC}"
    else
        echo -e "后端 (3000): ${RED}未运行${NC}"
    fi

    # 检查前端
    if check_port 5173; then
        echo -e "前端 (5173): ${GREEN}运行中${NC}"
    else
        echo -e "前端 (5173): ${RED}未运行${NC}"
    fi

    echo "======================================"
    echo ""
}

# 查看日志
logs() {
    local service=$1
    case $service in
        server|backend)
            tail -f "$LOG_DIR/server.log"
            ;;
        web|frontend)
            tail -f "$LOG_DIR/web.log"
            ;;
        *)
            echo "用法: $0 logs {server|web}"
            exit 1
            ;;
    esac
}

# 主入口
case "$1" in
    start)
        start
        ;;
    stop)
        stop
        ;;
    restart)
        restart
        ;;
    status)
        status
        ;;
    logs)
        logs "$2"
        ;;
    *)
        echo "AirPortal 服务管理脚本"
        echo ""
        echo "用法: $0 {start|stop|restart|status|logs}"
        echo ""
        echo "命令:"
        echo "  start    启动服务"
        echo "  stop     停止服务"
        echo "  restart  重启服务"
        echo "  status   查看状态"
        echo "  logs     查看日志 (server|web)"
        exit 1
        ;;
esac
