-- 006 拾闻（clip-collections，Mac 应用 ClipCollections）作为已配对的应用：凭设备令牌读写「新闻」分类，
-- PDF 生成成功后回报「已保存」（写在 mc_fulfill 里）。在 005_agent_delete.sql 之后运行，可重复运行。说明见 supabase/README.md。

alter table public.mc_agents drop constraint if exists mc_agents_app_check;
alter table public.mc_agents add constraint mc_agents_app_check
  check (app in ('hub', 'shuyu', 'plexus', 'steamless', 'foodcollection', 'clipcollections'));

create or replace function public.mc_app_categories(p_app text)
returns text[] language sql immutable set search_path = '' as $$
  select case p_app
    when 'shuyu'           then array['novel']
    when 'plexus'          then array['movie', 'tv']
    when 'steamless'       then array['game']
    when 'foodcollection'  then array['restaurant']
    when 'clipcollections' then array['news']
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
  if p_app is null or p_app not in ('hub', 'shuyu', 'plexus', 'steamless', 'foodcollection', 'clipcollections') then
    raise exception 'unknown app' using errcode = '22023';
  end if;
  insert into public.mc_agents (name, app, token_hash)
  values (v_name, p_app, encode(extensions.digest(v_token, 'sha256'), 'hex'))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'name', v_name, 'app', p_app, 'token', v_token);
end $$;

-- 3：有「新闻」分类。拾闻配对前检查这个版本，旧的应用只要求 2，不受影响
create or replace function public.mc_api_version()
returns int language sql immutable security definer set search_path = '' as $$ select 3 $$;

revoke execute on function public.mc_app_categories(text)        from public, anon, authenticated;
revoke execute on function public.mc_agent_create(text, text, text) from public;
grant  execute on function public.mc_agent_create(text, text, text) to anon, authenticated;
revoke execute on function public.mc_api_version()               from public;
grant  execute on function public.mc_api_version()               to anon, authenticated;

insert into public.mc_migrations (name) values ('006_clipcollections') on conflict (name) do nothing;
