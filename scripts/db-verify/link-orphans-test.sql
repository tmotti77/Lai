\set ON_ERROR_STOP 1
-- Seeds orphan scenarios. Run BEFORE the migration. Then check with link-orphans-check.sql.
create schema if not exists testkit;
create or replace function testkit.u(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid $$;
insert into public.users(id) select testkit.u(n) from generate_series(1,6) n;
-- conversations: user1..5 have two (older c_old, latest c_new); user6 none
insert into public.conversations(id,user_id,updated_at)
  select testkit.u(100+n), testkit.u(n), now()-interval '2 day' from generate_series(1,5) n
  union all select testkit.u(200+n), testkit.u(n), now()-interval '1 day' from generate_series(1,5) n;
-- u1: PROD CASE: linked row at latest conv + orphan
insert into public.career_profile(id,user_id,conversation_id,data,updated_at) values
 (testkit.u(1001),testkit.u(1),testkit.u(201),'{"skills":[{"id":"a"}]}', now()-interval '3 hour'),
 (testkit.u(1002),testkit.u(1),null,'{"skills":[{"id":"cv"}]}', now()-interval '2 hour');
-- u2: single orphan only -> must be linked
insert into public.career_profile(id,user_id,conversation_id,data,updated_at) values (testkit.u(2001),testkit.u(2),null,'{"skills":[{"id":"x"}]}', now()-interval '5 hour');
-- u3: two orphans, no linked row -> newest linked, other left
insert into public.career_profile(id,user_id,conversation_id,data,updated_at) values
 (testkit.u(3001),testkit.u(3),null,'{"n":1}', now()-interval '5 hour'),
 (testkit.u(3002),testkit.u(3),null,'{"n":2}', now()-interval '4 hour');
-- u4: row at OLDER conv (newest overall) + orphan -> orphan linked to latest, updated_at preserved
insert into public.career_profile(id,user_id,conversation_id,data,updated_at) values
 (testkit.u(4001),testkit.u(4),testkit.u(104),'{"n":"old"}', now()-interval '1 hour'),
 (testkit.u(4002),testkit.u(4),null,'{"n":"orph"}', now()-interval '6 hour');
-- u5: linked only; u6: orphan but no conversations
insert into public.career_profile(id,user_id,conversation_id,data) values (testkit.u(5001),testkit.u(5),testkit.u(205),'{}');
insert into public.users(id) values (testkit.u(7)) on conflict do nothing;
insert into public.career_profile(id,user_id,conversation_id,data) values (testkit.u(6001),testkit.u(6),null,'{}');
create table testkit.before as select id,user_id,conversation_id,data,updated_at from public.career_profile;
