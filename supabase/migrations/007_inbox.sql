-- 007 iPhone 快捷指令的截图收件箱：快捷指令凭设备令牌上传截图，网页用同步密码取出来走截图识别，
-- 保存或丢弃后才从这里删掉。快捷指令等网页处理完、收件箱清空，才把相册里的原图删掉。
-- 在 006_clipcollections.sql 之后运行，可重复运行。说明见 supabase/README.md。

alter table public.mc_agents drop constraint if exists mc_agents_app_check;
alter table public.mc_agents add constraint mc_agents_app_check
  check (app in ('hub', 'shuyu', 'plexus', 'steamless', 'foodcollection', 'clipcollections', 'shortcut'));

-- 快捷指令不碰任何分类：令牌存在手机的快捷指令里，只能往收件箱放图
create or replace function public.mc_app_categories(p_app text)
returns text[] language sql immutable set search_path = '' as $$
  select case p_app
    when 'shuyu'           then array['novel']
    when 'plexus'          then array['movie', 'tv']
    when 'steamless'       then array['game']
    when 'foodcollection'  then array['restaurant']
    when 'clipcollections' then array['news']
    when 'shortcut'        then array[]::text[]
    else array['novel', 'movie', 'tv', 'game', 'coupon', 'restaurant', 'tool', 'place', 'grocery', 'news']
  end
$$;

create or replace function public.mc_agent_create(p_pass text, p_name text, p_app text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_token text := 'mch_' || encode(extensions.gen_random_bytes(24), 'hex');
  v_name  text := left(coalesce(nullif(trim(p_name), ''), p_app), 60);
  v_id    uuid;
begin
  perform public.mc_check(p_pass);
  if p_app is null or p_app not in ('hub', 'shuyu', 'plexus', 'steamless', 'foodcollection', 'clipcollections', 'shortcut') then
    raise exception 'unknown app' using errcode = '22023';
  end if;
  insert into public.mc_agents (name, app, token_hash)
  values (v_name, p_app, encode(extensions.digest(v_token, 'sha256'), 'hex'))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'name', v_name, 'app', p_app, 'token', v_token);
end $$;

create table if not exists public.mc_inbox (
  id         uuid        primary key default gen_random_uuid(),
  data       text        not null,
  created_at timestamptz not null default now()
);
create index if not exists mc_inbox_created_at on public.mc_inbox (created_at);
alter table public.mc_inbox enable row level security;
revoke all on public.mc_inbox from anon, authenticated;

-- 快捷指令上传一张截图。「获取 URL 内容」遇到错误状态码不会中断，快捷指令靠返回值里有没有 mc-inbox-ok
-- 判断成功与否，没有这个字样的照片不算上传成功。积压 50 张后拒收，令牌泄露也撑不爆数据库
create or replace function public.mc_inbox_put(p_token text, p_data text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if public.mc_agent_check(p_token) <> 'shortcut' then
    raise exception 'only a shortcut pairing can use the inbox' using errcode = '42501';
  end if;
  if coalesce(p_data, '') !~ '^data:image/[a-z]+;base64,[A-Za-z0-9+/=]+$' or length(p_data) > 4000000 then
    raise exception 'not an image, or larger than 4 MB' using errcode = '22023';
  end if;
  if (select count(*) from public.mc_inbox) >= 50 then
    raise exception 'inbox is full' using errcode = 'MC413';
  end if;
  insert into public.mc_inbox (data) values (p_data);
  return 'mc-inbox-ok';
end $$;

-- 快捷指令从网页回来后问这一句：只有返回 mc-inbox-clear 才删相册里的原图。
-- 没看完的、没存到云端的都还在收件箱里，出错时也拿不到这个字样，所以不会误删
create or replace function public.mc_inbox_status(p_token text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_left bigint;
begin
  if public.mc_agent_check(p_token) <> 'shortcut' then
    raise exception 'only a shortcut pairing can use the inbox' using errcode = '42501';
  end if;
  select count(*) into v_left from public.mc_inbox;
  return case when v_left = 0 then 'mc-inbox-clear' else 'mc-inbox-pending:' || v_left end;
end $$;

-- 网页：待处理的截图 id，最早的在前
create or replace function public.mc_inbox_list(p_pass text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public.mc_check(p_pass);
  return coalesce((select jsonb_agg(i.id order by i.created_at, i.id) from public.mc_inbox i), '[]'::jsonb);
end $$;

create or replace function public.mc_inbox_get(p_pass text, p_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
begin
  perform public.mc_check(p_pass);
  return (select i.data from public.mc_inbox i where i.id = p_id);
end $$;

create or replace function public.mc_inbox_delete(p_pass text, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.mc_check(p_pass);
  delete from public.mc_inbox i where i.id = p_id;
end $$;

-- 4：有截图收件箱
create or replace function public.mc_api_version()
returns int language sql immutable security definer set search_path = '' as $$ select 4 $$;

revoke execute on function public.mc_app_categories(text)            from public, anon, authenticated;
revoke execute on function public.mc_agent_create(text, text, text)  from public;
revoke execute on function public.mc_api_version()                   from public;
revoke execute on function public.mc_inbox_put(text, text)           from public;
revoke execute on function public.mc_inbox_status(text)              from public;
revoke execute on function public.mc_inbox_list(text)                from public;
revoke execute on function public.mc_inbox_get(text, uuid)           from public;
revoke execute on function public.mc_inbox_delete(text, uuid)        from public;
grant  execute on function public.mc_agent_create(text, text, text)  to anon, authenticated;
grant  execute on function public.mc_api_version()                   to anon, authenticated;
grant  execute on function public.mc_inbox_put(text, text)           to anon, authenticated;
grant  execute on function public.mc_inbox_status(text)              to anon, authenticated;
grant  execute on function public.mc_inbox_list(text)                to anon, authenticated;
grant  execute on function public.mc_inbox_get(text, uuid)           to anon, authenticated;
grant  execute on function public.mc_inbox_delete(text, uuid)        to anon, authenticated;

insert into public.mc_migrations (name) values ('007_inbox') on conflict (name) do nothing;
