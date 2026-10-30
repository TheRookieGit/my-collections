// Loads the page in jsdom with the two CDN imports and Supabase stubbed, seeded with old and new data. No network.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const assert = require('assert/strict');
const root = require('path').join(__dirname, '..') + '/';
const html = fs.readFileSync(root + 'index.html', 'utf8').replace(/<script type="module"[^>]*><\/script>/, '');
let code = 'const Anthropic = window.Anthropic, createClient = (...a) => window.createClient(...a);\n' + fs.readFileSync(root + 'app.js', 'utf8').replace(/^import .*$/gm, '');
code += '\nwindow.__shotDb = shotDb;'; // lets a test keep screenshots without IndexedDB
const rpcs = [];
const dom = new JSDOM(html, { url: 'http://127.0.0.1:8799/', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window;
w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event('close')); };
w.confirm = () => true;
// Browsers let a form's named controls shadow its own properties (form.title is the input); jsdom does not.
const named = (f) => { for (const el of f.querySelectorAll('[name]')) Object.defineProperty(f, el.name, { configurable: true, get: () => f.elements.namedItem(el.name) }); };
for (const f of w.document.forms) named(f);
// The settings form gains named checkboxes when it opens.
new w.MutationObserver(() => named(w.document.getElementById('settingsForm'))).observe(w.document.getElementById('hideDone'), { childList: true });
const ts = '2026-01-01T00:00:00.000Z';
w.localStorage.setItem('mc.items.v1', JSON.stringify([
  { id: 'n1', category: 'novel', title: '旧小说', extra: { author: '某人', download: 'https://pan.quark.cn/s/abc 提取码 1234' }, createdAt: ts, updatedAt: ts, done: false },
  { id: 'n2', category: 'novel', title: '已下好的书', extra: {}, createdAt: ts, updatedAt: ts, done: false },
  { id: 'g1', category: 'game', title: 'Hades', source: 'steamless', externalIds: { steamAppId: 1145360 }, createdAt: ts, updatedAt: ts, done: false },
  { id: 'c1', category: 'coupon', title: '券', extra: {}, createdAt: ts, updatedAt: ts, done: false },
]));
w.localStorage.setItem('mc.config.v1', JSON.stringify({ apiKey: '', syncPass: 'pw', shuyuServer: 'http://127.0.0.1:9' }));
const fulfillRows = [{ itemId: 'n2', app: 'shuyu', ref: 'a.txt', url: 'https://therookiegit.github.io/shuyu/#book=x', title: '已下好的书', ownedAt: '2026-03-01T00:00:00Z', rejected: false }];
// Screenshot recognition answers whatever the test sets in `reply`; the images never reach a canvas.
let reply = [];
const config = {};
const agents = [{ id: 'a1', name: '书屿 Windows', app: 'shuyu', createdAt: ts, lastSeen: null, revoked: false },
  { id: 'a0', name: 'foodcollection', app: 'foodcollection', createdAt: ts, lastSeen: null, revoked: true }];
w.Anthropic = class { constructor() { this.messages = { create: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ items: reply }) }] }) }; } };
w.createImageBitmap = async () => ({ width: 10, height: 10 });
w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,AAAA';
w.createClient = () => ({
  rpc: async (name, args) => {
    rpcs.push([name, args]);
    if (name === 'mc_pull') return { data: [], error: null };
    if (name === 'mc_fulfill_pull') return { data: fulfillRows, error: null };
    if (name === 'mc_agent_list') return { data: agents.filter((a) => !a.deleted), error: null };
    if (name === 'mc_agent_delete') { agents.find((a) => a.id === args.p_id).deleted = true; return { data: null, error: null }; }
    if (name === 'mc_agent_create' && args.p_app === 'foodcollection') return { data: null, error: { code: '22023', message: 'unknown app' } };
    if (name === 'mc_agent_create') return { data: { id: 'a2', token: 'mch_' + '0'.repeat(48), app: args.p_app, name: 'x' }, error: null };
    if (name === 'mc_get_config') return { data: structuredClone(config), error: null };
    if (name === 'mc_set_config') { Object.assign(config, args.p_data); return { data: null, error: null }; }
    return { data: null, error: null };
  },
  functions: { invoke: async () => ({}) },
});
w.navigator.clipboard = { readText: async () => '', writeText: async () => {} };
// No IndexedDB here: opening it fails, as in a private window, so a sync does not wait on it forever.
w.indexedDB = { open: () => { const req = { error: new Error('no IndexedDB') }; setTimeout(() => req.onerror?.()); return req; } };
w.fetch = async () => { throw new TypeError('Failed to fetch'); };
w.eval(code);
const $ = (s) => w.document.querySelector(s);
const $$ = (s) => [...w.document.querySelectorAll(s)];
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await tick(300);
  const stored = JSON.parse(w.localStorage.getItem('mc.items.v1'));
  assert.deepEqual(stored.find((i) => i.id === 'n1').links, ['https://pan.quark.cn/s/abc 提取码 1234'], 'extra.download moved into links');
  assert.equal(stored.find((i) => i.id === 'n1').updatedAt, ts, 'migration leaves updatedAt alone');
  assert.equal($('#cnt-todo').textContent, '3'); assert.equal($('#cnt-owned').textContent, '1');
  const n1 = $('[data-id="n1"]');
  assert.match(n1.textContent, /送到书屿下载/);
  assert.equal(n1.querySelector('.send').href.split('#')[1], 'links=' + encodeURIComponent('https://pan.quark.cn/s/abc 提取码 1234'));
  assert.ok(!n1.querySelector('[data-act="done"]'), 'novels hide the done button by default');
  assert.ok($('[data-id="c1"] [data-act="done"]'), 'other categories keep it');
  const g1 = $('[data-id="g1"]');
  assert.ok(g1.querySelector('[data-act="edit"]') && g1.querySelector('[data-n]'), 'steamless games can be edited here too');
  console.log('PASS legacy download link migrated, send-to-download link, done hidden for novels, Steamless games editable');

  const c1 = $('[data-id="c1"]');
  assert.ok(c1.classList.contains('st-todo') && !c1.classList.contains('owned'), 'card state classes do not clash with the owned row');
  c1.querySelector('.cover').click();
  assert.ok($('#dlgDetail').open, 'clicking a card opens its details');
  assert.equal($('#detailBody .card-title').textContent, '券');
  assert.match($('#detailBody .detail-times').textContent, /收藏于/);
  $('#detailBody [data-act="edit"]').click();
  assert.ok(!$('#dlgDetail').open && $('#dlgEdit').open, 'edit from the details');
  $('#dlgEdit').close();
  $('[data-id="g1"] .cover').click();
  assert.ok($('#dlgDetail').open && $('#detailBody [data-act="edit"]'), 'Steamless games can be edited from their details');
  $('#detailBody .detail-close').click();
  assert.ok(!$('#dlgDetail').open);
  console.log('PASS a click on a card opens its details, with edit');

  // A click outside a dialog closes it; one that started inside (selecting text) does not
  const at = (el, type, x) => el.dispatchEvent(new w.MouseEvent(type, { bubbles: true, clientX: x, clientY: 5 }));
  w.HTMLDialogElement.prototype.getBoundingClientRect = () => ({ left: 100, right: 400, top: 0, bottom: 600 });
  $('[data-id="c1"] .cover').click();
  at($('#detailBody .detail-body'), 'pointerdown', 200); at($('#dlgDetail'), 'click', 500);
  assert.ok($('#dlgDetail').open, 'pressed inside, released outside: stays open');
  at($('#dlgDetail'), 'pointerdown', 200); at($('#dlgDetail'), 'click', 200);
  assert.ok($('#dlgDetail').open, 'a click on the dialog itself stays open');
  at($('#dlgDetail'), 'pointerdown', 20); at($('#dlgDetail'), 'click', 20);
  assert.ok(!$('#dlgDetail').open, 'a click outside closes it');
  for (const id of ['#dlgEdit', '#dlgShot']) {
    $(id).showModal();
    at($(id), 'pointerdown', 20); at($(id), 'click', 20);
    assert.ok($(id).open, `${id} holds unsaved input: only its buttons close it`);
    $(id).close();
  }
  delete w.HTMLDialogElement.prototype.getBoundingClientRect;
  console.log('PASS a click outside a dialog closes it');

  // Screenshots added to an existing wish from its details, and removed again
  const kept = [];
  w.__shotDb.put = async (rec) => { kept.push(rec.id); };
  w.__shotDb.addPending = async () => {};
  $('[data-id="g1"] .cover').click();
  assert.ok($('#detailBody [data-act="addshot"]'), 'a screenshot can be added to any wish');
  $('#detailBody [data-act="addshot"]').click();
  const input = $('#shotAddInput');
  Object.defineProperty(input, 'files', { configurable: true, value: [new w.File(['x'], 'a.png', { type: 'image/png' }), new w.File(['y'], 'b.png', { type: 'image/png' })] });
  input.dispatchEvent(new w.Event('change'));
  await tick();
  let g = JSON.parse(w.localStorage.getItem('mc.items.v1')).find((i) => i.id === 'g1');
  assert.deepEqual(g.shots, kept, 'kept here, their ids on the wish');
  assert.ok(g.updatedAt > ts, 'a changed wish syncs');
  assert.equal($$('#detailBody .shot-thumb').length, 2);
  $$('#detailBody [data-act="unshot"]')[0].click();
  g = JSON.parse(w.localStorage.getItem('mc.items.v1')).find((i) => i.id === 'g1');
  assert.deepEqual(g.shots, kept.slice(1));
  $('#detailBody .detail-close').click();
  console.log('PASS screenshots are added to and removed from a wish in its details');
  $('[data-status="all"]').click();
  assert.equal($('#cnt-all').textContent, '4'); assert.equal($$('#list .card').length, 4, '全部 lists wanted, owned and done together');
  $('[data-status="todo"]').click();
  console.log('PASS 全部 shows every state');

  $('[data-status="owned"]').click();
  const n2 = $('[data-id="n2"]');
  assert.match(n2.textContent, /已拥有 · 书屿：已下好的书 · 2026-0\d-\d\d/);
  assert.equal(n2.querySelector('.owned a').href, fulfillRows[0].url);
  n2.querySelector('[data-act="reject"]').click(); await tick();
  assert.equal(JSON.stringify(rpcs.find((r) => r[0] === 'mc_fulfill_reject')[1]), JSON.stringify({ p_pass: 'pw', p_item_id: 'n2', p_app: 'shuyu' }));
  assert.equal($('#cnt-owned').textContent, '0'); assert.equal($('#cnt-todo').textContent, '4');
  console.log('PASS owned shows source, date and link; 不是这个 moves it back to 想要');

  $('[data-status="todo"]').click();
  $('[data-id="n1"] [data-act="edit"]').click();
  assert.ok(!$('#fKindRow').hidden && !$('#fLinksRow').hidden && !$('#fAliasesRow').hidden);
  assert.equal($('#editForm').links.value, 'https://pan.quark.cn/s/abc 提取码 1234');
  $('#editForm').kind.value = 'zip'; $('#editForm').aliases.value = '别名甲，别名乙';
  $('#editForm').dispatchEvent(Object.assign(new w.Event('submit', { cancelable: true }), { submitter: { value: 'ok' } }));
  let saved = JSON.parse(w.localStorage.getItem('mc.items.v1')).find((i) => i.id === 'n1');
  assert.equal(JSON.stringify([saved.kind, saved.aliases, saved.extra.download ?? null]), JSON.stringify(['zip', ['别名甲', '别名乙'], null]));
  $('#fCategory').value = 'coupon'; $('#fCategory').dispatchEvent(new w.Event('change'));
  assert.ok($('#fKindRow').hidden && $('#fLinksRow').hidden && $('#fAliasesRow').hidden);
  $('#btnAdd').click();
  $('#editForm').title.value = '新片'; $('#editForm').category.value = 'movie';
  $('#editForm').dispatchEvent(Object.assign(new w.Event('submit', { cancelable: true }), { submitter: { value: 'ok' } }));
  saved = JSON.parse(w.localStorage.getItem('mc.items.v1')).find((i) => i.title === '新片');
  assert.equal(saved.source, 'manual'); assert.equal(saved.kind, undefined);
  console.log('PASS edit form: type, links and aliases per category; new items say they were added by hand');

  config.apiKey = 'k'; // the page fetches the key with the sync password
  const shot = (category, title, aliases = '') => ({ category, title, aliases, note: '', link: '', download: '' });
  reply = [shot('novel', '旧小说'), shot('tv', 'ホタルの嫁入り', '萤火虫的出嫁 / ホタルの嫁入り'), shot('tv', '萤火虫的出嫁'), shot('coupon', '新券', '别名')];
  Object.defineProperty($('#shotInput'), 'files', { configurable: true, value: [new w.File(['x'], 'a.png', { type: 'image/png' })] });
  $('#shotInput').dispatchEvent(new w.Event('change')); await tick(100);
  const rows = $$('#shotResults .shot-item');
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((r) => r.querySelector('[data-k="_checked"]').checked), [false, true, false, true]);
  assert.match(rows[0].textContent, /已收藏过「旧小说」/); assert.match(rows[2].textContent, /和上面一条重复/);
  assert.equal(rows[1].querySelector('[data-k="aliases"]').value, '萤火虫的出嫁', 'other names kept as aliases, the title left out');
  assert.ok(!rows[3].querySelector('[data-k="aliases"]'), 'no aliases where no app matches by name');
  $('#dlgShot').close();
  console.log('PASS screenshot results: ones already saved and repeats unchecked, other names kept as aliases');

  $('#btnSettings').click(); await tick(100);
  assert.match($('#agentList').textContent, /书屿 Windows · 书屿/);
  assert.match($('#ndBox').textContent, /Windows 电脑没有连上，暂时不能登录网盘/);
  $('#pairApp').value = 'plexus'; $('#btnPair').click(); await tick();
  assert.equal(rpcs.find((r) => r[0] === 'mc_agent_create')[1].p_app, 'plexus');
  assert.match($('#pairCode').textContent, /mch_0{48}/);
  assert.ok($('[name="hide_novel"]').checked && !$('[name="hide_movie"]').checked);
  // A failed pairing says why beside the button, not only in a toast the dialog could cover.
  $('#pairApp').value = 'foodcollection'; $('#btnPair').click(); await tick();
  assert.match($('#pairCode').textContent, /没能生成配对码：云端还没执行最新的迁移（004_foodcollection\.sql）/);
  $('#pairApp').value = 'shuyu';
  // A revoked pairing can be deleted from the list; one in use only revoked.
  assert.match($('#agentList').textContent, /foodcollection · FoodCollection/);
  assert.ok(!$('[data-delete="a1"]') && $('[data-revoke="a1"]'));
  w.confirm = () => false; $('[data-delete="a0"]').click(); await tick();
  assert.ok(!rpcs.some((r) => r[0] === 'mc_agent_delete'), 'nothing deleted when cancelled');
  w.confirm = () => true; $('[data-delete="a0"]').click(); await tick();
  assert.equal(rpcs.filter((r) => r[0] === 'mc_agent_delete').at(-1)[1].p_id, 'a0');
  assert.doesNotMatch($('#agentList').textContent, /foodcollection/);
  console.log('PASS settings: devices listed and paired, offline Windows reported, done hidden per category');

  // Which categories hide 「已实现」 is shared by every device: this one's goes up first, a later change elsewhere wins.
  assert.equal(config.hideDone?.novel, true, 'the first sync uploads this device\'s choice');
  assert.ok(config.hideDoneAt);
  $('[name="hide_novel"]').checked = false; $('[name="hide_coupon"]').checked = true;
  $('#settingsForm').dispatchEvent(new w.Event('submit', { cancelable: true })); await tick(200);
  assert.equal(config.hideDone.novel, false); assert.equal(config.hideDone.coupon, true);
  const mine = config.hideDoneAt;
  $('#dlgSettings').close();
  assert.ok(!$('[data-id="c1"] [data-act="done"]') && $('[data-id="n1"] [data-act="done"]'), 'applied here at once');
  config.hideDone = Object.fromEntries(Object.keys(config.hideDone).map((k) => [k, k === 'restaurant']));
  config.hideDoneAt = '2099-01-01T00:00:00.000Z';
  await w.eval('sync()'); await tick(100);
  assert.ok($('[data-id="c1"] [data-act="done"]') && $('[data-id="n1"] [data-act="done"]'), 'another device\'s later change is taken');
  assert.equal(JSON.parse(w.localStorage.getItem('mc.config.v1')).hideDone.restaurant, true);
  assert.ok(mine < config.hideDoneAt && config.hideDoneAt === '2099-01-01T00:00:00.000Z', 'the older choice here is not pushed over it');
  console.log('PASS the categories hiding 「已实现」 sync across devices, newer wins');
  $('#btnSettings').click(); await tick(100);

  // The Shuyu backend: sign in to Shuyu first, then a Quark QR code.
  const calls = [];
  let signedIn = false;
  w.fetch = async (url, opts = {}) => {
    calls.push([url, opts]);
    const json = (status, body) => ({ status, ok: status < 400, json: async () => body });
    const path = url.replace('http://127.0.0.1:9', '');
    if (path === '/api/login') return json(200, { token: 'tok' });
    if (opts.headers?.Authorization !== 'Bearer tok') return json(401, { error: '请登录' });
    if (path === '/api/netdisk/login') return json(200, { label: '夸克网盘', app: '夸克 App', signed_in: false, login: { state: 'waiting', qr: ['101', '010', '101'], link: 'x' } });
    return json(200, { quark: { label: '夸克网盘', app: '夸克 App', signed_in: signedIn, name: signedIn ? '用户' : '', login: { state: signedIn ? 'idle' : 'waiting', qr: ['101', '010', '101'] } },
                       baidu: { label: '百度网盘', app: '百度网盘 App', signed_in: false, name: '', login: { state: 'idle' } } });
  };
  $('[data-nd="retry"]').click(); await tick(100);
  assert.match($('#ndBox').textContent, /书屿的后台要先登录/);
  $('#shuyuPass').value = 'x'; $('[data-nd="signin"]').click(); await tick(100);
  assert.equal(w.localStorage.getItem('shuyu-token'), 'tok', 'the token goes where 书屿 keeps it');
  $('[data-nd="login"][data-drive="quark"]').click(); await tick(100);
  assert.ok($('#ndBox .qr svg'), 'Quark QR drawn from its matrix');
  signedIn = true; await tick(2300);
  assert.match($('#ndBox').textContent, /夸克网盘：已登录 · 用户/);
  let asked = '';
  w.confirm = (m) => { asked = m; return false; };
  $('[data-nd="logout"]').click(); await tick();
  assert.match(asked, /同时退出书屿和 Plexus 里的夸克网盘/);
  assert.ok(!calls.some(([u]) => u.endsWith('/api/netdisk/logout')), 'nothing signed out when cancelled');
  console.log('PASS netdisk accounts through 书屿: signs in to 书屿 once, QR, polling, confirm before signing out everywhere');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
