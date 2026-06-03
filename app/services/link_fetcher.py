"""Link extraction and platform-aware fetching for shared content."""

from __future__ import annotations

import json
import logging
import re
from html import unescape
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

import requests

logger = logging.getLogger(__name__)

JINA_READER = "https://r.jina.ai"
REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}
URL_PATTERN = re.compile(r"https?://[^\s<>\u3000\"'）】]+", re.I)
TRAILING_PUNCTUATION = ".,!?;:'\")]}，。！？；：】）》」"
SHORT_LINK_HOSTS = {
    "xhslink.com",
    "www.xhslink.com",
    "b23.tv",
    "www.b23.tv",
    "v.douyin.com",
    "www.v.douyin.com",
}
XHS_HOSTS = {"xiaohongshu.com", "www.xiaohongshu.com"}
BILI_HOSTS = {"bilibili.com", "www.bilibili.com", "m.bilibili.com"}
DOUYIN_HOSTS = {"douyin.com", "www.douyin.com"}
PLATFORM_LABELS = {
    "xiaohongshu.com": "小红书",
    "www.xiaohongshu.com": "小红书",
    "xhslink.com": "小红书",
    "www.xhslink.com": "小红书",
    "bilibili.com": "B站",
    "www.bilibili.com": "B站",
    "m.bilibili.com": "B站",
    "b23.tv": "B站",
    "www.b23.tv": "B站",
    "mp.weixin.qq.com": "微信公众号",
    "douyin.com": "抖音",
    "www.douyin.com": "抖音",
    "v.douyin.com": "抖音",
    "www.v.douyin.com": "抖音",
}


def should_fetch(url: str) -> bool:
    if not url:
        return False
    return bool(urlparse(url).netloc)


def _clean_url(url: str) -> str:
    return (url or "").strip().rstrip(TRAILING_PUNCTUATION)


def _extract_urls(text: str) -> list[str]:
    if not text:
        return []
    return [_clean_url(item) for item in URL_PATTERN.findall(text)]


def extract_url(raw_content: str) -> str:
    """Extract the first URL from raw_content JSON or plain share text."""
    if not raw_content:
        return ""

    try:
        data = json.loads(raw_content)
        msgtype = data.get("msgtype")
        if msgtype == "link":
            link = data.get("link", {})
            candidates = [link.get("url", ""), link.get("title", ""), link.get("desc", "")]
        elif msgtype == "text":
            candidates = [data.get("text", {}).get("content", "")]
        else:
            candidates = [raw_content]

        for candidate in candidates:
            urls = _extract_urls(candidate)
            if urls:
                return urls[0]
    except (json.JSONDecodeError, TypeError, AttributeError):
        pass

    urls = _extract_urls(raw_content)
    return urls[0] if urls else ""


def parse_share_text(text: str) -> dict:
    """Parse copied share text into title, desc and url fields."""
    cleaned = (text or "").strip()
    url = extract_url(cleaned)
    without_url = cleaned.replace(url, " ") if url else cleaned
    lines = [line.strip() for line in without_url.splitlines() if line.strip()]
    compact = re.sub(r"\s+", " ", without_url).strip()
    compact = compact.rstrip(TRAILING_PUNCTUATION)

    title = lines[0] if lines else compact
    if title and len(title) > 100:
        title = title[:100]

    desc_parts = []
    for line in lines[1:]:
        if "戳进【小红书】看看这篇好文" in line:
            continue
        if "打开抖音" in line or "打开哔哩哔哩" in line or "打开微信" in line:
            continue
        desc_parts.append(line)

    desc = "\n".join(desc_parts).strip()
    if not desc:
        desc = compact[:1000]

    return {
        "title": title or "分享链接",
        "desc": desc[:1000],
        "url": url,
        "raw_text": cleaned[:2000],
    }


def _get_platform_label(url: str) -> str:
    host = urlparse(url).netloc.lower()
    return PLATFORM_LABELS.get(host, "")


def _resolve_short_url(url: str) -> str:
    host = urlparse(url).netloc.lower()
    if host not in SHORT_LINK_HOSTS:
        return url

    try:
        with requests.Session() as session:
            resp = session.get(
                url,
                timeout=15,
                headers=REQUEST_HEADERS,
                allow_redirects=True,
                stream=True,
            )
            resolved = str(resp.url or url)
            resp.close()
        logger.info("Resolved short url: %s -> %s", url, resolved)
        return resolved
    except Exception as exc:
        logger.debug("Short url resolve failed for %s: %s", url, exc)
        return url


def _get_xiaohongshu_note_id(parsed) -> str:
    query = parse_qs(parsed.query)
    for key in ("target_note_id", "note_id", "noteId"):
        value = (query.get(key) or [""])[0]
        if value:
            return value

    match = re.search(r"/(?:explore|discovery/item)/([A-Za-z0-9]+)", parsed.path, re.I)
    if match:
        return match.group(1)
    return ""


def _canonicalize_url(url: str) -> str:
    parsed = urlparse(url)
    host = parsed.netloc.lower()
    query = parse_qs(parsed.query)

    if host in XHS_HOSTS:
        note_id = _get_xiaohongshu_note_id(parsed)
        path = f"/explore/{note_id}" if note_id else parsed.path
        return urlunparse((parsed.scheme or "https", parsed.netloc, path, "", "", ""))

    if host in BILI_HOSTS:
        return urlunparse((parsed.scheme or "https", parsed.netloc, parsed.path, "", "", ""))

    if host == "mp.weixin.qq.com":
        keep = {}
        for key in ("__biz", "biz", "mid", "idx", "sn"):
            if key in query and query[key]:
                keep[key] = query[key][0]
        query_string = urlencode(keep)
        return urlunparse((parsed.scheme or "https", parsed.netloc, parsed.path, "", query_string, ""))

    if host in DOUYIN_HOSTS:
        return urlunparse((parsed.scheme or "https", parsed.netloc, parsed.path, "", "", ""))

    return urlunparse((parsed.scheme or "https", parsed.netloc, parsed.path, "", parsed.query, ""))


def _extract_platform_id(url: str) -> str:
    parsed = urlparse(url)
    host = parsed.netloc.lower()
    query = parse_qs(parsed.query)

    if host in XHS_HOSTS:
        return _get_xiaohongshu_note_id(parsed)

    if host in BILI_HOSTS:
        for pattern in (r"/video/((?:BV[0-9A-Za-z]+)|(?:av\d+))", r"/opus/(\d+)"):
            match = re.search(pattern, parsed.path, re.I)
            if match:
                return match.group(1)

    if host in DOUYIN_HOSTS:
        match = re.search(r"/(?:video|note)/(\d+)", parsed.path, re.I)
        if match:
            return match.group(1)

    if host == "mp.weixin.qq.com":
        biz = (query.get("__biz") or query.get("biz") or [""])[0]
        mid = (query.get("mid") or [""])[0]
        idx = (query.get("idx") or [""])[0]
        if biz or mid or idx:
            return ":".join(part for part in [biz, mid, idx] if part)

    return ""


def _build_platform_fallback(url: str, reason: str = "", share_title: str = "", share_desc: str = "") -> dict:
    platform = _get_platform_label(url)
    canonical_url = _canonicalize_url(url)
    content_id = _extract_platform_id(url)

    lines = []
    if platform:
        lines.append(f"平台: {platform}")
    if content_id:
        lines.append(f"内容ID: {content_id}")
    if share_title:
        lines.append(f"分享标题: {share_title[:200]}")
    if share_desc and share_desc != share_title:
        lines.append(f"分享摘要: {share_desc[:500]}")
    lines.append(f"链接: {canonical_url}")
    if reason:
        lines.append(f"说明: {reason}")
    if platform:
        lines.append(f"这是一条{platform}分享链接，当前先按平台链接归档，后续可继续补抓标题和正文。")

    title = share_title[:200] if share_title else (f"{platform}链接" if platform else "网页链接")
    return {
        "title": title,
        "content": "\n".join(lines),
        "url": canonical_url,
        "platform": platform,
    }


def _extract_meta_value(html: str, keys: list[str]) -> str:
    for key in keys:
        patterns = [
            rf'<meta[^>]+property=["\']{re.escape(key)}["\'][^>]+content=["\']([^"\']+)["\']',
            rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']{re.escape(key)}["\']',
            rf'<meta[^>]+name=["\']{re.escape(key)}["\'][^>]+content=["\']([^"\']+)["\']',
            rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+name=["\']{re.escape(key)}["\']',
        ]
        for pattern in patterns:
            match = re.search(pattern, html, re.I)
            if match:
                return unescape(match.group(1).strip())
    return ""


def _strip_html(html: str) -> str:
    if not html:
        return ""
    cleaned = re.sub(r"<script[\s\S]*?</script>", " ", html, flags=re.I)
    cleaned = re.sub(r"<style[\s\S]*?</style>", " ", cleaned, flags=re.I)
    cleaned = re.sub(r"<noscript[\s\S]*?</noscript>", " ", cleaned, flags=re.I)
    cleaned = re.sub(r"<[^>]+>", " ", cleaned)
    cleaned = unescape(cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip()


def _extract_xhs_embedded_summary(html: str, url: str) -> dict:
    note_id = _extract_platform_id(url)
    title = ""
    desc = ""

    for pattern in (r'"title"\s*:\s*"([^"]+)"', r'"noteTitle"\s*:\s*"([^"]+)"'):
        match = re.search(pattern, html)
        if match:
            title = unescape(match.group(1))
            break

    for pattern in (r'"desc"\s*:\s*"([^"]+)"', r'"description"\s*:\s*"([^"]+)"', r'"content"\s*:\s*"([^"]+)"'):
        match = re.search(pattern, html)
        if match:
            desc = unescape(match.group(1))
            break

    if title or desc or note_id:
        lines = ["平台: 小红书"]
        if note_id:
            lines.append(f"内容ID: {note_id}")
        if title:
            lines.append(f"标题: {title[:200]}")
        if desc:
            lines.append(f"摘要: {desc[:400]}")
        lines.append(f"链接: {_canonicalize_url(url)}")
        return {
            "title": title[:200] if title else "小红书链接",
            "content": "\n".join(lines),
            "url": _canonicalize_url(url),
            "platform": "小红书",
        }

    return {}


def _extract_html_meta(url: str) -> dict:
    try:
        resp = requests.get(url, timeout=15, headers=REQUEST_HEADERS)
        resp.raise_for_status()
        html = resp.text[:250000]

        platform = _get_platform_label(url)
        if platform == "小红书":
            xhs_result = _extract_xhs_embedded_summary(html, url)
            if xhs_result:
                return xhs_result

        title = _extract_meta_value(html, ["og:title", "twitter:title"])
        if not title:
            match = re.search(r"<title[^>]*>([^<]+)</title>", html, re.I)
            title = unescape(match.group(1).strip()) if match else ""

        desc = _extract_meta_value(html, ["og:description", "description", "twitter:description"])
        article = _strip_html(html)[:1200]
        content = " ".join(part for part in [desc, article] if part).strip()
        final_title = title[:200] if title else (platform or url)

        logger.info("Direct fetch OK: %s, title=%s, content_len=%d", url, final_title[:40], len(content))
        return {
            "title": final_title,
            "content": content[:1200],
            "url": _canonicalize_url(url),
            "platform": platform,
        }
    except Exception as exc:
        logger.debug("Direct fetch failed for %s: %s", url, exc)
        return {}


def _fetch_via_jina(url: str) -> dict:
    try:
        resp = requests.get(f"{JINA_READER}/{url}", timeout=20, headers=REQUEST_HEADERS)
        resp.raise_for_status()
        text = resp.text.strip()
        if not text:
            return {}

        lines = [line.strip() for line in text.splitlines() if line.strip()]
        title = ""
        content_lines = []
        for line in lines:
            if not title and line.startswith("# "):
                title = line[2:].strip()
                continue
            content_lines.append(line)

        content = "\n".join(content_lines).strip()[:1200]
        if title or content:
            logger.info("Jina fetch OK: %s", url)
            return {
                "title": title[:200] if title else lines[0][:200],
                "content": content,
                "url": _canonicalize_url(url),
                "platform": _get_platform_label(url),
            }
    except Exception as exc:
        logger.debug("Jina fetch failed for %s: %s", url, exc)
    return {}


def fetch_url_content(url: str, share_title: str = "", share_desc: str = "") -> dict:
    """Fetch URL content with platform-aware fallback when page access fails."""
    if not should_fetch(url):
        return {"title": "", "content": "", "url": url, "platform": ""}

    resolved_url = _resolve_short_url(_clean_url(url))
    jina_result = _fetch_via_jina(resolved_url)
    if jina_result.get("title") or jina_result.get("content"):
        return jina_result

    html_result = _extract_html_meta(resolved_url)
    if html_result.get("title") or html_result.get("content"):
        return html_result

    return _build_platform_fallback(
        resolved_url,
        reason="页面抓取失败，已降级为平台链接摘要",
        share_title=share_title,
        share_desc=share_desc,
    )
