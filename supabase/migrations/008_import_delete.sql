-- 008 批量删除截图导入记录。只删记录，收藏和小票不受影响。
-- 在 007_import_log.sql 之后运行，可重复运行。说明见 supabase/README.md。

create or replace function public.mc_import_delete(p_pass text, p_ids text[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.mc_check(p_pass);
  delete from public.mc_imports i where i.id = any(p_ids);
end $$;

revoke execute on function public.mc_import_delete(text, text[]) from public;
grant  execute on function public.mc_import_delete(text, text[]) to anon, authenticated;

insert into public.mc_migrations (name) values ('008_import_delete') on conflict (name) do nothing;
