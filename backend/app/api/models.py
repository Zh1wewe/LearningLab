import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
import asyncio
import time

from app.database import get_db, SessionLocal
from app.models.model_config import ModelConfig
from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter()


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class ModelConfigCreate(BaseModel):
    name: str
    model_id: str
    base_url: str
    api_key: str
    is_default: bool = False


class ModelConfigUpdate(BaseModel):
    name: Optional[str] = None
    model_id: Optional[str] = None
    base_url: Optional[str] = None
    api_key: Optional[str] = None
    is_default: Optional[bool] = None


class TestRequest(BaseModel):
    base_url: str
    api_key: str
    model_id: str


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------
@router.get("/")
def list_models(db: Session = Depends(get_db)):
    return db.query(ModelConfig).order_by(ModelConfig.created_at.desc()).all()


@router.post("/")
def create_model(req: ModelConfigCreate, db: Session = Depends(get_db)):
    model = ModelConfig(**req.dict())
    db.add(model)
    db.commit()
    db.refresh(model)
    return model


@router.put("/{model_id}")
def update_model(model_id: int, req: ModelConfigUpdate, db: Session = Depends(get_db)):
    model = db.query(ModelConfig).filter(ModelConfig.id == model_id).first()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    for key, value in req.dict(exclude_none=True).items():
        setattr(model, key, value)
    db.commit()
    return {"status": "ok"}


@router.delete("/{model_id}")
def delete_model(model_id: int, db: Session = Depends(get_db)):
    model = db.query(ModelConfig).filter(ModelConfig.id == model_id).first()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    db.delete(model)
    db.commit()
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# 测试连接
# ---------------------------------------------------------------------------
@router.post("/test")
async def test_model_connection(req: TestRequest):
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=req.api_key, base_url=req.base_url)
    start = time.time()
    try:
        resp = await asyncio.wait_for(
            client.chat.completions.create(
                model=req.model_id,
                messages=[{"role": "user", "content": "hi"}],
                max_tokens=5,
            ),
            timeout=10,
        )
        latency = int((time.time() - start) * 1000)
        return {"status": "ok", "latency_ms": latency}
    except asyncio.TimeoutError:
        return {"status": "error", "message": "连接超时（10秒）"}
    except Exception as e:
        return {"status": "error", "message": str(e)}