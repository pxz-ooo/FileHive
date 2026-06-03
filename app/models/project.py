from sqlalchemy import Column, Integer, String, DateTime, func

from app.database import Base


class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), unique=True, nullable=False)
    color = Column(String(20), default="#0052d9")
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, server_default=func.now())
