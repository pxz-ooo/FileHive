import base64
import hashlib
import os
import struct
import xml.etree.ElementTree as ET
from typing import Tuple

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives import padding

from app.config import settings


class WeChatCrypto:
    """企业微信加解密 (AES-256-CBC + PKCS7)"""

    def __init__(self, token: str = None, encoding_aes_key: str = None, corp_id: str = None):
        self.token = token or settings.WECOM_TOKEN
        self.corp_id = corp_id or settings.WECOM_CORP_ID

        aes_key_b64 = (encoding_aes_key or settings.WECOM_ENCODING_AES_KEY) + "="
        self.aes_key = base64.b64decode(aes_key_b64)
        self.iv = self.aes_key[:16]

    def _pkcs7_decode(self, data: bytes) -> bytes:
        pad_len = data[-1]
        if pad_len < 1 or pad_len > 32:
            raise ValueError("Invalid PKCS7 padding")
        return data[:-pad_len]

    def _pkcs7_encode(self, data: bytes) -> bytes:
        padder = padding.PKCS7(256).padder()
        return padder.update(data) + padder.finalize()

    def decrypt(self, cipher_text: bytes) -> bytes:
        """解密 AES 密文，返回明文."""
        cipher = Cipher(algorithms.AES(self.aes_key), modes.CBC(self.iv))
        decryptor = cipher.decryptor()
        padded = decryptor.update(cipher_text) + decryptor.finalize()
        return self._pkcs7_decode(padded)

    def encrypt(self, plain_text: bytes) -> bytes:
        """加密明文，返回 AES 密文."""
        padded = self._pkcs7_encode(plain_text)
        cipher = Cipher(algorithms.AES(self.aes_key), modes.CBC(self.iv))
        encryptor = cipher.encryptor()
        return encryptor.update(padded) + encryptor.finalize()

    def decrypt_message(self, cipher_text: bytes) -> Tuple[str, str]:
        """解密回调消息，返回 (msg_content_xml, corp_id)."""
        raw = self.decrypt(cipher_text)
        # 格式: random(16) + msg_len(4B BE) + msg + corp_id
        msg_len = struct.unpack(">I", raw[16:20])[0]
        msg = raw[20:20 + msg_len].decode("utf-8")
        receive_id = raw[20 + msg_len:].decode("utf-8")
        return msg, receive_id

    def encrypt_message(self, reply_xml: str) -> str:
        """加密被动回复消息，返回 base64 密文."""
        random_bytes = os.urandom(16)
        msg_bytes = reply_xml.encode("utf-8")
        raw = (
            random_bytes
            + struct.pack(">I", len(msg_bytes))
            + msg_bytes
            + self.corp_id.encode("utf-8")
        )
        cipher = self.encrypt(raw)
        return base64.b64encode(cipher).decode("utf-8")

    def verify_url(self, msg_signature: str, timestamp: str, nonce: str, echostr: str) -> str:
        """验证回调URL (GET 请求)，返回解密后的 echostr 明文."""
        cipher_text = base64.b64decode(echostr)
        msg, receive_id = self.decrypt_message(cipher_text)
        if receive_id != self.corp_id:
            raise ValueError(f"corp_id mismatch: {receive_id} != {self.corp_id}")
        return msg

    def generate_signature(self, timestamp: str, nonce: str, encrypted: str = "") -> str:
        """生成签名 (用于验证或响应)."""
        arr = sorted([self.token, timestamp, nonce, encrypted])
        raw = "".join(arr)
        return hashlib.sha1(raw.encode("utf-8")).hexdigest()

    def check_signature(self, msg_signature: str, timestamp: str, nonce: str, encrypted: str = "") -> bool:
        """验证签名是否正确."""
        return self.generate_signature(timestamp, nonce, encrypted) == msg_signature

    def parse_callback_xml(self, xml_body: bytes) -> dict:
        """解析回调推送的 XML."""
        root = ET.fromstring(xml_body)
        result = {}
        for child in root:
            result[child.tag] = child.text or ""
        return result

    def handle_callback(self, query_params: dict, xml_body: bytes) -> dict:
        """处理完整的回调请求：验证签名 → 解密 → 解析.
        返回 {"encrypt": 密文, "msg": 解密后XML字典, "receive_id": corp_id}
        """
        msg_signature = query_params.get("msg_signature", "")
        timestamp = query_params.get("timestamp", "")
        nonce = query_params.get("nonce", "")

        parsed = self.parse_callback_xml(xml_body)
        encrypt_text = parsed.get("Encrypt", "")

        if not self.check_signature(msg_signature, timestamp, nonce, encrypt_text):
            raise ValueError("Signature verification failed")

        cipher_bytes = base64.b64decode(encrypt_text)
        msg_xml, receive_id = self.decrypt_message(cipher_bytes)
        msg_data = self.parse_callback_xml(msg_xml.encode("utf-8"))

        return {"encrypt": encrypt_text, "msg": msg_data, "receive_id": receive_id}
