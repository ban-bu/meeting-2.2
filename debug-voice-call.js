#!/usr/bin/env node

console.log('🔍 语音通话调试工具');
console.log('==================');

// 模拟浏览器环境
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

// 创建虚拟DOM环境
const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<head>
    <title>Voice Call Debug</title>
</head>
<body>
    <div id="callParticipantsList"></div>
    <div id="callParticipants">0 人参与</div>
</body>
</html>
`, { url: 'http://localhost:8080' });

global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;

// 模拟语音通话相关变量
let callParticipants = new Set();
let participants = [];
let currentUserId = 'user-123';
let currentUsername = '测试用户';

// 模拟参与者数据
participants = [
    { userId: 'user-123', name: '测试用户', status: 'online' },
    { userId: 'user-456', name: '其他用户', status: 'online' },
    { userId: 'user-789', name: '第三个用户', status: 'online' }
];

// 模拟语音通话参与者更新函数
function updateCallParticipants() {
    const participantsList = document.getElementById('callParticipantsList');
    const participantsCount = document.getElementById('callParticipants');
    
    if (!participantsList) {
        console.log('❌ 找不到 callParticipantsList 元素');
        return;
    }
    
    participantsList.innerHTML = '';
    
    // 添加当前用户
    const currentUserDiv = document.createElement('div');
    currentUserDiv.className = 'call-participant';
    currentUserDiv.innerHTML = `
        <div class="call-participant-avatar">${currentUsername.charAt(0).toUpperCase()}</div>
        <div class="call-participant-info">
            <div class="call-participant-name">${currentUsername} (我)</div>
            <div class="call-participant-status online">
                <i class="fas fa-microphone"></i>
                在线
            </div>
        </div>
    `;
    participantsList.appendChild(currentUserDiv);
    
    // 添加其他参与者
    let otherParticipantsCount = 0;
    callParticipants.forEach(participantId => {
        if (participantId !== currentUserId) {
            // 首先尝试从参与者列表中找到
            let participant = participants.find(p => p.userId === participantId);
            
            // 如果找不到，创建一个临时的参与者对象
            if (!participant) {
                participant = {
                    userId: participantId,
                    name: `用户${participantId.slice(-4)}`, // 使用用户ID的后4位作为显示名
                    status: 'online'
                };
            }
            
            const participantDiv = document.createElement('div');
            participantDiv.className = 'call-participant';
            participantDiv.innerHTML = `
                <div class="call-participant-avatar">${participant.name.charAt(0).toUpperCase()}</div>
                <div class="call-participant-info">
                    <div class="call-participant-name">${participant.name}</div>
                    <div class="call-participant-status online">
                        <i class="fas fa-microphone"></i>
                        在线
                    </div>
                </div>
            `;
            participantsList.appendChild(participantDiv);
            otherParticipantsCount++;
        }
    });
    
    // 更新参与者数量
    if (participantsCount) {
        const totalParticipants = callParticipants.size;
        participantsCount.textContent = `${totalParticipants} 人参与`;
        
        console.log(`📞 通话参与者更新:`, {
            callParticipantsSize: callParticipants.size,
            callParticipantsIds: Array.from(callParticipants),
            participantsArrayLength: participants.length,
            participantsIds: participants.map(p => p.userId),
            otherParticipantsCount,
            currentUserId
        });
    }
}

// 测试场景
console.log('\n🧪 开始测试语音通话参与者显示...\n');

// 场景1: 只有当前用户
console.log('📋 场景1: 只有当前用户');
callParticipants.clear();
callParticipants.add(currentUserId);
updateCallParticipants();
console.log('HTML输出:', document.getElementById('callParticipantsList').innerHTML);
console.log('参与者数量:', document.getElementById('callParticipants').textContent);

// 场景2: 添加其他用户
console.log('\n📋 场景2: 添加其他用户');
callParticipants.add('user-456');
callParticipants.add('user-789');
updateCallParticipants();
console.log('HTML输出:', document.getElementById('callParticipantsList').innerHTML);
console.log('参与者数量:', document.getElementById('callParticipants').textContent);

// 场景3: 模拟实时通信
console.log('\n📋 场景3: 模拟实时通信');
console.log('模拟其他用户加入通话...');
callParticipants.add('user-999');
updateCallParticipants();
console.log('HTML输出:', document.getElementById('callParticipantsList').innerHTML);
console.log('参与者数量:', document.getElementById('callParticipants').textContent);

console.log('\n✅ 调试完成！');
console.log('\n💡 问题分析:');
console.log('1. 检查 callParticipants Set 是否正确添加用户');
console.log('2. 检查 participants 数组是否包含所有用户信息');
console.log('3. 检查 updateCallParticipants 函数是否正确调用');
console.log('4. 检查DOM元素是否存在'); 