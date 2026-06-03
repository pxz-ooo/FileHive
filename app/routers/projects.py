from typing import Optional

from fastapi import APIRouter, Depends, Form
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.message import Message
from app.models.project import Project

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("")
def list_projects(db: Session = Depends(get_db)):
    """获取项目列表（含每个项目的消息数）。"""
    projects = db.query(Project).order_by(Project.sort_order, Project.name).all()
    stats = (
        db.query(Message.project_id, func.count(Message.id))
        .filter(Message.project_id.isnot(None))
        .group_by(Message.project_id)
        .all()
    )
    stat_map = {s[0]: s[1] for s in stats}
    return {
        "projects": [
            {
                "id": p.id,
                "name": p.name,
                "color": p.color,
                "sort_order": p.sort_order,
                "msg_count": stat_map.get(p.id, 0),
            }
            for p in projects
        ]
    }


@router.post("")
def create_project(name: str = Form(...), color: str = Form("#0052d9"), db: Session = Depends(get_db)):
    """创建项目。"""
    name = name.strip()
    if not name:
        return {"error": "项目名称不能为空"}
    existing = db.query(Project).filter(Project.name == name).first()
    if existing:
        return {"error": "项目已存在"}
    max_order = db.query(func.max(Project.sort_order)).scalar() or 0
    project = Project(name=name, color=color, sort_order=max_order + 1)
    db.add(project)
    db.commit()
    db.refresh(project)
    return {"id": project.id, "name": project.name, "color": project.color}


@router.put("/{project_id}")
def update_project(project_id: int, name: Optional[str] = None, color: Optional[str] = None, db: Session = Depends(get_db)):
    """编辑项目。"""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        return {"error": "项目不存在"}
    if name:
        project.name = name
    if color:
        project.color = color
    db.commit()
    return {"ok": True}


@router.delete("/{project_id}")
def delete_project(project_id: int, db: Session = Depends(get_db)):
    """删除项目（不删除消息，仅移除关联）。"""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        return {"error": "项目不存在"}
    # 移除消息关联
    db.query(Message).filter(Message.project_id == project_id).update(
        {Message.project_id: None}
    )
    db.delete(project)
    db.commit()
    return {"ok": True}


@router.get("/stats")
def project_stats(db: Session = Depends(get_db)):
    """每个项目的消息数量统计。"""
    rows = (
        db.query(Message.project_id, func.count(Message.id))
        .filter(Message.project_id.isnot(None))
        .group_by(Message.project_id)
        .all()
    )
    result = {}
    for pid, count in rows:
        proj = db.query(Project).filter(Project.id == pid).first()
        if proj:
            result[proj.name] = count
    return {"stats": result}
