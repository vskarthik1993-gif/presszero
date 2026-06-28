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

## Hosting and automatic deployment

The site is hosted by GitHub Pages from the `main` branch. GitHub stores the code and serves the website; Hostinger manages the domain's DNS. Every push to `main` deploys automatically.

The custom domain is stored in `CNAME`. In Hostinger, configure these records:

```text
A      @      185.199.108.153
A      @      185.199.109.153
A      @      185.199.110.153
A      @      185.199.111.153
CNAME  www    vskarthik1993-gif.github.io
```

Do not remove email-related MX or TXT records.
