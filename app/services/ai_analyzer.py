import json
import logging
from pathlib import Path
from typing import Optional

import httpx
from openai import OpenAI
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal
from app.models.analysis import Analysis
from app.models.media import MediaFile
from app.models.message import Message
from app.services.link_fetcher import extract_url, fetch_url_content
from app.services.request_context import get_current_mimo_api_key

logger = logging.getLogger(__name__)

DEFAULT_CATEGORIES = ["工作", "学习", "生活", "通知", "杂记", "娱乐", "其他"]
_CATEGORIES_FILE = Path("data/categories.json")


def _load_categories() -> list[str]:
    if _CATEGORIES_FILE.exists():
        try:
            data = json.loads(_CATEGORIES_FILE.read_text(encoding="utf-8"))
            if isinstance(data, list) and data:
                return data
        except Exception:
            pass
    _save_categories(DEFAULT_CATEGORIES)
    return DEFAULT_CATEGORIES


def _save_categories(categories: list[str]):
    _CATEGORIES_FILE.write_text(
        json.dumps(categories, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def get_categories() -> list[str]:
    return _load_categories()


def add_category(name: str) -> bool:
    name = name.strip()
    if not name:
        return False
    categories = _load_categories()
    if name not in categories:
        categories.append(name)
        _save_categories(categories)
        return True
    return False


def remove_category(name: str) -> bool:
    categories = _load_categories()
    if name in categories and name not in DEFAULT_CATEGORIES:
        categories.remove(name)
        _save_categories(categories)
        return True
    return False


def _build_system_prompt() -> str:
    categories = ", ".join(get_categories())
    return (
        "分析消息内容，返回分类和一句话描述。\n\n"
        f"分类选项: {categories}\n\n"
        'JSON格式:\n{"category": "分类", "desc": "20字以内描述"}'
    )


class AIAnalyzer:
    def __init__(self):
        self._client: Optional[OpenAI] = None
        self._client_api_key: str = ""
        self._model = settings.MIMO_MODEL

    def _get_client(self) -> OpenAI:
        api_key = get_current_mimo_api_key() or settings.MIMO_API_KEY
        if self._client is None or self._client_api_key != api_key:
            if not api_key:
                raise RuntimeError("MIMO API key not configured")
            self._client = OpenAI(
                base_url=settings.MIMO_BASE_URL,
                api_key=api_key,
                http_client=httpx.Client(timeout=60.0),
            )
            self._client_api_key = api_key
        return self._client

    def _parse_message_data(self, message: Message) -> dict:
        try:
            return json.loads(message.raw_content or "{}")
        except (json.JSONDecodeError, TypeError):
            return {}

    def extract_content(self, message: Message, data: Optional[dict] = None) -> str:
        data = data or self._parse_message_data(message)

        if message.msg_type == "text":
            return data.get("text", {}).get("content", "") or message.raw_content or ""

        if message.msg_type == "link":
            link = data.get("link", {})
            parts = [
                link.get("title", ""),
                link.get("desc", ""),
                link.get("raw_text", ""),
                link.get("url", ""),
            ]
            return " - ".join(part for part in parts if part)

        if message.msg_type == "voice":
            voice = data.get("voice", {})
            return voice.get("content", "") or voice.get("filename", "") or "[语音消息]"

        if message.msg_type == "video":
            video = data.get("video", {})
            return video.get("content", "") or video.get("filename", "") or "[视频消息]"

        if message.msg_type == "image":
            image = data.get("image", {})
            parts = [
                image.get("title", ""),
                image.get("content", ""),
                image.get("ocr_text", ""),
                image.get("user_note", ""),
                " ".join(image.get("keywords", []) if isinstance(image.get("keywords"), list) else []),
                image.get("filename", ""),
            ]
            return " - ".join(part for part in parts if part) or "[图片消息]"

        if message.msg_type == "file":
            file_data = data.get("file", {})
            parts = [
                file_data.get("title", ""),
                file_data.get("content", ""),
                file_data.get("extracted_text", ""),
                file_data.get("user_note", ""),
                " ".join(file_data.get("keywords", []) if isinstance(file_data.get("keywords"), list) else []),
                file_data.get("filename", ""),
            ]
            return " - ".join(part for part in parts if part) or "[文件消息]"

        if message.msg_type == "location":
            location = data.get("location", {})
            return f"位置: {location.get('address', location.get('name', ''))}"

        if message.msg_type == "miniprogram":
            miniprogram = data.get("miniprogram", {})
            return f"小程序: {miniprogram.get('title', '')}"

        return f"[{message.msg_type}消息]"

    def extract_voice_transcription(self, message: Message, db: Session) -> Optional[str]:
        media = (
            db.query(MediaFile)
            .filter(MediaFile.msgid == message.msgid, MediaFile.media_type == "voice")
            .first()
        )
        return media.transcription if media else None

    def analyze(self, message: Message, guidance: str = "") -> Optional[dict]:
        data = self._parse_message_data(message)
        content = self.extract_content(message, data)

        db = SessionLocal()
        try:
            transcription = self.extract_voice_transcription(message, db)
        finally:
            db.close()

        effective_content = content
        if transcription:
            if effective_content and not effective_content.startswith("["):
                effective_content = f"{effective_content}\n语音转文字: {transcription}"
            else:
                effective_content = transcription

        if not effective_content or effective_content.startswith("["):
            return self._fallback_classify(message.msg_type)

        user_content = f"消息类型: {message.msg_type}\n消息内容: {effective_content}"
        if guidance:
            user_content += f"\n用户补充意见: {guidance}"

        if message.msg_type == "link":
            url = extract_url(message.raw_content or "")
            if url:
                try:
                    link_data = data.get("link", {})
                    fetched = fetch_url_content(
                        url,
                        share_title=link_data.get("title", ""),
                        share_desc=link_data.get("desc", ""),
                    )
                    if fetched.get("content"):
                        user_content += (
                            f"\n网页标题: {fetched.get('title', '')}"
                            f"\n网页内容: {fetched['content']}"
                        )
                except Exception as exc:
                    logger.debug("Link fetch skipped: %s", exc)

        try:
            response = self._get_client().chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": _build_system_prompt()},
                    {"role": "user", "content": user_content},
                ],
                response_format={"type": "json_object"},
            )

            result_text = response.choices[0].message.content
            if not result_text:
                return self._fallback_classify(message.msg_type)

            result = json.loads(result_text)
            result["model_used"] = self._model
            result["confidence"] = 0.9

            categories = get_categories()
            if result.get("category") not in categories:
                for category in categories:
                    current = str(result.get("category", ""))
                    if current.lower() in category.lower() or category.lower() in current.lower():
                        result["category"] = category
                        break
                else:
                    result["category"] = "其他"

            return result
        except Exception as exc:
            logger.warning("MiMo analysis failed for msg %s: %s, using fallback", message.msgid, exc)
            return self._fallback_classify(message.msg_type)

    def _fallback_classify(self, msg_type: str) -> dict:
        fallback_category = {
            "text": "杂记",
            "link": "工作",
            "voice": "杂记",
            "video": "娱乐",
            "image": "生活",
            "file": "工作",
            "location": "生活",
            "miniprogram": "杂记",
        }.get(msg_type, "其他")
        return {
            "category": fallback_category,
            "desc": f"[{msg_type}消息]",
            "model_used": "rule_fallback",
            "confidence": 0.3,
        }

    def analyze_and_save(
        self,
        message: Message,
        db: Optional[Session] = None,
        guidance: str = "",
    ) -> Optional[Analysis]:
        if db is None:
            own_db = True
            db = SessionLocal()
        else:
            own_db = False

        try:
            existing = db.query(Analysis).filter(Analysis.msgid == message.msgid).first()
            if existing:
                return existing

            result = self.analyze(message, guidance=guidance)
            if not result:
                return None

            analysis = Analysis(
                msgid=message.msgid,
                category=result.get("category", "其他"),
                summary=result.get("desc", result.get("summary", "")),
                confidence=result.get("confidence"),
                model_used=result.get("model_used"),
                raw_response=json.dumps(result, ensure_ascii=False),
            )
            db.add(analysis)
            db.commit()
            db.refresh(analysis)
            return analysis
        except Exception as exc:
            logger.error("Failed to save analysis for msg %s: %s", message.msgid, exc)
            db.rollback()
            return None
        finally:
            if own_db:
                db.close()


ai_analyzer = AIAnalyzer()
