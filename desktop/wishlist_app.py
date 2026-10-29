"""我的心愿单 Windows app: the wish hub page in its own app window, without tabs or an address bar.

The page itself lives on GitHub Pages and is always the latest, so this launcher never needs updating.
It opens the window with the browser's everyday profile (Chrome, else Edge): the page keeps its data in
that profile's localStorage, so the sync password, the saved items and the 书屿 sign-in used for the
netdisk accounts are the same as in the browser."""
from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys
import webbrowser

URL = 'https://therookiegit.github.io/my-collections/'
NO_WINDOW = getattr(subprocess,'CREATE_NO_WINDOW',0)
BROWSERS = [('Google','Chrome','chrome.exe'),('Microsoft','Edge','msedge.exe')]


def find_browser(env=os.environ):
    """Chrome or Edge, wherever Windows put it; None when neither is installed."""
    for vendor,name,exe in BROWSERS:
        for base in [env.get('PROGRAMFILES'),env.get('PROGRAMFILES(X86)'),env.get('LOCALAPPDATA')]:
            if base:
                path = Path(base)/vendor/name/'Application'/exe
                if path.is_file():return path
    return None


def window_command(browser,url=URL):
    return [str(browser),f'--app={url}','--window-size=1280,860']


def main(argv=sys.argv[1:]):
    url = URL+(argv[0] if argv and argv[0].startswith('#') else '')  # e.g. #add=… from a shortcut
    browser = find_browser()
    if browser:subprocess.Popen(window_command(browser,url),creationflags=NO_WINDOW)
    else:webbrowser.open(url)


if __name__=='__main__':
    main()
