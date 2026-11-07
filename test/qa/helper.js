// Levanta el servidor en un puerto libre y ofrece atajos para llamar a la API.
import { crearServidor } from '../../server/server.js';
import { usuarios, reiniciarDatos } from '../../server/db.js';

export const TARJETAS = {
  carlos: { numero: '4521883466729804', exp: '08/29', cvv: '417' },
  ana:    { numero: '4521991033451230', exp: '03/28', cvv: '952' },
};

export async function iniciar() {
  const servidor = crearServidor();
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;

  async function pedir(ruta, { metodo, cuerpo, token, crudo, headers = {} } = {}) {
    const res = await fetch(base + ruta, {
      method: metodo ?? (cuerpo !== undefined || crudo !== undefined ? 'POST' : 'GET'),
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: crudo ?? (cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined),
      redirect: 'manual',
    });
    const texto = await res.text();
    let datos = texto;
    try { datos = JSON.parse(texto); } catch { /* no es JSON */ }
    return { status: res.status, datos, headers: res.headers };
  }

  async function login(usuario = 'carlos', password = usuario === 'ana' ? '4321' : '1234') {
    const { datos } = await pedir('/api/login', { cuerpo: { usuario, password } });
    return datos.token;
  }

  const pagar = (datos) => pedir('/api/pagos', { cuerpo: { comercio: 'Pruebas', ...datos } }).then((r) => r.datos);
  const comprar = (items, tarjeta) => pedir('/api/tienda/compra', { cuerpo: { items, tarjeta } }).then((r) => r.datos);
  const yo = (token) => pedir('/api/yo', { token }).then((r) => r.datos);

  return {
    base, pedir, login, pagar, comprar, yo, usuarios,
    reiniciar: reiniciarDatos,
    cerrar: () => new Promise((r) => { servidor.closeAllConnections(); servidor.close(r); }),
  };
}
