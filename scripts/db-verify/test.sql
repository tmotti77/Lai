\set ON_ERROR_STOP 1
create schema testkit;
-- Seed every user-linked table for two users (A, B).
create or replace function testkit.seed(uid uuid, aid uuid) returns void language plpgsql as $$
declare c uuid; r uuid; p uuid; s uuid;
begin
  insert into auth.users(id) values (aid);
  insert into public.users(id, auth_id, email) values (uid, aid, uid::text||'@x');
  insert into public.anonymous_sessions(token, user_id) values ('tok-'||uid, uid);
  insert into public.consents(user_id, purpose, version) values (uid,'processing','1');
  insert into public.conversations(user_id) values (uid) returning id into c;
  insert into public.messages(conversation_id, role, content) values (c,'user','hi'),(c,'assistant','yo');
  insert into public.career_profile(user_id, conversation_id) values (uid, c);
  insert into public.career_profile(user_id) values (uid); -- orphan (conversation_id null)
  insert into public.assessments(user_id,type,responses,scores,items_version) values (uid,(enum_range(null::assessment_type))[1],'{}','{}',1);
  insert into public.recommendations(user_id,profile_hash,rankings,paths,prose) values (uid,'h','[]','[]','{}') returning id into r;
  insert into public.plans(user_id,recommendation_id,archetype) values (uid,r,(enum_range(null::plan_archetype))[1]) returning id into p;
  insert into public.plan_tasks(plan_id,day,title_he,description_he,category,estimated_minutes) values (p,1,'t','d',(enum_range(null::plan_task_category))[1],10);
  insert into public.cv_uploads(user_id,storage_path,original_filename,mime_type,size_bytes) values (uid,uid||'/cv.pdf','cv.pdf','application/pdf',1);
  insert into public.interview_sessions(user_id,persona,target_role_he) values (uid,'hr','r') returning id into s;
  insert into public.interview_messages(session_id,role,content) values (s,'user','q');
  insert into public.feedback(user_id,surface,nps_score,nps_trigger) values (uid,'nps',9,'pdf_download');
  insert into public.feedback(user_id,surface,target_type,target_id,thumbs_value) values (uid,'chat','message','m1',1);
end $$;
select testkit.seed('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000000a1');
select testkit.seed('bbbbbbbb-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-0000000000b2');

-- count rows reachable from a user, per table
create or replace function testkit.counts(uid uuid) returns jsonb language sql as $$
 select jsonb_build_object(
  'users',(select count(*) from users where id=uid),
  'anonymous_sessions',(select count(*) from anonymous_sessions where user_id=uid),
  'consents',(select count(*) from consents where user_id=uid),
  'conversations',(select count(*) from conversations where user_id=uid),
  'messages',(select count(*) from messages m join conversations c on c.id=m.conversation_id where c.user_id=uid),
  'career_profile',(select count(*) from career_profile where user_id=uid),
  'assessments',(select count(*) from assessments where user_id=uid),
  'recommendations',(select count(*) from recommendations where user_id=uid),
  'plans',(select count(*) from plans where user_id=uid),
  'plan_tasks',(select count(*) from plan_tasks t join plans p on p.id=t.plan_id where p.user_id=uid),
  'cv_uploads',(select count(*) from cv_uploads where user_id=uid),
  'interview_sessions',(select count(*) from interview_sessions where user_id=uid),
  'interview_messages',(select count(*) from interview_messages m join interview_sessions s on s.id=m.session_id where s.user_id=uid),
  'feedback',(select count(*) from feedback where user_id=uid)) $$;
\echo == coverage: public tables with user_id/FK to users not in counts()
select string_agg(distinct conrelid::regclass::text, ',') from pg_constraint where contype='f' and connamespace='public'::regnamespace;

\echo == before
select testkit.counts('aaaaaaaa-0000-0000-0000-000000000001') a, testkit.counts('bbbbbbbb-0000-0000-0000-000000000002') b \gset
\echo A :a
\echo B :b

\echo == CHECK rollback: inject failure in the middle (trigger on users delete), call as service_role
create or replace function testkit.boom() returns trigger language plpgsql as $$ begin raise exception 'injected failure'; end $$;
create trigger boom before delete on public.users for each row execute function testkit.boom();
grant usage on schema testkit to service_role; grant execute on all functions in schema testkit to service_role;
\set ON_ERROR_STOP 0
set role service_role;
select public.delete_user_data('aaaaaaaa-0000-0000-0000-000000000001');
reset role;
\set ON_ERROR_STOP 1
drop trigger boom on public.users;
select case when testkit.counts('aaaaaaaa-0000-0000-0000-000000000001')::text = :'a' then 'PASS rollback: A fully intact after mid-function error' else 'FAIL rollback' end;

\echo == CHECK grants
select r, has_function_privilege(r,'public.delete_user_data(uuid)','execute') from unnest(array['anon','authenticated','service_role']) r;
select 'PUBLIC has execute: '|| exists(select 1 from pg_proc p, aclexplode(p.proacl) x where p.proname='delete_user_data' and x.grantee=0);
\set ON_ERROR_STOP 0
set role anon; select public.delete_user_data('bbbbbbbb-0000-0000-0000-000000000002'); reset role;
set role authenticated; select public.delete_user_data('bbbbbbbb-0000-0000-0000-000000000002'); reset role;
\set ON_ERROR_STOP 1

\echo == CHECK delete A as service_role
set role service_role;
select public.delete_user_data('aaaaaaaa-0000-0000-0000-000000000001') as report;
reset role;
select 'A after: '||testkit.counts('aaaaaaaa-0000-0000-0000-000000000001')::text;
select case when testkit.counts('bbbbbbbb-0000-0000-0000-000000000002')::text = :'b' then 'PASS isolation: B intact' else 'FAIL isolation: B changed' end;
select 'auth.users A still present (expected; app deletes via auth admin API): '||exists(select 1 from auth.users where id='aaaaaaaa-0000-0000-0000-0000000000a1');

\echo == CHECK idempotent: second call
set role service_role;
select public.delete_user_data('aaaaaaaa-0000-0000-0000-000000000001') as report2;
select public.delete_user_data('00000000-0000-0000-0000-000000000000') as unknown_user;
reset role;
