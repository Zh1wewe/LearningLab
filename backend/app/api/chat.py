import logging
import sys
from typing import AsyncGenerator, Optional
from fastapi import APIRouter, Header, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
import asyncio
import json
from app.core.agent import stream_chat, run_agent_with_tools
from app.core.token_manager import manage_context
from app.config import settings
from app.database import get_db, SessionLocal
from app.models.conversation import Conversation, Message
from app.core.knowledge import get_pending_verification_documents

logger = logging.getLogger(__name__)
router = APIRouter()


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    model: str = "deepseek-chat"


async def sse_format(generator: AsyncGenerator[str, None]) -> AsyncGenerator[str, None]:
    async for chunk in generator:
        yield f"data: {chunk}\n\n"


# ---------------------------------------------------------------------------
# 辅助函数 — 在 chat_endpoint 外部，避免局部 import 污染函数作用域
# ---------------------------------------------------------------------------
def _get_conversation_summary(session_id: str) -> Optional[str]:
    """从数据库获取对话摘要（安全函数，避免 UnboundLocalError）"""
    try:
        conv_id = int(session_id)
        db = SessionLocal()
        conv = db.query(Conversation).filter(Conversation.id == conv_id).first()
        db.close()
        if conv and conv.summary:
            return conv.summary
    except Exception:
        pass
    return None


def _save_assistant_message(conversation_id: int, text: str) -> None:
    """保存助手消息到数据库"""
    try:
        db = SessionLocal()
        conv = db.query(Conversation).filter(Conversation.id == conversation_id).first()
        if conv:
            db.add(Message(conversation_id=conversation_id, role="assistant", content=text))
            conv.message_count += 1
            if conv.message_count - (conv.summarized_message_count or 0) >= settings.SUMMARY_TRIGGER_COUNT:
                logger.info(f"Incremental summary triggered for conversation {conversation_id}")
                asyncio.create_task(_trigger_summary(conversation_id))
            db.commit()
    except Exception as exc:
        logger.error(f"Failed to save assistant message: {exc}")
    finally:
        try:
            db.close()
        except Exception:
            pass


async def _trigger_summary(conv_id: int):
    from app.api.conversation import summarize_conversation
    db = SessionLocal()
    try:
        await summarize_conversation(conv_id, db)
    finally:
        db.close()


# ---------------------------------------------------------------------------
# POST /api/chat
# ---------------------------------------------------------------------------
@router.post("/chat")
async def chat_endpoint(
    request: ChatRequest,
    raw_request: Request,
    x_session_id: Optional[str] = Header(None, alias="X-Session-ID"),
    x_conversation_id: Optional[str] = Header(None, alias="X-Conversation-ID"),
    x_force_search: Optional[str] = Header(None, alias="X-Force-Search"),
    db: Session = Depends(get_db),
):
    print(f"[CHAT] Request received, session={x_session_id}, conv={x_conversation_id}, force={x_force_search}", flush=True)
    logger.info(f"[CHAT] Incoming chat request. session={x_session_id}, conv={x_conversation_id}")

    # --- 1. 查找或创建对话 ---
    conversation = None
    if x_conversation_id and x_conversation_id.isdigit():
        conversation = db.query(Conversation).filter(
            Conversation.id == int(x_conversation_id)
        ).first()

    if not conversation:
        user_content = request.messages[-1].content if request.messages else ""
        title = "新对话"
        if user_content:
            title = user_content[:50] + "..." if len(user_content) > 50 else user_content
        conversation = Conversation(title=title, model=request.model)
        db.add(conversation)
        db.commit()
        db.refresh(conversation)

    # --- 2. 保存用户消息 ---
    if request.messages:
        latest = request.messages[-1]
        db.add(Message(conversation_id=conversation.id, role=latest.role, content=latest.content))
        conversation.message_count += 1
        db.commit()

    # --- 3. 构建消息列表 ---
    messages_dict = [msg.model_dump() for msg in request.messages]

    SYSTEM_INSTRUCTION = {
        "role": "system",
        "content": (
            "你是一个学习助手，可以调用以下工具：\n"
            "1. search_knowledge_base - 搜索本地知识库\n"
            "2. web_search - 联网搜索最新信息\n"
            "3. generate_learning_plan - 生成学习计划\n\n"
            "重要规则：\n"
            "- 当用户要求搜索、查找最新信息或论文时，必须使用 web_search 工具，不要直接回答或建议用户自己去搜。\n"
            "- 当用户要求制定学习计划时，必须使用 generate_learning_plan 工具。\n"
            "- 当用户询问某个概念且本地知识库可能有相关内容时，使用 search_knowledge_base 工具。"
        ),
    }

    # 待验证知识
    pending_docs_text = ""
    if settings.AUTO_VERIFY_CREDIBILITY:
        pending_docs = get_pending_verification_documents(limit=5)
        if pending_docs:
            docs_json = [{"id": d["id"], "content": d["content"]} for d in pending_docs]
            pending_docs_text = "\n\n待验证知识列表: " + json.dumps(docs_json, ensure_ascii=False)
    if pending_docs_text:
        SYSTEM_INSTRUCTION["content"] += pending_docs_text

    if not messages_dict or messages_dict[0].get("role") != "system":
        messages_dict.insert(0, SYSTEM_INSTRUCTION)

    # --- 4. 强制联网 ---
    force_search = settings.FORCE_WEB_SEARCH
    if not force_search:
        force_header = raw_request.headers.get("X-Force-Search", "").lower()
        force_search = force_header == "true"

    if settings.AUTO_VERIFY_CREDIBILITY:
        user_msg = request.messages[-1].content if request.messages else ""
        if any(kw in user_msg for kw in ("验证", "确认", "查一下")):
            force_search = True

    if force_search:
        messages_dict.insert(0, {"role": "system", "content": "【强制搜索指令】"})
        summary = _get_conversation_summary(x_session_id) if x_session_id else None
        if summary:
            messages_dict.insert(1, {"role": "system", "content": f"【对话摘要】{summary}"})

    # --- 5. 执行 Agent ---
    try:
        compressed_messages = manage_context(messages_dict, max_tokens=settings.MAX_CONTEXT_TOKENS)
        processed_messages = await run_agent_with_tools(compressed_messages, request.model)
    except Exception as e:
        print(f"[CHAT] Agent error: {type(e).__name__}: {e}", flush=True)
        logger.error(f"Agent execution failed: {type(e).__name__}: {e}", exc_info=True)
        error_msg = f"[Error] 服务处理异常: {type(e).__name__}: {e}"

        async def error_stream():
            yield f"[CONV_ID:{conversation.id}]"
            for ch in error_msg:
                yield ch

        return StreamingResponse(
            sse_format(error_stream()),
            media_type="text/event-stream",
            headers={"X-Conversation-ID": str(conversation.id)},
        )

    # --- 6. 提取助手回复 ---
    final_answer = ""
    for msg in reversed(processed_messages):
        if msg.get("role") == "assistant" and msg.get("content"):
            final_answer = msg["content"]
            break

    if not final_answer:
        logger.warning("No assistant content found, falling back to stream_chat.")

        async def fallback_stream():
            yield f"[CONV_ID:{conversation.id}]"
            generated = ""
            async for chunk in stream_chat(processed_messages, request.model):
                generated += chunk
                yield chunk
            _save_assistant_message(conversation.id, generated)

        return StreamingResponse(
            sse_format(fallback_stream()),
            media_type="text/event-stream",
            headers={"X-Conversation-ID": str(conversation.id)},
        )

    # --- 7. 返回结果 ---
    async def content_stream(text: str):
        yield f"[CONV_ID:{conversation.id}]"
        chunk_size = 5
        for i in range(0, len(text), chunk_size):
            yield text[i : i + chunk_size]
            await asyncio.sleep(0.01)
        _save_assistant_message(conversation.id, text)

    return StreamingResponse(
        sse_format(content_stream(final_answer)),
        media_type="text/event-stream",
        headers={"X-Conversation-ID": str(conversation.id)},
    )