// Entrenador: explicació abans de cada sessió, adaptació a la calor, estratègia de cursa i biblioteca d'entrenaments.

import { fmtPace, fmtTime } from './vdot.js';

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
export { fmtTime };
