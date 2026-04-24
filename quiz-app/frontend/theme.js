(function () {
  var KEY = 'quiz.theme';
  try {
    var saved = localStorage.getItem(KEY);
    if (saved !== 'light' && saved !== 'dark') saved = 'dark';
    document.documentElement.setAttribute('data-theme', saved);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') || 'dark';
  }
  function iconFor(theme) { return theme === 'dark' ? '☀️' : '🌙'; }
  function labelFor(theme) { return theme === 'dark' ? 'Light mode' : 'Dark mode'; }

  function paintToggles() {
    var theme = currentTheme();
    document.querySelectorAll('.theme-toggle').forEach(function (btn) {
      var iconEl = btn.querySelector('.theme-icon');
      if (iconEl) iconEl.textContent = iconFor(theme);
      btn.setAttribute('aria-label', labelFor(theme));
      btn.title = labelFor(theme);
    });
  }

  window.toggleTheme = function () {
    var next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(KEY, next); } catch (e) {}
    paintToggles();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', paintToggles);
  } else {
    paintToggles();
  }
})();
