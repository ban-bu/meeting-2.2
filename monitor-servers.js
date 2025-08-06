#!/usr/bin/env node

const http = require('http');
const WebSocket = require('ws');

console.log('📊 服务器状态监控');
console.log('================');

let backendStatus = false;
let frontendStatus = false;
let websocketStatus = false;

// 检查后端服务器
function checkBackend() {
    const req = http.get('http://localhost:3001', (res) => {
        backendStatus = res.statusCode === 200;
        updateStatus();
    });
    
    req.on('error', () => {
        backendStatus = false;
        updateStatus();
    });
    
    req.setTimeout(3000, () => {
        backendStatus = false;
        updateStatus();
    });
}

// 检查前端服务器
function checkFrontend() {
    const req = http.get('http://localhost:8080', (res) => {
        frontendStatus = res.statusCode === 200;
        updateStatus();
    });
    
    req.on('error', () => {
        frontendStatus = false;
        updateStatus();
    });
    
    req.setTimeout(3000, () => {
        frontendStatus = false;
        updateStatus();
    });
}

// 检查WebSocket连接
function checkWebSocket() {
    const ws = new WebSocket('ws://localhost:3001');
    
    ws.on('open', () => {
        websocketStatus = true;
        updateStatus();
        ws.close();
    });
    
    ws.on('error', () => {
        websocketStatus = false;
        updateStatus();
    });
    
    setTimeout(() => {
        if (ws.readyState === WebSocket.CONNECTING) {
            websocketStatus = false;
            updateStatus();
            ws.close();
        }
    }, 3000);
}

// 更新状态显示
function updateStatus() {
    console.clear();
    console.log('📊 服务器状态监控');
    console.log('================');
    console.log('');
    console.log(`🔧 后端服务器: ${backendStatus ? '✅ 运行中' : '❌ 停止'}`);
    console.log(`🎨 前端服务器: ${frontendStatus ? '✅ 运行中' : '❌ 停止'}`);
    console.log(`🔌 WebSocket: ${websocketStatus ? '✅ 连接正常' : '❌ 连接失败'}`);
    console.log('');
    
    if (backendStatus && frontendStatus && websocketStatus) {
        console.log('🎉 所有服务正常运行！');
        console.log('');
        console.log('📋 访问地址:');
        console.log('   🌐 前端界面: http://localhost:8080');
        console.log('   🔧 后端API: http://localhost:3001');
        console.log('');
        console.log('💡 功能测试:');
        console.log('   - 实时聊天');
        console.log('   - 语音通话');
        console.log('   - AI助手');
        console.log('   - 文件上传');
        console.log('   - 语音转录');
    } else {
        console.log('⚠️  部分服务异常，请检查:');
        if (!backendStatus) console.log('   - 后端服务器未启动');
        if (!frontendStatus) console.log('   - 前端服务器未启动');
        if (!websocketStatus) console.log('   - WebSocket连接失败');
    }
    
    console.log('');
    console.log('⏰ 最后更新:', new Date().toLocaleTimeString());
    console.log('按 Ctrl+C 退出监控');
}

// 定期检查
setInterval(() => {
    checkBackend();
    checkFrontend();
    checkWebSocket();
}, 5000);

// 初始检查
checkBackend();
checkFrontend();
checkWebSocket();

// 优雅退出
process.on('SIGINT', () => {
    console.log('\n🛑 监控已停止');
    process.exit(0);
}); 