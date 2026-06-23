import os
import sys
import logging
import traceback
import chromadb
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager

from .config import settings
from .api import health, chat, knowledge, plan, conversation, models
from .database import engine
from .models.base import Base

# ---------------------------------------------------------------------------
# 日志配置：确保所有日志输出到控制台（stdout），uvicorn reload 时不会丢失
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stdout,
    force=True,  # 覆盖已有的 handler 配置
)
# 显式确保 uvicorn / fastapi 日志也走 stdout
for _name in ("uvicorn", "uvicorn.error", "uvicorn.access", "fastapi"):
    _lg = logging.getLogger(_name)
    _lg.handlers.clear()
    _lg.addHandler(logging.StreamHandler(sys.stdout))
    _lg.setLevel(logging.INFO)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Setup database tables
    Base.metadata.create_all(bind=engine)
    
    # Setup ChromaDB
    os.makedirs(settings.CHROMA_DB_PATH, exist_ok=True)
    chroma_client = chromadb.PersistentClient(path=settings.CHROMA_DB_PATH)
    app.state.chroma_client = chroma_client
    
    yield
    # Cleanup logic (if any) goes here

app = FastAPI(title=settings.PROJECT_NAME, lifespan=lifespan)

# ---------------------------------------------------------------------------
# 全局异常处理中间件：捕获所有未处理异常，输出到响应和控制台
# ---------------------------------------------------------------------------
@app.middleware("http")
async def catch_exceptions_middleware(request: Request, call_next):
    try:
        return await call_next(request)
    except Exception:
        exc_type, exc_value, exc_tb = sys.exc_info()
        tb_lines = traceback.format_exception(exc_type, exc_value, exc_tb)
        tb_text = "".join(tb_lines)
        print(f"\n{'='*60}\nUNHANDLED EXCEPTION in {request.method} {request.url.path}\n{tb_text}{'='*60}\n", flush=True)
        logging.getLogger("app").error(f"Unhandled exception: {tb_text}")
        return JSONResponse(
            status_code=500,
            content={
                "detail": f"{exc_type.__name__}: {exc_value}",
                "traceback": tb_text.split("\n"),
            },
        )

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix=settings.API_V1_STR)
app.include_router(chat.router, prefix=settings.API_V1_STR, tags=["Chat"])
app.include_router(knowledge.router, prefix=f"{settings.API_V1_STR}/knowledge", tags=["Knowledge"])
app.include_router(plan.router, prefix=f"{settings.API_V1_STR}/plan", tags=["Plan"])
app.include_router(conversation.router, prefix=f"{settings.API_V1_STR}/conversations", tags=["Conversations"])
app.include_router(models.router, prefix=f"{settings.API_V1_STR}/models", tags=["Models"])

# ---------------------------------------------------------------------------
# 移动端适配：如果有前端构建产物则直接提供静态页面
# ---------------------------------------------------------------------------
from fastapi.staticfiles import StaticFiles
_frontend_dist = os.path.join(os.path.dirname(__file__), "../../frontend/dist")
if os.path.exists(_frontend_dist):
    app.mount("/", StaticFiles(directory=_frontend_dist, html=True), name="frontend")
