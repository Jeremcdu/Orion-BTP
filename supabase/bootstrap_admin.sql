-- Run ONLY in Supabase SQL Editor, after creating and verifying YOUR account.
-- Replace the UUID below with your Authentication > Users account ID.
-- This file contains no password and must never be callable from a browser.
do $$
declare target uuid := '00000000-0000-0000-0000-000000000000';
begin
 if target='00000000-0000-0000-0000-000000000000' then raise exception 'Remplacez le UUID par celui de votre compte.'; end if;
 if not exists(select 1 from auth.users where id=target and email_confirmed_at is not null) then raise exception 'Compte absent ou adresse non confirmée.'; end if;
 insert into orion_private.admins(user_id) values(target) on conflict do nothing;
 insert into orion_private.audit_events(actor_id,target_id,action) values(target,target,'admin_bootstrap_sql');
end;$$;
