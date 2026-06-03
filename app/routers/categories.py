from fastapi import APIRouter, Form

from app.services.ai_analyzer import get_categories, add_category, remove_category

router = APIRouter(prefix="/categories", tags=["categories"])


@router.get("")
def list_categories():
    """获取所有分类。"""
    return {"categories": get_categories()}


@router.post("")
def create_category(name: str = Form(...)):
    """添加新分类。"""
    ok = add_category(name)
    return {"ok": ok, "categories": get_categories()}


@router.delete("/{name}")
def delete_category(name: str):
    """删除自定义分类（默认分类不可删除）。"""
    ok = remove_category(name)
    return {"ok": ok, "categories": get_categories()}
