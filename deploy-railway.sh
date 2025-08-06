#!/bin/bash

# Railway部署脚本
echo "🚀 开始部署到Railway..."

# 检查Railway CLI是否安装
if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI未安装，请先安装: npm install -g @railway/cli"
    exit 1
fi

# 检查是否已登录
if ! railway whoami &> /dev/null; then
    echo "❌ 请先登录Railway: railway login"
    exit 1
fi

# 构建项目
echo "📦 构建项目..."
npm run build

# 部署到Railway
echo "🚂 部署到Railway..."
railway up

echo "✅ 部署完成！"
echo "🌐 访问地址: https://$(railway domain)" 