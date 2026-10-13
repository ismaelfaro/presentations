// Presentación por voz: micrófono -> Whistle (STT) -> Needle 3 (tool calling) -> acciones.
// Los dos modelos corren en el navegador con WebAssembly (agent.js + engine/worker.js): la web es
// estática y funciona en GitHub Pages, en el portátil y en un iPhone, sin servidor y sin enviar audio fuera.

const $ = (id) => document.getElementById(id);
const PRESENTER = new URLSearchParams(location.search).get("view") === "presenter";
const TOUCH = matchMedia("(pointer: coarse)").matches;
const store = {   // localStorage puede fallar (modo privado de Safari)
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
const bc = "BroadcastChannel" in window ? new BroadcastChannel("voice-deck:" + location.pathname) : null;   // un canal por charla

const S = {
  slides: [], n: 1, notes: false, blank: false, overview: false,
  mode: store.get("vd-mode", "wake"),
  mic: false, armed: false, t0: Date.now(),
};
const img = (n) => `slides/slides.${String(n).padStart(3, "0")}.jpeg`;

// ---------------------------------------------------------------- render
let front = $("slideA"), back = $("slideB");

function render(fromRemote = false) {
  const total = S.slides.length || 1;
  S.n = Math.max(1, Math.min(total, S.n));
  const src = img(S.n);
  if (!front.src.endsWith(src)) {
    back.src = src;
    back.classList.add("on"); front.classList.remove("on");
    [front, back] = [back, front];
  }
  const s = S.slides[S.n - 1] || {};
  $("counter").textContent = `${S.n} / ${total}`;
  $("notes").hidden = PRESENTER || !S.notes;
  $("notesN").textContent = S.n;
  setNotes($("notesText"), s.notes);
  document.body.classList.toggle("blank", S.blank);
  $("overview").hidden = !S.overview;
  document.querySelectorAll("#grid button").forEach((b) => b.classList.toggle("cur", +b.dataset.n === S.n));
  if (PRESENTER) {
    $("pCur").src = src;
    $("pCurN").textContent = `${S.n} / ${total}`;
    $("pNext").src = S.n < total ? img(S.n + 1) : "";
    setNotes($("pNotes"), s.notes);
  }
  if (!fromRemote) bc?.postMessage({ type: "state", n: S.n, notes: S.notes, blank: S.blank, overview: S.overview });
}

// Notas como texto, con los enlaces (fuentes) pulsables
function setNotes(el, text) {
  el.replaceChildren();
  for (const part of (text || "(sin notas)").split(/(https?:\/\/[^\s)»]+)/)) {
    if (!/^https?:\/\//.test(part)) { el.append(part); continue; }
    const a = document.createElement("a");
    a.href = part; a.textContent = part; a.target = "_blank"; a.rel = "noopener";
    el.append(a);
  }
}

function go(n) { S.n = n; S.overview = false; S.blank = false; render(); }

// ---------------------------------------------------------------- acciones del agente
function describe(a) {
  switch (a.type) {
    case "move": return a.delta > 0 ? `→ avanzar ${a.delta > 1 ? a.delta + " diapositivas" : ""}` : `← retroceder ${a.delta < -1 ? -a.delta + " diapositivas" : ""}`;
    case "goto": return `→ diapositiva ${a.slide}${a.topic ? ` · ${a.topic}` : ""}`;
    case "notes": return a.visible ? "mostrar notas" : "ocultar notas";
    case "blank": return a.on ? "pantalla en negro" : "volver a mostrar";
    case "overview": return "índice de diapositivas";
  }
  return a.type;
}

function apply(a) {
  switch (a.type) {
    case "move": S.n += a.delta; S.blank = false; S.overview = false; break;
    case "goto": S.n = a.slide; S.blank = false; S.overview = false; break;
    case "notes": S.notes = a.visible; break;
    case "blank": S.blank = a.on; break;
    case "overview": S.overview = !S.overview; break;
  }
  render();
}

// ---------------------------------------------------------------- toast + log
let toastTimer;
function toast(heard, action, meta, kind) {
  const t = $("toast");
  t.hidden = false; t.className = kind || "";
  t.style.animation = "none"; void t.offsetWidth; t.style.animation = "";
  $("toastHeard").textContent = heard;
  $("toastAction").textContent = action;
  $("toastMeta").textContent = meta || "";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3200);
}

function logEntry(e, fromRemote = false) {
  if (PRESENTER) {
    const li = document.createElement("li");
    li.innerHTML = `<div></div><div class="a"></div><div class="m"></div>`;
    li.children[0].textContent = `«${e.heard}»`;
    li.children[1].textContent = e.action;
    li.children[2].textContent = e.meta;
    $("pLog").prepend(li);
    while ($("pLog").children.length > 30) $("pLog").lastChild.remove();
  }
  if (!fromRemote) bc?.postMessage({ type: "log", e });
}

function metaLine(r) {
  const t = r.timings || {};
  const parts = [];
  if (t.whistle_ms != null) parts.push(`Whistle ${Math.round(t.whistle_ms)} ms`);
  if (t.needle_ms != null) parts.push(`Needle ${Math.round(t.needle_ms)} ms`);
  if (r.confidence != null) parts.push(`confianza ${r.confidence.toFixed(2)}`);
  return parts.join(" · ");
}

function handleResult(r) {
  setArmed(r.status === "armed");
  if (r.status === "silence" || !r.transcript) return;
  if (r.status === "ignored") { status(`Oído (no es comando): «${r.transcript}»`); return; }
  if (r.status === "armed") { status("Te escucho… di el comando"); toast(r.transcript, "te escucho…", metaLine(r)); return; }

  const meta = metaLine(r);
  let action, kind;
  if (r.actions.length) {
    r.actions.forEach(apply);
    action = r.actions.map(describe).join("  ·  ");
    kind = "ok";
  } else if (r.suggested?.length) {
    action = `¿Quisiste decir: ${r.suggested.map(describe).join(", ")}?  (no ejecutado, confianza baja)`;
    kind = "miss";
  } else {
    action = "Ninguna herramienta encaja con eso";
    kind = "miss";
  }
  toast(r.transcript, action, meta, kind);
  logEntry({ heard: r.transcript, action, meta });
  status(`«${r.transcript}»  ${action}`);
}

// ---------------------------------------------------------------- motor (WASM en el navegador)
let engineReady = false;
async function ensureEngine() {
  if (engineReady) return;
  const t0 = performance.now();
  status("Cargando Whistle + Needle…");
  document.body.classList.add("loading");
  try {
    await Agent.load((loaded, total) => {
      const pct = Math.min(100, (loaded / total) * 100);
      document.documentElement.style.setProperty("--load", pct.toFixed(1) + "%");
      status(`Cargando modelos ${(loaded / 1e6).toFixed(0)} / ${(total / 1e6).toFixed(0)} MB (la primera vez se descargan)`);
    });
    engineReady = true;
    status(S.mic ? modeStatus() : `Modelos listos en ${((performance.now() - t0) / 1000).toFixed(1)} s · ${TOUCH ? "toca" : "pulsa"} el micro`);
  } catch (e) {
    status("No se pudo cargar el motor: " + e.message);
    throw e;
  } finally { document.body.classList.remove("loading"); }
}

async function sendAudio(f32) {
  setThinking(true);
  try {
    await ensureEngine();
    handleResult(await Agent.handleAudio(f32, S.mode === "ptt" ? "open" : S.mode));
  } catch (e) {
    status("Error del motor: " + e.message);
  } finally { setThinking(false); }
}

async function sendText(text) {
  setThinking(true);
  try {
    await ensureEngine();
    handleResult(await Agent.handleText(text, "open"));
  } catch (e) {
    status("Error del motor: " + e.message);
  } finally { setThinking(false); }
}

// ---------------------------------------------------------------- micrófono + VAD
const RATE = 16000, FRAME = 320;                 // 20 ms a 16 kHz
const PRE_ROLL = 15, HANG = 35, MIN_SPEECH = 12, MAX_FRAMES = 50 * 12; // 300 ms, 700 ms, 240 ms, 12 s
let ctx, stream, node, pending = new Float32Array(0);
let noise = 0.004, speechRun = 0, silenceRun = 0, recording = false, frames = [], preRoll = [];
let pttHeld = false;

const WORKLET = `
class Tap extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
}
registerProcessor("tap", Tap);`;

let starting = null;
function startMic() {
  if (S.mic) return Promise.resolve();
  if (starting) return starting;
  // iOS Safari: el AudioContext se crea dentro del gesto del usuario (antes de cualquier await) y a la
  // frecuencia nativa del aparato; remuestreamos nosotros a 16 kHz.
  const AC = window.AudioContext || window.webkitAudioContext;
  ctx = new AC();
  ctx.resume();
  ensureEngine().catch(() => {});                  // descarga los modelos en paralelo al permiso del micro
  starting = (async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("este navegador no da acceso al micrófono (¿HTTPS?)");
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const src = ctx.createMediaStreamSource(stream);
      rsPos = 0; rsPrev = 0; pending = new Float32Array(0); noise = 0.004;
      try {
        const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
        await ctx.audioWorklet.addModule(url);
        node = new AudioWorkletNode(ctx, "tap");
        node.port.onmessage = (ev) => onSamples(ev.data);
      } catch {
        node = ctx.createScriptProcessor(2048, 1, 1);  // navegadores sin AudioWorklet
        node.onaudioprocess = (ev) => onSamples(ev.inputBuffer.getChannelData(0).slice());
        node.connect(ctx.destination);
      }
      src.connect(node);
      await ctx.resume();
      S.mic = true;
      document.body.classList.add("mic-on");
      keepAwake(true);
      if (engineReady) status(modeStatus());
    } catch (e) {
      ctx?.close(); ctx = null;
      status("No hay acceso al micrófono: " + e.message);
    } finally { starting = null; }
  })();
  return starting;
}

function stopMic() {
  stream?.getTracks().forEach((t) => t.stop());
  ctx?.close();
  ctx = stream = node = null;
  S.mic = false; recording = false; frames = []; preRoll = []; pttHeld = false;
  document.body.classList.remove("mic-on", "speaking");
  setArmed(false);
  keepAwake(false);
  status(`Micrófono apagado · ${TOUCH ? "toca el micro" : "pulsa M"}`);
}

// Pantalla siempre encendida mientras se escucha (iOS 16.4+, Chrome, Edge)
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && "wakeLock" in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => (wakeLock = null));
    } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { /* no soportado o denegado */ }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !S.mic) return;
  keepAwake(true);
  if (ctx?.state !== "running") ctx?.resume();
});

// Interpolación lineal en streaming; rsPos puede valer [-1, 0) = entre la última muestra del bloque anterior y input[0].
let rsPos = 0, rsPrev = 0;
function resample(input) {
  const ratio = ctx.sampleRate / RATE;
  if (ratio === 1) return input;
  const out = [];
  let x = rsPos;
  while (Math.floor(x) + 1 < input.length) {
    const i0 = Math.floor(x), f = x - i0;
    out.push((i0 < 0 ? rsPrev : input[i0]) * (1 - f) + input[i0 + 1] * f);
    x += ratio;
  }
  rsPos = x - input.length;
  rsPrev = input[input.length - 1];
  return Float32Array.from(out);
}

function onSamples(chunk) {
  const s = resample(chunk);
  const merged = new Float32Array(pending.length + s.length);
  merged.set(pending); merged.set(s, pending.length);
  let off = 0;
  while (merged.length - off >= FRAME) { onFrame(merged.subarray(off, off + FRAME).slice()); off += FRAME; }
  pending = merged.slice(off);
}

function onFrame(f) {
  let e = 0; for (const v of f) e += v * v;
  const rms = Math.sqrt(e / f.length);
  document.documentElement.style.setProperty("--lvl", Math.min(1, rms * 12).toFixed(3));

  if (S.mode === "ptt") {
    if (pttHeld) { frames.push(f); if (frames.length > MAX_FRAMES) endUtterance(); }
    return;
  }
  const thr = Math.max(0.012, noise * 3.2);
  const voiced = rms > thr;
  if (!recording) {
    if (!voiced) noise = noise * 0.98 + rms * 0.02;      // seguimiento del ruido de fondo
    preRoll.push(f); if (preRoll.length > PRE_ROLL) preRoll.shift();
    speechRun = voiced ? speechRun + 1 : 0;
    if (speechRun >= 3) { recording = true; frames = [...preRoll]; silenceRun = 0; document.body.classList.add("speaking"); }
  } else {
    frames.push(f);
    silenceRun = voiced ? 0 : silenceRun + 1;
    if (silenceRun >= HANG || frames.length >= MAX_FRAMES) endUtterance();
  }
}

function endUtterance() {
  const fs = frames; frames = []; preRoll = []; recording = false; speechRun = 0;
  document.body.classList.remove("speaking");
  if (fs.length - (S.mode === "ptt" ? 0 : HANG) < MIN_SPEECH) return;
  const out = new Float32Array(fs.length * FRAME);
  fs.forEach((f, i) => out.set(f, i * FRAME));
  sendAudio(out);
}

// ---------------------------------------------------------------- estado UI
function status(t) { $("statusLine").textContent = t; }
function modeStatus() {
  return {
    wake: "Escuchando · empieza con «AGI…»",
    ptt: TOUCH ? "Mantén pulsado el micro mientras hablas" : "Mantén pulsada V mientras hablas",
    open: "Escuchando · cualquier frase es un comando",
  }[S.mode];
}
function setArmed(on) {
  S.armed = on; document.body.classList.toggle("armed", on);
  clearTimeout(setArmed.t);
  if (on) setArmed.t = setTimeout(() => { setArmed(false); if (S.mic) status(modeStatus()); }, 6000);
}
function setThinking(on) { document.body.classList.toggle("thinking", on); }

function setMode(m) {
  S.mode = m; store.set("vd-mode", m);
  document.querySelectorAll(".modes button").forEach((b) => b.classList.toggle("on", b.dataset.mode === m));
  if (S.mic) status(modeStatus());
  $("hint").innerHTML = m === "wake"
    ? "Di <b>«AGI, siguiente»</b>, <b>«AGI, llévame a la de robótica»</b> o <b>«AGI, ve a la doce»</b>"
    : m === "ptt" ? `Mantén <b>${TOUCH ? "el micro" : "V"}</b> y di <b>«siguiente»</b>, <b>«la de la bombilla»</b>, <b>«muestra las notas»</b>`
    : "Cualquier frase se interpreta: <b>«siguiente»</b>, <b>«pantalla en negro»</b>, <b>«índice»</b>";
}

// ---------------------------------------------------------------- entrada
document.addEventListener("keydown", (e) => {
  if (e.target === $("cmd")) { if (e.key === "Escape") $("cmd").blur(); return; }
  const k = e.key;
  if (["ArrowRight", "PageDown", " ", "ArrowDown"].includes(k)) { e.preventDefault(); apply({ type: "move", delta: 1 }); }
  else if (["ArrowLeft", "PageUp", "ArrowUp"].includes(k)) { e.preventDefault(); apply({ type: "move", delta: -1 }); }
  else if (k === "Home") go(1);
  else if (k === "End") go(S.slides.length);
  else if (k === "n" || k === "N") apply({ type: "notes", visible: !S.notes });
  else if (k === "b" || k === "B" || k === ".") apply({ type: "blank", on: !S.blank });
  else if (k === "o" || k === "O" || k === "Escape" && S.overview) apply({ type: "overview" });
  else if (k === "f" || k === "F") toggleFull();
  else if (k === "p" || k === "P") openPresenter();
  else if (k === "m" || k === "M") S.mic ? stopMic() : startMic();
  else if (k === "/") { e.preventDefault(); $("cmd").focus(); }
  else if ((k === "v" || k === "V") && S.mode === "ptt" && S.mic && !pttHeld) {
    pttHeld = true; frames = []; document.body.classList.add("speaking");
  }
  wake();
});
document.addEventListener("keyup", (e) => {
  if ((e.key === "v" || e.key === "V") && pttHeld) { pttHeld = false; endUtterance(); }
});

// Micro: un toque lo enciende/apaga; en modo «pulsar», mantenerlo pulsado graba (ratón o dedo)
function pttStart() { pttHeld = true; frames = []; document.body.classList.add("speaking"); }
function pttEnd() { if (pttHeld) { pttHeld = false; endUtterance(); } }
$("mic").addEventListener("pointerdown", async (e) => {
  if (S.mode !== "ptt") return;
  e.preventDefault();
  $("mic").setPointerCapture?.(e.pointerId);
  await startMic();
  if (S.mic) pttStart();
});
$("mic").addEventListener("pointerup", () => { if (S.mode === "ptt") pttEnd(); });
$("mic").addEventListener("pointercancel", () => { if (S.mode === "ptt") pttEnd(); });
$("mic").addEventListener("contextmenu", (e) => e.preventDefault());
$("mic").onclick = () => { if (S.mode !== "ptt") S.mic ? stopMic() : startMic(); };
$("prev").onclick = () => apply({ type: "move", delta: -1 });
$("next").onclick = () => apply({ type: "move", delta: 1 });
$("btnNotes").onclick = () => apply({ type: "notes", visible: !S.notes });
$("btnFull").onclick = toggleFull;
$("btnPresenter").onclick = openPresenter;
document.querySelectorAll(".modes button").forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
$("cmdForm").onsubmit = (e) => { e.preventDefault(); const v = $("cmd").value.trim(); if (v) sendText(v); $("cmd").value = ""; };
$("stage").onclick = (e) => apply({ type: "move", delta: e.clientX < innerWidth / 3 ? -1 : 1 });

// Deslizar en pantallas táctiles
let touchX = null, touchY = 0;
$("stage").addEventListener("touchstart", (e) => { touchX = e.touches[0].clientX; touchY = e.touches[0].clientY; wake(); }, { passive: true });
$("stage").addEventListener("touchend", (e) => {
  if (touchX == null) return;
  const dx = e.changedTouches[0].clientX - touchX, dy = e.changedTouches[0].clientY - touchY;
  touchX = null;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { e.preventDefault(); apply({ type: "move", delta: dx < 0 ? 1 : -1 }); }
});

const FULLSCREEN = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
function toggleFull() {
  if (!FULLSCREEN) return;
  const el = document.documentElement;
  if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  else (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
}
function openPresenter() { window.open("?view=presenter", "presenter-" + location.pathname, "width=1280,height=800"); }

// HUD que se esconde solo en la vista de público
let idleT;
function wake() {
  document.body.classList.remove("idle");
  clearTimeout(idleT);
  if (!PRESENTER) idleT = setTimeout(() => document.body.classList.add("idle"), 3500);
}
document.addEventListener("mousemove", wake);
document.addEventListener("touchstart", wake, { passive: true });

// sincronización entre ventanas (público <-> ponente)
if (bc) bc.onmessage = ({ data }) => {
  if (data.type === "state") { Object.assign(S, { n: data.n, notes: data.notes, blank: data.blank, overview: data.overview }); render(true); }
  if (data.type === "log") logEntry(data.e, true);
  if (data.type === "hello") render();
};

// ---------------------------------------------------------------- arranque
(async function init() {
  if (PRESENTER) {
    document.body.classList.add("presenter");
    $("presenter").hidden = false;
    $("btnPresenter").hidden = true;
    setInterval(() => {
      const s = Math.floor((Date.now() - S.t0) / 1000);
      $("pTimer").textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
      $("pClock").textContent = new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
    }, 500);
    $("pTimerReset").onclick = () => (S.t0 = Date.now());
  }
  if (!FULLSCREEN) $("btnFull").hidden = true;      // iPhone: usa «Añadir a pantalla de inicio»
  if (TOUCH) document.querySelector('[data-mode="ptt"]').textContent = "Mantener";
  if ("serviceWorker" in navigator && location.protocol !== "file:")
    navigator.serviceWorker.register(new URL("../sw.js", Agent.PLAYER)).catch(() => {});   // sw.js de la raíz del sitio
  const cacheTalk = () => navigator.serviceWorker?.ready.then((reg) => reg.active?.postMessage({ type: "cache-talk",
    urls: ["./", "talk.json", "slides.json", "manifest.webmanifest", ...S.slides.map((s) => img(s.n))]
      .map((u) => new URL(u, location.href.split("?")[0]).href) }));
  status(`Micrófono apagado · ${TOUCH ? "toca el micro" : "pulsa M"}`);
  // Si los modelos ya están en caché, se cargan ya (es local y rápido); si no, al encender el micro.
  const [talk, slides] = await Promise.all([fetch("talk.json").then((r) => r.json()), fetch("slides.json").then((r) => r.json())]);
  S.slides = slides;
  Agent.configure({ ...talk, slides: slides.length });
  document.title = `${talk.title} · ${talk.place || ""}`.replace(/ · $/, "");
  window.caches?.open("voz-models-v1").then((c) => c.match(new URL("models/whistle.cact", Agent.PLAYER).href))
    .then((hit) => hit && ensureEngine()).catch(() => {});
  $("grid").innerHTML = S.slides.map((s) =>
    `<button data-n="${s.n}" title="${(s.title || "").replace(/"/g, "&quot;")}"><img loading="lazy" src="${img(s.n)}" alt=""><span class="mono">${s.n}</span></button>`).join("");
  $("grid").onclick = (e) => { const b = e.target.closest("button"); if (b) go(+b.dataset.n); };
  S.slides.forEach((s) => { const i = new Image(); i.src = img(s.n); });   // precarga
  cacheTalk()?.catch(() => {});
  setMode(S.mode);
  render(true);
  bc?.postMessage({ type: "hello" });
  wake();
})();
