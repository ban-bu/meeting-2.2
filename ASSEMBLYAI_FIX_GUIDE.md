# AssemblyAI Universal-Streaming 修复指南

## 🔧 已修复的问题

### 1. WebSocket连接问题
- ✅ 修复了WebSocket URL格式和token认证方式
- ✅ 使用正确的Universal-Streaming v3 API格式
- ✅ 添加了详细的连接错误处理和日志

### 2. 连接状态管理
- ✅ 改进了连接状态验证逻辑
- ✅ 添加了自动重连和清理机制
- ✅ 增强了错误处理和超时机制

### 3. 音频数据传输
- ✅ 修复了前端音频数据格式转换
- ✅ 优化了服务器端音频数据处理
- ✅ 添加了音频数据发送的详细日志

## 🚀 Railway部署配置

### 环境变量设置
在Railway仪表板中设置以下环境变量：

```
ASSEMBLYAI_API_KEY=e6c02e532cc44f7ca1afce8427f69d59
NODE_ENV=production
LOG_LEVEL=info
```

### 部署步骤

1. **推送代码到Git仓库**
```bash
git add .
git commit -m "fix: AssemblyAI Universal-Streaming连接和错误处理优化"
git push origin main
```

2. **在Railway中重新部署**
- 等待自动部署完成
- 检查部署日志确认没有错误

3. **验证环境变量**
- 确认`ASSEMBLYAI_API_KEY`已正确设置
- 检查Railway服务日志

## 🧪 测试步骤

### 本地测试
1. 启动服务器：`cd server && export ASSEMBLYAI_API_KEY=e6c02e532cc44f7ca1afce8427f69d59 && node server.js`
2. 访问：`http://localhost:3001`
3. 测试流式转录功能

### Railway测试
1. 访问Railway提供的URL
2. 点击流式转录按钮
3. 开始说话测试转录

## 📊 期望的日志输出

### 成功连接时：
```
[INFO] 🔑 使用API Key: e6c02e53...
[INFO] 🔗 尝试连接AssemblyAI: wss://streaming.assemblyai.com/v3/ws?token=***&...
[INFO] ✅ AssemblyAI Universal Streaming连接建立
[INFO] ✅ AssemblyAI客户端连接成功
[INFO] AssemblyAI Universal Streaming会话开始: [session-id]
```

### 转录过程中：
```
[DEBUG] 📊 收到音频数据: 8192 bytes from [socket-id]
[DEBUG] 🎵 发送音频数据到AssemblyAI: buffer=8192 bytes, base64=10922 chars
[DEBUG] 📤 发送转录结果给客户端 [socket-id]: {type: "Turn", transcript: "..."}
```

### 连接失败时：
```
[ERROR] ❌ AssemblyAI连接失败: [具体错误信息]
[ERROR] 详细错误信息: [JSON错误详情]
```

## 🔍 故障排除

### 如果仍然显示"客户端未连接"：

1. **检查Railway环境变量**
   - 确认`ASSEMBLYAI_API_KEY`正确设置
   - 检查是否有其他环境变量冲突

2. **查看Railway日志**
   - 查找连接错误信息
   - 检查WebSocket连接状态

3. **网络问题**
   - Railway服务器可能有网络限制
   - 尝试重新部署

### 常见错误代码：
- `code=1006`: 异常关闭，通常是网络问题
- `code=1002`: 协议错误，检查WebSocket格式
- `code=4001`: 认证失败，检查API Key

## 🎯 关键修复点

1. **WebSocket URL格式**：
   ```javascript
   // 修复前
   wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&encoding=pcm_s16le&format_turns=true&token=${apiKey}
   
   // 修复后  
   wss://streaming.assemblyai.com/v3/ws?token=${apiKey}&sample_rate=16000&encoding=pcm_s16le&format_turns=true
   ```

2. **连接状态验证**：
   - 添加了多层连接状态检查
   - 改进了错误处理和清理机制

3. **音频数据格式**：
   - 前端将ArrayBuffer转换为Array
   - 服务器端正确处理各种音频数据格式

现在AssemblyAI Universal-Streaming应该可以在Railway上正常工作！