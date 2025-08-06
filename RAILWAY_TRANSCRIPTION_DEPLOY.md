# Railway语音转录部署指南

## 问题解决方案

### 原问题
Railway日志显示转录服务健康检查失败：
```
[ERROR] 转录服务健康检查失败: request to http://localhost:8000/health failed
```

这是因为Python转录服务没有正确部署到Railway，导致Node.js服务无法连接到`localhost:8000`。

### 解决方案
将转录功能集成到Node.js服务中，使用OpenAI Whisper API替代本地Whisper模型，实现真正的云端转录。

## 技术架构变更

### 之前（有问题的架构）
```
Railway部署:
├── Node.js服务 (主服务)
│   ├── 代理转录请求到Python服务
│   └── 静态文件服务
└── Python转录服务 (未正确部署)
    ├── FastAPI + OpenAI Whisper
    └── 需要大量计算资源
```

### 现在（修复后的架构）
```
Railway部署:
└── Node.js服务 (集成服务)
    ├── 直接调用OpenAI Whisper API
    ├── 转录结果处理和存储
    └── 静态文件服务
```

## 代码修改详情

### 1. 服务器端修改 (`server/server.js`)

#### 健康检查端点
```javascript
app.get('/api/transcription/health', async (req, res) => {
    try {
        const status = {
            status: 'ok',
            service: 'node-js-integrated',
            whisper_model: 'cloud-api',
            mongodb: isDbConnected ? 'connected' : 'disconnected',
            timestamp: new Date().toISOString()
        };
        
        logger.info('转录服务健康检查通过');
        res.json(status);
    } catch (error) {
        // 错误处理...
    }
});
```

#### 音频转录端点
```javascript
app.post('/api/transcription/audio', async (req, res) => {
    try {
        const audioFile = req.files.audio_file;
        
        // 使用OpenAI Whisper API进行转录
        const transcriptionResult = await transcribeWithOpenAI(audioFile);
        
        // 保存转录记录到数据库
        if (transcriptionResult.success && transcriptionResult.text) {
            // 保存逻辑...
        }
        
        res.json(transcriptionResult);
    } catch (error) {
        // 错误处理...
    }
});
```

#### OpenAI集成
```javascript
async function transcribeWithOpenAI(audioFile) {
    try {
        const openaiApiKey = process.env.OPENAI_API_KEY;
        
        // 没有API密钥时使用模拟模式
        if (!openaiApiKey) {
            return {
                success: true,
                text: '这是一段模拟的语音转录文本。请配置OPENAI_API_KEY以使用真实的语音转录功能。',
                language: 'zh',
                confidence: 0.8,
                service: 'mock'
            };
        }
        
        // 调用OpenAI Whisper API
        const formData = new FormData();
        formData.append('file', audioFile.data, {
            filename: audioFile.name,
            contentType: audioFile.mimetype
        });
        formData.append('model', 'whisper-1');
        formData.append('language', 'zh');
        formData.append('response_format', 'json');
        
        const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${openaiApiKey}`,
                ...formData.getHeaders()
            },
            body: formData
        });
        
        const result = await response.json();
        return {
            success: true,
            text: result.text || '',
            language: result.language || 'zh',
            confidence: 0.9,
            service: 'openai-whisper'
        };
    } catch (error) {
        // 错误处理...
    }
}
```

### 2. Railway配置修改 (`railway.toml`)

```toml
[build]
builder = "nixpacks"
buildCommand = "cd server && npm install"

[deploy]
startCommand = "node server/server.js"
healthcheckPath = "/health"
healthcheckTimeout = 300
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 10

[env]
NODE_ENV = "production"
LOG_LEVEL = "error"
PORT = "${{PORT}}"
OPENAI_API_KEY = "${{OPENAI_API_KEY}}"
```

**关键变更：**
- 移除了`TRANSCRIPTION_SERVICE_URL`
- 添加了`OPENAI_API_KEY`环境变量
- 保持`buildCommand = "cd server && npm install"`

## 环境变量配置

### Railway环境变量设置
在Railway控制台中设置以下环境变量：

1. **OPENAI_API_KEY** (必需)
   - 从OpenAI获取API密钥
   - 格式：`sk-...`
   - 用于调用Whisper API

2. **MONGODB_URI** (已有)
   - MongoDB数据库连接字符串

3. **DEEPBRICKS_API_KEY** (已有)
   - AI对话功能的API密钥

### 本地开发环境
创建`.env`文件（不要提交到git）：
```env
OPENAI_API_KEY=sk-your-openai-api-key-here
MONGODB_URI=mongodb://localhost:27017/vibe-meeting
NODE_ENV=development
```

## 部署流程

### 1. 删除Python服务文件（可选）
```bash
# 可以保留python-transcription-service目录作为参考
# 但它不再用于Railway部署
```

### 2. 提交代码到Railway
```bash
git add .
git commit -m "集成OpenAI Whisper API到Node.js服务，修复转录功能"
git push
```

### 3. 配置环境变量
在Railway控制台：
1. 进入项目设置
2. 添加`OPENAI_API_KEY`环境变量
3. 重新部署服务

### 4. 验证部署
部署完成后，检查：
- `/health`端点应该显示`transcription_service: "openai-configured"`
- `/api/transcription/health`端点应该返回`status: "ok"`

## 功能特性

### 支持的功能
- ✅ 云端语音转录（OpenAI Whisper）
- ✅ 中文语音识别
- ✅ 转录历史存储
- ✅ 实时转录显示
- ✅ 模拟模式（未配置API密钥时）
- ✅ 错误处理和降级

### 成本优化
- **OpenAI Whisper API定价**：$0.006 per minute
- **Railway部署**：单一服务，降低资源消耗
- **按需调用**：只在用户实际录音时调用API

### 性能特点
- **延迟**：约1-3秒（取决于音频长度）
- **准确率**：高（OpenAI Whisper模型）
- **支持格式**：webm, mp3, mp4, wav等
- **语言支持**：主要优化中文，支持多语言

## 故障排除

### 1. 转录功能无响应
**检查步骤：**
```javascript
// 浏览器控制台检查
console.log('转录客户端:', window.transcriptionClient);
await window.transcriptionClient.testConnection();
```

### 2. API密钥问题
**错误：**`未配置OPENAI_API_KEY，使用模拟转录`

**解决：**
1. 获取OpenAI API密钥
2. 在Railway环境变量中配置
3. 重新部署服务

### 3. 音频格式不支持
**错误：**转录返回空结果

**解决：**
1. 检查音频文件格式
2. 确认文件大小不超过25MB
3. 查看服务器日志获取详细错误

### 4. 网络连接问题
**错误：**OpenAI API调用失败

**检查：**
1. Railway服务网络连接
2. OpenAI API服务状态
3. API密钥有效性和配额

## 后续优化建议

### 1. 成本控制
- 实现音频预处理（降噪、压缩）
- 添加音频时长限制
- 实现用户配额管理

### 2. 性能优化
- 实现音频流式传输
- 添加转录结果缓存
- 优化音频格式转换

### 3. 功能增强
- 支持实时语音识别
- 添加语音翻译功能
- 实现说话人识别

## 技术依赖

- **Node.js**: >=16.0.0
- **OpenAI API**: Whisper-1模型
- **Railway**: 云部署平台
- **MongoDB**: 数据存储
- **Express.js**: Web框架
- **form-data**: 文件上传处理