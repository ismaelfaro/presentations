// Motor de Cactus (Needle 3 + Whistle) compilado a WebAssembly, en un Web Worker para no bloquear la interfaz.
// Todo corre en el dispositivo: los modelos se descargan una vez del propio sitio y quedan en la Cache API.

importScripts("needle.js");   // needle.js busca needle.wasm junto a este fichero

const MODELS = ["../models/needle3.cact", "../models/whistle.cact"];
const MODEL_CACHE = "voz-models-v1";
const OUT_CAP = 1 << 16;
let M = null, out = 0, pcmPtr = 0, pcmCap = 0;

const post = (msg) => self.postMessage(msg);

async function fetchModel(url, onBytes) {
  let cache = null;
  try { cache = await caches.open(MODEL_CACHE); } catch { /* Cache API no disponible (p. ej. modo privado) */ }
  let res = cache && (await cache.match(url));
  const cached = !!res;
  if (!res) {
    res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  }
  const total = +res.headers.get("content-length") || 0;
  const reader = res.clone().body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length; onBytes(value.length, total);
  }
  if (cache && !cached) { try { await cache.put(url, res); } catch { /* sin espacio: seguimos sin caché */ } }
  const buf = new Uint8Array(got);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.length; }
  return buf;
}

async function load({ system, tools }) {
  M = await createNeedle();
  let loaded = 0;
  const totalAll = 35335380 + 16919407;   // tamaño de los dos .cact, para la barra de progreso
  for (const url of MODELS) {
    const bytes = await fetchModel(url, (n) => { loaded += n; post({ type: "progress", loaded, total: totalAll }); });
    // El motor lee el .cact en sitio: la copia en el heap de WASM se queda reservada mientras viva el worker.
    const p = M._malloc(bytes.length);
    M.HEAPU8.set(bytes, p);
    const rc = M._needle_load(p, BigInt(bytes.length));
    if (rc < 0) throw new Error(`needle_load(${url}) = ${rc}: ${M.UTF8ToString(M._needle_last_error())}`);
  }
  out = M._malloc(OUT_CAP);
  const rc = M.ccall("needle_init", "number", ["string", "string", "string"], [system, tools, null]);
  if (rc < 0) throw new Error(`needle_init = ${rc}: ${M.UTF8ToString(M._needle_last_error())}`);
  return { models: M._needle_models() };
}

function transcribe({ pcm, language, keywords }) {
  if (pcm.length > pcmCap) {
    if (pcmPtr) M._free(pcmPtr);
    pcmCap = pcm.length; pcmPtr = M._malloc(pcmCap * 4);
  }
  new Float32Array(M.HEAPU8.buffer, pcmPtr, pcm.length).set(pcm);   // la vista se crea tras malloc: el heap puede crecer
  const t0 = performance.now();
  const rc = M.ccall("needle_transcribe", "number",
    ["number", "number", "string", "string", "number", "number", "number"],
    [pcmPtr, pcm.length, language, keywords, 0, out, OUT_CAP]);
  if (rc < 0) throw new Error(`needle_transcribe = ${rc}: ${M.UTF8ToString(M._needle_last_error())}`);
  return { ...JSON.parse(M.UTF8ToString(out)), ms: performance.now() - t0 };
}

function complete({ text }) {
  M._needle_reset();                     // cada orden es independiente
  const t0 = performance.now();
  const rc = M.ccall("needle_complete", "number",
    ["string", "number", "number", "number", "number", "number"], [text, 0, 0, 512, out, OUT_CAP]);
  if (rc < 0) throw new Error(`needle_complete = ${rc}: ${M.UTF8ToString(M._needle_last_error())}`);
  return { ...JSON.parse(M.UTF8ToString(out)), ms: performance.now() - t0 };
}

const HANDLERS = { load, transcribe, complete };

self.onmessage = async ({ data }) => {
  const { id, type, args } = data;
  try {
    post({ id, ok: true, result: await HANDLERS[type](args) });
  } catch (e) {
    post({ id, ok: false, error: String(e?.message || e) });
  }
};
