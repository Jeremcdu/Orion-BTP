-- Live Postgres authorization/CAS tests. All fixtures are rolled back.
begin;
insert into auth.users (id, email, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
 ('0b19a915-e43d-441b-a35f-cf480ee40261','orion-qa-a@example.invalid',now(),now(),now(),'{}','{}'),
 ('0b19a915-e43d-441b-a35f-cf480ee40262','orion-qa-b@example.invalid',now(),now(),now(),'{}','{}');
insert into public.orion_module_access(user_id,module,allowed)
values ('0b19a915-e43d-441b-a35f-cf480ee40261','m78',true),('0b19a915-e43d-441b-a35f-cf480ee40262','m43',true)
on conflict(user_id,module) do update set allowed=true;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"0b19a915-e43d-441b-a35f-cf480ee40261","role":"authenticated","aal":"aal1"}',true);
do $$
declare result jsonb;
begin
 result:=public.orion_save_projects(0,'[{"id":"qa-project","name":"Recette A"}]');
 if result->>'saved'<>'true' or result->>'revision'<>'1' then raise exception 'Initial save failed'; end if;
 result:=public.orion_save_projects(1,'[{"id":"qa-project","name":"Recette A modifiée"}]');
 if result->>'saved'<>'true' or result->>'revision'<>'2' then raise exception 'Update failed'; end if;
 result:=public.orion_save_projects(1,'[{"id":"qa-project","name":"Écrasement interdit"}]');
 if result->>'saved'<>'false' then raise exception 'Stale revision accepted'; end if;
 if (select projects->0->>'name' from public.orion_project_state where user_id=auth.uid())<>'Recette A modifiée' then raise exception 'Stale save overwrote data'; end if;
 begin
  perform public.orion_save_projects(2,'[{"id":"same","name":"A"},{"id":"same","name":"B"}]');
  raise exception 'Duplicate identifiers accepted';
 exception when invalid_parameter_value then null; end;
 begin
  insert into public.orion_project_state(user_id,projects) values ('0b19a915-e43d-441b-a35f-cf480ee40262','[]');
  raise exception 'Cross-account insert accepted';
 exception when insufficient_privilege then null; end;
 insert into storage.objects(bucket_id,name) values ('orion-project-files',auth.uid()::text||'/qa-file');
 begin
  insert into storage.objects(bucket_id,name) values ('orion-project-files','0b19a915-e43d-441b-a35f-cf480ee40262/qa-forbidden');
  raise exception 'Cross-account file insert accepted';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims','{"sub":"0b19a915-e43d-441b-a35f-cf480ee40262","role":"authenticated","aal":"aal1"}',true);
do $$
begin
 if (select count(*) from public.orion_project_state)<>0 then raise exception 'Other account can read projects'; end if;
 if (select count(*) from storage.objects where bucket_id='orion-project-files')<>0 then raise exception 'Other account can read files'; end if;
 if (public.orion_save_projects(0,'[{"id":"qa-b","name":"Recette B"}]')->>'saved')<>'true' then raise exception 'Second account save failed'; end if;
end $$;
reset role;
update public.orion_profiles set enabled=false where id='0b19a915-e43d-441b-a35f-cf480ee40262';
set local role authenticated;
do $$
begin
 if (select count(*) from public.orion_project_state)<>0 then raise exception 'Disabled account can read projects'; end if;
 begin
  perform public.orion_save_projects(1,'[]');
  raise exception 'Disabled account can save projects';
 exception when insufficient_privilege then null; end;
end $$;
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
do $$
begin
 begin
  perform public.orion_save_projects(0,'[]');
  raise exception 'Anonymous RPC accepted';
 exception when insufficient_privilege then null; end;
 begin
  perform projects from public.orion_project_state;
  raise exception 'Anonymous table read accepted';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: create, update, stale revision, duplicate IDs, account isolation, private files, disabled account, anonymous access' as result;
rollback;
