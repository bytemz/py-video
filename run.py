"""影阁 PyVideo 启动脚本。"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="影阁 - 局域网 4K 影库")
    parser.add_argument("--port", type=int, default=None, help="监听端口（默认 8686）")
    parser.add_argument("--no-browser", action="store_true", help="启动时不自动打开浏览器")
    args = parser.parse_args()

    if getattr(sys, "frozen", False):
        base = Path(sys.executable).resolve().parent
    else:
        base = Path(__file__).resolve().parent
        if str(base) not in sys.path:
            sys.path.insert(0, str(base))

    from app.main import launch

    try:
        launch(port=args.port, no_browser=args.no_browser)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
