from sqlalchemy import Column, String, Text
from .base import Base

class RerankCache(Base):
    __tablename__ = "rerank_cache"

    cache_key = Column(String(64), unique=True, index=True, comment="MD5 哈希缓存键")
    doc_ids = Column(Text, comment="JSON 数组字符串，存储相关文档 ID 列表")