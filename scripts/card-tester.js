// ===== SIMULADOR DE ATAQUE "CARD TESTING" =====
// Imita lo que hace un delincuente con una lista de tarjetas filtradas:
//   1. Hace cargos pequeños en distintos comercios para ver cuáles siguen vivas.
//   2. Con las que pasan, repite un par de pruebas.
//   3. Intenta un cargo grande.
// Sólo habla con la pasarela del banco simulado en localhost; las tarjetas son ficticias.
//
// Uso:  npm run ataque                 (con pausas, para verlo en vivo en la app)
//       npm run ataque -- --rapido     (sin pausas)
import { readFile } from 'node:fs/promises';

const PUERTO = Number(process.env.PORT) || 3000;
const PASARELA = `http://localhost:${PUERTO}/api/pagos`;
const RAPIDO = process.argv.includes('--rapido');
const PAUSA_MS = RAPIDO ? 0 : 2500;

const COMERCIOS = ['DonacionesYa', 'StreamFlix', 'GamerKeys MX', 'App Store Lite', 'Café Online', 'Recargas 24/7'];

const color = (c, s) => `\x1b[${c}m${s}\x1b[0m`;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const azar = (a) => a[Math.floor(Math.random() * a.length)];
const mascara = (n) => `${n.slice(0, 4)} **** **** ${n.slice(-4)}`;

async function cargo(t, monto, comercio = azar(COMERCIOS)) {
  const res = await fetch(PASARELA, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: t.numero, exp: t.exp, cvv: t.cvv, monto, comercio, concepto: 'Compra en línea' }),
  });
  const r = await res.json();
  const etiqueta = r.aprobado ? color('32', 'APROBADO ') : color('31', 'RECHAZADO');
  console.log(`  ${mascara(t.numero)}  $${String(monto).padStart(7)}  ${comercio.padEnd(16)} ${etiqueta} ${r.motivo ? color('2', r.motivo) : ''}`);
  await dormir(PAUSA_MS);
  return r;
}

async function main() {
  const filtracion = JSON.parse(await readFile(new URL('./filtracion.json', import.meta.url), 'utf8'));
  console.log(color('1', `\nLista filtrada: ${filtracion.length} tarjetas\n`));

  // Fase 1: un cargo pequeño a cada tarjeta para ver cuáles están vivas
  console.log(color('33', 'Fase 1 · Probando qué tarjetas siguen activas'));
  const vivas = [];
  for (const t of filtracion) {
    const r = await cargo(t, +(1 + Math.random() * 9).toFixed(2));
    if (r.aprobado && !vivas.some((v) => v.numero === t.numero)) vivas.push(t);
  }

  if (!vivas.length) return console.log(color('2', '\nNinguna tarjeta pasó. Fin.\n'));

  // Fase 2: confirmar con más cargos pequeños en otros comercios
  console.log(color('33', `\nFase 2 · Confirmando ${vivas.length} tarjeta(s) viva(s)`));
  for (const t of vivas) {
    await cargo(t, +(5 + Math.random() * 25).toFixed(2));
    await cargo(t, +(5 + Math.random() * 25).toFixed(2));
  }

  // Fase 3: el cargo grande
  console.log(color('33', '\nFase 3 · Cargo grande'));
  for (const t of vivas) await cargo(t, 4999, 'ElectroMax Online');
  console.log();
}

main().catch((e) => {
  console.error(color('31', `\nNo se pudo contactar al banco en ${PASARELA}. ¿Está corriendo "npm start"?\n`), e.message);
  process.exit(1);
});
