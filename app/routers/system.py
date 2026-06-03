from pathlib import Path

from fastapi import APIRouter
from sqlalchemy import func

from app.database import SessionLocal
from app.models.analysis import Analysis
from app.models.message import Message

from app.config import settings
from app.services.request_context import get_current_mimo_api_key

router = APIRouter(prefix="/system", tags=["system"])


@router.get("/runtime-status")
def runtime_status():
    request_key = get_current_mimo_api_key()
    server_key = settings.MIMO_API_KEY

    if request_key:
        source = "request_header"
    elif server_key:
        source = "server_env"
    else:
        source = "missing"

    db = SessionLocal()
    try:
        message_count = db.query(func.count(Message.id)).scalar() or 0
        analysis_count = db.query(func.count(Analysis.id)).scalar() or 0
    finally:
        db.close()

    db_url = settings.DATABASE_URL
    db_file = ""
    if db_url.startswith("sqlite:///"):
        raw_path = db_url.replace("sqlite:///", "", 1)
        db_file = str(Path(raw_path).resolve())

    return {
        "ok": True,
        "server_key_configured": bool(server_key),
        "request_key_present": bool(request_key),
        "effective_key_present": bool(request_key or server_key),
        "effective_key_source": source,
        "database_url": db_url,
        "database_file": db_file,
        "message_count": message_count,
        "analysis_count": analysis_count,
    }
