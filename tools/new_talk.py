#!/usr/bin/env python3
"""
Crea (o actualiza) una charla y regenera el catálogo de la portada.

  python3 tools/new_talk.py "26.Madrid.Global-Tech-forum" \
      --title "Cómo la IA transformará…" --event "Foro Tecnológico Global" --place Madrid --date 2026-10-08

  python3 tools/new_talk.py --catalog        # sólo regenera site/talks.json

Deja:
  site/<charla>/index.html, manifest.webmanifest, talk.json   (lo que se publica)
  talks/<charla>/                                                     (fuentes: .pptx, notas; no se publica)
Después: tools/rebuild_slides.sh <charla> <ruta.pptx> para las imágenes y las notas.
Si la charla ya existe, rehace index.html / manifest y sólo cambia en talk.json los campos que pases.
"""

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"


def write_catalog():
    talks = []
    for tj in sorted(SITE.glob("*/talk.json")):
        t = json.loads(tj.read_text())
        talks.append({k: t.get(k) for k in ("title", "event", "place", "date", "speaker")} | {"slug": tj.parent.name})
    talks.sort(key=lambda t: t.get("date") or "", reverse=True)
    (SITE / "talks.json").write_text(json.dumps(talks, ensure_ascii=False, indent=1))
    print(f"site/talks.json: {len(talks)} charla(s)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("slug", nargs="?", help="nombre de la carpeta, p. ej. 26.Madrid.Global-Tech-forum (sin espacios)")
    ap.add_argument("--title"); ap.add_argument("--event"); ap.add_argument("--place")
    ap.add_argument("--date", help="AAAA-MM-DD"); ap.add_argument("--speaker", default=None)
    ap.add_argument("--catalog", action="store_true", help="sólo regenerar site/talks.json")
    a = ap.parse_args()

    if a.catalog or not a.slug:
        return write_catalog()
    if not re.fullmatch(r"[\w.\-]+", a.slug):
        raise SystemExit("el nombre sólo puede llevar letras, números, '.', '-' y '_' (sin espacios)")

    d = SITE / a.slug
    d.mkdir(parents=True, exist_ok=True)
    (ROOT / "talks" / a.slug).mkdir(parents=True, exist_ok=True)

    tj = d / "talk.json"
    talk = json.loads(tj.read_text()) if tj.exists() else {
        "title": a.slug, "event": "", "place": "", "date": "", "speaker": "Ismael Faro",
        "language": "es", "slides": 0, "topics": {}}
    for k in ("title", "event", "place", "date", "speaker"):
        if getattr(a, k):
            talk[k] = getattr(a, k)
    tj.write_text(json.dumps(talk, ensure_ascii=False, indent=1))

    esc = lambda s: (s or "").replace("&", "&amp;").replace("<", "&lt;").replace('"', "&quot;")
    html = (SITE / "player" / "talk-template.html").read_text()
    html = html.replace("{{TITLE}}", esc(talk["title"])).replace("{{EVENT}}", esc(talk.get("event")))
    (d / "index.html").write_text(html)
    (d / "manifest.webmanifest").write_text(json.dumps({
        "name": talk["title"], "short_name": "AGI", "start_url": "./", "scope": "./",
        "display": "fullscreen", "orientation": "any", "background_color": "#0b0b0c", "theme_color": "#0b0b0c",
        "icons": [{"src": "../player/icon-192.png", "sizes": "192x192", "type": "image/png"},
                  {"src": "../player/icon-512.png", "sizes": "512x512", "type": "image/png"},
                  {"src": "../player/icon.svg", "sizes": "any", "type": "image/svg+xml"}],
    }, ensure_ascii=False, indent=1))
    print(f"site/{a.slug}/: index.html, manifest.webmanifest, talk.json")
    write_catalog()


if __name__ == "__main__":
    main()
