from pathlib import Path
from pydantic_settings import BaseSettings

# 项目根目录（config.py 的上级目录）
_PROJECT_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    # 企业微信配置
    WECOM_CORP_ID: str = ""
    WECOM_CORP_SECRET: str = ""
    WECOM_TOKEN: str = ""
    WECOM_ENCODING_AES_KEY: str = ""

    # 企业微信客服API
    WECOM_BASE_URL: str = "https://qyapi.weixin.qq.com"
    WECOM_KF_OPEN_KFID: str = ""

    # Xiaomi MiMo-V2.5 配置 (OpenAI 兼容协议)
    MIMO_API_KEY: str = ""
    MIMO_BASE_URL: str = "https://token-plan-cn.xiaomimimo.com/v1"
    MIMO_MODEL: str = "mimo-v2.5"
    MIMO_ASR_MODEL: str = "mimo-v2.5-asr"

    # 数据库配置（使用绝对路径）
    DATABASE_URL: str = f"sqlite:///{_PROJECT_ROOT / 'data' / 'wechat_org.db'}"

    # 媒体文件存储
    MEDIA_DIR: str = str(_PROJECT_ROOT / "media")

    # Web 服务
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    CORS_ORIGINS: str = "*"

    # 日志
    LOG_LEVEL: str = "INFO"

    model_config = {"env_file": str(_PROJECT_ROOT / ".env"), "env_file_encoding": "utf-8"}


settings = Settings()

# 确保数据目录和媒体目录存在
(_PROJECT_ROOT / "data").mkdir(exist_ok=True)
(_PROJECT_ROOT / settings.MEDIA_DIR).mkdir(exist_ok=True)
