# PressZero website

Static marketing site for [presszero.in](https://presszero.in).

## Local preview

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Product routes and deployment

Each path is a separate product surface with its own content directory. Common PressZero branding and site metadata stay at the root. Product assets and experiences live in their own directory, such as `auto/`, `health/`, or `pmw/`.

`site-routes.json` lists every required path and its entrypoint. The Pages workflow checks this manifest before publishing and refuses a snapshot with a missing route. To add a path, add its `index.html` and assets, then add the entry to the manifest in the same `main` change.

Create a folder with an `index.html` inside it:

```text
about/index.html       → https://presszero.in/about/
contact/index.html     → https://presszero.in/contact/
```

Add the new URL to `sitemap.xml` when the page should appear in search engines.

## Hosting and automatic deployment

GitHub Pages is configured to publish through the repository's GitHub Actions workflow. The `main` branch is the sole source of complete site snapshots. Each publish replaces the whole domain tree, so direct deployment from a product-specific branch can remove paths owned by other products. Product changes should be committed under their own path in `main`; the shared workflow validates all required paths and publishes them together. A push to `gh-pages` must never publish the site.

The custom domain is stored in `CNAME`. In Hostinger, configure these records:

```text
A      @      185.199.108.153
A      @      185.199.109.153
A      @      185.199.110.153
A      @      185.199.111.153
CNAME  www    vskarthik1993-gif.github.io
```

Do not remove email-related MX or TXT records.
