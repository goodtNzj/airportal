#!/bin/bash

# AirPortal 服务管理脚本
# 用法: ./airportal.sh {start|stop|restart|status}

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$SCRIPT_DIR/.airportal.pid"
LOG_DIR="$SCRIPT_DIR/logs"
PORT=3000

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
    if check_port $PORT; then
        log_error "端口 $PORT 已被占用"
        exit 1
    fi

    # 创建日志目录
    mkdir -p "$LOG_DIR"

    log_info "正在启动服务..."

    # 单进程启动（前端+后端同一端口）
    cd "$SCRIPT_DIR/packages/server"
    pnpm dev > "$LOG_DIR/airportal.log" 2>&1 &
    SERVER_PID=$!

    # 保存 PID
    echo "$SERVER_PID" > "$PID_FILE"

    # 等待服务启动
    if wait_for_port $PORT; then
        log_info "服务启动成功!"
        echo ""
        echo "======================================"
        echo "  AirPortal: http://localhost:$PORT"
        echo "  API:       http://localhost:$PORT/api"
        echo "======================================"
        echo ""
        echo "日志文件: $LOG_DIR/airportal.log"
        echo "PID 文件: $PID_FILE"
    else
        log_error "服务启动失败，请检查日志"
        cat "$LOG_DIR/airportal.log"
        exit 1
    fi
}

# 停止服务
stop() {
    if ! is_running; then
        log_warn "服务未运行"
        lsof -ti:$PORT | xargs kill -9 2>/dev/null
        [ -f "$PID_FILE" ] && rm -f "$PID_FILE"
        exit 0
    fi

    log_info "正在停止服务..."

    # 停止主进程
    local pid=$(cat "$PID_FILE" 2>/dev/null)
    if [ -n "$pid" ]; then
        kill "$pid" 2>/dev/null
        sleep 1
        kill -9 "$pid" 2>/dev/null
    fi

    # 清理端口
    lsof -ti:$PORT | xargs kill -9 2>/dev/null

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

    if check_port $PORT; then
        echo -e "端口 ($PORT): ${GREEN}运行中${NC}"
        echo "访问地址: http://localhost:$PORT"
    else
        echo -e "端口 ($PORT): ${RED}未运行${NC}"
    fi

    echo "======================================"
    echo ""
}

# 查看日志
logs() {
    if [ -f "$LOG_DIR/airportal.log" ]; then
        tail -f "$LOG_DIR/airportal.log"
    else
        echo "日志文件不存在"
    fi
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
        logs
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
        echo "  logs     查看日志"
        exit 1
        ;;
esac
