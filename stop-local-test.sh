#!/bin/bash

# 停止本地测试环境脚本
echo "🛑 停止本地测试环境..."

# 停止后端服务器
if [ -f ".backend_pid" ]; then
    BACKEND_PID=$(cat .backend_pid)
    if kill -0 $BACKEND_PID 2>/dev/null; then
        echo "🔄 停止后端服务器 (PID: $BACKEND_PID)..."
        kill $BACKEND_PID
        rm .backend_pid
    else
        echo "⚠️ 后端服务器进程不存在"
        rm .backend_pid
    fi
else
    echo "🔍 查找后端服务器进程..."
    pkill -f "node server.js"
fi

# 停止前端服务器
if [ -f ".frontend_pid" ]; then
    FRONTEND_PID=$(cat .frontend_pid)
    if kill -0 $FRONTEND_PID 2>/dev/null; then
        echo "🔄 停止前端服务器 (PID: $FRONTEND_PID)..."
        kill $FRONTEND_PID
        rm .frontend_pid
    else
        echo "⚠️ 前端服务器进程不存在"
        rm .frontend_pid
    fi
else
    echo "🔍 查找前端服务器进程..."
    pkill -f "python3 -m http.server"
fi

# 清理端口
echo "🧹 清理端口..."
lsof -ti :3001 | xargs kill -9 2>/dev/null
lsof -ti :8080 | xargs kill -9 2>/dev/null

echo "✅ 本地测试环境已停止"
echo ""
echo "💡 提示: 如果仍有进程运行，可以手动停止:"
echo "   pkill -f 'node server.js'"
echo "   pkill -f 'python3 -m http.server'" 