import { vdotFrom, predict, zones, DIST, LEVEL_5K, fmtPace, fmtTime, parseTime } from './vdot.js';
import { buildPlan, planFrame, PHASES, iso, fromIso, addDays, dow, monday, estSeconds, stepsKm, ADJUST_INFO } from './plan.js';
import { ROUTINES, ZONE_INFO, TYPE_INFO, CROSS_KINDS } from './library.js';
import { connCfg, authUrl, handleRedirect, syncPolar, fetchBestEffort, parseActivityFile, matchActivities, logFor } from './sync.js';
import { Recorder, buildSegments, toGpx } from './gps.js';
import { HeartRate, hrSupported } from './hr.js';
import { TEMPLATES } from './templates.js';
import { briefing, fetchForecast, weatherAt, heatZones, raceSplits, LIBRARY, libraryItem, RPE_TXT, hrRange, HR_ZONES, paceInsight, sessionAnalysis, THUMB_REASONS, records, achievements } from './coach.js';

// ---------- Estat ----------
const KEY = 'pacely:v1';
const DAYS = ['Dl', 'Dt', 'Dc', 'Dj', 'Dv', 'Ds', 'Dg'];
const DAYS_LONG = ['dilluns', 'dimarts', 'dimecres', 'dijous', 'divendres', 'dissabte', 'diumenge'];
const MONTHS = ['gen', 'feb', 'març', 'abr', 'maig', 'juny', 'jul', 'ag', 'set', 'oct', 'nov', 'des'];
const RUN_TYPES = ['long', 'int', 'fartlek', 'hills', 'tempo', 'easy', 'test', 'race'];

function load() {
  try { return { logs: {}, moves: {}, activities: {}, ...JSON.parse(localStorage.getItem(KEY)) }; }
  catch { return { logs: {}, moves: {}, activities: {} }; }
}
let state = load();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { toast('No s\'ha pogut desar. Revisa l\'espai del navegador.'); } };

const qs = new URLSearchParams(location.search);
const TODAY = qs.get('avui') || iso(new Date());
const app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const kmTxt = x => String(Math.round(x * 10) / 10).replace('.', ',');
const fmtDate = s => { const d = fromIso(s); return `${DAYS_LONG[dow(d)]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const fmtShort = s => { const d = fromIso(s); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const zr = r => `${fmtPace(r[0])}–${fmtPace(r[1])}`;
const dur = sec => { const m = Math.round(sec / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`; };

let PLAN = null;
const computePlan = () => { PLAN = state.profile ? buildPlan(state, TODAY) : null; return PLAN; };
const allSessions = () => PLAN.weeks.flatMap(w => w.sessions.map(s => ({ ...s, week: w })));
const findSession = id => allSessions().find(s => s.id === id);

function toast(msg) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

// ---------- Sincronització ----------
const SRC = { polar: 'Polar Flow', file: 'fitxer', gps: 'GPS del mòbil' };
const srcLabel = src => (src === 'gps' ? 'Gravada amb el GPS del mòbil' : `Importada de ${SRC[src] || 'fora'}`);

async function finishImport() {
  computePlan();
  const matched = matchActivities(state, allSessions());
  for (const l of Object.values(state.logs)) {
    if (!l.needsTime || !l.actKey || !l.distM) continue;
    const act = state.activities[l.actKey];
    try {
      const best = act && await fetchBestEffort(state, act, l.distM);
      if (best) { l.sec = best; l.needsTime = false; }
    } catch { /* l'usuari ho pot escriure a mà */ }
  }
  save(); render();
  return matched;
}

// ---------- Temps i calor ----------
const runHour = () => state.settings?.runHour ?? 19;
const wxFor = date => weatherAt(state.wx, date, runHour());
async function refreshWx(force) {
  if (!state.loc || ui.wxLoading) return;
  if (!force && state.wx && Date.now() - state.wx.fetched < 3 * 3600e3) return;
  ui.wxLoading = true;
  try { state.wx = await fetchForecast(state.loc.lat, state.loc.lon); save(); render(); }
  catch { /* sense connexió: ho tornarem a provar */ }
  finally { ui.wxLoading = false; }
}
function enableHeat() {
  if (!navigator.geolocation) { toast('Aquest navegador no pot saber on ets.'); return; }
  navigator.geolocation.getCurrentPosition(
    p => { state.loc = { lat: +p.coords.latitude.toFixed(2), lon: +p.coords.longitude.toFixed(2) }; save(); refreshWx(true); toast('Ajust per calor activat'); },
    () => toast('Cal el permís d\'ubicació per saber quin temps farà.'),
    { timeout: 15000, maximumAge: 3600e3 },
  );
}

async function doSync(manual) {
  if (!state.polar || ui.syncing) return;
  ui.syncing = true; if (manual) render();
  try {
    const n = await syncPolar(state, state.profile.startDate);
    const m = await finishImport();
    if (manual || m.length) toast(m.length ? `${m.length} ${m.length === 1 ? 'sessió registrada' : 'sessions registrades'} des del rellotge` : n ? `${n} curses noves, cap coincideix amb el pla` : 'Tot al dia');
  } catch (e) { if (manual) toast(e.message || 'No s\'ha pogut connectar'); }
  finally { ui.syncing = false; save(); render(); }
}

// ---------- Icones ----------
const ICON = {
  logo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17c3-1 5-4 7-8s4-5 9-5"/><path d="M4 21h16"/></svg>',
  avui: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  pla: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  forca: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12"/></svg>',
  hist: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  perfil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/></svg>',
};

function tabs(active) {
  const t = [['avui', 'Avui'], ['pla', 'Pla'], ['forca', 'Força'], ['historial', 'Historial'], ['perfil', 'Perfil']];
  let nav = document.querySelector('.tabs');
  if (!state.profile) { nav?.remove(); return; }
  if (!nav) { nav = document.createElement('nav'); nav.className = 'tabs'; nav.setAttribute('aria-label', 'Seccions'); document.body.appendChild(nav); }
  nav.innerHTML = t.map(([k, n]) => `<a href="#${k}" ${k === active ? 'aria-current="page"' : ''}>${ICON[k === 'historial' ? 'hist' : k]}<span>${n}</span></a>`).join('');
}

// ---------- Onboarding ----------
const defaults = () => ({
  step: 0, distance: '21k', hasRace: true, raceDate: '2027-02-28', raceName: 'Mitja Marató de Girona', weeks: 12,
  level: 'int', hasResult: true, resDist: '5k', resTime: '28:00', goal: '1:59:00',
  days: [1, 3, 5], longDay: 1, strength: 2, mobility: true,
});
let ob = null;

function obFitness() {
  const sec = ob.hasResult ? parseTime(ob.resTime) : LEVEL_5K[ob.level];
  const distM = ob.hasResult ? DIST[ob.resDist].m : 5000;
  if (!sec) return null;
  const v = vdotFrom(distM, sec);
  return { v, distM, sec, pred: predict(v, DIST[ob.distance].m) };
}

function renderOnboarding() {
  const steps = 5;
  const prog = `<div class="ob-progress" aria-hidden="true">${Array.from({ length: steps }, (_, i) => `<i class="${i < ob.step ? 'on' : ''}"></i>`).join('')}</div>`;
  const nav = (next = 'Continua', disabled = false) => `<div class="row between">
    ${ob.step > 0 ? '<button class="btn ghost" data-a="ob-back">Enrere</button>' : '<span></span>'}
    <button class="btn" data-a="ob-next" ${disabled ? 'disabled' : ''}>${next}</button></div>`;
  let body = '';
  if (ob.step === 0) {
    body = `<div class="brand">${ICON.logo} Pacely</div>
      <h1>Plans d'entrenament personalitzats, sense pagar res.</h1>
      <p class="muted">Respon cinc preguntes i Pacely et crea un pla de 5K a ultra, amb ritmes calculats per a tu, força i mobilitat. El pla s'adapta als tests i a les sessions que fas o et saltes.</p>
      <div class="stack"><button class="btn block" data-a="ob-next">Crear el meu pla</button>
      <label class="btn line block" for="importFile">Tinc una còpia de seguretat</label>
      <input type="file" id="importFile" accept="application/json" hidden></div>
      <p class="small muted">Les dades es guarden només en aquest dispositiu. No cal compte.</p>`;
  } else if (ob.step === 1) {
    const g = TEMPLATES.girona27;
    body = `${prog}<h1>Per a quina distància t'entrenes?</h1><div class="choices">
      ${['girona27', 'start5k', 'return'].map(id => { const t = TEMPLATES[id]; return `<button class="choice" data-a="ob-template" data-v="${id}" aria-pressed="${ob.template === id}"><span class="label">Pla preparat</span><b>${t.name}</b><span class="small muted">${t.desc}</span></button>`; }).join('')}
      ${Object.entries(DIST).map(([k, d]) => `<button class="choice" data-a="ob-set" data-k="distance" data-v="${k}" aria-pressed="${!ob.template && ob.distance === k}"><b>${d.name}</b><span class="small muted">${{ '5k': 'Velocitat i primeres curses', '10k': 'Equilibri entre ritme i fons', '21k': 'La més popular: fons amb ritme', '42k': 'Paciència i quilòmetres', '50k': 'Fons llarg i alimentació' }[k]}</span></button>`).join('')}
      </div>${nav()}`;
  } else if (ob.step === 2) {
    const f = { ...ob, startDate: TODAY, days: ob.days, longDay: ob.longDay, distance: ob.distance };
    let info = '';
    if (ob.hasRace && ob.raceDate) {
      const fr = planFrame({ ...f, raceDate: ob.raceDate });
      info = ob.raceDate <= TODAY ? '<div class="note warn">La data ha de ser posterior a avui.</div>'
        : fr.n < 6 ? `<div class="note warn">Només hi ha ${fr.n} setmanes. És poc temps: el pla serà curt i prudent.</div>`
        : fr.delayed ? `<div class="note">Falten més de 26 setmanes. El pla començarà el ${fmtDate(iso(fr.startMon))}; fins llavors, corre suau 2–3 dies per setmana.</div>`
        : `<div class="note ok">Pla de <b>${fr.n} setmanes</b>.</div>`;
    }
    body = `${prog}<h1>Tens una cursa a l'horitzó?</h1>
      <div class="chips"><button class="chip" data-a="ob-set" data-k="hasRace" data-v="1" aria-pressed="${ob.hasRace}">Sí, tinc data</button>
      <button class="chip" data-a="ob-set" data-k="hasRace" data-v="0" aria-pressed="${!ob.hasRace}">No, tria la durada</button></div>
      ${ob.hasRace ? `<label class="field"><span>Data de la cursa</span><input type="date" id="raceDate" value="${esc(ob.raceDate)}" min="${TODAY}"></label>
        <label class="field"><span>Nom (opcional)</span><input type="text" id="raceName" value="${esc(ob.raceName)}" placeholder="Ex.: Cursa de la Mercè"></label>`
      : `<label class="field"><span>Durada del pla: <b id="wv">${ob.weeks}</b> setmanes</span><input type="range" id="weeks" min="6" max="26" value="${ob.weeks}"></label>`}
      ${info}${nav('Continua', ob.hasRace && (!ob.raceDate || ob.raceDate <= TODAY))}`;
  } else if (ob.step === 3) {
    const fit = obFitness();
    const goalSec = parseTime(ob.goal);
    let feas = '';
    if (fit && goalSec) {
      const gap = (fit.pred - goalSec) / fit.pred;
      feas = gap <= 0 ? '<div class="note ok">Amb la teva forma actual, l\'objectiu ja és assequible. Pots ser més ambiciós.</div>'
        : gap < 0.07 ? `<div class="note ok">Objectiu exigent però realista: et falten ${fmtTime(fit.pred - goalSec)}.</div>`
        : gap < 0.12 ? `<div class="note">Objectiu ambiciós: et falten ${fmtTime(fit.pred - goalSec)}. Els tests diran si és possible.</div>`
        : `<div class="note warn">Molt ambiciós: et falten ${fmtTime(fit.pred - goalSec)}. Et recomanem un objectiu més proper a ${fmtTime(fit.pred * 0.95)}.</div>`;
    }
    body = `${prog}<h1>Com estàs de forma?</h1>
      <div class="field"><span>Experiència</span><div class="chips">
        ${[['beg', 'Començo'], ['int', 'Corro sovint'], ['adv', 'Entreno fort']].map(([k, n]) => `<button class="chip" data-a="ob-set" data-k="level" data-v="${k}" aria-pressed="${ob.level === k}">${n}</button>`).join('')}
      </div></div>
      <div class="chips"><button class="chip" data-a="ob-set" data-k="hasResult" data-v="1" aria-pressed="${ob.hasResult}">Tinc una marca recent</button>
      <button class="chip" data-a="ob-set" data-k="hasResult" data-v="0" aria-pressed="${!ob.hasResult}">No en tinc</button></div>
      ${ob.hasResult ? `<div class="row"><label class="field grow"><span>Distància</span><select id="resDist">${['5k', '10k', '21k', '42k'].map(k => `<option value="${k}" ${ob.resDist === k ? 'selected' : ''}>${DIST[k].name}</option>`).join('')}</select></label>
        <label class="field grow"><span>Temps</span><input class="time" type="text" id="resTime" inputmode="numeric" value="${esc(ob.resTime)}" placeholder="mm:ss o h:mm:ss"></label></div>`
      : '<p class="small muted">Farem servir una marca de referència segons la teva experiència i la corregirem amb el primer test.</p>'}
      ${fit ? `<div class="card"><div class="row between"><span class="label">Predicció ${DIST[ob.distance].name}</span><b class="mono">${fmtTime(fit.pred)}</b></div>
        <div class="row between"><span class="label">Índex de forma (VDOT)</span><b class="mono">${fit.v.toFixed(1)}</b></div></div>` : '<div class="note warn">Escriu el temps com 28:00 o 1:59:00.</div>'}
      <label class="field"><span>Temps objectiu (opcional)</span><input class="time" type="text" id="goal" inputmode="numeric" value="${esc(ob.goal)}" placeholder="Ex.: 1:59:00"></label>
      ${feas}${nav('Continua', !fit)}`;
  } else if (ob.step === 4) {
    const rel = TEMPLATES[ob.template]?.relative;
    const minDays = rel ? 3 : 2;
    const longOk = rel || ob.days.includes(ob.longDay);
    body = `${prog}<h1>Quins dies pots córrer?</h1>
      <div class="field"><span>Dies de carrera (${ob.days.length})</span><div class="chips">
        ${DAYS.map((d, i) => `<button class="chip" data-a="ob-day" data-v="${i}" aria-pressed="${ob.days.includes(i)}" aria-label="${DAYS_LONG[i]}">${d}</button>`).join('')}
      </div><span class="small muted">${rel ? 'Tria 3 dies, millor no seguits: el cos s\'adapta els dies de descans.' : 'Recomanat: 3–5 dies, amb un dia de descans entre sessions dures.'}</span></div>
      ${rel ? '' : `<label class="field"><span>Dia de la tirada llarga</span><select id="longDay">${ob.days.map(i => `<option value="${i}" ${ob.longDay === i ? 'selected' : ''}>${DAYS_LONG[i]}</option>`).join('')}</select></label>`}
      <div class="field"><span>Sessions de força per setmana</span><div class="chips">
        ${[0, 1, 2, 3].map(n => `<button class="chip" data-a="ob-set" data-k="strength" data-v="${n}" aria-pressed="${ob.strength === n}">${n}</button>`).join('')}
      </div></div>
      <div class="field"><span>Ioga i estiraments per setmana</span><div class="chips">
        ${[0, 1, 2].map(n => `<button class="chip" data-a="ob-set" data-k="yoga" data-v="${n}" aria-pressed="${(ob.yoga || 0) === n}">${n}</button>`).join('')}
      </div></div>
      <label class="toggle"><input type="checkbox" id="mobility" ${ob.mobility ? 'checked' : ''}> Afegir una sessió de mobilitat setmanal</label>
      ${ob.days.length < minDays ? `<div class="note warn">Tria com a mínim ${minDays} dies.</div>` : ''}
      ${nav('Continua', ob.days.length < minDays || !longOk)}`;
  } else {
    const prof = obProfile();
    const tmp = buildPlan({ profile: prof, logs: {}, moves: {} }, TODAY);
    const ph = Object.keys(PHASES).map(k => [k, tmp.frame.phases.filter(x => x === k).length]).filter(([, n]) => n);
    body = `${prog}<h1>El teu pla</h1>
      <div class="card hero"><span class="label">${prof.template ? `Pla preparat · ${esc(TEMPLATES[prof.template].name)}` : esc(prof.raceName || DIST[prof.distance].long)}</span>
        <h2>${tmp.frame.n} setmanes · ${DIST[prof.distance].name}</h2>
        <p>${fmtDate(iso(tmp.frame.race))}</p></div>
      <div class="kv"><div><span class="label">Dies</span><b>${prof.days.length}</b></div><div><span class="label">Pic setmanal</span><b>${Math.max(...tmp.weeks.map(w => w.vol))} km</b></div><div><span class="label">Predicció</span><b>${fmtTime(predict(tmp.vdotNow, DIST[prof.distance].m))}</b></div></div>
      <div class="card"><span class="label">Fases</span>${ph.map(([k, n]) => `<div class="row between"><span class="row"><i style="width:12px;height:12px;border-radius:3px;background:var(${PHASES[k].color})"></i>${PHASES[k].name}</span><span class="muted">${n} setm.</span></div>`).join('')}</div>
      ${nav('Generar el pla')}`;
  }
  app.innerHTML = `<section class="ob screen">${body}</section>`;
}

function obProfile() {
  const fit = obFitness();
  const t = TEMPLATES[ob.template];
  if (t?.relative) {
    const days = [...ob.days].sort((a, b) => a - b);
    return {
      template: t.id, distance: '5k', raceDate: null, raceName: '', weeks: t.weeks, startDate: TODAY,
      days, longDay: days[days.length - 1], strength: ob.strength, mobility: ob.mobility, yoga: ob.yoga || 0,
      level: ob.level, base: { distM: fit.distM, sec: fit.sec }, goalSec: null,
      results: state.profile?.results || [], createdAt: state.profile?.createdAt || new Date().toISOString(),
    };
  }
  if (t) {
    return { yoga: ob.yoga || 0,
      template: t.id, distance: t.distance, raceDate: t.raceDate, raceName: t.raceName, weeks: t.weeks, startDate: t.startDate,
      days: t.days, longDay: t.longDay, strength: t.strength, mobility: t.mobility,
      level: ob.level, base: { distM: fit.distM, sec: fit.sec }, goalSec: parseTime(ob.goal) || null,
      results: state.profile?.results || [], createdAt: state.profile?.createdAt || new Date().toISOString(),
    };
  }
  return {
    distance: ob.distance, raceDate: ob.hasRace ? ob.raceDate : null, raceName: ob.hasRace ? ob.raceName.trim() : '',
    weeks: ob.weeks, startDate: state.profile?.startDate && ob.keepStart ? state.profile.startDate : TODAY,
    days: [...ob.days].sort((a, b) => a - b), longDay: ob.longDay, strength: ob.strength, mobility: ob.mobility,
    level: ob.level, base: { distM: fit.distM, sec: fit.sec }, goalSec: parseTime(ob.goal) || null, yoga: ob.yoga || 0,
    results: state.profile?.results || [], createdAt: state.profile?.createdAt || new Date().toISOString(),
  };
}

function readObInputs() {
  const v = id => document.getElementById(id);
  if (v('raceDate')) ob.raceDate = v('raceDate').value;
  if (v('raceName')) ob.raceName = v('raceName').value;
  if (v('weeks')) ob.weeks = +v('weeks').value;
  if (v('resDist')) ob.resDist = v('resDist').value;
  if (v('resTime')) ob.resTime = v('resTime').value;
  if (v('goal')) ob.goal = v('goal').value;
  if (v('longDay')) ob.longDay = +v('longDay').value;
  if (v('mobility')) ob.mobility = v('mobility').checked;
}

// ---------- Components ----------
// Objectiu d'una zona segons la preferència: ritme, km/h (cinta), pulsacions o esforç
const targetType = () => state.settings?.target || 'pace';
const maxHr = () => state.settings?.maxHr || null;
function targetTxt(k, z) {
  const t = targetType();
  if (t === 'rpe') return RPE_TXT[k] || '';
  if (t === 'hr' && maxHr()) { const r = hrRange(k, maxHr(), state.profile?.distance); if (r) return `${r[0]}–${r[1]} ppm`; }
  if (!z[k]) return '';
  if (state.settings?.treadmill) return `${(3600 / z[k][1]).toFixed(1).replace('.', ',')}–${(3600 / z[k][0]).toFixed(1).replace('.', ',')} km/h`;
  return zr(z[k]);
}
function targetSpeech(sg) {
  const t = targetType();
  if (!sg.zone) return null;
  if (t === 'rpe') return RPE_TXT[sg.zone] ? RPE_TXT[sg.zone].replace('/10', ' sobre 10').replace('–', ' a ') : null;
  if (t === 'hr' && maxHr()) { const r = hrRange(sg.zone, maxHr(), state.profile?.distance); return r ? `Pulsacions entre ${r[0]} i ${r[1]}` : null; }
  return null;
}

function stepRows(s, z) {
  const zc = k => `var(--z-${k})`;
  const pace = k => (k === 'TEST' ? 'a fons' : targetTxt(k, z));
  return s.steps.map(st => {
    let txt, zone = st.z || 'E';
    if (st.k === 'walk') return `<div class="step"><i class="zb" style="background:var(--line)"></i><span>${esc(st.label || `Caminar ${Math.round(st.sec / 60)} min`)}</span><span class="pace">caminant</span></div>`;
    if (st.k === 'rw') {
      const m = x => (x % 60 ? `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}` : `${x / 60}`);
      return `<div class="step"><i class="zb" style="background:${zc('E')}"></i><span>${st.n} × (${m(st.run)} min córrer + ${m(st.walk)} min caminar)</span><span class="pace">${pace('E')}</span></div>`;
    }
    if (st.k === 'time') return `<div class="step"><i class="zb" style="background:${zc('E')}"></i><span>${esc(st.label || `${Math.round(st.sec / 60)} min suau`)}</span><span class="pace">${pace(st.z || 'E')}</span></div>`;
    if (st.k === 'warm') txt = `Escalfament ${kmTxt(st.km)} km fàcil${st.strides ? ` + ${st.strides} progressius` : ''}`;
    else if (st.k === 'cool') txt = `Tornada a la calma ${kmTxt(st.km)} km`;
    else if (st.k === 'rep') {
      const d = st.km < 1 ? `${Math.round(st.km * 1000)} m` : `${kmTxt(st.km)} km`;
      txt = `${st.n} × ${d} a ${ZONE_INFO[st.z].name.toLowerCase()}` + (st.rec ? ` · rec. ${st.rec} s trotant` : st.recKm ? ` · ${kmTxt(st.recKm)} km suau entre blocs` : '');
    } else if (st.k === 'fart') txt = st.label;
    else if (st.k === 'hill') { txt = st.label; zone = 'I'; }
    else if (st.k === 'strides') { txt = st.label; zone = 'R'; }
    else txt = `${kmTxt(st.km)} km ${st.label ? '· ' + st.label : ZONE_INFO[zone] ? ZONE_INFO[zone].name.toLowerCase() : ''}`;
    const p = st.k === 'hill' || st.k === 'fart' ? 'per sensacions' : st.k === 'strides' ? 'ràpid i fluid' : pace(zone);
    return `<div class="step"><i class="zb" style="background:${zc(zone)}"></i><span>${esc(txt)}</span><span class="pace">${p}</span></div>`;
  }).join('');
}

const planName = () => {
  const p = state.profile, t = TEMPLATES[p.template];
  return t?.relative ? t.short : p.raceName || PLAN.dist.long;
};

function paceCard(full) {
  if (state.profile?.template === 'start5k' || state.profile?.template === 'return') return '';
  const pi = paceInsight(state, PLAN);
  if (!full && !pi.delta) return '';
  return `<div class="card"><div class="row between"><span class="label">Estat dels ritmes</span><span class="pill ${pi.status === 'ahead' || pi.status === 'onpoint' ? 'acc' : pi.status === 'review' ? 'sun' : ''}">${pi.name}</span></div>
    <p>${pi.text}</p>
    ${pi.delta ? `<p class="small muted">Proposta: ritmes ${pi.delta > 0 ? 'més ràpids' : 'més suaus'} (${pi.change}). L'estructura del pla no canvia.</p>
      <div class="row"><button class="btn grow" data-a="pi-accept" data-v="${pi.delta}">${pi.delta > 0 ? 'Pujar els ritmes' : 'Baixar els ritmes'}</button><button class="btn ghost" data-a="pi-decline">Ara no</button></div>` : ''}
    ${full ? `<div class="row small muted"><span>Canviar-los tu mateix:</span><button class="btn ghost sm" data-a="pace-manual" data-v="-0.5">Més suaus</button><button class="btn ghost sm" data-a="pace-manual" data-v="0.5">Més ràpids</button></div>` : ''}</div>`;
}

function sessRow(s, opts = {}) {
  const log = state.logs[s.id];
  const ti = TYPE_INFO[s.type];
  const st = log ? (log.status === 'skipped' ? 'skipped' : 'done') : '';
  const meta = [opts.date ? fmtDate(s.date) : '', s.km ? `${kmTxt(s.km)} km` : `${ROUTINES[s.routine]?.min || 15} min`, ti.name].filter(Boolean).join(' · ');
  return `<a class="sess c-${ti.cls} ${st}" href="#s/${s.id}"><i class="bar"></i><span class="grow"><span class="t">${esc(s.title)}</span><br><span class="meta">${meta}</span></span><span class="st ${st}" aria-label="${st === 'done' ? 'Feta' : st === 'skipped' ? 'Saltada' : 'Pendent'}">${st === 'done' ? '✓' : st === 'skipped' ? '–' : ''}</span></a>`;
}

function header(title, sub) {
  const raceIso = iso(PLAN.frame.race);
  const days = Math.round((fromIso(raceIso) - fromIso(TODAY)) / 864e5);
  return `<div class="top"><div><div class="brand">${ICON.logo} Pacely</div><h1>${title}</h1>${sub ? `<p class="muted">${sub}</p>` : ''}</div>
    ${days >= 0 ? `<div class="count"><span class="label">Falten</span><b>${days}</b><span class="small muted">dies</span></div>` : ''}</div>`;
}

// ---------- Pantalles ----------
function screenToday() {
  const w = PLAN.current;
  const todays = w.sessions.filter(s => s.date === TODAY);
  const next = allSessions().find(s => s.date > TODAY && s.km);
  const mon = monday(fromIso(TODAY));
  const strip = Array.from({ length: 7 }, (_, i) => {
    const d = iso(addDays(mon, i));
    const ss = allSessions().filter(s => s.date === d);
    const dots = ss.map(s => {
      const l = state.logs[s.id];
      const c = l ? (l.status === 'done' ? 'var(--ok)' : 'var(--muted)') : s.km ? `var(--z-${{ long: 'M', int: 'I', fartlek: 'I', hills: 'I', tempo: 'T', easy: 'E', runwalk: 'E', test: 'TEST', race: 'RP' }[s.type] || 'E'})` : 'var(--line)';
      return `<i style="background:${c}"></i>`;
    }).join('');
    return `<a href="${ss[0] ? '#s/' + ss[0].id : '#pla'}" class="${d === TODAY ? 'today' : ''}"><span class="dn">${DAYS[i]}</span><span class="dd">${fromIso(d).getDate()}</span><span class="dots">${dots}</span></a>`;
  }).join('');
  const runs = w.sessions.filter(s => s.km);
  const doneKm = runs.reduce((a, s) => a + (state.logs[s.id]?.status === 'done' ? (state.logs[s.id].km || s.km) : 0), 0);
  const D = PLAN.dist;
  const pred = predict(PLAN.vdotNow, D.m);
  const goal = state.profile.goalSec;
  const ev = PLAN.events.slice(0, 3);
  const hello = new Date().getHours() < 13 ? 'Bon dia' : new Date().getHours() < 20 ? 'Bona tarda' : 'Bona nit';

  let main;
  if (todays.length) {
    main = todays.map(s => {
      const log = state.logs[s.id];
      return `<div class="card ${s.km && !log ? 'hero' : ''}"><span class="label">Avui · ${TYPE_INFO[s.type].name}</span><h2>${esc(s.title)}</h2>
        ${s.km ? `<p>${kmTxt(s.km)} km · uns ${dur(estSeconds(s, w.zones))}</p>` : `<p>${ROUTINES[s.routine].min} min</p>`}
        ${s.km && !log ? `<a class="btn" href="#run/${s.id}">▶ Començar amb GPS</a>` : ''}
        <a class="btn ${log || s.km ? 'ghost' : ''}" href="#s/${s.id}">${log ? (log.status === 'done' ? 'Feta ✓ · veure' : 'Saltada · veure') : 'Veure la sessió'}</a></div>`;
    }).join('');
  } else {
    main = `<div class="card"><span class="label">Avui</span><h2>Dia de descans</h2><p class="muted">Recuperar també és entrenar. Camina, estira o fes mobilitat suau.</p>
      ${next ? `<a class="sess c-${TYPE_INFO[next.type].cls}" href="#s/${next.id}"><i class="bar"></i><span class="grow"><span class="t">Pròxima: ${esc(next.title)}</span><br><span class="meta">${fmtDate(next.date)}</span></span></a>` : ''}</div>`;
  }
  const adj = (state.adjust || []).filter(a => a.to >= TODAY);
  if (adj.length) main = `<a class="card" href="#ajust" style="text-decoration:none;color:inherit"><span class="label">Pla ajustat</span><p>${adj.map(a => `${ADJUST_INFO[a.kind].name} fins al ${fmtShort(a.to)}`).join(' · ')}. Toca per desfer-ho.</p></a>` + main;
  main += `<div class="row">${!todays.some(s => s.km && !state.logs[s.id]) ? '<a class="btn line grow" href="#run/lliure">Cursa lliure</a>' : ''}<a class="btn line grow" href="#entrenos">Entrenaments</a></div>
    <a class="btn ghost" href="#ajust">No em trobo al 100%</a>`;
  const live = RUN?.s.startedAt ? RUN.s : Recorder.pending();
  if (live) main = `<a class="card hero" href="#run/${live.sessionId || 'lliure'}" style="text-decoration:none"><span class="label">${RUN ? 'Cursa en marxa' : 'Tens una cursa a mitges'}</span><h2>${esc(live.title || 'Cursa')}</h2><p>${kmTxt(live.dist / 1000)} km · ${fmtTime(live.moving / 1000)} · toca per ${RUN ? 'tornar-hi' : 'continuar-la o desar-la'}</p></a>` + main;

  const pending = Object.values(state.logs).filter(l => (l.needsRpe || l.needsTime) && l.date <= TODAY && l.date >= iso(addDays(fromIso(TODAY), -21))).sort((a, b) => b.date.localeCompare(a.date));
  const pendingHtml = pending.map(l => `<div class="card"><div class="row between"><span class="label">${srcLabel(l.source)}</span><span class="small muted">${fmtShort(l.date)}</span></div>
      <a href="#s/${l.id}" style="color:inherit;text-decoration:none"><h3>${esc(l.title)}</h3><p class="small muted">${kmTxt(l.km)} km · ${fmtTime(l.actSec || l.sec)}${l.km && (l.actSec || l.sec) ? ` · ${fmtPace((l.actSec || l.sec) / l.km)}/km` : ''}${l.hr ? ` · ${l.hr} ppm` : ''}</p></a>
      ${l.needsTime ? `<a class="btn sm" href="#s/${l.id}">Escriu el temps del test</a>` : ''}
      ${l.needsRpe ? `<span class="small">Com t'has trobat? (1 molt fàcil – 10 màxim)</span><div class="rpe">${Array.from({ length: 10 }, (_, i) => `<button data-a="quick-rpe" data-id="${l.id}" data-v="${i + 1}">${i + 1}</button>`).join('')}</div>` : ''}</div>`).join('');

  return `${header(`${hello}!`, `Setmana ${w.idx + 1} de ${PLAN.weeks.length} · ${PHASES[w.phase].name}${w.deload ? ' · descàrrega' : ''}`)}
    <div class="weekstrip">${strip}</div>
    ${pendingHtml}
    ${main}
    <div class="kv"><div><span class="label">Aquesta setmana</span><b>${kmTxt(doneKm)}<span class="small muted"> / ${w.vol} km</span></b></div>
      <div><span class="label">Predicció</span><b>${fmtTime(pred)}</b></div>
      <div><span class="label">Objectiu</span><b>${goal ? fmtTime(goal) : '–'}</b></div></div>
    ${paceCard()}
    ${ev.length ? `<div class="card"><span class="label">El pla s'ha adaptat</span><div class="list">${ev.map(e => `<div class="ev ${e.kind}"><i></i><span>${esc(e.text)}</span></div>`).join('')}</div></div>` : ''}
    <div class="card"><div class="row between"><span class="label">Els teus ritmes ara</span><a class="small" href="#ritmes">Què vol dir?</a></div>
      ${['E', 'T', 'I', 'RP'].map(k => `<div class="row between"><span class="row"><i style="width:10px;height:10px;border-radius:3px;background:var(--z-${k})"></i>${ZONE_INFO[k].name}</span><span class="mono">${zr(zones(PLAN.vdotNow, w.racePace)[k])} /km</span></div>`).join('')}</div>`;
}

function screenPlan() {
  const W = PLAN.weeks;
  const mx = Math.max(...W.map(w => w.vol));
  const cur = PLAN.current.idx;
  const cols = `grid-template-columns:repeat(${W.length},1fr)`;
  const toggle = `<div class="chips"><button class="chip" data-a="plan-view" data-v="weeks" aria-pressed="${ui.planView !== 'month'}">Setmanes</button><button class="chip" data-a="plan-view" data-v="month" aria-pressed="${ui.planView === 'month'}">Calendari</button></div>`;
  if (ui.planView === 'month') return `${header('El pla', `${W.length} setmanes · ${esc(planName())}`)}${toggle}${monthView()}`;
  return `${header('El pla', `${W.length} setmanes · ${esc(planName())}`)}
    ${toggle}
    <div class="card"><div class="phases">
      <div class="bars" style="${cols}" aria-hidden="true">${W.map(w => `<i class="${w.idx === cur ? 'cur' : ''}" style="height:${Math.max(6, (w.vol / mx) * 100)}%"></i>`).join('')}</div>
      <div class="strip" style="${cols}">${W.map(w => `<a href="#pla" data-a="open-week" data-v="${w.idx}" aria-label="Setmana ${w.idx + 1}" style="background:var(${PHASES[w.phase].color});opacity:${w.deload ? 0.5 : 1}"></a>`).join('')}</div></div>
      <div class="legend">${Object.values(PHASES).map(p => `<span><i style="background:var(${p.color})"></i>${p.name}</span>`).join('')}</div></div>
    <div class="stack">${W.map(w => {
      const runs = w.sessions.filter(s => s.km);
      const done = runs.filter(s => state.logs[s.id]?.status === 'done').length;
      return `<details class="week" id="w${w.idx}" style="--ph:var(${PHASES[w.phase].color})" ${w.idx === cur ? 'open' : ''}>
        <summary><span class="wn">${w.idx + 1}</span><span class="grow"><b>${PHASES[w.phase].name}</b> ${w.deload ? '<span class="pill">Descàrrega</span>' : ''} ${w.idx === cur ? '<span class="pill acc">Ara</span>' : ''} ${w.isRaceWeek ? '<span class="pill sun">Cursa</span>' : ''}<br><span class="small muted">${fmtShort(w.start)} – ${fmtShort(w.end)}${w.factor < 1 ? ` · adaptada −${Math.round((1 - w.factor) * 100)} %` : ''}</span></span>
        <span class="small muted" style="text-align:right"><b class="mono" style="color:var(--ink)">${w.vol} km</b><br>${done}/${runs.length}</span></summary>
        <div class="body">${w.sessions.map(s => sessRow(s, { date: true })).join('')}${w.note ? `<p class="small muted">${esc(w.note)}</p>` : ''}</div></details>`;
    }).join('')}</div>`;
}

function monthView() {
  const ym = ui.calMonth || TODAY.slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const start = monday(first);
  const sessions = allSessions();
  const byDate = {};
  for (const s of sessions) (byDate[s.date] ||= []).push(s);
  const moving = ui.moving ? sessions.find(s => s.id === ui.moving) : null;
  const MONTHS_LONG = ['gener', 'febrer', 'març', 'abril', 'maig', 'juny', 'juliol', 'agost', 'setembre', 'octubre', 'novembre', 'desembre'];
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i), di = iso(d);
    if (i >= 35 && d.getMonth() !== m - 1) break;
    const list = byDate[di] || [];
    const allowed = moving && di >= moving.week.start && di <= moving.week.end && di >= state.profile.startDate;
    cells.push(`<button class="cal-d ${d.getMonth() !== m - 1 ? 'out' : ''} ${di === TODAY ? 'today' : ''} ${di === ui.calDay ? 'sel' : ''} ${allowed ? 'ok' : ''}" data-a="cal-day" data-v="${di}" aria-label="${fmtDate(di)}">
      <span class="n">${d.getDate()}</span>${list.slice(0, 3).map(s => { const l = state.logs[s.id]; return `<i class="c-${TYPE_INFO[s.type].cls} ${l ? (l.status === 'done' ? 'done' : 'skip') : ''}"></i>`; }).join('')}</button>`);
  }
  const sel = ui.calDay ? byDate[ui.calDay] || [] : [];
  return `<div class="card"><div class="row between"><button class="btn ghost sm" data-a="cal-month" data-v="-1" aria-label="Mes anterior">‹</button><h3>${MONTHS_LONG[m - 1]} ${y}</h3><button class="btn ghost sm" data-a="cal-month" data-v="1" aria-label="Mes següent">›</button></div>
    <div class="cal">${DAYS.map(d => `<span class="cal-h">${d}</span>`).join('')}${cells.join('')}</div>
    <div class="legend"><span><i style="background:var(--z-M)"></i>Llarga</span><span><i style="background:var(--z-I)"></i>Sèries</span><span><i style="background:var(--z-T)"></i>Tempo</span><span><i style="background:var(--z-E)"></i>Suau</span><span><i style="background:var(--muted)"></i>Força / ioga</span></div></div>
    ${moving ? `<div class="note">Toca un dia marcat de la mateixa setmana per moure <b>${esc(moving.title)}</b>. <button class="btn ghost sm" data-a="cal-move" data-v="${moving.id}">Cancel·lar</button></div>` : ''}
    ${ui.calDay ? `<div class="stack"><span class="label">${fmtDate(ui.calDay)}</span>${sel.length ? sel.map(s => `<div class="row" style="flex-wrap:nowrap">${sessRow(s)}${!state.logs[s.id] ? `<button class="btn ghost sm" data-a="cal-move" data-v="${s.id}">Moure</button>` : ''}</div>`).join('') : '<p class="muted small">Dia de descans.</p>'}</div>` : '<p class="small muted">Toca un dia per veure\'n les sessions i moure-les.</p>'}`;
}

function screenSession(id) {
  const s = findSession(id);
  if (!s) return `<div class="card"><h2>No trobem aquesta sessió</h2><p class="muted">Potser el pla ha canviat. Torna al pla per veure les sessions actuals.</p><a class="btn" href="#pla">Anar al pla</a></div>`;
  const w = s.week;
  const log = state.logs[s.id];
  const isRun = !!s.km;
  const ti = TYPE_INFO[s.type];
  const weekDays = Array.from({ length: 7 }, (_, i) => iso(addDays(fromIso(w.start), i))).filter(d => d >= state.profile.startDate);
  const r = ROUTINES[s.routine];
  const wx = isRun && !log ? wxFor(s.date) : null;
  const zz = wx?.pct ? heatZones(w.zones, wx.pct) : w.zones;
  const est = isRun ? estSeconds(s, zz) : r.min * 60;
  const daysAhead = Math.round((fromIso(s.date) - fromIso(TODAY)) / 864e5);
  const heatCtl = !isRun || log || daysAhead < 0 ? ''
    : !state.loc ? '<button class="btn ghost sm" data-a="heat-on">Ajustar els ritmes a la calor</button>'
    : `<label class="row small"><span>Hora prevista de sortida</span><select id="runHour" style="width:auto;padding:6px 10px">${[7, 9, 12, 18, 20].map(h => `<option value="${h}" ${runHour() === h ? 'selected' : ''}>${h}:00</option>`).join('')}</select></label>
       ${!wx ? `<p class="small muted">${daysAhead > 7 ? 'La previsió del temps arriba 7 dies abans.' : 'Carregant la previsió…'}</p>` : ''}`;
  const brief = isRun && !log ? `<div class="card"><span class="label">Abans de sortir</span>${briefing(s, w, PLAN, state.logs, wx).map(t => `<p>${esc(t)}</p>`).join('')}${heatCtl}</div>` : '';
  const goal = state.profile.goalSec || predict(PLAN.vdotNow, PLAN.dist.m);
  const splits = s.type === 'race' && !log ? `<details class="card"><summary style="cursor:pointer"><b>Estratègia: temps de pas per a ${fmtTime(goal)}</b></summary>
      <table class="table"><tr><th>Km</th><th>Ritme</th><th>Temps de pas</th></tr>${raceSplits(s.km, goal).map(x => `<tr><td>${String(x.km).replace('.', ',')}</td><td class="mono">${fmtPace(x.pace)}</td><td class="mono">${fmtTime(x.cum)}</td></tr>`).join('')}</table>
      <p class="small muted">Els 2 primers km una mica més lents i els 3 últims una mica més ràpids. Si fa calor, afegeix-hi uns segons per km.</p></details>` : '';

  const draft = ui.draft?.id === s.id ? ui.draft : { id: s.id, status: log?.status || 'done', km: log?.km ?? (isRun ? s.km : ''), time: log?.sec ? fmtTime(log.sec) : '', rpe: log?.rpe || 0, notes: log?.notes || '' };
  ui.draft = draft;

  const content = isRun
    ? `<div class="kv"><div><span class="label">Distància</span><b>${kmTxt(s.km)} km</b></div><div><span class="label">Durada</span><b>${dur(est)}</b></div><div><span class="label">Setmana</span><b>${w.idx + 1}</b></div></div>
       <div class="card"><div class="row between"><span class="label">Estructura${wx?.pct ? ` · ritmes +${String(wx.pct).replace('.', ',')} % per calor` : ''}</span><button class="chip" data-a="treadmill" aria-pressed="${!!state.settings?.treadmill}" style="padding:4px 10px;font-size:0.8rem">Cinta (km/h)</button></div><div class="steps">${stepRows(s, zz)}</div>${s.note ? `<p class="small muted">${esc(s.note)}</p>` : ''}</div>`
    : `<div class="card"><p class="muted">${esc(r.focus)}</p>${s.note ? `<p class="small">${esc(s.note)}</p>` : ''}
        ${r.ex.map(e => `<div class="ex"><div class="row between"><b>${esc(e.n)}</b><span class="mono small">${esc(e.d)}</span></div><span class="small muted">${esc(e.h)}</span></div>`).join('')}</div>`;

  const form = `<form class="card" id="logForm" autocomplete="off"><h3>${log ? 'Has registrat aquesta sessió' : 'Registra la sessió'}</h3>
    <div class="chips">${[['done', 'Feta'], ['skipped', 'Me l\'he saltat']].map(([k, n]) => `<button type="button" class="chip" data-a="draft" data-k="status" data-v="${k}" aria-pressed="${draft.status === k}">${n}</button>`).join('')}</div>
    ${draft.status === 'done' ? `${isRun ? `<div class="row"><label class="field grow"><span>Km reals</span><input type="number" id="lgKm" step="0.1" min="0" inputmode="decimal" value="${esc(draft.km)}"></label>
      <label class="field grow"><span>Temps ${s.type === 'test' || s.type === 'race' ? '(obligatori)' : '(opcional)'}</span><input class="time" type="text" id="lgTime" inputmode="numeric" placeholder="mm:ss" value="${esc(draft.time)}"></label></div>` : ''}
      <div class="field"><span>Esforç percebut (1 molt fàcil – 10 màxim)</span><div class="rpe">${Array.from({ length: 10 }, (_, i) => `<button type="button" data-a="draft" data-k="rpe" data-v="${i + 1}" aria-pressed="${draft.rpe === i + 1}">${i + 1}</button>`).join('')}</div></div>` : '<p class="small muted">Cap problema. Si te\'n saltes dues en una setmana, la següent serà una mica més suau.</p>'}
    <label class="field"><span>Notes</span><textarea id="lgNotes" rows="2" placeholder="Com t'has trobat?">${esc(draft.notes)}</textarea></label>
    <div class="row"><button class="btn grow" type="submit">${log ? 'Actualitza' : 'Desa'}</button>${log ? '<button type="button" class="btn ghost" data-a="unlog">Esborra</button>' : ''}</div></form>`;

  return `<div class="row"><a href="#pla" class="btn ghost sm">← Pla</a></div>
    <div><span class="pill ${s.type === 'race' ? 'sun' : 'acc'}">${ti.name}</span>
      <h1 style="margin-top:8px">${esc(s.title)}</h1>
      <p class="muted">${fmtDate(s.date)}${s.movedFrom ? ` · movida des del ${fmtDate(s.movedFrom)}` : ''}</p></div>
    ${log?.source ? `<div class="note ok"><b>${srcLabel(log.source)}</b>${log.actName ? ` · ${esc(log.actName)}` : ''}<br>${kmTxt(log.km)} km · ${fmtTime(log.actSec || log.sec)}${log.km && (log.actSec || log.sec) ? ` · ${fmtPace((log.actSec || log.sec) / log.km)}/km` : ''}${log.hr ? ` · ${log.hr} ppm de mitjana${log.hrMax ? `, màx. ${log.hrMax}` : ''}` : ''}
      ${s.type === 'test' ? `<br><span class="small">${log.needsTime ? `Escriu el temps del tram de ${s.distM / 1000} km (sense escalfament) per recalcular els ritmes.` : `Temps del test: ${fmtTime(log.sec)}${log.actKey ? ` (millor ${s.distM / 1000} km dins la cursa, sense l'escalfament)` : ''}.`}</span>` : ''}</div>` : ''}
    ${isRun && !log ? `<a class="btn" href="#run/${s.id}">▶ Començar amb GPS</a>` : ''}
    ${log?.actKey && state.activities[log.actKey]?.track ? `<button class="btn ghost" data-a="gpx" data-v="${esc(log.actKey)}">Descarregar el recorregut (GPX)</button>` : ''}
    ${analysisCard(s, log, w)}
    ${brief}
    ${content}
    ${splits}
    ${!log ? `<label class="field"><span>Moure-la a un altre dia d'aquesta setmana</span><select id="moveTo">${weekDays.map(d => `<option value="${d}" ${d === s.date ? 'selected' : ''}>${fmtDate(d)}</option>`).join('')}</select></label>` : ''}
    ${s.date <= TODAY || log ? form : `<p class="small muted">Podràs registrar-la el ${fmtDate(s.date)}.</p>`}`;
}

function analysisCard(s, log, w) {
  if (!log || log.status !== 'done' || !s.km) return '';
  if (!log.thumb) {
    return `<div class="card"><span class="label">Com ha anat?</span><p>Valora la sessió i et diré què ha anat bé i què pots millorar.</p>
      <div class="row"><button class="btn ghost grow" data-a="thumb" data-v="up">👍 Bé</button><button class="btn ghost grow" data-a="thumb" data-v="down">👎 No gaire</button></div></div>`;
  }
  const rec = records(state);
  const pbHere = Object.values(rec.pb).find(p => p.date === log.date && (p.src !== 'GPS' || log.actKey));
  const a = sessionAnalysis(s, log, w, { maxHr: maxHr(), pb: pbHere ? `${pbHere.name} en ${fmtTime(pbHere.sec)}` : null });
  return `<div class="card"><div class="row between"><span class="label">Anàlisi de la sessió</span><button class="btn ghost sm" data-a="thumb" data-v="${log.thumb === 'up' ? 'down' : 'up'}">${log.thumb === 'up' ? '👍' : '👎'} canviar</button></div>
    ${log.thumb === 'down' ? `<span class="small">Què ha passat?</span><div class="chips">${Object.entries(THUMB_REASONS).map(([k, n]) => `<button class="chip" data-a="reason" data-v="${k}" aria-pressed="${(log.reasons || []).includes(k)}">${n}</button>`).join('')}</div>` : ''}
    ${a.good.length ? `<div class="list">${a.good.map(t => `<div class="ev up"><i></i><span>${esc(t)}</span></div>`).join('')}</div>` : ''}
    ${a.improve.length ? `<div class="list">${a.improve.map(t => `<div class="ev down"><i></i><span>${esc(t)}</span></div>`).join('')}</div>` : ''}
    <p class="small muted">Aquesta anàlisi no canvia el pla. Si cal ajustar els ritmes, ho veuràs a "Estat dels ritmes".</p></div>`;
}

function screenAdjust() {
  const k = ui.adjKind, days = ui.adjDays || 3;
  const active = (state.adjust || []).map((a, i) => ({ ...a, i })).filter(a => a.to >= TODAY);
  return `<div class="row"><a href="#avui" class="btn ghost sm">← Avui</a></div>
    <div><h1>No em trobo al 100%</h1><p class="muted">Digues què passa i Pacely canviarà les sessions dels propers dies. Ho pots desfer quan vulguis.</p></div>
    <div class="choices">${Object.entries(ADJUST_INFO).map(([key, i]) => `<button class="choice" data-a="adj-kind" data-v="${key}" aria-pressed="${k === key}"><b>${i.name}</b><span class="small muted">${i.help}</span></button>`).join('')}</div>
    ${k === 'holiday' ? `<div class="row"><label class="field grow"><span>Des del</span><input type="date" id="hoFrom" value="${esc(ui.hoFrom || TODAY)}" min="${TODAY}"></label><label class="field grow"><span>Fins al</span><input type="date" id="hoTo" value="${esc(ui.hoTo || iso(addDays(fromIso(TODAY), 6)))}" min="${TODAY}"></label></div>
      <label class="toggle"><input type="checkbox" id="hoEasy" ${ui.hoEasy ? 'checked' : ''}> Vull fer algun rodatge suau</label>`
    : k && k !== 'break' ? `<div class="field"><span>Durant quants dies, a partir d'avui?</span><div class="chips">${[3, 5, 7, 14].map(n => `<button class="chip" data-a="adj-days" data-v="${n}" aria-pressed="${days === n}">${n} dies</button>`).join('')}</div></div>` : ''}
    <button class="btn block" data-a="adj-apply" ${k ? '' : 'disabled'}>Ajustar el pla</button>
    ${active.length ? `<div class="card"><span class="label">Ajustos actius</span>${active.map(a => `<div class="row between"><span>${ADJUST_INFO[a.kind].name} · ${a.from > TODAY ? `del ${fmtShort(a.from)} ` : ''}fins al ${fmtShort(a.to)}${a.easyOnly ? ' (només suau)' : ''}</span><button class="btn ghost sm" data-a="adj-undo" data-v="${a.i}">Desfer</button></div>`).join('')}</div>` : ''}`;
}

function screenLibrary() {
  const z = PLAN.current.zones;
  const cats = [...new Set(LIBRARY.map(w => w.cat))];
  return `${header('Entrenaments', 'Sessions soltes, guiades amb els teus ritmes')}
    ${cats.map(c => `<div class="stack"><span class="label">${c}</span>${LIBRARY.filter(w => w.cat === c).map(w => `<a class="sess c-${TYPE_INFO[w.type].cls}" href="#e/${w.id}"><i class="bar"></i><span class="grow"><span class="t">${esc(w.name)}</span><br><span class="meta">${kmTxt(stepsKm(w.steps))} km · ${dur(estSeconds(w, z))} · ${esc(w.desc)}</span></span></a>`).join('')}</div>`).join('')}
    <p class="small muted">Si en fas un el dia d'una sessió del pla, quedarà registrat en aquella sessió.</p>`;
}

function screenLibItem(id) {
  const w = libraryItem(id);
  if (!w) return '<div class="card"><h2>No trobem aquest entrenament</h2><a class="btn" href="#entrenos">Tornar</a></div>';
  const wx = wxFor(TODAY);
  const z = wx?.pct ? heatZones(PLAN.current.zones, wx.pct) : PLAN.current.zones;
  const s = { ...w, title: w.name, km: stepsKm(w.steps) };
  return `<div class="row"><a href="#entrenos" class="btn ghost sm">← Entrenaments</a></div>
    <div><span class="pill acc">${esc(w.cat)}</span><h1 style="margin-top:8px">${esc(w.name)}</h1><p class="muted">${esc(w.desc)}</p></div>
    <a class="btn" href="#run/${w.id}">▶ Començar amb GPS</a>
    <div class="kv"><div><span class="label">Distància</span><b>${kmTxt(s.km)} km</b></div><div><span class="label">Durada</span><b>${dur(estSeconds(s, z))}</b></div><div><span class="label">Calor</span><b>${wx ? `${wx.t} °C` : '–'}</b></div></div>
    <div class="card"><div class="row between"><span class="label">Estructura${wx?.pct ? ` · +${String(wx.pct).replace('.', ',')} % per calor` : ''}</span><button class="chip" data-a="treadmill" aria-pressed="${!!state.settings?.treadmill}" style="padding:4px 10px;font-size:0.8rem">Cinta (km/h)</button></div><div class="steps">${stepRows(s, z)}</div></div>`;
}

function screenStrength() {
  return `${header('Força i mobilitat', 'Força, mobilitat, ioga i estiraments')}
    ${Object.entries(ROUTINES).map(([k, r]) => `<details class="card"><summary class="row between" style="cursor:pointer;list-style:none"><span><h3>${r.name}</h3><span class="small muted">${r.min} min · ${r.ex.length} exercicis</span></span><span class="pill">${{ M: 'Mobilitat', Y: 'Ioga', S: 'Estiraments' }[k] || 'Força'}</span></summary>
      <p class="muted small">${esc(r.focus)}</p>
      ${r.ex.map(e => `<div class="ex"><div class="row between"><b>${esc(e.n)}</b><span class="mono small">${esc(e.d)}</span></div><span class="small muted">${esc(e.h)}</span></div>`).join('')}</details>`).join('')}
    <p class="small muted">Fes servir un pes que et permeti acabar cada sèrie amb 2 repeticions de marge. A les setmanes de descàrrega, una sola sessió.</p>`;
}

function screenHistory() {
  const W = PLAN.weeks;
  const logs = Object.values(state.logs).sort((a, b) => b.date.localeCompare(a.date));
  const runLogs = logs.filter(l => RUN_TYPES.includes(l.type) && l.status === 'done');
  const linked = new Set(logs.map(l => l.actKey).filter(Boolean));
  const extras = Object.values(state.activities || {}).filter(a => !linked.has(a.key) && !a.dupOf).sort((a, b) => b.date.localeCompare(a.date));
  const totKm = runLogs.reduce((a, l) => a + (+l.km || 0), 0) + extras.reduce((a, x) => a + x.km, 0);
  const totSec = runLogs.reduce((a, l) => a + (l.actSec || l.sec || 0), 0) + extras.reduce((a, x) => a + x.sec, 0);
  const past = allSessions().filter(s => s.km && s.date <= TODAY);
  const comp = past.length ? Math.round((past.filter(s => state.logs[s.id]?.status === 'done').length / past.length) * 100) : 0;

  const doneByWeek = W.map(w => w.sessions.filter(s => s.km).reduce((a, s) => a + (state.logs[s.id]?.status === 'done' ? (+state.logs[s.id].km || s.km) : 0), 0));
  const mx = Math.max(...W.map(w => w.vol), ...doneByWeek, 10);
  const bw = 600 / W.length;
  const chart = `<svg class="chart" viewBox="0 0 620 170" role="img" aria-label="Quilòmetres per setmana: previstos i fets">
    ${[0, 0.5, 1].map(f => `<line x1="20" x2="620" y1="${150 - f * 130}" y2="${150 - f * 130}" stroke="var(--line)" stroke-width="1"/><text x="0" y="${154 - f * 130}">${Math.round(mx * f)}</text>`).join('')}
    ${W.map((w, i) => `<rect x="${22 + i * bw}" y="${150 - (w.vol / mx) * 130}" width="${bw - 4}" height="${(w.vol / mx) * 130}" rx="2" fill="var(--surface-2)"/>
      <rect x="${22 + i * bw}" y="${150 - (doneByWeek[i] / mx) * 130}" width="${bw - 4}" height="${(doneByWeek[i] / mx) * 130}" rx="2" fill="${i === PLAN.current.idx ? 'var(--sun)' : 'var(--accent)'}"/>
      ${i % 2 === 0 || W.length < 12 ? `<text x="${22 + i * bw + (bw - 4) / 2}" y="166" text-anchor="middle">${i + 1}</text>` : ''}`).join('')}
  </svg>`;

  const vh = PLAN.vdotHist.filter(h => h.date <= TODAY).concat([{ date: TODAY, vdot: PLAN.vdotNow }]);
  const preds = ['5k', '10k', '21k', '42k'].map(k => [DIST[k].name, predict(PLAN.vdotNow, DIST[k].m)]);

  return `${header('Historial')}
    <div class="kv"><div><span class="label">Km fets</span><b>${kmTxt(totKm)}</b></div><div><span class="label">Temps</span><b>${dur(totSec)}</b></div><div><span class="label">Compliment</span><b>${comp} %</b></div></div>
    <div class="card"><div class="row between"><span class="label">Km per setmana</span><span class="legend"><span><i style="background:var(--surface-2)"></i>Previst</span><span><i style="background:var(--accent)"></i>Fet</span></span></div>${chart}</div>
    <div class="card"><span class="label">Forma (VDOT) i prediccions</span>
      <div class="row between"><span>Ara</span><b class="mono">${PLAN.vdotNow.toFixed(1)}</b></div>
      ${vh.length > 1 ? `<div class="row between"><span class="muted">A l'inici</span><span class="mono">${vh[0].vdot.toFixed(1)}</span></div>` : ''}
      <table class="table"><tr><th>Distància</th><th>Temps previst</th><th>Ritme</th></tr>${preds.map(([n, t], i) => `<tr><td>${n}</td><td class="mono">${fmtTime(t)}</td><td class="mono">${fmtPace(t / [5, 10, 21.0975, 42.195][i])}/km</td></tr>`).join('')}</table></div>
    <div class="card"><span class="label">Adaptacions del pla</span>${PLAN.events.length ? `<div class="list">${PLAN.events.map(e => `<div class="ev ${e.kind}"><i></i><span>${esc(e.text)} <span class="muted small">${fmtShort(e.date)}</span></span></div>`).join('')}</div>` : '<p class="muted small">Encara cap. Quan registris tests i sessions, el pla s\'ajustarà i ho veuràs aquí.</p>'}</div>
    ${recordsCard()}
    ${statsCard(runLogs, extras)}
    ${crossCard()}
    <div class="stack"><span class="label">Sessions registrades</span>${logs.length ? logs.map(l => `<a class="sess c-${TYPE_INFO[l.type]?.cls || 'easy'} ${l.status === 'skipped' ? 'done' : ''}" href="#s/${l.id}"><i class="bar"></i><span class="grow"><span class="t">${esc(l.title)}</span><br><span class="meta">${fmtDate(l.date)}${l.status === 'skipped' ? ' · saltada' : `${l.km ? ' · ' + kmTxt(l.km) + ' km' : ''}${l.sec ? ' · ' + fmtTime(l.sec) : ''}${l.sec && l.km ? ' · ' + fmtPace(l.sec / l.km) + '/km' : ''}${l.hr ? ' · ' + l.hr + ' ppm' : ''}${l.rpe ? ' · RPE ' + l.rpe : ''}${l.source ? ' · ' + SRC[l.source] : ''}`}</span></span></a>`).join('') : '<p class="muted">Encara no has registrat cap sessió.</p>'}</div>
    ${extras.length ? `<div class="stack"><span class="label">Curses fora del pla</span>${extras.map(x => `<div class="sess c-easy"><i class="bar"></i><span class="grow"><span class="t">${esc(x.name || 'Cursa')}</span><br><span class="meta">${fmtDate(x.date)} · ${kmTxt(x.km)} km · ${fmtTime(x.sec)}${x.km ? ' · ' + fmtPace(x.sec / x.km) + '/km' : ''}${x.hr ? ' · ' + x.hr + ' ppm' : ''} · ${SRC[x.source]}</span></span></div>`).join('')}</div>` : ''}`;
}

function recordsCard() {
  const rec = records(state);
  const ach = achievements(state, PLAN, rec, TODAY);
  const pbs = Object.values(rec.pb);
  return `<div class="card"><span class="label">Rècords personals</span>
      ${pbs.length || rec.longest ? `<table class="table">${pbs.map(p => `<tr><td>${p.name}</td><td class="mono">${fmtTime(p.sec)}</td><td class="small muted">${fmtShort(p.date)} · ${p.src}</td></tr>`).join('')}
        ${rec.longest ? `<tr><td>Sortida més llarga</td><td class="mono">${kmTxt(rec.longest.km)} km</td><td class="small muted">${fmtShort(rec.longest.date)}</td></tr>` : ''}</table>`
      : '<p class="small muted">Quan facis un test, una cursa o gravis amb GPS, aquí sortiran les teves millors marques.</p>'}
      ${ach.streak ? `<p class="small">Ratxa actual: <b>${ach.streak} ${ach.streak === 1 ? 'setmana completa' : 'setmanes completes'}</b> seguides.</p>` : ''}</div>
    <div class="card"><div class="row between"><span class="label">Assoliments</span><span class="small muted">${ach.list.filter(a => a.done).length} de ${ach.list.length}</span></div>
      <div class="badges">${ach.list.map(a => `<div class="badge ${a.done ? 'on' : 'off'}"><b>${a.done ? '🏅 ' : ''}${esc(a.name)}</b><span class="small muted">${esc(a.desc)}</span></div>`).join('')}</div></div>`;
}

function statsCard(runLogs, extras) {
  const runs = [...runLogs.map(l => ({ date: l.date, km: +l.km || 0, sec: l.actSec || l.sec || 0 })), ...extras.map(x => ({ date: x.date, km: x.km, sec: x.sec || 0 }))];
  const cross = state.cross || [];
  const year = +(ui.statYear || TODAY.slice(0, 4));
  const months = Array.from({ length: 12 }, (_, i) => runs.filter(r => +r.date.slice(0, 4) === year && +r.date.slice(5, 7) === i + 1).reduce((a, r) => a + r.km, 0));
  const mx = Math.max(10, ...months);
  const years = [...new Set([...runs, ...cross].map(r => +r.date.slice(0, 4)))].sort((a, b) => b - a);
  const yTot = y => { const rs = runs.filter(r => +r.date.slice(0, 4) === y); return { km: rs.reduce((a, r) => a + r.km, 0), sec: rs.reduce((a, r) => a + r.sec, 0), n: rs.length, cross: cross.filter(c => +c.date.slice(0, 4) === y).reduce((a, c) => a + c.min, 0) }; };
  const all = { km: runs.reduce((a, r) => a + r.km, 0), n: runs.length };
  const firstDate = runs.map(r => r.date).sort()[0];
  const weeksSpan = firstDate ? Math.max(1, (fromIso(TODAY) - fromIso(firstDate)) / 6048e5) : 1;
  const M = ['G', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
  const prevKm = yTot(year - 1).km;
  return `<div class="card"><div class="row between"><span class="label">Km per mes · ${year}</span><span class="row"><button class="btn ghost sm" data-a="stat-year" data-v="-1" aria-label="Any anterior">‹</button><button class="btn ghost sm" data-a="stat-year" data-v="1" aria-label="Any següent">›</button></span></div>
    <svg class="chart" viewBox="0 0 620 150" role="img" aria-label="Quilòmetres per mes de ${year}">
      ${[0, 0.5, 1].map(f => `<line x1="24" x2="620" y1="${125 - f * 105}" y2="${125 - f * 105}" stroke="var(--line)"/><text x="0" y="${129 - f * 105}">${Math.round(mx * f)}</text>`).join('')}
      ${months.map((v, i) => `<rect x="${30 + i * 49}" y="${125 - (v / mx) * 105}" width="40" height="${(v / mx) * 105}" rx="3" fill="${year === +TODAY.slice(0, 4) && i === +TODAY.slice(5, 7) - 1 ? 'var(--sun)' : 'var(--accent)'}"/>
        ${v ? `<text x="${50 + i * 49}" y="${120 - (v / mx) * 105}" text-anchor="middle">${Math.round(v)}</text>` : ''}<text x="${50 + i * 49}" y="143" text-anchor="middle">${M[i]}</text>`).join('')}
    </svg>
    <table class="table"><tr><th>Any</th><th>Km</th><th>Sortides</th><th>Temps</th></tr>${(years.length ? years : [year]).map(y => { const t = yTot(y); return `<tr><td>${y}</td><td class="mono">${kmTxt(t.km)}</td><td class="mono">${t.n}</td><td class="mono">${dur(t.sec)}${t.cross ? ` + ${dur(t.cross * 60)} creuat` : ''}</td></tr>`; }).join('')}</table>
    <p class="small muted">Total: ${kmTxt(all.km)} km en ${all.n} sortides · mitjana de ${kmTxt(all.km / weeksSpan)} km per setmana${prevKm ? ` · ${year - 1}: ${kmTxt(prevKm)} km` : ''}.</p></div>`;
}

function crossCard() {
  const list = [...(state.cross || [])].sort((a, b) => b.date.localeCompare(a.date));
  return `<form class="card" id="crossForm"><span class="label">Entrenament creuat</span>
    <p class="small muted">Bici, natació, el·líptica... Compta per a l'historial i les estadístiques.</p>
    <div class="row"><label class="field grow"><span>Activitat</span><select id="crKind">${Object.entries(CROSS_KINDS).map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></label>
      <label class="field grow"><span>Data</span><input type="date" id="crDate" value="${TODAY}" max="${TODAY}"></label></div>
    <div class="row"><label class="field grow"><span>Minuts</span><input type="number" id="crMin" min="1" inputmode="numeric" placeholder="45"></label>
      <label class="field grow"><span>Km (opcional)</span><input type="number" id="crKm" min="0" step="0.1" inputmode="decimal"></label>
      <label class="field grow"><span>Esforç 1–10</span><input type="number" id="crRpe" min="1" max="10" inputmode="numeric" placeholder="5"></label></div>
    <button class="btn ghost" type="submit">Afegir</button>
    ${list.length ? `<div class="list">${list.slice(0, 15).map(c => `<div class="row between"><span>${fmtShort(c.date)} · ${CROSS_KINDS[c.kind]} · ${dur(c.min * 60)}${c.km ? ` · ${kmTxt(c.km)} km` : ''}${c.rpe ? ` · RPE ${c.rpe}` : ''}</span><button type="button" class="btn ghost sm" data-a="cross-del" data-v="${c.id}">Treu</button></div>`).join('')}</div>` : ''}</form>`;
}

function screenProfile() {
  const p = state.profile;
  return `${header('Perfil')}
    <div class="card"><span class="label">El teu pla</span>
      <div class="row between"><span>Objectiu</span><b>${esc(planName())}</b></div>
      ${p.template ? `<div class="row between"><span>Tipus</span><span class="pill acc">Pla preparat</span></div>` : ''}
      <div class="row between"><span>Data</span><span>${fmtDate(iso(PLAN.frame.race))}</span></div>
      <div class="row between"><span>Temps objectiu</span><span class="mono">${p.goalSec ? fmtTime(p.goalSec) : 'sense'}</span></div>
      <div class="row between"><span>Dies</span><span>${p.days.map(d => DAYS[d]).join(' · ')} (llarga: ${DAYS_LONG[p.longDay]})</span></div>
      <div class="row between"><span>Força / mobilitat</span><span>${p.strength}× · ${p.mobility ? 'sí' : 'no'}</span></div>
      <button class="btn ghost" data-a="edit-plan">Canviar el pla</button>
      <p class="small muted">Si canvies els dies o l'objectiu, el pla es torna a calcular. Els registres que ja tens es conserven.</p></div>
    <div class="card"><span class="label">Dificultat del pla</span>
      <div class="chips">${[[-1, 'Més suau'], [0, 'Normal'], [1, 'Més exigent']].map(([k, n]) => `<button class="chip" data-a="difficulty" data-v="${k}" aria-pressed="${(p.difficulty || 0) === k}">${n}</button>`).join('')}</div>
      <p class="small muted">Més suau: un 15 % menys de km i ritmes una mica més lents. Més exigent: un 12 % més de km i ritmes una mica més ràpids. L'estructura del pla no canvia.</p></div>
    <form class="card" id="hrForm"><span class="label">Objectius de les sessions</span>
      <div class="chips">${[['pace', 'Ritme'], ['hr', 'Pulsacions'], ['rpe', 'Esforç (1–10)']].map(([k, n]) => `<button type="button" class="chip" data-a="target" data-v="${k}" aria-pressed="${targetType() === k}">${n}</button>`).join('')}</div>
      <p class="small muted">${targetType() === 'hr' ? 'Les sessions et diran entre quines pulsacions has d\'anar.' : targetType() === 'rpe' ? 'Les sessions et diran l\'esforç que has de sentir, de l\'1 al 10. Útil per a muntanya o dies de calor.' : 'Les sessions et diuen el ritme en min/km.'}</p>
      <div class="row"><label class="field grow"><span>Freqüència cardíaca màxima</span><input type="number" id="maxHr" min="120" max="230" inputmode="numeric" value="${esc(maxHr() || '')}" placeholder="p. ex. 190"></label><button class="btn ghost" type="submit" style="align-self:end">Desa</button></div>
      ${maxHr() ? `<table class="table">${HR_ZONES.map(([n, a, b]) => `<tr><td>${n}</td><td class="mono">${Math.round(a * maxHr())}–${Math.round(b * maxHr())} ppm</td></tr>`).join('')}</table>`
        : '<p class="small muted">Si no la saps, la del Polar Flow (Perfil → Configuració física) és un bon punt de partida.</p>'}
      ${targetType() === 'hr' && !maxHr() ? '<div class="note warn">Escriu la freqüència màxima per veure els objectius en pulsacions.</div>' : ''}</form>
    <div class="card"><span class="label">Ioga i estiraments</span>
      <div class="chips">${[0, 1, 2].map(n => `<button class="chip" data-a="yoga" data-v="${n}" aria-pressed="${(p.yoga || 0) === n}">${n === 0 ? 'Cap' : `${n} per setmana`}</button>`).join('')}</div>
      <p class="small muted">Sessions de 15–20 minuts en dies sense córrer: ioga per a corredors i estiraments amb estabilitat.</p></div>
    <form class="card" id="resultForm"><span class="label">Afegir una cursa o marca recent</span>
      <p class="small muted">Si has fet una cursa fora del pla, afegeix-la i els ritmes s'actualitzaran.</p>
      <div class="row"><label class="field grow"><span>Distància</span><select id="rsDist">${['5k', '10k', '21k', '42k'].map(k => `<option value="${k}">${DIST[k].name}</option>`).join('')}</select></label>
      <label class="field grow"><span>Temps</span><input class="time" id="rsTime" type="text" placeholder="mm:ss" inputmode="numeric"></label></div>
      <label class="field"><span>Data</span><input type="date" id="rsDate" value="${TODAY}" max="${TODAY}"></label>
      <button class="btn" type="submit">Afegir resultat</button>
      ${(p.results || []).length ? `<div class="list">${p.results.map((r, i) => `<div class="row between"><span>${fmtShort(r.date)} · ${Math.round(r.distM / 100) / 10} km</span><span class="row"><span class="mono">${fmtTime(r.sec)}</span><button type="button" class="btn ghost sm" data-a="del-result" data-v="${i}">Treu</button></span></div>`).join('')}</div>` : ''}</form>
    ${watchCard()}
    <div class="card"><span class="label">Exporta les teves dades</span>
      <button class="btn ghost" data-a="export-ics">Afegir al calendari (.ics)</button>
      <button class="btn ghost" data-a="export-csv">Historial en CSV</button>
      <button class="btn ghost" data-a="export-json">Còpia de seguretat (.json)</button>
      <label class="btn line" for="importFile">Restaurar una còpia</label><input type="file" id="importFile" accept="application/json" hidden></div>
    <div class="card"><span class="label">Aparença</span><div class="chips">${[['', 'Sistema'], ['light', 'Clar'], ['dark', 'Fosc']].map(([k, n]) => `<button class="chip" data-a="theme" data-v="${k}" aria-pressed="${(state.theme || '') === k}">${n}</button>`).join('')}</div></div>
    <div class="card">${ui.confirmReset ? `<p><b>Segur?</b> S'esborraran el pla i tots els registres d'aquest dispositiu.</p><div class="row"><button class="btn danger" data-a="reset-yes">Sí, esborra-ho tot</button><button class="btn ghost" data-a="reset-no">Cancel·la</button></div>` : '<button class="btn line" data-a="reset">Esborrar totes les dades</button>'}</div>
    <p class="small muted">Pacely és gratuïta i de codi obert. Els ritmes es calculen amb el model VDOT de Jack Daniels. No està afiliada a Runna ni a cap altra app. Si tens dolor que no desapareix en 48 h, para i consulta un professional.</p>`;
}

function watchCard() {
  const c = connCfg(state);
  const nActs = Object.keys(state.activities || {}).length;
  const p = state.polar;
  const ago = p?.lastSync ? Math.round((Date.now() - p.lastSync) / 60000) : null;
  return `<div class="card"><span class="label">Rellotge</span>
    ${p ? `<div class="row between"><span>Connectat a <b>Polar Flow</b></span><button class="btn ghost sm" data-a="disconnect">Desconnectar</button></div>
      <p class="small muted">${ago === null ? 'Encara no s\'ha sincronitzat.' : ago < 1 ? 'Sincronitzat fa un moment.' : `Última sincronització fa ${ago < 60 ? ago + ' min' : Math.round(ago / 60) + ' h'}.`} ${nActs} curses importades.</p>
      <button class="btn" data-a="sync" ${ui.syncing ? 'disabled' : ''}>${ui.syncing ? 'Sincronitzant…' : 'Sincronitzar ara'}</button>`
    : `<p class="small muted">Connecta Polar Flow i Pacely registrarà soles les teves curses a la sessió del dia, amb km, temps i pulsacions. És gratuït.</p>
      <button class="btn" data-a="connect">Connectar amb Polar Flow</button>
      <p class="small muted">Polar només comparteix les curses que pugis <b>després</b> de connectar (fins a 30 dies enrere).</p>`}
    <details><summary class="small" style="cursor:pointer">Configuració de la connexió</summary>
      <form id="connCfg" class="stack" style="margin-top:10px">
        <label class="field"><span>Client ID de Polar AccessLink</span><input type="text" id="cfgPolar" value="${esc(c.polarId)}" placeholder="de admin.polaraccesslink.com"></label>
        <label class="field"><span>Adreça del Worker</span><input type="text" id="cfgWorker" value="${esc(c.worker)}" placeholder="https://pacely-connect.….workers.dev"></label>
        <button class="btn ghost" type="submit">Desa la configuració</button>
        <p class="small muted">A Polar AccessLink, posa com a adreça de retorn (redirect URL): <b class="mono" style="word-break:break-all">${esc(location.origin + location.pathname)}</b></p>
      </form></details>
    <hr style="border:none;border-top:1px solid var(--line);margin:4px 0">
    <span class="small">Sense connexió: exporta la cursa de Polar Flow en GPX o TCX i importa-la aquí.</span>
    <label class="btn line" for="actFiles">Importar fitxers GPX / TCX</label><input type="file" id="actFiles" accept=".gpx,.tcx,application/gpx+xml,application/vnd.garmin.tcx+xml,application/xml,text/xml" multiple hidden></div>`;
}

function screenZones() {
  const z = zones(PLAN.vdotNow, PLAN.current.racePace);
  return `<div class="row"><a href="#avui" class="btn ghost sm">← Avui</a></div><h1>Els ritmes</h1>
    <p class="muted">Calculats amb el teu índex de forma (VDOT ${PLAN.vdotNow.toFixed(1)}). Canvien quan registres un test o una cursa, o quan acceptes una proposta.</p>
    ${paceCard(true)}
    ${['E', 'M', 'T', 'I', 'R', 'RP'].map(k => `<div class="card"><div class="row between"><span class="row"><i style="width:12px;height:12px;border-radius:3px;background:var(--z-${k})"></i><h3>${ZONE_INFO[k].name}</h3></span><span class="mono">${zr(z[k])} /km</span></div><p class="small muted">${ZONE_INFO[k].feel}</p></div>`).join('')}`;
}

// ---------- Exportacions ----------
function download(name, mime, text) {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function exportIcs() {
  const icsEsc = s => String(s).replace(/\\/g, '\\\\').replace(/[,;]/g, m => '\\' + m).replace(/\n/g, '\\n');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const ev = allSessions().filter(s => s.date >= TODAY).map(s => {
    const d = s.date.replace(/-/g, '');
    const e = iso(addDays(fromIso(s.date), 1)).replace(/-/g, '');
    const desc = s.km ? stepRows(s, s.week.zones).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/ (?=Escalfament|Tornada|\d+ ×|\d+,?\d* km)/g, '\n').trim()
      : ROUTINES[s.routine].ex.map(x => `${x.n}: ${x.d}`).join('\n');
    return ['BEGIN:VEVENT', `UID:${s.id}@pacely`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${e}`,
      `SUMMARY:${icsEsc(`S${s.week.idx + 1} · ${s.title}`)}`, `DESCRIPTION:${icsEsc(desc + (s.note ? '\n' + s.note : ''))}`, 'TRANSP:TRANSPARENT', 'END:VEVENT'].join('\r\n');
  });
  download('pacely-pla.ics', 'text/calendar', ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Pacely//CA', 'CALSCALE:GREGORIAN', ...ev, 'END:VCALENDAR'].join('\r\n'));
}

function exportCsv() {
  const rows = [['data', 'sessio', 'tipus', 'estat', 'km', 'temps', 'ritme', 'rpe', 'notes']];
  for (const l of Object.values(state.logs).sort((a, b) => a.date.localeCompare(b.date))) {
    rows.push([l.date, l.title, TYPE_INFO[l.type]?.name || l.type, l.status === 'done' ? 'feta' : 'saltada', l.km || '', l.sec ? fmtTime(l.sec) : '', l.sec && l.km ? fmtPace(l.sec / l.km) : '', l.rpe || '', l.notes || '']);
  }
  download('pacely-historial.csv', 'text/csv', rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n'));
}

// ---------- Cursa amb GPS ----------
let RUN = null;
const HR = new HeartRate();
HR.on(() => updateRun());

function ensureRun(arg) {
  const pend = Recorder.pending();
  let sid = arg && arg !== 'lliure' ? arg : null;
  if (RUN?.s.startedAt) return RUN;
  if (pend) sid = pend.sessionId || pend.libId || null;
  if (RUN && (RUN.sessionId || RUN.s.libId || null) === sid) return RUN;
  RUN?.stop();
  // Sessió del pla, entrenament de la biblioteca o cursa lliure
  const lib = sid?.startsWith('w-') ? libraryItem(sid) : null;
  const s = lib ? { ...lib, title: lib.name, km: stepsKm(lib.steps), week: PLAN.current } : sid ? findSession(sid) : null;
  const wx = s ? wxFor(lib ? TODAY : s.date) : null;
  const zz = s ? (wx?.pct ? heatZones(s.week.zones, wx.pct) : s.week.zones) : null;
  const long = s && (s.type === 'long' || estSeconds(s, zz) > 70 * 60);
  const opts = {
    sessionId: s && !lib ? sid : null, segments: buildSegments(s?.km ? s : null, zz), title: s ? s.title : 'Cursa lliure',
    fuelEvery: long ? 35 * 60 : 0,
    targetSpeech, noPaceAlerts: targetType() !== 'pace' || s?.type === 'runwalk',
    onUpdate: updateRun, onEvent: (kind, msg) => { ui.runMsg = msg; updateRun(); },
  };
  RUN = pend ? Recorder.restore(opts) : new Recorder(opts);
  if (lib) RUN.s.libId = lib.id;
  RUN.hr = HR;
  if (RUN.s.startedAt) RUN.start(); else RUN.warmup();
  return RUN;
}

function screenRun(arg) {
  const r = ensureRun(arg);
  ui.runCtl = null; ui.hrKey = null;
  setTimeout(updateRun, 0);
  return `<div class="run">
    <div class="row between"><a class="btn ghost sm" href="#avui">← Sortir</a><span class="pill" id="rGps">GPS…</span><button class="btn ghost sm" data-a="run-mute" id="rMute">Veu</button></div>
    <div><span class="label">${r.sessionId ? 'Sessió guiada' : 'Cursa lliure'}</span><h1>${esc(r.title)}</h1></div>
    <div class="card"><span class="label">Ara</span><h2 id="rSeg">–</h2>
      <div class="row between"><span class="mono" id="rTarget"></span><span class="mono" id="rLeft"></span></div>
      <div class="runbar"><i id="rBar"></i></div><p class="small muted" id="rNext"></p></div>
    <div class="runbig"><span class="label">Ritme actual</span><b id="rPace" class="mono">–</b></div>
    ${hrSupported() ? '<div class="hrrow"><div><span class="label">Pulsacions</span><b id="rHr" class="mono">–</b><span class="small muted" id="rHrAvg"></span></div><div id="rHrCtl"></div></div>' : ''}
    <div class="kv"><div><span class="label">Distància</span><b id="rDist">0,00</b></div><div><span class="label">Temps</span><b id="rTime">0:00</b></div><div><span class="label">Ritme mitjà</span><b id="rAvg">–</b></div></div>
    <p class="note warn" id="rMsg" hidden></p>
    <div class="stack" id="rCtl"></div>
    <p class="small muted">Mantén la pantalla encesa i Pacely oberta mentre corres: si bloqueges el mòbil, el navegador pot deixar de rebre el GPS. Si portes el Polar, no cal gravar amb el mòbil: la cursa arribarà sola.</p>
    ${hrSupported() ? `<details class="small"><summary style="cursor:pointer">Com veure les pulsacions del Polar aquí</summary>
      <ol style="margin:8px 0 0;padding-left:20px;display:grid;gap:4px">
        <li>Al rellotge, entra a <b>Començar entrenament</b> i tria l'esport, però encara no comencis.</li>
        <li>Obre el menú ràpid (botó LIGHT o la icona) i tria <b>Share HR with other device</b> (Compartir FC amb un altre dispositiu).</li>
        <li>Aquí, toca <b>Connectar el Polar</b> i tria el rellotge de la llista.</li>
        <li>Comença l'entrenament al rellotge i la cursa a Pacely.</li>
      </ol></details>` : ''}</div>`;
}

function updateRun() {
  const r = RUN;
  if (!r || !document.getElementById('rSeg')) return;
  const $ = id => document.getElementById(id);
  const sg = r.segment;
  const prog = r.segProgress();
  const cur = r.currentPace();
  const fresh = Date.now() - r.lastFix < 10000;
  $('rGps').textContent = !fresh ? 'Sense GPS' : r.acc <= 10 ? 'GPS bo' : r.acc <= 30 ? `GPS ±${Math.round(r.acc)} m` : `GPS feble ±${Math.round(r.acc)} m`;
  $('rGps').className = `pill ${fresh && r.acc <= 30 ? 'acc' : 'sun'}`;
  $('rMute').textContent = r.s.muted ? 'Veu: no' : 'Veu: sí';
  $('rSeg').textContent = r.s.paused && r.s.startedAt ? `En pausa · ${sg.label}` : sg.label;
  $('rTarget').textContent = sg.zone && targetType() !== 'pace' ? targetTxt(sg.zone, {}) : sg.pace ? `${fmtPace(sg.pace[0])}–${fmtPace(sg.pace[1])} /km` : sg.work ? 'Fort' : '';
  $('rLeft').textContent = sg.kind === 'dist' ? `queden ${Math.max(0, Math.round(prog.left))} m` : sg.kind === 'time' ? `queden ${fmtTime(Math.max(0, prog.left))}` : '';
  $('rBar').parentElement.hidden = sg.kind === 'open';
  $('rBar').style.width = sg.kind === 'open' ? '0%' : `${Math.min(100, (prog.done / sg.target) * 100)}%`;
  const nx = r.segments[r.s.seg + 1];
  $('rNext').textContent = nx ? `Després: ${nx.label}` : '';
  $('rPace').textContent = isFinite(cur) ? fmtPace(cur) : '–';
  $('rPace').style.color = isFinite(cur) && sg.pace && targetType() === 'pace' ?(cur < sg.pace[0] - 8 || cur > sg.pace[1] + 8 ? 'var(--warn)' : 'var(--ok)') : '';
  $('rDist').textContent = (r.s.dist / 1000).toFixed(2).replace('.', ',') + ' km';
  $('rTime').textContent = fmtTime(r.elapsed);
  $('rAvg').textContent = isFinite(r.avgPace()) ? fmtPace(r.avgPace()) : '–';
  $('rMsg').hidden = !ui.runMsg; $('rMsg').textContent = ui.runMsg || '';
  const hk = $('rHr') ? HR.status : null;
  if (hk) {
    $('rHr').textContent = HR.fresh ? HR.bpm : '–';
    $('rHrAvg').textContent = r.s.hrN ? ` mitjana ${Math.round(r.s.hrSum / r.s.hrN)} · màx. ${r.s.hrMax}` : '';
  }
  if (hk && ui.hrKey !== hk) {
    ui.hrKey = hk;
    $('rHrCtl').innerHTML = {
      off: '<button class="btn ghost sm" data-a="hr-connect">Connectar el Polar</button>',
      connecting: '<span class="small muted">Connectant…</span>',
      connected: `<span class="small">${esc(HR.name)}</span> <button class="btn ghost sm" data-a="hr-off">Treure</button>`,
      reconnecting: '<span class="small muted">Senyal perdut, reconnectant…</span>',
      lost: '<button class="btn ghost sm" data-a="hr-connect">Tornar a connectar</button>',
    }[hk];
  }
  const key = ui.runConfirm ? 'confirm' : !r.s.startedAt ? 'ready' : r.s.paused ? 'paused' : `run-${sg.kind === 'open'}`;
  if (ui.runCtl === key) return;
  ui.runCtl = key;
  $('rCtl').innerHTML = key === 'confirm'
    ? `<p><b>Vols acabar la cursa?</b></p><button class="btn block" data-a="run-save">Desar la cursa</button><div class="row"><button class="btn ghost grow" data-a="run-back">Continuar corrent</button><button class="btn line grow" data-a="run-discard">Descartar</button></div>`
    : key === 'ready' ? `<button class="btn block" data-a="run-start" style="padding:18px;font-size:1.15rem">▶ Començar</button>`
    : key === 'paused' ? `<button class="btn block" data-a="run-resume" style="padding:18px">Continuar</button><button class="btn ghost block" data-a="run-finish">Acabar</button>`
    : `<div class="row"><button class="btn ghost grow" data-a="run-pause" style="padding:16px">Pausa</button>${key === 'run-false' ? '<button class="btn ghost grow" data-a="run-next" style="padding:16px">Tram següent ›</button>' : ''}</div><button class="btn line block" data-a="run-finish">Acabar</button>`;
}

async function saveRun() {
  const a = RUN.finish();
  RUN = null; ui.runConfirm = false; ui.runMsg = '';
  if (a.km < 0.05) { toast('La cursa és massa curta i no s\'ha desat.'); location.hash = '#avui'; return; }
  state.activities[a.key] = a;
  const s = a.sessionId && findSession(a.sessionId);
  if (s && !state.logs[s.id]) state.logs[s.id] = logFor(s, a);
  save();
  location.hash = s ? `#s/${s.id}` : '#historial';
  await finishImport();
  toast(`Cursa desada: ${kmTxt(a.km)} km en ${fmtTime(a.sec)}. Indica l'esforç a sota.`);
}

// ---------- Router ----------
const ui = { draft: null, confirmReset: false, syncing: false, runMsg: '', runConfirm: false, runCtl: null, adjKind: null, adjDays: 3, wxLoading: false };
function applyTheme() {
  if (state.theme) document.documentElement.setAttribute('data-theme', state.theme);
  else document.documentElement.removeAttribute('data-theme');
}

function checkBadges() {
  try {
    const list = achievements(state, PLAN, records(state), TODAY).list;
    const done = list.filter(a => a.done).map(a => a.id);
    const first = !Array.isArray(state.badges);
    const fresh = done.filter(id => !(state.badges || []).includes(id));
    if (!fresh.length) return;
    state.badges = done; save();
    if (!first) setTimeout(() => toast(`🏅 Nou assoliment: ${list.find(a => a.id === fresh[0]).name}`), 400);
  } catch { /* els assoliments no han de trencar mai l'app */ }
}

function render() {
  applyTheme();
  if (!state.profile || ob) {
    if (!ob) ob = defaults();
    tabs(null); renderOnboarding(); return;
  }
  computePlan();
  refreshWx(false);
  checkBadges();
  const [route, arg] = (location.hash.slice(1) || 'avui').split('/');
  const map = { avui: screenToday, pla: screenPlan, forca: screenStrength, historial: screenHistory, perfil: screenProfile, ritmes: screenZones, ajust: screenAdjust, entrenos: screenLibrary };
  const tab = { s: 'pla', e: 'pla', entrenos: 'pla', ritmes: 'avui', ajust: 'avui' }[route] || route;
  tabs(map[tab] ? tab : 'avui');
  document.body.classList.toggle('running', route === 'run');
  const html = route === 'run' ? screenRun(arg) : route === 's' ? screenSession(arg) : route === 'e' ? screenLibItem(arg) : (map[route] || screenToday)();
  app.innerHTML = `<div class="screen stack" style="gap:18px">${html}</div>`;
  if (route === 'pla') document.querySelector('details.week[open]')?.scrollIntoView({ block: 'center' });
}

window.addEventListener('hashchange', () => { ui.draft = null; ui.confirmReset = false; render(); window.scrollTo(0, 0); });

// ---------- Esdeveniments ----------
document.addEventListener('click', e => {
  const el = e.target.closest('[data-a]');
  if (!el) return;
  const a = el.dataset.a, v = el.dataset.v, k = el.dataset.k;
  if (a.startsWith('ob-') || (a === 'ob-set')) readObInputs();
  switch (a) {
    case 'ob-next':
      if (ob.step === 4 && !TEMPLATES[ob.template]?.relative && !ob.days.includes(ob.longDay)) return;
      if (ob.step === 5) {
        state.profile = obProfile();
        ob = null; save(); location.hash = '#avui'; render();
        toast('Pla creat. Som-hi!');
        return;
      }
      // El pla preparat ja té data i dies: de la distància passa a la forma, i de la forma al resum
      {
        const rel = TEMPLATES[ob.template]?.relative;
        if (ob.step === 4 && rel && ob.days.length < 3) return;
        ob.step = !ob.template ? ob.step + 1 : ob.step === 1 ? (rel ? 4 : 3) : ob.step === 3 ? 5 : ob.step === 4 ? 5 : ob.step + 1;
      }
      renderOnboarding(); window.scrollTo(0, 0); break;
    case 'ob-back': {
      const rel = TEMPLATES[ob.template]?.relative;
      ob.step = !ob.template ? ob.step - 1 : ob.step === 5 ? (rel ? 4 : 3) : ob.step <= 4 ? 1 : ob.step - 1;
      renderOnboarding(); break;
    }
    case 'ob-template': {
      const t = TEMPLATES[v];
      if (t.relative) Object.assign(ob, { template: t.id, distance: '5k', hasRace: false, raceDate: '', raceName: '', goal: '', ...(t.id === 'start5k' ? { level: 'beg', hasResult: false } : {}) });
      else Object.assign(ob, { template: t.id, distance: t.distance, hasRace: true, raceDate: t.raceDate, raceName: t.raceName, goal: ob.goal || '1:59:00' });
      renderOnboarding(); break;
    }
    case 'ob-set': {
      if (k === 'distance') ob.template = null;
      let val = v;
      if (k === 'hasRace' || k === 'hasResult') val = v === '1';
      if (k === 'strength' || k === 'yoga') val = +v;
      ob[k] = val; renderOnboarding(); break;
    }
    case 'ob-day': {
      const d = +v;
      ob.days = ob.days.includes(d) ? ob.days.filter(x => x !== d) : [...ob.days, d].sort((x, y) => x - y);
      if (!ob.days.includes(ob.longDay) && ob.days.length) ob.longDay = ob.days.includes(6) ? 6 : ob.days[ob.days.length - 1];
      renderOnboarding(); break;
    }
    case 'open-week': { e.preventDefault(); const d = document.getElementById('w' + v); if (d) { d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); } break; }
    case 'draft':
      readDraft();
      ui.draft[k] = k === 'rpe' ? +v : v; render(); break;
    case 'unlog': {
      const id = location.hash.split('/')[1];
      const key = state.logs[id]?.actKey;
      if (key && state.activities[key]) state.activities[key].ignored = true;
      delete state.logs[id]; ui.draft = null; save(); render(); toast(key ? 'Registre esborrat. Aquesta activitat ja no es tornarà a importar aquí.' : 'Registre esborrat'); break;
    }
    case 'quick-rpe': {
      const l = state.logs[el.dataset.id];
      if (l) { l.rpe = +v; l.needsRpe = false; save(); render(); toast('Esforç desat'); }
      break;
    }
    case 'connect': {
      const c = connCfg(state);
      if (!c.polarId || !c.worker) {
        const d = document.querySelector('#connCfg')?.closest('details');
        if (d) d.open = true;
        toast('Primer omple el Client ID i l\'adreça del Worker a "Configuració de la connexió".'); break;
      }
      location.href = authUrl(state); break;
    }
    case 'sync': doSync(true); break;
    case 'heat-on': enableHeat(); break;
    case 'pi-accept': case 'pace-manual':
      state.profile.paceAdj = [...(state.profile.paceAdj || []), { date: TODAY, delta: +v }];
      save(); render(); toast(+v > 0 ? 'Ritmes pujats' : 'Ritmes baixats'); break;
    case 'pi-decline': state.paceDecline = TODAY; save(); render(); toast('D\'acord, ho tornarem a mirar amb les properes sessions'); break;
    case 'thumb': {
      const l = state.logs[location.hash.split('/')[1]];
      if (l) { l.thumb = v; if (v === 'up') l.reasons = []; save(); render(); }
      break;
    }
    case 'reason': {
      const l = state.logs[location.hash.split('/')[1]];
      if (l) { l.reasons = (l.reasons || []).includes(v) ? l.reasons.filter(x => x !== v) : [...(l.reasons || []), v]; save(); render(); }
      break;
    }
    case 'difficulty': state.profile.difficulty = +v; save(); render(); toast('Dificultat canviada: el pla s\'ha recalculat'); break;
    case 'target': state.settings = { ...(state.settings || {}), target: v }; save(); render(); break;
    case 'yoga': state.profile.yoga = +v; save(); render(); break;
    case 'plan-view': ui.planView = v; render(); break;
    case 'stat-year': ui.statYear = +(ui.statYear || TODAY.slice(0, 4)) + +v; render(); break;
    case 'cal-month': { const [y, m] = (ui.calMonth || TODAY.slice(0, 7)).split('-').map(Number); const d = new Date(y, m - 1 + +v, 1); ui.calMonth = iso(d).slice(0, 7); render(); break; }
    case 'cal-day':
      if (ui.moving) {
        const s = findSession(ui.moving);
        const ws = s.week.start, we = s.week.end;
        if (v >= ws && v <= we) { const orig = s.movedFrom || s.date; if (v === orig) delete state.moves[s.id]; else state.moves[s.id] = v; save(); toast(`Sessió moguda al ${fmtDate(v)}`); }
        else toast('Només la pots moure dins de la mateixa setmana.');
        ui.moving = null;
      } else ui.calDay = v;
      render(); break;
    case 'cal-move': ui.moving = ui.moving === v ? null : v; render(); break;
    case 'cross-del': state.cross = (state.cross || []).filter(c => c.id !== v); save(); render(); toast('Entrenament esborrat'); break;
    case 'treadmill': state.settings = { ...(state.settings || {}), treadmill: !state.settings?.treadmill }; save(); render(); break;
    case 'adj-kind': ui.adjKind = v; render(); break;
    case 'adj-days': ui.adjDays = +v; render(); break;
    case 'adj-apply': {
      const kind = ui.adjKind;
      if (!kind) { toast('Tria com et trobes.'); break; }
      if (kind === 'holiday') {
        const from = document.getElementById('hoFrom').value, to = document.getElementById('hoTo').value;
        if (!from || !to || to < from) { toast('Revisa les dates: la de tornada ha de ser posterior.'); break; }
        (state.adjust ||= []).push({ kind, from, to, easyOnly: document.getElementById('hoEasy').checked, created: new Date().toISOString() });
      } else {
        const days = kind === 'break' ? 7 : ui.adjDays || 3;
        (state.adjust ||= []).push({ kind, from: TODAY, to: iso(addDays(fromIso(TODAY), days - 1)), created: new Date().toISOString() });
      }
      save(); ui.adjKind = null; location.hash = '#avui'; toast('Pla ajustat. Mira els canvis a la setmana.'); break;
    }
    case 'adj-undo': state.adjust.splice(+v, 1); save(); render(); toast('Ajust desfet'); break;
    case 'run-start': ui.runMsg = ''; RUN?.start(); updateRun(); break;
    case 'run-pause': RUN?.pause(); break;
    case 'run-resume': RUN?.resume(); break;
    case 'run-next': RUN?.next(); break;
    case 'run-mute': RUN?.toggleMute(); break;
    case 'run-finish': ui.runConfirm = true; updateRun(); break;
    case 'run-back': ui.runConfirm = false; updateRun(); break;
    case 'run-save': saveRun(); break;
    case 'hr-connect':
      HR.connect().then(ok => { if (ok) { ui.runMsg = ''; toast(`Pulsacions connectades: ${HR.name}`); } })
        .catch(err => { ui.runMsg = err.message; updateRun(); });
      break;
    case 'hr-off': HR.disconnect(); break;
    case 'run-discard': RUN?.finish(); Recorder.discard(); RUN = null; ui.runConfirm = false; ui.runMsg = ''; location.hash = '#avui'; toast('Cursa descartada'); break;
    case 'gpx': { const a = state.activities[v]; if (a) download(`pacely-${a.date}.gpx`, 'application/gpx+xml', toGpx(a)); break; }
    case 'disconnect': delete state.polar; save(); render(); toast('Polar Flow desconnectat'); break;
    case 'edit-plan': {
      const p = state.profile;
      const r = p.base;
      const rk = Object.keys(DIST).find(x => Math.abs(DIST[x].m - r.distM) < 1) || '5k';
      ob = { ...defaults(), step: 1, distance: p.distance, hasRace: !!p.raceDate, raceDate: p.raceDate || '', raceName: p.raceName || '', weeks: p.weeks || 12,
        level: p.level, hasResult: true, resDist: rk, resTime: fmtTime(r.sec), goal: p.goalSec ? fmtTime(p.goalSec) : '',
        days: p.days, longDay: p.longDay, strength: p.strength, mobility: p.mobility, keepStart: true, template: p.template || null, yoga: p.yoga || 0 };
      render(); window.scrollTo(0, 0); break;
    }
    case 'del-result': state.profile.results.splice(+v, 1); save(); render(); toast('Resultat tret'); break;
    case 'export-ics': exportIcs(); toast('Calendari descarregat'); break;
    case 'export-csv': exportCsv(); toast('CSV descarregat'); break;
    case 'export-json': download(`pacely-${TODAY}.json`, 'application/json', JSON.stringify(state, null, 2)); toast('Còpia descarregada'); break;
    case 'theme': state.theme = v || undefined; save(); render(); break;
    case 'reset': ui.confirmReset = true; render(); break;
    case 'reset-no': ui.confirmReset = false; render(); break;
    case 'reset-yes': state = { logs: {}, moves: {} }; save(); ui.confirmReset = false; ob = null; location.hash = ''; render(); break;
  }
});

function readDraft() {
  if (!ui.draft) return;
  const g = id => document.getElementById(id);
  if (g('lgKm')) ui.draft.km = g('lgKm').value;
  if (g('lgTime')) ui.draft.time = g('lgTime').value;
  if (g('lgNotes')) ui.draft.notes = g('lgNotes').value;
}

document.addEventListener('input', e => {
  if (e.target.id === 'weeks') { const o = document.getElementById('wv'); if (o) o.textContent = e.target.value; }
});

document.addEventListener('change', e => {
  const t = e.target;
  if (ob && ['raceDate', 'resDist', 'longDay', 'mobility'].includes(t.id)) { readObInputs(); renderOnboarding(); }
  if (ob && ['resTime', 'goal'].includes(t.id)) { readObInputs(); renderOnboarding(); }
  if (t.id === 'runHour') { state.settings = { ...(state.settings || {}), runHour: +t.value }; save(); render(); return; }
  if (t.id === 'moveTo') {
    const id = location.hash.split('/')[1];
    const s = findSession(id);
    const orig = s.movedFrom || s.date;
    if (t.value === orig) delete state.moves[id]; else state.moves[id] = t.value;
    save(); render(); toast(`Sessió moguda al ${fmtDate(t.value)}`);
  }
  if (t.id === 'actFiles' && t.files.length) {
    Promise.all([...t.files].map(f => f.text().then(txt => parseActivityFile(txt, f.name)))).then(async acts => {
      let added = 0;
      for (const a of acts) { if (!state.activities[a.key]) added++; state.activities[a.key] = { ...state.activities[a.key], ...a }; }
      const m = await finishImport();
      toast(m.length ? `${m.length} ${m.length === 1 ? 'sessió registrada' : 'sessions registrades'}. Indica l'esforç a la pantalla Avui.` : added ? 'Importat, però no coincideix amb cap sessió pendent del pla.' : 'Aquests fitxers ja estaven importats.');
    }).catch(err => toast(err.message));
  }
  if (t.id === 'importFile' && t.files[0]) {
    t.files[0].text().then(txt => {
      const data = JSON.parse(txt);
      if (!data.profile || typeof data.logs !== 'object') throw new Error();
      state = { logs: {}, moves: {}, ...data }; ob = null; save(); location.hash = '#avui'; render(); toast('Còpia restaurada');
    }).catch(() => toast('Aquest fitxer no és una còpia de Pacely.'));
  }
});

document.addEventListener('submit', e => {
  e.preventDefault();
  if (e.target.id === 'logForm') {
    readDraft();
    const id = location.hash.split('/')[1];
    const s = findSession(id);
    const d = ui.draft;
    const sec = parseTime(d.time);
    if (d.status === 'done' && (s.type === 'test' || s.type === 'race') && !sec) { toast('Escriu el temps per poder recalcular els ritmes.'); return; }
    if (d.status === 'done' && s.km && d.time && !sec) { toast('El temps ha de ser com 45:30 o 1:05:00.'); return; }
    const prev = state.logs[id] || {};
    state.logs[id] = {
      ...prev, needsRpe: false, needsTime: false,
      id, date: s.date, type: s.type, title: s.title, status: d.status,
      km: d.status === 'done' && s.km ? Math.max(0, parseFloat(String(d.km).replace(',', '.')) || s.km) : 0,
      sec: d.status === 'done' ? sec : null, rpe: d.status === 'done' ? d.rpe || null : null, notes: d.notes.trim(),
      distM: s.distM || null, targetKm: s.km, savedAt: new Date().toISOString(),
    };
    const before = PLAN.events.length;
    save(); ui.draft = null; render();
    toast(PLAN.events.length > before ? 'Desat. El pla s\'ha adaptat: mira la pantalla Avui.' : 'Sessió desada');
  }
  if (e.target.id === 'connCfg') {
    const g = id => document.getElementById(id).value.trim();
    state.settings = { ...(state.settings || {}), polarClientId: g('cfgPolar'), worker: g('cfgWorker') };
    save(); render(); toast('Configuració desada');
  }
  if (e.target.id === 'crossForm') {
    const g = id => document.getElementById(id).value;
    const min = parseInt(g('crMin'), 10);
    if (!min || min < 1) { toast('Escriu quants minuts has fet.'); return; }
    const km = parseFloat(String(g('crKm')).replace(',', '.')) || null;
    const rpe = Math.min(10, Math.max(0, parseInt(g('crRpe'), 10) || 0)) || null;
    state.cross = [...(state.cross || []), { id: `c${Date.now()}`, kind: g('crKind'), date: g('crDate') || TODAY, min, km, rpe }];
    save(); render(); toast('Entrenament creuat afegit');
  }
  if (e.target.id === 'hrForm') {
    const v = parseInt(document.getElementById('maxHr').value, 10);
    if (!v || v < 120 || v > 230) { toast('Escriu una freqüència màxima entre 120 i 230.'); return; }
    state.settings = { ...(state.settings || {}), maxHr: v };
    save(); render(); toast('Zones de pulsacions desades');
  }
  if (e.target.id === 'resultForm') {
    const sec = parseTime(document.getElementById('rsTime').value);
    if (!sec) { toast('Escriu el temps com 25:30 o 1:52:10.'); return; }
    const distM = DIST[document.getElementById('rsDist').value].m;
    const date = document.getElementById('rsDate').value || TODAY;
    state.profile.results = [...(state.profile.results || []), { date, distM, sec }];
    save(); render(); toast(`Forma actualitzada: VDOT ${vdotFrom(distM, sec).toFixed(1)}`);
  }
});

render();

handleRedirect(state).then(r => {
  if (!r) {
    if (state.profile && state.polar && Date.now() - (state.polar.lastSync || 0) > 15 * 60000) doSync(false);
    return;
  }
  save(); render();
  if (r === 'connected') { toast('Polar Flow connectat. Buscant curses…'); doSync(true); }
  else toast('Has cancel·lat la connexió amb Polar Flow.');
}).catch(e => { save(); render(); toast(e.message || 'No s\'ha pogut connectar'); });

if ('serviceWorker' in navigator && location.hostname === 'localhost') {
  navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()));
} else if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
