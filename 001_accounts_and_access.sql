begin;
create schema if not exists orion_private;
revoke all on schema orion_private from public, anon, authenticated;

create table public.orion_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '' check (length(full_name) <= 160),
  profession text not null default '' check (length(profession) <= 100),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create table orion_private.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table public.orion_module_access (
  user_id uuid not null references public.orion_profiles(id) on delete cascade,
  module text not null check (module in ('m42','m43','m78')),
  allowed boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key(user_id,module)
);
create table orion_private.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  target_id uuid references auth.users(id) on delete set null,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
-- A protected API foundation for future module records. Existing local projects
-- are NOT silently copied into this table by this first accounts/access release.
create table public.orion_module_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  module text not null check(module in ('m42','m43','m78')),
  content jsonb not null default '{}'::jsonb check(jsonb_typeof(content)='object'),
  created_at timestamptz not null default now()
);

create function orion_private.on_signup() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.orion_profiles(id,full_name,profession)
  values(new.id,left(coalesce(new.raw_user_meta_data->>'full_name',''),160),left(coalesce(new.raw_user_meta_data->>'profession',''),100));
  insert into public.orion_module_access(user_id,module)
  select new.id,m from unnest(array['m42','m43','m78']) m;
  return new;
end;$$;
create trigger orion_signup after insert on auth.users for each row execute function orion_private.on_signup();
-- Also provision accounts created before installation.
insert into public.orion_profiles(id,full_name,profession)
select id,left(coalesce(raw_user_meta_data->>'full_name',''),160),left(coalesce(raw_user_meta_data->>'profession',''),100) from auth.users
on conflict(id) do nothing;
insert into public.orion_module_access(user_id,module)
select p.id,m from public.orion_profiles p cross join unnest(array['m42','m43','m78']) m on conflict do nothing;

create function orion_private.active_verified() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.orion_profiles p join auth.users u on u.id=p.id
 where p.id=auth.uid() and p.enabled and u.email_confirmed_at is not null);
$$;
create function orion_private.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from orion_private.admins where user_id=auth.uid());
$$;
create function orion_private.require_admin() returns void language plpgsql security definer set search_path='' as $$
begin
 if not orion_private.active_verified() or not orion_private.is_admin() or coalesce(auth.jwt()->>'aal','') <> 'aal2' then
   raise exception 'Administration refusée : compte administrateur actif et double authentification requis.' using errcode='42501';
 end if;
end;$$;
create function orion_private.can_use_module(p_module text) returns boolean language sql stable security definer set search_path='' as $$
 select p_module in ('m42','m43','m78') and orion_private.active_verified() and
 case when orion_private.is_admin() then coalesce(auth.jwt()->>'aal','')='aal2'
 else exists(select 1 from public.orion_module_access a where a.user_id=auth.uid() and a.module=p_module and a.allowed) end;
$$;

create function public.orion_my_access() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null then raise exception 'Connexion requise' using errcode='42501'; end if;
 select jsonb_build_object('user',jsonb_build_object('id',p.id,'email',u.email,'full_name',p.full_name,'profession',p.profession,'enabled',p.enabled,'email_verified',u.email_confirmed_at is not null),
 'is_admin',orion_private.is_admin(),'mfa_required',orion_private.is_admin() and coalesce(auth.jwt()->>'aal','')<>'aal2',
 'modules',jsonb_build_object('m42',orion_private.can_use_module('m42'),'m43',orion_private.can_use_module('m43'),'m78',orion_private.can_use_module('m78')))
 into result from public.orion_profiles p join auth.users u on u.id=p.id where p.id=auth.uid();
 if result is null then raise exception 'Profil introuvable' using errcode='42501'; end if;
 return result;
end;$$;
create function public.orion_require_module(p_module text) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(orion_private.can_use_module(p_module),false) then raise exception 'Accès au module refusé' using errcode='42501'; end if;
 return jsonb_build_object('allowed',true,'module',p_module,'user_id',auth.uid());
end;$$;
create function public.orion_admin_accounts(p_search text default '',p_page integer default 0,p_limit integer default 25)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare total bigint; rows jsonb; n integer:=least(greatest(coalesce(p_limit,25),1),100); q text:=left(coalesce(p_search,''),160);
begin
 perform orion_private.require_admin();
 select count(*) into total from public.orion_profiles p join auth.users u on u.id=p.id
 where q='' or position(lower(q) in lower(coalesce(u.email,'')||' '||p.full_name))>0;
 select coalesce(jsonb_agg(t),'[]'::jsonb) into rows from (
  select p.id,p.full_name,p.profession,p.enabled,p.created_at,u.email,(u.email_confirmed_at is not null) as email_verified,
  exists(select 1 from orion_private.admins a where a.user_id=p.id) as is_admin,
  (select coalesce(jsonb_object_agg(a.module,a.allowed),'{}'::jsonb) from public.orion_module_access a where a.user_id=p.id) as modules
  from public.orion_profiles p join auth.users u on u.id=p.id
  where q='' or position(lower(q) in lower(coalesce(u.email,'')||' '||p.full_name))>0
  order by p.created_at desc,p.id limit n offset greatest(coalesce(p_page,0),0)*n
 )t;
 return jsonb_build_object('total',total,'accounts',rows,'page',greatest(coalesce(p_page,0),0),'page_size',n);
end;$$;
create function public.orion_admin_set_module(p_user_id uuid,p_module text,p_allowed boolean)
returns void language plpgsql security definer set search_path='' as $$
declare previous boolean;
begin
 perform orion_private.require_admin();
 if p_module not in ('m42','m43','m78') or p_module is null or p_allowed is null then raise exception 'Paramètres invalides' using errcode='22023'; end if;
 if exists(select 1 from orion_private.admins where user_id=p_user_id) then raise exception 'Les accès administrateur dépendent de la double authentification.' using errcode='22023'; end if;
 select allowed into previous from public.orion_module_access where user_id=p_user_id and module=p_module for update;
 if not found then raise exception 'Compte introuvable' using errcode='22023'; end if;
 update public.orion_module_access set allowed=p_allowed,updated_by=auth.uid(),updated_at=now() where user_id=p_user_id and module=p_module;
 insert into orion_private.audit_events(actor_id,target_id,action,detail)
 values(auth.uid(),p_user_id,'module_access',jsonb_build_object('module',p_module,'before',previous,'after',p_allowed));
end;$$;
create function public.orion_admin_set_enabled(p_user_id uuid,p_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
declare previous boolean;
begin
 perform orion_private.require_admin();
 if p_enabled is null then raise exception 'Paramètres invalides' using errcode='22023'; end if;
 if exists(select 1 from orion_private.admins where user_id=p_user_id) then raise exception 'Un compte administrateur ne peut pas être suspendu depuis cette interface.' using errcode='22023'; end if;
 select enabled into previous from public.orion_profiles where id=p_user_id for update;
 if not found then raise exception 'Compte introuvable' using errcode='22023'; end if;
 update public.orion_profiles set enabled=p_enabled where id=p_user_id;
 insert into orion_private.audit_events(actor_id,target_id,action,detail)
 values(auth.uid(),p_user_id,'account_enabled',jsonb_build_object('before',previous,'after',p_enabled));
end;$$;
create function public.orion_admin_audit(p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform orion_private.require_admin();
 select coalesce(jsonb_agg(t),'[]'::jsonb) into result from(
 select e.id,e.action,e.detail,e.created_at,actor.email as actor_email,target.email as target_email
 from orion_private.audit_events e left join auth.users actor on actor.id=e.actor_id left join auth.users target on target.id=e.target_id
 order by e.id desc limit least(greatest(coalesce(p_limit,50),1),100)) t;
 return result;
end;$$;

alter table public.orion_profiles enable row level security;
alter table public.orion_module_access enable row level security;
alter table public.orion_module_records enable row level security;
alter table orion_private.admins enable row level security;
alter table orion_private.audit_events enable row level security;
revoke all on public.orion_profiles,public.orion_module_access,public.orion_module_records from public,anon,authenticated;
revoke all on all tables in schema orion_private from public,anon,authenticated;
revoke all on all sequences in schema orion_private from public,anon,authenticated;
grant select on public.orion_profiles,public.orion_module_access to authenticated;
grant select,insert,update,delete on public.orion_module_records to authenticated;
create policy profiles_self_read on public.orion_profiles for select to authenticated using(id=(select auth.uid()));
create policy access_self_read on public.orion_module_access for select to authenticated using(user_id=(select auth.uid()));
create policy records_select on public.orion_module_records for select to authenticated
using(user_id=(select auth.uid()) and orion_private.can_use_module(module));
create policy records_insert on public.orion_module_records for insert to authenticated
with check(user_id=(select auth.uid()) and orion_private.can_use_module(module));
create policy records_update on public.orion_module_records for update to authenticated
using(user_id=(select auth.uid()) and orion_private.can_use_module(module))
with check(user_id=(select auth.uid()) and orion_private.can_use_module(module));
create policy records_delete on public.orion_module_records for delete to authenticated
using(user_id=(select auth.uid()) and orion_private.can_use_module(module));
-- Nothing inherits PostgreSQL's default PUBLIC EXECUTE privilege.
revoke all on all functions in schema orion_private from public,anon,authenticated;
grant usage on schema orion_private to authenticated;
grant execute on function orion_private.can_use_module(text) to authenticated;
revoke all on function public.orion_my_access(),public.orion_require_module(text),public.orion_admin_accounts(text,integer,integer),public.orion_admin_set_module(uuid,text,boolean),public.orion_admin_set_enabled(uuid,boolean),public.orion_admin_audit(integer) from public,anon,authenticated;
grant execute on function public.orion_my_access(),public.orion_require_module(text),public.orion_admin_accounts(text,integer,integer),public.orion_admin_set_module(uuid,text,boolean),public.orion_admin_set_enabled(uuid,boolean),public.orion_admin_audit(integer) to authenticated;
commit;
