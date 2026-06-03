import logging

from fastapi import APIRouter, Request, Query
from fastapi.responses import PlainTextResponse

from app.config import settings
from app.services.crypto import WeChatCrypto
from app.services.message_processor import processor
from app.services.wechat import wechat_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/callback", tags=["callback"])
crypto = WeChatCrypto()


@router.get("/kf")
def verify_url(
    msg_signature: str = Query(alias="msg_signature"),
    timestamp: str = Query(),
    nonce: str = Query(),
    echostr: str = Query(),
):
    """企业微信回调URL验证 (GET)."""
    try:
        plain = crypto.verify_url(msg_signature, timestamp, nonce, echostr)
        return PlainTextResponse(plain)
    except Exception as e:
        logger.warning("URL verification failed: %s", e)
        return PlainTextResponse(f"error: {e}", status_code=403)


@router.post("/kf")
async def receive_callback(request: Request):
    """接收企业微信回调事件推送 (POST).
    收到 kf_msg_or_event 后立即触发 sync_msg 拉取消息。
    """
    query = dict(request.query_params)
    body = await request.body()

    try:
        result = crypto.handle_callback(query, body)
        event = result["msg"].get("Event", "")
        token = result["msg"].get("Token", "")
        open_kfid = result["msg"].get("OpenKfId", "")

        if event == "kf_msg_or_event" and token and open_kfid:
            logger.info("Received kf_msg_or_event for kfid=%s, triggering sync", open_kfid)
            try:
                # 获取上次拉取的游标
                cursor = processor.get_cursor(open_kfid)
                # 拉取并处理消息
                sync_data = await wechat_client.sync_msg(
                    token=token, open_kfid=open_kfid, cursor=cursor
                )
                if sync_data.get("errcode", 0) == 0:
                    await processor.process_sync_result(sync_data, open_kfid)
                else:
                    logger.error("sync_msg failed: %s", sync_data.get("errmsg"))
            except Exception as e:
                logger.error("sync/process error for kfid=%s: %s", open_kfid, e)

        return PlainTextResponse("ok")
    except Exception as e:
        logger.error("Callback handling error: %s", e)
        return PlainTextResponse(f"error: {e}", status_code=500)
