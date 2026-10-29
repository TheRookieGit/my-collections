-- 005 删除已吊销的配对记录：只能删已经吊销的，正在用的设备要先吊销。在 004_foodcollection.sql 之后运行，可重复运行。
-- 已拥有记录（mc_fulfill）按应用记，不跟着配对删除。

create or replace function public.mc_agent_delete(p_pass text, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.mc_check(p_pass);
  delete from public.mc_agents a where a.id = p_id and a.revoked;
end $$;

revoke execute on function public.mc_agent_delete(text, uuid) from public;
grant  execute on function public.mc_agent_delete(text, uuid) to anon, authenticated;

insert into public.mc_migrations (name) values ('005_agent_delete') on conflict (name) do nothing;
