-- 004 FoodCollection（Mac 上的「今天吃什么」）作为已配对的应用：凭设备令牌读写「餐厅」分类的心愿（它的想吃清单），
-- 吃过的店回报「已拥有」。在 003_shots.sql 之后运行，可重复运行。说明见 supabase/README.md。

alter table public.mc_agents drop constraint if exists mc_agents_app_check;
alter table public.mc_agents add constraint mc_agents_app_check
  check (app in ('hub', 'shuyu', 'plexus', 'steamless', 'foodcollection'));

create or replace function public.mc_app_categories(p_app text)
returns text[] language sql immutable set search_path = '' as $$
  select case p_app
    when 'shuyu'          then array['novel']
    when 'plexus'         then array['movie', 'tv']
    when 'steamless'      then array['game']
    when 'foodcollection' then array['restaurant']
    else array['novel', 'movie', 'tv', 'game', 'coupon', 'restaurant', 'tool', 'place', 'grocery']
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
  if p_app is null or p_app not in ('hub', 'shuyu', 'plexus', 'steamless', 'foodcollection') then
    raise exception 'unknown app' using errcode = '22023';
  end if;
  insert into public.mc_agents (name, app, token_hash)
  values (v_name, p_app, encode(extensions.digest(v_token, 'sha256'), 'hex'))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'name', v_name, 'app', p_app, 'token', v_token);
end $$;

revoke execute on function public.mc_app_categories(text)        from public, anon, authenticated;
revoke execute on function public.mc_agent_create(text, text, text) from public;
grant  execute on function public.mc_agent_create(text, text, text) to anon, authenticated;

insert into public.mc_migrations (name) values ('004_foodcollection') on conflict (name) do nothing;
