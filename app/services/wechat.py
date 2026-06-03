import time
from typing import Optional

import httpx

from app.config import settings


class WeChatClient:
    """企业微信客服 API 封装."""

    def __init__(self):
        self._base_url = settings.WECOM_BASE_URL
        self._corp_id = settings.WECOM_CORP_ID
        self._corp_secret = settings.WECOM_CORP_SECRET
        self._token: str = ""
        self._token_expires_at: float = 0
        self._client = httpx.AsyncClient(timeout=30.0)

    async def _get_token(self) -> str:
        """获取 access_token (带缓存)."""
        if self._token and time.time() < self._token_expires_at - 60:
            return self._token

        resp = await self._client.get(
            f"{self._base_url}/cgi-bin/gettoken",
            params={"corpid": self._corp_id, "corpsecret": self._corp_secret},
        )
        data = resp.json()
        if data.get("errcode", -1) != 0:
            raise RuntimeError(f"gettoken failed: {data.get('errmsg', 'unknown')}")
        self._token = data["access_token"]
        self._token_expires_at = time.time() + data.get("expires_in", 7200)
        return self._token

    async def sync_msg(
        self,
        token: str,
        open_kfid: str,
        cursor: Optional[str] = None,
        voice_format: int = 0,
        limit: int = 100,
    ) -> dict:
        """拉取客服消息.
        voice_format: 0=Amr, 1=Silk
        """
        payload = {
            "token": token,
            "open_kfid": open_kfid,
            "voice_format": voice_format,
            "limit": limit,
        }
        if cursor:
            payload["cursor"] = cursor

        access_token = await self._get_token()
        resp = await self._client.post(
            f"{self._base_url}/cgi-bin/kf/sync_msg",
            params={"access_token": access_token},
            json=payload,
        )
        return resp.json()

    async def download_media(self, media_id: str) -> tuple[bytes, str]:
        """下载媒体文件，返回 (文件内容, 文件名/Content-Type).
        注意: media_id 有效期3天。
        """
        access_token = await self._get_token()
        async with self._client.stream(
            "GET",
            f"{self._base_url}/cgi-bin/media/get",
            params={"access_token": access_token, "media_id": media_id},
        ) as resp:
            content_type = resp.headers.get("content-type", "application/octet-stream")
            content = await resp.aread()
            # 企业微信错误时返回 JSON
            if content_type == "application/json" or content_type.startswith("text/"):
                try:
                    data = resp.json() if hasattr(resp, "json") else None
                except Exception:
                    data = None
                if data and data.get("errcode", 0) != 0:
                    raise RuntimeError(f"media download failed: {data.get('errmsg')}")
            return content, content_type

    async def get_media_filename(self, media_id: str, content_type: str) -> str:
        """根据 Content-Type 生成文件扩展名."""
        ext_map = {
            "image/jpeg": ".jpg",
            "image/png": ".png",
            "image/gif": ".gif",
            "audio/amr": ".amr",
            "audio/silk": ".silk",
            "video/mp4": ".mp4",
            "application/pdf": ".pdf",
        }
        ext = ext_map.get(content_type, ".bin")
        return f"{media_id}{ext}"

    async def close(self):
        await self._client.aclose()


# 全局单例
wechat_client = WeChatClient()
