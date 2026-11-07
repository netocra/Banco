// Corre cadenas de prueba por el AFD e imprime la traza de estados.
// Uso:  npm run pruebas            (casos predefinidos)
//       npm run pruebas -- cccg   (una cadena propia)
import { evaluar, ALFABETO, ESTADOS, esAceptacion } from '../server/afd.js';

const CASOS = [
  ['c',       'Una sola compra'],
  ['ctctc',   'Compras normales separadas por más de 5 min'],
  ['g',       'Una compra grande aislada'],
  ['rc',      'Un error al teclear el CVV y luego la compra correcta'],
  ['ccc',     'Tres intentos seguidos (p. ej. 3 mouses en 2 min) → alerta'],
  ['cctcc',   'Dos intentos, pausa, dos intentos: la pausa reinicia la cuenta'],
  ['ccccg',   'Ráfaga de compras baratas y luego una grande → bloqueo'],
  ['rrg',     'Sondeo de saldo: montos grandes rechazados y luego uno que sí alcanza → bloqueo'],
  ['rrrc',    'Sondeo de saldo que termina en un cargo dentro del perfil → alerta'],
];

const color = (c, s) => `\x1b[${c}m${s}\x1b[0m`;

function mostrar(cadena, descripcion) {
  const { final, aceptada, traza } = evaluar(cadena);
  console.log(color('1', `\nw = "${cadena}"`) + (descripcion ? color('2', `   ${descripcion}`) : ''));
  const camino = ['q0', ...traza.map((t) => t.a)];
  console.log('  ' + camino.map((q, i) => (i ? color('36', ` —${traza[i - 1].simbolo}→ `) : '') + q).join(''));
  const veredicto = aceptada ? color('31;1', `ACEPTADA → ${ESTADOS[final]}`) : color('32', `rechazada (termina en ${final}: ${ESTADOS[final]})`);
  console.log(`  ${veredicto}`);
  const primera = traza.find((t) => esAceptacion(t.a));
  if (primera) console.log(color('33', `  Alerta disparada al leer el símbolo #${traza.indexOf(primera) + 1}`));
}

console.log(color('1', 'Σ:'));
for (const [s, d] of Object.entries(ALFABETO)) console.log(`  ${s}  ${d}`);

const propias = process.argv.slice(2);
if (propias.length) {
  for (const c of propias) {
    if (![...c].every((s) => s in ALFABETO)) {
      console.error(color('31', `\n"${c}" tiene símbolos fuera de Σ = {${Object.keys(ALFABETO).join(', ')}}`));
      continue;
    }
    mostrar(c);
  }
} else {
  for (const [c, d] of CASOS) mostrar(c, d);
}
console.log();
