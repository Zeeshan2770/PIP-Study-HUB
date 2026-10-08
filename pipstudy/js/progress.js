import { sb } from './supabaseClient.js';
import { requireSession, renderNav } from './app.js';

const session = await requireSession();
if (!session) throw new Error('redirecting');
const { user, profile } = session;
renderNav('progress.html', profile);

const { data: sessions } = await sb
  .from('focus_sessions')
  .select('duration_minutes, started_at, ended_at, completed, goal')
  .eq('user_id', user.id)
  .eq('completed', true)
  .order('started_at', { ascending: false });

const completed = sessions || [];

// ---- headline stats ----
const totalMinutes = completed.reduce((sum, s) => sum + s.duration_minutes, 0);
document.getElementById('stat-time').textContent = `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
document.getElementById('stat-sessions').textContent = completed.length;
document.getElementById('stat-goals').textContent = completed.filter(s => s.goal).length;

// ---- streak: consecutive days (ending today or yesterday) with >=1 completed session ----
const days = new Set(completed.map(s => new Date(s.started_at).toDateString()));
let streak = 0;
let cursor = new Date();
// allow the streak to still count if today has no session yet but yesterday does
if (!days.has(cursor.toDateString())) cursor.setDate(cursor.getDate() - 1);
while (days.has(cursor.toDateString())) {
  streak++;
  cursor.setDate(cursor.getDate() - 1);
}
document.getElementById('stat-streak').textContent = `${streak} day${streak === 1 ? '' : 's'}`;

// ---- last 7 days activity ----
const weekStrip = document.getElementById('week-strip');
const dayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const minutesByDay = new Array(7).fill(0);
const today = new Date();
for (let i = 6; i >= 0; i--) {
  const d = new Date(today);
  d.setDate(today.getDate() - i);
  const dayTotal = completed
    .filter(s => new Date(s.started_at).toDateString() === d.toDateString())
    .reduce((sum, s) => sum + s.duration_minutes, 0);
  minutesByDay[6 - i] = { minutes: dayTotal, label: dayLabels[d.getDay()] };
}
const maxMin = Math.max(1, ...minutesByDay.map(d => d.minutes));
weekStrip.innerHTML = minutesByDay.map(d => `
  <div class="week-day">
    <div class="bar-track"><div class="bar-fill" style="height:${Math.round((d.minutes / maxMin) * 100)}%"></div></div>
    <div class="d">${d.label}</div>
  </div>`).join('');
