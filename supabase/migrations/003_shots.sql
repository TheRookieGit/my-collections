-- 003 原截图双向同步：书屿、Plexus、Steamless 凭设备令牌存取心愿的原截图。
-- 在 002_wish_hub.sql 之后运行，可重复运行。说明见 supabase/README.md。

-- 接口版本 2：应用可以读写原截图
create or replace function public.mc_api_version()
returns int language sql immutable security definer set search_path = '' as $$ select 2 $$;

-- 应用上传一张原截图（压缩后的图片 data URL）。同一个 id 已经有了就不覆盖，图片内容不会变
create or replace function public.mc_agent_put_image(p_token text, p_id text, p_data text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.mc_agent_check(p_token);
  if coalesce(p_id, '') !~ '^[A-Za-z0-9_-]{6,64}$' then
    raise exception 'bad image id' using errcode = '22023';
  end if;
  if coalesce(p_data, '') not like 'data:image/%' or length(p_data) > 4000000 then
    raise exception 'not an image, or larger than 4 MB' using errcode = '22023';
  end if;
  insert into public.mc_images (id, data) values (p_id, p_data) on conflict (id) do nothing;
end $$;

-- 应用读取原截图：只给它负责的分类里某个心愿用到的图
create or replace function public.mc_agent_get_image(p_token text, p_id text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_cats text[] := public.mc_app_categories(public.mc_agent_check(p_token));
begin
  if not exists (select 1 from public.items i
                 where i.data->>'category' = any(v_cats) and coalesce(i.data->'shots', '[]'::jsonb) ? p_id) then
    return null;
  end if;
  return (select m.data from public.mc_images m where m.id = p_id);
end $$;

revoke execute on function public.mc_agent_put_image(text, text, text) from public;
revoke execute on function public.mc_agent_get_image(text, text)       from public;
grant  execute on function public.mc_agent_put_image(text, text, text) to anon, authenticated;
grant  execute on function public.mc_agent_get_image(text, text)       to anon, authenticated;

insert into public.mc_migrations (name) values ('003_shots') on conflict (name) do nothing;
