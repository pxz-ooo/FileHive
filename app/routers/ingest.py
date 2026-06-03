import json
import time
import os
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, Form, UploadFile, File
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.message import Message
from app.models.media import MediaFile
from app.schemas.schemas import AnalysisOut
from app.services.ai_analyzer import ai_analyzer
from app.services.link_fetcher import parse_share_text
from app.services.media_enricher import media_enricher

router = APIRouter(prefix="/ingest", tags=["ingest"])
ALLOWED_UPLOAD_TYPES = {"image", "file"}


@router.post("")
def ingest_manual(
    content: str = Form(..., description="消息内容（文本或链接URL）"),
    msg_type: str = Form("text", description="消息类型: text 或 link"),
    summary_hint: Optional[str] = Form(None, description="可选：补充说明（如语音转文字等）"),
    db: Session = Depends(get_db),
):
    """手动提交内容进行AI分析。直接从网页粘贴使用。"""
    if not content or not content.strip():
        return {"error": "内容不能为空"}

    msgid = f"manual_{int(time.time() * 1000)}_{hash(content) & 0xFFFF}"

    if msg_type == "link":
        share = parse_share_text(content)
        raw = json.dumps({
            "msgtype": "link",
            "link": {
                "title": share["title"],
                "desc": share["desc"],
                "url": share["url"],
                "raw_text": share["raw_text"],
            },
        }, ensure_ascii=False)
    else:
        raw = json.dumps({
            "msgtype": "text",
            "text": {"content": content},
        }, ensure_ascii=False)

    message = Message(
        msgid=msgid,
        msg_type=msg_type,
        open_kfid="manual",
        send_time=int(time.time()),
        origin=3,
        raw_content=raw,
    )
    db.add(message)
    db.commit()
    db.refresh(message)

    # 如果有补充说明（如语音转文字），附加到内容中一起分析
    if summary_hint:
        try:
            existing = json.loads(message.raw_content or "{}")
            if msg_type == "text":
                combined = existing.get("text", {}).get("content", "") + f"\n[补充信息]: {summary_hint}"
                existing["text"]["content"] = combined
            else:
                existing["_hint"] = summary_hint
            message.raw_content = json.dumps(existing, ensure_ascii=False)
        except Exception:
            pass

    analysis = ai_analyzer.analyze_and_save(message, db)

    return {
        "msgid": msgid,
        "message": {
            "msg_type": msg_type,
            "content": content[:500],
            "send_time": message.send_time,
        },
        "analysis": AnalysisOut.model_validate(analysis).model_dump() if analysis else None,
    }


@router.post("/upload")
async def ingest_file(
    file: UploadFile = File(..., description="上传文件（图片/语音/视频/文档）"),
    msg_type: str = Form("image", description="message type: image / file"),
    content: Optional[str] = Form(None, description="可选文字说明"),
    db: Session = Depends(get_db),
):
    """小程序端文件上传接口。"""
    if not file or not file.filename:
        return {"error": "文件不能为空"}
    if msg_type not in ALLOWED_UPLOAD_TYPES:
        return {"error": "only image and file uploads are supported"}

    msgid = f"mp_{int(time.time() * 1000)}_{os.urandom(4).hex()}"
    timestamp = int(time.time())

    # 保存文件
    date_str = time.strftime("%Y%m%d")
    sub_dir = Path(settings.MEDIA_DIR) / msg_type
    sub_dir.mkdir(parents=True, exist_ok=True)

    # 保留原扩展名
    ext = Path(file.filename).suffix or ".bin"
    save_name = f"{date_str}_{msgid}{ext}"
    save_path = sub_dir / save_name

    file_bytes = await file.read()
    with open(save_path, "wb") as f:
        f.write(file_bytes)

    file_size = len(file_bytes)
    file_format = ext.lstrip(".")

    # 构造消息内容
    enriched = media_enricher.enrich_media(
        msg_type,
        str(save_path),
        display_name=file.filename,
        hint=content or "",
    )

    text_content = enriched.get("content") or content or f"[{msg_type} media] {file.filename}"
    media_payload = {
        "filename": file.filename,
        "content": text_content,
        "title": enriched.get("title", ""),
        "keywords": enriched.get("keywords", []),
        "source": enriched.get("source", ""),
    }
    if msg_type == "image":
        media_payload["ocr_text"] = enriched.get("ocr_text", "")
    if msg_type == "file":
        media_payload["extracted_text"] = enriched.get("extracted_text", "")
    if content:
        media_payload["user_note"] = content

    raw = json.dumps({
        "msgtype": msg_type,
        msg_type: media_payload,
    }, ensure_ascii=False)

    message = Message(
        msgid=msgid,
        msg_type=msg_type,
        open_kfid="miniprogram",
        send_time=timestamp,
        origin=3,
        raw_content=raw,
    )
    db.add(message)
    db.flush()

    # 记录媒体文件
    media = MediaFile(
        msgid=msgid,
        media_type=msg_type,
        media_id=f"local_{msgid}",
        file_path=str(save_path),
        file_size=file_size,
        file_format=file_format,
    )
    db.add(media)
    db.commit()
    db.refresh(message)

    # AI 分析
    analysis = ai_analyzer.analyze_and_save(message, db)

    return {
        "msgid": msgid,
        "message": {
            "msg_type": msg_type,
            "content": text_content[:200],
            "filename": file.filename,
            "file_size": file_size,
            "send_time": timestamp,
        },
        "analysis": AnalysisOut.model_validate(analysis).model_dump() if analysis else None,
    }
