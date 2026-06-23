import os
import logging
import json
import hashlib
from typing import List, Optional
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from pydantic import BaseModel
from typing import Dict, Any
from sqlalchemy.orm import Session

from app.core import knowledge
from app.core.agent import llm_evaluate_credibility
from app.tools.web_search import web_search
from app.database import get_db, SessionLocal
from app.models.document import Document
from app.models.rerank_cache import RerankCache
from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter()

UPLOAD_DIR = os.path.join(settings.DATABASE_URL.replace("sqlite:///", ""), "../uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

ALLOWED_EXTENSIONS = {".txt", ".md", ".pdf"}


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class AddDocumentRequest(BaseModel):
    text: str
    metadata: Dict[str, Any]


class SearchRequest(BaseModel):
    query: str
    top_k: Optional[int] = None


class ImportRequest(BaseModel):
    file_path: str


class UpdateRequest(BaseModel):
    text: str
    metadata: Dict[str, Any] = {}


class VerifyRequest(BaseModel):
    chunk_ids: Optional[List[str]] = None
    limit: int = 10


class SearchDocsRequest(BaseModel):
    query: str


class RerankRequest(BaseModel):
    query: str
    documents: List[Dict[str, str]]


# ---------------------------------------------------------------------------
# 基础
# ---------------------------------------------------------------------------
@router.post("/add")
async def add_document(request: AddDocumentRequest):
    chunks_added = knowledge.add_document(request.text, request.metadata)
    return {"status": "ok", "chunks_added": chunks_added}


@router.post("/search")
async def search_knowledge(request: SearchRequest):
    results = knowledge.search_knowledge(request.query, request.top_k)
    return results


@router.post("/import")
async def import_knowledge(request: ImportRequest):
    chunks_added = knowledge.add_documents_from_file(request.file_path)
    return {"status": "ok", "chunks_added": chunks_added}


@router.put("/{chunk_id}")
async def update_document(chunk_id: str, request: UpdateRequest):
    success = knowledge.update_document(chunk_id, request.text, request.metadata)
    if not success:
        return {"status": "not_found", "message": f"Chunk {chunk_id} not found"}
    return {"status": "ok", "message": f"Chunk {chunk_id} updated"}


# NOTE: 以下两个文档级路由（/documents/{doc_id}, /documents）必须放在 /{chunk_id} 之前，
# 否则 FastAPI 会将 /documents 误匹配为 /{chunk_id} 参数。
@router.delete("/documents/{doc_id}")
def delete_document_record(doc_id: int, db: Session = Depends(get_db)):
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.source:
        knowledge.delete_chunks_by_source(doc.source)

    # 删除磁盘上的物理文件
    if doc.file_path and os.path.exists(doc.file_path):
        try:
            os.remove(doc.file_path)
            logger.info(f"Deleted file: {doc.file_path}")
        except Exception as exc:
            logger.error(f"Failed to delete file {doc.file_path}: {exc}")

    db.delete(doc)
    db.commit()
    return {"status": "ok", "message": f"Document {doc_id} deleted"}


@router.delete("/{chunk_id}")
async def delete_chunk(chunk_id: str):
    success = knowledge.delete_document(chunk_id)
    if not success:
        return {"status": "not_found", "message": f"Chunk {chunk_id} not found"}
    return {"status": "ok", "message": f"Chunk {chunk_id} deleted"}


# ---------------------------------------------------------------------------
# 批量验证
# ---------------------------------------------------------------------------
def _make_search_summary(content: str, max_len: int = 200) -> str:
    if not content:
        return ""
    first_period = content.find("。")
    if first_period > 0:
        summary = content[:first_period]
    else:
        summary = content
    if len(summary) > max_len:
        summary = summary[:max_len]
    return summary


@router.post("/verify")
async def verify_knowledge_entries(request: VerifyRequest):
    if request.chunk_ids:
        col = knowledge.get_collection()
        raw = col.get(ids=request.chunk_ids)
        items = []
        if raw.get("documents"):
            for i, doc in enumerate(raw["documents"]):
                meta = raw.get("metadatas", [])[i] if raw.get("metadatas") else {}
                item_id = raw.get("ids", [])[i] if raw.get("ids") else None
                items.append({"id": item_id, "content": doc, "metadata": meta})
    else:
        items = knowledge.get_pending_verification_items(limit=request.limit)

    total = len(items)
    upgraded = 0
    downgraded = 0
    kept = 0
    errors: list[str] = []

    logger.info(f"Starting batch verification for {total} items")

    for item in items:
        chunk_id = item.get("id")
        content = item.get("content", "")
        if not chunk_id or not content:
            continue
        try:
            summary = _make_search_summary(content)
            search_results = web_search(summary, max_results=5)
            action = await llm_evaluate_credibility(content, search_results)
            if action == "upgrade":
                knowledge.upgrade_credibility(chunk_id, "batch_verification")
                upgraded += 1
                logger.info(f"Batch verify: upgraded {chunk_id}")
            elif action == "downgrade":
                knowledge.downgrade_credibility(chunk_id)
                downgraded += 1
                logger.info(f"Batch verify: downgraded {chunk_id}")
            else:
                kept += 1
                logger.info(f"Batch verify: kept {chunk_id}")
        except Exception as exc:
            errors.append(f"{chunk_id}: {type(exc).__name__}: {exc}")
            logger.error(f"Batch verify error on {chunk_id}: {exc}")

    logger.info(
        f"Batch verification complete: total={total}, upgraded={upgraded}, "
        f"downgraded={downgraded}, kept={kept}, errors={len(errors)}"
    )

    return {
        "total": total,
        "upgraded": upgraded,
        "downgraded": downgraded,
        "kept": kept,
        "errors": errors,
    }


# ---------------------------------------------------------------------------
# 书库：文档搜索
# ---------------------------------------------------------------------------
@router.post("/search-docs")
def search_documents(request: SearchDocsRequest, db: Session = Depends(get_db)):
    docs = (
        db.query(Document)
        .filter(Document.title.like(f"%{request.query}%"))
        .order_by(Document.created_at.desc())
        .limit(10)
        .all()
    )
    return [
        {
            "id": d.id,
            "title": d.title,
            "source": d.source,
            "file_path": d.file_path,
            "chunk_count": d.chunk_count,
            "created_at": d.created_at.isoformat() if d.created_at else None,
        }
        for d in docs
    ]


# ---------------------------------------------------------------------------
# LLM 重排序
# ---------------------------------------------------------------------------
def _md5(text: str) -> str:
    return hashlib.md5(text.encode("utf-8")).hexdigest()


def _parse_json_answer(raw: str) -> dict:
    """从 LLM 响应中提取 JSON 对象"""
    text = raw.strip()
    if text.startswith("```"):
        text = text.strip("`").strip()
        if text.startswith("json"):
            text = text[4:].strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # 尝试从文本中提取 JSON 子串
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            try:
                return json.loads(text[start:end + 1])
            except json.JSONDecodeError:
                pass
        return {}


async def _inject_keywords_cn(doc_ids: list[str], query: str):
    """对首个相关 chunk 调 LLM 提取中文关键词，注入到所有关联 chunk 的 metadata"""
    if not doc_ids:
        return []
    # 取第一个 chunk 的内容调用 LLM
    col = knowledge.get_collection()
    raw = col.get(ids=[doc_ids[0]])
    content = ""
    if raw.get("documents") and raw["documents"]:
        content = raw["documents"][0][:500]

    if not content:
        return []

    prompt = (
        "你是一个翻译和关键词提取助手。\n\n"
        "以下是一段英文文献片段，请：\n"
        "1. 提取 3-8 个最核心的技术术语\n"
        "2. 将每个术语翻译为中文\n"
        "3. 输出严格的 JSON 格式\n\n"
        f"文献内容：\n{content}\n\n"
        '输出格式：\n'
        '{"language":"en","keywords_cn":["注意力机制","自注意力","Transformer"]}\n\n'
        "要求：\n"
        "- keywords_cn 是中文术语列表\n"
        "- language 固定为 \"en\"（表示原文是英文）\n"
        "- 只输出 JSON，不要额外解释"
    )

    try:
        from app.core.agent import client as llm_client
        response = await llm_client.chat.completions.create(
            model=settings.DEFAULT_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
        )
        result = _parse_json_answer(response.choices[0].message.content)
        keywords = result.get("keywords_cn", [])
        language = result.get("language", "en")

        # 注入到所有关联 chunk 的 metadata
        kw_json = json.dumps(keywords, ensure_ascii=False)
        for chunk_id in doc_ids:
            try:
                existing = col.get(ids=[chunk_id])
                if existing and existing.get("metadatas") and len(existing["metadatas"]) > 0:
                    meta = existing["metadatas"][0]
                    meta["keywords_cn"] = kw_json
                    meta["language"] = language
                    col.update(ids=[chunk_id], metadatas=[meta])
            except Exception as exc:
                logger.error(f"Failed to inject keywords for {chunk_id}: {exc}")

        logger.info(f"Injected keywords_cn={keywords} into {len(doc_ids)} chunks")
        return keywords
    except Exception as exc:
        logger.error(f"Keyword extraction failed: {exc}")
        return []


@router.post("/rerank")
async def rerank_knowledge(request: RerankRequest):
    cache_key = _md5(request.query)

    db = SessionLocal()
    try:
        cached = db.query(RerankCache).filter(RerankCache.cache_key == cache_key).first()
        if cached:
            try:
                doc_ids = json.loads(cached.doc_ids)
                return {"doc_ids": doc_ids}
            except Exception:
                pass
    finally:
        db.close()

    if not request.documents:
        return {"doc_ids": []}

    # 构造 JSON 约束的 rerank prompt
    docs_text = ""
    for i, doc in enumerate(request.documents):
        summary = doc.get("content", "")[:300]
        docs_text += f"  \"{doc.get('id', '')}\": \"{summary}\",\n"
    docs_text = docs_text.rstrip(",\n")

    prompt = (
        f'用户查询：{request.query}\n\n'
        f'请判断以下文档片段是否与用户查询直接相关。\n\n'
        f'文档列表（JSON 格式）：\n'
        f'{{\n{docs_text}\n}}\n\n'
        f'以 JSON 格式回答，严格遵循以下结构：\n\n'
        f'{{\n'
        f'  "relevant_ids": ["id1", "id2"],\n'
        f'  "reason": "简要说明判断依据"\n'
        f'}}\n\n'
        f'要求：\n'
        f'- relevant_ids 仅包含判定为相关的文档 ID 列表，如果不相关则为空数组\n'
        f'- 只输出 JSON，不要额外解释'
    )

    doc_ids = []
    reason = ""
    try:
        from app.core.agent import client as llm_client
        response = await llm_client.chat.completions.create(
            model=settings.DEFAULT_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
        )
        result = _parse_json_answer(response.choices[0].message.content)
        doc_ids = result.get("relevant_ids", [])
        reason = result.get("reason", "")
        logger.info(f"Rerank result: {len(doc_ids)} relevant docs, reason: {reason[:100]}")
    except Exception as exc:
        logger.error(f"LLM rerank failed: {exc}")
        doc_ids = [d.get("id", "") for d in request.documents]

    # 写入缓存
    try:
        db = SessionLocal()
        db.add(RerankCache(cache_key=cache_key, doc_ids=json.dumps(doc_ids, ensure_ascii=False)))
        db.commit()
        db.close()
    except Exception as exc:
        logger.error(f"Failed to write rerank cache: {exc}")

    # 自动提取中文关键词（针对英文文献）
    if doc_ids:
        asyncio = __import__("asyncio")
        asyncio.create_task(_inject_keywords_cn(doc_ids, request.query))

    return {"doc_ids": doc_ids}


# ---------------------------------------------------------------------------
# 文件上传
# ---------------------------------------------------------------------------
@router.post("/upload")
async def upload_file(file: UploadFile = File(...), title: Optional[str] = Form(None)):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"不支持的文件格式: {ext}。支持: {', '.join(ALLOWED_EXTENSIONS)}")

    import time as _time
    timestamp = str(int(_time.time()))
    safe_name = f"{timestamp}_{file.filename}"
    save_path = os.path.join(UPLOAD_DIR, safe_name)

    content_bytes = await file.read()
    with open(save_path, "wb") as f:
        f.write(content_bytes)

    source_name = title or os.path.splitext(file.filename or "untitled")[0]
    import asyncio as _asyncio
    chunks_added = await _asyncio.to_thread(
        knowledge.add_documents_from_file, save_path, source_name
    )

    return {
        "status": "ok",
        "file_name": file.filename,
        "chunks_added": chunks_added,
        "saved_path": save_path,
    }


# ---------------------------------------------------------------------------
# 文件访问
# ---------------------------------------------------------------------------
@router.get("/file/{file_path:path}")
async def serve_file(file_path: str):
    """提供已上传文件的下载/查看"""
    full_path = os.path.abspath(file_path)
    # 安全检查：只允许 uploads 目录中的文件
    if not os.path.exists(full_path):
        raise HTTPException(status_code=404, detail="文件不存在")
    from fastapi.responses import FileResponse
    return FileResponse(full_path)


# ---------------------------------------------------------------------------
# 文档列表
# ---------------------------------------------------------------------------
@router.get("/documents")
def list_documents(db: Session = Depends(get_db)):
    docs = db.query(Document).order_by(Document.created_at.desc()).all()
    return [
        {
            "id": d.id,
            "title": d.title,
            "source": d.source,
            "file_path": d.file_path,
            "chunk_count": d.chunk_count,
            "created_at": d.created_at.isoformat() if d.created_at else None,
        }
        for d in docs
    ]


