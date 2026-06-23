#!/data/data/com.termux/files/usr/bin/bash

echo "🚀 启动 LearningLab..."
cd "$(dirname "$0")/backend"

# 终止旧进程（如果存在）
pkill -f "uvicorn app.main:app" 2>/dev/null
sleep 1

# 启动后端（后台运行，日志输出到 learninglab.log）
nohup uvicorn app.main:app --host 0.0.0.0 --port 8000 > ../learninglab.log 2>&1 &
BACKEND_PID=$!

echo "⏳ 等待后端启动..."
sleep 3

# 检查后端是否成功启动
if kill -0 $BACKEND_PID 2>/dev/null; then
    echo "✅ 后端已启动 (PID: $BACKEND_PID)"
    echo "📱 可以通过 http://localhost:8000 访问"
else
    echo "❌ 后端启动失败，请查看 learninglab.log"
fi