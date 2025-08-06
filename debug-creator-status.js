#!/usr/bin/env node

console.log('🔍 创建者状态调试工具');
console.log('====================');

// 模拟浏览器环境
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

// 创建虚拟DOM环境
const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<head>
    <title>Creator Status Debug</title>
</head>
<body>
    <div id="participantsList"></div>
    <div id="debugInfo"></div>
</body>
</html>
`, { url: 'http://localhost:8080' });

global.window = dom.window;
global.document = dom.window.document;

// 模拟变量
let participants = [];
let currentUserId = 'user-123';
let currentUsername = '测试用户';

// 模拟房间信息
window.currentRoomInfo = {
    roomId: 'test-room',
    creatorId: 'user-123',
    createdAt: Date.now()
};

window.isCreator = true;

// 模拟参与者数据
participants = [
    { userId: 'user-123', name: '测试用户', status: 'online' },
    { userId: 'user-456', name: '其他用户', status: 'online' },
    { userId: 'user-789', name: '第三个用户', status: 'online' }
];

// 模拟参与者渲染函数
function renderFilteredParticipants(filteredParticipants) {
    const participantsList = document.getElementById('participantsList');
    const debugInfo = document.getElementById('debugInfo');
    
    participantsList.innerHTML = '';
    
    if (filteredParticipants.length === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'empty-participants';
        emptyDiv.innerHTML = '<p>暂无在线成员</p>';
        participantsList.appendChild(emptyDiv);
        return;
    }
    
    // 对参与者进行排序：当前用户第一，创建者第二，其他按原顺序
    const sortedParticipants = [...filteredParticipants].sort((a, b) => {
        const aIsCurrentUser = a.userId === currentUserId;
        const bIsCurrentUser = b.userId === currentUserId;
        const aIsCreator = window.currentRoomInfo && a.userId === window.currentRoomInfo.creatorId;
        const bIsCreator = window.currentRoomInfo && b.userId === window.currentRoomInfo.creatorId;
        
        // 当前用户始终排在第一位
        if (aIsCurrentUser && !bIsCurrentUser) return -1;
        if (!aIsCurrentUser && bIsCurrentUser) return 1;
        
        // 如果当前用户就是创建者，直接保持顺序
        if (aIsCurrentUser && bIsCurrentUser) return 0;
        
        // 在非当前用户中，创建者排在第二位
        if (aIsCreator && !bIsCreator) return -1;
        if (!aIsCreator && bIsCreator) return 1;
        
        // 其他按原顺序
        return 0;
    });
    
    sortedParticipants.forEach((participant, index) => {
        const participantDiv = document.createElement('div');
        participantDiv.className = 'participant';
        
        const initials = participant.name.charAt(0).toUpperCase();
        const isCurrentUser = participant.userId === currentUserId;
        const isCreator = window.currentRoomInfo && participant.userId === window.currentRoomInfo.creatorId;
        
        // 确定显示标签
        let userTag = '';
        if (isCurrentUser && isCreator) {
            userTag = '(我·创建者)';
        } else if (isCurrentUser) {
            userTag = '(我)';
        } else if (isCreator) {
            userTag = '(创建者)';
        }
        
        participantDiv.innerHTML = `
            <div class="participant-avatar">
                ${initials}
            </div>
            <div class="participant-info">
                <div class="participant-name">
                    ${participant.name} ${userTag}
                </div>
                <div class="participant-status ${participant.status}">
                    ${participant.status === 'online' ? '在线' : '离线'}
                </div>
            </div>
        `;
        
        participantsList.appendChild(participantDiv);
    });
    
    // 如果当前用户是创建者，在参与者列表下方添加结束会议按钮
    if (window.isCreator) {
        const endMeetingDiv = document.createElement('div');
        endMeetingDiv.className = 'creator-actions';
        endMeetingDiv.innerHTML = `
            <button id="endMeetingBtn" class="btn-end-meeting">
                结束会议
            </button>
            <p class="creator-note">结束会议将清空所有聊天记录和文件</p>
        `;
        participantsList.appendChild(endMeetingDiv);
        console.log('✅ 创建者按钮已添加');
    } else {
        console.log('❌ 当前用户不是创建者，不显示结束会议按钮');
    }
    
    // 更新调试信息
    debugInfo.innerHTML = `
        <strong>调试信息:</strong><br>
        window.isCreator: ${window.isCreator}<br>
        window.currentRoomInfo: ${JSON.stringify(window.currentRoomInfo)}<br>
        currentUserId: ${currentUserId}<br>
        creatorId: ${window.currentRoomInfo ? window.currentRoomInfo.creatorId : 'undefined'}<br>
        参与者数量: ${filteredParticipants.length}
    `;
}

// 测试场景
console.log('\n🧪 开始测试创建者状态...\n');

// 场景1: 当前用户是创建者
console.log('📋 场景1: 当前用户是创建者');
window.isCreator = true;
window.currentRoomInfo = {
    roomId: 'test-room',
    creatorId: 'user-123',
    createdAt: Date.now()
};
renderFilteredParticipants(participants);
console.log('HTML输出:', document.getElementById('participantsList').innerHTML);

// 场景2: 当前用户不是创建者
console.log('\n📋 场景2: 当前用户不是创建者');
window.isCreator = false;
window.currentRoomInfo = {
    roomId: 'test-room',
    creatorId: 'user-456',
    createdAt: Date.now()
};
renderFilteredParticipants(participants);
console.log('HTML输出:', document.getElementById('participantsList').innerHTML);

// 场景3: 没有房间信息
console.log('\n📋 场景3: 没有房间信息');
window.isCreator = false;
window.currentRoomInfo = null;
renderFilteredParticipants(participants);
console.log('HTML输出:', document.getElementById('participantsList').innerHTML);

console.log('\n✅ 调试完成！');
console.log('\n💡 问题分析:');
console.log('1. 检查 window.isCreator 是否正确设置');
console.log('2. 检查 window.currentRoomInfo 是否存在');
console.log('3. 检查实时通信是否正确连接');
console.log('4. 检查服务器是否正确返回房间信息'); 