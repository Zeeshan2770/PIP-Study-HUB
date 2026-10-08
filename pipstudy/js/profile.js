import { sb } from './supabaseClient.js';
import { requireSession, renderNav, logout, showToast, initial, escapeHtml, avatarInner, uploadAvatar, removeAvatar } from './app.js';

const session = await requireSession();
if (!session) throw new Error('redirecting');
const { user, profile } = session;
renderNav('profile.html', profile);

const avatarEl = document.getElementById('profile-avatar');
const removeAvatarBtn = document.getElementById('remove-avatar-btn');
const avatarFileInput = document.getElementById('avatar-file-input');

function renderAvatar() {
  avatarEl.innerHTML = avatarInner(profile.name, profile.avatar_url);
  removeAvatarBtn.classList.toggle('hidden', !profile.avatar_url);
}
renderAvatar();
document.getElementById('profile-name').textContent = profile.name;
document.getElementById('profile-admin-badge').innerHTML = profile.role === 'admin' ? '<span class="name-badge">★ Admin</span>' : '';
document.getElementById('profile-meta').textContent = `${profile.school} · ${profile.class}`;
document.getElementById('edit-name').value = profile.name;
document.getElementById('edit-school').value = profile.school;
document.getElementById('edit-class').value = profile.class;

document.getElementById('logout-btn').addEventListener('click', logout);

avatarFileInput.addEventListener('change', async () => {
  const file = avatarFileInput.files?.[0];
  avatarFileInput.value = ''; // allow re-selecting the same file later
  if (!file) return;

  avatarEl.classList.add('uploading');
  avatarEl.insertAdjacentHTML('beforeend', '<div class="avatar-spinner">…</div>');
  try {
    const url = await uploadAvatar(file, user.id);
    profile.avatar_url = url;
    renderAvatar();
    renderNav('profile.html', profile); // refresh the nav-avatar too
    showToast('Profile picture updated.');
  } catch (err) {
    showToast(err.message || "Couldn't upload that image.");
    renderAvatar(); // clear the spinner, restore whatever was showing before
  } finally {
    avatarEl.classList.remove('uploading');
  }
});

removeAvatarBtn.addEventListener('click', async () => {
  try {
    await removeAvatar(user.id);
    profile.avatar_url = null;
    renderAvatar();
    renderNav('profile.html', profile);
    showToast('Profile picture removed.');
  } catch (err) {
    showToast(err.message || "Couldn't remove your photo.");
  }
});

document.getElementById('edit-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('edit-name').value.trim();
  const school = document.getElementById('edit-school').value.trim();
  const klass = document.getElementById('edit-class').value.trim();

  // Note: only name/school/class can be changed here — role, status, and
  // marks are protected server-side by the profiles guardrail trigger.
  const { error } = await sb.from('profiles').update({ name, school, class: klass }).eq('id', user.id);
  if (error) return showToast(`Couldn't save: ${error.message}`);
  showToast('Profile updated.');
  profile.name = name;
  renderAvatar(); // initials fallback depends on name
  document.getElementById('profile-name').textContent = name;
  document.getElementById('profile-meta').textContent = `${school} · ${klass}`;
  renderNav('profile.html', profile);
});

const { data: sessions } = await sb
  .from('focus_sessions')
  .select('duration_minutes, started_at, completed')
  .eq('user_id', user.id)
  .eq('completed', true);

const completed = sessions || [];
const totalMinutes = completed.reduce((sum, s) => sum + s.duration_minutes, 0);
document.getElementById('p-time').textContent = `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
document.getElementById('p-sessions').textContent = completed.length;

const days = new Set(completed.map(s => new Date(s.started_at).toDateString()));
let streak = 0;
let cursor = new Date();
if (!days.has(cursor.toDateString())) cursor.setDate(cursor.getDate() - 1);
while (days.has(cursor.toDateString())) { streak++; cursor.setDate(cursor.getDate() - 1); }
document.getElementById('p-streak').textContent = `${streak}d`;
