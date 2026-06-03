from sqlalchemy import Column, Integer, String, Text, DateTime, func

from app.database import Base


class MediaFile(Base):
    __tablename__ = "media_files"

    id = Column(Integer, primary_key=True, autoincrement=True)
    msgid = Column(String(255), nullable=False, index=True)
    media_type = Column(String(50), nullable=False)
    media_id = Column(String(255), nullable=False)
    file_path = Column(String(512), nullable=True)
    file_size = Column(Integer, nullable=True)
    file_format = Column(String(50), nullable=True)
    transcription = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
