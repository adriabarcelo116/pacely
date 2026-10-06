// Ritmes i prediccions amb el model VDOT de Jack Daniels.
// v en m/min, t en minuts.

const vo2 = v => -4.6 + 0.182258 * v + 0.000104 * v * v;
const pctMax = t => 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);

export function vdotFrom(distM, sec) {
  const t = sec / 60;
  return vo2(distM / t) / pctMax(t);
}

function velocityFor(vo2val) {
  const a = 0.000104, b = 0.182258, c = -(vo2val + 4.6);
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}

// segons per km a una fracció del VDOT
export const paceAt = (vdot, frac) => 60000 / velocityFor(vdot * frac);

export function predict(vdot, distM) {
  let lo = (distM / 1000) * 100, hi = (distM / 1000) * 1200;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (vdotFrom(distM, mid) > vdot) lo = mid; else hi = mid;
  }
  // el model és optimista per sobre de la marató
  return distM > 42195 ? lo * (1 + 0.04 * (distM - 42195) / 7805) : lo;
}

// Zones en s/km: [ràpid, lent]
export function zones(vdot, racePace) {
  const mp = predict(vdot, 42195) / 42.195;
  return {
    E: [paceAt(vdot, 0.74), paceAt(vdot, 0.65)],
    M: [mp - 4, mp + 4],
    T: [paceAt(vdot, 0.885), paceAt(vdot, 0.865)],
    I: [paceAt(vdot, 0.985), paceAt(vdot, 0.965)],
    R: [paceAt(vdot, 1.06), paceAt(vdot, 1.04)],
    RP: [racePace - 3, racePace + 3],
  };
}

export const DIST = {
  '5k': { m: 5000, name: '5K', long: 'Cursa de 5 km' },
  '10k': { m: 10000, name: '10K', long: 'Cursa de 10 km' },
  '21k': { m: 21097.5, name: 'Mitja marató', long: 'Mitja marató' },
  '42k': { m: 42195, name: 'Marató', long: 'Marató' },
  '50k': { m: 50000, name: 'Ultra 50K', long: 'Ultra de 50 km' },
};

// Temps de referència per a qui no té cap marca recent (5K)
export const LEVEL_5K = { beg: 34 * 60, int: 28 * 60, adv: 22 * 60 };

export function fmtPace(sec) {
  if (!isFinite(sec)) return '–';
  sec = Math.round(sec);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

export function fmtTime(sec) {
  if (!isFinite(sec)) return '–';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function parseTime(str) {
  if (!str) return null;
  const p = String(str).trim().replace(/[.,']/g, ':').split(':').map(Number);
  if (!p.length || p.some(n => isNaN(n) || n < 0)) return null;
  let s = 0;
  if (p.length === 3) s = p[0] * 3600 + p[1] * 60 + p[2];
  else if (p.length === 2) s = p[0] * 60 + p[1];
  else s = p[0] * 60;
  return s > 0 ? s : null;
}
