# Partners in Progress

**Different goals. Shared discipline.**

A lightweight, mobile-first study community. Plain HTML/CSS/JS on the
frontend, Supabase (Postgres + Auth + Realtime) as the only backend — no
Firebase, no custom server, no extra services.

---

## 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) → **New project**.
2. Wait for it to finish provisioning.

## 2. Run the database schema

1. In your project, open **SQL Editor → New query**.
2. Paste the entire contents of `schema.sql` (in this folder) and click **Run**.

This creates every table, the `profile_public` view (which hides marks and
email from other students), all Row Level Security policies, turns on
Realtime for posts, reactions, focus sessions, and announcements, and
creates the public `avatars` storage bucket profile pictures are uploaded
to (see "Profile pictures" below).

> Already running an older version of this app? `schema.sql` is safe to
> re-run in full at any time — every statement in it is idempotent
> (`create table if not exists`, `add column if not exists`,
> `create or replace`, `on conflict do nothing`), so re-running it after
> pulling an update just adds whatever is new (like `avatar_url` and the
> `avatars` bucket) without touching your existing data.

> RLS is the real gatekeeper here, not the frontend. Even if someone edits
> the JavaScript in their browser, the database itself refuses to let a
> student set `role = 'admin'`, approve themselves, read another student's
> marks/email, or edit someone else's post.
>
> This file also creates a trigger that auto-creates each student's
> `profiles` row the instant they sign up (inside the database, not the
> browser) — so signup works correctly no matter what your email
> confirmation setting is.

## 3. Add your Supabase credentials to the app

Open `js/supabaseClient.js` and fill in:

```js
const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR-ANON-PUBLIC-KEY';
```

Both values are on your project's **Settings → API** page. The anon key is
safe to ship in frontend code — RLS is what keeps data safe, not secrecy of
this key.

## 4. Email confirmation — recommended: leave it off

By default Supabase requires email confirmation before a user can log in.
This app already has its own approval gate (an admin has to approve every
student before they can use the Study Hub), so email confirmation is
mostly redundant here — and Supabase's free built-in email sender only
allows a couple of emails per hour, which is easy to hit by accident.

**Recommendation:** go to **Authentication → Providers → Email** and leave
**Confirm email** turned **OFF**. Signups will work instantly, and admin
approval is still the real gate. If you later want confirmation emails too,
you'll need to connect a real email provider (e.g. Resend, free tier)
under **Project Settings → Auth → SMTP Settings** — Supabase's own mailer
isn't meant for production traffic.

## 5. Create your first admin

Admin accounts are never created through the public signup form — there is
intentionally no "I am an admin" option anywhere in the UI. Instead:

1. Sign up normally through the app (`auth.html` → Sign up) using your own
   name/school/class as usual. This creates your auth user and a `pending`
   student profile — for example:

   - Email: `zeeshankhadim1214@gmail.com`
   - Password: `Zeeshan@1214`

   (Change this password after first login, and avoid keeping real
   credentials in this file long-term — it's here only to make first-time
   setup easy.)

2. In Supabase, open **SQL Editor** and run:

   ```sql
   update public.profiles
   set role = 'admin', status = 'approved'
   where email = 'zeeshankhadim1214@gmail.com';
   ```

3. Log back in — you'll land on the Study Hub as a normal student
   (you can post, join focus sessions, appear in the live list, edit your
   profile — everything a student can do), but with a **★ Admin** badge
   next to your name everywhere it appears (feed posts, the "studying now"
   list, your profile page, and the nav avatar), an **Admin** link in the
   nav, and `/admin` in the URL bar.

Only an existing admin (via this same SQL-editor route, or later, one admin
promoting another directly in the `profiles` table) can create another
admin — the app itself has no promote-to-admin button.

## 6. Run it

This is a static site — no build step. Serve the folder with any static
file server, for example:

```bash
npx serve .
# or
python3 -m http.server 8080
```

Then open `index.html` in your browser.

---

## Project structure

```
index.html          Public landing page
auth.html            Sign up / log in
pending.html         "Awaiting approval" screen
suspended.html       "Account suspended" screen
hub.html             Study Hub — feed, quick statuses, focus sessions, live indicator
progress.html        Personal focus-time stats + weekly activity
profile.html         Edit profile, community rules, log out
admin.html           Admin dashboard (overview, approvals, students, posts, reports, announcements, sessions)

css/styles.css        Every style in the app — one shared design system

js/supabaseClient.js  ⚠️ Add your Supabase URL + anon key here
js/app.js              Shared helpers: session guard, nav rendering, constants
js/auth.js              Sign up / log in logic
js/hub.js               Study Hub logic (feed, reactions, focus timer, live list)
js/progress.js           Progress page logic
js/profile.js            Profile page logic
js/admin.js              Admin dashboard logic

schema.sql             Full database schema + RLS policies (run this in Supabase)
```

## How approval + roles work

- Signup always creates `role = 'student'`, `status = 'pending'` — enforced
  by an RLS policy on `profiles`, not just the signup form.
- A student can't do anything in the Study Hub until an admin sets
  `status = 'approved'`.
- A `before update` trigger on `profiles` blocks any non-admin from ever
  changing `role`, `status`, or `marks` on any row, including their own —
  so even a modified client can't self-promote or self-approve.
- Marks and email are excluded from `profile_public`, the view every other
  student's name/school/class is read through. Only the row owner and
  admins can see the full `profiles` row (enforced by RLS on `profiles`
  itself).

## MVP simplifications (documented on purpose)

A few things were deliberately kept simple for v1, per the brief:

- **Joining a session**: adding yourself to someone else's focus session
  writes a row to `session_participants` and starts a synced countdown for
  you, but doesn't create your own `focus_sessions` row — so it shows up in
  the live "studying now" list but isn't counted toward your personal
  Progress stats (those come from sessions **you started**).
- **"Reject" during approval** sets `status = 'suspended'` rather than
  deleting the account, matching the brief's "don't delete users unless
  necessary" rule.
- **Reporting/blocking** uses simple browser prompts and table rows rather
  than a full moderation UI — reports go to the admin's Reports tab, and
  blocks are private and instant (no admin step needed to block someone
  yourself).

## Profile pictures

Students can upload, replace, or remove a profile picture from the Profile
page. A few implementation notes:

- Photos are stored in the public `avatars` Supabase Storage bucket
  created by `schema.sql`, one file per user at `<user id>/avatar.jpg`.
  Uploading always overwrites that same path, so replacing a photo never
  leaves old files behind.
- Every upload is resized/cropped to a 512×512 JPEG in the browser before
  it's sent, regardless of the original file's size or shape — this keeps
  storage usage predictable and gives every avatar a consistent look.
- Storage RLS restricts writes to a user's own folder (matched by their
  auth user id being the first path segment) — the same "frontend is never
  trusted" principle as the rest of the app. Reads are public, since
  avatars are shown to other students in the feed and live list.
- Anyone without a photo gets an initials-circle fallback (their name's
  first letter) everywhere an avatar would otherwise appear.
