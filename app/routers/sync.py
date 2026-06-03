import logging

from fastapi import APIRouter

from app.config import settings
from app.services.message_processor import processor
from app.services.wechat import wechat_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sync", tags=["sync"])


@router.post("/messages")
async def sync_messages():
    """手动触发消息同步 (用于测试/定时任务)."""
    open_kfid = settings.WECOM_KF_OPEN_KFID
    if not open_kfid:
        return {"error": "WECOM_KF_OPEN_KFID not configured"}

    cursor = processor.get_cursor(open_kfid)
    logger.info("Manual sync triggered for kfid=%s, cursor=%s", open_kfid, cursor)

    # 无 token 时传空字符串，sync_msg 会走无token模式(频率受限)
    sync_data = await wechat_client.sync_msg(
        token="", open_kfid=open_kfid, cursor=cursor
    )

    if sync_data.get("errcode", 0) != 0:
        return {"error": sync_data.get("errmsg"), "errcode": sync_data["errcode"]}

    count = await processor.process_sync_result(sync_data, open_kfid)
    return {"processed": count, "has_more": sync_data.get("has_more", 0)}
