// ---------- Utilidades ----------
const $ = (id) => document.getElementById(id);
const STORAGE_KEY = "pocus-hemo-case-v1";

const FIELD_IDS = [
  "patientTag",
  "derrame_presente", "derrame_severidad", "derrame_compromiso",
  "vci_menor", "vci_mayor", "vci_colapso", "vci_distension", "vci_contexto",
  "vi_puntoe", "vi_mapse", "vi_s", "vi_fevi",
  "vs_diametro", "vs_vti", "vs_fc", "vs_gc", "vs_deltavti",
  "seg_anterior", "seg_lateral", "seg_inferior", "seg_septal", "seg_apical",
  "dd_e", "dd_a", "dd_ep", "dd_ap",
  "vd_ratio", "vd_grosor", "vd_morfologia", "vd_tapse",
  "sc_signod", "sc_excentricidad", "sc_vmax", "sc_pvc", "sc_psap", "sc_vtitsvd",
  "tep_trombo", "tep_vcpletorica", "tep_tvp",
  "dop_mitral", "dop_tricuspidea", "dop_aortica",
  "pul_izq_deslizamiento", "pul_izq_patron", "pul_izq_derrame",
  "pul_der_deslizamiento", "pul_der_patron", "pul_der_derrame",
];

function getVal(id) {
  const el = $(id);
  if (!el) return null;
  if (el.type === "checkbox") return el.checked;
  if (el.classList && el.classList.contains("numfield")) {
    if (el.value === "" || el.value === null) return null;
    const normalized = String(el.value).trim().replace(",", ".");
    const num = parseFloat(normalized);
    return isNaN(num) ? null : num;
  }
  return el.value === "" ? null : el.value;
}
function setVal(id, v) {
  const el = $(id);
  if (!el || v === undefined || v === null) return;
  if (el.type === "checkbox") { el.checked = !!v; return; }
  el.value = v;
}

// Convierte automáticamente la coma en punto (o viceversa a la vista) mientras
// el usuario escribe, para que el teclado numérico del celular funcione aunque
// no tenga tecla de punto — y para que quede un formato consistente.
function normalizeNumericInput(el) {
  if (!el.classList || !el.classList.contains("numfield")) return;
  if (el.value.indexOf(",") === -1) return;
  const cursor = el.selectionStart;
  el.value = el.value.replace(/,/g, ".");
  try { el.setSelectionRange(cursor, cursor); } catch (e) { /* algunos navegadores móviles no lo soportan */ }
}
function has(v) { return v !== null && v !== undefined && v !== ""; }

// ---------- Persistencia ----------
let saveTimer = null;
function saveState() {
  const state = {};
  FIELD_IDS.forEach((id) => { state[id] = getVal(id); });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  const ind = $("savedIndicator");
  ind.classList.add("show");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => ind.classList.remove("show"), 1200);
}
function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const state = JSON.parse(raw);
    FIELD_IDS.forEach((id) => { if (id in state) setVal(id, state[id]); });
  } catch (e) { /* ignore corrupt state */ }
}
function resetState() {
  if (!confirm("¿Iniciar un nuevo caso? Se borrarán los datos diligenciados actualmente.")) return;
  localStorage.removeItem(STORAGE_KEY);
  document.querySelectorAll("input[type=number], input[type=text]").forEach((el) => { if (el.id !== "patientTag") el.value = ""; });
  document.querySelectorAll("select").forEach((el) => { el.selectedIndex = 0; });
  document.querySelectorAll("input[type=checkbox]").forEach((el) => { el.checked = false; });
  $("patientTag").value = "";
  $("pul_izq_deslizamiento").checked = true;
  $("pul_der_deslizamiento").checked = true;
  toggleDerrameDetalle();
  render();
}

function toggleDerrameDetalle() {
  $("derrame_detalle").hidden = !$("derrame_presente").checked;
}

// ---------- Motor de interpretación ----------
function badge(id, state, text) {
  const el = $(id);
  el.className = "badge" + (state ? " " + state : "");
  el.textContent = text || "";
}

function evaluate() {
  const v = {};
  FIELD_IDS.forEach((id) => { v[id] = getVal(id); });

  const flags = [];       // { level: 'alert'|'warn', text }
  const reasons = [];     // bullet explanations
  const sections = {};    // per-section summary strings for the report

  // --- 01 Derrame pericárdico / taponamiento ---
  let taponamiento = false;
  if (v.derrame_presente) {
    const sevTxt = { leve: "leve (<10mm)", moderado: "moderado (10–20mm)", grave: "grave (>20mm)" }[v.derrame_severidad] || "sin severidad especificada";
    sections.derrame = `Derrame pericárdico presente, ${sevTxt}${v.derrame_compromiso ? ", con signos de compromiso hemodinámico" : ""}.`;
    badge("badge-derrame", v.derrame_compromiso || v.derrame_severidad === "grave" ? "alert" : "warn", v.derrame_severidad || "presente");
    if (v.derrame_compromiso || v.derrame_severidad === "grave") {
      taponamiento = true;
      flags.push({ level: "alert", text: "Sospecha de taponamiento cardíaco" });
      reasons.push("Derrame pericárdico " + sevTxt + (v.derrame_compromiso ? " con signos ecográficos de compromiso hemodinámico (colapso de cavidades derechas / variación respiratoria mitral)" : "") + ".");
    }
  } else if (v.derrame_presente === false) {
    sections.derrame = "Sin derrame pericárdico.";
    badge("badge-derrame", null, "sin derrame");
  } else {
    badge("badge-derrame", null, "");
  }

  // --- 02 Vena cava inferior / precarga ---
  let precarga = null; // 'baja' | 'alta' | 'indeterminada'
  const vciHint = $("vci_hint");
  if (has(v.vci_menor) || has(v.vci_colapso)) {
    const small = has(v.vci_menor) && v.vci_menor < 2.1;
    const large = has(v.vci_menor) && v.vci_menor >= 2.1;
    const collapses = has(v.vci_colapso) && v.vci_colapso > 50;
    const noCollapse = has(v.vci_colapso) && v.vci_colapso <= 50;
    if ((small && collapses) || (!has(v.vci_menor) && collapses)) {
      precarga = "baja";
      vciHint.textContent = "VCI de diámetro pequeño y muy colapsable → sugiere presión de aurícula derecha baja / precarga disminuida.";
      badge("badge-vci", "warn", "precarga baja");
    } else if ((large && noCollapse) || (!has(v.vci_menor) && noCollapse)) {
      precarga = "alta";
      vciHint.textContent = "VCI dilatada y poco colapsable (pletórica) → sugiere presión de aurícula derecha elevada.";
      badge("badge-vci", "warn", "precarga alta / pletórica");
    } else {
      precarga = "indeterminada";
      vciHint.textContent = "Patrón intermedio de VCI; correlacionar con contexto clínico y otras variables de precarga.";
      badge("badge-vci", "set", "intermedio");
    }
    sections.vci = `VCI: diámetro menor ${has(v.vci_menor) ? v.vci_menor + "cm" : "N/D"}, mayor ${has(v.vci_mayor) ? v.vci_mayor + "cm" : "N/D"}, colapsabilidad ${has(v.vci_colapso) ? v.vci_colapso + "%" : "N/D"}${has(v.vci_distension) ? ", distensibilidad " + v.vci_distension + "%" : ""} (${v.vci_contexto === "mecanica" ? "ventilación mecánica" : "respiración espontánea"}). Interpretación: precarga ${precarga || "no evaluada"}.`;
  } else {
    vciHint.textContent = "";
    badge("badge-vci", null, "");
  }

  // --- 03 Función VI (sistólica) ---
  let disfuncionVI = null; // true/false
  const criteriosVI = [];
  if (has(v.vi_fevi)) { if (v.vi_fevi < 45) criteriosVI.push(`FEVI ${v.vi_fevi}%`); }
  if (has(v.vi_mapse)) { if (v.vi_mapse < 8) criteriosVI.push(`MAPSE ${v.vi_mapse}mm`); }
  if (has(v.vi_s)) { if (v.vi_s < 6) criteriosVI.push(`S' ${v.vi_s}cm/s`); }
  if (has(v.vi_puntoe)) { if (v.vi_puntoe > 10) criteriosVI.push(`EPSS ${v.vi_puntoe}mm`); }
  if (has(v.vi_fevi) || has(v.vi_mapse) || has(v.vi_s) || has(v.vi_puntoe)) {
    disfuncionVI = criteriosVI.length > 0;
    badge("badge-funcionvi", disfuncionVI ? "warn" : "set", disfuncionVI ? "reducida" : "conservada");
    sections.funcionVI = `Función sistólica de VI: ${disfuncionVI ? "reducida (" + criteriosVI.join(", ") + ")" : "conservada"}.`;
    if (disfuncionVI) reasons.push("Función sistólica de VI reducida: " + criteriosVI.join(", ") + ".");
  } else {
    badge("badge-funcionvi", null, "");
  }

  // --- 04 Volumen sistólico / fluid responsiveness ---
  let respondedor = null;
  if (has(v.vs_gc) || has(v.vs_vti) || has(v.vs_deltavti)) {
    let gc = v.vs_gc;
    if (!has(gc) && has(v.vs_diametro) && has(v.vs_vti) && has(v.vs_fc)) {
      const area = Math.PI * Math.pow(v.vs_diametro / 2, 2);
      gc = (area * v.vs_vti * v.vs_fc) / 1000;
    }
    if (has(v.vs_deltavti)) {
      respondedor = v.vs_deltavti >= 12.5;
      $("vs_hint").textContent = respondedor
        ? "Δ VTI ≥12.5% con reto de volumen → probable respondedor a líquidos."
        : "Δ VTI <12.5% con reto de volumen → improbable respuesta a volumen.";
    } else {
      $("vs_hint").textContent = "";
    }
    sections.volSistolico = `Volumen sistólico: ${has(v.vs_vti) ? "VTI TSVI " + v.vs_vti + "cm" : ""}${has(gc) ? `, gasto cardiaco ${gc.toFixed(1)}L/min` : ""}${has(v.vs_deltavti) ? `, Δ VTI con reto de volumen ${v.vs_deltavti}% (${respondedor ? "respondedor" : "no respondedor"})` : ""}.`;
    badge("badge-volsist", has(v.vs_deltavti) ? (respondedor ? "warn" : "set") : null, has(v.vs_deltavti) ? (respondedor ? "respondedor" : "no respondedor") : "");
  } else {
    badge("badge-volsist", null, "");
  }

  // --- 05 Alteraciones segmentarias ---
  const segMap = { seg_anterior: "anterior", seg_lateral: "lateral", seg_inferior: "inferior", seg_septal: "septal", seg_apical: "apical" };
  const segAlteradas = Object.keys(segMap).filter((id) => v[id] && v[id] !== "normal").map((id) => `${segMap[id]} (${v[id]})`);
  if (Object.keys(segMap).some((id) => has(v[id]))) {
    badge("badge-segmentaria", segAlteradas.length ? "warn" : "set", segAlteradas.length ? `${segAlteradas.length} alterado(s)` : "normal");
    sections.segmentaria = segAlteradas.length ? `Alteraciones segmentarias de contractilidad: ${segAlteradas.join(", ")}.` : "Sin alteraciones segmentarias de contractilidad.";
    if (segAlteradas.length) reasons.push("Alteración segmentaria de la contractilidad: " + segAlteradas.join(", ") + " (sugiere etiología isquémica).");
  } else {
    badge("badge-segmentaria", null, "");
  }

  // --- 06 Función diastólica ---
  if (has(v.dd_e) && has(v.dd_a)) {
    const ea = v.dd_e / v.dd_a;
    let eep = null;
    if (has(v.dd_ep)) eep = v.dd_e / v.dd_ep;
    let interp = "indeterminada";
    if (has(eep)) {
      if (ea <= 0.8 && eep < 8) interp = "función diastólica normal";
      else if (ea >= 2 && eep > 14) interp = "patrón restrictivo (presiones de llenado elevadas)";
      else if (eep > 14) interp = "presiones de llenado elevadas";
      else interp = "patrón indeterminado / relajación alterada";
    }
    $("dd_hint").textContent = `E/A ${ea.toFixed(2)}${has(eep) ? `, E/e' ${eep.toFixed(1)}` : ""} → ${interp}.`;
    badge("badge-diastolica", interp.includes("elevad") || interp.includes("restrictivo") ? "warn" : "set", interp.includes("elevad") || interp.includes("restrictivo") ? "presiones ↑" : "normal");
    sections.diastolica = `Función diastólica: E ${v.dd_e}cm/s, A ${v.dd_a}cm/s${has(v.dd_ep) ? `, e' ${v.dd_ep}cm/s` : ""}${has(v.dd_ap) ? `, a' ${v.dd_ap}cm/s` : ""} — E/A ${ea.toFixed(2)}${has(eep) ? `, E/e' ${eep.toFixed(1)}` : ""}: ${interp}.`;
    if (interp.includes("elevad") || interp.includes("restrictivo")) reasons.push("Presiones de llenado del VI elevadas (E/e' " + (has(eep) ? eep.toFixed(1) : "N/D") + ").");
  } else {
    $("dd_hint").textContent = "";
    badge("badge-diastolica", null, "");
  }

  // --- 07/08 Ventrículo derecho y sobrecarga de presión ---
  let disfuncionVD = false;
  const criteriosVD = [];
  if (has(v.vd_ratio) && v.vd_ratio > 1) criteriosVD.push(`VD/VI ${v.vd_ratio}`);
  if (v.vd_morfologia && v.vd_morfologia !== "normal") criteriosVD.push(v.vd_morfologia === "dshape" ? "signo D" : "VD dilatado");
  if (has(v.vd_tapse) && v.vd_tapse < 16) criteriosVD.push(`TAPSE ${v.vd_tapse}mm`);
  if (v.sc_signod) criteriosVD.push("signo D / McConnell");
  if (has(v.sc_vmax) && v.sc_vmax > 2.8) criteriosVD.push(`Vmáx TRV ${v.sc_vmax}m/s`);
  if (has(v.sc_psap) && v.sc_psap > 35) criteriosVD.push(`PSAP ${v.sc_psap}mmHg`);
  if (has(v.sc_vtitsvd) && v.sc_vtitsvd < 9.5) criteriosVD.push(`VTI TSVD ${v.sc_vtitsvd}cm`);
  disfuncionVD = criteriosVD.length > 0;

  if (has(v.vd_ratio) || v.vd_morfologia || has(v.vd_tapse)) {
    badge("badge-vd", disfuncionVD ? "warn" : "set", disfuncionVD ? "sobrecarga" : "normal");
    sections.vd = `Ventrículo derecho: VD/VI ${has(v.vd_ratio) ? v.vd_ratio : "N/D"}, morfología ${v.vd_morfologia || "N/D"}, TAPSE ${has(v.vd_tapse) ? v.vd_tapse + "mm" : "N/D"}.`;
  } else {
    badge("badge-vd", null, "");
  }
  if (v.sc_signod || has(v.sc_excentricidad) || has(v.sc_vmax) || has(v.sc_psap) || has(v.sc_vtitsvd)) {
    $("sc_hint").textContent = criteriosVD.length ? `Signos de sobrecarga de presión del VD presentes: ${criteriosVD.join(", ")}.` : "Sin signos claros de sobrecarga de presión del VD con los datos disponibles.";
    badge("badge-sobrecarga", criteriosVD.length ? "warn" : "set", criteriosVD.length ? "presente" : "ausente");
    sections.sobrecarga = $("sc_hint").textContent;
  } else {
    $("sc_hint").textContent = "";
    badge("badge-sobrecarga", null, "");
  }
  if (disfuncionVD) reasons.push("Signos de sobrecarga/disfunción del VD: " + criteriosVD.join(", ") + ".");

  // --- 09 Choque por TEP ---
  const tepDatos = [v.tep_trombo, v.tep_vcpletorica, v.tep_tvp].filter(Boolean).length;
  let tepSospecha = false;
  if (v.tep_trombo || v.tep_vcpletorica || v.tep_tvp) {
    badge("badge-tep", null, `${tepDatos} signo(s)`);
    const items = [];
    if (v.tep_trombo) items.push("trombo evidente en cavidades derechas/arteria pulmonar");
    if (v.tep_vcpletorica) items.push("vena cava pletórica");
    if (v.tep_tvp) items.push("TVP femoral");
    sections.tep = `Choque por TEP: ${items.join(", ")}.`;
    if ((v.tep_trombo || v.tep_tvp) && disfuncionVD) {
      tepSospecha = true;
      flags.push({ level: "alert", text: "Sospecha de choque obstructivo por TEP" });
      reasons.push("Combinación de sobrecarga/disfunción de VD con " + (v.tep_trombo ? "trombo evidente" : "TVP femoral") + ": alto riesgo de TEP como causa obstructiva del choque.");
    } else if (disfuncionVD && v.tep_vcpletorica) {
      reasons.push("Disfunción de VD con vena cava pletórica: considerar componente obstructivo (TEP) según contexto clínico.");
    }
  } else {
    badge("badge-tep", null, "");
  }

  // --- 10 Doppler válvulas ---
  const valvulopatias = [];
  if (v.dop_mitral && v.dop_mitral !== "normal") valvulopatias.push(`mitral ${v.dop_mitral}`);
  if (v.dop_tricuspidea && v.dop_tricuspidea !== "normal") valvulopatias.push(`tricúspide ${v.dop_tricuspidea}`);
  if (v.dop_aortica && v.dop_aortica !== "normal") valvulopatias.push(`aórtica ${v.dop_aortica}`);
  if (v.dop_mitral || v.dop_tricuspidea || v.dop_aortica) {
    badge("badge-doppler", valvulopatias.length ? "warn" : "set", valvulopatias.length ? `${valvulopatias.length} hallazgo(s)` : "sin alteraciones");
    sections.doppler = valvulopatias.length ? `Doppler color: insuficiencia ${valvulopatias.join(", ")}.` : "Doppler color de válvulas sin alteraciones significativas.";
  } else {
    badge("badge-doppler", null, "");
  }

  // --- 11 Pulmones ---
  const lungPatternTxt = { A: "patrón A", Bfocal: "patrón B focal", Bdifuso: "patrón B difuso", consolidacion: "consolidación con broncograma" };
  const derrameTxt = { no: "sin derrame", leve: "derrame leve", moderado: "derrame moderado", severo: "derrame severo" };
  const izqTxt = `Izquierdo: ${v.pul_izq_deslizamiento ? "deslizamiento presente" : "sin deslizamiento pleural"}, ${lungPatternTxt[v.pul_izq_patron] || "patrón no evaluado"}, ${derrameTxt[v.pul_izq_derrame] || "derrame no evaluado"}.`;
  const derTxt = `Derecho: ${v.pul_der_deslizamiento ? "deslizamiento presente" : "sin deslizamiento pleural"}, ${lungPatternTxt[v.pul_der_patron] || "patrón no evaluado"}, ${derrameTxt[v.pul_der_derrame] || "derrame no evaluado"}.`;
  const pulmonesEvaluados = v.pul_izq_patron || v.pul_der_patron || has(v.pul_izq_derrame) || has(v.pul_der_derrame) || v.pul_izq_deslizamiento === false || v.pul_der_deslizamiento === false;
  let congestionPulmonar = (v.pul_izq_patron === "Bdifuso" && v.pul_der_patron === "Bdifuso");
  let neumotorax = (v.pul_izq_deslizamiento === false || v.pul_der_deslizamiento === false);
  if (pulmonesEvaluados) {
    sections.pulmones = izqTxt + " " + derTxt;
    if (neumotorax) {
      badge("badge-pulmones", "alert", "sin deslizamiento");
      flags.push({ level: "alert", text: "Ausencia de deslizamiento pleural — descartar neumotórax" });
      reasons.push("Ausencia de deslizamiento pleural: hallazgo compatible con neumotórax en el contexto clínico adecuado.");
    } else if (congestionPulmonar) {
      badge("badge-pulmones", "warn", "congestión bilateral");
      reasons.push("Patrón B difuso bilateral: sugiere síndrome intersticial / congestión pulmonar.");
    } else {
      badge("badge-pulmones", "set", "");
    }
  } else {
    badge("badge-pulmones", null, "");
  }

  // ---------- Perfil hemodinámico global ----------
  let profile = null;
  let level = "";
  if (taponamiento || tepSospecha) {
    profile = "Choque obstructivo" + (taponamiento && tepSospecha ? " (taponamiento y TEP)" : taponamiento ? " — taponamiento cardíaco" : " — tromboembolismo pulmonar");
    level = "alert";
  } else if (precarga === "baja" && disfuncionVI === false && !congestionPulmonar) {
    profile = "Hipovolémico / distributivo";
    reasons.push("VCI colapsable con función sistólica de VI conservada y sin congestión pulmonar: patrón compatible con bajo volumen circulante efectivo (hipovolemia) o vasoplejia (distributivo). Diferenciarlos requiere contexto clínico (fiebre, foco infeccioso, pérdidas, sangrado).");
    level = "warn";
  } else if (disfuncionVI === true && (precarga === "alta" || congestionPulmonar)) {
    profile = "Cardiogénico";
    reasons.push("Disfunción sistólica de VI con precarga elevada" + (congestionPulmonar ? " y congestión pulmonar" : "") + ": patrón compatible con choque cardiogénico.");
    level = "warn";
  } else if (precarga === "alta" && disfuncionVI !== true && !disfuncionVD) {
    profile = "Congestivo / sobrecarga de volumen";
    reasons.push("VCI pletórica con función sistólica de VI conservada: sugiere sobrecarga de volumen más que falla de bomba primaria.");
    level = "warn";
  } else if (disfuncionVD && !taponamiento) {
    profile = "Sobrecarga de VD — descartar componente obstructivo";
    level = "warn";
  } else if (precarga || disfuncionVI !== null || pulmonesEvaluados) {
    profile = "Perfil mixto / indeterminado";
    level = "";
  }

  render_readout(profile, level, flags, reasons);
  render_summary(v, sections);
}

function render_readout(profile, level, flags, reasons) {
  const main = $("profileMain");
  if (!profile) {
    main.textContent = "Sin datos suficientes";
    main.className = "readout-main";
  } else {
    main.textContent = profile;
    main.className = "readout-main" + (level ? " " + level : "");
  }
  const flagsEl = $("profileFlags");
  flagsEl.innerHTML = "";
  flags.forEach((f) => {
    const span = document.createElement("span");
    span.className = "flag" + (f.level === "warn" ? " warn" : "");
    span.textContent = f.text;
    flagsEl.appendChild(span);
  });
  const reasonsEl = $("profileReasons");
  reasonsEl.innerHTML = "";
  reasons.forEach((r) => {
    const li = document.createElement("li");
    li.textContent = r;
    reasonsEl.appendChild(li);
  });
}

function render_summary(v, sections) {
  const lines = [];
  lines.push("EVALUACIÓN CARDIOPULMONAR POCUS");
  if (v.patientTag) lines.push(v.patientTag);
  lines.push(new Date().toLocaleString("es-CO"));
  lines.push("");
  const order = ["derrame", "vci", "funcionVI", "volSistolico", "segmentaria", "diastolica", "vd", "sobrecarga", "tep", "doppler", "pulmones"];
  const anySection = order.some((k) => sections[k]);
  if (anySection) {
    order.forEach((k) => { if (sections[k]) lines.push("• " + sections[k]); });
  } else {
    lines.push("Sin hallazgos diligenciados todavía.");
  }
  lines.push("");
  lines.push("PERFIL HEMODINÁMICO: " + ($("profileMain").textContent));
  const reasons = Array.from(document.querySelectorAll("#profileReasons li")).map((li) => li.textContent);
  if (reasons.length) {
    lines.push("Fundamentos:");
    reasons.forEach((r) => lines.push("  - " + r));
  }
  $("summaryText").textContent = lines.join("\n");
}

function render() {
  evaluate();
}

// ---------- Eventos ----------
document.addEventListener("input", (e) => {
  normalizeNumericInput(e.target);
  if (FIELD_IDS.includes(e.target.id)) {
    if (e.target.id === "derrame_presente") toggleDerrameDetalle();
    saveState();
    render();
  }
});
document.addEventListener("change", (e) => {
  if (FIELD_IDS.includes(e.target.id)) {
    if (e.target.id === "derrame_presente") toggleDerrameDetalle();
    saveState();
    render();
  }
});

$("newCaseBtn").addEventListener("click", resetState);

$("copySummaryBtn").addEventListener("click", async () => {
  const text = $("summaryText").textContent;
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
  const btn = $("copySummaryBtn");
  btn.textContent = "Copiado ✓";
  btn.classList.add("copied");
  setTimeout(() => { btn.textContent = "Copiar resumen"; btn.classList.remove("copied"); }, 1600);
});

// ---------- Inicio ----------
loadState();
toggleDerrameDetalle();
render();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
