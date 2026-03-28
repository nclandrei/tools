// Theme toggle — reads localStorage, falls back to prefers-color-scheme
(function () {
  // Theme is already set by the inline <script> in <head>, so we just inject the toggle
  const theme = document.documentElement.dataset.theme;

  const btn = document.createElement('button');
  btn.className = 'theme-toggle';
  btn.setAttribute('aria-label', 'Toggle theme');
  btn.textContent = theme === 'dark' ? '\u2600' : '\u263E';

  btn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('theme', next);
    btn.textContent = next === 'dark' ? '\u2600' : '\u263E';
  });

  document.body.appendChild(btn);
})();
