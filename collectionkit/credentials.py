"""Drive sign-ins shared by every app of this Windows user: signing in or out in one shows in all of them.

Each drive keeps one row with a revision number. Signing in or out writes the row and bumps the revision; an app
notices the new revision on its next request and loads the row again. Cookies stay encrypted with DPAPI as before."""
from __future__ import annotations

from contextlib import contextmanager
import json
import os
from pathlib import Path
import sqlite3
import time


def default_dir():
    return Path(os.environ.get('COLLECTIONKIT_DIR') or Path(os.environ.get('LOCALAPPDATA') or Path.home())/'CollectionKit')


class Credentials:
    def __init__(self,folder=None):
        folder = Path(folder or default_dir())
        folder.mkdir(parents=True,exist_ok=True)
        self.path = folder/'netdisk.sqlite3'
        with self.db() as db:
            db.execute('CREATE TABLE IF NOT EXISTS sessions (drive TEXT PRIMARY KEY,value TEXT NOT NULL,rev INTEGER NOT NULL,updated REAL NOT NULL)')

    @contextmanager
    def db(self):
        # Several apps write here, so wait for another one's write instead of failing.
        conn = sqlite3.connect(self.path,timeout=30)
        conn.row_factory = sqlite3.Row
        try:
            with conn:yield conn
        finally:
            conn.close()

    def rev(self,drive):
        """0 until the drive was ever signed in to."""
        with self.db() as db:
            row = db.execute('SELECT rev FROM sessions WHERE drive=?',(drive,)).fetchone()
        return row['rev'] if row else 0

    def get(self,drive):
        """(revision, saved values) for one drive."""
        with self.db() as db:
            row = db.execute('SELECT value,rev FROM sessions WHERE drive=?',(drive,)).fetchone()
        return (row['rev'],json.loads(row['value'])) if row else (0,{})

    def put(self,drive,values):
        """Save a sign-in, or {} for a sign-out; the new revision."""
        with self.db() as db:
            db.execute('''INSERT INTO sessions VALUES (?,?,1,?)
                          ON CONFLICT(drive) DO UPDATE SET value=excluded.value,rev=sessions.rev+1,updated=excluded.updated''',
                       (drive,json.dumps(values,ensure_ascii=False),time.time()))
            return db.execute('SELECT rev FROM sessions WHERE drive=?',(drive,)).fetchone()['rev']

    def adopt(self,drive,values):
        """Take over a sign-in an app saved on its own before sharing, unless one is shared already; True when taken."""
        if not values.get('cookies'):return False
        with self.db() as db:
            return db.execute('INSERT OR IGNORE INTO sessions VALUES (?,?,1,?)',
                              (drive,json.dumps(values,ensure_ascii=False),time.time())).rowcount==1
