// =========================================================================
// SHARED APP UTILITIES
// Constants, session guarding, nav rendering, and small helpers used by
// every page in the Study Hub.
// =========================================================================
import { sb } from './supabaseClient.js';

export const QUICK_STATUSES = [
  { type: 'locked_in',  glyph: '🔒', label: 'LOCKED IN',        message: (n) => `${n} is locked in.` },
  { type: 'studying',   glyph: '📚', label: 'STUDYING',         message: (n) => `${n} is studying.` },
  { type: 'goal_set',   glyph: '🎯', label: 'GOAL SET',         message: (n) => `${n} set a goal for today.` },
  { type: 'struggling', glyph: '😭', label: 'STRUGGLING',       message: (n) => `${n} is having a tough one — send encouragement.` },
  { type: 'on_break',   glyph: '☕', label: 'ON BREAK',         message: (n) => `${n} is on a short break.` },
  { type: 'finished',   glyph: '✅', label: 'FINISHED',         message: (n) => `${n} finished studying for now.` },
  { type: 'keep_going', glyph: '🫡', label: 'KEEP GOING',       message: (n) => `${n} is pushing through.` },
  { type: 'anyone',     glyph: '👀', label: 'ANYONE STUDYING?', message: () => `Anyone studying right now?` },
];

export const REACTIONS = [
  { type: 'heart', glyph: '❤️' },
  { type: 'fire', glyph: '🔥' },
  { type: 'salute', glyph: '🫡' },
  { type: 'books', glyph: '📚' },
  { type: 'cry', glyph: '😭' },
  { type: 'target', glyph: '🎯' },
];

export const STATUS_TAGS = {
  locked_in: '🔒 Locked in',
  studying: '📚 Studying',
  goal_set: '🎯 Today\u2019s goal',
  struggling: '😭 Struggling',
  on_break: '☕ On break',
  finished: '✅ Finished',
  keep_going: '🫡 Keep going',
  anyone: '👀 Anyone studying?',
  session_complete: '✅ Session complete',
  custom: '📚 Study update',
};

export function initial(name) {
  return (name || '?').trim().charAt(0).toUpperCase();
}

// -------------------------------------------------------------------------
// Avatars: every place a user's identity is shown (nav, profile, feed
// posts, live list, admin tables) renders through this one helper, so a
// user with no photo always gets the same initials-circle fallback and a
// user with a photo always renders it the same way (an <img> filling the
// circular container — the container itself supplies size/shape via CSS).
// -------------------------------------------------------------------------
export function avatarInner(name, avatarUrl) {
  return avatarUrl
    ? `<img class="avatar-img" src="${escapeHtml(avatarUrl)}" alt="" loading="lazy">`
    : escapeHtml(initial(name));
}

const AVATAR_BUCKET = 'avatars';
const AVATAR_MAX_SOURCE_BYTES = 8 * 1024 * 1024; // 8MB raw upload cap, pre-resize
const AVATAR_OUTPUT_SIZE = 512; // px, square

// -------------------------------------------------------------------------
// Resize/crop an image file to a square JPEG in the browser before upload.
// This keeps every avatar a predictable, small size regardless of what the
// user picked, and sidesteps needing multiple file extensions server-side.
// -------------------------------------------------------------------------
function resizeImageToSquareJpeg(file, size = AVATAR_OUTPUT_SIZE) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
      canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error('Could not process that image.')),
        'image/jpeg', 0.86
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file doesn't look like a valid image.")); };
    img.src = url;
  });
}

// -------------------------------------------------------------------------
// Validate, resize, and upload a profile picture for `userId`. Always
// writes to the same storage path (upsert), so replacing a photo doesn't
// leave orphaned files behind. Returns a cache-busted public URL to save
// on the profiles row, or throws with a message safe to show the user.
// -------------------------------------------------------------------------
export async function uploadAvatar(file, userId) {
  if (!file) throw new Error('No file selected.');
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file (JPG, PNG, WEBP, or GIF).');
  if (file.size > AVATAR_MAX_SOURCE_BYTES) throw new Error('That image is too large — please choose one under 8MB.');

  const blob = await resizeImageToSquareJpeg(file);
  const path = `${userId}/avatar.jpg`;
  const { error: uploadError } = await sb.storage.from(AVATAR_BUCKET).upload(path, blob, {
    upsert: true,
    contentType: 'image/jpeg',
    cacheControl: '3600',
  });
  if (uploadError) throw new Error(uploadError.message || "Couldn't upload that image.");

  const { data } = sb.storage.from(AVATAR_BUCKET).getPublicUrl(path);
  const versionedUrl = `${data.publicUrl}?v=${Date.now()}`;

  const { error: dbError } = await sb.from('profiles').update({ avatar_url: versionedUrl }).eq('id', userId);
  if (dbError) throw new Error(dbError.message || "Uploaded, but couldn't save it to your profile.");

  return versionedUrl;
}

export async function removeAvatar(userId) {
  const path = `${userId}/avatar.jpg`;
  await sb.storage.from(AVATAR_BUCKET).remove([path]); // best-effort; profile row is the source of truth
  const { error } = await sb.from('profiles').update({ avatar_url: null }).eq('id', userId);
  if (error) throw new Error(error.message || "Couldn't remove your photo.");
}

export function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

const TOAST_ICONS = { success: '✓', error: '✕', warning: '⚠', info: '' };

// type is optional — when not passed, it's inferred from the message text so
// the ~25 existing showToast('...') call sites across the app don't need to
// change to get the right color/icon.
export function showToast(message, type) {
  if (!type) {
    if (/couldn.?t|error|failed|wrong/i.test(message)) type = 'error';
    else if (/removed|suspended|rejected|blocked|terminated|dismissed/i.test(message)) type = 'warning';
    else if (/approved|updated|posted|copied|saved|submitted|received|opening|finished|nice work/i.test(message)) type = 'success';
  }
  let stack = document.querySelector('.toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'toast-stack';
    document.body.appendChild(stack);
  }
  const toast = document.createElement('div');
  toast.className = `toast${type ? ` toast-${type}` : ''}`;
  const icon = type ? TOAST_ICONS[type] : '';
  toast.innerHTML = `${icon ? `<span class="toast-icon">${icon}</span>` : ''}<span>${escapeHtml(message)}</span>`;
  stack.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

// -------------------------------------------------------------------------
// Redirect loop guard
// -------------------------------------------------------------------------
// Every auth-aware page ends up calling goTo() to send the user somewhere
// else based on session/profile state. If two pages ever disagree about
// that state (e.g. a transient network hiccup on one of the two Supabase
// calls), they can bounce the user back and forth forever. This tracks how
// many redirects have happened in a short window and, if it looks like a
// loop, stops redirecting and shows an error instead of flickering forever.
// -------------------------------------------------------------------------
const LOOP_KEY = 'pip2_redirect_trace';
const LOOP_WINDOW_MS = 8000;
const LOOP_LIMIT = 4;

function goTo(path) {
  if (window.location.pathname.endsWith(path)) return; // already there
  let trace = [];
  try { trace = JSON.parse(sessionStorage.getItem(LOOP_KEY) || '[]'); } catch { trace = []; }
  const now = Date.now();
  trace = trace.filter(t => now - t.time < LOOP_WINDOW_MS);
  trace.push({ path, time: now });

  if (trace.length >= LOOP_LIMIT) {
    // We've bounced between pages LOOP_LIMIT+ times in LOOP_WINDOW_MS.
    // Something is flapping (usually a transient session/profile read).
    // Stop redirecting and let the user recover manually instead of
    // leaving them stuck in an infinite flicker.
    sessionStorage.removeItem(LOOP_KEY);
    console.error('Redirect loop detected, stopping at', window.location.pathname, trace);
    showRedirectLoopNotice();
    return;
  }

  try { sessionStorage.setItem(LOOP_KEY, JSON.stringify(trace)); } catch { /* ignore */ }
  window.location.href = path;
}

function showRedirectLoopNotice() {
  if (document.getElementById('redirect-loop-notice')) return;
  const el = document.createElement('div');
  el.id = 'redirect-loop-notice';
  el.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(10,10,15,0.72);backdrop-filter:blur(4px);padding:20px;';
  el.innerHTML = `
    <div style="max-width:380px;width:100%;background:#fff;border-radius:16px;padding:24px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
      <div style="font-size:32px;margin-bottom:8px;">⚠️</div>
      <h3 style="margin:0 0 8px;">We couldn't confirm your session</h3>
      <p style="margin:0 0 16px;color:#555;font-size:14px;">This usually clears up on a fresh reload. If it keeps happening, try logging out and back in.</p>
      <button id="redirect-loop-reload" style="border:none;border-radius:999px;padding:10px 20px;font-weight:600;cursor:pointer;background:#111;color:#fff;">Reload</button>
    </div>`;
  document.body.appendChild(el);
  document.getElementById('redirect-loop-reload').addEventListener('click', () => window.location.reload());
}

// Small helper: retries a Supabase query once after a short delay before
// treating it as a real failure. Guards against the profiles read losing a
// transient race (e.g. right after a hard-navigation, or a brief network
// blip) which previously caused pages to wrongly redirect to index.html.
async function fetchProfileWithRetry(userId) {
  const cols = 'id, name, email, school, class, role, status, created_at, avatar_url';
  let { data: profile, error } = await sb.from('profiles').select(cols).eq('id', userId).single();
  if (error || !profile) {
    await new Promise(r => setTimeout(r, 500));
    ({ data: profile, error } = await sb.from('profiles').select(cols).eq('id', userId).single());
  }
  return { profile, error };
}

// -------------------------------------------------------------------------
// Session guard: call at the top of every protected page.
// Redirects appropriately based on auth + approval + role.
// Returns { user, profile } when the page may proceed.
// -------------------------------------------------------------------------
export async function requireSession({ requireAdmin = false } = {}) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    goTo('index.html');
    return null;
  }

  const { profile, error } = await fetchProfileWithRetry(session.user.id);

  if (error || !profile) {
    goTo('index.html');
    return null;
  }

  if (profile.status === 'suspended') {
    goTo('suspended.html');
    return null;
  }
  if (profile.status === 'pending' && profile.role !== 'admin') {
    goTo('pending.html');
    return null;
  }
  if (requireAdmin && profile.role !== 'admin') {
    goTo('hub.html');
    return null;
  }

  sessionStorage.removeItem(LOOP_KEY); // reached a stable page; clear the trace
  return { user: session.user, profile };
}

// -------------------------------------------------------------------------
// Call on public pages (index.html) that should skip themselves and jump
// straight into the app for an already-logged-in, approved user. Shares the
// same retry + loop-guard behavior as requireSession() so the two checks
// can't disagree and bounce the user back and forth.
// -------------------------------------------------------------------------
// -------------------------------------------------------------------------
// Guard for the pending.html / suspended.html "status" pages: bounces the
// user onward once their status no longer matches why they're on this page
// (e.g. they got approved while looking at "pending"), but does nothing
// destructive if the session/profile read fails transiently.
// -------------------------------------------------------------------------
export async function guardStatusPage(currentPageStatus) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    goTo('index.html');
    return;
  }

  const { profile, error } = await fetchProfileWithRetry(session.user.id);
  if (error || !profile) return; // stay put rather than guess

  if (profile.status === currentPageStatus) {
    sessionStorage.removeItem(LOOP_KEY);
    return;
  }
  if (profile.status === 'approved') goTo('hub.html');
  else if (profile.status === 'pending') goTo('pending.html');
  else if (profile.status === 'suspended') goTo('suspended.html');
}

export async function redirectIfLoggedIn() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return;

  const { profile, error } = await fetchProfileWithRetry(session.user.id);
  if (error || !profile) return; // stay put rather than guess

  if (profile.status === 'approved') goTo('hub.html');
  else if (profile.status === 'pending') goTo('pending.html');
  else if (profile.status === 'suspended') goTo('suspended.html');
  else sessionStorage.removeItem(LOOP_KEY);
}

// -------------------------------------------------------------------------
// Renders the top nav + bottom nav into any page that includes
// <div id="app-nav"></div> and <div id="bottom-nav"></div>.
// -------------------------------------------------------------------------
export function renderNav(activePage, profile) {
  const links = [
    { href: 'hub.html', label: 'Study Hub', icon: '🔒' },
    { href: 'progress.html', label: 'Progress', icon: '📈' },
    { href: 'profile.html', label: 'Profile', icon: '🙂' },
  ];
  if (profile?.role === 'admin') {
    links.push({ href: 'admin.html', label: 'Admin', icon: '👑' });
  }

  const navEl = document.getElementById('app-nav');
  if (navEl) {
    navEl.innerHTML = `
      <div class="app-nav-inner">
        <a class="brand" href="hub.html"><img class="brand-mark-img" src="assets/logo.png" alt="Partners in Progress logo">Partners in Progress</a>
        <div class="app-nav-links">
          ${links.map(l => `<a href="${l.href}" class="${activePage === l.href ? 'active' : ''}">${l.label}</a>`).join('')}
        </div>
        <a class="nav-avatar${profile?.role === 'admin' ? ' is-admin' : ''}" href="profile.html" title="${escapeHtml(profile?.name || '')}${profile?.role === 'admin' ? ' (Admin)' : ''}">${avatarInner(profile?.name, profile?.avatar_url)}</a>
      </div>`;
  }

  const bottomEl = document.getElementById('bottom-nav');
  if (bottomEl) {
    bottomEl.innerHTML = links.map(l => `
      <a href="${l.href}" class="${activePage === l.href ? 'active' : ''}">
        <span class="icon">${l.icon}</span>${l.label}
      </a>`).join('');
  }

  mountCreditPill();
}

export async function logout() {
  await sb.auth.signOut();
  sessionStorage.removeItem(LOOP_KEY);
  window.location.href = 'index.html';
}

// -------------------------------------------------------------------------
// Floating credit pill: a small "signature" element, collapsed to a single
// glyph by default, that expands on hover/click/focus to reveal the credit
// line. Call once per page. Stays out of the way of the bottom-nav (see
// the .credit-pill CSS, which lifts it above the bottom-nav on mobile).
// -------------------------------------------------------------------------
export function mountCreditPill() {
  if (document.querySelector('.credit-pill')) return;
  const pill = document.createElement('button');
  pill.type = 'button';
  pill.className = 'credit-pill';
  pill.setAttribute('aria-label', 'Show credits');
  pill.setAttribute('aria-expanded', 'false');
  pill.innerHTML = `
    <span class="credit-pill-glyph" aria-hidden="true">✦</span>
    <span class="credit-pill-text">Built by <strong>Muhammad Zeeshan Haider</strong> &amp; <strong>Saim Gull</strong><span class="credit-pill-tag">The Invincible Duo</span></span>
  `;
  pill.addEventListener('click', () => {
    const expanded = pill.classList.toggle('expanded');
    pill.setAttribute('aria-expanded', String(expanded));
    pill.setAttribute('aria-label', expanded ? 'Hide credits' : 'Show credits');
  });
  document.body.appendChild(pill);
}
