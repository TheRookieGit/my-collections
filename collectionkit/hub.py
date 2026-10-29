"""The wish hub (心愿中枢, the my-collections site) as seen from an app: read the wishes it is in charge of, add new ones,
and report which it already has.

The hub keeps its data in Supabase behind RPCs. An app pairs once with a device token made in the hub's settings;
the token is kept encrypted with DPAPI in %LOCALAPPDATA%\\CollectionKit\\hub.json, one per app, beside the shared drive
sign-ins. Nothing here may stop the app working: while the hub cannot be reached, what the app sends waits in
hub.sqlite3 and goes out on the next flush(). The wishes' original screenshots are kept in the shots folder beside it once seen,
shared by the apps on this computer."""
from __future__ import annotations

from contextlib import contextmanager
import json
import os
import re
import secrets
from pathlib import Path
import sqlite3
import time
import urllib.error
import urllib.request

from .credentials import default_dir
from .secret import protect_secret

# The same public project and publishable key as the hub page (app.js); the tables are closed, only the RPCs answer.
URL = 'https://lxicymhrzkuiqisuiotg.supabase.co'
KEY = 'sb_publishable_KsJzV--VCz5k8WYQ-aqMLQ_rMgf-w9y'
API_VERSION = 2  # What this code needs of the hub's migrations.
SHOT_ID = re.compile(r'^[A-Za-z0-9_-]{6,64}$')
SHOT_LIMIT = 4_000_000  # The longest image data URL the hub takes.
APPS = {'shuyu','plexus','steamless'}


class HubError(Exception):
    def __init__(self,message,revoked=False,waits=False):
        super().__init__(message)
        self.revoked = revoked  # The pairing was revoked or never valid: pair again.
        self.waits = waits      # The hub lacks a newer migration: what was sent waits until it has run.


class Offline(HubError):
    """The hub could not be reached this time; what was sent waits in the queue."""


def fetch(request,timeout):
    """(status, body) for one request. Tests replace this."""
    try:
        with urllib.request.urlopen(request,timeout=timeout) as response:return response.status,response.read()
    except urllib.error.HTTPError as exc:
        return exc.code,exc.read()
    except (urllib.error.URLError,TimeoutError,OSError) as exc:
        raise Offline('连不上心愿中枢，请检查网络。') from exc


def rpc(name,args,timeout=20):
    request = urllib.request.Request(f'{URL}/rest/v1/rpc/{name}',data=json.dumps(args,ensure_ascii=False).encode(),method='POST',
                                     headers={'apikey':KEY,'Authorization':'Bearer '+KEY,'Content-Type':'application/json'})
    status,body = fetch(request,timeout)
    try:result = json.loads(body) if body else None
    except ValueError:result = None
    if status<400:return result
    # Supabase answers 5xx and timeouts when it is down; that is being offline too.
    if status>=500:raise Offline(f'心愿中枢暂时不可用（HTTP {status}）。')
    code = (result or {}).get('code') if isinstance(result,dict) else None
    if code=='28000':raise HubError('配对码无效或已经被吊销，请在心愿中枢里重新生成配对码。',revoked=True)
    if code=='PGRST202':raise HubError('心愿中枢还没执行最新的数据库迁移，请先按 supabase/README.md 执行。',waits=True)
    raise HubError('心愿中枢：'+str((result or {}).get('message') if isinstance(result,dict) else status))


class Hub:
    """One app's link to the hub. `app` is shuyu, plexus or steamless, as the token was made for."""
    def __init__(self,app,folder=None):
        if app not in APPS:raise ValueError(app)
        self.app = app
        self.folder = Path(folder) if folder else default_dir()
        self.folder.mkdir(parents=True,exist_ok=True)
        self.path = self.folder/'hub.json'
        self.queue_path = self.folder/'hub.sqlite3'
        with self.db() as db:
            db.execute('CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY,app TEXT NOT NULL,method TEXT NOT NULL,payload TEXT NOT NULL,created REAL NOT NULL)')

    @contextmanager
    def db(self):
        conn = sqlite3.connect(self.queue_path,timeout=30)
        try:
            with conn:yield conn
        finally:
            conn.close()

    # Pairing ------------------------------------------------------------------------------------------------------

    def saved(self):
        try:data = json.loads(self.path.read_text(encoding='utf-8'))
        except (OSError,ValueError):data = {}
        return data if isinstance(data,dict) else {}

    def write(self,mine):
        """Change only this app's entry; the other app may have written its own meanwhile."""
        data = self.saved()
        if mine:data[self.app] = mine
        else:data.pop(self.app,None)
        part = self.path.with_name(f'hub.json.{os.getpid()}.part')
        part.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
        os.replace(part,self.path)

    def token(self):
        value = self.saved().get(self.app,{}).get('token','')
        try:return protect_secret(value,True) if value else ''
        except ValueError:return ''  # Saved by another Windows user or computer.

    @property
    def paired(self):
        return bool(self.token())

    def status(self):
        mine = self.saved().get(self.app,{})
        with self.db() as db:
            queued = db.execute('SELECT COUNT(*) FROM outbox WHERE app=?',(self.app,)).fetchone()[0]
        return {'paired':self.paired,'since':mine.get('since'),'error':mine.get('error',''),'queued':queued}

    def pair(self,token):
        """Check the pairing code with the hub, then keep it. The hub must be reachable for this."""
        token = str(token or '').strip()
        if not token.startswith('mch_'):raise HubError('这不是心愿中枢的配对码：配对码以 mch_ 开头，在中枢的「设置 → 已配对的设备」里生成。')
        self.check_version()
        rpc('mc_wishes',{'p_token':token,'p_categories':[],'p_since':None})
        self.write({'token':protect_secret(token),'since':time.time()})
        return self.status()

    def unpair(self):
        self.write({})
        with self.db() as db:db.execute('DELETE FROM outbox WHERE app=?',(self.app,))
        return self.status()

    def note(self,error):
        """Remember the last problem to show beside the pairing, or clear it."""
        mine = self.saved().get(self.app)
        if mine and mine.get('error','')!=error:self.write({**mine,'error':error})

    # Talking to the hub -------------------------------------------------------------------------------------------

    def api_version(self):
        return rpc('mc_api_version',{})

    def check_version(self):
        if (self.api_version() or 0)<API_VERSION:
            raise HubError('心愿中枢的数据库版本太旧，请先按 supabase/README.md 执行新的迁移。')

    def call(self,name,**args):
        token = self.token()
        if not token:raise HubError('还没有连接心愿中枢。')
        try:result = rpc(name,{'p_token':token,**args})
        except HubError as exc:
            if not isinstance(exc,Offline):self.note(str(exc))
            raise
        self.note('')
        return result

    def wishes(self,categories=None,since=None):
        """{'cursor', 'items', 'fulfill'}: the wishes changed since `since` (the last cursor), deleted ones included,
        and every match this app reported, with the ones the hub said were wrong marked rejected."""
        return self.call('mc_wishes',p_categories=list(categories) if categories else None,p_since=since)

    def put_wish(self,item):
        """Add or change wishes (one or a list); the newer updatedAt wins. Queued while offline: None then."""
        return self.send('mc_wish_put',{'p_item':item})

    def fulfill(self,rows):
        """Report what this app has: [{itemId, ref, url, title, ownedAt}]. Queued while offline."""
        if rows:return self.send('mc_fulfill_put',{'p_rows':list(rows)})

    # Screenshots --------------------------------------------------------------------------------------------------

    def shot_path(self,shot_id):
        if not SHOT_ID.match(str(shot_id or '')):raise HubError('截图编号不对。')
        return self.folder/'shots'/shot_id

    def keep_shot(self,shot_id,data):
        path = self.shot_path(shot_id)
        path.parent.mkdir(exist_ok=True)
        part = path.with_name(f'{shot_id}.{os.getpid()}.part')
        part.write_text(data,encoding='ascii')
        os.replace(part,path)

    def add_shot(self,data):
        """Keep a screenshot (a compressed image data URL) and send it to the hub, queued while offline. The id to put in
        the wish's shots; the wish may reach the hub before the image does."""
        data = str(data or '')
        if not re.match(r'^data:image/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$',data):raise HubError('这不是图片。')
        if len(data)>SHOT_LIMIT:raise HubError('图片太大了，请换一张小一点的。')
        shot_id = 'shot-'+secrets.token_hex(10)
        self.keep_shot(shot_id,data)
        self.send('mc_agent_put_image',{'p_id':shot_id,'p_data':data})
        return shot_id

    def shot(self,shot_id):
        """A screenshot as a data URL: kept here, or fetched from the hub once. None when the hub has none for this app.
        Raises Offline when it is not kept here and the hub cannot be reached."""
        path = self.shot_path(shot_id)
        try:return path.read_text(encoding='ascii')
        except OSError:pass
        data = self.call('mc_agent_get_image',p_id=shot_id)
        if data:self.keep_shot(shot_id,data)
        return data

    def send(self,method,args):
        with self.db() as db:
            db.execute('INSERT INTO outbox (app,method,payload,created) VALUES (?,?,?,?)',(self.app,method,json.dumps(args,ensure_ascii=False),time.time()))
        # Offline or revoked, it waits in the queue; the app goes on, and status() shows why.
        try:return self.flush()
        except HubError:return None

    def flush(self):
        """Send what waits, oldest first; stops at the first time the hub cannot be reached. The last reply."""
        if not self.paired:return None
        result,after = None,0
        while True:
            with self.db() as db:
                row = db.execute('SELECT id,method,payload FROM outbox WHERE app=? AND id>? ORDER BY id LIMIT 1',(self.app,after)).fetchone()
            if not row:return result
            after = row[0]
            try:result = self.call(row[1],**json.loads(row[2]))
            except Offline:raise
            except HubError as exc:
                # A revoked pairing keeps its queue for after pairing again; what needs a newer migration waits for it
                # while the rest goes on; anything else would fail forever, so it goes.
                if exc.revoked:raise
                if exc.waits:continue
            with self.db() as db:db.execute('DELETE FROM outbox WHERE id=?',(row[0],))
