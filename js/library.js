// Rutines de força i mobilitat per a corredors.

export const ROUTINES = {
  A: {
    name: 'Força A · cames',
    min: 30,
    focus: 'Força de cames i glutis. Fes-la el dia després de la tirada llarga o de la sessió dura.',
    ex: [
      { n: 'Esquat búlgar', d: '3 × 8 per cama', h: 'Peu de darrere sobre un banc. Baixa fins que el genoll gairebé toqui terra, tronc lleugerament endavant.' },
      { n: 'Pes mort romanès a una cama', d: '3 × 8 per cama', h: 'Esquena recta, maluc enrere. Sents l\'estirament als isquiotibials. Amb pes a la mà contrària.' },
      { n: 'Pont de glutis', d: '3 × 12', h: 'Puja el maluc apretant glutis 2 s a dalt. Versió difícil: a una cama.' },
      { n: 'Pujades a calaix', d: '3 × 10 per cama', h: 'Empeny només amb la cama de dalt, sense impulsar-te amb la de terra.' },
      { n: 'Elevació de bessons', d: '3 × 15 recte + 15 flexionat', h: 'Lent a la baixada (3 s). Amb genoll flexionat treballes el soli.' },
    ],
  },
  B: {
    name: 'Força B · core i estabilitat',
    min: 20,
    focus: 'Core i control del maluc. No cansa les cames: va bé el dia abans d\'una sessió de qualitat.',
    ex: [
      { n: 'Planxa frontal', d: '3 × 40 s', h: 'Colzes sota les espatlles, cos en línia, sense enfonsar el maluc.' },
      { n: 'Planxa lateral', d: '3 × 30 s per costat', h: 'Maluc amunt. Per fer-la més difícil, aixeca la cama de dalt.' },
      { n: 'Dead bug', d: '3 × 10 per costat', h: 'Lumbar enganxada a terra mentre estires braç i cama contraris.' },
      { n: 'Monster walk amb banda', d: '3 × 12 passes per costat', h: 'Banda per sobre dels genolls, mig esquat, passes laterals curtes.' },
      { n: 'Equilibri a una cama', d: '3 × 30 s per cama', h: 'Ulls tancats o sobre un coixí per fer-ho més difícil.' },
    ],
  },
  C: {
    name: 'Força C · potència',
    min: 25,
    focus: 'Pliometria i rigidesa del tendó per córrer més econòmic. A partir de la fase de construcció.',
    ex: [
      { n: 'Skipping alt', d: '3 × 20 s', h: 'Genolls amunt, contacte curt amb terra, braços actius.' },
      { n: 'Salts a calaix baix', d: '3 × 6', h: 'Aterra suau i baixa caminant. Qualitat per sobre de quantitat.' },
      { n: 'Salts amb una cama (pogo)', d: '3 × 15 per cama', h: 'Salts petits i ràpids amb el genoll gairebé recte.' },
      { n: 'Gambades caminant amb pes', d: '3 × 10 per cama', h: 'Passa llarga, genoll de darrere a prop de terra.' },
      { n: 'Copenhagen plank', d: '2 × 20 s per costat', h: 'Adductors: genoll de dalt sobre un banc, maluc alineat.' },
    ],
  },
  M: {
    name: 'Mobilitat · 15 min',
    min: 15,
    focus: 'Rang de moviment de malucs, turmells i esquena. Ideal després de la tirada llarga o en un dia de descans.',
    ex: [
      { n: 'Estirament del psoes en gambada', d: '2 × 45 s per costat', h: 'Retroversió pèlvica i empeny el maluc endavant.' },
      { n: 'Mobilitat de turmell al mur', d: '2 × 10 per costat', h: 'Genoll cap a la paret sense aixecar el taló.' },
      { n: '90/90 de maluc', d: '2 × 8 canvis', h: 'Assegut, canvia de costat els genolls mantenint l\'esquena recta.' },
      { n: 'Gat-camell', d: '2 × 10', h: 'Moviment lent vèrtebra a vèrtebra.' },
      { n: 'Isquiotibials amb corda', d: '2 × 40 s per cama', h: 'Estirat d\'esquena, cama recta amunt amb una corda o tovallola.' },
      { n: 'Foam roller a bessons i quàdriceps', d: '1 min per zona', h: 'Lent, aturant-te als punts carregats.' },
    ],
  },
};

ROUTINES.Y = {
  name: 'Ioga per a corredors · 20 min',
  min: 20,
  focus: 'Flexibilitat de malucs i esquena, respiració i equilibri. Ideal en un dia de descans o després d\'un rodatge suau.',
  ex: [
    { n: 'Gos cap per avall', d: '5 respiracions × 3', h: 'Talons cap a terra, alterna flexionar un genoll i l\'altre per estirar els bessons.' },
    { n: 'Gambada baixa (anjaneyasana)', d: '5 respiracions per costat', h: 'Genoll de darrere a terra, maluc endavant, braços amunt.' },
    { n: 'Coloma', d: '1 min per costat', h: 'Obre el maluc i el glutis. Si molesta el genoll, fes la versió estirat d\'esquena (figura 4).' },
    { n: 'Guerrer III', d: '5 respiracions per costat', h: 'Equilibri a una cama amb el cos en línia: estabilitat de turmell i maluc.' },
    { n: 'Pinça asseguda', d: '1 min', h: 'Esquena llarga, baixa des del maluc, no des de l\'esquena.' },
    { n: 'Torsió estirat', d: '1 min per costat', h: 'Relaxa la zona lumbar després de córrer.' },
    { n: 'Cames a la paret', d: '3 min', h: 'Recuperació: cames amunt recolzades a la paret, respiració lenta.' },
  ],
};
ROUTINES.S = {
  name: 'Estiraments i estabilitat · 15 min',
  min: 15,
  focus: 'Estiraments suaus i exercicis d\'estabilitat per prevenir lesions. Es pot fer just després de córrer.',
  ex: [
    { n: 'Estirament de quàdriceps dempeus', d: '2 × 30 s per cama', h: 'Genolls junts i maluc endavant.' },
    { n: 'Estirament de bessons a la paret', d: '2 × 30 s per cama', h: 'Cama de darrere recta i després flexionada per al soli.' },
    { n: 'Pont de glutis a una cama', d: '2 × 10 per cama', h: 'Maluc alineat, sense que caigui cap costat.' },
    { n: 'Clamshell amb banda', d: '2 × 15 per costat', h: 'Estirat de costat, obre el genoll sense girar el maluc.' },
    { n: 'Equilibri a una cama amb abast', d: '2 × 8 per cama', h: 'Toca el terra endavant i als costats sense perdre l\'equilibri.' },
  ],
};

export const STEP_LABEL = { warm: 'Escalfament', cool: 'Tornada a la calma', run: 'Carrera', rep: 'Repeticions', strides: 'Rectes' };

export const ZONE_INFO = {
  E: { name: 'Fàcil', feel: 'Pots parlar amb frases senceres. 6/10.' },
  M: { name: 'Ritme marató', feel: 'Sostingut i còmode. 7/10.' },
  T: { name: 'Tempo', feel: 'Còmodament dur. Respostes de 3–4 paraules. 8/10.' },
  I: { name: 'Sèries', feel: 'Ràpid però controlat. 9/10.' },
  R: { name: 'Velocitat', feel: 'Ràpid i fluid, sense tensar-te.' },
  RP: { name: 'Ritme objectiu', feel: 'El ritme de la teva cursa.' },
};

export const TYPE_INFO = {
  long: { name: 'Tirada llarga', cls: 'long' },
  int: { name: 'Sèries', cls: 'int' },
  fartlek: { name: 'Fartlek', cls: 'int' },
  hills: { name: 'Pujades', cls: 'int' },
  tempo: { name: 'Tempo', cls: 'tempo' },
  easy: { name: 'Rodatge fàcil', cls: 'easy' },
  test: { name: 'Test', cls: 'test' },
  race: { name: 'Cursa', cls: 'race' },
  strength: { name: 'Força', cls: 'str' },
  mobility: { name: 'Mobilitat', cls: 'str' },
  yoga: { name: 'Ioga i estiraments', cls: 'str' },
  runwalk: { name: 'Caminar i córrer', cls: 'easy' },
  cross: { name: 'Entrenament creuat', cls: 'str' },
};

export const CROSS_KINDS = { bike: 'Bicicleta', swim: 'Natació', elliptical: 'El·líptica', walk: 'Caminar', hike: 'Muntanya', gym: 'Gimnàs', other: 'Altres' };
