from sqlalchemy import Column, Integer, String, Text, Float, DateTime, func

from app.database import Base


class Analysis(Base):
    __tablename__ = "analyses"

    id = Column(Integer, primary_key=True, autoincrement=True)
    msgid = Column(String(255), unique=True, nullable=False, index=True)
    category = Column(String(100), nullable=False)
    summary = Column(String(500), nullable=False)
    tags = Column(Text, nullable=True)
    confidence = Column(Float, nullable=True)
    model_used = Column(String(255), nullable=True)
    raw_response = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
