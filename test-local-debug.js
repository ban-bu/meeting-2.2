#!/usr/bin/env node

const http = require('http');

console.log('🧪 本地调试测试脚本');
console.log('==================');

// 测试后端服务器
function testBackend() {
    return new Promise((resolve, reject) => {
        const req = http.get('http://localhost:3001', (res) => {
            console.log('✅ 后端服务器状态:', res.statusCode);
            resolve(res.statusCode === 200);
        });
        
        req.on('error', (err) => {
            console.log('❌ 后端服务器连接失败:', err.message);
            reject(err);
        });
        
        req.setTimeout(5000, () => {
            console.log('❌ 后端服务器连接超时');
            reject(new Error('Timeout'));
        });
    });
}

// 测试前端服务器
function testFrontend() {
    return new Promise((resolve, reject) => {
        const req = http.get('http://localhost:8080', (res) => {
            console.log('✅ 前端服务器状态:', res.statusCode);
            resolve(res.statusCode === 200);
        });
        
        req.on('error', (err) => {
            console.log('❌ 前端服务器连接失败:', err.message);
            reject(err);
        });
        
        req.setTimeout(5000, () => {
            console.log('❌ 前端服务器连接超时');
            reject(new Error('Timeout'));
        });
    });
}

// 测试WebSocket连接
function testWebSocket() {
    return new Promise((resolve, reject) => {
        const WebSocket = require('ws');
        const ws = new WebSocket('ws://localhost:3001');
        
        ws.on('open', () => {
            console.log('✅ WebSocket连接成功');
            ws.close();
            resolve(true);
        });
        
        ws.on('error', (err) => {
            console.log('❌ WebSocket连接失败:', err.message);
            reject(err);
        });
        
        ws.on('close', () => {
            console.log('🔌 WebSocket连接已关闭');
        });
        
        setTimeout(() => {
            console.log('❌ WebSocket连接超时');
            reject(new Error('WebSocket Timeout'));
        }, 5000);
    });
}

// 运行所有测试
async function runTests() {
    console.log('\n🔍 开始测试...\n');
    
    try {
        await testBackend();
        await testFrontend();
        await testWebSocket();
        
        console.log('\n🎉 所有测试通过！');
        console.log('\n📋 访问地址:');
        console.log('   后端API: http://localhost:3001');
        console.log('   前端界面: http://localhost:8080');
        console.log('\n💡 调试提示:');
        console.log('   - 打开浏览器访问 http://localhost:8080');
        console.log('   - 设置用户名并加入房间');
        console.log('   - 测试实时聊天功能');
        console.log('   - 测试语音通话功能');
        console.log('   - 测试AI助手功能');
        
    } catch (error) {
        console.log('\n❌ 测试失败:', error.message);
        console.log('\n🔧 故障排除:');
        console.log('   1. 检查端口是否被占用');
        console.log('   2. 检查防火墙设置');
        console.log('   3. 重启服务器');
    }
}

runTests(); 