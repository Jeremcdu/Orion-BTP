-- Additive schema for per-account projects; existing profiles/access/records are preserved.
create table public.orion_project_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  projects jsonb not null default '[]'::jsonb,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  constraint orion_projects_array check (jsonb_typeof(projects) = 'array')
);
alter table public.orion_project_state enable row level security;
revoke all on public.orion_project_state from anon;
grant select, insert, update on public.orion_project_state to authenticated;

create policy projects_read on public.orion_project_state for select to authenticated
using (user_id = (select auth.uid()) and
  (orion_private.can_use_module('m42') or orion_private.can_use_module('m43') or orion_private.can_use_module('m78')));
create policy projects_insert on public.orion_project_state for insert to authenticated
with check (user_id = (select auth.uid()) and
  (orion_private.can_use_module('m42') or orion_private.can_use_module('m43') or orion_private.can_use_module('m78')));
create policy projects_update on public.orion_project_state for update to authenticated
using (user_id = (select auth.uid()) and
  (orion_private.can_use_module('m42') or orion_private.can_use_module('m43') or orion_private.can_use_module('m78')))
with check (user_id = (select auth.uid()) and
  (orion_private.can_use_module('m42') or orion_private.can_use_module('m43') or orion_private.can_use_module('m78')));

create function public.orion_save_projects(p_expected_revision bigint, p_projects jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare next_revision bigint;
begin
  if auth.uid() is null or not coalesce(
    orion_private.can_use_module('m42') or orion_private.can_use_module('m43') or orion_private.can_use_module('m78'), false)
  then raise exception 'Accès aux projets refusé' using errcode = '42501'; end if;
  if p_expected_revision is null or p_expected_revision < 0 or p_projects is null
     or jsonb_typeof(p_projects) <> 'array' then
    raise exception 'Sauvegarde invalide' using errcode = '22023';
  end if;
  if jsonb_array_length(p_projects) > 2000 or octet_length(p_projects::text) > 52428800 then
    raise exception 'Sauvegarde trop volumineuse' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_projects) p where jsonb_typeof(p) <> 'object'
    or jsonb_typeof(p->'id') is distinct from 'string' or coalesce(p->>'id','') = ''
    or jsonb_typeof(p->'name') is distinct from 'string' or btrim(coalesce(p->>'name','')) = '')
    or (select count(*) from jsonb_array_elements(p_projects)) <>
       (select count(distinct p->>'id') from jsonb_array_elements(p_projects) p) then
    raise exception 'Projet invalide ou identifiant dupliqué' using errcode = '22023';
  end if;
  if p_expected_revision = 0 then
    insert into public.orion_project_state (user_id, projects, revision)
    values (auth.uid(), p_projects, 1) on conflict (user_id) do nothing
    returning revision into next_revision;
  else
    update public.orion_project_state set projects = p_projects, revision = revision + 1, updated_at = now()
    where user_id = auth.uid() and revision = p_expected_revision
    returning revision into next_revision;
  end if;
  return jsonb_build_object('saved', next_revision is not null, 'revision', next_revision);
end;
$$;
revoke all on function public.orion_save_projects(bigint,jsonb) from public, anon;
grant execute on function public.orion_save_projects(bigint,jsonb) to authenticated;

insert into storage.buckets (id,name,public,file_size_limit)
values ('orion-project-files','orion-project-files',false,52428800);
create policy orion_files_read on storage.objects for select to authenticated
using (bucket_id = 'orion-project-files' and (storage.foldername(name))[1] = (select auth.uid()::text) and
  (orion_private.can_use_module('m42') or orion_private.can_use_module('m43') or orion_private.can_use_module('m78')));
create policy orion_files_insert on storage.objects for insert to authenticated
with check (bucket_id = 'orion-project-files' and (storage.foldername(name))[1] = (select auth.uid()::text) and
  (orion_private.can_use_module('m42') or orion_private.can_use_module('m43') or orion_private.can_use_module('m78')));
-- Files use immutable identifiers; no overwrite/delete privilege is required by the client.
