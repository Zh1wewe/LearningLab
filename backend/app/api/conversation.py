from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
from app.database import get_db
from app.models.conversation import Conversation, Message
from app.config import settings

router = APIRouter()

class ConversationCreate(BaseModel):
    title: str = "新对话"
    model: Optional[str] = None

class MessageCreate(BaseModel):
    role: str
    content: str
    tokens: Optional[int] = None

class MessagesBatchCreate(BaseModel):
    messages: List[MessageCreate]

class ConversationUpdate(BaseModel):
    title: Optional[str] = None
    summary: Optional[str] = None

@router.get("/")
def get_conversations(db: Session = Depends(get_db)):
    conversations = db.query(Conversation).order_by(Conversation.created_at.desc()).all()
    return conversations

@router.get("/{conversation_id}")
def get_conversation_messages(conversation_id: int, db: Session = Depends(get_db)):
    messages = db.query(Message).filter(Message.conversation_id == conversation_id).order_by(Message.id.asc()).all()
    return messages

@router.post("/")
def create_conversation(req: ConversationCreate, db: Session = Depends(get_db)):
    conv = Conversation(title=req.title, model=req.model)
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return {"id": conv.id}

@router.post("/{conversation_id}/messages")
def add_messages(conversation_id: int, req: MessagesBatchCreate, db: Session = Depends(get_db)):
    conv = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
        
    for msg in req.messages:
        new_msg = Message(
            conversation_id=conversation_id,
            role=msg.role,
            content=msg.content,
            tokens=msg.tokens
        )
        db.add(new_msg)
    
    conv.message_count += len(req.messages)
    db.commit()
    return {"status": "success", "added": len(req.messages)}

@router.put("/{conversation_id}")
def update_conversation(conversation_id: int, req: ConversationUpdate, db: Session = Depends(get_db)):
    conv = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
        
    if req.title is not None:
        conv.title = req.title
    if req.summary is not None:
        conv.summary = req.summary
        
    db.commit()
    return {"status": "success"}

@router.delete("/{conversation_id}")
def delete_conversation(conversation_id: int, db: Session = Depends(get_db)):
    conv = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
        
    # Delete related messages
    db.query(Message).filter(Message.conversation_id == conversation_id).delete()
    
    db.delete(conv)
    db.commit()
    return {"status": "success"}

@router.post("/{conversation_id}/summarize")
async def summarize_conversation(conversation_id: int, db: Session = Depends(get_db)):
    conv = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
        
    messages = db.query(Message).filter(Message.conversation_id == conversation_id).order_by(Message.id.asc()).all()
    if not messages:
        return {"summary": ""}
        
    text_content = "\n".join([f"{m.role}: {m.content}" for m in messages]) # include all messages for context
    
    summary_prompt = f"""你是一个专业的学习记录摘要员。请根据以下对话内容生成一份学习摘要。
【规则】
1. 仅基于对话内容提炼，不要编造任何信息。
2. 如果对话内容很少，摘要可以简短到一两句话，不要强行拉长。
3. 如果对话内容丰富，请按以下结构组织：
   - 核心主题（1-2句话概括）
   - 关键结论或决策（列出具体内容）
   - 待解决问题（如有）
   - 重要代码或参数（如有引用则保留）
4. 摘要的总长度应与对话信息量匹配，不要超过300字。
5. 语言精炼，用中文输出。
【对话内容】
{text_content}"""
    
    try:
        from app.core.agent import _get_client_for_model
        llm = await _get_client_for_model(settings.DEFAULT_MODEL)
        response = await llm.chat.completions.create(
            model=settings.DEFAULT_MODEL,
            messages=[{"role": "user", "content": summary_prompt}]
        )
        if response.choices and len(response.choices) > 0:
            summary = response.choices[0].message.content
            if summary:
                from app.core.token_manager import truncate_text_by_tokens
                summary = summary.strip()
                summary = truncate_text_by_tokens(summary, settings.SUMMARY_MAX_TOKENS)
                
                conv.summary = summary
                conv.summarized_message_count = len(messages)
                db.commit()
                return {"summary": summary}
    except Exception as e:
        print("Error summarizing:", e)
        
    return {"summary": conv.summary}
