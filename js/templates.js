// Plans preparats: sessions fixes setmana a setmana. Els ritmes surten igualment del VDOT de cada setmana.

const n05 = x => String(x).replace('.', ',');
const mt = km => (km < 1 ? `${Math.round(km * 1000)} m` : `${n05(km)} km`);

// ---------- Constructors de sessions ----------
const long = km => ({ type: 'long', title: `Tirada llarga ${km} km`, steps: [{ k: 'run', km, z: 'E' }], note: 'A ritme conversacional.' });
const longFinish = (e, rp) => ({ type: 'long', title: `Tirada llarga ${e + rp} km (${rp} a ritme mitja)`, steps: [{ k: 'run', km: e, z: 'E' }, { k: 'run', km: rp, z: 'RP' }], note: 'Acaba a ritme de cursa amb les cames cansades.' });
const longBlocks = (first, n, each, rec, last, title) => ({
  type: 'long', title, steps: [{ k: 'run', km: first, z: 'E' }, { k: 'rep', n, km: each, z: 'RP', recKm: rec }, { k: 'run', km: last, z: 'E' }],
  note: 'Practica els gels i el ritme objectiu.',
});
const reps = (n, km, rec) => ({ type: 'int', title: `Sèries ${n} × ${mt(km)}`, steps: [{ k: 'warm', km: 2, z: 'E', strides: 4 }, { k: 'rep', n, km, z: 'I', rec }, { k: 'cool', km: 1, z: 'E' }], note: 'Recuperació trotant suau.' });
const fartlek = n => ({ type: 'fartlek', title: `Fartlek ${n} × 1 min`, steps: [{ k: 'warm', km: 2, z: 'E' }, { k: 'fart', n, label: `${n} × (1 min ràpid / 1 min suau)`, z: 'I' }, { k: 'cool', km: 1, z: 'E' }], note: '' });
const hills = n => ({ type: 'hills', title: `Pujades ${n} × 45 s`, steps: [{ k: 'warm', km: 2, z: 'E' }, { k: 'hill', n, sec: 45, label: `${n} × 45 s pujant fort, baixada trotant` }, { k: 'cool', km: 1, z: 'E' }], note: 'Les pujades de Montjuïc o els ponts de la Devesa van bé.' });
const tempoReps = (n, km, rec) => ({ type: 'tempo', title: `Tempo ${n} × ${n05(km)} km`, steps: [{ k: 'warm', km: 2, z: 'E' }, { k: 'rep', n, km, z: 'T', rec }, { k: 'cool', km: 1, z: 'E' }], note: 'Ritme constant: has d\'acabar amb sensació de control.' });
const tempo = km => ({ type: 'tempo', title: `Tempo ${km} km continus`, steps: [{ k: 'warm', km: 2, z: 'E' }, { k: 'run', km, z: 'T' }, { k: 'cool', km: 1, z: 'E' }], note: 'Ritme constant de principi a final.' });
const progressive = () => ({ type: 'tempo', title: 'Progressiu 6 km', steps: [{ k: 'run', km: 4, z: 'E' }, { k: 'run', km: 2, z: 'T', label: 'acaba a tempo' }, { k: 'cool', km: 1, z: 'E' }], note: 'Comença fàcil i acaba a tempo.' });
const test = distM => ({ type: 'test', distM, title: `Test ${distM / 1000}K a fons`, steps: [{ k: 'warm', km: 2, z: 'E', strides: 4 }, { k: 'run', km: distM / 1000, z: 'TEST', label: `${distM / 1000} km a fons en pla` }, { k: 'cool', km: 1, z: 'E' }], note: 'Registra el temps exacte: els ritmes es recalcularan.' });
const easy = (km, strides) => ({ type: 'easy', title: `Rodatge ${km} km${strides ? ' + rectes' : ''}`, steps: [{ k: 'run', km, z: 'E' }, ...(strides ? [{ k: 'strides', n: 4, label: '4 rectes de 100 m' }] : [])], note: '' });

// ---------- Mitja Marató de Girona 2027 ----------
// Dies: dimarts (1) llarga, dijous (3) sèries, dissabte (5) tempo; força A dimecres (2), força B diumenge (6).
// [fase, descàrrega, llarga, sèries, dissabte, sessions de força, nota]
const G = [
  ['base', 0, long(7), reps(6, 0.4, 90), tempoReps(2, 1.5, 120), 2, 'Comencem. Tot controlat: la idea és crear hàbit.'],
  ['base', 0, long(8), reps(5, 0.6, 120), tempo(3), 2, ''],
  ['base', 0, long(9), reps(8, 0.4, 90), tempoReps(2, 2, 120), 2, ''],
  ['base', 1, long(7), fartlek(8), test(5000), 1, 'Setmana de descàrrega i test 5K.'],
  ['build', 0, long(10), reps(6, 0.8, 120), tempoReps(3, 1.5, 90), 2, ''],
  ['build', 0, long(11), reps(5, 1, 120), tempo(4), 2, ''],
  ['build', 0, longFinish(10, 2), reps(10, 0.4, 75), tempoReps(2, 2.5, 120), 2, 'Primer contacte amb el ritme de cursa al final de la tirada.'],
  ['build', 1, long(9), hills(8), progressive(), 1, 'Descàrrega.'],
  ['build', 0, long(13), reps(4, 1.2, 150), tempo(5), 2, ''],
  ['build', 0, longFinish(11, 3), reps(6, 1, 120), tempoReps(3, 2, 120), 2, 'Primer gel en tirada llarga: prova\'l cap al km 8.'],
  ['build', 0, long(15), reps(12, 0.4, 60), test(10000), 2, 'Test 10K. Per anar a pel sub-2 hauries de fer uns 55:00 o menys.'],
  ['build', 1, long(11), fartlek(10), easy(6, true), 1, 'Setmana de Nadal: descàrrega. Si cau una sessió, no passa res.'],
  ['spec', 0, longBlocks(4, 2, 3, 1, 4, 'Tirada llarga 15 km amb 2 × 3 a ritme mitja'), reps(5, 1.2, 120), tempoReps(2, 3, 120), 2, 'Comença la fase específica.'],
  ['spec', 0, long(16), reps(8, 0.8, 90), tempo(6), 2, ''],
  ['spec', 0, longFinish(12, 5), reps(6, 1, 90), tempoReps(3, 2.5, 90), 2, ''],
  ['spec', 1, long(13), reps(6, 0.6, 90), { type: 'tempo', title: 'Simulacre: 6 km a ritme mitja', steps: [{ k: 'run', km: 2, z: 'E' }, { k: 'run', km: 6, z: 'RP' }, { k: 'run', km: 2, z: 'E' }], note: 'Prova les sabatilles i l\'esmorzar de cursa.' }, 1, 'Descàrrega amb simulacre.'],
  ['spec', 0, long(18), reps(4, 1.6, 120), tempo(7), 2, ''],
  ['peak', 0, longBlocks(2, 3, 4, 1, 3, 'Tirada llarga 19 km amb 3 × 4 a ritme mitja'), reps(10, 0.4, 60), tempoReps(2, 4, 120), 2, 'La setmana més dura del pla. Dorm bé i menja prou.'],
  ['peak', 0, longBlocks(3, 1, 10, 0, 3, 'Tirada llarga 16 km amb 10 a ritme mitja'), reps(5, 1, 90), tempo(6), 2, 'Últim assaig general a ritme de cursa.'],
  ['taper', 0, longFinish(8, 4), reps(6, 0.8, 120), tempo(4), 1, 'Baixa el volum i mantén la intensitat.'],
];

// ---------- Caminar-córrer i tornar a córrer (per temps) ----------
const mmss = s => (s % 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s / 60}`);
const rw = (n, run, walk) => ({
  type: 'runwalk', title: `${n} × (${mmss(run)} min córrer / ${mmss(walk)} min caminar)`,
  steps: [{ k: 'walk', sec: 300, label: '5 min caminant per escalfar' }, { k: 'rw', n, run, walk }, { k: 'walk', sec: 300, label: '5 min caminant per acabar' }],
  note: 'Córrer tan suau que puguis parlar. Si no pots, alenteix: no és cap cursa.',
});
const runFor = (min, strides) => ({
  type: 'easy', title: `Córrer ${min} min seguits${strides ? ' + rectes' : ''}`,
  steps: [{ k: 'walk', sec: 300, label: '5 min caminant per escalfar' }, { k: 'time', sec: min * 60, z: 'E', label: `${min} min a ritme suau` }, ...(strides ? [{ k: 'strides', n: 4, label: '4 rectes de 100 m' }] : []), { k: 'walk', sec: 300, label: '5 min caminant' }],
  note: 'Ritme conversacional de principi a final.',
});

// [sessió 1, sessió 2, sessió 3] per setmana; es posen als 3 primers dies que triïs
const START = [
  [rw(8, 60, 90), rw(8, 60, 90), rw(8, 60, 90)],
  [rw(6, 90, 90), rw(6, 90, 90), rw(6, 90, 90)],
  [rw(5, 180, 90), rw(5, 180, 90), rw(5, 180, 90)],
  [rw(4, 300, 120), rw(4, 300, 120), rw(4, 300, 120)],
  [rw(3, 480, 120), rw(3, 480, 120), rw(3, 480, 120)],
  [rw(2, 720, 120), rw(2, 720, 120), rw(2, 720, 120)],
  [runFor(20), runFor(20), runFor(22)],
  [runFor(25), runFor(25), runFor(25)],
  [runFor(28), runFor(30), test(5000)],
];
const RETURN = [
  [rw(6, 240, 60), rw(6, 240, 60), rw(6, 240, 60)],
  [rw(5, 360, 60), rw(5, 360, 60), rw(5, 360, 60)],
  [runFor(20), runFor(20), runFor(20)],
  [runFor(25), runFor(25), runFor(30)],
  [runFor(30), runFor(30, true), runFor(35)],
  [runFor(35, true), runFor(40), runFor(45)],
];
const relative = (id, name, short, desc, rows, note) => ({
  id, name, short, desc, distance: '5k', raceDate: null, raceName: '', days: null, longDay: null, strength: 0, mobility: false, weeks: rows.length, relative: true,
  week(w, days) {
    const d = [...(days || [1, 3, 5])].sort((a, b) => a - b).slice(0, 3);
    return { phase: w < rows.length / 2 ? 'base' : w < rows.length - 1 ? 'build' : 'taper', deload: false, note: w === 0 ? note : '', items: rows[w].map((s, i) => [d[i % d.length], s]) };
  },
});

export const TEMPLATES = {
  start5k: relative('start5k', 'Començar a córrer: de 0 a 5K', 'Començar a córrer',
    '9 setmanes · 3 dies · alternes caminar i córrer fins a córrer 30 min seguits i fer un 5K',
    START, 'Si una setmana se\'t fa massa dura, repeteix-la abans de passar a la següent. Avançar a poc a poc és la clau.'),
  return: relative('return', 'Tornar a córrer després d\'una aturada', 'Tornar a córrer',
    '6 setmanes · 3 dies · de caminar-córrer a 45 min seguits, per tornar sense lesionar-te',
    RETURN, 'Si tens dolor durant o l\'endemà de córrer, torna a la setmana anterior. Sense presses.'),
  girona27: {
    id: 'girona27', name: 'Mitja Marató de Girona 2027', short: 'Pla de Girona',
    distance: '21k', raceDate: '2027-02-28', raceName: 'Mitja Marató de Girona', startDate: '2026-10-06',
    days: [1, 3, 5], longDay: 1, strength: 2, mobility: false, weeks: 21,
    desc: '21 setmanes · dimarts tirada llarga, dijous sèries, dissabte tempo · força dimecres i diumenge',
    // Torna [{ day (0=dl), session }] per a la setmana w (0..20)
    week(w) {
      if (w === 20) {
        return {
          phase: 'taper', deload: false, note: 'Setmana de cursa. Res de força. Dissabte descans, carbohidrats i dorsal recollit.',
          items: [
            [1, { type: 'easy', title: 'Activació 8 km amb 3 × 1 km a ritme mitja', steps: [{ k: 'run', km: 3, z: 'E' }, { k: 'rep', n: 3, km: 1, z: 'RP', recKm: 0.5 }, { k: 'run', km: 2, z: 'E' }], note: 'Recordatori del ritme, sense cansar-te.' }],
            [3, easy(5, true)],
            [6, { type: 'race', distM: 21097.5, title: 'Mitja Marató de Girona', steps: [{ k: 'run', km: 21.1, z: 'RP', label: 'Cursa' }], note: '8:30 a Fontajau. Km 0–5 a 5:42–5:45, km 5–16 a 5:38–5:40, després a 5:30 si vas bé.' }],
          ],
        };
      }
      const [phase, deload, L, I, S, str, note] = G[w];
      const items = [[1, L], [3, I], [5, S]];
      if (str >= 1) items.push([2, { type: 'strength', routine: 'A', title: 'Força A · cames', steps: [], km: 0, note: '' }]);
      if (str >= 2) items.push([6, { type: 'strength', routine: 'B', title: 'Força B · core', steps: [], km: 0, note: '' }]);
      return { phase, deload: !!deload, note, items };
    },
  },
};
