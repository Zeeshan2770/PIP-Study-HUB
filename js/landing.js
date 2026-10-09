// =========================================================================
// LANDING PAGE — interaction layer (navbar shrink, mobile menu, scroll
// reveal, animated stat counters). Pure DOM, no dependencies, safe to load
// only on index.html. Does not touch any Supabase/auth logic — that lives
// in join.js / app.js and is untouched.
// =========================================================================

// ---- Floating navbar: shrink/blur on scroll ----
const nav = document.getElementById('lp-nav');
function onScrollNav() {
  if (!nav) return;
  if (window.scrollY > 24) nav.classList.add('lp-scrolled');
  else nav.classList.remove('lp-scrolled');
}
window.addEventListener('scroll', onScrollNav, { passive: true });
onScrollNav();

// ---- Mobile nav toggle ----
const navToggle = document.getElementById('lp-nav-toggle');
const navMobile = document.getElementById('lp-nav-mobile');
navToggle?.addEventListener('click', () => {
  const open = navToggle.classList.toggle('lp-open');
  navMobile?.classList.toggle('lp-open', open);
  navToggle.setAttribute('aria-expanded', String(open));
});
navMobile?.querySelectorAll('a').forEach((a) => {
  a.addEventListener('click', () => {
    navToggle?.classList.remove('lp-open');
    navMobile.classList.remove('lp-open');
  });
});

// ---- Scroll reveal ----
const revealEls = document.querySelectorAll('[data-reveal]');
if ('IntersectionObserver' in window && revealEls.length) {
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('lp-in');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
  revealEls.forEach((el) => revealObserver.observe(el));
} else {
  revealEls.forEach((el) => el.classList.add('lp-in'));
}
// Safety net: if anything is still hidden a few seconds after load (a
// missed observer callback, an unusual scroll jump, etc.), reveal it
// anyway so content is never permanently stuck invisible.
window.addEventListener('load', () => {
  setTimeout(() => {
    document.querySelectorAll('[data-reveal]:not(.lp-in)').forEach((el) => el.classList.add('lp-in'));
  }, 2500);
});

// ---- Progress bar fill-in (live activity cards) ----
const progressEls = document.querySelectorAll('.lp-progress-fill[data-progress]');
if ('IntersectionObserver' in window && progressEls.length) {
  const progressObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const target = entry.target;
        target.style.width = target.dataset.progress + '%';
        progressObserver.unobserve(target);
      }
    });
  }, { threshold: 0.4 });
  progressEls.forEach((el) => progressObserver.observe(el));
}

// ---- Animated stat counters ----
const counters = document.querySelectorAll('[data-count-to]');
function animateCounter(el) {
  const target = parseInt(el.dataset.countTo, 10);
  const suffix = el.dataset.countSuffix || '';
  if (!Number.isFinite(target)) return;
  const duration = 1400;
  const start = performance.now();
  function tick(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(target * eased) + suffix;
    if (progress < 1) requestAnimationFrame(tick);
    else el.textContent = target + suffix;
  }
  requestAnimationFrame(tick);
}
if ('IntersectionObserver' in window && counters.length) {
  const counterObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        animateCounter(entry.target);
        counterObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.5 });
  counters.forEach((el) => counterObserver.observe(el));
} else {
  counters.forEach((el) => { el.textContent = el.dataset.countTo + (el.dataset.countSuffix || ''); });
}

// ---- Smooth anchor scrolling with fixed-nav offset ----
document.querySelectorAll('a[href^="#"]').forEach((a) => {
  a.addEventListener('click', (e) => {
    const id = a.getAttribute('href');
    if (!id || id === '#') return;
    const target = document.querySelector(id);
    if (!target) return;
    e.preventDefault();
    const y = target.getBoundingClientRect().top + window.scrollY - 96;
    window.scrollTo({ top: y, behavior: 'smooth' });
  });
});
