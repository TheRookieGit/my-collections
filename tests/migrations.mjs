// Runs the Supabase migrations in PGlite (Postgres in WASM) with Supabase's extensions schema and roles, then checks the RPCs.
// No Supabase project is touched: run with `npm ci && npm test`.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const dir = new URL('../supabase/migrations/', import.meta.url);
const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`create schema extensions; create role anon; create role authenticated;
  grant usage on schema public, extensions to anon, authenticated;
  -- Supabase grants new tables and sequences to anon by default; the migrations must take that back.
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;`);
const files = ['001_base.sql', '002_wish_hub.sql', '003_shots.sql', '004_foodcollection.sql', '005_agent_delete.sql', '006_clipcollections.sql', '007_inbox.sql'];
for (let round = 0; round < 2; round++) for (const f of files) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
console.log('PASS migrations run twice');
assert.deepEqual((await db.query('select name from public.mc_migrations order by name')).rows.map((r) => r.name), ['001_base', '002_wish_hub', '003_shots', '004_foodcollection', '005_agent_delete', '006_clipcollections', '007_inbox']);
await db.exec(`insert into public.mc_secret (id, hash) values (1, extensions.crypt('pw', extensions.gen_salt('bf', 4)))`);

const anon = async (sql, params) => { await db.exec('set role anon'); try { return (await db.query(sql, params)).rows; } finally { await db.exec('reset role'); } };
const one = async (sql, params) => Object.values((await anon(sql, params))[0])[0];
const fails = async (sql, params, code) => { await assert.rejects(anon(sql, params), (e) => { assert.equal(e.code, code, e.message); return true; }); };

assert.equal(await one('select public.mc_api_version()'), 4);
await fails('select * from public.items', [], '42501');
await fails('select * from public.mc_agents', [], '42501');
await fails('select * from public.mc_inbox', [], '42501');
await fails("select public.mc_check('pw')", [], '42501');
await fails("select public.mc_agent_check('x')", [], '42501');
await fails("select nextval('public.mc_check_failures')", [], '42501');
console.log('PASS tables, sequences and internal functions closed to anon');

const item = (id, category, title, updatedAt, extra = {}) => ({ id, category, title, updatedAt, createdAt: updatedAt, done: false, ...extra });
await anon('select public.mc_push($1, $2)', ['pw', JSON.stringify([item('n1', 'novel', '书一', '2026-01-01T00:00:00Z'), item('c1', 'coupon', '券', '2026-01-01T00:00:00Z'), item('m1', 'movie', '片', '2026-01-01T00:00:00Z')])]);
const agent = await one("select public.mc_agent_create('pw', '书屿 Windows', 'shuyu')");
assert.match(agent.token, /^mch_[0-9a-f]{48}$/);
await fails("select public.mc_agent_create('pw', 'x', 'nope')", [], '22023');
const plexus = await one("select public.mc_agent_create('pw', '', 'plexus')");
assert.equal(plexus.name, 'plexus');
const listed = await one("select public.mc_agent_list('pw')");
assert.equal(listed.length, 2); assert.ok(!JSON.stringify(listed).includes(agent.token) && !('token_hash' in listed[0]));
console.log('PASS pairing codes created once and listed without them');

let wishes = await one('select public.mc_wishes($1, $2, $3)', [agent.token, null, null]);
assert.deepEqual(wishes.items.map((i) => i.id), ['n1'], 'only its own categories');
assert.equal((await one('select public.mc_wishes($1, $2, $3)', [plexus.token, ['movie', 'novel'], null])).items.map((i) => i.id).join(), 'm1', 'asking for more gives no more');
const cursor = wishes.cursor;
assert.equal((await one('select public.mc_wishes($1, $2, $3)', [agent.token, null, cursor])).items.length, 1, 'the cursor reaches back a minute');
await db.exec("update public.items set synced_at = now() - interval '1 hour'");
assert.equal((await one('select public.mc_wishes($1, $2, $3)', [agent.token, null, new Date(Date.now() - 60000).toISOString()])).items.length, 0);
// Deleting in the hub, even with a clock behind the cloud's, still reaches the app.
await anon('select public.mc_push($1, $2)', ['pw', JSON.stringify([item('n1', 'novel', '书一', '2026-01-02T00:00:00Z', { deleted: true })])]);
wishes = await one('select public.mc_wishes($1, $2, $3)', [agent.token, null, new Date(Date.now() - 60000).toISOString()]);
assert.deepEqual(wishes.items.map((i) => [i.id, i.deleted]), [['n1', true]]);
console.log('PASS wishes by category, since a server-side cursor, deletions included');

let stored = await one('select public.mc_wish_put($1, $2)', [agent.token, JSON.stringify(item('n2', 'novel', '书二', '2026-02-01T00:00:00Z'))]);
assert.equal(stored[0].title, '书二');
stored = await one('select public.mc_wish_put($1, $2)', [agent.token, JSON.stringify([item('n2', 'novel', '旧的', '2025-01-01T00:00:00Z')])]);
assert.equal(stored[0].title, '书二', 'an older copy does not win');
await fails('select public.mc_wish_put($1, $2)', [agent.token, JSON.stringify(item('x1', 'coupon', '券', '2026-02-01T00:00:00Z'))], '42501');
stored = await one('select public.mc_wish_put($1, $2)', [agent.token, JSON.stringify(item('c1', 'novel', '冒充', '2027-01-01T00:00:00Z'))]);
assert.equal(stored[0].category, 'coupon', 'another category is not overwritten through its id');
await fails('select public.mc_wish_put($1, $2)', ['mch_wrong', JSON.stringify(item('n3', 'novel', 'x', '2026-01-01T00:00:00Z'))], '28000');
// FoodCollection pairs like the other apps and only ever reaches the 餐厅 category.
const food = await one("select public.mc_agent_create('pw', 'Mac', 'foodcollection')");
await anon('select public.mc_push($1, $2)', ['pw', JSON.stringify([item('r1', 'restaurant', '店', '2026-01-01T00:00:00Z')])]);
assert.deepEqual((await one('select public.mc_wishes($1, $2, $3)', [food.token, null, null])).items.map((i) => i.id), ['r1']);
await fails('select public.mc_wish_put($1, $2)', [food.token, JSON.stringify(item('nx', 'novel', '书', '2026-03-01T00:00:00Z'))], '42501');
assert.equal((await one('select public.mc_wish_put($1, $2)', [food.token, JSON.stringify(item('r2', 'restaurant', '新店', '2026-03-01T00:00:00Z'))]))[0].title, '新店');
console.log('PASS apps add wishes in their own categories, newer copy wins');

await anon('select public.mc_fulfill_put($1, $2)', [agent.token, JSON.stringify([{ itemId: 'n2', ref: 'a/书二.txt', url: 'https://x/#book=1', title: '书二', ownedAt: '2026-03-01T00:00:00Z' }, { itemId: 'n2', ref: 'dup' }])]);
let rows = await one("select public.mc_fulfill_pull('pw')");
assert.equal(rows.length, 1); assert.equal(rows[0].app, 'shuyu'); assert.equal(rows[0].rejected, false);
await anon("select public.mc_fulfill_reject('pw', 'n2', 'shuyu')");
await anon('select public.mc_fulfill_put($1, $2)', [agent.token, JSON.stringify([{ itemId: 'n2', ref: rows[0].ref, ownedAt: '2026-03-01T00:00:00Z' }])]);
assert.equal((await one("select public.mc_fulfill_pull('pw')"))[0].rejected, true, 'the same match stays rejected');
assert.deepEqual((await one('select public.mc_wishes($1, $2, $3)', [agent.token, null, null])).fulfill.map((f) => [f.itemId, f.rejected]), [['n2', true]]);
await anon('select public.mc_fulfill_put($1, $2)', [agent.token, JSON.stringify([{ itemId: 'n2', ref: 'b/书二（完整版）.txt', ownedAt: '2026-03-02T00:00:00Z' }])]);
assert.equal((await one("select public.mc_fulfill_pull('pw')"))[0].rejected, false, 'a different match is offered again');
console.log('PASS fulfilment kept apart from items, rejected per match');

// Screenshots: an app uploads its own and reads those of wishes in its categories, the hub page sees them all.
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
await anon('select public.mc_agent_put_image($1, $2, $3)', [agent.token, 'shot-app-1', PNG]);
await fails('select public.mc_agent_put_image($1, $2, $3)', [agent.token, 'shot-app-2', 'hello'], '22023');
await fails('select public.mc_agent_put_image($1, $2, $3)', [agent.token, '../x', PNG], '22023');
await fails('select public.mc_agent_put_image($1, $2, $3)', ['mch_wrong', 'shot-app-3', PNG], '28000');
assert.equal(await one("select public.mc_get_image('pw', 'shot-app-1')"), PNG);
await anon("select public.mc_put_image('pw', 'shot-hub-1', $1)", [PNG]);
assert.equal(await one('select public.mc_agent_get_image($1, $2)', [agent.token, 'shot-hub-1']), null, 'not on any of its wishes yet');
await anon('select public.mc_push($1, $2)', ['pw', JSON.stringify([item('n4', 'novel', '书四', '2026-04-01T00:00:00Z', { shots: ['shot-hub-1'] }), item('m4', 'movie', '片四', '2026-04-01T00:00:00Z', { shots: ['shot-app-1'] })])]);
assert.equal(await one('select public.mc_agent_get_image($1, $2)', [agent.token, 'shot-hub-1']), PNG);
assert.equal(await one('select public.mc_agent_get_image($1, $2)', [agent.token, 'shot-app-1']), null, "a movie's screenshot is not for 书屿");
assert.equal(await one('select public.mc_agent_get_image($1, $2)', [plexus.token, 'shot-app-1']), PNG);
console.log('PASS apps keep screenshots of the wishes in their own categories');

await anon("select public.mc_agent_revoke('pw', $1)", [agent.id]);
await fails('select public.mc_wishes($1, $2, $3)', [agent.token, null, null], '28000');
assert.ok((await one("select public.mc_agent_list('pw')")).find((a) => a.id === agent.id).revoked);
assert.ok((await one("select public.mc_agent_list('pw')")).find((a) => a.id === plexus.id).lastSeen, 'last seen is recorded');
// Only a revoked pairing can be deleted.
const before = (await one("select public.mc_agent_list('pw')")).length;
await anon("select public.mc_agent_delete('pw', $1)", [plexus.id]);
assert.equal((await one("select public.mc_agent_list('pw')")).length, before, 'a device in use is not deleted');
await anon("select public.mc_agent_delete('pw', $1)", [agent.id]);
assert.ok(!(await one("select public.mc_agent_list('pw')")).some((a) => a.id === agent.id));
console.log('PASS revoked devices are refused, and only revoked ones can be deleted');

for (let n = 0; n < 9; n++) await fails("select public.mc_pull('wrong')", [], '28P01');
await one("select public.mc_pull('pw')");
for (let n = 0; n < 9; n++) await fails("select public.mc_pull('wrong')", [], '28P01');
await fails("select public.mc_pull('wrong')", [], '28P01');
await assert.rejects(anon("select public.mc_pull('pw')"), (e) => { assert.equal(e.code, 'MC429'); assert.ok(+e.hint > 800 && +e.hint <= 900, e.hint); return true; });
assert.ok((await one('select public.mc_wishes($1, $2, $3)', [plexus.token, null, null])).items, 'paired devices keep working while locked');
await db.exec("select setval('public.mc_check_locked', 1)");
assert.ok(Array.isArray(await one("select public.mc_pull('pw')")));

const clip = await one("select public.mc_agent_create('pw', 'Mac', 'clipcollections')");
assert.equal(clip.app, 'clipcollections');
await anon('select public.mc_push($1, $2)', ['pw', JSON.stringify([item('w1', 'news', '中枢里加的新闻', '2026-02-01T00:00:00Z', { link: 'https://a.com/x' })])]);
let got = await one('select public.mc_wishes($1, $2, $3)', [clip.token, null, null]);
assert.deepEqual(got.items.map((i) => i.id), ['w1'], 'clipcollections reads news and nothing else');
got = await one('select public.mc_wishes($1, $2, $3)', [clip.token, ['novel'], null]);
assert.deepEqual(got.items, [], 'asking for another category gets nothing');
await one('select public.mc_wish_put($1, $2)', [clip.token, JSON.stringify(item('w2', 'news', '拾闻里加的新闻', '2026-02-02T00:00:00Z'))]);
await fails('select public.mc_wish_put($1, $2)', [clip.token, JSON.stringify(item('w3', 'novel', 'x', '2026-02-02T00:00:00Z'))], '42501');
await one('select public.mc_wish_put($1, $2)', [clip.token, JSON.stringify(item('n1', 'news', '借 id 改小说', '2027-01-01T00:00:00Z'))]);
assert.equal((await one("select public.mc_pull('pw')")).find((i) => i.id === 'n1').category, 'novel', 'an id of another category cannot be taken over');
await anon('select public.mc_fulfill_put($1, $2)', [clip.token, JSON.stringify([{ itemId: 'w1', ref: 'w1', title: '中枢里加的新闻', ownedAt: '2026-02-03T00:00:00Z' }])]);
assert.ok((await one("select public.mc_fulfill_pull('pw')")).some((f) => f.itemId === 'w1' && f.app === 'clipcollections' && f.ownedAt), 'saved is reported through mc_fulfill');
const pulled = await one("select public.mc_pull('pw')");
assert.equal(pulled.find((i) => i.id === 'w1').ownedAt, undefined, 'the state stays out of the item JSON, so mc_push cannot overwrite it');
const shot = 'data:image/jpeg;base64,AAAA';
await anon('select public.mc_agent_put_image($1, $2, $3)', [clip.token, 'w2-000', shot]);
await one('select public.mc_wish_put($1, $2)', [clip.token, JSON.stringify(item('w2', 'news', '拾闻里加的新闻', '2026-02-05T00:00:00Z', { shots: ['w2-000'] }))]);
assert.equal(await one('select public.mc_agent_get_image($1, $2)', [clip.token, 'w2-000']), shot);
const hub = await one("select public.mc_agent_create('pw', '', 'hub')");
assert.ok((await one('select public.mc_wishes($1, $2, $3)', [hub.token, null, null])).items.some((i) => i.category === 'news'), 'a hub pairing covers news too');
assert.equal((await one('select public.mc_wishes($1, $2, $3)', [plexus.token, null, null])).items.some((i) => i.category === 'news'), false, 'other apps do not see news');
console.log('PASS clipcollections reads and writes news only, reports saved through mc_fulfill, and news stays out of other apps');

const phone = await one("select public.mc_agent_create('pw', 'iPhone', 'shortcut')");
const png = 'data:image/jpeg;base64,AAAA';
assert.equal(await one('select public.mc_inbox_put($1, $2)', [phone.token, png]), 'mc-inbox-ok');
await fails('select public.mc_inbox_put($1, $2)', ['mch_nope', png], '28000');
await fails('select public.mc_inbox_put($1, $2)', [clip.token, png], '42501');
await fails('select public.mc_inbox_put($1, $2)', [phone.token, 'hello'], '22023');
await fails('select public.mc_inbox_put($1, $2)', [phone.token, 'data:image/jpeg;base64,' + 'A'.repeat(4000000)], '22023');
assert.deepEqual((await one('select public.mc_wishes($1, $2, $3)', [phone.token, null, null])).items, [], 'a shortcut reads no category');
await fails('select public.mc_wish_put($1, $2)', [phone.token, JSON.stringify(item('p1', 'novel', 'x', '2026-02-02T00:00:00Z'))], '42501');
assert.equal(await one('select public.mc_inbox_status($1)', [phone.token]), 'mc-inbox-pending:1', 'photos stay in the album while anything is unreviewed');
await fails('select public.mc_inbox_status($1)', ['mch_nope'], '28000');
await fails('select public.mc_inbox_status($1)', [clip.token], '42501');
await fails("select public.mc_inbox_list('wrong')", [], '28P01');
let ids = await one("select public.mc_inbox_list('pw')");
assert.equal(ids.length, 1);
await fails('select public.mc_inbox_get($1, $2)', ['wrong', ids[0]], '28P01');
assert.equal(await one('select public.mc_inbox_get($1, $2)', ['pw', ids[0]]), png);
for (let n = 1; n < 50; n++) await one('select public.mc_inbox_put($1, $2)', [phone.token, png]);
await fails('select public.mc_inbox_put($1, $2)', [phone.token, png], 'MC413');
await anon('select public.mc_inbox_delete($1, $2)', ['pw', ids[0]]);
ids = await one("select public.mc_inbox_list('pw')");
assert.equal(ids.length, 49);
for (const id of ids) await anon('select public.mc_inbox_delete($1, $2)', ['pw', id]);
assert.equal(await one('select public.mc_inbox_status($1)', [phone.token]), 'mc-inbox-clear');
console.log('PASS the inbox takes images from a shortcut pairing only, which reaches no category, and stops at 50');
console.log('PASS ten wrong passwords in a row lock password calls for 15 minutes, counted despite the rollback');
