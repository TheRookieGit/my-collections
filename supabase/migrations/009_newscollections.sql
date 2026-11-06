-- 009 拾闻改名：Mac 应用 ClipCollections 改叫 NewsCollections，网页搬到 news-collections。已有的配对、已保存记录和
-- 条目来源一起改过来，设备令牌不变，不用重新配对。在 008_import_delete.sql 之后运行，可重复运行。说明见 supabase/README.md。

alter table public.mc_agents drop constraint if exists mc_agents_app_check;
update public.mc_agents set app = 'newscollections' where app = 'clipcollections';
alter table public.mc_agents add constraint mc_agents_app_check
  check (app in ('hub', 'shuyu', 'plexus', 'steamless', 'foodcollection', 'newscollections'));

update public.mc_fulfill
  set app = 'newscollections', url = replace(url, '/clip-collections/', '/news-collections/'), updated_at = now()
  where app = 'clipcollections';

-- updatedAt 也更新，网页和拾闻手里的旧副本才会换成新的来源
update public.items
  set data = data || jsonb_build_object('source', 'newscollections',
        'updatedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
      updated_at = now()
  where data->>'source' = 'clipcollections';

create or replace function public.mc_app_categories(p_app text)
returns text[] language sql immutable set search_path = '' as $$
  select case p_app
    when 'shuyu'           then array['novel']
    when 'plexus'          then array['movie', 'tv']
    when 'steamless'       then array['game']
    when 'foodcollection'  then array['restaurant']
    when 'newscollections' then array['news']
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
  if p_app is null or p_app not in ('hub', 'shuyu', 'plexus', 'steamless', 'foodcollection', 'newscollections') then
    raise exception 'unknown app' using errcode = '22023';
  end if;
  insert into public.mc_agents (name, app, token_hash)
  values (v_name, p_app, encode(extensions.digest(v_token, 'sha256'), 'hex'))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'name', v_name, 'app', p_app, 'token', v_token);
end $$;

-- 4：拾闻用 newscollections 配对。拾闻配对前检查这个版本，旧的应用只要求 2，不受影响
create or replace function public.mc_api_version()
returns int language sql immutable security definer set search_path = '' as $$ select 4 $$;

revoke execute on function public.mc_app_categories(text)        from public, anon, authenticated;
revoke execute on function public.mc_agent_create(text, text, text) from public;
grant  execute on function public.mc_agent_create(text, text, text) to anon, authenticated;
revoke execute on function public.mc_api_version()               from public;
grant  execute on function public.mc_api_version()               to anon, authenticated;

insert into public.mc_migrations (name) values ('009_newscollections') on conflict (name) do nothing;
