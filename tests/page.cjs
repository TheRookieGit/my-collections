// Loads the page in jsdom with the two CDN imports and Supabase stubbed, seeded with old and new data. No network.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const assert = require('assert/strict');
const root = require('path').join(__dirname, '..') + '/';
const html = fs.readFileSync(root + 'index.html', 'utf8').replace(/<script type="module"[^>]*><\/script>/, '');
let code = 'const Anthropic = window.Anthropic, createClient = (...a) => window.createClient(...a);\n' + fs.readFileSync(root + 'app.js', 'utf8').replace(/^import .*$/gm, '');
code += '\nwindow.__shotDb = shotDb; window.__seed = (more, rows) => { items.push(...more.map(normalize)); fulfill = [...fulfill, ...rows]; render(); };'; // lets a test keep screenshots without IndexedDB
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
let receiptImages = [];
const importRows = [{ id: 'old', at: '2026-01-01T10:00:00.000Z', uploaded: 2, accepted: 1 }]; // from another device
const config = {};
const agents = [{ id: 'a1', name: '书屿 Windows', app: 'shuyu', createdAt: ts, lastSeen: null, revoked: false },
  { id: 'a0', name: 'foodcollection', app: 'foodcollection', createdAt: ts, lastSeen: null, revoked: true }];
w.Anthropic = class { constructor() { this.messages = { create: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ items: reply, receiptImages }) }] }) }; } };
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
    if (name === 'mc_import_put') { for (const r of args.p_rows) { const i = importRows.findIndex((x) => x.id === r.id); if (i < 0) importRows.push({ ...r }); else importRows[i] = { ...r }; } return { data: null, error: null }; }
    if (name === 'mc_import_delete') { for (const id of args.p_ids) { const i = importRows.findIndex((x) => x.id === id); if (i >= 0) importRows.splice(i, 1); } return { data: null, error: null }; }
    if (name === 'mc_import_list') return { data: importRows.map((r) => ({ ...r })), error: null };
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
  assert.match($('#pairCode').textContent, /没能生成配对码：云端还没执行最新的迁移（006_clipcollections\.sql）/);
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

  // 新闻：只有「待保存 / 已保存」
  w.__seed(JSON.parse(JSON.stringify([
    { id: 'w1', category: 'news', title: '已存好的新闻', link: 'https://a.com/x', extra: { source: '新华社', published: '2026-01-02', topic: '政策' }, createdAt: ts, updatedAt: ts, done: false },
    { id: 'w2', category: 'news', title: '还没存的新闻', link: 'https://a.com/y', extra: {}, createdAt: ts, updatedAt: ts, done: false },
  ])), [{ itemId: 'w1', app: 'clipcollections', ref: 'w1', url: '', title: '已存好的新闻', ownedAt: '2026-03-01T00:00:00Z', rejected: false }]);
  w.document.querySelector('dialog[open] [data-close]')?.click();
  $('#catTabs [data-cat="news"]').click(); await tick();
  assert.equal($('#lbl-todo').textContent, '待保存');
  assert.equal($('#lbl-owned').textContent, '已保存');
  assert.ok($('button[data-status="done"]').hidden, 'no 已实现 tab for news');
  assert.match($('#list').textContent, /还没存的新闻/);
  assert.match($('#list .cv-stamp').textContent, /待保存/);
  assert.equal($('#list .btn-done'), null, 'no 已实现 button on news');
  $('button[data-status="owned"]').click(); await tick();
  const savedCard = $('#list .card').textContent;
  assert.match(savedCard, /已存好的新闻/);
  assert.match(savedCard, /已保存 · 拾闻/);
  assert.match(savedCard, /新华社 · 2026-01-02 · 政策/);
  assert.doesNotMatch(savedCard, /不是这个|已拥有|已实现/);
  $('#catTabs [data-cat="novel"]').click(); await tick();
  assert.equal($('#lbl-todo').textContent, '想要', 'other categories keep their words');
  assert.equal($('button[data-status="done"]').hidden, false);
  console.log('PASS news: 待保存 / 已保存 only, no 已实现 or 不是这个, source and date on the cover');

  // 小票：只读不存，核对后才上传到 AutoReceipt，不进收藏
  w.document.querySelector('dialog[open] [data-close]')?.click();
  const pick = (names) => { Object.defineProperty($('#shotInput'), 'files', { configurable: true, value: names.map((n) => new w.File(['x'], n, { type: 'image/png' })) }); $('#shotInput').dispatchEvent(new w.Event('change')); };
  reply = [shot('tool', '小票旁边的工具')];
  receiptImages = [2];
  pick(['tool.png', 'receipt.png']); await tick(100);
  assert.match($('#shotState').textContent, /有 1 张小票没处理：在设置里填 AutoReceipt 口令/);
  assert.equal($$('.receipt-photo').length, 0);
  $('#dlgShot').close();

  const sentToReceipt = [];
  let uploadFails = true;
  w.fetch = async (url, opts) => {
    if (!String(url).includes('orvuihiojdplciilktvm')) throw new TypeError('Failed to fetch');
    const body = JSON.parse(opts.body);
    sentToReceipt.push([url, body, opts.headers['x-passcode']]);
    const json = (status, data) => ({ status, ok: status < 400, json: async () => data });
    if (body.action === 'detect') return json(200, { ok: true, date: '2026-10-08', dateFromPhoto: false, note: '', receipts: [
      { date: '2026-10-08', merchant: 'Costco', total: 12.5, currency: 'USD', items: [{ name: 'Milk', quantity: 2, price: 8 }] },
      { date: '2026-10-08', merchant: 'Card slip', total: 12.5, currency: 'USD', items: [] }] });
    if (uploadFails) return json(500, { error: '服务器出错了' });
    return json(200, { ok: true, mac: { online: false } });
  };
  $('#btnSettings').click(); await tick(100);
  $('[name="receiptPass"]').value = 'rp';
  $('#settingsForm').dispatchEvent(new w.Event('submit', { cancelable: true })); await tick(200);
  w.document.querySelector('dialog[open] [data-close]')?.click(); await tick();
  assert.equal(JSON.parse(w.localStorage.getItem('mc.config.v1')).receiptPass, 'rp');
  assert.ok(!JSON.stringify(rpcs.filter(([n]) => n === 'mc_set_config')).includes('"rp"'), 'the passcode stays on this device');
  const before2 = w.JSON.parse(w.localStorage.getItem('mc.items.v1')).length;
  reply = [shot('tool', '小票旁边的工具二')];
  pick(['tool.png', 'receipt.png']); await tick(100);
  assert.equal(sentToReceipt.filter(([, b]) => b.action === 'upload').length, 0, 'nothing leaves before it is checked');
  assert.equal(sentToReceipt[0][0], 'https://orvuihiojdplciilktvm.supabase.co/functions/v1/api');
  assert.equal(sentToReceipt[0][2], 'rp');
  assert.match($('.receipt-day h4').textContent, /2026-10-08 · 1 张/);
  assert.match($('.receipt-photo').textContent, /请确认/, 'a date taken from the screenshot says so');
  assert.match($('.receipt-photo').textContent, /USD 12\.50/);
  assert.match($('.receipt-photo').textContent, /Milk ×2/);
  assert.equal($$('.shot-item').length, 1, 'the receipt is not a collection item');
  const date = $('[data-rk="date"]');
  date.value = '2026-10-09'; date.dispatchEvent(new w.Event('change', { bubbles: true })); await tick();
  assert.match($('.receipt-day h4').textContent, /2026-10-09/, 'moves to the corrected day');
  assert.doesNotMatch($('.receipt-photo').textContent, /请确认/);
  const name = $('[data-rk="merchant"]');
  name.value = 'Costco Wholesale'; name.dispatchEvent(new w.Event('input', { bubbles: true }));
  $('#btnShotSave').click(); await tick(100);
  assert.ok($('#dlgShot').open, 'a failed upload stays on screen');
  assert.match($('.receipt-photo').textContent, /没上传：服务器出错了/);
  assert.equal($$('.shot-item').length, 0, 'the collection item is already saved');
  assert.equal($('#btnShotSave').disabled, false, 'and it can be retried');
  uploadFails = false;
  $('#btnShotSave').click(); await tick(100);
  assert.equal($('#dlgShot').open, false);
  const uploads = sentToReceipt.filter(([, b]) => b.action === 'upload');
  const last = uploads.at(-1)[1];
  assert.equal(last.reviewed.date, '2026-10-09');
  assert.deepEqual(last.reviewed.receipts.map((r) => [r.date, r.merchant]), [['2026-10-09', 'Costco Wholesale'], ['2026-10-09', 'Card slip']]);
  const kept2 = w.JSON.parse(w.localStorage.getItem('mc.items.v1'));
  assert.equal(kept2.length, before2 + 1, 'only the tool was collected');
  assert.ok(!kept2.some((i) => /Costco/.test(i.title)));
  const shotted = kept2.find((i) => i.title === '小票旁边的工具二');
  assert.equal(shotted.shots.length, 1, 'the receipt screenshot is not attached to the item');
  receiptImages = [];
  w.__shotDb.pending = async () => []; // no IndexedDB here, and a sync stops at the screenshot upload without it
  const runs = () => [...importRows].sort((a, b) => new Date(b.at) - new Date(a.at));
  await w.eval('sync()'); await tick(100);
  assert.deepEqual([runs()[0].uploaded, runs()[0].accepted], [2, 2], 'the last import: the item and the receipt were both kept');
  assert.deepEqual([runs()[1].uploaded, runs()[1].accepted], [2, 0], 'the one without a passcode was closed unsaved');
  assert.ok(runs().at(-1).id === 'old', 'rows from other devices stay');
  reply = [{ ...shot('tool', '第一张的工具'), image: 1 }, { ...shot('tool', '也是第一张'), image: 1 }];
  pick(['a.png', 'b.png', 'c.png']); await tick(100);
  assert.equal(runs().length, importRows.length);
  $('#btnShotSave').click(); await tick(100);
  await w.eval('sync()'); await tick(100);
  assert.deepEqual([runs()[0].uploaded, runs()[0].accepted], [3, 1], 'counted per image, not per item');
  $('#btnImports').click(); await tick();
  assert.ok($('#dlgImports').open, 'one tap from the top of the page, not in settings');
  assert.equal($('#settingsForm').querySelector('#importList'), null);
  const lines = $$('#importList li').map((li) => li.textContent.replace(/\s+/g, ' ').trim());
  assert.match(lines[0], /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} 上传 3 张 · 已保存 1 张 · 未保存 2 张$/);
  assert.match(lines.at(-1), /^2026-01-01 .* 上传 2 张 · 已保存 1 张 · 未保存 1 张$/);
  const total = importRows.reduce((n, r) => n + r.uploaded, 0), savedTotal = importRows.reduce((n, r) => n + r.accepted, 0);
  assert.equal($('#importSummary').textContent, `累计上传 ${total} 张：已保存 ${savedTotal} 张，未保存 ${total - savedTotal} 张`);
  assert.equal($('#btnImportDelete').disabled, true, 'nothing picked yet');
  const box = (n) => $$('#importList input')[n];
  box(0).checked = true; box(0).dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal($('#btnImportDelete').textContent, '删除选中的 1 条');
  assert.equal($('#importAll').indeterminate, true);
  w.confirm = () => false;
  const countBefore = importRows.length;
  $('#btnImportDelete').click(); await tick();
  assert.equal($$('#importList input').length, countBefore, 'cancelling keeps them');
  w.confirm = () => true;
  const newest = runs()[0].id, itemsBefore = w.localStorage.getItem('mc.items.v1');
  $('#btnImportDelete').click(); await tick();
  assert.equal($$('#importList input').length, countBefore - 1, 'gone at once');
  await w.eval('sync()'); await tick(100);
  assert.ok(!importRows.some((r) => r.id === newest), 'and from the cloud, so other devices lose it too');
  assert.equal($$('#importList input').length, countBefore - 1, 'and it does not come back');
  assert.equal(w.localStorage.getItem('mc.items.v1'), itemsBefore, 'the collection is untouched');
  $('#importAll').checked = true; $('#importAll').dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal($('#btnImportDelete').textContent, `删除选中的 ${countBefore - 1} 条`);
  $('#btnImportDelete').click(); await tick();
  await w.eval('sync()'); await tick(100);
  assert.deepEqual(importRows, []);
  assert.match($('#importList').textContent, /还没有导入过截图/);
  assert.equal($('#btnImports').textContent.trim(), '导入记录', 'no number on the button');
  assert.equal($('#importAll').disabled, true);
  $('#dlgImports').close();

  // 批量删除收藏
  w.__seed(['甲', '乙', '丙'].map((title, n) => ({ id: `b${n}`, category: 'tool', title, extra: {}, createdAt: ts, updatedAt: ts, done: false })), []);
  $('#catTabs [data-cat="tool"]').click(); await tick();
  $('button[data-status="all"]').click(); await tick();
  const toolCards = () => $$('#list .card').length;
  const totalTools = toolCards();
  assert.equal($('#selectBar').hidden, true);
  $('#btnSelect').click(); await tick();
  assert.equal($('#selectBar').hidden, false);
  assert.equal($('#btnSelectDelete').disabled, true, 'nothing picked yet');
  $('[data-id="b0"]').click(); await tick();
  assert.equal($('#dlgDetail').open, false, 'a click selects instead of opening the details');
  assert.equal($('#selectCount').textContent, '已选 1 条');
  $('[data-id="b1"]').click(); $('[data-id="b1"]').click(); await tick();
  assert.equal($('#selectCount').textContent, '已选 1 条', 'a second click unpicks');
  $('[data-id="b1"]').click(); await tick();
  let question = '';
  w.confirm = (m) => { question = m; return false; };
  $('#btnSelectDelete').click(); await tick();
  assert.match(question, /删掉这 2 条收藏：/);
  assert.equal(toolCards(), totalTools, 'cancelling deletes nothing');
  w.confirm = () => true;
  $('#search').value = '丙'; $('#search').dispatchEvent(new w.Event('input', { bubbles: true })); await tick();
  assert.equal($('#selectCount').textContent, '已选 0 条', 'picks out of sight are dropped, so they cannot be deleted unseen');
  $('#btnSelectAll').click(); await tick();
  assert.equal($('#selectCount').textContent, '已选 1 条');
  assert.equal($('#btnSelectAll').textContent, '取消全选');
  $('#search').value = ''; $('#search').dispatchEvent(new w.Event('input', { bubbles: true })); await tick();
  assert.equal($('#selectCount').textContent, '已选 1 条', 'a pick still in view stays');
  $('#btnSelectAll').click(); $('#btnSelectAll').click(); await tick();
  $('[data-id="b0"]').click(); $('[data-id="b1"]').click(); await tick();
  $('#btnSelectDelete').click(); await tick();
  assert.equal(toolCards(), totalTools - 2);
  assert.equal($('#selectBar').hidden, true, 'back to normal afterwards');
  const tomb = (id) => JSON.parse(w.localStorage.getItem('mc.items.v1')).find((i) => i.id === id);
  assert.equal(tomb('b0').deleted, true, 'kept as a tombstone so other devices delete it too');
  assert.ok(tomb('b0').updatedAt > ts, 'with a new time, so the delete wins the merge');
  assert.ok(!tomb('b2').deleted);
  $('#btnSelect').click(); await tick();
  $('#btnSelectCancel').click(); await tick();
  assert.equal($('#selectBar').hidden, true);
  console.log('PASS bulk delete: click to pick, select all, only what is in view, confirmed, tombstoned for sync');
  console.log('PASS the import log: time and counts per image, kept when the window is closed, shared with other devices, deleted in bulk');
  console.log('PASS receipts: grouped by date, date and merchant corrected before upload, kept out of the collection, retried on failure');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
