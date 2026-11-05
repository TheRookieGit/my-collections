-- 007 截图导入记录：每次导入上传了几张、几张存了下来，所有设备看到的一样。
-- 在 006_clipcollections.sql 之后运行，可重复运行。说明见 supabase/README.md。

create table if not exists public.mc_imports (
  id       text        primary key,
  at       timestamptz not null,
  uploaded int         not null check (uploaded between 1 and 1000),
  accepted int         not null default 0,
  check (accepted between 0 and uploaded)
);
create index if not exists mc_imports_at on public.mc_imports (at desc);
alter table public.mc_imports enable row level security;
revoke all on public.mc_imports from anon, authenticated;

-- 网页开始识别时记一条，保存后用同一个 id 更新；未保存的张数 = uploaded - accepted，不单独存
create or replace function public.mc_import_put(p_pass text, p_rows jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.mc_check(p_pass);
  insert into public.mc_imports (id, at, uploaded, accepted)
  select r->>'id', (r->>'at')::timestamptz, (r->>'uploaded')::int, (r->>'accepted')::int
  from jsonb_array_elements(p_rows) r
  on conflict (id) do update set accepted = greatest(public.mc_imports.accepted, excluded.accepted);
end $$;

create or replace function public.mc_import_list(p_pass text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public.mc_check(p_pass);
  return coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'at', i.at, 'uploaded', i.uploaded, 'accepted', i.accepted) order by i.at desc)
                   from public.mc_imports i), '[]'::jsonb);
end $$;

revoke execute on function public.mc_import_put(text, jsonb) from public;
revoke execute on function public.mc_import_list(text)       from public;
grant  execute on function public.mc_import_put(text, jsonb) to anon, authenticated;
grant  execute on function public.mc_import_list(text)       to anon, authenticated;

insert into public.mc_migrations (name) values ('007_import_log') on conflict (name) do nothing;
