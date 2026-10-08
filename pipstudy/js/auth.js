import { sb } from './supabaseClient.js';
import { mountCreditPill } from './app.js';

// Clears any in-progress redirect-loop trace so a fresh login always starts clean.
try { sessionStorage.removeItem('pip2_redirect_trace'); } catch { /* ignore */ }

mountCreditPill();

const tabs = document.querySelectorAll('.auth-tab');
const panels = document.querySelectorAll('.auth-panel');
const errorBox = document.getElementById('form-error');

function setTab(name) {
  tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  panels.forEach(p => p.classList.toggle('active', p.dataset.panel === name));
  errorBox.classList.remove('show');
}

tabs.forEach(t => t.addEventListener('click', () => setTab(t.dataset.tab)));
document.querySelectorAll('[data-switch]').forEach(a => {
  a.addEventListener('click', (e) => { e.preventDefault(); setTab(a.dataset.switch); });
});

// Open on the tab requested via ?tab=signup, default to login.
const initialTab = new URLSearchParams(window.location.search).get('tab') === 'signup' ? 'signup' : 'login';
setTab(initialTab);

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.add('show');
}

// -------------------------------------------------------------------------
// LOGIN
// -------------------------------------------------------------------------
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBox.classList.remove('show');
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return showError(error.message);

  const { data: profile } = await sb
    .from('profiles')
    .select('status')
    .eq('id', data.user.id)
    .single();

  if (!profile) return showError('We could not find a profile for this account.');
  if (profile.status === 'pending') window.location.href = 'pending.html';
  else if (profile.status === 'suspended') window.location.href = 'suspended.html';
  else window.location.href = 'hub.html';
});

// -------------------------------------------------------------------------
// SIGN UP
// The profiles row is created automatically by a database trigger the
// instant the auth user is created (see schema.sql → handle_new_user).
// This form just passes the extra details along as user metadata — it
// never inserts into profiles itself, so there's no RLS-timing race and
// it works the same whether "Confirm email" is on or off.
// -------------------------------------------------------------------------
document.getElementById('signup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBox.classList.remove('show');

  const name = document.getElementById('su-name').value.trim();
  const email = document.getElementById('su-email').value.trim();
  const password = document.getElementById('su-password').value;
  const school = document.getElementById('su-school').value.trim();
  const klass = document.getElementById('su-class').value.trim();
  const marks = document.getElementById('su-marks').value.trim();

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Creating account…';

  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { data: { name, school, class: klass, marks } },
  });

  submitBtn.disabled = false;
  submitBtn.textContent = 'Create account';

  if (error) return showError(error.message);

  if (!data.session) {
    // "Confirm email" is switched on in Supabase — the account (and its
    // profile row) already exist, they just need to click the email link
    // before they can log in.
    return showError('Account created! Check your email to confirm it, then log in.');
  }

  window.location.href = 'pending.html';
});
