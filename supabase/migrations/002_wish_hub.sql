-- 002 心愿中枢：书屿、Plexus、Steamless 通过设备令牌读写心愿，并回报「已拥有」。
-- 在 001_base.sql 之后运行，可重复运行。说明见 supabase/README.md。

create table if not exists public.mc_migrations (
  name       text        primary key,
  applied_at timestamptz not null default now()
);
alter table public.mc_migrations enable row level security;
revoke all on public.mc_migrations from anon, authenticated;

-- 接口版本：各应用启动时检查，低于自己需要的版本就提示先执行新的迁移
create or replace function public.mc_api_version()
returns int language sql immutable security definer set search_path = '' as $$ select 1 $$;

-- ===== 同步密码的失败次数限制 =====
-- 连续输错 10 次后锁定 15 分钟（全局，不分来源）。密码错误时函数会报错、整个事务回滚，
-- 写进表里的计数会一起丢掉，所以计数放在 sequence 里：sequence 的变化不随事务回滚。
create sequence if not exists public.mc_check_failures;  -- 连续失败次数
create sequence if not exists public.mc_check_locked;    -- 锁定到的时间（Unix 秒）
revoke all on sequence public.mc_check_failures, public.mc_check_locked from anon, authenticated;

create or replace function public.mc_check(p_pass text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_locked bigint;
  v_failures bigint;
  v_called boolean;
begin
  select s.last_value into v_locked from public.mc_check_locked s;
  if v_locked > extract(epoch from now()) then
    raise exception 'too many attempts' using errcode = 'MC429',
      hint = ceil(v_locked - extract(epoch from now()))::text;  -- 还要等几秒
  end if;
  if exists (
    select 1 from public.mc_secret s where s.id = 1 and s.hash = extensions.crypt(p_pass, s.hash)
  ) then
    select s.is_called into v_called from public.mc_check_failures s;
    if v_called then perform setval('public.mc_check_failures', 1, false); end if;
    return;
  end if;
  v_failures := nextval('public.mc_check_failures');
  if v_failures >= 10 then
    perform setval('public.mc_check_locked', floor(extract(epoch from now()))::bigint + 900);
    perform setval('public.mc_check_failures', 1, false);
  end if;
  raise exception 'wrong password' using errcode = '28P01';
end $$;

-- ===== 已配对的设备 =====
-- 配对码就是设备令牌：只在创建时返回一次明文，库里只存 SHA-256（令牌是 24 字节随机数，不需要慢哈希）。
create table if not exists public.mc_agents (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null,
  app        text        not null check (app in ('hub', 'shuyu', 'plexus', 'steamless')),
  token_hash text        not null unique,
  created_at timestamptz not null default now(),
  last_seen  timestamptz,
  revoked    boolean     not null default false
);
alter table public.mc_agents enable row level security;
revoke all on public.mc_agents from anon, authenticated;

-- 每个应用能读写哪些分类（内部使用）
create or replace function public.mc_app_categories(p_app text)
returns text[] language sql immutable set search_path = '' as $$
  select case p_app
    when 'shuyu'     then array['novel']
    when 'plexus'    then array['movie', 'tv']
    when 'steamless' then array['game']
    else array['novel', 'movie', 'tv', 'game', 'coupon', 'restaurant', 'tool', 'place', 'grocery']
  end
$$;

-- 校验设备令牌，顺便记下最后在线时间；返回设备所属的应用（内部使用）
create or replace function public.mc_agent_check(p_token text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_app text;
begin
  update public.mc_agents a set last_seen = now()
  where a.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') and not a.revoked
  returning a.app into v_app;
  if v_app is null then
    raise exception 'invalid device token' using errcode = '28000';
  end if;
  return v_app;
end $$;

create or replace function public.mc_agent_create(p_pass text, p_name text, p_app text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_token text := 'mch_' || encode(extensions.gen_random_bytes(24), 'hex');
  v_name  text := left(coalesce(nullif(trim(p_name), ''), p_app), 60);
  v_id    uuid;
begin
  perform public.mc_check(p_pass);
  if p_app is null or p_app not in ('hub', 'shuyu', 'plexus', 'steamless') then
    raise exception 'unknown app' using errcode = '22023';
  end if;
  insert into public.mc_agents (name, app, token_hash)
  values (v_name, p_app, encode(extensions.digest(v_token, 'sha256'), 'hex'))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'name', v_name, 'app', p_app, 'token', v_token);
end $$;

create or replace function public.mc_agent_list(p_pass text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public.mc_check(p_pass);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'app', a.app, 'createdAt', a.created_at,
                                        'lastSeen', a.last_seen, 'revoked', a.revoked) order by a.created_at desc)
    from public.mc_agents a), '[]'::jsonb);
end $$;

create or replace function public.mc_agent_revoke(p_pass text, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.mc_check(p_pass);
  update public.mc_agents a set revoked = true where a.id = p_id;
end $$;

-- ===== 心愿的增量同步 =====
-- items.updated_at 来自各设备自己的时钟，不能拿来做增量；synced_at 是写进云端的服务器时间。
alter table public.items add column if not exists synced_at timestamptz not null default now();
create index if not exists items_synced_at on public.items (synced_at);
create index if not exists items_category on public.items ((data->>'category'));

-- 推送数据：只有比云端更新的条目才会覆盖（同 001，另外记下 synced_at）
create or replace function public.mc_push(p_pass text, p_items jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.mc_check(p_pass);
  insert into public.items (id, data, updated_at, synced_at)
  select e->>'id', e, coalesce((e->>'updatedAt')::timestamptz, now()), now()
  from jsonb_array_elements(p_items) e
  where coalesce(e->>'id', '') <> ''
  on conflict (id) do update
    set data = excluded.data, updated_at = excluded.updated_at, synced_at = excluded.synced_at
    where excluded.updated_at > public.items.updated_at;
end $$;

-- 应用拉取心愿：只给它负责的分类，包含已删除（deleted）的条目，让应用能同步删除。
-- 返回 { cursor, items, fulfill }：下次把 cursor 作为 p_since 传回来；fulfill 是这个应用之前回报的匹配（含「不是这个」）。
create or replace function public.mc_wishes(p_token text, p_categories text[] default null, p_since timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_app  text := public.mc_agent_check(p_token);
  v_cats text[] := public.mc_app_categories(v_app);
begin
  if p_categories is not null then
    v_cats := array(select unnest(v_cats) intersect select unnest(p_categories));
  end if;
  return jsonb_build_object(
    -- 往回留一分钟，正在提交的写入不会因此漏掉；重复拿到的条目按 updatedAt 合并即可
    'cursor', now() - interval '1 minute',
    'items', coalesce((
      select jsonb_agg(i.data order by i.synced_at) from public.items i
      where i.data->>'category' = any(v_cats) and (p_since is null or i.synced_at > p_since)), '[]'::jsonb),
    'fulfill', coalesce((
      select jsonb_agg(jsonb_build_object('itemId', f.item_id, 'ref', f.ref, 'rejected', f.rejected, 'ownedAt', f.owned_at))
      from public.mc_fulfill f where f.app = v_app), '[]'::jsonb));
end $$;

-- 应用添加心愿（单条对象或数组），沿用 updatedAt 较新者胜出；只能写自己负责的分类。
-- 返回这些条目在云端的当前内容。
create or replace function public.mc_wish_put(p_token text, p_item jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_cats  text[] := public.mc_app_categories(public.mc_agent_check(p_token));
  v_items jsonb  := case when jsonb_typeof(p_item) = 'array' then p_item else jsonb_build_array(p_item) end;
begin
  if exists (select 1 from jsonb_array_elements(v_items) e
             where coalesce(e->>'id', '') = '' or not coalesce(e->>'category' = any(v_cats), false)) then
    raise exception 'category not allowed for this app' using errcode = '42501';
  end if;
  insert into public.items (id, data, updated_at, synced_at)
  select distinct on (e->>'id') e->>'id', e, coalesce((e->>'updatedAt')::timestamptz, now()), now()
  from jsonb_array_elements(v_items) e
  order by e->>'id', coalesce((e->>'updatedAt')::timestamptz, now()) desc
  on conflict (id) do update
    set data = excluded.data, updated_at = excluded.updated_at, synced_at = excluded.synced_at
    -- 不能借同一个 id 改写别的分类的条目
    where excluded.updated_at > public.items.updated_at and public.items.data->>'category' = any(v_cats);
  return coalesce((select jsonb_agg(i.data) from public.items i
                   where i.id in (select e->>'id' from jsonb_array_elements(v_items) e)), '[]'::jsonb);
end $$;

-- ===== 已拥有（履约记录） =====
-- 单独一张表，不写进 items 的 JSON：mc_push 按 updatedAt 整行覆盖，写在一起会互相冲掉。
create table if not exists public.mc_fulfill (
  item_id    text        not null,
  app        text        not null,
  ref        text        not null default '',   -- 应用里对应的东西（书的路径、Plex guid、Steam AppID）
  url        text        not null default '',   -- 跳到应用网页版的详情页
  title      text        not null default '',   -- 应用里的名字，「不是这个」时让人看得出匹配到了什么
  owned_at   timestamptz,                       -- 空表示现在没有了
  rejected   boolean     not null default false, -- 在中枢点了「不是这个」
  updated_at timestamptz not null default now(),
  primary key (item_id, app)
);
alter table public.mc_fulfill enable row level security;
revoke all on public.mc_fulfill from anon, authenticated;

-- 应用回报匹配：[{itemId, ref, url, title, ownedAt}]。换成了别的 ref 时，之前的「不是这个」不再适用。
create or replace function public.mc_fulfill_put(p_token text, p_rows jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_app text := public.mc_agent_check(p_token);
begin
  insert into public.mc_fulfill (item_id, app, ref, url, title, owned_at, rejected, updated_at)
  select distinct on (r->>'itemId') r->>'itemId', v_app, coalesce(r->>'ref', ''), left(coalesce(r->>'url', ''), 2000),
         left(coalesce(r->>'title', ''), 300), (r->>'ownedAt')::timestamptz, false, now()
  from jsonb_array_elements(p_rows) r
  where coalesce(r->>'itemId', '') <> ''
  on conflict (item_id, app) do update
    set ref = excluded.ref, url = excluded.url, title = excluded.title, owned_at = excluded.owned_at,
        rejected = public.mc_fulfill.rejected and public.mc_fulfill.ref = excluded.ref, updated_at = now();
end $$;

create or replace function public.mc_fulfill_pull(p_pass text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public.mc_check(p_pass);
  return coalesce((
    select jsonb_agg(jsonb_build_object('itemId', f.item_id, 'app', f.app, 'ref', f.ref, 'url', f.url, 'title', f.title,
                                        'ownedAt', f.owned_at, 'rejected', f.rejected, 'updatedAt', f.updated_at))
    from public.mc_fulfill f), '[]'::jsonb);
end $$;

-- 中枢里点「不是这个」（p_rejected = false 撤回）
create or replace function public.mc_fulfill_reject(p_pass text, p_item_id text, p_app text, p_rejected boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.mc_check(p_pass);
  update public.mc_fulfill f set rejected = p_rejected, updated_at = now()
  where f.item_id = p_item_id and f.app = p_app;
end $$;

-- ===== 权限 =====
revoke execute on function public.mc_check(text)                 from public, anon, authenticated;
revoke execute on function public.mc_app_categories(text)        from public, anon, authenticated;
revoke execute on function public.mc_agent_check(text)           from public, anon, authenticated;

revoke execute on function public.mc_api_version()                                  from public;
revoke execute on function public.mc_agent_create(text, text, text)                 from public;
revoke execute on function public.mc_agent_list(text)                               from public;
revoke execute on function public.mc_agent_revoke(text, uuid)                       from public;
revoke execute on function public.mc_push(text, jsonb)                              from public;
revoke execute on function public.mc_wishes(text, text[], timestamptz)              from public;
revoke execute on function public.mc_wish_put(text, jsonb)                          from public;
revoke execute on function public.mc_fulfill_put(text, jsonb)                       from public;
revoke execute on function public.mc_fulfill_pull(text)                             from public;
revoke execute on function public.mc_fulfill_reject(text, text, text, boolean)      from public;
grant  execute on function public.mc_api_version()                                  to anon, authenticated;
grant  execute on function public.mc_agent_create(text, text, text)                 to anon, authenticated;
grant  execute on function public.mc_agent_list(text)                               to anon, authenticated;
grant  execute on function public.mc_agent_revoke(text, uuid)                       to anon, authenticated;
grant  execute on function public.mc_push(text, jsonb)                              to anon, authenticated;
grant  execute on function public.mc_wishes(text, text[], timestamptz)              to anon, authenticated;
grant  execute on function public.mc_wish_put(text, jsonb)                          to anon, authenticated;
grant  execute on function public.mc_fulfill_put(text, jsonb)                       to anon, authenticated;
grant  execute on function public.mc_fulfill_pull(text)                             to anon, authenticated;
grant  execute on function public.mc_fulfill_reject(text, text, text, boolean)      to anon, authenticated;

insert into public.mc_migrations (name) values ('002_wish_hub') on conflict (name) do nothing;
