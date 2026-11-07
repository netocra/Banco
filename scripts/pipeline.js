// Corre las etapas de prueba en orden: DEV → QA → UAT.
// Si una etapa falla, las siguientes no se ejecutan.
// Uso:  npm test              (todas)
//       npm test -- qa        (desde una etapa en adelante)
import { spawnSync } from 'node:child_process';

const ETAPAS = [
  ['dev', 'Unitarias: autómata y utilidades de tarjetas'],
  ['qa',  'Integración: API, pasarela, detector, tienda y servidor'],
  ['uat', 'Aceptación: flujos completos en el navegador'],
];

const color = (c, s) => `\x1b[${c}m${s}\x1b[0m`;
const desde = Math.max(0, ETAPAS.findIndex(([e]) => e === process.argv[2]));

for (const [etapa, descripcion] of ETAPAS.slice(desde)) {
  console.log(color('1', `\n━━━ ${etapa.toUpperCase()} · ${descripcion}`));
  const { status } = spawnSync(process.execPath, ['--test', `test/${etapa}/**/*.test.js`], { stdio: 'inherit' });
  if (status !== 0) {
    console.log(color('31;1', `\n✖ ${etapa.toUpperCase()} falló; no se corren las etapas siguientes.\n`));
    process.exit(status ?? 1);
  }
  console.log(color('32;1', `✔ ${etapa.toUpperCase()} aprobada`));
}
console.log(color('32;1', '\nTodas las etapas pasaron.\n'));
