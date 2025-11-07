
const themeToggle = document.getElementById('theme-toggle');
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
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem('theme', next);
  themeToggle.animate([{opacity:0.5},{opacity:1}],{duration:200});
});

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

// Optional scroll reveal
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if(entry.isIntersecting) {
      entry.target.classList.add('reveal');
      observer.unobserve(entry.target);
    }
  });
},{threshold:0.1});

document.querySelectorAll('.section, .card, .hero-inner').forEach(el => {
  observer.observe(el);
});
