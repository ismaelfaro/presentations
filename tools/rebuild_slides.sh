#!/usr/bin/env bash
# Exporta las slides de un .pptx/.key (vía Keynote) a site/<charla>/slides/*.jpeg y genera
# site/<charla>/slides.json con título, texto y notas del ponente de cada slide.
#
#   tools/rebuild_slides.sh 26.Madrid.Global-Tech-forum talks/26.Madrid.Global-Tech-forum/Ismael_Faro_Presentacion_notas.pptx
set -euo pipefail
cd "$(dirname "$0")/.."
SLUG="${1:?uso: tools/rebuild_slides.sh <charla> <presentación.pptx>}"
SRC="$(cd "$(dirname "${2:?falta la ruta del .pptx}")" && pwd)/$(basename "$2")"
DIR="$PWD/site/$SLUG"
[ -f "$DIR/talk.json" ] || { echo "No existe site/$SLUG: créala antes con tools/new_talk.py"; exit 1; }
TMP="$(mktemp -d)"

echo "Exportando $SRC con Keynote…"
osascript - "$SRC" "$TMP" <<'EOF'
on run argv
  set srcFile to POSIX file (item 1 of argv)
  set outFolder to POSIX file (item 2 of argv)
  tell application "Keynote"
    set d to open srcFile
    delay 3
    export d to outFolder as slide images with properties {image format:JPEG, compression factor:0.85, skipped slides:true}
    close d saving no
  end tell
end run
EOF

N=$(ls "$TMP"/*.jpeg | wc -l | tr -d ' ')
[ "$N" -gt 0 ] || { echo "Keynote no exportó nada"; exit 1; }
mkdir -p "$DIR/slides"
rm -f "$DIR"/slides/*.jpeg
i=0
for f in $(ls "$TMP"/*.jpeg | sort); do
  i=$((i + 1)); mv "$f" "$DIR/slides/slides.$(printf %03d $i).jpeg"
done
rm -rf "$TMP"
echo "$N imágenes en site/$SLUG/slides/"

# Texto y notas (sólo .pptx). Los textos que se repiten en muchas slides (pies de página) se descartan.
case "$SRC" in
  *.pptx)
    uv run -q --with python-pptx python - "$SRC" "$DIR" <<'EOF'
import json, sys
from collections import Counter
from pathlib import Path
from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE

src, d = sys.argv[1], Path(sys.argv[2])
def texts(shapes):
    for sh in shapes:
        if sh.shape_type == MSO_SHAPE_TYPE.GROUP:
            yield from texts(sh.shapes)
        elif sh.has_text_frame and sh.text_frame.text.strip():
            yield sh.text_frame.text.replace("\x0b", " ").strip()

p = Presentation(src)
per = [list(dict.fromkeys(texts(s.shapes))) for s in p.slides]
freq = Counter(t for ts in per for t in ts)
repeated = {t for t, c in freq.items() if c > max(3, len(per) * 0.4) or t in ("‹#›",)}
out = []
for i, (s, ts) in enumerate(zip(p.slides, per), 1):
    ts = [t for t in ts if t not in repeated]
    notes = s.notes_slide.notes_text_frame.text.strip() if s.has_notes_slide else ""
    out.append({"n": i, "section": ts[0] if ts else "", "title": ts[1] if len(ts) > 1 else (ts[0] if ts else ""),
                "text": " · ".join(ts), "notes": notes})
(d / "slides.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
talk = json.loads((d / "talk.json").read_text()); talk["slides"] = len(out)
(d / "talk.json").write_text(json.dumps(talk, ensure_ascii=False, indent=1))
print(f"{len(out)} diapositivas en slides.json")
EOF
    ;;
  *) echo "No es .pptx: revisa a mano site/$SLUG/slides.json (n, title, notes)";;
esac
echo "Si han cambiado los números de slide, revisa «topics» en site/$SLUG/talk.json (temas a los que se puede saltar por voz)."
