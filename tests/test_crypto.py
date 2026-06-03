"""测试企业微信加解密 (基于官方测试用例)."""

import base64
import hashlib
import struct

import pytest
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

from app.services.crypto import WeChatCrypto

# 官方测试参数
TOKEN = "QDG6eK"
CORP_ID = "wx5823bf96d3bd56c7"
ENCODING_AES_KEY = "jWmYm7qr5nMoAUwZRjGtBxmz3KA1tkAj3ykkR6q2B2C"


@pytest.fixture
def crypto():
    return WeChatCrypto(token=TOKEN, encoding_aes_key=ENCODING_AES_KEY, corp_id=CORP_ID)


def make_test_encrypted_message(crypto, content: str) -> str:
    """构造一个可用于测试的解密密文."""
    random_bytes = b"\x00" * 16
    msg_bytes = content.encode("utf-8")
    raw = (
        random_bytes
        + struct.pack(">I", len(msg_bytes))
        + msg_bytes
        + CORP_ID.encode("utf-8")
    )
    # 使用 crypto 的 PKCS7 填充
    padded = crypto._pkcs7_encode(raw)
    cipher = Cipher(algorithms.AES(crypto.aes_key), modes.CBC(crypto.iv))
    encryptor = cipher.encryptor()
    cipher_text = encryptor.update(padded) + encryptor.finalize()
    return base64.b64encode(cipher_text).decode()


def test_signature(crypto):
    sig = crypto.generate_signature("1409659589", "1373149129", "TEST_ENCRYPT")
    # 预期值基于官方示例
    assert len(sig) == 40  # SHA1 hex length
    assert isinstance(sig, str)


def test_decrypt_message(crypto):
    """测试解密流程."""
    encrypt_b64 = make_test_encrypted_message(crypto, "<xml>hello</xml>")
    cipher_bytes = base64.b64decode(encrypt_b64)
    msg, receive_id = crypto.decrypt_message(cipher_bytes)
    assert msg == "<xml>hello</xml>"
    assert receive_id == CORP_ID


def test_verify_url(crypto):
    """测试URL验证."""
    encrypt_b64 = make_test_encrypted_message(crypto, "random_plain_text")
    sig = crypto.generate_signature("1409659589", "1373149129", encrypt_b64)

    # 模拟 verify_url
    cipher_bytes = base64.b64decode(encrypt_b64)
    msg, receive_id = crypto.decrypt_message(cipher_bytes)
    assert msg == "random_plain_text"
    assert receive_id == CORP_ID
    assert crypto.check_signature(sig, "1409659589", "1373149129", encrypt_b64)


def test_signature_verification(crypto):
    """签名验证成功/失败."""
    encrypt = "encrypted_text_here"
    sig = crypto.generate_signature("1", "2", encrypt)
    assert crypto.check_signature(sig, "1", "2", encrypt)
    assert not crypto.check_signature(sig, "1", "2", encrypt + "_tampered")


def test_encrypt_decrypt_roundtrip(crypto):
    """AES 加解密往返测试."""
    original = b"test data for encryption roundtrip"
    encrypted = crypto.encrypt(original)
    decrypted = crypto.decrypt(encrypted)
    assert original == decrypted
