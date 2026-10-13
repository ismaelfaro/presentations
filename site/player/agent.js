// Agente «AGI»: voz -> Whistle -> normalización del español + palabra de activación -> Needle 3 -> acciones.
// Ambos modelos corren en el navegador (engine/worker.js); aquí está la lógica que va alrededor.

const Agent = (() => {
  // El reproductor es común a todas las charlas; los temas y el número de slides vienen del talk.json
  // de cada una (Agent.configure). Las herramientas de Needle se construyen a partir de ellos.
  const PLAYER = new URL(".", document.currentScript.src);    // carpeta player/, para el worker y los modelos

  let N_SLIDES = 1, TOPICS = {}, ALIAS_TO_TOPIC = {}, TOOLS = [], VOCAB = [], KEYWORDS = "";
  let markConfigured;
  const configured = new Promise((r) => (markConfigured = r));   // el motor no arranca sin las herramientas de la charla

  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9ñ\s.]/g, " ").replace(/\s+/g, " ").trim();
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const noArgs = { type: "object", properties: {}, required: [] };
  const nav = (name, description, triggers) => ({
    name, description, triggers,
    parameters: { type: "object", required: [], properties: {
      steps: { type: "integer", minimum: 1, maximum: 10, default: 1, description: "how many slides" } } },
  });

  // talk.json: { slides: 34, topics: { "robótica": { slide: 17, alias: ["robot", ...] }, ... } }
  function configure(talk) {
    N_SLIDES = talk.slides;
    TOPICS = {};
    for (const [t, v] of Object.entries(talk.topics || {})) TOPICS[t] = [v.slide, v.alias || []];
    ALIAS_TO_TOPIC = {};
    for (const [t, [, aliases]] of Object.entries(TOPICS)) for (const a of [t, ...aliases]) ALIAS_TO_TOPIC[norm(a)] = t;

    const topicRx = Object.keys(ALIAS_TO_TOPIC).map((a) => escapeRe(a).replace(/ /g, "\\s+"))
      .sort((a, b) => b.length - a.length).join("|");
    TOOLS = [
      nav("next_slide", "Advance to the next slide (siguiente, adelante, avanza, pasa, continúa)",
        ["\\b(siguiente|adelante|avanza|pasa|continua|next|forward)\\b"]),
      nav("previous_slide", "Go back to the previous slide (anterior, atrás, vuelve, retrocede)",
        ["\\b(anterior|atras|retrocede|previous|back)\\b"]),
      { name: "go_to_slide",
        description: `Jump to a slide by its number (ve a la diapositiva N, salta a la N). First slide = 1, last = ${N_SLIDES}`,
        parameters: { type: "object", properties: { number: { type: "integer", minimum: 1, maximum: N_SLIDES } }, required: ["number"] },
        triggers: ["\\b(diapositiva|slide|transparencia|pagina|la)\\s+(numero\\s+)?\\d+\\b"] },
      { name: "show_notes", description: "Show the speaker notes (muestra / enseña / abre las notas)", parameters: noArgs,
        triggers: ["\\b(muestra|ensena|abre|ver|pon)\\b.*\\bnotas\\b"] },
      { name: "hide_notes", description: "Hide the speaker notes (oculta / quita / cierra las notas)", parameters: noArgs,
        triggers: ["\\b(oculta|quita|cierra|esconde)\\b.*\\bnotas\\b"] },
      { name: "blank_screen", description: "Turn the screen black to pause (pantalla en negro, apaga la pantalla, pausa)", parameters: noArgs,
        triggers: ["\\b(negro|apaga|pausa|oscuro)\\b"] },
      { name: "resume_screen", description: "Show the slides again after a black screen (enciende, vuelve la pantalla, reanuda)", parameters: noArgs,
        triggers: ["\\b(enciende|reanuda|muestra la pantalla)\\b"] },
      { name: "show_overview", description: "Show all the slides as a grid / índice / resumen", parameters: noArgs,
        triggers: ["\\b(indice|todas las diapositivas|vista general|mosaico)\\b"] },
    ];
    if (Object.keys(TOPICS).length) TOOLS.splice(3, 0, { name: "go_to_topic",
      description: "Jump to the slide that talks about a topic (llévame a / muestra la de / ve a / quiero ver ...)",
      parameters: { type: "object", properties: { topic: { type: "string", enum: Object.keys(TOPICS) } }, required: ["topic"] },
      triggers: [`\\b(${topicRx})\\b`] });

    VOCAB = [
      "siguiente", "anterior", "diapositiva", "diapositivas", "adelante", "atras", "vuelve", "retrocede", "avanza",
      "oculta", "muestra", "notas", "ensena", "quita", "cierra", "pantalla", "negro", "enciende",
      "llevame", "indice", "numero", "primera", "ultima",
      ...Object.keys(ALIAS_TO_TOPIC).filter((a) => !a.includes(" ") && a.length >= 5),
    ];
    KEYWORDS = ["AGI", "diapositiva", "siguiente", "anterior", "notas", ...Object.keys(TOPICS)].join("\n");
    markConfigured();
  }

  // ------------------------------------------------------------ normalización
  // Palabra de activación «AGI» y las variantes que produce Whistle al oírla (a-ge-i, A-G-I, ei-yi-ai).
  // No se aceptan «aquí» / «ahí» (palabras corrientes) ni «la/el AGI» («la AGI llegará…» es charla, no comando).
  const WAKE_RX = /^((oye|hey|ok|vale) )?(a ?g ?i|a ?g y|a ?j ?i|a ?ge ?i|a ?je ?i|a ?j ?e ?i|ajey|agei|e ?i ?i|ei ?(yi|ji|gi) ?ai)\b[\s,.]*/;

  const UNITS = { uno: 1, una: 1, primera: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
    diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18,
    diecinueve: 19, veinte: 20, veintiuno: 21, veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24,
    veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29, treinta: 30, cuarenta: 40 };

  function wordsToNumbers(s) {
    // «treinta y cuatro» -> 34; «doce» -> 12 sólo tras palabras de navegación, para no romper frases
    s = s.replace(/\b(treinta|cuarenta) y (uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)\b/g,
      (_, a, b) => String(UNITS[a] + UNITS[b]));
    const rx = new RegExp(`\\b(diapositiva|slide|transparencia|pagina|la|numero|avanza|retrocede|adelanta|salta|vuelve)\\s+(${Object.keys(UNITS).join("|")})\\b`, "g");
    return s.replace(rx, (_, w, n) => `${w} ${UNITS[n]}`);
  }

  // Similitud de Ratcliff/Obershelp, la misma que difflib.SequenceMatcher.ratio()
  function matches(a, b) {
    if (!a.length || !b.length) return 0;
    let best = 0, ai = 0, bi = 0;
    const prev = new Array(b.length + 1).fill(0);
    for (let i = 1; i <= a.length; i++) {
      let diag = 0;
      for (let j = 1; j <= b.length; j++) {
        const tmp = prev[j];
        prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : 0;
        if (prev[j] > best) { best = prev[j]; ai = i - best; bi = j - best; }
        diag = tmp;
      }
    }
    if (!best) return 0;
    return best + matches(a.slice(0, ai), b.slice(0, bi)) + matches(a.slice(ai + best), b.slice(bi + best));
  }
  const ratio = (a, b) => (2 * matches(a, b)) / (a.length + b.length);

  function closest(t, cutoff) {
    let best = null, score = cutoff;
    for (const v of VOCAB) { const r = ratio(t, v); if (r >= score) { score = r; best = v; } }
    return best;
  }
  function close(t, cutoff) {
    if (t.length < 5 || /^\d+$/.test(t)) return null;
    return VOCAB.includes(t) ? t : closest(t, cutoff);
  }

  function fuzzyFix(s) {
    const toks = s.split(" ").filter(Boolean), out = [];
    for (let i = 0; i < toks.length;) {
      // dos tokens partidos por Whistle («a culta» -> «oculta»), sólo si el segundo no es ya una palabra conocida
      if (i + 1 < toks.length && toks[i].length <= 3 && !close(toks[i + 1], 0.78)) {
        const m = closest(toks[i] + toks[i + 1], 0.83);
        if (m) { out.push(m); i += 2; continue; }
      }
      out.push(close(toks[i], 0.78) || toks[i]); i++;
    }
    return out.join(" ");
  }

  function stripWake(s) {
    const m = s.match(WAKE_RX);
    return m ? [true, s.slice(m[0].length).trim()] : [false, s];
  }

  function topicInText(s) {
    let best = null, len = 0;
    for (const [a, t] of Object.entries(ALIAS_TO_TOPIC))
      if (a.length > len && new RegExp(`\\b${escapeRe(a)}\\b`).test(s)) { best = t; len = a.length; }
    return best;
  }

  function toActions(calls, text) {
    const acts = [];
    for (const c of calls) {
      const a = c.arguments || {};
      switch (c.name) {
        case "next_slide": acts.push({ type: "move", delta: +(a.steps || 1) }); break;
        case "previous_slide": acts.push({ type: "move", delta: -(a.steps || 1) }); break;
        case "go_to_slide": acts.push({ type: "goto", slide: Math.max(1, Math.min(N_SLIDES, +a.number)) }); break;
        case "go_to_topic": {
          let topic = a.topic;
          const said = topicInText(text);
          if (said && !text.includes(norm(topic || ""))) topic = said;   // si el texto nombra otro tema, gana lo dicho
          if (TOPICS[topic]) acts.push({ type: "goto", slide: TOPICS[topic][0], topic });
          break;
        }
        case "show_notes": acts.push({ type: "notes", visible: true }); break;
        case "hide_notes": acts.push({ type: "notes", visible: false }); break;
        case "blank_screen": acts.push({ type: "blank", on: true }); break;
        case "resume_screen": acts.push({ type: "blank", on: false }); break;
        case "show_overview": acts.push({ type: "overview" }); break;
      }
    }
    return acts;
  }

  // ------------------------------------------------------------ motor (worker)
  let worker = null, ready = null, seq = 0;
  const pending = new Map();
  let onProgress = () => {};

  function call(type, args, transfer) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, type, args }, transfer || []);
    });
  }

  function systemFacts() {
    const d = new Date(), p = (n) => String(n).padStart(2, "0");
    const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
    return `date: ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${day} ${p(d.getHours())}:${p(d.getMinutes())}; ` +
      "locale: es-ES; device: browser; assistant: AGI, control de presentación";
  }

  function load(progress) {
    if (progress) onProgress = progress;
    if (ready) return ready;
    worker = new Worker(new URL("engine/worker.js", PLAYER));
    worker.onmessage = ({ data }) => {
      if (data.type === "progress") return onProgress(data.loaded, data.total);
      const p = pending.get(data.id);
      if (!p) return;
      pending.delete(data.id);
      data.ok ? p.resolve(data.result) : p.reject(new Error(data.error));
    };
    ready = configured.then(() => call("load", { system: systemFacts(), tools: JSON.stringify(TOOLS) }))
      .catch((e) => { ready = null; worker.terminate(); throw e; });
    return ready;
  }

  // ------------------------------------------------------------ pipeline
  let armedUntil = 0;

  async function handleText(raw, mode, timings = {}) {
    let [woke, command] = stripWake(norm(raw));      // antes del corrector difuso, que no conoce «AGI»
    command = wordsToNumbers(fuzzyFix(command));
    const now = Date.now();
    const res = { transcript: raw, woke, command, actions: [], calls: [], suppressed: [], confidence: null,
      reasoning: null, status: "ignored", timings };

    if (mode === "wake") {
      if (woke && !command) { armedUntil = now + 6000; res.status = "armed"; return res; }
      if (!woke && now > armedUntil) return res;   // habla normal del ponente: no es un comando
      armedUntil = 0;
    }
    if (!command) return res;

    await load();
    const r = await call("complete", { text: command });
    timings.needle_ms = r.ms;
    Object.assign(res, { calls: r.function_calls || [], suppressed: r.suppressed_calls || [],
      confidence: r.confidence ?? null, reasoning: r.reasoning ?? null });
    res.actions = toActions(res.calls, command);
    res.status = res.actions.length ? "ok" : res.suppressed.length ? "unsure" : "no-tool";
    if (res.suppressed.length) res.suggested = toActions(res.suppressed, command);
    return res;
  }

  async function handleAudio(pcm, mode) {
    await load();
    const timings = { audio_s: +(pcm.length / 16000).toFixed(2) };
    const tr = await call("transcribe", { pcm, language: "es", keywords: KEYWORDS }, [pcm.buffer]);
    timings.whistle_ms = tr.ms;
    const text = (tr.text || "").trim();
    if (!text) return { transcript: "", status: "silence", actions: [], timings };
    return handleText(text, mode, timings);
  }

  return { PLAYER, configure, load, handleText, handleAudio, isLoaded: () => !!ready, topics: () => TOPICS, _test: { norm, fuzzyFix, stripWake, wordsToNumbers, ratio } };
})();
