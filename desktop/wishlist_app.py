"""我的心愿单 Windows app: the wish hub page in its own app window, and an icon in the system tray to open it again.

The page itself lives on GitHub Pages and is always the latest, so this launcher never needs updating.
It opens the window with the browser's everyday profile (Chrome, else Edge): the page keeps its data in
that profile's localStorage, so the sync password, the saved items and the 书屿 sign-in used for the
netdisk accounts are the same as in the browser. There is no service behind it: the tray icon is only a
way back to the window, like 书屿's and Plexus's, and can start with Windows."""
from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys
import webbrowser

APP_NAME = '我的心愿单'
URL = 'https://therookiegit.github.io/my-collections/'
RUN_KEY = r'Software\Microsoft\Windows\CurrentVersion\Run'
RUN_VALUE = 'MyCollections'
MUTEX = 'Local\\MyCollectionsTray'
BUNDLE = Path(getattr(sys,'_MEIPASS',Path(__file__).resolve().parent.parent))
ICON = BUNDLE/'apple-touch-icon.png'
FROZEN = getattr(sys,'frozen',False)
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


def open_window(url=URL):
    browser = find_browser()
    if browser:subprocess.Popen(window_command(browser,url),creationflags=NO_WINDOW)
    else:webbrowser.open(url)


# Start with Windows ---------------------------------------------------------------------------
def launch_command():
    if FROZEN:return f'"{sys.executable}" --minimized'
    return f'"{sys.executable}" "{Path(__file__).resolve()}" --minimized'


def autostart_enabled():
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER,RUN_KEY) as key:
            return winreg.QueryValueEx(key,RUN_VALUE)[0]==launch_command()
    except OSError:
        return False


def set_autostart(enabled):
    import winreg
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER,RUN_KEY,0,winreg.KEY_SET_VALUE) as key:
        if enabled:
            winreg.SetValueEx(key,RUN_VALUE,0,winreg.REG_SZ,launch_command())
        else:
            try:winreg.DeleteValue(key,RUN_VALUE)
            except FileNotFoundError:pass


# Tray -----------------------------------------------------------------------------------------
def first_instance():
    """Hold a named mutex for as long as this process lives; False when another copy holds it."""
    import ctypes
    kernel = ctypes.windll.kernel32
    first_instance.handle = kernel.CreateMutexW(None,False,MUTEX)
    return kernel.GetLastError()!=183  # ERROR_ALREADY_EXISTS


def main(argv=sys.argv[1:]):
    minimized = '--minimized' in argv
    url = URL+next((a for a in argv if a.startswith('#')),'')  # e.g. #add=… from a shortcut
    if not first_instance():
        # Already in the tray: just show the page.
        if not minimized:open_window(url)
        return
    import pystray
    from PIL import Image

    tray = pystray.Icon('mycollections',Image.open(ICON),APP_NAME,menu=pystray.Menu(
        pystray.MenuItem('打开我的心愿单',lambda *_:open_window(),default=True),
        pystray.MenuItem('开机自动启动',lambda *_:set_autostart(not autostart_enabled()),checked=lambda _:autostart_enabled()),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem('退出',lambda icon,_:icon.stop())))
    if not minimized:open_window(url)
    tray.run()


if __name__=='__main__':
    main()
