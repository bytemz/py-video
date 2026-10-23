"""局域网地址与二维码。"""
from __future__ import annotations

import io
import ipaddress
import socket

import qrcode
import qrcode.image.svg


def _private_ip(value: str) -> bool:
    try:
        addr = ipaddress.ip_address(value)
    except ValueError:
        return False
    return addr.version == 4 and addr.is_private and not addr.is_loopback and not addr.is_link_local


def primary_ip() -> str:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("223.5.5.5", 80))
        ip = sock.getsockname()[0]
        if _private_ip(ip):
            return ip
    except OSError:
        pass
    finally:
        sock.close()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            candidate = info[4][0]
            if _private_ip(candidate):
                return candidate
    except OSError:
        pass
    return "127.0.0.1"


def lan_addresses() -> list[str]:
    result: list[str] = []
    primary = primary_ip()
    if primary != "127.0.0.1":
        result.append(primary)
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            candidate = info[4][0]
            if _private_ip(candidate) and candidate not in result:
                result.append(candidate)
    except OSError:
        pass
    if not result:
        result.append("127.0.0.1")
    return result


def urls_for(port: int) -> dict:
    primary = primary_ip()
    lan = lan_addresses()
    lan_urls = [f"http://{ip}:{port}" for ip in lan]
    watch_base = f"http://{primary}:{port}"
    return {
        "primary_ip": primary,
        "local": f"http://127.0.0.1:{port}",
        "lan": lan_urls,
        "watch": f"{watch_base}/watch",
        "pc": f"{watch_base}/pc",
    }


def qr_svg(data: str) -> bytes:
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=2,
    )
    qr.add_data(data)
    qr.make(fit=True)
    image = qr.make_image(image_factory=qrcode.image.svg.SvgPathImage)
    buffer = io.BytesIO()
    image.save(buffer)
    return buffer.getvalue()
