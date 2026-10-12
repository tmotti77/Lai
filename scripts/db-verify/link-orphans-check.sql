\set ON_ERROR_STOP 1
create or replace function testkit.cp(i int) returns record language sql as $$ select conversation_id, data, updated_at from public.career_profile where id=testkit.u(i) $$;
create temp table results as select t.name, coalesce(t.ok,false) as ok from (values
 ('u1 prod case: orphan skipped, left in place unchanged', (select conversation_id is null and data='{"skills":[{"id":"cv"}]}' from public.career_profile where id=testkit.u(1002))),
 ('u1 linked row untouched', (select (c.conversation_id,c.data,c.updated_at)=(b.conversation_id,b.data,b.updated_at) from public.career_profile c join testkit.before b using(id) where id=testkit.u(1001))),
 ('u2 single orphan linked to latest conv', (select conversation_id=testkit.u(202) from public.career_profile where id=testkit.u(2001))),
 ('u3 newest orphan linked, older left as orphan', (select (select conversation_id from public.career_profile where id=testkit.u(3002))=testkit.u(203) and (select conversation_id from public.career_profile where id=testkit.u(3001)) is null)),
 ('u4 orphan linked, updated_at preserved', (select c.conversation_id=testkit.u(204) and c.updated_at=b.updated_at from public.career_profile c join testkit.before b using(id) where id=testkit.u(4002))),
 ('no data column changed anywhere', (select bool_and(c.data=b.data) from public.career_profile c join testkit.before b using(id))),
 ('no rows lost or added', (select count(*) from public.career_profile)=(select count(*) from testkit.before)),
 ('u6 (no conversations) untouched', (select conversation_id is null from public.career_profile where id=testkit.u(6001))),
 ('trigger re-enabled', (select tgenabled='O' from pg_trigger where tgname='career_profile_set_updated_at'))
) t(name, ok);
select name, case when ok then 'PASS' else 'FAIL' end as result from results;
do $$ begin if exists (select 1 from results where not ok) then raise exception 'link_orphan_profiles checks FAILED'; end if; end $$;
