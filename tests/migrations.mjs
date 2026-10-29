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
const files = ['001_base.sql', '002_wish_hub.sql', '003_shots.sql', '004_foodcollection.sql'];
for (let round = 0; round < 2; round++) for (const f of files) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
console.log('PASS migrations run twice');
assert.deepEqual((await db.query('select name from public.mc_migrations order by name')).rows.map((r) => r.name), ['001_base', '002_wish_hub', '003_shots', '004_foodcollection']);
await db.exec(`insert into public.mc_secret (id, hash) values (1, extensions.crypt('pw', extensions.gen_salt('bf', 4)))`);

const anon = async (sql, params) => { await db.exec('set role anon'); try { return (await db.query(sql, params)).rows; } finally { await db.exec('reset role'); } };
const one = async (sql, params) => Object.values((await anon(sql, params))[0])[0];
const fails = async (sql, params, code) => { await assert.rejects(anon(sql, params), (e) => { assert.equal(e.code, code, e.message); return true; }); };

assert.equal(await one('select public.mc_api_version()'), 2);
await fails('select * from public.items', [], '42501');
await fails('select * from public.mc_agents', [], '42501');
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
console.log('PASS revoked devices are refused');

for (let n = 0; n < 9; n++) await fails("select public.mc_pull('wrong')", [], '28P01');
await one("select public.mc_pull('pw')");
for (let n = 0; n < 9; n++) await fails("select public.mc_pull('wrong')", [], '28P01');
await fails("select public.mc_pull('wrong')", [], '28P01');
await assert.rejects(anon("select public.mc_pull('pw')"), (e) => { assert.equal(e.code, 'MC429'); assert.ok(+e.hint > 800 && +e.hint <= 900, e.hint); return true; });
assert.ok((await one('select public.mc_wishes($1, $2, $3)', [plexus.token, null, null])).items, 'paired devices keep working while locked');
await db.exec("select setval('public.mc_check_locked', 1)");
assert.ok(Array.isArray(await one("select public.mc_pull('pw')")));
console.log('PASS ten wrong passwords in a row lock password calls for 15 minutes, counted despite the rollback');
