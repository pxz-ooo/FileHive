import base64
import io
import json
import logging
import mimetypes
import re
import zipfile
from pathlib import Path
from typing import Optional

import httpx
from openai import OpenAI
from PIL import Image, ImageOps

from app.config import settings
from app.services.request_context import get_current_mimo_api_key

logger = logging.getLogger(__name__)

TEXT_EXTENSIONS = {
    ".txt",
    ".md",
    ".markdown",
    ".csv",
    ".tsv",
    ".json",
    ".html",
    ".htm",
    ".xml",
    ".yaml",
    ".yml",
    ".py",
    ".js",
    ".ts",
    ".jsx",
    ".tsx",
    ".css",
    ".sql",
    ".log",
}


def _strip_markup(text: str) -> str:
    cleaned = re.sub(r"<script[\s\S]*?</script>", " ", text, flags=re.I)
    cleaned = re.sub(r"<style[\s\S]*?</style>", " ", cleaned, flags=re.I)
    cleaned = re.sub(r"<[^>]+>", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip()


class MediaEnricher:
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
                http_client=httpx.Client(timeout=90.0),
            )
            self._client_api_key = api_key
        return self._client

    def enrich_media(self, media_type: str, file_path: str, display_name: str = "", hint: str = "") -> dict:
        if media_type == "image":
            return self._enrich_image(file_path, display_name, hint)
        if media_type == "file":
            return self._enrich_file(file_path, display_name, hint)
        return {
            "title": display_name or Path(file_path).name,
            "content": hint or "",
            "source": "unsupported_media_type",
            "keywords": [],
        }

    def _enrich_image(self, file_path: str, display_name: str, hint: str) -> dict:
        fallback = self._fallback_image_payload(file_path, display_name, hint)

        try:
            data_url = self._build_image_data_url(file_path)
            prompt = (
                "你是消息整理助手。请识别这张图片，并返回 JSON："
                '{"title":"不超过18字的命名","desc":"一句话描述，不超过50字",'
                '"ocr_text":"图中关键文字，没有则空字符串","keywords":["最多5个关键词"]}'
            )
            if hint:
                prompt += f"\n补充说明: {hint}"
            if display_name:
                prompt += f"\n文件名: {display_name}"

            response = self._get_client().chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": "你是一个擅长资料整理、命名和内容提炼的多模态助手。"},
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {"type": "image_url", "image_url": {"url": data_url}},
                        ],
                    },
                ],
                response_format={"type": "json_object"},
            )
            content = response.choices[0].message.content or "{}"
            payload = self._parse_json_object(content)
            title = (payload.get("title") or fallback["title"]).strip()[:50]
            desc = (payload.get("desc") or fallback["content"]).strip()[:200]
            ocr_text = (payload.get("ocr_text") or "").strip()[:1200]
            keywords = self._normalize_keywords(payload.get("keywords"))

            result = {
                "title": title or fallback["title"],
                "content": desc or fallback["content"],
                "ocr_text": ocr_text,
                "keywords": keywords,
                "source": "mimo_vision",
            }
            if hint:
                result["user_note"] = hint
            return result
        except Exception as exc:
            logger.warning("Image enrichment failed for %s: %s", file_path, exc)
            return fallback

    def _enrich_file(self, file_path: str, display_name: str, hint: str) -> dict:
        extracted_text = self._extract_file_text(file_path)
        fallback = self._fallback_file_payload(file_path, display_name, hint, extracted_text)

        if not extracted_text:
            return fallback

        try:
            prompt = (
                "你是消息整理助手。下面是一个文件提取到的文本，请返回 JSON："
                '{"title":"不超过18字的命名","desc":"一句话描述，不超过50字","keywords":["最多5个关键词"]}'
                f"\n文件名: {display_name or Path(file_path).name}"
            )
            if hint:
                prompt += f"\n补充说明: {hint}"
            prompt += f"\n正文摘录:\n{extracted_text[:6000]}"

            response = self._get_client().chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": "你是一个擅长资料整理、命名和摘要提炼的助手。"},
                    {"role": "user", "content": prompt},
                ],
                response_format={"type": "json_object"},
            )
            content = response.choices[0].message.content or "{}"
            payload = self._parse_json_object(content)
            title = (payload.get("title") or fallback["title"]).strip()[:50]
            desc = (payload.get("desc") or fallback["content"]).strip()[:200]
            keywords = self._normalize_keywords(payload.get("keywords"))

            result = {
                "title": title or fallback["title"],
                "content": desc or fallback["content"],
                "extracted_text": extracted_text[:3000],
                "keywords": keywords,
                "source": "text_extract_then_mimo",
            }
            if hint:
                result["user_note"] = hint
            return result
        except Exception as exc:
            logger.warning("File enrichment failed for %s: %s", file_path, exc)
            return fallback

    def _build_image_data_url(self, file_path: str) -> str:
        image = Image.open(file_path)
        image = ImageOps.exif_transpose(image)
        max_edge = 1568
        width, height = image.size
        if max(width, height) > max_edge:
            scale = max_edge / float(max(width, height))
            image = image.resize((max(1, int(width * scale)), max(1, int(height * scale))))

        buffer = io.BytesIO()
        mime_type = mimetypes.guess_type(file_path)[0] or "image/jpeg"
        if mime_type in {"image/png", "image/gif", "image/webp", "image/bmp"}:
            save_format = {
                "image/png": "PNG",
                "image/gif": "PNG",
                "image/webp": "WEBP",
                "image/bmp": "BMP",
            }[mime_type]
            if save_format != "PNG" and image.mode not in ("RGB", "RGBA"):
                image = image.convert("RGB")
            if save_format == "PNG":
                image.save(buffer, format="PNG")
                mime_type = "image/png"
            elif save_format == "WEBP":
                image.save(buffer, format="WEBP", quality=88)
                mime_type = "image/webp"
            else:
                image.save(buffer, format="BMP")
        else:
            if image.mode not in ("RGB", "L"):
                image = image.convert("RGB")
            image.save(buffer, format="JPEG", quality=88, optimize=True)
            mime_type = "image/jpeg"

        encoded = base64.b64encode(buffer.getvalue()).decode("utf-8")
        return f"data:{mime_type};base64,{encoded}"

    def _extract_file_text(self, file_path: str) -> str:
        path = Path(file_path)
        ext = path.suffix.lower()

        try:
            if ext in {".docx"}:
                return self._extract_docx_text(path)
            if ext in {".pptx"}:
                return self._extract_pptx_text(path)
            if ext in {".xlsx"}:
                return self._extract_xlsx_text(path)
            if ext in TEXT_EXTENSIONS:
                raw = path.read_bytes()[:1024 * 1024]
                text = self._decode_bytes(raw)
                if ext in {".html", ".htm", ".xml"}:
                    text = _strip_markup(text)
                return text[:6000]
        except Exception as exc:
            logger.warning("File text extraction failed for %s: %s", file_path, exc)

        return ""

    def _extract_docx_text(self, path: Path) -> str:
        with zipfile.ZipFile(path, "r") as archive:
            xml = archive.read("word/document.xml").decode("utf-8", errors="ignore")
        text = re.sub(r"</w:p>", "\n", xml)
        text = re.sub(r"<[^>]+>", "", text)
        text = re.sub(r"\s+\n", "\n", text)
        text = re.sub(r"\n{2,}", "\n", text)
        return text.strip()[:6000]

    def _extract_pptx_text(self, path: Path) -> str:
        texts = []
        with zipfile.ZipFile(path, "r") as archive:
            slide_names = sorted(name for name in archive.namelist() if name.startswith("ppt/slides/slide") and name.endswith(".xml"))
            for name in slide_names[:10]:
                xml = archive.read(name).decode("utf-8", errors="ignore")
                slide_text = re.sub(r"<[^>]+>", " ", xml)
                slide_text = re.sub(r"\s+", " ", slide_text).strip()
                if slide_text:
                    texts.append(slide_text)
        return "\n".join(texts)[:6000]

    def _extract_xlsx_text(self, path: Path) -> str:
        texts = []
        with zipfile.ZipFile(path, "r") as archive:
            for name in archive.namelist():
                if not name.endswith(".xml"):
                    continue
                if not (name.startswith("xl/sharedStrings") or name.startswith("xl/worksheets") or name.startswith("xl/workbook")):
                    continue
                xml = archive.read(name).decode("utf-8", errors="ignore")
                cleaned = re.sub(r"<[^>]+>", " ", xml)
                cleaned = re.sub(r"\s+", " ", cleaned).strip()
                if cleaned:
                    texts.append(cleaned)
        return "\n".join(texts)[:6000]

    def _decode_bytes(self, raw: bytes) -> str:
        for encoding in ("utf-8", "utf-8-sig", "gb18030", "gbk", "latin1"):
            try:
                return raw.decode(encoding)
            except Exception:
                continue
        return raw.decode("utf-8", errors="ignore")

    def _fallback_image_payload(self, file_path: str, display_name: str, hint: str) -> dict:
        title = display_name or Path(file_path).stem or "图片素材"
        desc = hint.strip() if hint else ""

        try:
            image = Image.open(file_path)
            image = ImageOps.exif_transpose(image)
            width, height = image.size
            size_text = f"{width}x{height}"
            if not desc:
                desc = f"图片文件，尺寸 {size_text}"
            return {
                "title": Path(title).stem[:50],
                "content": desc[:200],
                "ocr_text": "",
                "keywords": [],
                "source": "image_metadata_fallback",
            }
        except Exception:
            return {
                "title": Path(title).stem[:50],
                "content": (desc or "图片文件")[:200],
                "ocr_text": "",
                "keywords": [],
                "source": "image_metadata_fallback",
            }

    def _fallback_file_payload(self, file_path: str, display_name: str, hint: str, extracted_text: str) -> dict:
        path = Path(file_path)
        title = Path(display_name or path.stem).stem[:50] or "文件素材"
        ext = path.suffix.lower().lstrip(".") or "unknown"
        desc = hint.strip() if hint else ""
        if not desc:
            desc = f"{ext.upper()} 文件"
        if extracted_text:
            desc = (desc + f"，已提取部分正文").strip("，")

        payload = {
            "title": title,
            "content": desc[:200],
            "extracted_text": extracted_text[:3000] if extracted_text else "",
            "keywords": [],
            "source": "file_fallback",
        }
        if hint:
            payload["user_note"] = hint
        return payload

    def _parse_json_object(self, text: str) -> dict:
        if not text:
            return {}
        try:
            return json.loads(text)
        except Exception:
            match = re.search(r"\{[\s\S]*\}", text)
            if match:
                try:
                    return json.loads(match.group(0))
                except Exception:
                    return {}
        return {}

    def _normalize_keywords(self, value) -> list[str]:
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()][:5]
        if isinstance(value, str):
            parts = re.split(r"[,\n，；;、]", value)
            return [item.strip() for item in parts if item.strip()][:5]
        return []


media_enricher = MediaEnricher()
