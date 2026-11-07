// QA · Sesiones y operaciones de cuenta
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar } from './helper.js';

let app;
before(async () => { app = await iniciar(); });
after(() => app.cerrar());
beforeEach(() => app.reiniciar());

describe('Login', () => {
  test('credenciales correctas devuelven token', async () => {
    const r = await app.pedir('/api/login', { cuerpo: { usuario: 'carlos', password: '1234' } });
    assert.equal(r.status, 200);
    assert.match(r.datos.token, /^[0-9a-f-]{36}$/);
  });

  test('el usuario no distingue mayúsculas ni espacios', async () => {
    const r = await app.pedir('/api/login', { cuerpo: { usuario: '  CARLOS ', password: '1234' } });
    assert.equal(r.status, 200);
  });

  test('contraseña incorrecta o usuario inexistente → 401', async () => {
    for (const cuerpo of [{ usuario: 'carlos', password: '0000' }, { usuario: 'nadie', password: '1234' }, { usuario: 'carlos' }, {}]) {
      assert.equal((await app.pedir('/api/login', { cuerpo })).status, 401, JSON.stringify(cuerpo));
    }
  });

  test('la contraseña no se compara como número', async () => {
    assert.equal((await app.pedir('/api/login', { cuerpo: { usuario: 'carlos', password: 1234 } })).status, 401);
  });

  test('nombres de propiedades de Object no son usuarios', async () => {
    for (const usuario of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
      const r = await app.pedir('/api/login', { cuerpo: { usuario } });
      assert.equal(r.status, 401, usuario);
    }
  });

  test('cuerpo que no es un objeto JSON → error controlado', async () => {
    for (const crudo of ['null', '[]', '"texto"', '42', 'true']) {
      const r = await app.pedir('/api/login', { crudo });
      assert.ok([400, 401].includes(r.status), `${crudo} → ${r.status}`);
    }
  });

  test('JSON mal formado → 400 sin filtrar detalles internos', async () => {
    const r = await app.pedir('/api/login', { crudo: '{"usuario":' });
    assert.equal(r.status, 400);
    assert.equal(r.datos.error, 'JSON inválido');
  });
});

describe('Autorización', () => {
  test('rutas privadas sin token, con token falso o vacío → 401', async () => {
    for (const ruta of ['/api/yo', '/api/eventos']) {
      assert.equal((await app.pedir(ruta)).status, 401);
      assert.equal((await app.pedir(ruta, { token: 'falso' })).status, 401);
    }
    assert.equal((await app.pedir('/api/depositar', { cuerpo: { monto: 10 }, headers: { Authorization: 'Bearer ' } })).status, 401);
  });

  test('cerrar sesión invalida sólo ese token', async () => {
    const t1 = await app.login();
    const t2 = await app.login();
    await app.pedir('/api/logout', { cuerpo: {}, token: t1 });
    assert.equal((await app.pedir('/api/yo', { token: t1 })).status, 401);
    assert.equal((await app.pedir('/api/yo', { token: t2 })).status, 200);
  });

  test('/api/yo no expone la contraseña ni el estado interno del AFD', async () => {
    const d = await app.yo(await app.login());
    const texto = JSON.stringify(d);
    assert.ok(!('password' in d) && !texto.includes('"1234"'));
    assert.ok(!('afd' in d));
    assert.equal(d.tarjeta.enmascarada, '4521 **** **** 9804');
  });

  test('el historial de compras inicial forma el perfil del cliente', async () => {
    const d = await app.yo(await app.login());
    assert.equal(d.movimientos.length, 5);
    assert.ok(d.movimientos.every((m) => m.tipo === 'compra' && m.monto < 0));
    // más reciente primero
    assert.ok(new Date(d.movimientos[0].fecha) > new Date(d.movimientos[4].fecha));
  });
});

describe('Depósitos y retiros', () => {
  test('depósito válido suma al saldo y registra movimiento', async () => {
    const token = await app.login();
    const r = await app.pedir('/api/depositar', { cuerpo: { monto: 100.5 }, token });
    assert.equal(r.status, 200);
    assert.equal(r.datos.saldo, 5100.5);
    assert.equal(r.datos.movimientos[0].tipo, 'deposito');
  });

  test('montos inválidos → 400 y el saldo no cambia', async () => {
    const token = await app.login();
    const invalidos = [0, -5, 'abc', '', null, true, false, [], [5], {}, '1e400', 0.001, 'NaN', 'Infinity'];
    for (const monto of invalidos) {
      const r = await app.pedir('/api/depositar', { cuerpo: { monto }, token });
      assert.equal(r.status, 400, `monto ${JSON.stringify(monto)} → ${r.status}`);
    }
    assert.equal((await app.yo(token)).saldo, 5000);
  });

  test('acepta montos como texto numérico', async () => {
    const token = await app.login();
    assert.equal((await app.pedir('/api/depositar', { cuerpo: { monto: ' 250 ' }, token })).datos.saldo, 5250);
  });

  test('montos exageradamente grandes se rechazan', async () => {
    const token = await app.login();
    for (const monto of [1e308, 1e16, 10_000_001]) {
      assert.equal((await app.pedir('/api/depositar', { cuerpo: { monto }, token })).status, 400, String(monto));
    }
  });

  test('el saldo se mantiene exacto en centavos', async () => {
    const token = await app.login();
    for (let i = 0; i < 3; i++) await app.pedir('/api/depositar', { cuerpo: { monto: 0.1 }, token });
    assert.equal((await app.yo(token)).saldo, 5000.3);
    for (let i = 0; i < 3; i++) await app.pedir('/api/retirar', { cuerpo: { monto: 0.1 }, token });
    assert.equal((await app.yo(token)).saldo, 5000);
  });

  test('montos se redondean a centavos', async () => {
    const token = await app.login();
    assert.equal((await app.pedir('/api/depositar', { cuerpo: { monto: 10.005 }, token })).datos.saldo, 5010.01);
  });

  test('retiro mayor al saldo → 400; retiro de todo el saldo deja 0', async () => {
    const token = await app.login();
    assert.equal((await app.pedir('/api/retirar', { cuerpo: { monto: 5000.01 }, token })).status, 400);
    assert.equal((await app.pedir('/api/retirar', { cuerpo: { monto: 5000 }, token })).datos.saldo, 0);
    assert.equal((await app.pedir('/api/retirar', { cuerpo: { monto: 0.01 }, token })).status, 400);
  });
});

describe('Transferencias', () => {
  test('transferencia válida mueve el dinero y registra en ambas cuentas', async () => {
    const tc = await app.login('carlos');
    const ta = await app.login('ana');
    const r = await app.pedir('/api/transferir', { cuerpo: { destino: ' ANA ', monto: 200 }, token: tc });
    assert.equal(r.status, 200);
    assert.equal(r.datos.saldo, 4800);
    const ana = await app.yo(ta);
    assert.equal(ana.saldo, 3400);
    assert.match(ana.movimientos[0].descripcion, /Carlos/);
  });

  test('a sí mismo, a inexistente, vacío o sin fondos → 400', async () => {
    const token = await app.login();
    for (const cuerpo of [
      { destino: 'carlos', monto: 10 },
      { destino: 'nadie', monto: 10 },
      { destino: '', monto: 10 },
      { monto: 10 },
      { destino: 'ana', monto: 999999 },
      { destino: 'ana', monto: -10 },
    ]) {
      assert.equal((await app.pedir('/api/transferir', { cuerpo, token })).status, 400, JSON.stringify(cuerpo));
    }
    assert.equal((await app.yo(token)).saldo, 5000);
  });

  test('nombres de propiedades de Object no son cuentas destino', async () => {
    const token = await app.login();
    for (const destino of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      const r = await app.pedir('/api/transferir', { cuerpo: { destino, monto: 10 }, token });
      assert.equal(r.status, 400, destino);
    }
    assert.equal((await app.yo(token)).saldo, 5000);
    assert.equal({}.saldo, undefined, 'Object.prototype no debe quedar contaminado');
  });
});
