# CLAUDE.md

## Overview

Browser tools site — hosted at `tools.nicolaeandrei.com`, deployed to Cloudflare Pages on push to `main`.

## Tech Stack

- **No build step** — plain HTML + vanilla JS, served as static files
- **Styling:** Shared `theme.css` + `theme.js` for light/dark mode. Design tokens: Inter font, `#7c3aed` accent, `#fafaf8` background
- **Deployment:** Cloudflare Pages, output directory `/` (root)

## Structure

```
index.html          ← landing page with search + category sections
theme.css           ← shared light/dark design tokens
theme.js            ← theme toggle injection
*.html              ← self-contained tool files (one per tool)
```

Each tool is a single HTML file in the repo root. No external dependencies beyond CDN libraries. Tools run entirely in the browser.

## Local Dev

```sh
python3 -m http.server 8091               # serve from repo root
open http://127.0.0.1:8091                 # landing page
open http://127.0.0.1:8091/tool_name.html  # individual tool
```

No build, no install, no tests. Just serve and open.

## Adding a New Tool

1. Create `tool_name.html` in repo root — single self-contained file
2. Use this boilerplate head:
   ```html
   <script>document.documentElement.dataset.theme=localStorage.getItem('theme')||(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light')</script>
   <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
   <link rel="stylesheet" href="/theme.css">
   <!-- page-specific <style> goes here -->
   ```
3. End body with `<script src="/theme.js"></script>` for the theme toggle
4. Use `.container` wrapper (override `max-width` if needed), `header` with `<h1>` + back link `<a href="/">&larr; All tools</a>`
5. Add a `<a class="tool-card">` entry in the appropriate category in `index.html`:
   ```html
   <a href="/tool_name.html" class="tool-card"
      data-title="lowercase searchable title"
      data-desc="lowercase description for search"
      data-keywords="space-separated search keywords">
     <span class="tool-title">Display Title</span>
     <span class="tool-desc">One-line description shown on the card.</span>
   </a>
   ```

## Conventions

- **File naming:** `snake_case.html`
- **No frameworks** — vanilla JS only
- **CDN libs OK** — load from jsdelivr/cdnjs/unpkg as needed
- **CSS vars from theme.css:** `--bg`, `--surface`, `--surface-alt`, `--border`, `--border-hover`, `--text`, `--text-muted`, `--accent`, `--accent-hover`, `--accent-dim`, `--green`, `--red`, `--amber`, `--blue` (plus `-dim` variants)
- **Common CSS classes from theme.css:** `.container`, `.btn`, `.btn-primary`, `.btn-secondary`, `.drop-zone`, `.desc`
- **Category sections** in `index.html` use `data-category` attribute — add tools to the right section or create a new one
- **Search** is fuzzy: matches title (3× weight), keywords (2×), description (1×). `/` and `Cmd+F` focus search input

## Related

- Main site repo: `nclandrei/nicolaeandrei.com`
