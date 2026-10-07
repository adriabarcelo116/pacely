// Entrenador: explicació abans de cada sessió, adaptació a la calor, estratègia de cursa i biblioteca d'entrenaments.

import { fmtPace, fmtTime, predict } from './vdot.js';
import { estSeconds } from './plan.js';
import { bestFromPoints } from './sync.js';

const MONTHS = ['gen', 'feb', 'març', 'abr', 'maig', 'juny', 'jul', 'ag', 'set', 'oct', 'nov', 'des'];
const short = iso => { const [, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]}`; };
const zr = r => `${fmtPace(r[0])}–${fmtPace(r[1])}`;

// ---------- Calor ----------
// Regla de temperatura + punt de rosada (en °F): com més alta la suma, més s'alenteix el ritme.
export function heatPct(tC, dpC) {
  if (tC == null || dpC == null) return 0;
  const sum = (tC * 9) / 5 + 32 + (dpC * 9) / 5 + 32;
  const table = [[100, 0], [110, 0.5], [120, 1.5], [130, 2.5], [140, 3.75], [150, 5.25], [160, 7], [170, 9], [180, 11]];
  for (const [lim, pct] of table) if (sum <= lim) return pct;
  return 13;
}

export async function fetchForecast(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,dew_point_2m&forecast_days=8&timezone=auto`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('No s\'ha pogut obtenir la previsió del temps.');
  const d = await r.json();
  return { fetched: Date.now(), lat, lon, time: d.hourly.time, t: d.hourly.temperature_2m, dp: d.hourly.dew_point_2m };
}

// Condicions previstes per a un dia i una hora; null si no hi ha previsió
export function weatherAt(wx, date, hour) {
  if (!wx?.time) return null;
  const i = wx.time.indexOf(`${date}T${String(hour).padStart(2, '0')}:00`);
  if (i < 0) return null;
  const t = Math.round(wx.t[i]), dp = Math.round(wx.dp[i]);
  return { t, dp, pct: heatPct(wx.t[i], wx.dp[i]) };
}

export function heatZones(zones, pct) {
  if (!pct) return zones;
  const out = {};
  for (const [k, v] of Object.entries(zones)) out[k] = [v[0] * (1 + pct / 100), v[1] * (1 + pct / 100)];
  return out;
}

// ---------- Explicació de la sessió ----------
const PURPOSE = {
  long: 'La tirada llarga construeix la resistència: més capil·lars, més glucogen i cames que aguanten els últims quilòmetres de la cursa.',
  int: 'Les sèries milloren la potència aeròbica i l\'economia de cursa: córrer ràpid acaba semblant més fàcil.',
  fartlek: 'El fartlek t\'acostuma a canviar de ritme sense estructures rígides. Juga amb els canvis.',
  hills: 'Les pujades fan força específica als glutis i bessons i milloren la tècnica sense castigar gaire.',
  tempo: 'El tempo eleva el llindar: podràs mantenir ritmes alts més estona abans que les cames es carreguin.',
  easy: 'Rodatge per sumar quilòmetres sense fatiga. És el que permet que les sessions dures et facin efecte.',
  runwalk: 'Alternar caminar i córrer construeix la base sense lesions: el cor, els tendons i els ossos s\'adapten a poc a poc.',
  test: 'Avui mesurem la teva forma. Amb el resultat, tots els ritmes del pla es recalcularan.',
  race: 'Dia de cursa. Tot el que has entrenat és aquí: surt amb calma i acaba fort.',
};

function mainZone(s) {
  const work = s.steps.filter(st => st.z && st.z !== 'E' && st.k !== 'warm' && st.k !== 'cool');
  return work[0]?.z || (s.type === 'easy' || s.type === 'long' ? 'E' : null);
}

export function briefing(s, week, plan, logs, wx) {
  const out = [];
  out.push(PURPOSE[s.type] || '');
  const total = plan.weeks.length;
  const phase = { base: 'base', build: 'construcció', spec: 'específica', peak: 'pic', taper: 'posada a punt' }[week.phase];
  out.push(`Setmana ${week.idx + 1} de ${total}, fase de ${phase}${week.deload ? ' (setmana de descàrrega: no forcis)' : ''}.`);

  const z = mainZone(s);
  const zones = wx?.pct ? heatZones(week.zones, wx.pct) : week.zones;
  if (s.type === 'int') out.push(`Clau: repeticions a ${zr(zones[z] || zones.I)}/km i la recuperació trotant de veritat. Millor totes iguals que la primera massa ràpida.`);
  else if (s.type === 'tempo' && z) out.push(`Clau: ${zr(zones[z])}/km de manera constant. Has de poder dir 3 o 4 paraules seguides.`);
  else if (s.type === 'long') out.push(z && z !== 'E' ? `Clau: la part a ritme objectiu (${zr(zones[z])}/km) arriba quan ja portes quilòmetres; no te la saltis ni l'avancis.` : `Clau: ritme conversacional (${zr(zones.E)}/km). Si dubtes, més lent.`);
  else if (s.type === 'easy') out.push(`Clau: ${zr(zones.E)}/km o més lent. Fàcil de debò.`);
  else if (s.type === 'test') out.push('Clau: escalfa bé, surt controlat el primer quilòmetre i buida\'t a l\'últim.');

  // Com van anar les sessions semblants
  const prev = Object.values(logs).filter(l => l.type === s.type && l.date < s.date && l.status === 'done').sort((a, b) => b.date.localeCompare(a.date))[0];
  if (prev?.rpe) {
    const how = prev.rpe >= 9 ? 'va ser molt dura: avui comença conservador i ajusta-ho a mitja sessió' : prev.rpe <= 5 ? 'et va sortir còmoda: si et trobes bé, apura la part ràpida del ritme' : 'va anar com tocava';
    out.push(`L'última (${short(prev.date)}, esforç ${prev.rpe}/10) ${how}.`);
  }
  const week7 = Object.values(logs).filter(l => l.date < s.date && l.date >= isoMinus(s.date, 7) && l.status === 'done' && l.rpe && (l.type === 'easy' || l.type === 'long'));
  if (week7.length >= 2 && week7.reduce((a, l) => a + l.rpe, 0) / week7.length >= 7) out.push('Aquests dies els rodatges suaus t\'han costat: prioritza dormir i menjar bé.');

  if (wx) {
    if (wx.pct >= 0.5) out.push(`Previsió: ${wx.t} °C i punt de rosada ${wx.dp} °C. Els ritmes s'alenteixen un ${String(wx.pct).replace('.', ',')} % per la calor; beu abans de sortir.`);
    else out.push(`Previsió: ${wx.t} °C. Bones condicions per córrer.`);
    if (wx.pct >= 11) out.push('Fa massa calor per a una sessió dura: si pots, canvia-la d\'hora o fes-la suau.');
  }
  if (s.km >= 14 || s.type === 'race') out.push('Porta aigua o planifica on beure, i prova el gel com si fos dia de cursa.');
  return out.filter(Boolean);
}

function isoMinus(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const x = new Date(y, m - 1, d - days);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

// ---------- Estratègia de cursa ----------
// Primers 2 km una mica més lents, centre constant, final una mica més ràpid. El total quadra amb l'objectiu.
export function raceSplits(distKm, goalSec) {
  const n = Math.ceil(distKm - 0.001);
  const w = [];
  for (let k = 1; k <= n; k++) {
    const len = Math.min(1, distKm - (k - 1));
    const f = k <= 2 ? 1.02 : k > n - 3 ? 0.985 : 1;
    w.push({ k, len, f });
  }
  const base = goalSec / w.reduce((a, x) => a + x.len * x.f, 0);
  let cum = 0;
  return w.map(x => { const t = base * x.f * x.len; cum += t; return { km: x.k === n && x.len < 1 ? Math.round(distKm * 10) / 10 : x.k, pace: base * x.f, cum }; });
}

// ---------- Biblioteca d'entrenaments ----------
export const LIBRARY = [
  { id: 'w-easy', cat: 'Suau', name: 'Rodatge suau 6 km', desc: 'Per sumar quilòmetres o recuperar.', type: 'easy', steps: [{ k: 'run', km: 6, z: 'E' }] },
  { id: 'w-strides', cat: 'Suau', name: 'Rodatge 6 km + rectes', desc: 'Suau i acabes amb 6 rectes per activar les cames.', type: 'easy', steps: [{ k: 'run', km: 6, z: 'E' }, { k: 'strides', n: 6, label: '6 rectes de 100 m' }] },
  { id: 'w-prog', cat: 'Tempo', name: 'Progressiu 8 km', desc: 'De fàcil a tempo en els últims 3 km.', type: 'tempo', steps: [{ k: 'run', km: 5, z: 'E' }, { k: 'run', km: 3, z: 'T' }] },
  { id: 'w-tempo', cat: 'Tempo', name: 'Tempo 5 km', desc: 'Llindar clàssic, ritme constant.', type: 'tempo', steps: [{ k: 'warm', km: 2, z: 'E' }, { k: 'run', km: 5, z: 'T' }, { k: 'cool', km: 1, z: 'E' }] },
  { id: 'w-cruise', cat: 'Tempo', name: 'Tempo 3 × 2 km', desc: 'Llindar en blocs amb 90 s de recuperació.', type: 'tempo', steps: [{ k: 'warm', km: 2, z: 'E' }, { k: 'rep', n: 3, km: 2, z: 'T', rec: 90 }, { k: 'cool', km: 1, z: 'E' }] },
  { id: 'w-400', cat: 'Sèries', name: 'Sèries 10 × 400 m', desc: 'Velocitat i economia.', type: 'int', steps: [{ k: 'warm', km: 2, z: 'E', strides: 4 }, { k: 'rep', n: 10, km: 0.4, z: 'I', rec: 75 }, { k: 'cool', km: 1, z: 'E' }] },
  { id: 'w-1k', cat: 'Sèries', name: 'Sèries 5 × 1 km', desc: 'El clàssic per al 10K i la mitja.', type: 'int', steps: [{ k: 'warm', km: 2, z: 'E', strides: 4 }, { k: 'rep', n: 5, km: 1, z: 'I', rec: 120 }, { k: 'cool', km: 1, z: 'E' }] },
  { id: 'w-800', cat: 'Sèries', name: 'Sèries 6 × 800 m', desc: 'Potència aeròbica.', type: 'int', steps: [{ k: 'warm', km: 2, z: 'E', strides: 4 }, { k: 'rep', n: 6, km: 0.8, z: 'I', rec: 105 }, { k: 'cool', km: 1, z: 'E' }] },
  { id: 'w-fartlek', cat: 'Sèries', name: 'Fartlek 10 × 1 min', desc: 'Canvis de ritme lliures.', type: 'fartlek', steps: [{ k: 'warm', km: 2, z: 'E' }, { k: 'fart', n: 10, label: '10 × (1 min ràpid / 1 min suau)', z: 'I' }, { k: 'cool', km: 1, z: 'E' }] },
  { id: 'w-hills', cat: 'Sèries', name: 'Pujades 8 × 45 s', desc: 'Força i tècnica.', type: 'hills', steps: [{ k: 'warm', km: 2, z: 'E' }, { k: 'hill', n: 8, sec: 45, label: '8 × 45 s pujant fort, baixada trotant' }, { k: 'cool', km: 1, z: 'E' }] },
  { id: 'w-longrp', cat: 'Llarga', name: 'Llarga 14 km amb 2 × 3 a ritme', desc: 'Fons amb blocs al ritme de la cursa.', type: 'long', steps: [{ k: 'run', km: 4, z: 'E' }, { k: 'rep', n: 2, km: 3, z: 'RP', recKm: 1 }, { k: 'run', km: 3, z: 'E' }] },
  { id: 'w-long', cat: 'Llarga', name: 'Tirada llarga 16 km', desc: 'Temps de peus a ritme conversacional.', type: 'long', steps: [{ k: 'run', km: 16, z: 'E' }] },
];
export const libraryItem = id => LIBRARY.find(w => w.id === id);

// ---------- Objectius per pulsacions o per esforç ----------
export const RPE_TXT = { E: 'esforç 3–4/10', M: 'esforç 6/10', T: 'esforç 7–8/10', I: 'esforç 8–9/10', R: 'esforç 9/10', RP: 'esforç 7/10' };
const HR_PCT = { E: [0.65, 0.78], M: [0.8, 0.86], T: [0.86, 0.9], I: [0.92, 0.97], R: [0.95, 1] };
const RP_PCT = { '5k': [0.92, 0.96], '10k': [0.88, 0.92], '21k': [0.84, 0.89], '42k': [0.8, 0.86], '50k': [0.75, 0.82] };
export function hrRange(zone, maxHr, dist) {
  const r = zone === 'RP' ? RP_PCT[dist] || RP_PCT['21k'] : HR_PCT[zone];
  return r && maxHr ? [Math.round(r[0] * maxHr), Math.round(r[1] * maxHr)] : null;
}
export const HR_ZONES = [['Z1 · recuperació', 0.5, 0.6], ['Z2 · aeròbic suau', 0.6, 0.7], ['Z3 · aeròbic', 0.7, 0.8], ['Z4 · llindar', 0.8, 0.9], ['Z5 · màxim', 0.9, 1]];
export const hrZoneOf = (bpm, maxHr) => { const f = bpm / maxHr; const i = HR_ZONES.findIndex(([, a, b]) => f >= a && f < b); return i < 0 ? (f >= 1 ? 4 : 0) : i; };

// ---------- Estat dels ritmes ----------
const QUALITY = ['int', 'tempo', 'fartlek', 'hills'];
export const PACE_STATUS = {
  monitoring: { name: 'Recollint dades', text: 'Necessito un parell de sessions de qualitat més per valorar els teus ritmes.' },
  onpoint: { name: 'Ritmes al punt', text: 'Les sessions de qualitat et surten com toca. Segueix així.' },
  ahead: { name: 'Vas per davant', text: 'Les últimes sessions t\'han sortit més fàcils o més ràpides del previst. Pots pujar els ritmes.' },
  review: { name: 'Revisem els ritmes', text: 'Les últimes sessions t\'han costat massa. Uns ritmes una mica més suaus t\'ajudaran a assimilar.' },
  variable: { name: 'Resultats variables', text: 'Unes sessions surten molt bé i altres molt dures. Mira de fer-les completes i amb el ritme marcat.' },
};

export function paceInsight(state, plan) {
  const p = state.profile;
  const cut = [state.paceDecline || '', ...(p.paceAdj || []).map(a => a.date), ...Object.values(state.logs).filter(l => l.type === 'test' && l.sec).map(l => l.date)].sort().pop() || '';
  const sessions = plan.weeks.flatMap(w => w.sessions.map(s => ({ s, w })));
  const items = sessions.filter(({ s }) => QUALITY.includes(s.type) && state.logs[s.id] && s.date > cut).map(({ s, w }) => ({ s, w, l: state.logs[s.id] }))
    .sort((a, b) => b.s.date.localeCompare(a.s.date)).slice(0, 3);
  const res = st => ({ status: st, ...PACE_STATUS[st] });
  if (items.length < 2) return res('monitoring');
  const sig = items.map(({ s, w, l }) => {
    if (l.status === 'skipped') return -1;
    const t = l.actSec || l.sec;
    const diff = t && l.km ? (estSeconds(s, w.zones) / s.km - t / l.km) / (estSeconds(s, w.zones) / s.km) : 0;
    if ((l.rpe && l.rpe >= 9) || diff < -0.04) return -1;
    if ((l.rpe && l.rpe <= 6) || (diff > 0.03 && (!l.rpe || l.rpe <= 7))) return 1;
    return 0;
  });
  const sum = sig.reduce((a, b) => a + b, 0);
  const key = items[0].s.id;
  const gain = d => {
    const now = predict(plan.vdotNow, plan.dist.m), next = predict(plan.vdotNow + d, plan.dist.m);
    return `${d > 0 ? '−' : '+'}${fmtTime(Math.abs(now - next))} a la ${plan.dist.name.toLowerCase()}`;
  };
  if (sum >= 2) return { ...res('ahead'), delta: 0.5, key, change: gain(0.5) };
  if (sum <= -2) return { ...res('review'), delta: -0.5, key, change: gain(-0.5) };
  if (sig.includes(1) && sig.includes(-1)) return res('variable');
  return res('onpoint');
}

// ---------- Anàlisi d'una sessió feta ----------
export const THUMB_REASONS = { tired: 'Estava cansat', heat: 'Calor', pace: 'Ritme massa alt', pain: 'Molèsties', time: 'Poc temps', head: 'Cap a un altre lloc' };
const REASON_TIP = {
  tired: 'Si el cansament dura més de dos dies, fes servir "No em trobo al 100%" i el pla s\'adaptarà.',
  heat: 'Amb calor, activa l\'ajust per calor a la sessió: els ritmes s\'alenteixen sols.',
  pace: 'Si et passa en dues o tres sessions, a "Estat dels ritmes" et proposaré baixar-los.',
  pain: 'Si una molèstia no millora en 48 h, para i consulta-ho. Pots marcar "Estic malalt o lesionat".',
  time: 'Si vas just de temps, mou la sessió a un altre dia o fes servir "Setmana complicada".',
  head: 'Els dies dolents també compten: has sortit igualment. Demà serà un altre dia.',
};

export function sessionAnalysis(s, log, week, ctx) {
  const good = [], improve = [];
  if (log.status !== 'done') return { good, improve };
  const z = week.zones;
  if (s.km && log.km) {
    const r = log.km / s.km;
    if (r >= 0.95) good.push(`Has completat la distància: ${String(log.km).replace('.', ',')} de ${String(s.km).replace('.', ',')} km.`);
    else if (r < 0.8) improve.push(`Has fet ${String(log.km).replace('.', ',')} de ${String(s.km).replace('.', ',')} km. Si va ser per falta de temps, millor escurçar l'escalfament que no les repeticions.`);
  }
  const t = log.actSec || log.sec;
  if (t && log.km && s.km) {
    const pace = t / log.km;
    if (s.type === 'easy' || s.type === 'long' || s.type === 'runwalk') {
      const hasFast = s.steps.some(st => st.z && st.z !== 'E' && st.k !== 'warm' && st.k !== 'cool');
      if (!hasFast && pace < z.E[0] - 10) improve.push(`Ritme mitjà ${fmtPace(pace)}/km: massa ràpid per a un suau (objectiu ${fmtPace(z.E[0])}–${fmtPace(z.E[1])}). Anar suau de debò fa que les sessions dures et facin més efecte.`);
      else good.push(`Ritme mitjà ${fmtPace(pace)}/km, ben controlat.`);
    } else if (QUALITY.includes(s.type)) {
      const planned = estSeconds(s, z) / s.km;
      const diff = (planned - pace) / planned;
      if (diff > 0.03) good.push(`Has anat més ràpid del previst (${fmtPace(pace)}/km de mitjana, incloent-hi escalfament i recuperacions).`);
      else if (diff < -0.04) improve.push(`Més lent del previst (${fmtPace(pace)}/km de mitjana contra ${fmtPace(planned)}). Si va costar molt, potser els ritmes són alts.`);
      else good.push(`Ritmes dins del previst (${fmtPace(pace)}/km de mitjana, sessió sencera).`);
    }
  }
  if (log.hr && ctx.maxHr) {
    const zi = hrZoneOf(log.hr, ctx.maxHr);
    const zname = HR_ZONES[zi][0];
    if ((s.type === 'easy' || s.type === 'long') && zi >= 2 && !s.steps.some(st => st.z === 'RP' || st.z === 'M')) improve.push(`Pulsacions mitjanes ${log.hr} (${zname}): altes per a un suau. Hauries d'anar a Z2.`);
    else good.push(`Pulsacions mitjanes ${log.hr} ppm (${zname}).`);
  }
  if (log.rpe) {
    const easyType = s.type === 'easy' || s.type === 'long' || s.type === 'runwalk';
    if (easyType && log.rpe >= 7) improve.push(`Esforç ${log.rpe}/10 per a una sessió suau: dorm bé, menja prou i no la facis més ràpida del compte.`);
    else if (!easyType && log.rpe >= 9 && s.type !== 'test') improve.push(`Esforç ${log.rpe}/10: molt dura. Si es repeteix, et proposaré ritmes més suaus.`);
    else good.push(`Esforç ${log.rpe}/10: el que tocava per a aquesta sessió.`);
  }
  if (ctx.pb) good.unshift(`🏅 Nou rècord personal: ${ctx.pb}.`);
  for (const r of log.reasons || []) if (REASON_TIP[r]) improve.push(REASON_TIP[r]);
  return { good, improve };
}

// ---------- Rècords i assoliments ----------
const PB_DIST = [[5000, '5K'], [10000, '10K'], [21097.5, 'Mitja marató'], [42195, 'Marató']];

export function records(state) {
  const pb = {};
  const offer = (distM, sec, date, src) => {
    const d = PB_DIST.find(([m]) => Math.abs(m - distM) / m < 0.03);
    if (!d || !sec) return;
    if (!pb[d[0]] || sec < pb[d[0]].sec) pb[d[0]] = { sec, date, src, name: d[1] };
  };
  for (const r of state.profile?.results || []) offer(r.distM, r.sec, r.date, 'cursa');
  for (const l of Object.values(state.logs)) if ((l.type === 'test' || l.type === 'race') && l.status === 'done' && l.sec && l.distM) offer(l.distM, l.sec, l.date, l.type === 'test' ? 'test' : 'cursa');
  for (const a of Object.values(state.activities || {})) {
    if (!a.points?.length || a.dupOf) continue;
    a.best ||= {};
    for (const [m] of PB_DIST) {
      if (a.best[m] === undefined) a.best[m] = (bestFromPoints(a.points, m) && Math.round(bestFromPoints(a.points, m))) || null;
      if (a.best[m]) offer(m, a.best[m], a.date, 'GPS');
    }
  }
  // Curses (de tots els orígens), sense duplicats
  const runs = [];
  const linked = new Set();
  for (const l of Object.values(state.logs)) if (l.status === 'done' && l.km) { runs.push({ date: l.date, km: +l.km, sec: l.actSec || l.sec || 0 }); if (l.actKey) linked.add(l.actKey); }
  for (const a of Object.values(state.activities || {})) if (!linked.has(a.key) && !a.dupOf && !a.ignored) runs.push({ date: a.date, km: a.km, sec: a.sec || 0 });
  const longest = runs.reduce((m, r) => (r.km > (m?.km || 0) ? r : m), null);
  const totalKm = runs.reduce((a, r) => a + r.km, 0);
  return { pb, longest, runs, totalKm };
}

export function achievements(state, plan, rec, todayIso) {
  const logs = Object.values(state.logs).filter(l => l.status === 'done');
  const firstDate = k => logs.filter(k).map(l => l.date).sort()[0];
  // Setmanes seguides amb totes les sessions de córrer fetes
  let streak = 0, best = 0;
  for (const w of plan.weeks) {
    if (w.end >= todayIso) break;
    const runs = w.sessions.filter(s => s.km);
    if (runs.length && runs.every(s => state.logs[s.id]?.status === 'done')) { streak++; best = Math.max(best, streak); } else streak = 0;
  }
  const km = rec.totalKm;
  const list = [
    ['first', 'Primera passa', 'Registra la primera sessió', logs.length > 0],
    ['km50', '50 km', 'Suma 50 km', km >= 50], ['km100', '100 km', 'Suma 100 km', km >= 100], ['km250', '250 km', 'Suma 250 km', km >= 250],
    ['km500', '500 km', 'Suma 500 km', km >= 500], ['km1000', '1.000 km', 'Suma 1.000 km', km >= 1000],
    ['long10', 'Dos dígits', 'Una sortida de 10 km o més', (rec.longest?.km || 0) >= 10], ['long15', '15 km', 'Una sortida de 15 km o més', (rec.longest?.km || 0) >= 15],
    ['long20', '20 km', 'Una sortida de 20 km o més', (rec.longest?.km || 0) >= 20], ['long21', 'Distància de mitja', 'Corre 21,1 km', (rec.longest?.km || 0) >= 21.09],
    ['streak2', 'Constància', '2 setmanes seguides completes', best >= 2], ['streak4', 'Un mes sense fallar', '4 setmanes seguides completes', best >= 4],
    ['streak8', 'Màquina', '8 setmanes seguides completes', best >= 8],
    ['test', 'Posa\'t a prova', 'Fes el primer test', !!firstDate(l => l.type === 'test')],
    ['pb', 'Rècord', 'Aconsegueix una marca personal', Object.keys(rec.pb).length > 0],
    ['cross', 'Multiesport', 'Registra un entrenament creuat', (state.cross || []).length > 0],
    ['strength', 'Fort', 'Fes 10 sessions de força', logs.filter(l => l.type === 'strength').length >= 10],
    ['race', 'Missió complerta', 'Acaba la cursa objectiu', !!firstDate(l => l.type === 'race')],
  ];
  return { list: list.map(([id, name, desc, done]) => ({ id, name, desc, done })), streak, best };
}
export { fmtTime };
