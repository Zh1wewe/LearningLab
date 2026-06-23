from sqlalchemy import Column, String, Text
from .base import Base

class LearningPlan(Base):
    __tablename__ = "learning_plans"

    title = Column(String(255), nullable=False)
    overview = Column(Text, nullable=True)
    content = Column(Text, nullable=False)