# CLAUDE.md

## Overview

Browser tools site for Andrei-Mihai Nicolae — hosted at `tools.nicolaeandrei.com`, deployed to Cloudflare Pages on push to `main`.

## Tech Stack

- **No build step** — plain HTML + vanilla JS, served as static files
- **Styling:** Inline `<style>` in `index.html`, design tokens match the main site (Inter font, `#7c3aed` accent, `#fafaf8` background)
- **Deployment:** Cloudflare Pages, output directory `/` (root)

## Structure

```
index.html          ← landing page with search + category sections
*.html              ← self-contained tool files (16 total)
```

Each tool is a single HTML file with no external dependencies beyond CDN libraries. Tools run entirely in the browser.

## Adding a New Tool

1. Drop the HTML file in the repo root
2. Add a `<a class="tool-card">` entry in the appropriate category section in `index.html`
3. Include `data-title`, `data-desc`, and `data-keywords` attributes for search

## Search

The landing page has fuzzy search (same algorithm as the old Astro tools page). Matches against title (3x weight), keywords (2x weight), and description (1x weight). `/` and `Cmd+F` focus the search input.

When searching, cards are pulled out of their category containers into a flat ranked list. When the search is cleared, cards return to their original categories.

## Categories

Tools are grouped into themed sections:
- **Image & media** — Document Scanner, Image ↔ SVG Converter, Asset Resizer
- **Text & document** — Sheet Converter, DOCX → PDF, Markdown → PDF, Paste Formatter
- **Data & health** — Apple Health Explorer, Fuel Log, Gym Tracker
- **Sumo** — Sumo Day Companion, Sumo Stats, Grand Sumo Calendar
- **Travel & social** — Wanderlog, Fedi Media Extractor
- **Developer** — AI Agent Session Converter

## Related

- Main site: `nicolaeandrei.com` (repo: `nclandrei/nicolaeandrei.com`)
- Nav links on the main site point to `tools.nicolaeandrei.com`
