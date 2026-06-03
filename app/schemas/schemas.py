from pydantic import BaseModel, Field
from typing import Optional, Any


class MessageCreate(BaseModel):
    msgid: str
    msg_type: str
    open_kfid: str
    external_userid: Optional[str] = None
    send_time: int
    origin: Optional[int] = None
    raw_content: Optional[str] = None


class MessageOut(MessageCreate):
    id: int
    project_id: Optional[int] = None
    created_at: Any = None

    model_config = {"from_attributes": True}


class AnalysisOut(BaseModel):
    id: int
    msgid: str
    category: str
    summary: str = Field(description="AI生成的描述（20字以内）")
    tags: Optional[Any] = None
    confidence: Optional[float] = None
    model_used: Optional[str] = None
    raw_response: Optional[str] = None
    created_at: Any = None

    model_config = {"from_attributes": True, "populate_by_name": True}


class MediaFileOut(BaseModel):
    id: int
    msgid: str
    media_type: str
    media_id: str
    file_path: Optional[str] = None
    file_size: Optional[int] = None
    file_format: Optional[str] = None
    transcription: Optional[str] = None

    model_config = {"from_attributes": True}
