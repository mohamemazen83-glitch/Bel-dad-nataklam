-- بالضاد نتكلم — إعداد قاعدة البيانات الكامل. نفّذه مرة واحدة في Supabase SQL Editor.
-- Run once in the Supabase SQL Editor. Uses lectures/lecture_admins/lecture-media names so it never collides with other tables in the project.
create table if not exists public.lecture_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);

create table if not exists public.lectures (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  media_url text not null default '',
  media_type text not null default 'audio' check (media_type in ('audio','video')),
  questions jsonb not null default '[]'::jsonb,
  week integer not null default 1 check (week >= 1 and week <= 100),
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.is_lecture_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.lecture_admins where user_id = auth.uid()) $$;

alter table public.lecture_admins enable row level security;
alter table public.lectures enable row level security;
revoke all on public.lecture_admins from anon, authenticated;
grant select on public.lecture_admins to authenticated;
grant select, insert, update, delete on public.lectures to anon, authenticated;

drop policy if exists "lecture admin sees own membership" on public.lecture_admins;
create policy "lecture admin sees own membership" on public.lecture_admins
for select to authenticated using (user_id = auth.uid());

drop policy if exists "anyone reads published lectures" on public.lectures;
create policy "anyone reads published lectures" on public.lectures
for select to anon, authenticated using (published = true or public.is_lecture_admin());
drop policy if exists "lecture admins add lectures" on public.lectures;
create policy "lecture admins add lectures" on public.lectures
for insert to authenticated with check (public.is_lecture_admin());
drop policy if exists "lecture admins edit lectures" on public.lectures;
create policy "lecture admins edit lectures" on public.lectures
for update to authenticated using (public.is_lecture_admin()) with check (public.is_lecture_admin());
drop policy if exists "lecture admins delete lectures" on public.lectures;
create policy "lecture admins delete lectures" on public.lectures
for delete to authenticated using (public.is_lecture_admin());

-- Public bucket: published lesson audio/video can be played without signing in.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lecture-media', 'lecture-media', true, 104857600,
  array['audio/mpeg','audio/mp4','audio/aac','audio/ogg','audio/wav','video/mp4','video/webm','video/quicktime'])
on conflict (id) do update set public = true, file_size_limit = 104857600;

drop policy if exists "anyone plays lecture media" on storage.objects;
create policy "anyone plays lecture media" on storage.objects
for select to anon, authenticated using (bucket_id = 'lecture-media');
drop policy if exists "lecture admins upload media" on storage.objects;
create policy "lecture admins upload media" on storage.objects
for insert to authenticated with check (bucket_id = 'lecture-media' and public.is_lecture_admin());
drop policy if exists "lecture admins update media" on storage.objects;
create policy "lecture admins update media" on storage.objects
for update to authenticated using (bucket_id = 'lecture-media' and public.is_lecture_admin())
with check (bucket_id = 'lecture-media' and public.is_lecture_admin());
drop policy if exists "lecture admins delete media" on storage.objects;
create policy "lecture admins delete media" on storage.objects
for delete to authenticated using (bucket_id = 'lecture-media' and public.is_lecture_admin());

-- After creating the teacher account in Supabase Authentication > Users, copy its UUID
-- and run: insert into public.lecture_admins (user_id) values ('TEACHER-USER-UUID');

-- Phone-number accounts (no SMS, no email): creates a confirmed auth user whose login id is
-- <digits>@phone.bildad.app. Called by the app before signing in with the same credentials.
create or replace function public.signup_with_phone(p_name text, p_phone text, p_password text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text := btrim(coalesce(p_phone, ''));
  v_name text := left(btrim(coalesce(p_name, '')), 60);
  v_email text;
  v_id uuid := gen_random_uuid();
begin
  if v_phone !~ '^\+[0-9]{8,15}$' then raise exception 'invalid_phone'; end if;
  if length(coalesce(p_password, '')) < 6 or length(p_password) > 72 then raise exception 'weak_password'; end if;
  if v_name = '' then raise exception 'name_required'; end if;
  v_email := substr(v_phone, 2) || '@phone.bildad.app';
  if exists (select 1 from auth.users where email = v_email) then raise exception 'phone_exists'; end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_password, extensions.gen_salt('bf', 10)), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', v_name, 'phone', v_phone, 'email_verified', true),
    now(), now(), '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text, 'email',
    jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
    now(), now(), now());
  return json_build_object('ok', true);
end;
$$;
revoke all on function public.signup_with_phone(text, text, text) from public;
grant execute on function public.signup_with_phone(text, text, text) to anon, authenticated;

-- Profile pictures: public bucket, each user may only write inside their own folder (<user_id>/avatar.jpg).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
drop policy if exists "avatars own read" on storage.objects;
create policy "avatars own read" on storage.objects for select to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatars own insert" on storage.objects;
create policy "avatars own insert" on storage.objects for insert to authenticated
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatars own update" on storage.objects;
create policy "avatars own update" on storage.objects for update to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatars own delete" on storage.objects;
create policy "avatars own delete" on storage.objects for delete to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Announcements written by the teacher (shown in the in-app bell + Android system notifications).
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  body text not null default '' check (char_length(body) <= 1000),
  created_at timestamptz not null default now()
);
alter table public.announcements enable row level security;
grant select on public.announcements to anon, authenticated;
grant insert, delete on public.announcements to authenticated;
drop policy if exists "anyone reads announcements" on public.announcements;
create policy "anyone reads announcements" on public.announcements for select to anon, authenticated using (true);
drop policy if exists "admins add announcements" on public.announcements;
create policy "admins add announcements" on public.announcements for insert to authenticated with check (public.is_lecture_admin());
drop policy if exists "admins delete announcements" on public.announcements;
create policy "admins delete announcements" on public.announcements for delete to authenticated using (public.is_lecture_admin());
create index if not exists announcements_created_idx on public.announcements (created_at desc);

-- Quiz results: each student inserts their own; students read their own, teachers read all.
create table if not exists public.quiz_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  user_name text not null default '',
  user_contact text not null default '',
  scope text not null default 'all' check (scope in ('lecture','week','all')),
  label text not null default '',
  week integer,
  lecture_id uuid,
  correct integer not null check (correct >= 0),
  total integer not null check (total > 0),
  created_at timestamptz not null default now(),
  check (correct <= total)
);
alter table public.quiz_results enable row level security;
grant select, insert on public.quiz_results to authenticated;
drop policy if exists "students add own results" on public.quiz_results;
create policy "students add own results" on public.quiz_results for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "read own results or admin" on public.quiz_results;
create policy "read own results or admin" on public.quiz_results for select to authenticated using (user_id = auth.uid() or public.is_lecture_admin());
create index if not exists quiz_results_user_idx on public.quiz_results (user_id, created_at desc);

-- Teacher-only student overview (name, phone/email, attempts, average, best).
create or replace function public.admin_students()
returns table(uid uuid, name text, contact text, joined_at timestamptz, last_login timestamptz, attempts bigint, avg_pct numeric, best_pct numeric, last_attempt timestamptz)
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_lecture_admin() then raise exception 'not_admin'; end if;
  return query
  select u.id,
    coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), 'بدون اسم')::text,
    (case when u.email like '%@phone.bildad.app' then coalesce(u.raw_user_meta_data ->> 'phone', '+' || split_part(u.email, '@', 1)) else coalesce(u.email, u.phone) end)::text,
    u.created_at, u.last_sign_in_at,
    count(r.id),
    round(avg(r.correct * 100.0 / r.total), 1),
    max(round(r.correct * 100.0 / r.total, 1)),
    max(r.created_at)
  from auth.users u
  left join public.quiz_results r on r.user_id = u.id
  where not exists (select 1 from public.lecture_admins a where a.user_id = u.id)
  group by u.id
  order by max(r.created_at) desc nulls last, u.created_at desc;
end;
$$;
revoke all on function public.admin_students() from public, anon;
grant execute on function public.admin_students() to authenticated;

-- Optional PDF attached to a lecture (uploaded to the lecture-media bucket).
alter table public.lectures add column if not exists pdf_url text not null default '';
update storage.buckets set allowed_mime_types = (select array(select distinct unnest(allowed_mime_types || array['application/pdf']))) where id = 'lecture-media';

-- ===== أسئلة مقالية: إجابات الطلاب والتصحيح =====
create table if not exists public.essay_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  user_name text not null default '', user_contact text not null default '',
  lecture_id text not null, lecture_title text not null default '', week int,
  question_index int not null default 0, question_text text not null, answer_text text not null,
  points int not null default 10, status text not null default 'pending',
  score int, feedback text, created_at timestamptz not null default now(), graded_at timestamptz,
  constraint essay_answers_one_per_question unique (user_id, lecture_id, question_index),
  constraint essay_answers_status_chk check (status in ('pending','graded')),
  constraint essay_answers_score_chk check (score is null or (score >= 0 and score <= points))
);
alter table public.essay_answers enable row level security;
drop policy if exists "own or admin read essays" on public.essay_answers;
create policy "own or admin read essays" on public.essay_answers for select to authenticated
using (user_id = auth.uid() or public.is_lecture_admin());
drop policy if exists "students add own essays" on public.essay_answers;
create policy "students add own essays" on public.essay_answers for insert to authenticated
with check (user_id = auth.uid() and status = 'pending' and score is null and graded_at is null);
drop policy if exists "admin grades essays" on public.essay_answers;
create policy "admin grades essays" on public.essay_answers for update to authenticated
using (public.is_lecture_admin()) with check (public.is_lecture_admin());
create index if not exists essay_answers_status_idx on public.essay_answers (status, created_at);
create index if not exists lectures_week_idx on public.lectures (week, created_at);

-- ===== محتوى تجريبي لكورس اللغة العربية (احذفه من لوحة الإدارة متى شئت) =====
insert into public.lectures (title, description, week, published, questions)
select * from (values
 ('أقسام الكلام: الاسم والفعل والحرف', 'تعرّف على أقسام الكلمة في العربية وكيف تميّز بينها.', 1, true, '[
  {"type":"mcq","text":"أي الكلمات التالية فعل؟","options":["كتابٌ","يكتبُ","في","مدرسة"],"answer":1,"explanation":"يكتب فعل مضارع لأنه يدل على حدث مرتبط بزمن.","points":10},
  {"type":"mcq","text":"كلمة «في» تُعرب من أقسام الكلام:","options":["اسم","فعل","حرف","ضمير"],"answer":2,"explanation":"«في» حرف جر.","points":10},
  {"type":"essay","text":"اذكر ثلاثة أمثلة على الأسماء وثلاثة على الأفعال.","options":[],"answer":0,"explanation":"أمثلة صحيحة مثل: قلم، بيت، علم / كتب، قرأ، يذهب.","points":10}
 ]'::jsonb),
 ('الجملة الاسمية والجملة الفعلية', 'الفرق بين المبتدأ والخبر وبين الفعل والفاعل.', 1, true, '[
  {"type":"mcq","text":"الجملة «العلمُ نورٌ» جملة:","options":["اسمية","فعلية","شبه جملة","شرطية"],"answer":0,"explanation":"تبدأ باسم (العلم) فهي اسمية.","points":10},
  {"type":"mcq","text":"الجملة «يقرأ الطالبُ الدرسَ» جملة:","options":["اسمية","فعلية","استفهامية","نفي"],"answer":1,"explanation":"تبدأ بفعل (يقرأ) فهي فعلية.","points":10}
 ]'::jsonb),
 ('الإملاء: الهمزة المتوسطة', 'قواعد كتابة الهمزة في وسط الكلمة.', 2, true, '[
  {"type":"mcq","text":"أيّ الكلمات كُتبت همزتها صحيحة؟","options":["مسئول","مسؤول","مسءول","مسوول"],"answer":1,"explanation":"الضمة أقوى من الفتحة فتُكتب الهمزة على واو: مسؤول.","points":10}
 ]'::jsonb)
) as v(title, description, week, published, questions)
where not exists (select 1 from public.lectures);

-- ===== بعد إنشاء حساب المشرف من التطبيق (أو من Authentication > Users) =====
-- اجعل حسابك مشرفًا بالبريد (غيّر البريد ثم نفّذ):
-- insert into public.lecture_admins (user_id) select id from auth.users where email = 'YOUR-EMAIL@example.com';
