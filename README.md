# LearningLab

AI 辅助学习软件 - "大模型调试优化"

## 项目结构
- `/backend`: FastAPI Python 后端应用
- `/frontend`: React + TypeScript 前端应用

## 依赖安装

### 前端
进入 `frontend` 目录：
```bash
cd frontend
pnpm install
```

### 后端
进入 `backend` 目录，确保已安装 Poetry：
```bash
cd backend
poetry install
```

## 本地启动指南

### 1. 启动后端 (方法A：自带环境)
在 `backend` 目录下：
```bash
poetry run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```
访问 http://localhost:8000/docs 可以查看 API 文档。

### 1. 启动后端 (方法B：通过 Docker)
在项目根目录下，直接使用 Docker Compose 启动后端：
```bash
docker-compose up -d --build
```

### 2. 启动前端
在 `frontend` 目录下：
```bash
pnpm dev
```
打开浏览器访问前端地址 (通常为 http://localhost:5173)，页面中央将显示后端返回的 "OK" 状态。
