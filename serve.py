#!/usr/bin/env python3
"""Dev server for the cinematic sandbox.

Use this instead of `python -m http.server`.

`http.server` sends no Cache-Control header at all, so browsers apply
heuristic caching and happily keep serving index.html, flat.js and
flat.css from disk cache long after you have edited them. That turns
every review into "did my change not work, or am I looking at yesterday's
build?", which is a miserable way to iterate on animation timing.

This serves the same directory with caching switched off, so a plain
reload is always a real reload.

    python serve.py            # http://localhost:8080/
    python serve.py 8090       # a different port
"""

import functools
import http.server
import os
import socketserver
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        # One line per request, without the noisy timestamp prefix.
        sys.stderr.write('%s\n' % (fmt % args))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    root = os.path.dirname(os.path.abspath(__file__))
    handler = functools.partial(NoCacheHandler, directory=root)

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(('', port), handler) as httpd:
        print('Cinematic sandbox  ->  http://localhost:%d/' % port)
        print('Serving %s with caching disabled. Ctrl+C to stop.' % root)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nStopped.')


if __name__ == '__main__':
    main()
