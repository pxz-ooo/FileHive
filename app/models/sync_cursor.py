from sqlalchemy import Column, Integer, String, DateTime, func

from app.database import Base


class SyncCursor(Base):
    __tablename__ = "sync_cursors"

    id = Column(Integer, primary_key=True, autoincrement=True)
    open_kfid = Column(String(128), unique=True, nullable=False)
    cursor = Column(String(255), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
