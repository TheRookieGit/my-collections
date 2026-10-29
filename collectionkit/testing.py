"""A wish hub in memory for tests: patch collectionkit.hub.fetch with a FakeHub. It answers the RPCs the way
supabase/migrations/002_wish_hub.sql and 003_shots.sql do, closely enough for the apps' tests; tests/migrations.mjs checks the real SQL."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json

from .hub import Offline

CATEGORIES = {'shuyu':['novel'],'plexus':['movie','tv'],'steamless':['game']}


def iso(when=None):
    return (when or datetime.now(timezone.utc)).isoformat().replace('+00:00','Z')


class FakeHub:
    def __init__(self):
        self.items = {}       # id -> (item, synced)
        self.fulfilled = {}   # (item id, app) -> row
        self.tokens = {}      # token -> app
        self.revoked = set()
        self.offline = False
        self.calls = []
        self.images = {}      # id -> data URL
        self.version = 2      # mc_api_version; below 2 the screenshot RPCs are missing

    def token(self,app):
        token = 'mch_'+app.ljust(48,'0')
        self.tokens[token] = app
        return token

    def add(self,item,synced=None):
        """A wish as the hub page saves it."""
        self.items[item['id']] = (item,synced or datetime.now(timezone.utc))

    def reject(self,item_id,app):
        self.fulfilled[(item_id,app)]['rejected'] = True

    def __call__(self,request,timeout):
        name = request.full_url.rsplit('/',1)[-1]
        args = json.loads(request.data)
        self.calls.append((name,args))
        if self.offline:raise Offline('连不上心愿中枢，请检查网络。')
        if name=='mc_api_version':return 200,str(self.version).encode()
        if self.version<2 and 'image' in name:return 404,json.dumps({'code':'PGRST202','message':'not found'}).encode()
        app = self.tokens.get(args.get('p_token'))
        if not app or args['p_token'] in self.revoked:return 401,json.dumps({'code':'28000','message':'invalid device token'}).encode()
        return 200,json.dumps(getattr(self,name)(app,args),ensure_ascii=False).encode()

    def mc_wishes(self,app,args):
        cats = [c for c in CATEGORIES[app] if args['p_categories'] is None or c in args['p_categories']]
        since = datetime.fromisoformat(args['p_since'].replace('Z','+00:00')) if args.get('p_since') else None
        now = datetime.now(timezone.utc)
        return {'cursor':iso(now-timedelta(minutes=1)),
                'items':[i for i,synced in sorted(self.items.values(),key=lambda v:v[1]) if i.get('category') in cats and (since is None or synced>since)],
                'fulfill':[{'itemId':r['itemId'],'ref':r['ref'],'rejected':r['rejected'],'ownedAt':r['ownedAt']} for (_,a),r in self.fulfilled.items() if a==app]}

    def mc_wish_put(self,app,args):
        given = args['p_item'] if isinstance(args['p_item'],list) else [args['p_item']]
        for item in given:
            if item.get('category') not in CATEGORIES[app]:raise AssertionError('the hub refuses another category: '+str(item))
            old = self.items.get(item['id'])
            if not old or (item.get('updatedAt') or '')>(old[0].get('updatedAt') or ''):self.add(item)
        return [self.items[i['id']][0] for i in given]

    def mc_fulfill_put(self,app,args):
        for row in args['p_rows']:
            old = self.fulfilled.get((row['itemId'],app))
            ref = row.get('ref','')
            self.fulfilled[(row['itemId'],app)] = {'itemId':row['itemId'],'app':app,'ref':ref,'url':row.get('url',''),'title':row.get('title',''),
                                                  'ownedAt':row.get('ownedAt'),'rejected':bool(old and old['rejected'] and old['ref']==ref)}
        return None

    def mc_agent_put_image(self,app,args):
        self.images.setdefault(args['p_id'],args['p_data'])
        return None

    def mc_agent_get_image(self,app,args):
        if not any(args['p_id'] in (i.get('shots') or []) for i,_ in self.items.values() if i.get('category') in CATEGORIES[app]):return None
        return self.images.get(args['p_id'])
