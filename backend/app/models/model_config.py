from sqlalchemy import Column, String, Boolean
from .base import Base


class ModelConfig(Base):
    __tablename__ = "model_configs"

    name = Column(String(100), nullable=False, comment="显示名称")
    model_id = Column(String(100), nullable=False, comment="API 模型 ID")
    base_url = Column(String(500), nullable=False, comment="API 地址")
    api_key = Column(String(500), nullable=False, comment="API Key")
    is_default = Column(Boolean, default=False, comment="是否默认模型")