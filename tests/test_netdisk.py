from email.message import Message
import io
import json
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import urllib.parse

from collectionkit import netdisk
from collectionkit.credentials import Credentials
from collectionkit.netdisk import Drives, NetDiskError, Unreachable, links

EPISODE = b'quark episode one ' * 50
MOVIE = b'baidu movie ' * 40
FOLDER = '测试转存'


class FakeDrives:
    """Quark's and Baidu's web APIs as netdisk.py sees them; the shapes come from their web pages."""
    def __init__(self):
        self.calls,self.lock = [],threading.Lock()
        self.quark_polls = self.baidu_polls = self.quark_checks = 0
        self.quark_logged_in = True
        self.quark_folder = self.baidu_folder = False
        self.baidu_cancel = False
        self.saved = {}
        self.drop_once = True

    def reply(self,data=None,status=200,raw=None,cookies=(),location=None,sink=None,content=None,start=0):
        headers = Message()
        for cookie in cookies:headers['Set-Cookie'] = cookie
        if location:headers['Location'] = location
        if content is not None:
            sink.write(content[start:]);return (206 if start else 200),headers,b''
        return status,headers,raw if raw is not None else json.dumps(data,ensure_ascii=False).encode()

    def __call__(self,request,timeout,sink=None):
        url = urllib.parse.urlsplit(request.full_url)
        query = {k:v[-1] for k,v in urllib.parse.parse_qs(url.query,keep_blank_values=True).items()}
        cookies = dict(part.split('=',1) for part in (request.get_header('Cookie') or '').split('; ') if part)
        body = request.data or b''
        form = {k:v[-1] for k,v in urllib.parse.parse_qs(body.decode()).items()} if 'form-urlencoded' in (request.get_header('Content-type') or '') else {}
        data = json.loads(body) if body and not form else {}
        start = int((request.get_header('Range') or 'bytes=0-')[6:].split('-')[0])
        with self.lock:self.calls.append({'host':url.netloc,'path':url.path,'query':query,'cookies':cookies,'start':start})
        if url.netloc.endswith('quark.cn') or url.netloc.endswith('quark.test'):return self.quark(url,query,cookies,data,sink,start)
        return self.baidu(url,query,cookies,form,sink,request.get_header('User-agent'),start)

    def quark(self,url,query,cookies,data,sink,start):
        if url.path=='/cas/ajax/getTokenForQrcodeLogin':
            self.quark_polls += 1
            return self.reply({'status':2000000,'data':{'members':{'token':f'token-{self.quark_polls}'}}})
        if url.path=='/cas/ajax/getServiceTicketByQrcodeToken':
            self.quark_checks += 1
            if self.quark_checks==1:raise Unreachable('dropped connection')
            # The first QR code expires before anyone scans it; later ones are scanned.
            if query['token']=='token-1':return self.reply({'status':50004002,'message':'Token Not Found'})
            return self.reply({'status':2000000,'data':{'members':{'service_ticket':'ticket'}}})
        if url.path=='/account/info':
            return self.reply({'success':True,'code':'OK','data':{'nickname':'夸克用户'}},cookies=['__pus=pus-cookie; Domain=.quark.cn; Path=/; HttpOnly'])
        if url.netloc=='dl.quark.test':return self.reply(status=302,location='https://cdn.quark.test'+url.path,raw=b'')
        if url.netloc=='cdn.quark.test':
            if self.drop_once:
                # The connection drops partway through once; the next request asks for the rest.
                self.drop_once = False
                sink.write(EPISODE[:300])
                raise Unreachable('dropped')
            return self.reply(sink=sink,content=EPISODE,start=start)
        if not self.quark_logged_in or cookies.get('__pus')!='pus-cookie':return self.reply({'status':401,'code':31001,'message':'require login [guest]'},401)
        path = url.path.removeprefix('/1/clouddrive/')
        if path=='share/sharepage/token':
            if data['pwd_id']!='qshare':return self.reply({'status':404,'code':41006,'message':'分享不存在'},404)
            return self.reply({'status':200,'code':0,'data':{'stoken':'stoken','title':'某剧'}})
        if path=='share/sharepage/detail':
            items = {'0':[{'fid':'d1','file_name':'某剧.2024','dir':True}],
                     'd1':[{'fid':'f1','file_name':'某剧.S01E01.mkv','dir':False,'size':len(EPISODE),'share_fid_token':'t1'}]}[query['pdir_fid']]
            return self.reply({'status':200,'code':0,'data':{'list':items},'metadata':{'_total':len(items)}})
        if path=='file/info/path_list':
            assert data['file_path']==['/'+FOLDER]
            return self.reply({'status':200,'code':0,'data':[{'fid':'mine'}] if self.quark_folder else []})
        if path=='file':
            assert data['file_name']==FOLDER
            self.quark_folder = True;return self.reply({'status':200,'code':0,'data':{'fid':'mine'}})
        if path=='share/sharepage/save':
            assert data['to_pdir_fid']=='mine'
            self.saved['quark'] = data
            return self.reply({'status':200,'code':0,'data':{'task_id':'task'}})
        if path=='task':
            return self.reply({'status':200,'code':0,'data':{'status':2,'save_as':{'save_as_top_fids':['s-'+f for f in self.saved['quark']['fid_list']]}}})
        if path=='file/download':
            return self.reply({'status':200,'code':0,'data':[{'fid':f,'download_url':'https://dl.quark.test/'+f} for f in data['fids']]})
        return self.reply({'status':404,'code':1,'message':'unknown'},404)

    def baidu(self,url,query,cookies,form,sink,agent,start):
        signed = cookies.get('BDUSS')=='bduss' and cookies.get('STOKEN')=='pan-stoken'
        if url.netloc=='pan.baidu.com' and url.path=='/':return self.reply(raw=b'<html>',cookies=['BAIDUID=b; Domain=.baidu.com; Path=/'])
        if url.path=='/v2/api/getqrcode':return self.reply({'imgurl':'passport.baidu.com/v2/api/qrcode?sign=sign','errno':0,'sign':'sign'})
        if url.path=='/v2/api/qrcode':return self.reply(raw=b'\x89PNG fake')
        if url.path=='/channel/unicast':
            if self.baidu_cancel:return self.reply({'errno':0,'channel_v':json.dumps({'status':2})})
            self.baidu_polls += 1
            value = [{'status':1},{'status':0,'v':'temporary'}][min(self.baidu_polls,2)-1]
            return self.reply({'errno':0,'channel_id':'sign','channel_v':json.dumps(value)})
        if url.path=='/v3/login/main/qrbdusslogin':
            # Like Baidu's own reply: one key is single-quoted, so it is not valid JSON.
            return self.reply(raw=b'{"errInfo":{"no": "0"}, "code": "110000", \'data\': {"u": ""}}',cookies=['BDUSS=bduss; Domain=.baidu.com; Path=/; HttpOnly'])
        if url.path=='/v3/login/api/auth/':return self.reply(status=302,location='https://pan.baidu.com/disk/main',raw=b'')
        if url.path=='/disk/main':return self.reply(raw=b'<html>',cookies=['STOKEN=pan-stoken; Domain=.pan.baidu.com; Path=/'])
        if url.netloc=='d.pcs.baidu.com':
            assert agent=='pan.baidu.com',agent
            return self.reply(status=302,location='https://nd.baidupcs.test'+url.path,raw=b'')
        if url.netloc=='nd.baidupcs.test':return self.reply(sink=sink,content=MOVIE,start=start)
        if url.path=='/share/verify':
            if form['pwd']!='abcd':return self.reply(raw=b'\n\n{"errno":-9,"err_msg":""}')
            return self.reply({'errno':0,'randsk':'rk%3D'})
        if url.path=='/share/list':
            if cookies.get('BDCLND')!='rk%3D':return self.reply({'errno':9019,'errmsg':'need verify'})
            items = [{'fs_id':11,'server_filename':'Inception.2010.mkv','isdir':'0','size':str(len(MOVIE)),'path':'/资源/Inception.2010.mkv'}]
            return self.reply({'errno':0,'share_id':77,'uk':88,'list':items})
        if not signed:return self.reply({'errno':-6})
        if url.path=='/api/gettemplatevariable':return self.reply({'errno':0,'result':{'bdstoken':'bdstoken','username':'百度用户'}})
        if url.path=='/api/list':return self.reply({'errno':0 if self.baidu_folder else -9,'list':[]})
        if url.path=='/api/create':
            assert form['path']=='/'+FOLDER
            self.baidu_folder = True;return self.reply({'errno':0})
        if url.path=='/share/transfer':
            assert (query['shareid'],query['from'],query['sekey'],form['path'])==('77','88','rk=','/'+FOLDER)
            ids = json.loads(form['fsidlist']);self.saved['baidu'] = ids
            return self.reply({'errno':0,'extra':{'list':[{'from_fs_id':i,'to':f'/{FOLDER}/Inception.2010.mkv'} for i in ids]}})
        if url.path=='/api/filemetas':
            return self.reply({'errno':0,'info':[{'path':p,'dlink':'https://d.pcs.baidu.com/file/'+str(n)} for n,p in enumerate(json.loads(query['target']))]})
        return self.reply({'errno':404})


def wait(condition,label,seconds=5):
    deadline = time.time()+seconds
    while time.time()<deadline:
        if condition():return
        time.sleep(.01)
    raise AssertionError('Timed out: '+label)


class NetDiskTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.fake = FakeDrives()
        self.patches = [patch('collectionkit.netdisk.fetch',side_effect=lambda request,timeout,sink=None:self.fake(request,timeout,sink)),
                        patch('collectionkit.netdisk.POLL',.01)]
        for item in self.patches:item.start()
        # Two apps on the same computer, such as 书屿 and Plexus, each with their own folder in the drive.
        self.app = self.open_app()
        self.other = self.open_app('另一个转存')

    def tearDown(self):
        for item in reversed(self.patches):item.stop()
        self.folder.cleanup()

    def open_app(self,saves_to=FOLDER):
        return Drives(saves_to,Credentials(self.folder.name))

    def sign_in(self,drives,key):
        status = drives.drive(key).login()
        wait(lambda:drives.drive(key).login_state['state']=='idle' and drives.status()[key]['signed_in'],key+' signed in')
        return status

    def test_share_links_and_extraction_codes_found_in_pasted_text(self):
        text = ('我用夸克网盘分享了「电影」，点击链接即可保存。\n链接：https://pan.quark.cn/s/34d748b55cc7 提取码：AB12\n'
                '链接: https://pan.baidu.com/s/1UgC33lOxfa_dhSr6beLnoA?pwd=4g8j 提取码: 4g8j 复制这段内容后打开百度网盘手机App\n'
                'https://pan.baidu.com/share/init?surl=abcDEF https://pan.quark.cn/s/abc')
        self.assertEqual(links(text),[{'drive':'quark','id':'34d748b55cc7','code':'AB12'},{'drive':'baidu','id':'UgC33lOxfa_dhSr6beLnoA','code':'4g8j'},
                                      {'drive':'baidu','id':'abcDEF','code':''},{'drive':'quark','id':'abc','code':''}])
        self.assertEqual(links('没有链接'),[])

    def test_quark_sign_in_then_a_share_is_saved_and_streamed_with_resume(self):
        status = self.sign_in(self.app,'quark')
        self.assertEqual(status['login']['state'],'waiting');self.assertTrue(status['login']['qr']);self.assertIn('token=token-1',status['login']['link'])
        self.assertFalse(any(k.startswith('_') for k in status['login']),'tokens stay on the backend')
        self.assertEqual(self.fake.quark_polls,2,'an expired QR code is replaced')
        self.assertEqual(self.app.status()['quark']['name'],'夸克用户')
        self.assertNotIn('pus-cookie',json.dumps(self.app.drive('quark').session.values()),'cookies are stored protected')
        self.assertTrue(self.open_app().drive('quark').signed_in,'the sign-in survives a restart')

        drive = self.app.drive('quark')
        share,files = drive.files(links('https://pan.quark.cn/s/qshare')[0])
        self.assertEqual((share['title'],[f['path'] for f in files]),('某剧',['某剧.2024/某剧.S01E01.mkv']))
        (item,ref), = list(drive.save(share,files))
        self.assertEqual((ref,self.fake.saved['quark']['pdir_fid']),({'fid':'s-f1'},'d1'),'saved from its own folder into the app folder')
        sink = io.BytesIO()
        with self.assertRaises(Unreachable):drive.stream(ref,0,sink)
        self.assertEqual(drive.stream(ref,len(sink.getvalue()),sink),206)
        self.assertEqual(sink.getvalue(),EPISODE)
        with self.assertRaises(NetDiskError) as caught:drive.files(links('https://pan.quark.cn/s/gone')[0])
        self.assertEqual(str(caught.exception),'夸克网盘：分享不存在')

    def test_baidu_scan_then_extraction_code_checked_and_file_streamed(self):
        status = self.sign_in(self.app,'baidu')
        self.assertTrue(status['login']['image'].startswith('data:image/png;base64,'),'the QR image is passed on as data')
        self.assertEqual(self.app.status()['baidu']['name'],'百度用户')
        drive = self.app.drive('baidu')
        with self.assertRaises(NetDiskError) as caught:drive.files(links('https://pan.baidu.com/s/1bshare?pwd=zzzz')[0])
        self.assertEqual(str(caught.exception),'百度网盘：提取码不对，或者分享已失效。')
        share,files = drive.files(links('链接: https://pan.baidu.com/s/1bshare 提取码: abcd')[0])
        (item,ref), = list(drive.save(share,files))
        self.assertEqual((self.fake.saved['baidu'],ref),([11],{'path':f'/{FOLDER}/Inception.2010.mkv'}))
        sink = io.BytesIO()
        self.assertEqual(drive.stream(ref,0,sink),200)
        self.assertEqual(sink.getvalue(),MOVIE)

    def test_signing_in_or_out_in_one_app_applies_to_every_app(self):
        self.assertFalse(self.other.drive('quark').signed_in)
        self.sign_in(self.app,'quark')
        self.assertEqual((self.other.status()['quark']['signed_in'],self.other.status()['quark']['name']),(True,'夸克用户'),
                         'the other app picks up the sign-in without scanning again')
        self.other.drive('quark').files(links('https://pan.quark.cn/s/qshare')[0])

        self.other.drive('quark').logout()
        self.assertFalse(self.app.drive('quark').signed_in,'signing out in one app signs out in all')
        with self.assertRaises(NetDiskError) as caught:self.app.drive('quark').files(links('https://pan.quark.cn/s/qshare')[0])
        self.assertEqual(caught.exception.login,'quark')

        self.sign_in(self.other,'quark')
        self.assertTrue(self.app.drive('quark').signed_in)
        self.fake.quark_logged_in = False
        with self.assertRaises(NetDiskError) as caught:self.app.drive('quark').files(links('https://pan.quark.cn/s/qshare')[0])
        self.assertIn('重新扫码',str(caught.exception))
        self.assertFalse(self.other.drive('quark').signed_in,'a lapsed sign-in asks every app to scan again')

    def test_a_failed_or_stale_attempt_leaves_the_shared_sign_in_alone(self):
        self.sign_in(self.app,'baidu')
        self.fake.baidu_cancel = True
        self.other.drive('baidu').login()
        wait(lambda:self.other.drive('baidu').login_state['state']=='failed','cancelled on the phone')
        self.assertEqual(self.other.drive('baidu').login_state['error'],'你在手机上取消了登录。')
        self.assertTrue(self.other.drive('baidu').signed_in,'the sign-in from the first app still applies')
        self.assertTrue(self.app.drive('baidu').signed_in)

        session = self.app.drive('baidu').session
        stale = session.rev
        self.fake.baidu_cancel = False
        self.sign_in(self.other,'baidu')
        session.forget(stale)
        self.assertTrue(self.app.drive('baidu').signed_in,'a lapse seen on an older sign-in does not end the newer one')

    def test_an_app_hands_over_its_own_earlier_sign_in_once(self):
        saved = {'quark':{'name':'旧夸克','cookies':'local:e30='},'baidu':{'name':''}}
        self.assertEqual(self.app.adopt(saved),['quark'])
        self.assertEqual(self.other.status()['quark']['name'],'旧夸克')
        self.assertEqual(self.other.adopt({'quark':{'name':'另一个','cookies':'local:e30='}}),[],'the shared sign-in is kept')
        self.assertEqual(self.app.status()['quark']['name'],'旧夸克')


if __name__=='__main__':
    unittest.main()
