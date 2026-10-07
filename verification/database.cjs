const {PGlite}=require('@electric-sql/pglite');
const fs=require('fs'),assert=require('assert/strict');
(async()=>{
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;create function auth.jwt() returns jsonb language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb$$;grant usage on schema public,auth to anon,authenticated;grant execute on all functions in schema auth to anon,authenticated;`);
await db.exec(fs.readFileSync('supabase/migrations/001_accounts_and_access.sql','utf8'));
const admin='00000000-0000-0000-0000-000000000001',alice='00000000-0000-0000-0000-000000000002',bob='00000000-0000-0000-0000-000000000003';
await db.query(`insert into auth.users values ($1,'admin@test.fr','{}',now()),($2,'alice@test.fr','{"is_admin":true,"role":"admin","full_name":"Alice"}',now()),($3,'bob@test.fr','{}',null)`,[admin,alice,bob]);
await db.query('insert into orion_private.admins(user_id) values($1)',[admin]);
async function as(id,aal='aal1',role='authenticated'){await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,aal})]);await db.exec('set role '+role);}
async function rpc(name,args=''){return (await db.query(`select public.${name}(${args}) as result`)).rows[0].result;}
let tests=0;async function denied(sql){await assert.rejects(()=>db.query(sql));tests++;}
await as(alice);let a=await rpc('orion_my_access');assert.equal(a.is_admin,false);assert.deepEqual(a.modules,{m42:false,m43:false,m78:false});tests++;
await denied('select public.orion_admin_accounts()');await denied("update public.orion_module_access set allowed=true");await denied('update public.orion_profiles set enabled=true');await denied(`insert into orion_private.admins(user_id) values('${alice}')`);await denied("select public.orion_require_module('m42')");
assert.equal((await db.query('select * from public.orion_profiles')).rows.length,1);tests++;
await as(admin);await denied('select public.orion_admin_accounts()');await denied(`select public.orion_admin_set_module('${alice}','m42',true)`);
await as(admin,'aal2');assert.equal((await rpc('orion_admin_accounts')).total,3);tests++;
await rpc('orion_admin_set_module',`'${alice}','m42',true`);await rpc('orion_admin_set_module',`'${bob}','m42',true`);
await denied(`select public.orion_admin_set_enabled('${admin}',false)`);
await as(bob);await denied("select public.orion_require_module('m42')");
await as(alice);assert.equal((await rpc('orion_require_module',"'m42'")).allowed,true);tests++;
await db.exec("insert into public.orion_module_records(module,content) values('m42','{}')");tests++;
await denied("insert into public.orion_module_records(module) values('m78')");await denied(`insert into public.orion_module_records(user_id,module) values('${bob}','m42')`);await denied(`update public.orion_module_records set user_id='${bob}'`);await denied("update public.orion_module_records set module='m78'");
await as(admin,'aal2');await rpc('orion_admin_set_module',`'${alice}','m42',false`);
await as(alice);await denied("select public.orion_require_module('m42')");assert.equal((await db.query('select * from public.orion_module_records')).rows.length,0);tests++;
await as(admin,'aal2');await rpc('orion_admin_set_module',`'${alice}','m42',true`);await rpc('orion_admin_set_enabled',`'${alice}',false`);
assert.equal((await rpc('orion_admin_audit')).length,5);tests++;
await denied('delete from orion_private.audit_events');await as(alice);await denied("select public.orion_require_module('m42')");
await as(null,'aal1','anon');await denied('select public.orion_my_access()');await denied('select * from public.orion_profiles');
console.log('PASS '+tests+' contrôles PostgreSQL : droits, MFA, RLS, isolation, révocation, suspension, audit.');await db.close();
})().catch(e=>{console.error(e);process.exit(1)});
