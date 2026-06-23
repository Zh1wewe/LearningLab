from sqlalchemy import Column, Integer, String, Text, DateTime
from sqlalchemy.sql import func
from .base import Base

class Conversation(Base):
    __tablename__ = "conversations"
    
    title = Column(String(255), nullable=False, default="新对话")
    summary = Column(Text, nullable=True)
    model = Column(String(100), nullable=True)
    system_prompt = Column(Text, nullable=True, comment="自定义系统提示词")
    model_config_id = Column(Integer, nullable=True, comment="关联的模型配置 ID")
    message_count = Column(Integer, default=0)
    summarized_message_count = Column(Integer, default=0)

class Message(Base):
    __tablename__ = "messages"
    
    conversation_id = Column(Integer, nullable=False, index=True)
    role = Column(String(50), nullable=False)
    content = Column(Text, nullable=False)
    tokens = Column(Integer, nullable=True)
