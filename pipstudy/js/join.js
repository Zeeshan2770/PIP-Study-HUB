// =========================================================================
// LANDING PAGE — "Join the WhatsApp group" gate + Share
// No login required. Collects Name / Marks / Class / School / WhatsApp
// number, saves it to Supabase (readable only by admins, see schema.sql),
// then hands the visitor the real WhatsApp invite link.
// =========================================================================
import { sb } from './supabaseClient.js';
import { showToast } from './app.js';

const WHATSAPP_GROUP_LINK = 'https://chat.whatsapp.com/JevwTNVC1gk5yV8DYhfe2K';

const modal = document.getElementById('join-modal');
const openBtn = document.getElementById('open-join-modal');
const closeBtn = document.getElementById('join-modal-close');
const form = document.getElementById('join-form');
const errorBox = document.getElementById('join-form-error');
const submitBtn = document.getElementById('join-submit-btn');

function openModal() {
  errorBox.textContent = '';
  errorBox.style.display = 'none';
  form.reset();
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function closeModal() {
  modal.classList.add('hidden');
  document.body.style.overflow = '';
}

openBtn?.addEventListener('click', openModal);
closeBtn?.addEventListener('click', closeModal);
modal?.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBox.style.display = 'none';

  const name = document.getElementById('join-name').value.trim();
  const marks = document.getElementById('join-marks').value.trim();
  const klass = document.getElementById('join-class').value.trim();
  const school = document.getElementById('join-school').value.trim();
  const whatsapp = document.getElementById('join-whatsapp').value.trim();

  if (!name || !marks || !klass || !school || !whatsapp) {
    errorBox.textContent = 'Please fill in every field correctly to get approved.';
    errorBox.style.display = 'block';
    return;
  }
  const digits = whatsapp.replace(/[^0-9]/g, '');
  if (digits.length < 10) {
    errorBox.textContent = 'Please enter a valid WhatsApp number (with country code).';
    errorBox.style.display = 'block';
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting…';

  const { error } = await sb.from('group_join_requests').insert({
    name, marks, class: klass, school, whatsapp_number: whatsapp,
  });

  submitBtn.disabled = false;
  submitBtn.textContent = 'Submit & join group →';

  if (error) {
    errorBox.textContent = `Couldn't submit: ${error.message}`;
    errorBox.style.display = 'block';
    return;
  }

  closeModal();
  showToast('Details received! Opening the WhatsApp group…');
  window.open(WHATSAPP_GROUP_LINK, '_blank', 'noopener');
});

// -------------------------------------------------------------------------
// Share this page
// -------------------------------------------------------------------------
document.getElementById('share-btn')?.addEventListener('click', async () => {
  const shareData = {
    title: 'Partners in Progress',
    text: 'Different goals. Shared discipline. Join this study community 📚',
    url: window.location.href,
  };
  if (navigator.share) {
    try { await navigator.share(shareData); } catch (_) { /* user cancelled */ }
    return;
  }
  try {
    await navigator.clipboard.writeText(shareData.url);
    showToast('Link copied to clipboard!');
  } catch (_) {
    showToast('Copy this link: ' + shareData.url);
  }
});
