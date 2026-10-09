import { sb } from './supabaseClient.js';
import { requireSession, showToast, escapeHtml, timeAgo, initial, avatarInner, mountCreditPill } from './app.js';

// admin.html has its own sidebar layout rather than the shared #app-nav /
// #bottom-nav shell, so renderNav() (which no-ops without those elements)
// isn't used here — but the floating credit pill is still mounted directly.
mountCreditPill();

// requireAdmin:true — but this is a convenience redirect only. The real
// protection is server-side: every admin-only write below is enforced by
// the profiles/posts/reports/announcements RLS policies in schema.sql.
const session = await requireSession({ requireAdmin: true });
if (!session) throw new Error('redirecting');
const { user, profile } = session;

document.getElementById('admin-logout').addEventListener('click', async () => {
  await sb.auth.signOut();
  window.location.href = 'index.html';
});

// -------------------------------------------------------------------------
// Tab routing
// -------------------------------------------------------------------------
const titles = {
  overview: 'Overview', approvals: 'Approvals', students: 'Students',
  posts: 'Community posts', reports: 'Reports', announcements: 'Announcements',
  sessions: 'Focus sessions', 'group-requests': 'Group requests',
};

// NOTE: `loaders` is declared here — *before* showSection is defined and
// invoked below — on purpose. The functions it points to (loadOverview,
// loadApprovals, etc.) are `async function` declarations further down this
// file, which JS hoists in full, so referencing them here is safe. But
// `loaders` itself is a `const` object literal, which is NOT hoisted the
// same way: it only becomes accessible at the line it's declared on (the
// "temporal dead zone"). It previously sat at the very bottom of the file,
// while `showSection((window.location.hash || '#overview').slice(1))` ran
// near the top and called `loaders[name]?.()` immediately on page load —
// throwing "Cannot access 'loaders' before initialization" before any tab
// could ever fetch its data. That's the root cause of every tab being
// stuck on "Loading…". Keep this declaration above its first use.
const loaders = {
  overview: () => loadOverview(), approvals: () => loadApprovals(), students: () => loadStudents(),
  posts: () => loadPosts(), reports: () => loadReports(), announcements: () => loadAnnouncements(),
  sessions: () => loadSessions(), 'group-requests': () => loadGroupRequests(),
};

async function showSection(name) {
  document.querySelectorAll('[data-panel]').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== name));
  document.querySelectorAll('[data-section]').forEach(a => a.classList.toggle('active', a.dataset.section === name));
  document.getElementById('admin-title').innerHTML = `${titles[name] || name} <span class="admin-badge">ADMIN</span>`;
  const load = loaders[name];
  if (!load) return;
  try {
    await load();
  } catch (err) {
    // A tab must never be left silently stuck on "Loading…" — surface the
    // failure both as a toast and inline in that tab's table, and log full
    // details to the console for debugging without exposing internals to
    // the user-facing toast text.
    console.error(`Admin panel: "${name}" tab failed to load`, err);
    showToast(`Couldn't load ${titles[name] || name}. Check the console for details.`);
    const panel = document.querySelector(`[data-panel="${name}"]`);
    const body = panel?.querySelector('tbody');
    if (body) {
      const cols = body.closest('table')?.querySelectorAll('thead th').length || 1;
      body.innerHTML = `<tr><td colspan="${cols}" class="muted">Something went wrong loading this tab. Try refreshing, or check your connection.</td></tr>`;
    }
  }
}
document.querySelectorAll('[data-section]').forEach(a => {
  a.addEventListener('click', (e) => { e.preventDefault(); showSection(a.dataset.section); window.location.hash = a.dataset.section; });
});
showSection((window.location.hash || '#overview').slice(1));

// =========================================================================
// OVERVIEW
// =========================================================================
async function loadOverview() {
  const [{ count: total }, { count: active }, { count: pending }, { count: reports }] = await Promise.all([
    sb.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'student'),
    sb.from('focus_sessions').select('id', { count: 'exact', head: true }).is('ended_at', null),
    sb.from('profiles').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    sb.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'open'),
  ]);
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const { count: today } = await sb.from('focus_sessions').select('id', { count: 'exact', head: true }).gte('started_at', startOfDay.toISOString());

  document.getElementById('stat-total').textContent = total ?? 0;
  document.getElementById('stat-active').textContent = active ?? 0;
  document.getElementById('stat-pending').textContent = pending ?? 0;
  document.getElementById('stat-reports').textContent = reports ?? 0;
  document.getElementById('stat-today').textContent = today ?? 0;
}

// =========================================================================
// APPROVALS
// =========================================================================
async function loadApprovals() {
  const { data } = await sb
    .from('profiles')
    .select('id, name, school, class, marks, email, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  const body = document.getElementById('approvals-body');
  if (!data || !data.length) {
    body.innerHTML = `<tr><td colspan="7" class="muted">No pending approvals — you're all caught up.</td></tr>`;
    return;
  }
  body.innerHTML = data.map(p => `
    <tr>
      <td>${escapeHtml(p.name)}</td>
      <td>${escapeHtml(p.school)}</td>
      <td>${escapeHtml(p.class)}</td>
      <td>${escapeHtml(p.marks || '—')}</td>
      <td>${new Date(p.created_at).toLocaleDateString()}</td>
      <td>${escapeHtml(p.email)}</td>
      <td class="row-actions">
        <button class="btn btn-sm btn-gold" data-approve="${p.id}">Approve</button>
        <button class="btn btn-sm btn-danger" data-reject="${p.id}">Reject</button>
      </td>
    </tr>`).join('');

  body.querySelectorAll('[data-approve]').forEach(btn => btn.addEventListener('click', () => setStatus(btn.dataset.approve, 'approved', loadApprovals)));
  body.querySelectorAll('[data-reject]').forEach(btn => btn.addEventListener('click', () => setStatus(btn.dataset.reject, 'suspended', loadApprovals)));
}

async function setStatus(id, status, after) {
  const { error } = await sb.from('profiles').update({ status }).eq('id', id);
  if (error) return showToast(`Couldn't update: ${error.message}`);
  showToast(status === 'approved' ? 'Student approved.' : status === 'suspended' ? 'Student rejected / suspended.' : 'Updated.');
  after?.();
  loadOverview();
}

// =========================================================================
// STUDENTS
// =========================================================================
let allStudents = [];
async function loadStudents() {
  const { data } = await sb.from('profiles').select('id, name, school, class, role, status, created_at, avatar_url').order('created_at', { ascending: false });
  allStudents = data || [];
  renderStudents(allStudents);
}
function renderStudents(rows) {
  const body = document.getElementById('students-body');
  if (!rows.length) { body.innerHTML = `<tr><td colspan="6" class="muted">No students found.</td></tr>`; return; }
  body.innerHTML = rows.map(p => `
    <tr>
      <td><span class="table-avatar">${avatarInner(p.name, p.avatar_url)}</span><span class="table-name">${escapeHtml(p.name)}</span></td>
      <td>${escapeHtml(p.school)} · ${escapeHtml(p.class)}</td>
      <td><span class="pill pill-${p.role}">${p.role}</span></td>
      <td><span class="pill pill-${p.status}">${p.status}</span></td>
      <td>${new Date(p.created_at).toLocaleDateString()}</td>
      <td class="row-actions">
        ${p.status !== 'suspended'
          ? `<button class="btn btn-sm btn-danger" data-suspend="${p.id}">Suspend</button>`
          : `<button class="btn btn-sm btn-gold" data-unsuspend="${p.id}">Unsuspend</button>`}
      </td>
    </tr>`).join('');
  body.querySelectorAll('[data-suspend]').forEach(btn => btn.addEventListener('click', () => setStatus(btn.dataset.suspend, 'suspended', loadStudents)));
  body.querySelectorAll('[data-unsuspend]').forEach(btn => btn.addEventListener('click', () => setStatus(btn.dataset.unsuspend, 'approved', loadStudents)));
}
document.getElementById('student-search').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase();
  renderStudents(allStudents.filter(p => p.name.toLowerCase().includes(q) || p.school.toLowerCase().includes(q)));
});

// =========================================================================
// POSTS
// =========================================================================
let allPosts = [];
async function loadPosts() {
  const { data: posts } = await sb.from('posts').select('id, user_id, message, removed, created_at').order('created_at', { ascending: false }).limit(100);
  const authorIds = [...new Set((posts || []).map(p => p.user_id))];
  const { data: authors } = authorIds.length ? await sb.from('profiles').select('id, name').in('id', authorIds) : { data: [] };
  const authorMap = Object.fromEntries((authors || []).map(a => [a.id, a.name]));
  allPosts = (posts || []).map(p => ({ ...p, authorName: authorMap[p.user_id] || 'Unknown' }));
  renderPosts(allPosts);
}
function renderPosts(rows) {
  const body = document.getElementById('posts-body');
  if (!rows.length) { body.innerHTML = `<tr><td colspan="4" class="muted">No posts found.</td></tr>`; return; }
  body.innerHTML = rows.map(p => `
    <tr>
      <td>${escapeHtml(p.authorName)}</td>
      <td>${escapeHtml(p.message)}${p.removed ? ' <span class="pill pill-suspended">removed</span>' : ''}</td>
      <td>${timeAgo(p.created_at)}</td>
      <td class="row-actions">
        ${!p.removed ? `<button class="btn btn-sm btn-danger" data-remove="${p.id}">Remove</button>` : `<button class="btn btn-sm btn-line" data-restore="${p.id}">Restore</button>`}
      </td>
    </tr>`).join('');
  body.querySelectorAll('[data-remove]').forEach(btn => btn.addEventListener('click', () => setPostRemoved(btn.dataset.remove, true)));
  body.querySelectorAll('[data-restore]').forEach(btn => btn.addEventListener('click', () => setPostRemoved(btn.dataset.restore, false)));
}
async function setPostRemoved(id, removed) {
  const { error } = await sb.from('posts').update({ removed }).eq('id', id);
  if (error) return showToast(`Couldn't update post: ${error.message}`);
  showToast(removed ? 'Post removed.' : 'Post restored.');
  loadPosts();
}
document.getElementById('post-search').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase();
  renderPosts(allPosts.filter(p => p.message.toLowerCase().includes(q) || p.authorName.toLowerCase().includes(q)));
});

// =========================================================================
// REPORTS
// =========================================================================
async function loadReports() {
  const { data: reports } = await sb.from('reports').select('id, post_id, reporter_id, reason, status, created_at').order('created_at', { ascending: false });
  const body = document.getElementById('reports-body');
  if (!reports || !reports.length) { body.innerHTML = `<tr><td colspan="6" class="muted">No reports yet.</td></tr>`; return; }

  const postIds = [...new Set(reports.map(r => r.post_id))];
  const reporterIds = [...new Set(reports.map(r => r.reporter_id))];
  const { data: posts } = await sb.from('posts').select('id, message').in('id', postIds);
  const { data: reporters } = await sb.from('profiles').select('id, name').in('id', reporterIds);
  const postMap = Object.fromEntries((posts || []).map(p => [p.id, p.message]));
  const nameMap = Object.fromEntries((reporters || []).map(r => [r.id, r.name]));

  body.innerHTML = reports.map(r => `
    <tr>
      <td>${escapeHtml((postMap[r.post_id] || '(post removed)').slice(0, 60))}</td>
      <td>${escapeHtml(nameMap[r.reporter_id] || 'Unknown')}</td>
      <td>${escapeHtml(r.reason)}</td>
      <td>${new Date(r.created_at).toLocaleDateString()}</td>
      <td><span class="pill pill-${r.status}">${r.status}</span></td>
      <td class="row-actions">
        <button class="btn btn-sm btn-danger" data-removepost="${r.post_id}" data-report="${r.id}">Remove post</button>
        <button class="btn btn-sm btn-line" data-dismiss="${r.id}">Dismiss</button>
      </td>
    </tr>`).join('');

  body.querySelectorAll('[data-removepost]').forEach(btn => btn.addEventListener('click', async () => {
    await sb.from('posts').update({ removed: true }).eq('id', btn.dataset.removepost);
    await sb.from('reports').update({ status: 'reviewed', reviewed_by: user.id }).eq('id', btn.dataset.report);
    showToast('Post removed and report marked reviewed.');
    loadReports(); loadOverview();
  }));
  body.querySelectorAll('[data-dismiss]').forEach(btn => btn.addEventListener('click', async () => {
    await sb.from('reports').update({ status: 'dismissed', reviewed_by: user.id }).eq('id', btn.dataset.dismiss);
    showToast('Report dismissed.');
    loadReports(); loadOverview();
  }));
}

// =========================================================================
// ANNOUNCEMENTS
// =========================================================================
document.getElementById('announcement-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = document.getElementById('ann-title').value.trim();
  const message = document.getElementById('ann-message').value.trim();
  const { error } = await sb.from('announcements').insert({ admin_id: user.id, title, message, active: true });
  if (error) return showToast(`Couldn't post: ${error.message}`);
  document.getElementById('announcement-form').reset();
  showToast('Announcement posted.');
  loadAnnouncements();
});

async function loadAnnouncements() {
  const { data } = await sb.from('announcements').select('id, title, message, active, created_at').order('created_at', { ascending: false });
  const body = document.getElementById('announcements-body');
  if (!data || !data.length) { body.innerHTML = `<tr><td colspan="5" class="muted">No announcements yet.</td></tr>`; return; }
  body.innerHTML = data.map(a => `
    <tr>
      <td>${escapeHtml(a.title)}</td>
      <td>${escapeHtml(a.message.slice(0, 60))}</td>
      <td><span class="pill pill-${a.active ? 'approved' : 'suspended'}">${a.active ? 'active' : 'inactive'}</span></td>
      <td>${new Date(a.created_at).toLocaleDateString()}</td>
      <td class="row-actions">
        <button class="btn btn-sm btn-line" data-toggle="${a.id}" data-active="${a.active}">${a.active ? 'Deactivate' : 'Activate'}</button>
      </td>
    </tr>`).join('');
  body.querySelectorAll('[data-toggle]').forEach(btn => btn.addEventListener('click', async () => {
    const nowActive = btn.dataset.active === 'true';
    await sb.from('announcements').update({ active: !nowActive }).eq('id', btn.dataset.toggle);
    loadAnnouncements();
  }));
}

// =========================================================================
// FOCUS SESSIONS
// =========================================================================
async function loadSessions() {
  const { data: sessions } = await sb
    .from('focus_sessions')
    .select('id, user_id, subject, goal, duration_minutes, started_at, ended_at')
    .order('started_at', { ascending: false })
    .limit(50);
  const body = document.getElementById('sessions-body');
  if (!sessions || !sessions.length) { body.innerHTML = `<tr><td colspan="7" class="muted">No sessions yet.</td></tr>`; return; }

  const userIds = [...new Set(sessions.map(s => s.user_id))];
  const { data: students } = await sb.from('profiles').select('id, name').in('id', userIds);
  const nameMap = Object.fromEntries((students || []).map(s => [s.id, s.name]));

  body.innerHTML = sessions.map(s => `
    <tr>
      <td>${escapeHtml(nameMap[s.user_id] || 'Unknown')}</td>
      <td>${escapeHtml(s.subject)}</td>
      <td>${escapeHtml(s.goal || '—')}</td>
      <td>${s.duration_minutes}m</td>
      <td>${timeAgo(s.started_at)}</td>
      <td>${s.ended_at ? '<span class="pill pill-reviewed">ended</span>' : '<span class="pill pill-approved">active</span>'}</td>
      <td class="row-actions">
        ${!s.ended_at ? `<button class="btn btn-sm btn-danger" data-terminate="${s.id}">Terminate</button>` : ''}
      </td>
    </tr>`).join('');

  body.querySelectorAll('[data-terminate]').forEach(btn => btn.addEventListener('click', async () => {
    await sb.from('focus_sessions').update({ ended_at: new Date().toISOString(), completed: false, terminated_by_admin: true }).eq('id', btn.dataset.terminate);
    showToast('Session terminated.');
    loadSessions(); loadOverview();
  }));
}

// =========================================================================
// GROUP JOIN REQUESTS (from the public landing-page WhatsApp form)
// =========================================================================
let allGroupRequests = [];
async function loadGroupRequests() {
  const { data, error } = await sb
    .from('group_join_requests')
    .select('id, name, marks, class, school, whatsapp_number, created_at')
    .order('created_at', { ascending: false });
  if (error) {
    document.getElementById('group-requests-body').innerHTML = `<tr><td colspan="6" class="muted">Couldn't load: ${escapeHtml(error.message)}</td></tr>`;
    return;
  }
  allGroupRequests = data || [];
  renderGroupRequests(allGroupRequests);
}
function renderGroupRequests(rows) {
  const body = document.getElementById('group-requests-body');
  if (!rows.length) { body.innerHTML = `<tr><td colspan="6" class="muted">No group join requests yet.</td></tr>`; return; }
  body.innerHTML = rows.map(r => `
    <tr>
      <td>${escapeHtml(r.name)}</td>
      <td>${escapeHtml(r.marks)}</td>
      <td>${escapeHtml(r.class)}</td>
      <td>${escapeHtml(r.school)}</td>
      <td><a href="https://wa.me/${escapeHtml(r.whatsapp_number.replace(/[^0-9]/g, ''))}" target="_blank" rel="noopener">${escapeHtml(r.whatsapp_number)}</a></td>
      <td>${new Date(r.created_at).toLocaleString()}</td>
    </tr>`).join('');
}
document.getElementById('group-request-search').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase();
  renderGroupRequests(allGroupRequests.filter(r => r.name.toLowerCase().includes(q) || r.school.toLowerCase().includes(q)));
});
