# Pacely

Plans d'entrenament de córrer personalitzats i gratuïts, de 5K a ultra. App web instal·lable (PWA), en català.

**Obre-la:** <https://adriabarcelo116.github.io/pacely/>. Al mòbil, "Afegeix a la pantalla d'inici".

## Què fa

- Plans de 6 a 26 setmanes per a 5K, 10K, mitja, marató i 50K, amb ritmes calculats amb el model VDOT de Jack Daniels.
- El pla s'adapta: els tests i les curses recalculen els ritmes, i les setmanes amb sessions saltades o massa dures fan que la següent sigui més suau.
- Rutines de força i mobilitat, historial, prediccions i exportació a calendari (.ics), CSV i còpia de seguretat.
- Connexió amb Polar Flow (API gratuïta AccessLink) i importació de fitxers GPX/TCX. Vegeu [worker/README.md](worker/README.md).

Les dades es guarden només al dispositiu. No cal compte.

## Provar en local

```bash
node serve.mjs
```

I obre <http://localhost:5180>. Afegeix `?avui=2026-11-02` a l'adreça per simular una altra data.

No està afiliada a Runna ni a cap altra app.
