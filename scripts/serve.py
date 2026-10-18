"""
REGIME — local static server that behaves like the Vercel deployment.

    python scripts/serve.py [--port 8050] [--data static/data]

Serves static/ with the same rewrites as static/vercel.json: clean URLs
(/methodology → methodology.html), /stock/<SLUG> → stock.html, and
404.html for anything missing. --data points /data/ at another folder,
which is handy for testing against a small or synthetic build.
"""

import argparse
import functools
import http.server
import re
import socketserver
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / 'static'


class Handler(http.server.SimpleHTTPRequestHandler):
    data_dir: Path | None = None

    def translate_path(self, path):
        clean = path.split('?', 1)[0].split('#', 1)[0]
        if self.data_dir and clean.startswith('/data/'):
            return str(self.data_dir / clean[len('/data/'):])
        if re.fullmatch(r'/stock/[^/]+/?', clean):
            return str(ROOT / 'stock.html')
        target = ROOT / clean.lstrip('/')
        if clean == '/' or target.is_dir():
            return str(target / 'index.html')
        if not target.exists() and (ROOT / (clean.lstrip('/') + '.html')).exists():
            return str(ROOT / (clean.lstrip('/') + '.html'))
        return str(target)

    def send_error(self, code, message=None, explain=None):
        page = ROOT / '404.html'
        if code == 404 and page.exists() and not self.path.startswith('/data/'):
            body = page.read_bytes()
            self.send_response(404)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().send_error(code, message, explain)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8050)
    ap.add_argument('--data', default=None)
    args = ap.parse_args()
    Handler.data_dir = Path(args.data).resolve() if args.data else None
    Handler.extensions_map = {**Handler.extensions_map, '.js': 'text/javascript', '.woff2': 'font/woff2'}
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(('127.0.0.1', args.port), functools.partial(Handler, directory=str(ROOT))) as httpd:
        print(f'REGIME on http://127.0.0.1:{args.port}', flush=True)
        httpd.serve_forever()


if __name__ == '__main__':
    main()
