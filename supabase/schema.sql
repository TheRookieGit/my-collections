-- 在 Supabase Dashboard → SQL Editor 里整段运行一次即可（可重复运行）。
-- 同步密码另外设置，见文件末尾，千万不要把真实密码写进这个公开文件。

create extension if not exists pgcrypto with schema extensions;

-- 收藏数据：每条一行
create table if not exists public.items (
  id         text        primary key,
  data       jsonb       not null,
  updated_at timestamptz not null default now()
);

-- 迁移：早期版本的 items 用 (user_id, id) 作主键，改成只用 id
drop policy if exists "items_select_own" on public.items;
drop policy if exists "items_insert_own" on public.items;
drop policy if exists "items_update_own" on public.items;
drop policy if exists "items_delete_own" on public.items;
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'items' and column_name = 'user_id') then
    alter table public.items drop constraint if exists items_pkey;
    alter table public.items drop column user_id;
    alter table public.items add primary key (id);
  end if;
end $$;

-- 同步密码（只存 bcrypt 哈希，只有一行）
create table if not exists public.mc_secret (
  id   int  primary key default 1 check (id = 1),
  hash text not null
);

-- 两张表都对外完全关闭，只能通过下面的函数访问
alter table public.items     enable row level security;
alter table public.mc_secret enable row level security;
revoke all on public.items, public.mc_secret from anon, authenticated;

-- 校验密码（内部使用，不对外开放）
create or replace function public.mc_check(p_pass text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.mc_secret s where s.id = 1 and s.hash = extensions.crypt(p_pass, s.hash)
  ) then
    raise exception 'wrong password' using errcode = '28P01';
  end if;
end $$;

-- 拉取全部数据
create or replace function public.mc_pull(p_pass text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public.mc_check(p_pass);
  return coalesce((select jsonb_agg(i.data) from public.items i), '[]'::jsonb);
end $$;

-- 推送数据：只有比云端更新的条目才会覆盖
create or replace function public.mc_push(p_pass text, p_items jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.mc_check(p_pass);
  insert into public.items (id, data, updated_at)
  select e->>'id', e, coalesce((e->>'updatedAt')::timestamptz, now())
  from jsonb_array_elements(p_items) e
  where coalesce(e->>'id', '') <> ''
  on conflict (id) do update
    set data = excluded.data, updated_at = excluded.updated_at
    where excluded.updated_at > public.items.updated_at;
end $$;

-- 跨设备共享的设置（如 Anthropic API Key），只有一行
create table if not exists public.mc_config (
  id   int   primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb
);
alter table public.mc_config enable row level security;
revoke all on public.mc_config from anon, authenticated;

create or replace function public.mc_get_config(p_pass text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public.mc_check(p_pass);
  return coalesce((select c.data from public.mc_config c where c.id = 1), '{}'::jsonb);
end $$;

-- 合并写入：只覆盖传入的字段
create or replace function public.mc_set_config(p_pass text, p_data jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.mc_check(p_pass);
  insert into public.mc_config (id, data) values (1, p_data)
  on conflict (id) do update set data = public.mc_config.data || excluded.data;
end $$;

-- 截图原图（压缩后的 JPEG data URL），收藏条目里只存图片 id
create table if not exists public.mc_images (
  id         text        primary key,
  data       text        not null,
  created_at timestamptz not null default now()
);
alter table public.mc_images enable row level security;
revoke all on public.mc_images from anon, authenticated;

create or replace function public.mc_put_image(p_pass text, p_id text, p_data text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.mc_check(p_pass);
  insert into public.mc_images (id, data) values (p_id, p_data) on conflict (id) do nothing;
end $$;

create or replace function public.mc_get_image(p_pass text, p_id text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  perform public.mc_check(p_pass);
  return (select i.data from public.mc_images i where i.id = p_id);
end $$;

revoke execute on function public.mc_put_image(text, text, text) from public;
revoke execute on function public.mc_get_image(text, text)       from public;
grant  execute on function public.mc_put_image(text, text, text) to anon, authenticated;
grant  execute on function public.mc_get_image(text, text)       to anon, authenticated;

revoke execute on function public.mc_check(text)       from public, anon, authenticated;
revoke execute on function public.mc_get_config(text)         from public;
revoke execute on function public.mc_set_config(text, jsonb)  from public;
grant  execute on function public.mc_get_config(text)         to anon, authenticated;
grant  execute on function public.mc_set_config(text, jsonb)  to anon, authenticated;
revoke execute on function public.mc_pull(text)        from public;
revoke execute on function public.mc_push(text, jsonb) from public;
grant  execute on function public.mc_pull(text)        to anon, authenticated;
grant  execute on function public.mc_push(text, jsonb) to anon, authenticated;

-- ===== 设置 / 修改同步密码 =====
-- 在 SQL Editor 里单独运行下面这句（把中文换成你的密码，建议 12 位以上），不要保存到这个文件：
--
-- insert into public.mc_secret (id, hash) values (1, extensions.crypt('你的密码', extensions.gen_salt('bf', 10)))
-- on conflict (id) do update set hash = excluded.hash;
