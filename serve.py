"""Server Exam Support をこのPCの中だけで配信する（127.0.0.1 のみ・キャッシュ無効）。"""
import functools
import http.server
import os

PORT = 8755
ROOT = os.path.dirname(os.path.abspath(__file__))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # アプリを更新したとき、古いJSやテンプレートが残らないようにする
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    handler = functools.partial(NoCacheHandler, directory=ROOT)
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler) as httpd:
        print(f"Server Exam Support: http://127.0.0.1:{PORT}/  (この画面を閉じると終了)")
        httpd.serve_forever()
