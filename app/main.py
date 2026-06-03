import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import init_db
from app.routers import callback, sync, messages, ingest, categories, projects, system
from app.services.request_context import reset_current_mimo_api_key, set_current_mimo_api_key


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="WeChat Organization Assistant", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def bind_mimo_api_key(request: Request, call_next):
    token = set_current_mimo_api_key(request.headers.get("x-mimo-api-key", ""))
    try:
        response = await call_next(request)
    finally:
        reset_current_mimo_api_key(token)
    return response

app.include_router(callback.router)
app.include_router(sync.router)
app.include_router(messages.router)
app.include_router(ingest.router)
app.include_router(categories.router)
app.include_router(projects.router)
app.include_router(system.router)

@app.get("/ingest")
async def ingest_page():
    """手动提交页面"""
    return FileResponse("app/static/ingest.html")


@app.get("/")
def root():
    return {
        "app": "微信整理助手 WeChat Organization Assistant",
        "version": "1.0.0",
        "docs": "/docs",
        "frontend_dev": "http://localhost:5173 (Vite dev server)",
        "endpoints": {
            "health": "/health",
            "callback": "/callback/kf",
            "sync": "/sync/messages",
            "messages": "/messages",
            "stats": "/messages/stats/categories",
        },
    }


@app.get("/health")
def health():
    return {"status": "ok"}


# 在生产模式下提供前端静态文件
_frontend_dir = Path("frontend/dist")
if _frontend_dir.is_dir():
    app.mount("/assets", StaticFiles(directory=str(_frontend_dir / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        file_path = _frontend_dir / full_path
        if file_path.is_file():
            return FileResponse(str(file_path))
        index_path = _frontend_dir / "index.html"
        if index_path.is_file():
            return FileResponse(str(index_path))
        return {"error": "not found"}
