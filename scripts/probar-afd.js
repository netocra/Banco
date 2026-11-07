// Corre cadenas de prueba por el AFD e imprime la traza de estados.
// Uso:  npm run pruebas            (casos predefinidos)
//       npm run pruebas -- pprpg   (una cadena propia)
import { evaluar, ALFABETO, ESTADOS, esAceptacion } from '../server/afd.js';

const CASOS = [
  ['nnngn',   'Cliente normal: compras medianas y una grande'],
  ['pnpnp',   'Cargos pequeños intercalados con normales (no es patrón)'],
  ['pptpp',   'Cargos pequeños separados por una pausa larga'],
  ['ppp',     'Tres cargos de prueba seguidos → alerta'],
  ['rrppg',   'Ataque completo: rechazos, pruebas y cargo grande → bloqueo'],
  ['pprpng',  'Pruebas, un cargo normal para disimular y luego grande'],
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
