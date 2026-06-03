import json
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Form, Query
from fastapi.responses import FileResponse
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.analysis import Analysis
from app.models.media import MediaFile
from app.models.message import Message
from app.models.project import Project
from app.schemas.schemas import AnalysisOut, MessageOut
from app.services.ai_analyzer import ai_analyzer, get_categories

router = APIRouter(prefix="/messages", tags=["messages"])


def _serialize_analysis(analysis: Optional[Analysis]) -> Optional[dict]:
    if not analysis:
        return None
    payload = AnalysisOut.model_validate(analysis).model_dump()
    payload["desc"] = payload.get("summary", "")
    return payload


def _build_items(messages: list[Message], db: Session) -> list[dict]:
    msgids = [msg.msgid for msg in messages]
    analyses = (
        db.query(Analysis).filter(Analysis.msgid.in_(msgids)).all() if msgids else []
    )
    analysis_map = {analysis.msgid: analysis for analysis in analyses}

    return [
        {
            "message": MessageOut.model_validate(msg).model_dump(),
            "analysis": _serialize_analysis(analysis_map.get(msg.msgid)),
        }
        for msg in messages
    ]


def _format_item(msg: Message, db: Session) -> dict:
    analysis = db.query(Analysis).filter(Analysis.msgid == msg.msgid).first()
    return {
        "message": MessageOut.model_validate(msg).model_dump(),
        "analysis": _serialize_analysis(analysis),
    }


def _resolve_media_path(file_path: Optional[str]) -> Optional[Path]:
    if not file_path:
        return None
    path = Path(file_path).resolve()
    media_root = Path(settings.MEDIA_DIR).resolve()
    try:
        path.relative_to(media_root)
    except ValueError:
        return None
    return path if path.is_file() else None


def _timestamp_at_start_of_day(target: datetime) -> int:
    return int(target.replace(hour=0, minute=0, second=0, microsecond=0).timestamp())


def _apply_time_group(query, time_group: Optional[str]):
    now = datetime.now()

    if time_group == "today":
        query = query.filter(Message.send_time >= _timestamp_at_start_of_day(now))
    elif time_group == "week":
        week_start = now - timedelta(days=now.weekday())
        query = query.filter(
            Message.send_time >= _timestamp_at_start_of_day(week_start)
        )
    elif time_group == "month":
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        query = query.filter(Message.send_time >= int(month_start.timestamp()))

    return query


@router.get("")
def list_messages(
    category: Optional[str] = Query(None),
    msg_type: Optional[str] = Query(None),
    project_id: Optional[int] = Query(None),
    date_from: Optional[int] = Query(None),
    date_to: Optional[int] = Query(None),
    time_group: Optional[str] = Query(None, description="today/week/month"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """查询消息列表，支持分类/类型/项目/时间筛选。"""
    query = db.query(Message)

    if msg_type:
        query = query.filter(Message.msg_type == msg_type)
    if category:
        query = query.join(Analysis, Message.msgid == Analysis.msgid).filter(
            Analysis.category == category
        )
    if project_id is not None:
        query = query.filter(Message.project_id == project_id)
    if date_from:
        query = query.filter(Message.send_time >= date_from)
    if date_to:
        query = query.filter(Message.send_time <= date_to)
    query = _apply_time_group(query, time_group)

    total = query.count()
    messages = query.order_by(Message.send_time.desc()).offset(offset).limit(limit).all()

    return {
        "total": total,
        "items": _build_items(messages, db),
        "limit": limit,
        "offset": offset,
    }


@router.get("/search")
def search_messages(
    q: str = Query(..., min_length=1, description="搜索关键词"),
    category: Optional[str] = Query(None),
    msg_type: Optional[str] = Query(None),
    project_id: Optional[int] = Query(None),
    date_from: Optional[int] = Query(None),
    date_to: Optional[int] = Query(None),
    time_group: Optional[str] = Query(None, description="today/week/month"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """搜索消息内容。关键词模糊匹配原文、摘要与分类。"""
    keyword = f"%{q}%"
    query = (
        db.query(Message)
        .outerjoin(Analysis, Message.msgid == Analysis.msgid)
        .filter(
            or_(
                Message.raw_content.ilike(keyword),
                Analysis.summary.ilike(keyword),
                Analysis.category.ilike(keyword),
            )
        )
    )

    if category:
        query = query.filter(Analysis.category == category)
    if msg_type:
        query = query.filter(Message.msg_type == msg_type)
    if project_id is not None:
        query = query.filter(Message.project_id == project_id)
    if date_from:
        query = query.filter(Message.send_time >= date_from)
    if date_to:
        query = query.filter(Message.send_time <= date_to)
    query = _apply_time_group(query, time_group)

    total = query.count()
    messages = query.order_by(Message.send_time.desc()).offset(offset).limit(limit).all()

    return {
        "total": total,
        "items": _build_items(messages, db),
        "limit": limit,
        "offset": offset,
    }


@router.get("/stats/categories")
def category_stats(db: Session = Depends(get_db)):
    """获取分类统计数据。"""
    rows = (
        db.query(Analysis.category, func.count(Analysis.id))
        .group_by(Analysis.category)
        .all()
    )
    return {"categories": {row[0]: row[1] for row in rows}}


@router.get("/stats/overview")
def overview_stats(db: Session = Depends(get_db)):
    """获取首页概览统计。"""
    now = datetime.now()
    today_start = _timestamp_at_start_of_day(now)
    week_start = _timestamp_at_start_of_day(now - timedelta(days=now.weekday()))
    seven_days_ago = _timestamp_at_start_of_day(now - timedelta(days=6))

    total_messages = db.query(func.count(Message.id)).scalar() or 0
    today_messages = (
        db.query(func.count(Message.id))
        .filter(Message.send_time >= today_start)
        .scalar()
        or 0
    )
    week_messages = (
        db.query(func.count(Message.id))
        .filter(Message.send_time >= week_start)
        .scalar()
        or 0
    )
    unassigned_project_messages = (
        db.query(func.count(Message.id))
        .filter(Message.project_id.is_(None))
        .scalar()
        or 0
    )
    pending_analysis_messages = (
        db.query(func.count(Message.id))
        .outerjoin(Analysis, Message.msgid == Analysis.msgid)
        .filter(Analysis.id.is_(None))
        .scalar()
        or 0
    )

    category_rows = (
        db.query(Analysis.category, func.count(Analysis.id))
        .group_by(Analysis.category)
        .order_by(func.count(Analysis.id).desc(), Analysis.category.asc())
        .all()
    )
    project_rows = (
        db.query(Project.name, Project.color, func.count(Message.id))
        .join(Message, Message.project_id == Project.id)
        .group_by(Project.id)
        .order_by(func.count(Message.id).desc(), Project.name.asc())
        .all()
    )
    type_rows = (
        db.query(Message.msg_type, func.count(Message.id))
        .group_by(Message.msg_type)
        .order_by(func.count(Message.id).desc(), Message.msg_type.asc())
        .all()
    )
    recent_rows = (
        db.query(Message.send_time)
        .filter(Message.send_time >= seven_days_ago)
        .order_by(Message.send_time.asc())
        .all()
    )

    activity_map = {}
    for (send_time,) in recent_rows:
        date_key = datetime.fromtimestamp(send_time).strftime("%m-%d")
        activity_map[date_key] = activity_map.get(date_key, 0) + 1

    activity = []
    for delta in range(6, -1, -1):
        day = now - timedelta(days=delta)
        date_key = day.strftime("%m-%d")
        activity.append({"date": date_key, "count": activity_map.get(date_key, 0)})

    return {
        "overview": {
            "total_messages": total_messages,
            "today_messages": today_messages,
            "week_messages": week_messages,
            "unassigned_project_messages": unassigned_project_messages,
            "pending_analysis_messages": pending_analysis_messages,
            "project_count": db.query(func.count(Project.id)).scalar() or 0,
            "category_count": len(get_categories()),
        },
        "top_categories": [
            {"name": name or "未分类", "count": count} for name, count in category_rows
        ],
        "project_breakdown": [
            {"name": name, "color": color, "count": count}
            for name, color, count in project_rows
        ],
        "type_breakdown": [
            {"type": msg_type, "count": count} for msg_type, count in type_rows
        ],
        "activity": activity,
    }


@router.put("/{msgid}/project")
def set_message_project(
    msgid: str, project_id: int = Form(...), db: Session = Depends(get_db)
):
    """设置消息所属项目。"""
    msg = db.query(Message).filter(Message.msgid == msgid).first()
    if not msg:
        return {"error": "消息不存在"}
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        return {"error": "项目不存在"}
    msg.project_id = project_id
    db.commit()
    return {"ok": True, "project_id": project_id}


@router.delete("/{msgid}/project")
def remove_message_project(msgid: str, db: Session = Depends(get_db)):
    """移除消息的项目归属。"""
    msg = db.query(Message).filter(Message.msgid == msgid).first()
    if not msg:
        return {"error": "消息不存在"}
    msg.project_id = None
    db.commit()
    return {"ok": True}


@router.put("/{msgid}/analysis")
def update_analysis_desc(msgid: str, desc: str = Form(...), db: Session = Depends(get_db)):
    """编辑AI分析结果的描述内容。"""
    analysis = db.query(Analysis).filter(Analysis.msgid == msgid).first()
    if not analysis:
        return {"error": "分析结果不存在"}
    analysis.summary = desc.strip()
    db.commit()
    return {"ok": True, "summary": analysis.summary, "desc": analysis.summary}


@router.put("/{msgid}/category")
def update_analysis_category(msgid: str, category: str = Form(...), db: Session = Depends(get_db)):
    analysis = db.query(Analysis).filter(Analysis.msgid == msgid).first()
    if not analysis:
        return {"error": "分析结果不存在"}
    category = category.strip()
    if not category:
        return {"error": "分类不能为空"}
    analysis.category = category
    db.commit()
    return {"ok": True, "category": analysis.category}


@router.get("/{msgid}")
def get_message(msgid: str, db: Session = Depends(get_db)):
    """获取单条消息详情与分析结果。"""
    message = db.query(Message).filter(Message.msgid == msgid).first()
    if not message:
        return {"error": "not found"}
    return _format_item(message, db)


@router.get("/{msgid}/raw")
def get_raw_message(msgid: str, db: Session = Depends(get_db)):
    """获取原始消息JSON。"""
    message = db.query(Message).filter(Message.msgid == msgid).first()
    if not message:
        return {"error": "not found"}
    try:
        return json.loads(message.raw_content or "{}")
    except (json.JSONDecodeError, TypeError):
        return {"raw": message.raw_content}


@router.get("/{msgid}/media")
def get_message_media(msgid: str, db: Session = Depends(get_db)):
    records = (
        db.query(MediaFile)
        .filter(MediaFile.msgid == msgid)
        .order_by(MediaFile.created_at.asc(), MediaFile.id.asc())
        .all()
    )
    items = []
    for record in records:
        items.append(
            {
                "id": record.id,
                "media_type": record.media_type,
                "file_format": record.file_format,
                "file_size": record.file_size,
                "filename": Path(record.file_path).name if record.file_path else "",
                "download_url": f"/messages/{msgid}/media/{record.id}/file",
            }
        )
    return {"items": items}


@router.get("/{msgid}/media/{media_id}/file")
def get_message_media_file(msgid: str, media_id: int, db: Session = Depends(get_db)):
    media = (
        db.query(MediaFile)
        .filter(MediaFile.msgid == msgid, MediaFile.id == media_id)
        .first()
    )
    if not media:
        return {"error": "not found"}
    safe_path = _resolve_media_path(media.file_path)
    if not safe_path:
        return {"error": "not found"}
    filename = safe_path.name
    return FileResponse(str(safe_path), filename=filename)


@router.post("/{msgid}/reanalyze")
def reanalyze_message(
    msgid: str,
    feedback: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    """手动触发重新分析。"""
    message = db.query(Message).filter(Message.msgid == msgid).first()
    if not message:
        return {"error": "not found"}

    db.query(Analysis).filter(Analysis.msgid == msgid).delete()
    db.commit()

    analysis = ai_analyzer.analyze_and_save(message, db, guidance=(feedback or "").strip())
    if analysis:
        return AnalysisOut.model_validate(analysis).model_dump()
    return {"error": "analysis failed"}


@router.delete("/{msgid}")
def delete_message(msgid: str, db: Session = Depends(get_db)):
    """删除消息及关联分析结果。"""
    message = db.query(Message).filter(Message.msgid == msgid).first()
    if not message:
        return {"error": "not found"}
    db.query(Analysis).filter(Analysis.msgid == msgid).delete()
    db.delete(message)
    db.commit()
    return {"ok": True}
