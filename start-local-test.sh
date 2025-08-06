#!/bin/bash

echo "🚀 启动本地测试服务器..."
echo "📞 语音通话修复已应用："
echo "   ✅ 连接超时时间从30秒减少到15秒"
echo "   ✅ Railway环境直接使用WebSocket连接"
echo "   ✅ 重连延迟从2秒减少到1秒"
echo "   ✅ 添加微信群聊式通话状态提示"
echo "   ✅ 改进来电提示模态框显示"
echo ""

# 检查Node.js是否安装
if ! command -v node &> /dev/null; then
    echo "❌ Node.js未安装，请先安装Node.js"
    exit 1
fi

# 检查端口是否被占用
if lsof -Pi :3001 -sTCP:LISTEN -t >/dev/null ; then
    echo "⚠️  端口3001已被占用，正在停止现有进程..."
    pkill -f "node.*server.js"
    sleep 2
fi

# 启动服务器
echo "🔧 启动后端服务器..."
cd server
npm install
node server.js &
SERVER_PID=$!

echo "✅ 后端服务器已启动 (PID: $SERVER_PID)"
echo "🌐 服务器地址: http://localhost:3001"

# 等待服务器启动
sleep 3

# 启动前端
echo "🎨 启动前端服务器..."
cd ..
python3 -m http.server 8080 &
FRONTEND_PID=$!

echo "✅ 前端服务器已启动 (PID: $FRONTEND_PID)"
echo "🌐 前端地址: http://localhost:8080"

echo ""
echo "📋 测试步骤："
echo "1. 打开浏览器访问 http://localhost:8080"
echo "2. 设置用户名并加入房间"
echo "3. 在另一个浏览器窗口打开相同地址，使用不同用户名"
echo "4. 测试语音通话功能："
echo "   - 点击通话按钮发起通话"
echo "   - 检查是否显示微信群聊式通话提示"
echo "   - 测试来电提示模态框"
echo "   - 测试接听/拒绝功能"
echo "5. 检查连接速度是否改善"
echo ""
echo "🔧 调试工具："
echo "- 打开浏览器控制台查看连接状态"
echo "- 检查网络面板中的WebSocket连接"
echo ""

# 等待用户中断
echo "按 Ctrl+C 停止服务器"
trap "echo '🛑 正在停止服务器...'; kill $SERVER_PID $FRONTEND_PID 2>/dev/null; exit" INT

# 保持脚本运行
wait 