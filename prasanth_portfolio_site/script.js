
/* Theme toggle honoring system preference and localStorage */
const themeToggle = document.getElementById('theme-toggle');
const root = document.documentElement;
const nav = document.getElementById('main-nav');

function applyTheme(theme){
  if(theme === 'dark'){
    document.documentElement.style.colorScheme = 'dark';
    document.documentElement.setAttribute('data-theme','dark');
  } else {
    document.documentElement.style.colorScheme = 'light';
    document.documentElement.setAttribute('data-theme','light');
  }
}

function getPreferredTheme(){
  const stored = localStorage.getItem('theme');
  if(stored) return stored;
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  return media.matches ? 'dark' : 'light';
}

applyTheme(getPreferredTheme());

themeToggle.addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const next = cur === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem('theme', next);
  themeToggle.animate([{opacity:0.5},{opacity:1}],{duration:200});
});

/* Sticky nav shadow effect on scroll */
const headerHeight = document.querySelector('.site-header').offsetHeight;
window.addEventListener('scroll', () => {
  if(window.scrollY > headerHeight + 10){
    nav.classList.add('scrolled');
    document.querySelector('.nav-avatar').style.transform = 'translateY(-4px)';
  } else {
    nav.classList.remove('scrolled');
    document.querySelector('.nav-avatar').style.transform = 'translateY(0)';
  }
});

/* Small flourish animations */
document.querySelectorAll('.card, .btn, .nav-links a').forEach(el => {
  el.addEventListener('mouseenter', () => el.style.transform = 'translateY(-6px)');
  el.addEventListener('mouseleave', () => el.style.transform = '');
});

/* Contact form handler (no backend; opens mailto) */
function handleContact(e){
  e.preventDefault();
  const name = document.getElementById('name').value.trim();
  const email = document.getElementById('email').value.trim();
  const message = document.getElementById('message').value.trim();
  const subject = encodeURIComponent('Portfolio Contact from ' + name);
  const body = encodeURIComponent(message + '\n\nFrom: ' + name + ' (' + email + ')');
  window.location.href = `mailto:prasanthebenezer@gmail.com?subject=${subject}&body=${body}`;
  return false;
}

/* Smooth reveal on scroll */
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if(entry.isIntersecting) entry.target.classList.add('inview');
  });
},{threshold:0.12});

document.querySelectorAll('.section, .card, .hero-inner').forEach(el => {
  el.style.opacity = 0;
  el.style.transform = 'translateY(12px)';
  el.style.transition = 'opacity 600ms ease, transform 600ms ease';
  observer.observe(el);
});
