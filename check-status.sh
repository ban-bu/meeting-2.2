#!/bin/bash

# 检查本地测试环境状态
echo "🔍 检查本地测试环境状态..."
echo ""

# 检查后端服务器
echo "📡 后端服务器状态:"
if lsof -i :3001 > /dev/null 2>&1; then
    BACKEND_PID=$(lsof -ti :3001 | head -1)
    echo "   ✅ 运行中 (PID: $BACKEND_PID)"
    
    # 测试健康检查
    if curl -s http://localhost:3001/health > /dev/null; then
        echo "   ✅ 健康检查通过"
        HEALTH_RESPONSE=$(curl -s http://localhost:3001/health)
        echo "   📊 响应: $HEALTH_RESPONSE"
    else
        echo "   ❌ 健康检查失败"
    fi
else
    echo "   ❌ 未运行"
fi

echo ""

# 检查前端服务器
echo "🌐 前端服务器状态:"
if lsof -i :8080 > /dev/null 2>&1; then
    FRONTEND_PID=$(lsof -ti :8080 | head -1)
    echo "   ✅ 运行中 (PID: $FRONTEND_PID)"
    
    # 测试前端响应
    if curl -s http://localhost:8080 > /dev/null; then
        echo "   ✅ 响应正常"
    else
        echo "   ❌ 响应失败"
    fi
else
    echo "   ❌ 未运行"
fi

echo ""

# 检查进程文件
echo "📁 进程文件状态:"
if [ -f ".backend_pid" ]; then
    BACKEND_PID_FILE=$(cat .backend_pid)
    if kill -0 $BACKEND_PID_FILE 2>/dev/null; then
        echo "   ✅ 后端PID文件有效 (PID: $BACKEND_PID_FILE)"
    else
        echo "   ⚠️ 后端PID文件无效 (PID: $BACKEND_PID_FILE)"
    fi
else
    echo "   ❌ 后端PID文件不存在"
fi

if [ -f ".frontend_pid" ]; then
    FRONTEND_PID_FILE=$(cat .frontend_pid)
    if kill -0 $FRONTEND_PID_FILE 2>/dev/null; then
        echo "   ✅ 前端PID文件有效 (PID: $FRONTEND_PID_FILE)"
    else
        echo "   ⚠️ 前端PID文件无效 (PID: $FRONTEND_PID_FILE)"
    fi
else
    echo "   ❌ 前端PID文件不存在"
fi

echo ""

# 总结
BACKEND_RUNNING=$(lsof -i :3001 > /dev/null 2>&1 && echo "true" || echo "false")
FRONTEND_RUNNING=$(lsof -i :8080 > /dev/null 2>&1 && echo "true" || echo "false")

if [ "$BACKEND_RUNNING" = "true" ] && [ "$FRONTEND_RUNNING" = "true" ]; then
    echo "🎉 本地测试环境运行正常！"
    echo ""
    echo "📱 访问地址:"
    echo "   前端应用: http://localhost:8080"
    echo "   后端API:  http://localhost:3001"
    echo ""
    echo "🧪 开始测试:"
    echo "   1. 打开浏览器访问 http://localhost:8080"
    echo "   2. 输入用户名和房间号"
    echo "   3. 测试语音通话功能"
    echo "   4. 在浏览器控制台运行 runAllTests() 进行自动化测试"
else
    echo "⚠️ 本地测试环境未完全启动"
    echo ""
    echo "💡 启动命令:"
    echo "   ./start-local-test.sh"
fi 