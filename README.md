# Presentaciones

Charlas de Ismael Faro, publicadas como web y controlables por voz. Cada charla se pasa diciendo
**«AGI, siguiente»**, **«AGI, llévame a la de robótica»**, etc. Whistle (voz a texto) y Needle 3 (agente con
herramientas) de [Cactus](https://github.com/cactus-compute/needle) corren en el navegador con WebAssembly:
funciona en el portátil y en el iPhone, sin servidor, y el audio no sale del dispositivo.

| Charla | Fecha |
|---|---|
| [26.Madrid.Global-Tech-forum](site/26.Madrid.Global-Tech-forum/): *Cómo la IA transformará nuestras vidas y trabajo en la próxima década* · Foro Tecnológico Global, Madrid | 8 oct 2026 |

## Estructura

```
site/                          ← lo que se publica en GitHub Pages
  index.html, talks.json       portada con todas las charlas (talks.json lo genera tools/new_talk.py)
  sw.js                        modo sin conexión para todo el sitio
  player/                      reproductor común a todas las charlas
    app.js, agent.js, style.css      interfaz, micrófono, agente «AGI»
    engine/                          motor de Cactus en WebAssembly + worker
    models/                          needle3.cact y whistle.cact (52 MB, Apache-2.0)
    talk-template.html               plantilla de cada charla
  <charla>/
    index.html, manifest.webmanifest   generados por tools/new_talk.py
    talk.json                  título, evento, fecha y temas a los que se salta por voz
    slides.json, slides/       notas e imágenes, generados por tools/rebuild_slides.sh
talks/<charla>/                fuentes que no se publican: .pptx (ignorado por git), guion de notas…
tools/                         new_talk.py, rebuild_slides.sh
```

## Añadir una charla

```bash
python3 tools/new_talk.py "27.Ciudad.Evento" --title "Título" --event "Evento" --place Ciudad --date 2027-03-15
```

```bash
tools/rebuild_slides.sh "27.Ciudad.Evento" talks/27.Ciudad.Evento/presentacion.pptx
```

Después edita `topics` en `site/27.Ciudad.Evento/talk.json` con los temas a los que quieras saltar por voz
(`"robótica": { "slide": 17, "alias": ["robot", "humanoides"] }`). Sin temas también funciona: siguiente,
anterior, ir a la N, notas, pantalla en negro e índice.

El nombre de la carpeta no puede llevar espacios (es parte de la URL).

## Probar en local

```bash
./serve.sh
```

Abre http://localhost:8765. El micrófono sólo funciona en `localhost` o con HTTPS.

## Publicar en GitHub Pages

1. Sube el repositorio a GitHub.
2. En el repo: **Settings → Pages → Source: GitHub Actions**.
3. Cada push a `main` publica `site/` ([.github/workflows/pages.yml](.github/workflows/pages.yml)).

Queda en `https://<usuario>.github.io/<repo>/`, con cada charla en `…/<repo>/<charla>/`.
En un repositorio público, **las notas del ponente (`slides.json`) y las imágenes quedan públicas**.

## Durante la charla

- **Portátil:** **M** activa el micro; **P** abre la vista ponente (notas, siguiente slide, cronómetro) para tu
  pantalla, y la principal va al proyector a pantalla completa (**F**). Teclas: `→` `←` espacio, `N` notas,
  `B` negro, `O` índice, `/` escribir un comando.
- **iPhone:** toca el micro; desliza para cambiar de slide. Para pantalla completa: Compartir → *Añadir a
  pantalla de inicio*.
- La primera visita descarga los modelos (52 MB); ábrela antes con wifi. Después funciona sin conexión.
- Modos de escucha: **«AGI»** (sólo frases que empiezan por «AGI»; la charla normal se ignora),
  **Pulsar V / Mantener** (mientras pulsas V o el micro) y **Siempre** (cualquier frase es un comando).
