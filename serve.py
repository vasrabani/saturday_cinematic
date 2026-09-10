#!/usr/bin/env python3
"""Dev server for the cinematic sandbox.

Use this instead of `python -m http.server`.

`http.server` sends no Cache-Control header at all, so browsers apply
heuristic caching and happily keep serving index.html, flat.js and
flat.css from disk cache long after you have edited them. That turns
every review into "did my change not work, or am I looking at yesterday's
build?", which is a miserable way to iterate on animation timing.

This serves the same directory with caching switched off, so a plain
reload is always a real reload. It listens on this machine only, and
never serves the repository's dot-directories (.git and the like).

    python serve.py                  # http://localhost:8080/
    python serve.py 8090             # a different port
    python serve.py --host 0.0.0.0   # reachable from the LAN (a phone on the same Wi-Fi)
"""

import argparse
import functools
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def send_head(self):
        # Nothing under a dot-directory: .git holds the whole history.
        path = self.path.split('?', 1)[0].split('#', 1)[0]
        if any(part.startswith('.') for part in path.split('/') if part):
            self.send_error(404, 'Not found')
            return None
        return super().send_head()

    def log_message(self, fmt, *args):
        # One line per request, without the noisy timestamp prefix.
        sys.stderr.write('%s\n' % (fmt % args))


class Server(http.server.ThreadingHTTPServer):
    allow_reuse_address = True


def port_number(text):
    try:
        port = int(text)
    except ValueError:
        raise argparse.ArgumentTypeError('%r is not a port number' % text)
    if not 1 <= port <= 65535:
        raise argparse.ArgumentTypeError('ports run from 1 to 65535, not %d' % port)
    return port


def main():
    parser = argparse.ArgumentParser(description='Serve the cinematic sandbox with caching off.')
    parser.add_argument('port', nargs='?', type=port_number, default=8080)
    parser.add_argument('--host', default='127.0.0.1',
                        help='interface to listen on (default: this machine only)')
    args = parser.parse_args()

    root = os.path.dirname(os.path.abspath(__file__))
    handler = functools.partial(NoCacheHandler, directory=root)
    with Server((args.host, args.port), handler) as httpd:
        print('Cinematic sandbox  ->  http://localhost:%d/' % args.port)
        print('Serving %s on %s with caching disabled. Ctrl+C to stop.' % (root, args.host))
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nStopped.')


if __name__ == '__main__':
    main()
