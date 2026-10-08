import { sb } from './supabaseClient.js';
import {
  requireSession, renderNav, showToast, escapeHtml, timeAgo, initial, avatarInner,
  QUICK_STATUSES, REACTIONS, STATUS_TAGS,
} from './app.js';

const session = await requireSession();
if (!session) throw new Error('redirecting');
const { user, profile } = session;

renderNav('hub.html', profile);

// -------------------------------------------------------------------------
// State
// -------------------------------------------------------------------------
let blockedIds = new Set();
let currentSessionId = null;   // the focus_sessions row this user owns & is running
let joinedSessionId = null;    // a session this user has joined (not owned)
let timerInterval = null;

// -------------------------------------------------------------------------
// Modal helpers
// -------------------------------------------------------------------------
function open(id) { document.getElementById(id).classList.remove('hidden'); }
function close(id) { document.getElementById(id).classList.add('hidden'); }
document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => close(btn.dataset.close));
});

// =========================================================================
// ANNOUNCEMENT
// =========================================================================
async function loadAnnouncement() {
  const { data } = await sb
    .from('announcements')
    .select('title, message')
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(1);
  const slot = document.getElementById('announcement-slot');
  if (data && data.length) {
    slot.innerHTML = `
      <div class="announce-card">
        <div class="tag">📢 Partners in Progress</div>
        <h4>${escapeHtml(data[0].title)}</h4>
        <p>${escapeHtml(data[0].message)}</p>
      </div>`;
  } else {
    slot.innerHTML = '';
  }
}

// =========================================================================
// BLOCKED USERS
// =========================================================================
async function loadBlocked() {
  const { data } = await sb.from('blocks').select('blocked_id').eq('blocker_id', user.id);
  blockedIds = new Set((data || []).map(r => r.blocked_id));
}

// =========================================================================
// QUICK STATUS BUTTONS
// =========================================================================
function renderQuickButtons() {
  const grid = document.getElementById('quick-status-grid');
  grid.innerHTML = QUICK_STATUSES.map(q =>
    `<button class="quick-status-btn" data-type="${q.type}">${q.glyph} ${q.label}</button>`
  ).join('');
  grid.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', async () => {
      const q = QUICK_STATUSES.find(x => x.type === btn.dataset.type);
      await createPost(q.message(profile.name), q.type);
    });
  });
}

// =========================================================================
// COMPOSER
// =========================================================================
const composerInput = document.getElementById('composer-input');
const charCount = document.getElementById('char-count');
composerInput.addEventListener('input', () => {
  charCount.textContent = composerInput.value.length;
});
document.getElementById('post-btn').addEventListener('click', async () => {
  const text = composerInput.value.trim();
  if (!text) return;
  await createPost(text, 'custom');
  composerInput.value = '';
  charCount.textContent = '0';
});

async function createPost(message, statusType) {
  const { error } = await sb.from('posts').insert({
    user_id: user.id, message, status_type: statusType,
  });
  if (error) showToast(`Couldn't post: ${error.message}`);
  else loadFeed();
}

// =========================================================================
// FEED
// =========================================================================
async function loadFeed() {
  const { data: posts, error } = await sb
    .from('posts')
    .select('id, user_id, message, status_type, created_at')
    .eq('removed', false)
    .order('created_at', { ascending: false })
    .limit(50);

  const feedList = document.getElementById('feed-list');
  if (error || !posts) {
    feedList.innerHTML = `<div class="empty-state"><div class="glyph">📚</div><p>Couldn't load the feed.</p></div>`;
    return;
  }

  const visible = posts.filter(p => !blockedIds.has(p.user_id));
  if (!visible.length) {
    feedList.innerHTML = `<div class="empty-state"><div class="glyph">📚</div><p>No posts yet — be the first to share what you're working on.</p><button class="btn btn-gold btn-sm" id="empty-feed-cta">Share an update</button></div>`;
    document.getElementById('empty-feed-cta')?.addEventListener('click', () => {
      document.getElementById('composer-input')?.focus();
    });
    return;
  }

  const authorIds = [...new Set(visible.map(p => p.user_id))];
  const { data: authors } = await sb.from('profile_public').select('id, name, school, role, avatar_url').in('id', authorIds);
  const authorMap = Object.fromEntries((authors || []).map(a => [a.id, a]));

  const postIds = visible.map(p => p.id);
  const { data: reactions } = await sb.from('reactions').select('post_id, user_id, reaction_type').in('post_id', postIds);
  const reactionsByPost = {};
  (reactions || []).forEach(r => {
    (reactionsByPost[r.post_id] ??= []).push(r);
  });

  feedList.innerHTML = visible.map(p => renderPostCard(p, authorMap[p.user_id], reactionsByPost[p.id] || [])).join('');

  feedList.querySelectorAll('.reaction-btn').forEach(btn => {
    btn.addEventListener('click', () => toggleReaction(btn.dataset.postId, btn.dataset.type));
  });
  feedList.querySelectorAll('.post-more-btn').forEach(btn => {
    btn.addEventListener('click', () => openPostMenu(btn.dataset.postId, btn.dataset.userId, btn.dataset.name));
  });
}

function renderPostCard(post, author, reactions) {
  const name = author?.name || 'A student';
  const school = author?.school ? escapeHtml(author.school) : '';
  const adminBadge = author?.role === 'admin' ? '<span class="name-badge">★ Admin</span>' : '';
  const tag = STATUS_TAGS[post.status_type] || STATUS_TAGS.custom;

  const reactionBar = REACTIONS.map(r => {
    const matches = reactions.filter(x => x.reaction_type === r.type);
    const mine = matches.some(x => x.user_id === user.id);
    return `<button class="reaction-btn ${mine ? 'active' : ''}" data-post-id="${post.id}" data-type="${r.type}">
      ${r.glyph}${matches.length ? `<span class="n">${matches.length}</span>` : ''}
    </button>`;
  }).join('');

  return `
    <div class="card post-card">
      <div class="post-avatar">${avatarInner(name, author?.avatar_url)}</div>
      <div class="post-body">
        <div class="post-meta">
          <span class="post-name">${escapeHtml(name)}</span>
          ${adminBadge}
          ${school ? `<span class="post-school">· ${school}</span>` : ''}
          <span class="post-time">${timeAgo(post.created_at)}</span>
        </div>
        <div class="post-tag">${tag}</div>
        <div class="post-message">${escapeHtml(post.message)}</div>
        <div class="post-actions">
          ${reactionBar}
          <button class="post-more-btn" data-post-id="${post.id}" data-user-id="${post.user_id}" data-name="${escapeHtml(name)}">⋯</button>
        </div>
      </div>
    </div>`;
}

async function toggleReaction(postId, type) {
  const { data: existing } = await sb
    .from('reactions').select('id')
    .eq('post_id', postId).eq('user_id', user.id).eq('reaction_type', type)
    .maybeSingle();

  if (existing) {
    await sb.from('reactions').delete().eq('id', existing.id);
  } else {
    await sb.from('reactions').insert({ post_id: postId, user_id: user.id, reaction_type: type });
  }
  loadFeed();
}

// -------------------------------------------------------------------------
// Post menu: report or block the author
// -------------------------------------------------------------------------
let menuPostId = null, menuUserId = null;
function openPostMenu(postId, userId, name) {
  if (userId === user.id) {
    showToast("That's your own post.");
    return;
  }
  menuPostId = postId; menuUserId = userId;
  const action = window.prompt(`Post by ${name}\nType "report" to report this post, or "block" to block ${name}.`);
  if (action === 'report') open('report-modal');
  else if (action === 'block') blockUser();
}

document.getElementById('submit-report-btn').addEventListener('click', async () => {
  const reason = document.getElementById('report-reason').value;
  const { error } = await sb.from('reports').insert({ reporter_id: user.id, post_id: menuPostId, reason });
  close('report-modal');
  showToast(error ? `Couldn't submit report: ${error.message}` : 'Report submitted. Thanks for keeping the hub safe.');
});

async function blockUser() {
  const { error } = await sb.from('blocks').insert({ blocker_id: user.id, blocked_id: menuUserId });
  if (error) return showToast(`Couldn't block: ${error.message}`);
  blockedIds.add(menuUserId);
  showToast('Blocked. You will no longer see their posts.');
  loadFeed();
}

// =========================================================================
// LIVE STUDY INDICATOR
// =========================================================================
async function loadLive() {
  const { data: sessions } = await sb
    .from('focus_sessions')
    .select('id, user_id, subject, duration_minutes, started_at')
    .is('ended_at', null)
    .order('started_at', { ascending: false });

  const count = (sessions || []).length;
  document.getElementById('live-count').textContent =
    count === 1 ? '1 student studying right now' : `${count} students studying right now`;

  const userIds = [...new Set((sessions || []).map(s => s.user_id))];
  const { data: authors } = userIds.length
    ? await sb.from('profile_public').select('id, name, role, avatar_url').in('id', userIds)
    : { data: [] };
  const authorMap = Object.fromEntries((authors || []).map(a => [a.id, a]));

  const list = document.getElementById('live-list');
  if (!count) {
    list.innerHTML = `<div class="empty-state"><div class="glyph">⏱️</div><p>No one is in a session right now — start one!</p></div>`;
    return;
  }
  list.innerHTML = (sessions || []).map(s => {
    const remainingMs = new Date(s.started_at).getTime() + s.duration_minutes * 60000 - Date.now();
    const remainingMin = Math.max(0, Math.round(remainingMs / 60000));
    const name = authorMap[s.user_id]?.name || 'A student';
    const adminBadge = authorMap[s.user_id]?.role === 'admin' ? '<span class="name-badge">★ Admin</span>' : '';
    return `<div class="session-row">
      <span class="table-avatar">${avatarInner(name, authorMap[s.user_id]?.avatar_url)}</span>
      <span class="who">🔒 ${escapeHtml(name)}</span>
      ${adminBadge}
      <span class="subj">${escapeHtml(s.subject)}</span>
      <span class="time">${remainingMin} min left</span>
      ${s.user_id !== user.id ? `<button class="btn btn-sm btn-line" data-join="${s.id}" data-subject="${escapeHtml(s.subject)}" data-duration="${s.duration_minutes}" data-started="${s.started_at}">Join</button>` : ''}
    </div>`;
  }).join('');

  list.querySelectorAll('[data-join]').forEach(btn => {
    btn.addEventListener('click', () => joinSession(btn.dataset.join, btn.dataset.subject, Number(btn.dataset.duration), btn.dataset.started));
  });
}

document.getElementById('live-strip').addEventListener('click', () => { loadLive(); open('live-modal'); });

// =========================================================================
// FOCUS SESSIONS — start, join, run timer, complete
// =========================================================================
document.getElementById('open-session-btn').addEventListener('click', () => open('session-setup-modal'));

let selectedDuration = 25;
document.querySelectorAll('#duration-choices .choice-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('#duration-choices .choice-pill').forEach(p => p.classList.remove('selected'));
    pill.classList.add('selected');
    selectedDuration = Number(pill.dataset.value);
    document.getElementById('custom-duration').style.display = 'none';
  });
});
document.querySelector('#duration-choices .choice-pill').classList.add('selected');

document.getElementById('custom-duration-toggle').addEventListener('click', (e) => {
  e.preventDefault();
  document.querySelectorAll('#duration-choices .choice-pill').forEach(p => p.classList.remove('selected'));
  const custom = document.getElementById('custom-duration');
  custom.style.display = 'block';
  custom.focus();
});
document.getElementById('custom-duration').addEventListener('input', (e) => {
  selectedDuration = Number(e.target.value) || 25;
});

document.getElementById('start-session-btn').addEventListener('click', async () => {
  const subject = document.getElementById('session-subject').value;
  const goal = document.getElementById('session-goal').value.trim();

  const { data, error } = await sb.from('focus_sessions').insert({
    user_id: user.id, subject, goal: goal || null, duration_minutes: selectedDuration,
  }).select().single();

  if (error) return showToast(`Couldn't start session: ${error.message}`);

  currentSessionId = data.id;
  joinedSessionId = null;
  close('session-setup-modal');
  document.getElementById('timer-leave-btn').textContent = 'End early';
  runTimer(data.started_at, selectedDuration, subject, goal, true);
  loadLive();
});

async function joinSession(sessionId, subject, duration, startedAt) {
  await sb.from('session_participants').insert({ session_id: sessionId, user_id: user.id });
  joinedSessionId = sessionId;
  currentSessionId = null;
  close('live-modal');
  document.getElementById('timer-leave-btn').textContent = 'Leave session';
  runTimer(startedAt, duration, subject, '', false);
}

let lastSubject = '', lastGoal = '', lastDuration = 0;

function runTimer(startedAtIso, durationMin, subject, goal, isOwner) {
  clearInterval(timerInterval);
  lastSubject = subject; lastGoal = goal; lastDuration = durationMin;

  document.getElementById('timer-subject').textContent = subject.toUpperCase();
  document.getElementById('timer-goal').textContent = goal || '';
  const endAt = new Date(startedAtIso).getTime() + durationMin * 60000;

  async function tick() {
    const remainingSec = Math.max(0, Math.round((endAt - Date.now()) / 1000));
    const mm = String(Math.floor(remainingSec / 60)).padStart(2, '0');
    const ss = String(remainingSec % 60).padStart(2, '0');
    document.getElementById('timer-digits').textContent = `${mm}:${ss}`;

    const { count } = await sb.from('focus_sessions').select('id', { count: 'exact', head: true }).is('ended_at', null);
    const partners = Math.max(0, (count || 1) - 1);
    document.getElementById('timer-partners').innerHTML = `<strong>${partners}</strong> partner${partners === 1 ? '' : 's'} studying with you`;

    if (remainingSec <= 0) {
      clearInterval(timerInterval);
      if (isOwner) await finishOwnSession(true);
      else { close('timer-modal'); showToast('Session finished — nice work.'); }
    }
  }
  tick();
  timerInterval = setInterval(tick, 1000);
  open('timer-modal');
}

document.getElementById('timer-leave-btn').addEventListener('click', async () => {
  clearInterval(timerInterval);
  close('timer-modal');
  if (currentSessionId) await finishOwnSession(false);
  if (joinedSessionId) {
    await sb.from('session_participants').delete().eq('session_id', joinedSessionId).eq('user_id', user.id);
    joinedSessionId = null;
  }
  loadLive();
});

async function finishOwnSession(completed) {
  if (!currentSessionId) return;
  await sb.from('focus_sessions').update({ ended_at: new Date().toISOString(), completed }).eq('id', currentSessionId);
  close('timer-modal');
  document.getElementById('complete-summary').textContent =
    `${lastDuration} minutes focused · ${lastSubject}${lastGoal ? ` · Goal: ${lastGoal}` : ''}`;
  open('complete-modal');
  currentSessionId = null;
  loadLive();
}

document.getElementById('share-progress-btn').addEventListener('click', async () => {
  const message = `Just completed a ${lastDuration}-minute ${lastSubject} session. Small progress, but progress.`;
  await createPost(message, 'session_complete');
  close('complete-modal');
});
document.getElementById('start-another-btn').addEventListener('click', () => {
  close('complete-modal');
  open('session-setup-modal');
});

// =========================================================================
// REALTIME
// =========================================================================
sb.channel('hub-posts')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, () => loadFeed())
  .on('postgres_changes', { event: '*', schema: 'public', table: 'reactions' }, () => loadFeed())
  .on('postgres_changes', { event: '*', schema: 'public', table: 'focus_sessions' }, () => loadLive())
  .subscribe();

// =========================================================================
// INIT
// =========================================================================
await loadBlocked();
renderQuickButtons();
loadAnnouncement();
loadFeed();
loadLive();
