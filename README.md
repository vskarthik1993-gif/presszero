# PressZero website

Static marketing site for [presszero.in](https://presszero.in).

## Local preview

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Add a page with a trailing-slash URL

Create a folder with an `index.html` inside it:

```text
about/index.html       → https://presszero.in/about/
contact/index.html     → https://presszero.in/contact/
```

Add the new URL to `sitemap.xml` when the page should appear in search engines.

## Deploy on Vercel

Import this Git repository into Vercel as a static site. No framework preset, build command, or output directory is required. Every push to `main` deploys automatically.

Add `presszero.in` and `www.presszero.in` in the Vercel project's Domains settings, then apply the DNS records Vercel provides at the domain registrar. Keep the existing `CNAME` file until the Vercel deployment and DNS change are complete so the current GitHub Pages site remains available during the move.

`vercel.json` enables clean trailing-slash URLs, redirects the old landing-page filename, adds security headers, and caches assets.
