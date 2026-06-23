from sqlalchemy import Column, Integer, String, Text
from .base import Base

class Document(Base):
    __tablename__ = "documents"

    title = Column(String(255), nullable=False, comment="文档标题/书名")
    source = Column(String(500), nullable=True, comment="来源文件名或URL")
    file_path = Column(String(1000), nullable=True, comment="本地文件路径")
    chunk_count = Column(Integer, default=0, comment="该文档被切分的片段总数")
    overview = Column(Text, nullable=True, comment="文档简介/摘要（可选）")