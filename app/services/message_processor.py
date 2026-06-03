import json
import logging
from pathlib import Path
from typing import Optional

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.message import Message
from app.models.media import MediaFile
from app.models.sync_cursor import SyncCursor
from app.services.media_handler import media_handler
from app.services.media_enricher import media_enricher
from app.services.wechat import wechat_client
from app.services.ai_analyzer import ai_analyzer

logger = logging.getLogger(__name__)


class MessageProcessor:
    """消息处理编排：接收 sync_msg 数据 → 解析 → 持久化 → 触发AI分析."""

    async def process_sync_result(self, data: dict, open_kfid: str) -> int:
        """处理 sync_msg 返回结果.
        Returns: 处理的消息数量
        """
        msg_list = data.get("msg_list", []) or []
        next_cursor = data.get("next_cursor", "")
        has_more = data.get("has_more", 0)

        if not msg_list:
            return 0

        db = SessionLocal()
        try:
            count = 0
            for msg_data in msg_list:
                try:
                    await self._process_one(msg_data, open_kfid, db)
                    count += 1
                except Exception as e:
                    logger.error("Failed to process msg %s: %s", msg_data.get("msgid"), e)

            # 保存游标
            if next_cursor:
                self._save_cursor(open_kfid, next_cursor, db)

            db.commit()
            logger.info("Processed %d messages for kfid=%s", count, open_kfid)
            return count
        finally:
            db.close()

    async def _process_one(self, msg_data: dict, open_kfid: str, db: Session):
        """处理单条消息."""
        msgid = msg_data.get("msgid", "")
        if not msgid:
            return

        # 检查是否已处理
        existing = db.query(Message).filter(Message.msgid == msgid).first()
        if existing:
            return

        msg_type = msg_data.get("msgtype", "")
        send_time = msg_data.get("send_time", 0)
        origin = msg_data.get("origin")
        external_userid = msg_data.get("external_userid")

        # 保存原始消息
        raw_json = json.dumps(msg_data, ensure_ascii=False)
        message = Message(
            msgid=msgid,
            msg_type=msg_type,
            open_kfid=open_kfid,
            external_userid=external_userid,
            send_time=send_time,
            origin=origin,
            raw_content=raw_json,
        )
        db.add(message)
        db.flush()

        # 按类型分发处理
        content_obj = msg_data.get(msg_type, {})
        if msg_type == "text":
            self._handle_text(content_obj, message)

        elif msg_type == "voice":
            await self._handle_voice(content_obj, msgid, db)

        elif msg_type in ("video", "image", "file"):
            await self._handle_media(msg_type, content_obj, msgid, message, db)

        elif msg_type == "link":
            self._handle_link(content_obj, message)

        elif msg_type == "location":
            self._handle_location(content_obj, message)

        elif msg_type == "miniprogram":
            self._handle_miniprogram(content_obj, message)

        elif msg_type == "business_card":
            self._handle_business_card(content_obj, message)

        # 触发 AI 分析 (异步非阻塞)
        try:
            ai_analyzer.analyze_and_save(message, db)
        except Exception as e:
            logger.warning("AI analysis trigger failed for msg %s: %s", msgid, e)

    def _handle_text(self, content: dict, message: Message):
        """文本消息：提取内容."""
        text = content.get("content", "")
        if text:
            message.raw_content = json.dumps(
                {"msgtype": "text", "text": {"content": text}}, ensure_ascii=False
            )

    async def _handle_voice(self, content: dict, msgid: str, db: Session):
        """语音消息：下载 + 记录."""
        media_id = content.get("media_id", "")
        if media_id:
            await media_handler.download_and_save(msgid, "voice", media_id, db)

    async def _handle_media(self, media_type: str, content: dict, msgid: str, message: Message, db: Session):
        """Download media, enrich image/file content, and store structured payload."""
        media_id = content.get("media_id", "")
        if not media_id:
            return

        media = await media_handler.download_and_save(msgid, media_type, media_id, db)
        filename = Path(media.file_path).name if media.file_path else f"{media_type}_{media_id}"

        if media_type in ("image", "file"):
            enriched = media_enricher.enrich_media(media_type, media.file_path or "", display_name=filename)
            payload = {
                "filename": filename,
                "content": enriched.get("content", "") or f"[{media_type} media] {filename}",
                "title": enriched.get("title", ""),
                "keywords": enriched.get("keywords", []),
                "source": enriched.get("source", ""),
            }
            if media_type == "image":
                payload["ocr_text"] = enriched.get("ocr_text", "")
            if media_type == "file":
                payload["extracted_text"] = enriched.get("extracted_text", "")
            message.raw_content = json.dumps({"msgtype": media_type, media_type: payload}, ensure_ascii=False)
    def _handle_link(self, content: dict, message: Message):
        """链接消息：提取标题/描述/URL."""
        link_info = {
            "title": content.get("title", ""),
            "desc": content.get("desc", ""),
            "url": content.get("url", ""),
            "pic_url": content.get("pic_url", ""),
        }
        message.raw_content = json.dumps(
            {"msgtype": "link", "link": link_info}, ensure_ascii=False
        )

    def _handle_location(self, content: dict, message: Message):
        """位置消息."""
        message.raw_content = json.dumps({"msgtype": "location", "location": content}, ensure_ascii=False)

    def _handle_miniprogram(self, content: dict, message: Message):
        """小程序消息."""
        message.raw_content = json.dumps(
            {"msgtype": "miniprogram", "miniprogram": content}, ensure_ascii=False
        )

    def _handle_business_card(self, content: dict, message: Message):
        """名片消息."""
        message.raw_content = json.dumps(
            {"msgtype": "business_card", "business_card": content}, ensure_ascii=False
        )

    def _save_cursor(self, open_kfid: str, cursor: str, db: Session):
        """持久化 sync_msg 游标."""
        record = db.query(SyncCursor).filter(SyncCursor.open_kfid == open_kfid).first()
        if record:
            record.cursor = cursor
        else:
            record = SyncCursor(open_kfid=open_kfid, cursor=cursor)
            db.add(record)

    def get_cursor(self, open_kfid: str) -> Optional[str]:
        """获取已持久化的游标."""
        db = SessionLocal()
        try:
            record = db.query(SyncCursor).filter(SyncCursor.open_kfid == open_kfid).first()
            return record.cursor if record else None
        finally:
            db.close()


processor = MessageProcessor()
