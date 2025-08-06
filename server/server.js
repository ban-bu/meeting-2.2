const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const expressWs = require('express-ws');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const mongoose = require('mongoose');
const { RateLimiterMemory } = require('rate-limiter-flexible');
const fileUpload = require('express-fileupload');
const fetch = require('node-fetch');
const path = require('path');
const axios = require('axios');
const fs = require('fs-extra');
const WebSocket = require('ws');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// 初始化express-ws
expressWs(app, server);

// 速率限制器 - 调整为更宽松的设置，适应Railway环境
const rateLimiter = new RateLimiterMemory({
    keyPrefix: 'middleware',
    points: 5000, // 允许的请求次数 - 进一步增加到5000
    duration: 900, // 15分钟
    blockDuration: 120, // 被阻止后2分钟才能重试
});

// 日志控制 - 减少不必要的日志输出
const isProduction = process.env.NODE_ENV === 'production';
const logLevel = process.env.LOG_LEVEL || 'debug'; // 临时设置为debug以便调试

const logger = {
    info: (message) => {
        if (logLevel === 'info' || logLevel === 'debug') {
            console.log(`[INFO] ${message}`);
        }
    },
    warn: (message) => {
        if (logLevel === 'warn' || logLevel === 'info' || logLevel === 'debug') {
            console.warn(`[WARN] ${message}`);
        }
    },
    error: (message) => {
        console.error(`[ERROR] ${message}`);
    },
    debug: (message) => {
        if (logLevel === 'debug') {
            console.log(`[DEBUG] ${message}`);
        }
    }
};

// 中间件配置
app.use(helmet({
    contentSecurityPolicy: false // 允许内联脚本，适配前端需求
}));
app.use(compression());

// 动态CORS配置，支持Railway部署
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:8080',
    'https://*.railway.app',
    'https://*.up.railway.app'
];

app.use(cors({
    origin: (origin, callback) => {
        // 允许没有origin的请求（如移动应用）
        if (!origin) return callback(null, true);
        
        // 如果设置为*，允许所有来源
        if (allowedOrigins.includes('*')) {
            return callback(null, true);
        }
        
        // 检查是否在允许列表中
        const isAllowed = allowedOrigins.some(allowedOrigin => {
            if (allowedOrigin.includes('*')) {
                const regex = new RegExp(allowedOrigin.replace(/\*/g, '.*'));
                return regex.test(origin);
            }
            return allowedOrigin === origin;
        });
        
        if (isAllowed || process.env.NODE_ENV === 'development') {
            callback(null, true);
        } else {
            logger.warn('CORS blocked origin: ' + origin);
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST'],
    credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 文件上传中间件
app.use(fileUpload({
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB限制
    useTempFiles: true,
    tempFileDir: '/tmp/'
}));

// 静态文件服务 - 为Railway部署提供前端文件
app.use(express.static(path.join(__dirname, '..'), {
    index: 'index.html',
    setHeaders: (res, filePath) => {
        // 设置缓存头
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache');
        } else if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
            res.setHeader('Cache-Control', 'public, max-age=86400'); // 1天
        }
    }
}));

// Socket.IO配置 - 针对Railway环境优化
const io = socketIo(server, {
    cors: {
        origin: (origin, callback) => {
            logger.debug(`🔍 Socket.IO CORS检查 - Origin: ${origin}`);
            
            // 允许没有origin的请求（移动应用等）
            if (!origin) {
                logger.debug('✅ 允许无origin请求');
                return callback(null, true);
            }
            
            // Railway环境特殊处理
            if (origin.includes('railway.app') || origin.includes('up.railway.app')) {
                logger.debug('✅ Railway环境，允许访问');
                return callback(null, true);
            }
            
            const isAllowed = allowedOrigins.some(allowedOrigin => {
                if (allowedOrigin.includes('*')) {
                    const regex = new RegExp(allowedOrigin.replace(/\*/g, '.*'));
                    return regex.test(origin);
                }
                return allowedOrigin === origin;
            });
            
            if (isAllowed || process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'production') {
                logger.debug('✅ CORS检查通过');
                callback(null, true);
            } else {
                logger.warn(`❌ CORS blocked origin: ${origin}`);
                callback(new Error(`Not allowed by CORS: ${origin}`));
            }
        },
        methods: ['GET', 'POST'],
        credentials: true
    },
    maxHttpBufferSize: 1e7, // 10MB
    transports: ['polling'], // 本地环境使用polling避免WebSocket连接问题
    allowEIO3: true, // 向后兼容
    pingTimeout: 60000, // 60秒
    pingInterval: 25000, // 25秒
    upgradeTimeout: 30000, // 30秒升级超时
    allowUpgrades: true,
    // 添加Railway环境特殊配置
    path: '/socket.io/',
    serveClient: false,
    connectTimeout: 45000,
    // 修复WebSocket帧头问题 - 移除wsEngine配置避免版本冲突
    // wsEngine: 'ws'
});

// MongoDB连接
const connectDB = async () => {
    try {
        if (process.env.MONGODB_URI) {
            await mongoose.connect(process.env.MONGODB_URI);
            logger.info('MongoDB 连接成功');
        } else {
            logger.info('未配置数据库，使用内存存储');
        }
    } catch (error) {
        logger.error('MongoDB 连接失败: ' + error.message);
        logger.info('降级到内存存储模式');
    }
};

// 数据模型
const messageSchema = new mongoose.Schema({
    roomId: { type: String, required: true, index: true },
    type: { type: String, required: true },
    text: String,
    author: { type: String, required: true },
    userId: { type: String, required: true },
    time: { type: String, required: true },
    file: {
        name: String,
        size: String,
        type: String,
        url: String
    },
    originalFile: String,
    isAIQuestion: { type: Boolean, default: false }, // AI问题标记
    originUserId: String, // AI回复的触发用户ID
    timestamp: { type: Date, default: Date.now, expires: '30d' } // 30天后自动删除
});

const participantSchema = new mongoose.Schema({
    roomId: { type: String, required: true, index: true },
    userId: { type: String, required: true },
    name: { type: String, required: true },
    status: { type: String, default: 'online' },
    joinTime: { type: Date, default: Date.now },
    lastSeen: { type: Date, default: Date.now },
    socketId: String
});

const roomSchema = new mongoose.Schema({
    roomId: { type: String, required: true, unique: true },
    createdAt: { type: Date, default: Date.now },
    lastActivity: { type: Date, default: Date.now },
    participantCount: { type: Number, default: 0 },
    creatorId: { type: String, required: true }, // 房间创建者ID
    creatorName: { type: String, required: true }, // 房间创建者姓名
    settings: {
        maxParticipants: { type: Number, default: 50 },
        allowFileUpload: { type: Boolean, default: true },
        aiEnabled: { type: Boolean, default: true }
    }
});

// 创建索引以提高查询性能
messageSchema.index({ roomId: 1, timestamp: -1 });
participantSchema.index({ roomId: 1, userId: 1 }, { unique: true });

const Message = mongoose.models.Message || mongoose.model('Message', messageSchema);
const Participant = mongoose.models.Participant || mongoose.model('Participant', participantSchema);
const Room = mongoose.models.Room || mongoose.model('Room', roomSchema);

// 内存存储（数据库不可用时的降级方案）
const memoryStorage = {
    rooms: new Map(), // roomId -> { messages: [], participants: Map(), roomInfo: {} }
    
    getRoom(roomId) {
        if (!this.rooms.has(roomId)) {
            this.rooms.set(roomId, {
                messages: [],
                participants: new Map(),
                roomInfo: null // 房间信息（包含创建者）
            });
        }
        return this.rooms.get(roomId);
    },
    
    setRoomInfo(roomId, roomInfo) {
        const room = this.getRoom(roomId);
        room.roomInfo = roomInfo;
    },
    
    getRoomInfo(roomId) {
        const room = this.getRoom(roomId);
        return room.roomInfo;
    },
    
    addMessage(roomId, message) {
        const room = this.getRoom(roomId);
        room.messages.push(message);
        // 限制消息数量，避免内存溢出
        if (room.messages.length > 1000) {
            room.messages = room.messages.slice(-800);
        }
        return message;
    },
    
    getMessages(roomId, limit = 50) {
        const room = this.getRoom(roomId);
        return room.messages.slice(-limit);
    },
    
    addParticipant(roomId, participant) {
        const room = this.getRoom(roomId);
        room.participants.set(participant.userId, participant);
        return participant;
    },
    
    updateParticipant(roomId, userId, updates) {
        const room = this.getRoom(roomId);
        const participant = room.participants.get(userId);
        if (participant) {
            Object.assign(participant, updates);
        }
        return participant;
    },
    
    removeParticipant(roomId, userId) {
        const room = this.getRoom(roomId);
        return room.participants.delete(userId);
    },
    
    getParticipants(roomId) {
        const room = this.getRoom(roomId);
        return Array.from(room.participants.values());
    },
    
    findParticipantBySocketId(socketId) {
        for (const [roomId, room] of this.rooms) {
            for (const [userId, participant] of room.participants) {
                if (participant.socketId === socketId) {
                    return { ...participant, roomId };
                }
            }
        }
        return null;
    }
};

// 数据访问层
const dataService = {
    async saveMessage(messageData) {
        try {
            if (mongoose.connection.readyState === 1) {
                const message = new Message(messageData);
                await message.save();
                return message.toObject();
            } else {
                return memoryStorage.addMessage(messageData.roomId, messageData);
            }
        } catch (error) {
            logger.error('保存消息失败: ' + error.message);
            return memoryStorage.addMessage(messageData.roomId, messageData);
        }
    },
    
    async getMessages(roomId, limit = 50) {
        try {
            if (mongoose.connection.readyState === 1) {
                const messages = await Message
                    .find({ roomId })
                    .sort({ timestamp: -1 })
                    .limit(limit)
                    .lean();
                return messages.reverse();
            } else {
                return memoryStorage.getMessages(roomId, limit);
            }
        } catch (error) {
            logger.error('获取消息失败: ' + error.message);
            return memoryStorage.getMessages(roomId, limit);
        }
    },
    
    async saveParticipant(participantData) {
        try {
            if (mongoose.connection.readyState === 1) {
                const participant = await Participant.findOneAndUpdate(
                    { roomId: participantData.roomId, userId: participantData.userId },
                    participantData,
                    { upsert: true, new: true }
                );
                return participant.toObject();
            } else {
                return memoryStorage.addParticipant(participantData.roomId, participantData);
            }
        } catch (error) {
            logger.error('保存参与者失败: ' + error.message);
            return memoryStorage.addParticipant(participantData.roomId, participantData);
        }
    },
    
    async updateParticipant(roomId, userId, updates) {
        try {
            if (mongoose.connection.readyState === 1) {
                const participant = await Participant.findOneAndUpdate(
                    { roomId, userId },
                    { ...updates, lastSeen: new Date() },
                    { new: true }
                );
                return participant?.toObject();
            } else {
                return memoryStorage.updateParticipant(roomId, userId, { ...updates, lastSeen: new Date() });
            }
        } catch (error) {
            logger.error('更新参与者失败: ' + error.message);
            return memoryStorage.updateParticipant(roomId, userId, { ...updates, lastSeen: new Date() });
        }
    },
    
    async getParticipants(roomId) {
        try {
            if (mongoose.connection.readyState === 1) {
                const participants = await Participant
                    .find({ roomId })
                    .sort({ joinTime: 1 })
                    .lean();
                return participants;
            } else {
                return memoryStorage.getParticipants(roomId);
            }
        } catch (error) {
            logger.error('获取参与者失败: ' + error.message);
            return memoryStorage.getParticipants(roomId);
        }
    },
    
    async findParticipantBySocketId(socketId) {
        try {
            if (mongoose.connection.readyState === 1) {
                const participant = await Participant.findOne({ socketId }).lean();
                return participant;
            } else {
                return memoryStorage.findParticipantBySocketId(socketId);
            }
        } catch (error) {
            logger.error('查找参与者失败: ' + error.message);
            return memoryStorage.findParticipantBySocketId(socketId);
        }
    },
    
    async removeParticipant(roomId, userId) {
        try {
            if (mongoose.connection.readyState === 1) {
                await Participant.deleteOne({ roomId, userId });
            } else {
                memoryStorage.removeParticipant(roomId, userId);
            }
        } catch (error) {
            logger.error('删除参与者失败: ' + error.message);
            memoryStorage.removeParticipant(roomId, userId);
        }
    }
};

// 定期清理无效的通话状态
setInterval(async () => {
    try {
        // 获取所有活跃的socket连接
        const activeSockets = Array.from(io.sockets.sockets.keys());
        
        // 检查数据库中处于通话状态但socket已断开的用户
        if (mongoose.connection.readyState === 1) {
            const rooms = await Room.find({});
            for (const room of rooms) {
                const participants = await dataService.getParticipants(room.roomId);
                for (const participant of participants) {
                    if (participant.status === 'in-call' && 
                        participant.socketId && 
                        !activeSockets.includes(participant.socketId)) {
                        
                        logger.info(`🔄 清理无效通话状态: ${participant.userId} (socket已断开)`);
                        
                        // 更新状态为离线
                        await dataService.updateParticipant(
                            room.roomId, 
                            participant.userId, 
                            { status: 'offline', socketId: null }
                        );
                        
                        // 通知房间其他用户
                        io.to(room.roomId).emit('callEnd', { 
                            userId: participant.userId,
                            reason: 'connection_lost'
                        });
                    }
                }
            }
        } else {
            // 内存模式下的清理
            const allParticipants = memoryStorage.getAllParticipants();
            for (const [roomId, participants] of allParticipants) {
                for (const participant of participants.values()) {
                    if (participant.status === 'in-call' && 
                        participant.socketId && 
                        !activeSockets.includes(participant.socketId)) {
                        
                        logger.info(`🔄 清理无效通话状态: ${participant.userId} (socket已断开)`);
                        
                        // 更新状态
                        memoryStorage.updateParticipant(roomId, participant.userId, {
                            status: 'offline',
                            socketId: null
                        });
                        
                        // 通知房间其他用户
                        io.to(roomId).emit('callEnd', { 
                            userId: participant.userId,
                            reason: 'connection_lost'
                        });
                    }
                }
            }
        }
    } catch (error) {
        // 减少错误日志频率，避免刷屏
        if (!global.lastCleanupError || Date.now() - global.lastCleanupError > 60000) {
            logger.error('清理通话状态失败:', error);
            global.lastCleanupError = Date.now();
        }
    }
}, 30000); // 每30秒清理一次

// Socket.IO事件处理
io.on('connection', (socket) => {
    logger.info('新用户连接: ' + socket.id);
    
    // 速率限制中间件
    socket.use(async (packet, next) => {
        try {
            await rateLimiter.consume(socket.handshake.address);
            next();
        } catch (rejRes) {
            logger.warn(`⚠️ 速率限制触发: ${socket.handshake.address}, 剩余时间: ${Math.round(rejRes.msBeforeNext / 1000)}秒`);
            socket.emit('error', `请求频率过高，请${Math.round(rejRes.msBeforeNext / 1000)}秒后重试`);
            socket.disconnect();
        }
    });
    
    // 加入房间
    socket.on('joinRoom', async (data) => {
        try {
            const { roomId, userId, username } = data;
            
            if (!roomId || !userId || !username) {
                socket.emit('error', '缺少必要参数');
                return;
            }
            
            // 离开之前的房间
            const rooms = Array.from(socket.rooms);
            rooms.forEach(room => {
                if (room !== socket.id) {
                    socket.leave(room);
                }
            });
            
            // 加入新房间
            socket.join(roomId);
            
            // 保存用户信息到socket对象，用于后续查找
            socket.userId = userId;
            socket.username = username;
            socket.roomId = roomId;
            
            // 强制清理相同用户名的所有旧连接状态
            const existingParticipants = await dataService.getParticipants(roomId);
            const sameNameUsers = existingParticipants.filter(p => p.name === username && p.userId !== userId);
            
            // 将同名但不同ID的用户标记为离线，并强制断开旧连接
            for (const sameNameUser of sameNameUsers) {
                // 查找并断开旧的socket连接
                const oldSocketId = sameNameUser.socketId;
                if (oldSocketId) {
                    const oldSocket = io.sockets.sockets.get(oldSocketId);
                    if (oldSocket) {
                        logger.info(`🔄 强制断开旧连接: ${oldSocketId} (用户: ${username})`);
                        oldSocket.emit('forceDisconnect', { reason: '新连接建立，旧连接将被断开' });
                        oldSocket.disconnect(true);
                    }
                }
                
                // 标记为离线
                await dataService.updateParticipant(roomId, sameNameUser.userId, {
                    status: 'offline',
                    socketId: null
                });
                
                logger.info(`🔄 清理旧用户状态: ${sameNameUser.userId} (用户: ${username})`);
            }
            
            // 额外清理：检查是否有相同用户名但处于通话状态的用户，也要清理
            const allParticipants = await dataService.getParticipants(roomId);
            for (const participant of allParticipants) {
                if (participant.name === username && participant.userId !== userId && participant.status === 'in-call') {
                    logger.info(`🔄 清理旧通话状态: ${participant.userId} (用户: ${username})`);
                    await dataService.updateParticipant(roomId, participant.userId, {
                        status: 'offline',
                        socketId: null
                    });
                    
                    // 通知房间其他用户此用户离开通话
                    socket.to(roomId).emit('callEnd', { userId: participant.userId });
                }
            }
            
            // 检查房间是否已存在，确定是否是创建者
            let isCreator = false;
            let existingRoom = null;
            
            try {
                if (mongoose.connection.readyState === 1) {
                    existingRoom = await Room.findOne({ roomId });
                } else {
                    // 内存存储模式
                    existingRoom = memoryStorage.getRoomInfo(roomId);
                }
            } catch (error) {
                logger.error('查询房间信息失败: ' + error.message);
            }
            
            if (!existingRoom) {
                // 房间不存在，当前用户是创建者
                isCreator = true;
                const newRoomInfo = {
                    roomId,
                    creatorId: userId,
                    creatorName: username,
                    createdAt: new Date(),
                    lastActivity: new Date()
                };
                
                try {
                    if (mongoose.connection.readyState === 1) {
                        await Room.create(newRoomInfo);
                        existingRoom = newRoomInfo;
                    } else {
                        // 内存存储模式
                        memoryStorage.setRoomInfo(roomId, newRoomInfo);
                        existingRoom = newRoomInfo;
                    }
                    logger.info(`🏠 房间 ${roomId} 创建，创建者: ${username} (${userId})`);
                } catch (error) {
                    logger.error('创建房间记录失败: ' + error.message);
                }
            } else {
                // 房间已存在，检查当前用户是否是原创建者
                isCreator = existingRoom.creatorId === userId;
                if (isCreator) {
                    logger.info(`🔄 创建者 ${username} (${userId}) 重新加入房间 ${roomId}`);
                } else {
                    logger.info(`👥 用户 ${username} (${userId}) 加入房间 ${roomId}，创建者: ${existingRoom.creatorName} (${existingRoom.creatorId})`);
                }
                
                // 更新房间活动时间
                try {
                    if (mongoose.connection.readyState === 1) {
                        await Room.updateOne({ roomId }, { lastActivity: new Date() });
                    } else {
                        // 内存存储模式，更新房间信息
                        existingRoom.lastActivity = new Date();
                    }
                } catch (error) {
                    logger.error('更新房间活动时间失败: ' + error.message);
                }
            }
            
            // 保存参与者信息
            const participantData = {
                roomId,
                userId,
                name: username,
                status: 'online',
                joinTime: new Date(),
                lastSeen: new Date(),
                socketId: socket.id
            };
            
            const participant = await dataService.saveParticipant(participantData);
            
            // 获取房间历史消息和参与者
            const [messages, participants] = await Promise.all([
                dataService.getMessages(roomId, 50),
                dataService.getParticipants(roomId)
            ]);
            
            // 发送房间数据给用户（使用已获取的房间信息）
            socket.emit('roomData', {
                messages,
                participants: participants.map(p => ({
                    ...p,
                    status: p.socketId ? 'online' : 'offline'
                })),
                roomInfo: existingRoom ? {
                    creatorId: existingRoom.creatorId,
                    creatorName: existingRoom.creatorName,
                    createdAt: existingRoom.createdAt
                } : (isCreator ? {
                    creatorId: userId,
                    creatorName: username,
                    createdAt: new Date()
                } : null),
                isCreator: isCreator
            });
            
            // 添加调试日志
            logger.info(`房间数据发送完成: roomId=${roomId}, isCreator=${isCreator}, participants=${participants.length}`);
            
            // 通知房间其他用户新用户加入
            socket.to(roomId).emit('userJoined', participant);
            
            // 更新参与者列表
            const updatedParticipants = await dataService.getParticipants(roomId);
            io.to(roomId).emit('participantsUpdate', updatedParticipants);
            
            logger.info(`用户 ${username} 加入房间 ${roomId}`);
            
        } catch (error) {
            logger.error('用户加入房间失败: ' + error.message);
            socket.emit('error', '加入房间失败，请重试');
        }
    });
    
    // 发送消息
    socket.on('sendMessage', async (messageData) => {
        try {
            const { roomId, type, text, author, userId, file, isAIQuestion, originUserId, isCallStatus, isCallEnd, callId } = messageData;
            
            if (!roomId || !author || !userId) {
                socket.emit('error', '消息格式错误');
                return;
            }
            
            const message = {
                roomId,
                type: type || 'user',
                text: text || '',
                author,
                userId,
                time: messageData.time || new Date().toLocaleTimeString('zh-CN', { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                }),
                timestamp: messageData.timestamp ? new Date(messageData.timestamp) : new Date(),
                file: file || null,
                isAIQuestion: isAIQuestion || false, // 保留isAIQuestion属性
                originUserId: originUserId || null, // 保留originUserId属性
                isCallStatus: isCallStatus || false, // 保留通话状态标识
                isCallEnd: isCallEnd || false, // 保留通话结束标识
                callId: callId || null // 保留通话ID
            };
            
            // 保存消息
            const savedMessage = await dataService.saveMessage(message);
            
            // 广播消息到房间所有用户
            io.to(roomId).emit('newMessage', savedMessage);
            
            // 更新参与者最后活跃时间
            await dataService.updateParticipant(roomId, userId, { lastSeen: new Date() });
            
            logger.info(`房间 ${roomId} 收到新消息: ${message.text?.substring(0, 50) + '...'}`);
            
        } catch (error) {
            logger.error('发送消息失败: ' + error.message);
            socket.emit('error', '发送消息失败，请重试');
        }
    });
    
    // 用户正在输入
    socket.on('typing', (data) => {
        socket.to(data.roomId).emit('userTyping', {
            userId: data.userId,
            username: data.username,
            isTyping: data.isTyping
        });
    });
    
    // 用户离开
    socket.on('leaveRoom', async (data) => {
        try {
            const { roomId, userId } = data;
            
            socket.leave(roomId);
            
            // 更新用户状态为离线
            await dataService.updateParticipant(roomId, userId, { 
                status: 'offline',
                socketId: null 
            });
            
            // 通知房间其他用户
            socket.to(roomId).emit('userLeft', { userId });
            
            // 更新参与者列表
            const participants = await dataService.getParticipants(roomId);
            io.to(roomId).emit('participantsUpdate', participants);
            
        } catch (error) {
            logger.error('用户离开房间失败: ' + error.message);
        }
    });
    
    // 处理流式转录开始
    socket.on('startStreamingTranscription', async (data) => {
        try {
            const { roomId } = data;
            logger.info(`用户 ${socket.id} 开始流式转录 in room ${roomId}`);
            
            // 初始化AssemblyAI流式客户端（如果还没有）
            if (!assemblyAIStreamingClient || !assemblyAIStreamingClient.isConnected) {
                const assemblyaiApiKey = process.env.ASSEMBLYAI_API_KEY || 'e6c02e532cc44f7ca1afce8427f69d59';
                logger.info(`🔑 使用API Key: ${assemblyaiApiKey.substring(0, 8)}...`);
                
                // 清理旧客户端
                if (assemblyAIStreamingClient) {
                    try {
                        await assemblyAIStreamingClient.disconnect();
                    } catch (e) {
                        logger.warn('清理旧客户端时出错:', e.message);
                    }
                }
                
                assemblyAIStreamingClient = new AssemblyAIStreamingClient(assemblyaiApiKey);
                
                try {
                    await assemblyAIStreamingClient.connect();
                    logger.info('✅ AssemblyAI客户端连接成功');
                } catch (connectError) {
                    logger.error('❌ AssemblyAI连接失败:', connectError.message);
                    assemblyAIStreamingClient = null;
                    throw new Error(`AssemblyAI连接失败: ${connectError.message}`);
                }
            }
            
            // 再次验证连接状态
            if (!assemblyAIStreamingClient || !assemblyAIStreamingClient.isConnected) {
                throw new Error('AssemblyAI客户端未连接，请重新启动转录');
            }
            
            // 为这个客户端添加消息处理器
            assemblyAIStreamingClient.addMessageHandler(socket.id, (transcriptionData) => {
                logger.debug(`📤 发送转录结果给客户端 ${socket.id}:`, transcriptionData);
                
                // 发送转录结果给客户端
                socket.emit('streamingTranscriptionResult', {
                    ...transcriptionData,
                    roomId: roomId,
                    userId: socket.userId || socket.id
                });
                
                // 如果是Turn类型且end_of_turn为true，也发送给房间内的其他用户
                if (transcriptionData.type === 'Turn' && transcriptionData.end_of_turn) {
                    socket.to(roomId).emit('transcriptionReceived', {
                        text: transcriptionData.transcript,
                        author: '语音转录',
                        userId: socket.userId || socket.id,
                        timestamp: Date.now(),
                        isStreaming: true
                    });
                }
            });
            
            socket.emit('streamingTranscriptionStarted', { success: true });
            
        } catch (error) {
            logger.error('启动流式转录失败:', error);
            logger.error('错误详情:', error.stack);
            
            // 清理失败的客户端
            if (assemblyAIStreamingClient) {
                try {
                    await assemblyAIStreamingClient.disconnect();
                } catch (disconnectError) {
                    logger.error('断开连接时出错:', disconnectError);
                }
                assemblyAIStreamingClient = null;
            }
            
            socket.emit('streamingTranscriptionError', { 
                error: error.message 
            });
        }
    });
    
    // 处理音频数据流
    socket.on('audioData', (data) => {
        try {
            if (assemblyAIStreamingClient && assemblyAIStreamingClient.isConnected) {
                // 添加音频数据接收日志
                logger.debug(`📊 收到音频数据: ${data.audioData ? data.audioData.length : 0} bytes from ${socket.id}`);
                
                // 将音频数据发送给AssemblyAI
                assemblyAIStreamingClient.sendAudioData(data.audioData);
            } else {
                // 减少警告日志频率，每10次记录一次
                if (!socket.audioDataWarningCount) socket.audioDataWarningCount = 0;
                socket.audioDataWarningCount++;
                
                if (socket.audioDataWarningCount % 10 === 1) {
                    logger.warn(`⚠️ AssemblyAI客户端未连接，无法发送音频数据 from ${socket.id} (第${socket.audioDataWarningCount}次)`);
                }
                
                // 通知前端停止发送音频
                socket.emit('streamingTranscriptionError', { 
                    error: 'AssemblyAI客户端未连接，请重新启动转录' 
                });
            }
        } catch (error) {
            logger.error('处理音频数据失败:', error);
        }
    });
    
    // 处理流式转录停止
    socket.on('stopStreamingTranscription', async () => {
        try {
            logger.info(`用户 ${socket.id} 停止流式转录`);
            
            // 移除消息处理器
            if (assemblyAIStreamingClient) {
                assemblyAIStreamingClient.removeMessageHandler(socket.id);
                
                // 如果没有其他客户端在使用，断开AssemblyAI连接
                if (assemblyAIStreamingClient.messageHandlers.size === 0) {
                    await assemblyAIStreamingClient.disconnect();
                    assemblyAIStreamingClient = null;
                }
            }
            
            socket.emit('streamingTranscriptionStopped', { success: true });
            
        } catch (error) {
            logger.error('停止流式转录失败:', error);
        }
    });
    
    // 处理心跳
    socket.on('heartbeat', (data) => {
        const { timestamp, userId, roomId } = data;
        // 更新用户的最后活动时间
        socket.lastHeartbeat = timestamp;
        
        // 立即响应心跳
        socket.emit('heartbeatResponse', { timestamp: Date.now() });
        
        // 可选：更新数据库中的用户活动时间
        if (userId && roomId) {
            dataService.updateParticipant(roomId, userId, {
                lastActivity: new Date(timestamp)
            }).catch(error => {
                logger.error('更新用户活动时间失败:', error);
            });
        }
    });

    // 断开连接
    socket.on('disconnect', async () => {
        try {
            logger.info('用户断开连接: ' + socket.id);
            
            // 清理流式转录资源
            if (assemblyAIStreamingClient) {
                assemblyAIStreamingClient.removeMessageHandler(socket.id);
                
                // 如果没有其他客户端在使用，断开AssemblyAI连接
                if (assemblyAIStreamingClient.messageHandlers.size === 0) {
                    await assemblyAIStreamingClient.disconnect();
                    assemblyAIStreamingClient = null;
                    logger.info('AssemblyAI流式转录连接已关闭（无活跃客户端）');
                }
            }
            
            // 查找该socket对应的参与者并更新状态
            const participant = await dataService.findParticipantBySocketId(socket.id);
            if (participant) {
                // 检查用户是否在通话中，如果是则自动结束通话
                const currentParticipant = await dataService.getParticipant(participant.roomId, participant.userId);
                const wasInCall = currentParticipant && currentParticipant.status === 'in-call';
                
                await dataService.updateParticipant(
                    participant.roomId, 
                    participant.userId, 
                    { status: 'offline', socketId: null }
                );
                
                // 如果用户在通话中，通知其他用户该用户离开通话
                if (wasInCall) {
                    logger.info(`🔄 用户 ${participant.userId} 断开连接时自动离开通话`);
                    socket.to(participant.roomId).emit('callEnd', { 
                        userId: participant.userId,
                        reason: 'disconnected'
                    });
                }
                
                // 通知房间其他用户
                socket.to(participant.roomId).emit('userLeft', { userId: participant.userId });
                
                // 更新参与者列表
                const participants = await dataService.getParticipants(participant.roomId);
                io.to(participant.roomId).emit('participantsUpdate', participants);
                
                logger.info(`用户 ${participant.userId} 已离开房间 ${participant.roomId}${wasInCall ? ' (自动离开通话)' : ''}`);
            }
        } catch (error) {
            logger.error('处理断开连接失败: ' + error.message);
        }
    });
    
    // 结束会议（仅创建者可操作）
    socket.on('endMeeting', async (data) => {
        try {
            const { roomId, userId } = data;
            
            if (!roomId || !userId) {
                socket.emit('error', '缺少必要参数');
                return;
            }
            
            // 验证是否是房间创建者
            let isCreator = false;
            if (mongoose.connection.readyState === 1) {
                const room = await Room.findOne({ roomId });
                isCreator = room && room.creatorId === userId;
            } else {
                // 内存存储模式下，检查房间信息中的创建者
                const roomInfo = memoryStorage.getRoomInfo(roomId);
                isCreator = roomInfo && roomInfo.creatorId === userId;
            }
            
            if (!isCreator) {
                socket.emit('error', '只有会议创建者可以结束会议');
                return;
            }
            
            // 清理房间数据
            let deletedMessages = 0;
            let deletedParticipants = 0;
            
            if (mongoose.connection.readyState === 1) {
                // MongoDB环境：删除数据库中的数据
                const messageResult = await Message.deleteMany({ roomId });
                const participantResult = await Participant.deleteMany({ roomId });
                await Room.deleteOne({ roomId });
                
                deletedMessages = messageResult.deletedCount;
                deletedParticipants = participantResult.deletedCount;
            } else {
                // 内存存储环境：清理内存数据
                if (memoryStorage.rooms.has(roomId)) {
                    const room = memoryStorage.rooms.get(roomId);
                    deletedMessages = room.messages.length;
                    deletedParticipants = room.participants.size;
                    memoryStorage.rooms.delete(roomId);
                }
            }
            
            logger.info(`🏁 会议 ${roomId} 已结束: 清理了 ${deletedMessages} 条消息, ${deletedParticipants} 个参与者`);
            
            // 通知房间所有用户会议已结束
            io.to(roomId).emit('meetingEnded', {
                message: '会议已被创建者结束，房间数据已清理',
                deletedMessages,
                deletedParticipants
            });
            
            // 让所有用户离开房间
            const roomSockets = await io.in(roomId).fetchSockets();
            for (const roomSocket of roomSockets) {
                roomSocket.leave(roomId);
            }
            
            socket.emit('endMeetingSuccess', {
                message: '会议已成功结束',
                deletedMessages,
                deletedParticipants
            });
            
        } catch (error) {
            logger.error('结束会议失败: ' + error.message);
            socket.emit('error', '结束会议失败: ' + error.message);
        }
    });
    
    // 语音通话事件处理
    socket.on('callInvite', (data) => {
        const { roomId, callerId, callerName } = data;
        logger.debug(`📞 收到通话邀请事件: ${JSON.stringify(data)}`);
        logger.debug(`📞 房间ID: ${roomId}, 发起者: ${callerName} (${callerId})`);
        
        // 检查房间内有多少用户
        const room = io.sockets.adapter.rooms.get(roomId);
        if (room) {
            logger.debug(`📞 房间 ${roomId} 中有 ${room.size} 个用户`);
        } else {
            logger.debug(`📞 房间 ${roomId} 不存在`);
        }
        
        // 更新发起者状态为通话中
        dataService.updateParticipant(roomId, callerId, {
            status: 'in-call',
            lastSeen: new Date()
        }).then(() => {
            logger.debug(`📞 发起者 ${callerName} 通话状态已更新为in-call`);
            
            // 广播给房间内除发起者外的所有用户
            socket.to(roomId).emit('callInvite', {
                roomId,
                callerId,
                callerName
            });
            
            // 广播更新后的参与者列表
            return dataService.getParticipants(roomId);
        }).then(updatedParticipants => {
            io.to(roomId).emit('participantsUpdate', updatedParticipants);
            logger.debug(`📞 参与者列表已更新，当前通话参与者: ${updatedParticipants.filter(p => p.status === 'in-call').length} 人`);
        }).catch(error => {
            logger.error('更新发起者通话状态失败:', error);
        });
        
        logger.debug(`📞 用户 ${callerName} 发起语音通话邀请`);
    });
    
    socket.on('callAccept', (data) => {
        const { roomId, userId, userName } = data;
        logger.debug(`📞 收到通话接受事件: ${JSON.stringify(data)}`);
        
        // 广播给房间内除接受者外的所有用户
        io.to(roomId).emit('callAccept', {
            roomId,
            userId,
            userName
        });
        
        // 更新参与者状态为通话中
        dataService.updateParticipant(roomId, userId, {
            status: 'in-call',
            lastSeen: new Date()
        }).then(() => {
            logger.debug(`📞 用户 ${userName} 通话状态已更新为in-call`);
            
            // 广播更新后的参与者列表
            return dataService.getParticipants(roomId);
        }).then(updatedParticipants => {
            io.to(roomId).emit('participantsUpdate', updatedParticipants);
            logger.debug(`📞 参与者列表已更新，当前通话参与者: ${updatedParticipants.filter(p => p.status === 'in-call').length} 人`);
        }).catch(error => {
            logger.error('更新参与者通话状态失败:', error);
        });
        
        logger.debug(`📞 用户 ${userName} 接受语音通话`);
    });
    
    socket.on('callReject', (data) => {
        const { roomId, userId, reason } = data;
        // 广播给房间内除拒绝者外的所有用户
        io.to(roomId).emit('callReject', {
            roomId,
            userId,
            reason
        });
        logger.debug(`📞 用户拒绝语音通话，原因: ${reason || '用户拒绝'}`);
    });
    
    socket.on('callEnd', (data) => {
        const { roomId, userId, isCreatorEnd } = data;
        // 广播给房间内除结束者外的所有用户
        io.to(roomId).emit('callEnd', {
            roomId,
            userId,
            isCreatorEnd: isCreatorEnd || false
        });
        logger.debug(`📞 用户 ${userId} 结束语音通话 (创建者结束: ${isCreatorEnd || false})`);
    });
    
    socket.on('callOffer', (data) => {
        const { roomId, targetUserId, offer, fromUserId } = data;
        // 找到目标用户的socket并发送offer
        const targetSocket = findSocketByUserId(targetUserId);
        if (targetSocket) {
            targetSocket.emit('callOffer', {
                roomId,
                targetUserId,
                offer,
                fromUserId
            });
            logger.debug(`📞 转发WebRTC offer 从 ${fromUserId} 到 ${targetUserId}`);
        } else {
            logger.debug(`⚠️ 未找到目标用户 ${targetUserId} 的socket连接`);
        }
    });
    
    socket.on('callAnswer', (data) => {
        const { roomId, targetUserId, answer, fromUserId } = data;
        // 找到目标用户的socket并发送answer
        const targetSocket = findSocketByUserId(targetUserId);
        if (targetSocket) {
            targetSocket.emit('callAnswer', {
                roomId,
                targetUserId,
                answer,
                fromUserId
            });
            logger.debug(`📞 转发WebRTC answer 从 ${fromUserId} 到 ${targetUserId}`);
        } else {
            logger.debug(`⚠️ 未找到目标用户 ${targetUserId} 的socket连接`);
        }
    });
    
    socket.on('iceCandidate', (data) => {
        const { roomId, targetUserId, candidate, fromUserId } = data;
        // 找到目标用户的socket并发送ICE候选
        const targetSocket = findSocketByUserId(targetUserId);
        if (targetSocket) {
            targetSocket.emit('iceCandidate', {
                roomId,
                targetUserId,
                candidate,
                fromUserId
            });
            logger.debug(`📞 转发ICE候选 从 ${fromUserId} 到 ${targetUserId}`);
        } else {
            logger.debug(`⚠️ 未找到目标用户 ${targetUserId} 的socket连接`);
        }
    });
    
    // 科大讯飞转录事件
    socket.on('xfyunTranscriptionStart', (data) => {
        const { roomId, userId, username } = data;
        logger.info(`🎤 用户 ${username} 开始科大讯飞转录`);
        
        // 通知房间内其他用户有人开始转录
        socket.to(roomId).emit('transcriptionStatusChange', {
            action: 'start',
            type: 'xfyun',
            userId,
            username,
            timestamp: new Date().toISOString()
        });
    });
    
    socket.on('xfyunTranscriptionStop', (data) => {
        const { roomId, userId, username } = data;
        logger.info(`🎤 用户 ${username} 停止科大讯飞转录`);
        
        // 通知房间内其他用户转录已停止
        socket.to(roomId).emit('transcriptionStatusChange', {
            action: 'stop',
            type: 'xfyun',
            userId,
            username,
            timestamp: new Date().toISOString()
        });
    });
    
    socket.on('xfyunTranscriptionResult', (data) => {
        const { roomId, userId, username, result, isPartial, timestamp } = data;
        
        logger.info(`📡 收到转录结果: ${result} (来自: ${username}, 临时: ${isPartial})`);
        
        // 广播转录结果到房间内所有用户（包括发送者）
        const broadcastData = {
            type: 'xfyun',
            userId,
            username,
            result,
            isPartial,
            timestamp,
            roomId
        };
        
        io.to(roomId).emit('transcriptionResult', broadcastData);
        
        logger.info(`📤 转录结果已广播到房间 ${roomId}: ${result.substring(0, 50)}... (接收者数量: ${io.sockets.adapter.rooms.get(roomId)?.size || 0})`);
    });
});

// API路由
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
    });
});

// Railway健康检查端点
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        service: 'vibe-meeting',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development',
        version: '1.0.0',
        database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        transcription_service: process.env.ASSEMBLYAI_API_KEY ? 'assemblyai-configured' : 'default-key'
    });
});

app.get('/api/rooms/:roomId/messages', async (req, res) => {
    try {
        const { roomId } = req.params;
        const limit = parseInt(req.query.limit) || 50;
        
        const messages = await dataService.getMessages(roomId, limit);
        res.json({ messages });
    } catch (error) {
        logger.error('获取消息失败: ' + error.message);
        res.status(500).json({ error: '获取消息失败' });
    }
});

app.get('/api/rooms/:roomId/participants', async (req, res) => {
    try {
        const { roomId } = req.params;
        logger.info(`📞 收到获取参与者请求: roomId=${roomId}`);
        
        const participants = await dataService.getParticipants(roomId);
        logger.info(`📞 获取到参与者数据: ${participants ? participants.length : 0} 个参与者`);
        
        res.json({ participants });
    } catch (error) {
        logger.error('获取参与者失败: ' + error.message);
        res.status(500).json({ error: '获取参与者失败' });
    }
});

// 转录服务健康检查端点（AssemblyAI集成）
app.get('/api/transcription/health', async (req, res) => {
    try {
                    const assemblyaiApiKey = process.env.ASSEMBLYAI_API_KEY || 'e6c02e532cc44f7ca1afce8427f69d59';
        
        // 测试AssemblyAI连接
        const testResponse = await axios.get('https://api.assemblyai.com/v2/transcript', {
            headers: {
                authorization: assemblyaiApiKey
            },
            timeout: 10000 // 10秒超时
        });
        
        const status = {
            status: 'ok',
            service: 'assemblyai-transcription',
            api_service: 'AssemblyAI',
            model: 'universal',
            mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
            api_key_configured: !!assemblyaiApiKey,
            api_response_status: testResponse.status,
            timestamp: new Date().toISOString()
        };
        
        logger.info('AssemblyAI转录服务健康检查通过');
        res.json(status);
        
    } catch (error) {
        logger.error('AssemblyAI转录服务健康检查失败: ' + error.message);
        
        // 返回详细的错误信息
        res.status(500).json({ 
            status: 'error',
            service: 'assemblyai-transcription',
            error: error.message,
            api_service: 'AssemblyAI',
            mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
            api_key_configured: !!(process.env.ASSEMBLYAI_API_KEY || 'e6c02e532cc44f7ca1afce8427f69d59'),
            timestamp: new Date().toISOString()
        });
    }
});

app.post('/api/transcription/audio', async (req, res) => {
    try {
        // 检查是否有上传的文件
        if (!req.files || !req.files.audio_file) {
            return res.status(400).json({ 
                success: false, 
                error: '未找到音频文件',
                text: '',
                language: 'zh_cn'
            });
        }
        
        const audioFile = req.files.audio_file;
        logger.info(`收到AssemblyAI转录请求: ${audioFile.name}, 大小: ${audioFile.size} bytes`);
        
        // 使用AssemblyAI进行转录
        const transcriptionResult = await transcribeWithAssemblyAI(audioFile);
        
        // 如果转录成功，保存到数据库
        if (transcriptionResult.success && transcriptionResult.text) {
            const transcriptionRecord = {
                roomId: req.body.roomId || 'unknown',
                text: transcriptionResult.text,
                language: transcriptionResult.language || 'zh_cn',
                timestamp: new Date(),
                type: 'transcription',
                author: '语音转录',
                userId: req.body.userId || 'anonymous',
                time: new Date().toLocaleTimeString('zh-CN', { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                }),
                model: transcriptionResult.model || 'assemblyai-universal',
                confidence: transcriptionResult.confidence || 0.9,
                processing_time: transcriptionResult.processing_time || 0
            };
            
            // 保存转录记录
            if (mongoose.connection.readyState === 1) {
                try {
                    await dataService.saveMessage(transcriptionRecord);
                    logger.info(`AssemblyAI转录记录已保存: ${transcriptionResult.text.substring(0, 50)}... (耗时: ${transcriptionResult.processing_time}s)`);
                } catch (dbError) {
                    logger.warn('保存转录记录失败:', dbError.message);
                }
            }
        }
        
        res.json(transcriptionResult);
        
    } catch (error) {
        logger.error('AssemblyAI转录失败: ' + error.message);
        res.status(500).json({ 
            success: false, 
            error: 'AssemblyAI转录服务暂时不可用: ' + error.message,
            text: '',
            language: 'zh_cn',
            service: 'assemblyai'
        });
    }
});

// AssemblyAI转录功能
async function transcribeWithAssemblyAI(audioFile) {
    const startTime = Date.now();
    
    try {
                    const assemblyaiApiKey = process.env.ASSEMBLYAI_API_KEY || 'e6c02e532cc44f7ca1afce8427f69d59';
        const baseUrl = "https://api.assemblyai.com";
        
        const headers = {
            authorization: assemblyaiApiKey,
        };
        
        logger.info('开始上传音频文件到AssemblyAI...');
        
        // 1. 上传音频文件
        const uploadResponse = await axios.post(`${baseUrl}/v2/upload`, audioFile.data, {
            headers: {
                ...headers,
                'Content-Type': 'application/octet-stream'
            },
            timeout: 60000 // 60秒超时
        });
        
        const audioUrl = uploadResponse.data.upload_url;
        logger.info(`音频文件上传成功: ${audioUrl}`);
        
        // 2. 提交转录任务
        const transcriptionData = {
            audio_url: audioUrl,
            speech_model: "universal",
                            language_code: "zh_cn", // 中文
            punctuate: true,
            format_text: true
        };
        
        const transcriptResponse = await axios.post(`${baseUrl}/v2/transcript`, transcriptionData, {
            headers: headers,
            timeout: 30000 // 30秒超时
        });
        
        const transcriptId = transcriptResponse.data.id;
        logger.info(`转录任务已提交，ID: ${transcriptId}`);
        
        // 3. 轮询获取结果
        const pollingEndpoint = `${baseUrl}/v2/transcript/${transcriptId}`;
        let attempts = 0;
        const maxAttempts = 60; // 最多轮询60次（3分钟）
        
        while (attempts < maxAttempts) {
            attempts++;
            
            const pollingResponse = await axios.get(pollingEndpoint, {
                headers: headers,
                timeout: 10000 // 10秒超时
            });
            
            const transcriptionResult = pollingResponse.data;
            
            if (transcriptionResult.status === "completed") {
                const processingTime = (Date.now() - startTime) / 1000;
                
                logger.info(`AssemblyAI转录完成: ${transcriptionResult.text?.substring(0, 100)}...`);
                logger.info(`AssemblyAI完整响应:`, JSON.stringify(transcriptionResult, null, 2));
                
                const response = {
                    success: true,
                    text: transcriptionResult.text || '',
                    language: 'zh_cn',
                    confidence: transcriptionResult.confidence || 0.9,
                    model: 'assemblyai-universal',
                    processing_time: processingTime,
                    service: 'assemblyai',
                    transcript_id: transcriptId
                };
                
                logger.info(`返回给前端的响应:`, JSON.stringify(response, null, 2));
                return response;
                
            } else if (transcriptionResult.status === "error") {
                throw new Error(`AssemblyAI转录失败: ${transcriptionResult.error}`);
                
            } else {
                // 状态为 "queued" 或 "processing"，继续等待
                logger.info(`转录进行中... 状态: ${transcriptionResult.status} (尝试 ${attempts}/${maxAttempts})`);
                await new Promise((resolve) => setTimeout(resolve, 3000)); // 等待3秒
            }
        }
        
        throw new Error('转录超时：超过最大等待时间');
        
    } catch (error) {
        const processingTime = (Date.now() - startTime) / 1000;
        
        logger.error('AssemblyAI转录失败:', error.message);
        
        return {
            success: false,
            text: '',
            language: 'zh_cn',
            error: error.message,
            model: 'assemblyai-universal',
            processing_time: processingTime,
            service: 'assemblyai'
        };
    }
}

// AssemblyAI Universal Streaming WebSocket处理类
class AssemblyAIStreamingClient {
    constructor(assemblyaiApiKey) {
        this.apiKey = assemblyaiApiKey;
        this.websocket = null;
        this.sessionId = null;
        this.isConnected = false;
        this.messageHandlers = new Map();
    }
    
    async connect() {
        try {
            // 使用Universal Streaming v3 API - 通过URL参数传递token
            const wsUrl = `wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&encoding=pcm_s16le&format_turns=true&token=${this.apiKey}`;
            logger.info(`🔗 尝试连接AssemblyAI: ${wsUrl.replace(this.apiKey, '***')}`);
            
            this.websocket = new WebSocket(wsUrl);
            
            return new Promise((resolve, reject) => {
                // 设置连接超时
                const timeout = setTimeout(() => {
                    logger.error('⏰ AssemblyAI连接超时');
                    this.websocket.close();
                    reject(new Error('连接超时'));
                }, 15000); // 15秒超时
                
                this.websocket.onopen = () => {
                    clearTimeout(timeout);
                    logger.info('✅ AssemblyAI Universal Streaming连接建立');
                    this.isConnected = true;
                    resolve();
                };
                
                this.websocket.onmessage = (message) => {
                    this.handleAssemblyAIMessage(message);
                };
                
                this.websocket.onerror = (error) => {
                    clearTimeout(timeout);
                    logger.error('❌ AssemblyAI WebSocket错误:', error);
                    logger.error('详细错误信息:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
                    logger.error('错误类型:', typeof error);
                    logger.error('错误消息:', error.message || 'Unknown error');
                    this.isConnected = false;
                    
                    // 确保WebSocket被清理
                    if (this.websocket) {
                        try {
                            this.websocket.close();
                        } catch (e) {
                            logger.warn('关闭WebSocket时出错:', e);
                        }
                        this.websocket = null;
                    }
                    
                    reject(new Error(`WebSocket连接失败: ${error.message || 'Unknown connection error'}`));
                };
                
                this.websocket.onclose = (event) => {
                    clearTimeout(timeout);
                    logger.info(`🔌 AssemblyAI WebSocket连接关闭: code=${event.code}, reason=${event.reason}`);
                    this.isConnected = false;
                    this.websocket = null;
                    
                    // 如果是异常关闭且不是在connect过程中，触发重连警告
                    if (event.code !== 1000 && event.code !== 1001 && this.isConnected) {
                        logger.warn('🔄 检测到异常关闭，可能需要重连');
                    }
                    
                    // 如果在连接过程中关闭，说明连接失败
                    if (!this.isConnected) {
                        reject(new Error(`WebSocket连接被拒绝: code=${event.code}, reason=${event.reason || '未知原因'}`));
                    }
                };
            });
            
        } catch (error) {
            logger.error('AssemblyAI Universal Streaming连接失败:', error);
            throw error;
        }
    }
    
    async disconnect() {
        try {
            if (this.websocket) {
                logger.info('🔌 断开AssemblyAI连接...');
                this.isConnected = false;
                
                // 发送终止消息
                if (this.websocket.readyState === WebSocket.OPEN) {
                    this.websocket.send(JSON.stringify({ type: 'Terminate' }));
                }
                
                this.websocket.close();
                this.websocket = null;
            }
        } catch (error) {
            logger.error('断开AssemblyAI连接时出错:', error);
        }
    }
    
    handleAssemblyAIMessage(message) {
        try {
            const data = JSON.parse(message.data);
            
            // 处理不同类型的消息 - Universal Streaming API格式
            switch (data.type) {
                case 'Begin':
                    this.sessionId = data.id;
                    logger.info(`AssemblyAI Universal Streaming会话开始: ${this.sessionId}`);
                    break;
                    
                case 'Turn':
                    // Universal Streaming API的转录结果
                    if (data.transcript && data.transcript.trim()) {
                        const resultType = data.end_of_turn ? 'final' : 'partial';
                        
                        this.broadcastTranscription({
                            type: resultType,
                            text: data.transcript,
                            confidence: data.end_of_turn_confidence || 0.9,
                            timestamp: Date.now(),
                            turn_order: data.turn_order,
                            end_of_turn: data.end_of_turn,
                            turn_is_formatted: data.turn_is_formatted
                        });
                    }
                    break;
                    
                case 'Termination':
                    logger.info(`AssemblyAI Universal Streaming会话结束，处理了 ${data.audio_duration_seconds} 秒音频`);
                    this.isConnected = false;
                    break;
                    
                default:
                    logger.debug('未知AssemblyAI消息类型:', data.type);
            }
            
        } catch (error) {
            logger.error('处理AssemblyAI消息失败:', error);
        }
    }
    
    broadcastTranscription(transcriptionData) {
        // 广播转录结果给所有连接的客户端
        this.messageHandlers.forEach((handler, clientId) => {
            try {
                handler(transcriptionData);
            } catch (error) {
                logger.error(`向客户端 ${clientId} 发送转录结果失败:`, error);
            }
        });
    }
    
    addMessageHandler(clientId, handler) {
        this.messageHandlers.set(clientId, handler);
    }
    
    removeMessageHandler(clientId) {
        this.messageHandlers.delete(clientId);
    }
    
    sendAudioData(audioData) {
        if (this.websocket && this.isConnected) {
            try {
                // 确保audioData是Buffer或ArrayBuffer  
                let buffer;
                if (audioData instanceof ArrayBuffer) {
                    buffer = Buffer.from(audioData);
                } else if (Buffer.isBuffer(audioData)) {
                    buffer = audioData;
                } else if (Array.isArray(audioData)) {
                    // 如果是数组（从前端ArrayBuffer转换而来），转换为Buffer
                    buffer = Buffer.from(audioData);
                } else if (typeof audioData === 'object' && audioData.constructor === Object) {
                    // 如果是Socket.IO传递的普通对象，需要特殊处理
                    logger.warn('收到的音频数据是普通对象，尝试转换:', Object.keys(audioData));
                    return; // 暂时跳过，需要前端修复
                } else {
                    // 如果是其他格式，尝试转换
                    buffer = Buffer.from(audioData);
                }
                
                // Universal Streaming v3 API期望原始的二进制PCM16数据（不是base64）
                logger.debug(`🎵 发送音频数据到AssemblyAI: ${buffer.length} bytes (binary)`);
                this.websocket.send(buffer);
            } catch (error) {
                logger.error('发送音频数据失败:', error);
                logger.error('音频数据类型:', typeof audioData, audioData?.constructor?.name);
            }
        } else {
            logger.warn('⚠️ WebSocket未连接，无法发送音频数据');
        }
    }
    
    terminate() {
        if (this.websocket && this.isConnected) {
            try {
                // 发送终止会话消息
                this.websocket.send(JSON.stringify({
                    type: 'Terminate'
                }));
            } catch (error) {
                logger.error('发送终止消息失败:', error);
            }
        }
    }
    
    async disconnect() {
        if (this.websocket) {
            // 先尝试优雅关闭
            this.terminate();
            
            // 等待一小段时间让终止消息发送
            setTimeout(() => {
                if (this.websocket) {
                    this.websocket.close();
                    this.websocket = null;
                    this.isConnected = false;
                    this.sessionId = null;
                    this.messageHandlers.clear();
                }
            }, 100);
        }
    }
}

// 全局AssemblyAI流式客户端实例
let assemblyAIStreamingClient = null;

// 错误处理
app.use((err, req, res, next) => {
    logger.error('服务器错误: ' + err.message);
    res.status(500).json({ error: '服务器内部错误' });
});

// 404处理 - 对于API请求返回JSON，对于页面请求返回index.html
app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
        res.status(404).json({ error: '接口不存在' });
    } else {
        // 对于非API请求，返回index.html（SPA路由支持）
        const indexPath = path.join(__dirname, '..', 'index.html');
        
        // 检查文件是否存在
        const fs = require('fs');
        if (fs.existsSync(indexPath)) {
            res.sendFile(indexPath);
        } else {
            // 如果文件不存在，返回简单的HTML响应
            res.status(200).send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Vibe Meeting</title>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                </head>
                <body>
                    <h1>Vibe Meeting</h1>
                    <p>服务器正在运行，但前端文件未找到。</p>
                    <p>请检查部署配置。</p>
                </body>
                </html>
            `);
        }
    }
});

// 辅助函数：根据用户ID找到socket连接
function findSocketByUserId(userId) {
    // 遍历所有socket连接，找到匹配的用户ID
    const sockets = io.sockets.sockets;
    logger.debug(`🔍 查找用户 ${userId} 的socket连接，当前连接数: ${sockets.size}`);
    
    for (const [socketId, socket] of sockets) {
        logger.debug(`🔍 检查socket ${socketId}: userId=${socket.userId}, username=${socket.username}`);
        if (socket.userId === userId) {
            logger.debug(`✅ 找到用户 ${userId} 的socket连接: ${socketId}`);
            return socket;
        }
    }
    
    logger.warn(`⚠️ 未找到用户 ${userId} 的socket连接`);
    return null;
}

// 定期清理离线用户（每5分钟）
setInterval(async () => {
    try {
        if (mongoose.connection.readyState === 1) {
            const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
            await Participant.updateMany(
                { 
                    lastSeen: { $lt: fiveMinutesAgo },
                    status: 'online'
                },
                { status: 'offline', socketId: null }
            );
        }
    } catch (error) {
        logger.error('清理离线用户失败: ' + error.message);
    }
}, 5 * 60 * 1000);

// Railway环境检测和静态文件路由
app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, '..', 'index.html');
    const fs = require('fs');
    
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        // 如果文件不存在，返回简单的HTML响应
        res.status(200).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Vibe Meeting</title>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
            </head>
            <body>
                <h1>Vibe Meeting</h1>
                <p>服务器正在运行，但前端文件未找到。</p>
                <p>请检查部署配置。</p>
            </body>
            </html>
        `);
    }
});

// ==================== 科大讯飞实时语音转写代理 ====================

// 科大讯飞配置
const XFYUN_CONFIG = {
    appId: '84959f16',
    apiKey: '065eee5163baa4692717b923323e6853',
    apiSecret: '', // 如果需要的话
    wsUrl: 'ws://rtasr.xfyun.cn/v1/ws'
};

// 生成科大讯飞鉴权参数
function generateXfyunAuth() {
    const host = 'rtasr.xfyun.cn';
    const path = '/v1/ws';
    const date = new Date().toUTCString();
    
    // 构建签名字符串
    const signatureOrigin = `host: ${host}\ndate: ${date}\nGET ${path} HTTP/1.1`;
    
    // 使用HMAC-SHA256进行签名
    const signature = crypto.createHmac('sha256', XFYUN_CONFIG.apiKey)
                           .update(signatureOrigin, 'utf8')
                           .digest('base64');
    
    // 构建Authorization头
    const authorization = `api_key="${XFYUN_CONFIG.apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
    const authorizationBase64 = Buffer.from(authorization).toString('base64');
    
    return {
        authorization: authorizationBase64,
        date: date,
        host: host
    };
}

// 科大讯飞WebSocket代理路由
app.ws('/xfyun-proxy', (ws, req) => {
    logger.info('🎤 新的科大讯飞转录连接');
    
    let xfyunWs = null;
    
    // 连接到科大讯飞服务
    const connectToXfyun = () => {
        try {
            const auth = generateXfyunAuth();
            const wsUrl = `${XFYUN_CONFIG.wsUrl}?authorization=${auth.authorization}&date=${encodeURIComponent(auth.date)}&host=${auth.host}`;
            
            logger.debug('连接到科大讯飞:', wsUrl);
            
            xfyunWs = new WebSocket(wsUrl);
            
            xfyunWs.on('open', () => {
                logger.info('✅ 科大讯飞WebSocket连接成功');
                ws.send(JSON.stringify({
                    action: 'connected',
                    message: '已连接到科大讯飞服务'
                }));
            });
            
            xfyunWs.on('message', (data) => {
                // 转发科大讯飞的响应到客户端
                try {
                    const message = JSON.parse(data);
                    logger.debug('科大讯飞响应:', message);
                    
                    ws.send(JSON.stringify({
                        action: 'result',
                        data: message
                    }));
                } catch (error) {
                    logger.error('解析科大讯飞响应失败:', error);
                }
            });
            
            xfyunWs.on('error', (error) => {
                logger.error('科大讯飞WebSocket错误:', error);
                ws.send(JSON.stringify({
                    action: 'error',
                    desc: '科大讯飞服务错误: ' + error.message
                }));
            });
            
            xfyunWs.on('close', () => {
                logger.info('🔌 科大讯飞WebSocket连接关闭');
                ws.send(JSON.stringify({
                    action: 'disconnected',
                    message: '科大讯飞服务连接已断开'
                }));
            });
            
        } catch (error) {
            logger.error('连接科大讯飞失败:', error);
            ws.send(JSON.stringify({
                action: 'error',
                desc: '无法连接到科大讯飞服务: ' + error.message
            }));
        }
    };
    
    // 处理客户端消息
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            if (data.action === 'start') {
                // 开始转录
                logger.info('📤 客户端请求开始转录');
                connectToXfyun();
            } else if (data.action === 'audio') {
                if (!xfyunWs) {
                    logger.warn('⚠️ 科大讯飞连接未建立，忽略音频数据');
                    return;
                }
                if (xfyunWs.readyState !== WebSocket.OPEN) {
                    logger.warn('⚠️ 科大讯飞连接未打开，状态:', xfyunWs.readyState);
                    return;
                }
                // 转发音频数据到科大讯飞
                const audioMessage = {
                    common: {
                        app_id: XFYUN_CONFIG.appId
                    },
                    business: {
                        language: 'zh_cn',
                        domain: 'iat',
                        accent: 'mandarin',
                        vinfo: 1,
                        vad_eos: 5000
                    },
                    data: {
                        status: data.data.frame_id === 0 ? 0 : 1, // 0: 首帧, 1: 中间帧, 2: 尾帧
                        format: 'audio/L16;rate=16000',
                        audio: data.data.audio,
                        encoding: 'raw'
                    }
                };
                
                logger.debug(`📤 转发音频帧到科大讯飞: #${data.data.frame_id}, 状态: ${audioMessage.data.status}`);
                xfyunWs.send(JSON.stringify(audioMessage));
            } else if (data.action === 'stop' && xfyunWs) {
                // 发送结束帧
                const endMessage = {
                    data: {
                        status: 2, // 结束帧
                        format: 'audio/L16;rate=16000',
                        audio: '',
                        encoding: 'raw'
                    }
                };
                
                if (xfyunWs.readyState === WebSocket.OPEN) {
                    xfyunWs.send(JSON.stringify(endMessage));
                }
            }
            
        } catch (error) {
            logger.error('处理客户端消息失败:', error);
            ws.send(JSON.stringify({
                action: 'error',
                desc: '消息处理失败: ' + error.message
            }));
        }
    });
    
    ws.on('close', () => {
        logger.info('🔌 客户端WebSocket连接关闭');
        if (xfyunWs) {
            xfyunWs.close();
        }
    });
    
    ws.on('error', (error) => {
        logger.error('客户端WebSocket错误:', error);
        if (xfyunWs) {
            xfyunWs.close();
        }
    });
});

// 健康检查端点
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development',
        version: '1.0.0'
    });
});

// 科大讯飞配置状态接口
app.get('/api/xfyun/status', (req, res) => {
    res.json({
        status: 'ok',
        appId: XFYUN_CONFIG.appId,
        configured: !!(XFYUN_CONFIG.appId && XFYUN_CONFIG.apiKey),
        message: '科大讯飞实时语音转写已配置'
    });
});

// ==================== 科大讯飞代理功能结束 ====================

// 启动服务器
const PORT = process.env.PORT || 3001;

const startServer = async () => {
    await connectDB();
    
    // 添加文件路径调试信息
    const indexPath = path.join(__dirname, '..', 'index.html');
    const fs = require('fs');
    logger.info(`📁 项目根目录: ${__dirname}`);
    logger.info(`📁 index.html路径: ${indexPath}`);
    logger.info(`📁 index.html存在: ${fs.existsSync(indexPath)}`);
    
    server.listen(PORT, () => {
        logger.info(`🚀 Vibe Meeting 服务器运行在端口 ${PORT}`);
        logger.info(`📡 Socket.IO 服务已启动`);
        logger.info(`💾 数据库状态: ${mongoose.connection.readyState === 1 ? '已连接' : '使用内存存储'}`);
        logger.info(`🌍 环境: ${process.env.NODE_ENV || 'development'}`);
    });
};

startServer().catch(console.error);

// 优雅关闭
process.on('SIGTERM', async () => {
    logger.info('收到SIGTERM信号，正在关闭服务器...');
    server.close(() => {
        mongoose.connection.close();
        process.exit(0);
    });
});

process.on('SIGINT', async () => {
    logger.info('收到SIGINT信号，正在关闭服务器...');
    server.close(() => {
        mongoose.connection.close();
        process.exit(0);
    });
});