#!/usr/bin/env bash
# Sirve site/ en http://localhost:8765, igual que GitHub Pages (ficheros estáticos).
cd "$(dirname "$0")/site"
exec python3 -m http.server "${PORT:-8765}" --bind 127.0.0.1
