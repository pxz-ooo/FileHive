from contextvars import ContextVar, Token

_current_mimo_api_key: ContextVar[str] = ContextVar("current_mimo_api_key", default="")


def set_current_mimo_api_key(api_key: str) -> Token:
    return _current_mimo_api_key.set((api_key or "").strip())


def reset_current_mimo_api_key(token: Token) -> None:
    _current_mimo_api_key.reset(token)


def get_current_mimo_api_key() -> str:
    return _current_mimo_api_key.get("")
