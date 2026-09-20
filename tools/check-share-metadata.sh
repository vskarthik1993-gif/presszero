#!/usr/bin/env bash
set -euo pipefail

expected_title='PressZero - Voice AI, Humanised'
expected_description='Automate the top and middle funnels. Let humans close the bottom funnel.'
expected_image='https://presszero.in/assets/presszero-share-whatsapp-v2.jpg'

html_count=0
while IFS= read -r file; do
  ((html_count += 1))
  required=(
    "<meta property=\"og:title\" content=\"${expected_title}\""
    "<meta property=\"og:description\" content=\"${expected_description}\""
    "<meta property=\"og:image\" content=\"${expected_image}\""
    '<meta property="og:image:type" content="image/jpeg"'
    '<meta property="og:image:width" content="1200"'
    '<meta property="og:image:height" content="630"'
    "<meta name=\"twitter:title\" content=\"${expected_title}\""
    "<meta name=\"twitter:description\" content=\"${expected_description}\""
    "<meta name=\"twitter:image\" content=\"${expected_image}\""
    '<link rel="icon" href="/assets/favicon-512.png"'
    '<link rel="icon" href="/assets/favicon-android-1024.png"'
    '<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png"'
  )

  for value in "${required[@]}"; do
    if ! grep -Fq "$value" "$file"; then
      echo "Metadata regression in ${file}: missing ${value}" >&2
      exit 1
    fi
  done
done < <(find . -type f -name '*.html' -not -path './.git/*' | sort)

if [[ $html_count -eq 0 ]]; then
  echo 'No HTML documents found.' >&2
  exit 1
fi

for asset in \
  assets/presszero-share-whatsapp-v2.jpg \
  assets/favicon-512.png \
  assets/favicon-android-1024.png \
  assets/apple-touch-icon.png; do
  if [[ ! -s "$asset" ]]; then
    echo "Required sharing asset is missing or empty: ${asset}" >&2
    exit 1
  fi
done

preview_size=$(wc -c < assets/presszero-share-whatsapp-v2.jpg)
if (( preview_size > 300000 )); then
  echo "WhatsApp preview image is too large: ${preview_size} bytes" >&2
  exit 1
fi

if grep -Rni --include='*.html' --include='*.webmanifest' 'metal-o-canvas' .; then
  echo 'Obsolete metal-o-canvas reference detected.' >&2
  exit 1
fi

for manifest in demo/manifest.webmanifest demo2/manifest.webmanifest; do
  if ! grep -Fq '"src": "/assets/favicon-android-1024.png"' "$manifest"; then
    echo "Android icon regression in ${manifest}" >&2
    exit 1
  fi
  if ! grep -Fq '"purpose": "maskable"' "$manifest"; then
    echo "Maskable icon declaration missing in ${manifest}" >&2
    exit 1
  fi
done

echo "Metadata guard passed for ${html_count} HTML documents."
