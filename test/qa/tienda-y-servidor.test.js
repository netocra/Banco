// QA · TechoStore, archivos estáticos, eventos en tiempo real y robustez del servidor
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { iniciar, TARJETAS } from './helper.js';

const C = TARJETAS.carlos;

let app;
before(async () => { app = await iniciar(); });
after(() => app.cerrar());
beforeEach(() => app.reiniciar());

// Petición con la ruta tal cual (fetch normaliza "..", esto no)
function crudo(ruta, metodo = 'GET') {
  const { hostname, port } = new URL(app.base);
  return new Promise((ok, mal) => {
    const req = http.request({ hostname, port, path: ruta, method: metodo }, (res) => {
      let cuerpo = '';
      res.on('data', (d) => (cuerpo += d));
      res.on('end', () => ok({ status: res.statusCode, cuerpo, headers: res.headers }));
    });
    req.on('error', mal);
    req.end();
  });
}

describe('Catálogo y compra', () => {
  test('el catálogo trae id, nombre y precio', async () => {
    const { datos } = await app.pedir('/api/tienda/productos');
    assert.equal(datos.length, 8);
    for (const p of datos) assert.ok(p.id && p.nombre && p.precio > 0);
  });

  test('el total lo calcula el servidor', async () => {
    const r = await app.comprar({ sticker: 2, mouse: 1 }, C);
    assert.equal(r.aprobado, true);
    assert.equal(r.monto, 449);
    assert.equal(app.usuarios.carlos.saldo, 4551);
  });

  test('el cliente no puede cambiar precio ni comercio', async () => {
    const r = await app.pedir('/api/tienda/compra', { cuerpo: { items: { laptop: 1 }, tarjeta: C, monto: 1, comercio: 'Otro' } });
    assert.equal(r.datos.motivo, 'Fondos insuficientes');
    const m = app.usuarios.carlos.movimientos.at(-1);
    assert.equal(m.comercio, 'TechoStore');
    assert.equal(m.monto, -15999);
  });

  test('concepto: nombre del producto o número de artículos', async () => {
    await app.comprar({ mouse: 1 }, C);
    assert.match(app.usuarios.carlos.movimientos.at(-1).descripcion, /^Mouse inalámbrico · TechoStore$/);
    await app.comprar({ mouse: 2, cable: 1 }, C);
    assert.match(app.usuarios.carlos.movimientos.at(-1).descripcion, /^3 artículos/);
  });

  test('carritos vacíos o con formato inválido → "El carrito está vacío"', async () => {
    for (const items of [{}, null, undefined, [], 'sticker', 42, { inexistente: 1 }, { sticker: 0 }, { sticker: -3 }, { sticker: 'x' }, { __proto__: 1 }, { constructor: 1 }]) {
      const r = await app.comprar(items, C);
      assert.equal(r.motivo, 'El carrito está vacío', JSON.stringify(items));
    }
    assert.equal(app.usuarios.carlos.afd.estado, 'q0', 'un carrito vacío no cuenta como intento');
  });

  test('"__proto__" como producto se ignora', async () => {
    const r = await app.pedir('/api/tienda/compra', { crudo: JSON.stringify({ tarjeta: C }).replace('{', '{"items":{"__proto__":{"precio":1},"sticker":1},') });
    assert.equal(r.datos.monto, 25);
  });

  test('cantidades fraccionarias se truncan y texto numérico se acepta', async () => {
    assert.equal((await app.comprar({ sticker: 1.9 }, C)).monto, 25);
    assert.equal((await app.comprar({ sticker: '2' }, C)).monto, 50);
  });

  test('cantidades absurdas se rechazan', async () => {
    for (const cantidad of [1000, 1e9, '1e400', 1e308]) {
      const r = await app.comprar({ sticker: cantidad }, C);
      assert.equal(r.aprobado, false, String(cantidad));
      assert.match(r.motivo, /cantidad/i, String(cantidad));
    }
  });

  test('sin tarjeta o tarjeta mal formada → rechazo controlado', async () => {
    for (const tarjeta of [undefined, null, {}, 'texto', { numero: 123 }]) {
      const r = await app.comprar({ sticker: 1 }, tarjeta);
      assert.equal(r.aprobado, false, JSON.stringify(tarjeta));
    }
  });

  test('las compras de la tienda alimentan al detector', async () => {
    for (let i = 0; i < 3; i++) await app.comprar({ mouse: 1 }, C);
    assert.equal(app.usuarios.carlos.alertas.length, 1);
    assert.equal((await app.comprar({ teclado: 1, audifonos: 1 }, C)).motivo, 'Cargo bloqueado por sospecha de fraude');
  });
});

describe('Archivos estáticos', () => {
  test('páginas principales responden con el tipo correcto', async () => {
    for (const [ruta, tipo] of [['/', 'text/html'], ['/banco/', 'text/html'], ['/banco/login.html', 'text/html'], ['/tienda/', 'text/html'], ['/banco/styles.css', 'text/css'], ['/tienda/tienda.js', 'text/javascript']]) {
      const r = await crudo(ruta);
      assert.equal(r.status, 200, ruta);
      assert.ok(r.headers['content-type'].startsWith(tipo), ruta);
    }
  });

  test('carpeta sin diagonal redirige', async () => {
    const r = await crudo('/banco');
    assert.equal(r.status, 301);
    assert.equal(r.headers.location, '/banco/');
  });

  test('archivo inexistente → 404', async () => {
    assert.equal((await crudo('/no-existe.html')).status, 404);
  });

  test('no se puede salir de public/ (path traversal)', async () => {
    for (const ruta of ['/../server/db.js', '/%2e%2e/server/db.js', '/banco/..%2f..%2fserver%2fdb.js', '/..%5c..%5cserver%5cdb.js', '/....//server/db.js', '/%2e%2e%2f%2e%2e%2fpackage.json']) {
      const r = await crudo(ruta);
      assert.ok([400, 403, 404].includes(r.status), `${ruta} → ${r.status}`);
      assert.ok(!r.cuerpo.includes('password'), `${ruta} filtró código del servidor`);
    }
  });

  test('URL con codificación inválida → 400 sin tumbar el servidor', async () => {
    assert.equal((await crudo('/%E0%A4%A')).status, 400);
    assert.equal((await crudo('/')).status, 200);
  });

  test('métodos distintos de GET/HEAD sobre archivos → 405', async () => {
    assert.equal((await crudo('/banco/', 'POST')).status, 405);
    assert.equal((await crudo('/banco/', 'DELETE')).status, 405);
    assert.equal((await crudo('/banco/', 'HEAD')).status, 200);
  });
});

describe('API: robustez', () => {
  test('ruta inexistente → 401 sin sesión, 404 con sesión', async () => {
    assert.equal((await app.pedir('/api/no-existe')).status, 401);
    const r = await app.pedir('/api/no-existe', { token: await app.login() });
    assert.equal(r.status, 404);
    assert.ok(r.datos.error);
  });

  test('método equivocado en ruta existente → 404', async () => {
    assert.equal((await app.pedir('/api/login', { token: await app.login() })).status, 404);
  });

  test('preflight CORS → 204', async () => {
    assert.equal((await app.pedir('/api/pagos', { metodo: 'OPTIONS' })).status, 204);
  });

  test('cuerpo mayor a 100 KB → 413', async () => {
    const r = await app.pedir('/api/pagos', { crudo: JSON.stringify({ comercio: 'x'.repeat(200_000) }) });
    assert.equal(r.status, 413);
  });

  test('errores no filtran mensajes internos y el servidor sigue vivo', async () => {
    const r = await app.pedir('/api/tienda/compra', { crudo: '{malo' });
    assert.equal(r.status, 400);
    assert.ok(!/Unexpected|position|JSON\.parse|at /.test(r.datos.error), r.datos.error);
    assert.equal((await app.pedir('/api/tienda/productos')).status, 200);
  });

  test('/api/afd publica la definición del autómata', async () => {
    const { datos } = await app.pedir('/api/afd');
    assert.equal(datos.inicial, 'q0');
    assert.ok(Object.keys(datos.delta).length >= 5);
  });
});

describe('Eventos en tiempo real (SSE)', () => {
  async function abrir(token) {
    const ctrl = new AbortController();
    const res = await fetch(`${app.base}/api/eventos?token=${token}`, { signal: ctrl.signal });
    const lector = res.body.getReader();
    let eventos = 0;
    (async () => {
      try {
        for (;;) {
          const { value, done } = await lector.read();
          if (done) break;
          eventos += (new TextDecoder().decode(value).match(/event: cambio/g) ?? []).length;
        }
      } catch { /* cerrado */ }
    })();
    return { res, cuenta: () => eventos, cerrar: () => ctrl.abort() };
  }
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

  test('notifica al dueño de la tarjeta y sólo a él', async () => {
    const carlos = await abrir(await app.login('carlos'));
    const ana = await abrir(await app.login('ana'));
    assert.equal(carlos.res.headers.get('content-type'), 'text/event-stream');
    await esperar(50);
    const [c0, a0] = [carlos.cuenta(), ana.cuenta()];
    await app.pagar({ ...C, monto: 10 });
    await esperar(50);
    assert.equal(carlos.cuenta(), c0 + 1);
    assert.equal(ana.cuenta(), a0);
    carlos.cerrar();
    ana.cerrar();
  });

  test('una transferencia notifica a ambas cuentas', async () => {
    const tc = await app.login('carlos');
    const ana = await abrir(await app.login('ana'));
    await esperar(50);
    const a0 = ana.cuenta();
    await app.pedir('/api/transferir', { cuerpo: { destino: 'ana', monto: 5 }, token: tc });
    await esperar(50);
    assert.equal(ana.cuenta(), a0 + 1);
    ana.cerrar();
  });

  test('cerrar conexiones no deja listeners colgados', async () => {
    const { eventos } = await import('../../server/db.js');
    await esperar(100); // que terminen de cerrarse las conexiones de pruebas anteriores
    const antes = eventos.listenerCount('cambio');
    const conexiones = await Promise.all(Array.from({ length: 5 }, async () => abrir(await app.login())));
    await esperar(50);
    assert.equal(eventos.listenerCount('cambio'), antes + 5);
    conexiones.forEach((c) => c.cerrar());
    await esperar(100);
    assert.equal(eventos.listenerCount('cambio'), antes);
  });
});
