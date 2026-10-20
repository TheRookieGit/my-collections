-- 在 Supabase Dashboard → SQL Editor 里整段运行一次即可（可重复运行）。
-- 同步密码另外设置，见文件末尾，千万不要把真实密码写进这个公开文件。

create extension if not exists pgcrypto with schema extensions;

-- 收藏数据：每条一行
create table if not exists public.items (
  id         text        primary key,
  data       jsonb       not null,
  updated_at timestamptz not null default now()
);

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

revoke execute on function public.mc_check(text)       from public, anon, authenticated;
revoke execute on function public.mc_pull(text)        from public;
revoke execute on function public.mc_push(text, jsonb) from public;
grant  execute on function public.mc_pull(text)        to anon, authenticated;
grant  execute on function public.mc_push(text, jsonb) to anon, authenticated;

-- ===== 设置 / 修改同步密码 =====
-- 在 SQL Editor 里单独运行下面这句（把中文换成你的密码，建议 12 位以上），不要保存到这个文件：
--
-- insert into public.mc_secret (id, hash) values (1, extensions.crypt('你的密码', extensions.gen_salt('bf', 10)))
-- on conflict (id) do update set hash = excluded.hash;
