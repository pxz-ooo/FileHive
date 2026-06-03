from sqlalchemy import Column, Integer, String, Text, Float, DateTime, func, ForeignKey

from app.database import Base


class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    msgid = Column(String(255), unique=True, nullable=False, index=True)
    msg_type = Column(String(50), nullable=False)
    open_kfid = Column(String(128), nullable=False)
    external_userid = Column(String(128), nullable=True)
    send_time = Column(Integer, nullable=False)
    origin = Column(Integer, nullable=True)
    raw_content = Column(Text, nullable=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=True, index=True)
    created_at = Column(DateTime, server_default=func.now())
