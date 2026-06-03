import os
from datetime import datetime
from pathlib import Path

from sqlalchemy.orm import Session

from app.config import settings
from app.models.media import MediaFile
from app.services.wechat import wechat_client


class MediaHandler:
    """媒体文件下载与管理."""

    def __init__(self):
        self._media_dir = Path(settings.MEDIA_DIR)

    def _sub_dir(self, media_type: str) -> Path:
        """按类型划分子目录: media/voice/, media/video/, media/image/, media/file/"""
        sub = self._media_dir / media_type
        sub.mkdir(exist_ok=True)
        return sub

    async def download_and_save(
        self, msgid: str, media_type: str, media_id: str, db: Session
    ) -> MediaFile:
        """下载媒体文件并保存到本地，同时写入数据库."""
        content, content_type = await wechat_client.download_media(media_id)
        ext = await wechat_client.get_media_filename(media_id, content_type)

        date_str = datetime.now().strftime("%Y%m%d")
        sub = self._sub_dir(media_type)
        filename = f"{date_str}_{media_id}{ext}"
        file_path = sub / filename

        with open(file_path, "wb") as f:
            f.write(content)

        media_record = MediaFile(
            msgid=msgid,
            media_type=media_type,
            media_id=media_id,
            file_path=str(file_path),
            file_size=len(content),
            file_format=ext.lstrip("."),
        )
        db.add(media_record)
        db.commit()
        db.refresh(media_record)
        return media_record


media_handler = MediaHandler()
