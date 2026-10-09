-- =========================================================================
-- PARTNERS IN PROGRESS — SUPABASE DATABASE SCHEMA
-- =========================================================================
-- Run this whole file once in your Supabase project's SQL Editor
-- (Project → SQL Editor → New query → paste → Run).
--
-- This creates every table, helper function, and Row Level Security (RLS)
-- policy the app needs. The frontend is NEVER trusted to decide who is an
-- admin or who is approved — that is enforced here, in the database.
-- =========================================================================

create extension if not exists "pgcrypto"; -- gives us gen_random_uuid()

-- -------------------------------------------------------------------------
-- 1. PROFILES
-- One row per student/admin, keyed to Supabase Auth's auth.users.id
-- -------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  name          text not null,
  email         text not null,
  school        text not null,
  class         text not null,
  marks         text,                       -- never shown publicly
  avatar_url    text,                       -- public URL in the 'avatars' storage bucket, or null
  role          text not null default 'student' check (role in ('student', 'admin')),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'suspended')),
  created_at    timestamptz not null default now()
);

-- Safe to re-run: adds avatar_url to a profiles table created before this
-- column existed, without touching any other data.
alter table public.profiles add column if not exists avatar_url text;

-- -------------------------------------------------------------------------
-- 2. POSTS  (short study statuses)
-- -------------------------------------------------------------------------
create table if not exists public.posts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  message       text not null check (char_length(message) <= 180),
  status_type   text not null default 'custom',
  removed       boolean not null default false,
  created_at    timestamptz not null default now()
);

-- -------------------------------------------------------------------------
-- 3. REACTIONS
-- -------------------------------------------------------------------------
create table if not exists public.reactions (
  id            uuid primary key default gen_random_uuid(),
  post_id       uuid not null references public.posts(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  reaction_type text not null check (reaction_type in ('heart','fire','salute','books','cry','target')),
  created_at    timestamptz not null default now(),
  unique (post_id, user_id, reaction_type)
);

-- -------------------------------------------------------------------------
-- 4. FOCUS SESSIONS
-- -------------------------------------------------------------------------
create table if not exists public.focus_sessions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles(id) on delete cascade,
  subject             text not null,
  goal                text,
  duration_minutes    integer not null check (duration_minutes > 0 and duration_minutes <= 240),
  started_at          timestamptz not null default now(),
  ended_at            timestamptz,
  completed           boolean not null default false,
  terminated_by_admin boolean not null default false
);

-- -------------------------------------------------------------------------
-- 5. SESSION PARTICIPANTS  (students "joining" someone else's session)
-- -------------------------------------------------------------------------
create table if not exists public.session_participants (
  session_id  uuid not null references public.focus_sessions(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  joined_at   timestamptz not null default now(),
  primary key (session_id, user_id)
);

-- -------------------------------------------------------------------------
-- 6. REPORTS
-- -------------------------------------------------------------------------
create table if not exists public.reports (
  id            uuid primary key default gen_random_uuid(),
  reporter_id   uuid not null references public.profiles(id) on delete cascade,
  post_id       uuid not null references public.posts(id) on delete cascade,
  reason        text not null check (reason in ('spam','bullying','inappropriate','off_topic','other')),
  status        text not null default 'open' check (status in ('open','reviewed','dismissed')),
  reviewed_by   uuid references public.profiles(id),
  created_at    timestamptz not null default now()
);

-- -------------------------------------------------------------------------
-- 7. ANNOUNCEMENTS  (admin-authored, optionally pinned to the top of the hub)
-- -------------------------------------------------------------------------
create table if not exists public.announcements (
  id            uuid primary key default gen_random_uuid(),
  admin_id      uuid not null references public.profiles(id),
  title         text not null,
  message       text not null,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- -------------------------------------------------------------------------
-- 8. BLOCKS  (student-level blocking, private to the blocker)
-- -------------------------------------------------------------------------
create table if not exists public.blocks (
  blocker_id  uuid not null references public.profiles(id) on delete cascade,
  blocked_id  uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

-- -------------------------------------------------------------------------
-- 9. GROUP_JOIN_REQUESTS
-- Captured from the public landing page's "Join the WhatsApp group" form,
-- shown before a visitor is handed the WhatsApp invite link. No login is
-- required to submit one — that's the point, it's a pre-approval gate for
-- people who aren't Study Hub members yet. Only admins can read the list
-- (see admin.html → Group Requests).
-- -------------------------------------------------------------------------
create table if not exists public.group_join_requests (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  marks            text not null,
  class            text not null,
  school           text not null,
  whatsapp_number  text not null,
  created_at       timestamptz not null default now()
);

-- =========================================================================
-- HELPER FUNCTIONS (security definer so they can be used safely inside
-- policies without causing infinite RLS recursion on profiles)
-- =========================================================================
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and status = 'approved'
  );
$$;

create or replace function public.is_approved()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'approved'
  );
$$;

-- Prevents a student from ever writing role / status / marks themselves,
-- no matter what the client sends. Only an admin (checked server-side via
-- is_admin()) can change these fields.
create or replace function public.enforce_profile_guardrails()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    if new.role is distinct from old.role
       or new.status is distinct from old.status
       or new.marks is distinct from old.marks then
      raise exception 'Only an administrator can change role, status, or marks.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profile_guardrails on public.profiles;
create trigger trg_profile_guardrails
  before update on public.profiles
  for each row execute function public.enforce_profile_guardrails();

-- =========================================================================
-- PUBLIC-SAFE VIEW OF PROFILES
-- Marks and email are never exposed through this view — the feed, live
-- study list, and profile cards should always read from here instead of
-- the profiles table directly.
-- =========================================================================
create or replace view public.profile_public
with (security_invoker = false) as
select id, name, school, class, role, status, created_at, avatar_url
from public.profiles;

grant select on public.profile_public to authenticated;

-- =========================================================================
-- AUTO-CREATE PROFILE ON SIGNUP
-- Runs inside the database the instant a new auth user is created — this
-- is what actually creates the profiles row now, NOT the frontend. It
-- fixes a timing problem: if "Confirm email" is on, the browser doesn't
-- have a fully logged-in session yet right after signUp(), so a
-- client-side insert into profiles gets rejected by RLS. A trigger runs
-- with database privileges, so it isn't affected by that timing at all —
-- and it works identically whether email confirmation is on or off.
-- =========================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, email, school, class, marks, role, status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', ''),
    new.email,
    coalesce(new.raw_user_meta_data->>'school', ''),
    coalesce(new.raw_user_meta_data->>'class', ''),
    new.raw_user_meta_data->>'marks',
    'student',
    'pending'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_handle_new_user on auth.users;
create trigger trg_handle_new_user
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =========================================================================
-- ENABLE ROW LEVEL SECURITY
-- =========================================================================
alter table public.profiles           enable row level security;
alter table public.posts              enable row level security;
alter table public.reactions          enable row level security;
alter table public.focus_sessions     enable row level security;
alter table public.session_participants enable row level security;
alter table public.reports            enable row level security;
alter table public.announcements      enable row level security;
alter table public.blocks             enable row level security;
alter table public.group_join_requests enable row level security;

-- -------------------------------------------------------------------------
-- PROFILES policies
-- -------------------------------------------------------------------------
drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin"
  on public.profiles for select
  using (auth.uid() = id or public.is_admin());

-- Signup always creates role='student', status='pending' — enforced here,
-- not just in the UI, so there is no "I am an Admin" checkbox to abuse.
drop policy if exists "profiles_insert_self_as_pending_student" on public.profiles;
create policy "profiles_insert_self_as_pending_student"
  on public.profiles for insert
  with check (
    auth.uid() = id and role = 'student' and status = 'pending'
  );

drop policy if exists "profiles_update_own_or_admin" on public.profiles;
create policy "profiles_update_own_or_admin"
  on public.profiles for update
  using (auth.uid() = id or public.is_admin());

-- -------------------------------------------------------------------------
-- POSTS policies
-- -------------------------------------------------------------------------
drop policy if exists "posts_select_visible" on public.posts;
create policy "posts_select_visible"
  on public.posts for select
  using (
    (removed = false and public.is_approved()) or public.is_admin() or user_id = auth.uid()
  );

drop policy if exists "posts_insert_approved_self" on public.posts;
create policy "posts_insert_approved_self"
  on public.posts for insert
  with check (user_id = auth.uid() and public.is_approved());

drop policy if exists "posts_update_admin_only" on public.posts;
create policy "posts_update_admin_only"
  on public.posts for update
  using (public.is_admin());

drop policy if exists "posts_delete_admin_only" on public.posts;
create policy "posts_delete_admin_only"
  on public.posts for delete
  using (public.is_admin());

-- -------------------------------------------------------------------------
-- REACTIONS policies
-- -------------------------------------------------------------------------
drop policy if exists "reactions_select_approved" on public.reactions;
create policy "reactions_select_approved"
  on public.reactions for select
  using (public.is_approved() or public.is_admin());

drop policy if exists "reactions_insert_self" on public.reactions;
create policy "reactions_insert_self"
  on public.reactions for insert
  with check (user_id = auth.uid() and public.is_approved());

drop policy if exists "reactions_delete_self_or_admin" on public.reactions;
create policy "reactions_delete_self_or_admin"
  on public.reactions for delete
  using (user_id = auth.uid() or public.is_admin());

-- -------------------------------------------------------------------------
-- FOCUS SESSIONS policies
-- -------------------------------------------------------------------------
drop policy if exists "sessions_select_approved" on public.focus_sessions;
create policy "sessions_select_approved"
  on public.focus_sessions for select
  using (public.is_approved() or public.is_admin());

drop policy if exists "sessions_insert_self" on public.focus_sessions;
create policy "sessions_insert_self"
  on public.focus_sessions for insert
  with check (user_id = auth.uid() and public.is_approved());

drop policy if exists "sessions_update_owner_or_admin" on public.focus_sessions;
create policy "sessions_update_owner_or_admin"
  on public.focus_sessions for update
  using (user_id = auth.uid() or public.is_admin());

-- -------------------------------------------------------------------------
-- SESSION PARTICIPANTS policies
-- -------------------------------------------------------------------------
drop policy if exists "participants_select_approved" on public.session_participants;
create policy "participants_select_approved"
  on public.session_participants for select
  using (public.is_approved() or public.is_admin());

drop policy if exists "participants_insert_self" on public.session_participants;
create policy "participants_insert_self"
  on public.session_participants for insert
  with check (user_id = auth.uid() and public.is_approved());

drop policy if exists "participants_delete_self" on public.session_participants;
create policy "participants_delete_self"
  on public.session_participants for delete
  using (user_id = auth.uid() or public.is_admin());

-- -------------------------------------------------------------------------
-- REPORTS policies
-- -------------------------------------------------------------------------
drop policy if exists "reports_select_own_or_admin" on public.reports;
create policy "reports_select_own_or_admin"
  on public.reports for select
  using (reporter_id = auth.uid() or public.is_admin());

drop policy if exists "reports_insert_self" on public.reports;
create policy "reports_insert_self"
  on public.reports for insert
  with check (reporter_id = auth.uid() and public.is_approved());

drop policy if exists "reports_update_admin_only" on public.reports;
create policy "reports_update_admin_only"
  on public.reports for update
  using (public.is_admin());

-- -------------------------------------------------------------------------
-- ANNOUNCEMENTS policies
-- -------------------------------------------------------------------------
drop policy if exists "announcements_select_active_or_admin" on public.announcements;
create policy "announcements_select_active_or_admin"
  on public.announcements for select
  using (active = true or public.is_admin());

drop policy if exists "announcements_write_admin_only" on public.announcements;
create policy "announcements_write_admin_only"
  on public.announcements for insert
  with check (public.is_admin());

drop policy if exists "announcements_update_admin_only" on public.announcements;
create policy "announcements_update_admin_only"
  on public.announcements for update
  using (public.is_admin());

drop policy if exists "announcements_delete_admin_only" on public.announcements;
create policy "announcements_delete_admin_only"
  on public.announcements for delete
  using (public.is_admin());

-- -------------------------------------------------------------------------
-- BLOCKS policies (fully private to the blocker)
-- -------------------------------------------------------------------------
drop policy if exists "blocks_select_own" on public.blocks;
create policy "blocks_select_own"
  on public.blocks for select
  using (blocker_id = auth.uid());

drop policy if exists "blocks_insert_own" on public.blocks;
create policy "blocks_insert_own"
  on public.blocks for insert
  with check (blocker_id = auth.uid());

drop policy if exists "blocks_delete_own" on public.blocks;
create policy "blocks_delete_own"
  on public.blocks for delete
  using (blocker_id = auth.uid());

-- -------------------------------------------------------------------------
-- GROUP_JOIN_REQUESTS policies
-- Anyone (including anonymous visitors) can submit the form. Only an admin
-- can read the submissions back — a public visitor can never list other
-- people's names/marks/WhatsApp numbers, even though they can insert one.
-- -------------------------------------------------------------------------
drop policy if exists "group_join_requests_insert_anyone" on public.group_join_requests;
create policy "group_join_requests_insert_anyone"
  on public.group_join_requests for insert
  with check (
    char_length(name) > 0 and char_length(marks) > 0
    and char_length(class) > 0 and char_length(school) > 0
    and char_length(whatsapp_number) > 0
  );

drop policy if exists "group_join_requests_select_admin_only" on public.group_join_requests;
create policy "group_join_requests_select_admin_only"
  on public.group_join_requests for select
  using (public.is_admin());

-- =========================================================================
-- REALTIME
-- Enable realtime replication on the tables the Study Hub subscribes to.
-- Wrapped in existence checks since, unlike CREATE, ALTER PUBLICATION ...
-- ADD TABLE has no IF NOT EXISTS form and errors on a table already added.
-- =========================================================================
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'posts') then
    alter publication supabase_realtime add table public.posts;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reactions') then
    alter publication supabase_realtime add table public.reactions;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'focus_sessions') then
    alter publication supabase_realtime add table public.focus_sessions;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'announcements') then
    alter publication supabase_realtime add table public.announcements;
  end if;
end $$;

-- =========================================================================
-- PROFILE PICTURES (Supabase Storage)
-- Public bucket 'avatars', one file per user at "<user id>/avatar.jpg" —
-- the frontend always uploads with upsert:true to that exact path, so
-- replacing a photo overwrites it rather than accumulating files. Public
-- read (avatars are shown to every other student in the feed/live list/
-- admin views); write/replace/delete restricted to the file's own owner,
-- matched by the first path segment being their auth uid.
-- =========================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 3145728, array['image/jpeg'])
on conflict (id) do nothing;

drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own"
  on storage.objects for insert
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own"
  on storage.objects for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own"
  on storage.objects for delete
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- =========================================================================
-- CREATING YOUR FIRST ADMIN
-- Sign up normally through the app first (this creates the auth user and a
-- pending student profile), then run this — replacing the email — from the
-- SQL Editor. The SQL Editor runs as the database owner, so it bypasses the
-- guardrail trigger above; a student can never do this to themselves.
-- =========================================================================
-- update public.profiles
-- set role = 'admin', status = 'approved'
-- where email = 'you@example.com';
