// QA · Pasarela de pagos y detector de fraude contra el servidor real
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar, TARJETAS } from './helper.js';

const C = TARJETAS.carlos;
const A = TARJETAS.ana;
const MIN = 60_000;

let app;
before(async () => { app = await iniciar(); });
after(() => app.cerrar());
beforeEach(() => app.reiniciar());

const afd = (id = 'carlos') => app.usuarios[id].afd;
const alertas = (id = 'carlos') => app.usuarios[id].alertas;
// Simula que el último intento fue hace `min` minutos
const retroceder = (min, id = 'carlos') => { afd(id).ultimoIntento -= min * MIN; };

describe('Validación de la pasarela', () => {
  test('número que no pasa Luhn → rechazo sin tocar ninguna cuenta', async () => {
    const r = await app.pagar({ ...C, numero: '4521883466729801', monto: 10 });
    assert.deepEqual(r, { aprobado: false, motivo: 'Número de tarjeta inválido' });
    assert.equal(app.usuarios.carlos.movimientos.length, 5);
  });

  test('tarjeta válida pero de otro banco → rechazo', async () => {
    const r = await app.pagar({ numero: '4111111111111111', exp: '12/30', cvv: '123', monto: 10 });
    assert.equal(r.aprobado, false);
    assert.match(r.motivo, /no emitida/);
  });

  test('montos inválidos → "Monto inválido"', async () => {
    for (const monto of [0, -1, 'abc', null, undefined, '1e400', 0.001, true, [5]]) {
      const r = await app.pagar({ ...C, monto });
      assert.equal(r.motivo, 'Monto inválido', `monto ${JSON.stringify(monto)}`);
    }
    assert.equal(afd().estado, 'q0', 'montos inválidos no alimentan al AFD');
  });

  test('cuerpo vacío o null no tumba la pasarela', async () => {
    assert.equal((await app.pedir('/api/pagos', { cuerpo: {} })).datos.aprobado, false);
    const r = await app.pedir('/api/pagos', { crudo: 'null' });
    assert.ok(r.status === 400 || r.datos.aprobado === false);
  });

  test('acepta el número con espacios o guiones, y vencimiento con espacios', async () => {
    assert.equal((await app.pagar({ ...C, numero: '4521-8834-6672-9804', monto: 10 })).aprobado, true);
    assert.equal((await app.pagar({ ...C, numero: '4521 8834 6672 9804', exp: ' 08/29 ', monto: 10 })).aprobado, true);
  });

  test('CVV o vencimiento incorrectos → rechazo sin cobrar', async () => {
    assert.equal((await app.pagar({ ...C, cvv: '000', monto: 10 })).motivo, 'Datos de la tarjeta incorrectos');
    assert.equal((await app.pagar({ ...C, exp: '08/30', monto: 10 })).motivo, 'Datos de la tarjeta incorrectos');
    assert.equal((await app.pagar({ ...C, cvv: undefined, monto: 10 })).motivo, 'Datos de la tarjeta incorrectos');
    assert.equal(app.usuarios.carlos.saldo, 5000);
  });

  test('fondos insuficientes → rechazo sin cobrar', async () => {
    const r = await app.pagar({ ...C, monto: 5000.01 });
    assert.equal(r.motivo, 'Fondos insuficientes');
    assert.equal(app.usuarios.carlos.saldo, 5000);
  });

  test('pago aprobado descuenta, registra y devuelve autorización', async () => {
    const r = await app.pagar({ ...C, monto: 123.45, comercio: 'Café', concepto: 'Latte' });
    assert.equal(r.aprobado, true);
    assert.match(r.autorizacion, /^[0-9A-F]{6}$/);
    assert.equal(app.usuarios.carlos.saldo, 4876.55);
    const m = app.usuarios.carlos.movimientos.at(-1);
    assert.equal(m.tipo, 'compra');
    assert.equal(m.descripcion, 'Latte · Café');
  });

  test('pagar exactamente el saldo disponible deja 0', async () => {
    app.usuarios.carlos.saldo = 300;
    assert.equal((await app.pagar({ ...C, monto: 300 })).aprobado, true);
    assert.equal(app.usuarios.carlos.saldo, 0);
  });

  test('el saldo no acumula errores de punto flotante', async () => {
    for (let i = 0; i < 3; i++) await app.pagar({ ...C, monto: 0.1 });
    assert.equal(app.usuarios.carlos.saldo, 4999.7);
  });

  test('comercio y concepto se recortan y se guardan como texto', async () => {
    await app.pagar({ ...C, monto: 5, comercio: 'x'.repeat(500), concepto: { a: 1 } });
    const m = app.usuarios.carlos.movimientos.at(-1);
    assert.equal(m.comercio.length, 60);
    assert.ok(typeof m.descripcion === 'string');
  });
});

describe('Detector: ráfaga de intentos', () => {
  test('una y dos compras seguidas no alertan', async () => {
    await app.pagar({ ...C, monto: 399 });
    await app.pagar({ ...C, monto: 399 });
    assert.equal(alertas().length, 0);
    assert.equal(afd().estado, 'q2');
  });

  test('tres compras seguidas alertan una sola vez, y siguen aprobándose', async () => {
    for (let i = 0; i < 5; i++) assert.equal((await app.pagar({ ...C, monto: 399 })).aprobado, true);
    assert.equal(afd().estado, 'q5');
    assert.equal(alertas().length, 1);
    assert.equal(alertas()[0].nivel, 'sospecha');
  });

  test('compras separadas por más de 5 min no alertan', async () => {
    for (let i = 0; i < 4; i++) {
      await app.pagar({ ...C, monto: 399 });
      retroceder(6);
    }
    assert.equal(alertas().length, 0);
  });

  test('exactamente 5 min entre compras sigue contando como seguidas', async () => {
    for (let i = 0; i < 3; i++) {
      await app.pagar({ ...C, monto: 20 });
      retroceder(5 - 0.001); // un poco menos de 5 min de margen por el tiempo de la petición
    }
    assert.equal(alertas().length, 1);
  });

  test('ráfaga y luego cargo grande → rechazado y tarjeta bloqueada', async () => {
    for (let i = 0; i < 3; i++) await app.pagar({ ...C, monto: 25 });
    const r = await app.pagar({ ...C, monto: 2198 });
    assert.equal(r.aprobado, false);
    assert.equal(r.motivo, 'Cargo bloqueado por sospecha de fraude');
    assert.equal(app.usuarios.carlos.tarjeta.bloqueada, true);
    assert.equal(alertas().at(-1).nivel, 'fraude');
    assert.equal(app.usuarios.carlos.saldo, 5000 - 75);
  });

  test('compra, error de CVV, compra cuenta como tres intentos', async () => {
    await app.pagar({ ...C, monto: 50 });
    await app.pagar({ ...C, cvv: '000', monto: 50 });
    await app.pagar({ ...C, monto: 50 });
    assert.equal(alertas().length, 1);
  });

  test('con la tarjeta bloqueada todo se rechaza y el AFD no cambia', async () => {
    for (let i = 0; i < 3; i++) await app.pagar({ ...C, monto: 25 });
    await app.pagar({ ...C, monto: 2000 });
    const n = alertas().length;
    const r = await app.pagar({ ...C, monto: 5 });
    assert.equal(r.motivo, 'Tarjeta bloqueada');
    assert.equal(afd().estado, 'q6');
    assert.equal(alertas().length, n);
  });
});

describe('Detector: sondeo de saldo', () => {
  test('montos que bajan hasta que uno alcanza → bloqueado', async () => {
    assert.equal((await app.pagar({ ...C, monto: 15999 })).motivo, 'Fondos insuficientes');
    assert.equal((await app.pagar({ ...C, monto: 5196 })).motivo, 'Fondos insuficientes');
    assert.equal(alertas().length, 1, 'el segundo rechazo alerta');
    const r = await app.pagar({ ...C, monto: 2598 });
    assert.equal(r.motivo, 'Cargo bloqueado por sospecha de fraude');
    assert.equal(app.usuarios.carlos.saldo, 5000);
    assert.equal(app.usuarios.carlos.tarjeta.bloqueada, true);
  });

  test('un solo error de CVV y luego la compra correcta no alerta', async () => {
    await app.pagar({ ...C, cvv: '999', monto: 399 });
    assert.equal((await app.pagar({ ...C, monto: 399 })).aprobado, true);
    assert.equal(alertas().length, 0);
  });

  test('sondeo y luego pausa larga: el cargo grande pasa', async () => {
    await app.pagar({ ...C, monto: 15999 });
    await app.pagar({ ...C, monto: 9999 });
    retroceder(10);
    assert.equal((await app.pagar({ ...C, monto: 2000 })).aprobado, true);
  });
});

describe('Detector: perfil del cliente', () => {
  test('una compra grande aislada se aprueba sin alerta', async () => {
    assert.equal((await app.pagar({ ...C, monto: 2500 })).aprobado, true);
    assert.equal(alertas().length, 0);
  });

  test('$1,299 es normal para Ana pero grande para Carlos', async () => {
    for (let i = 0; i < 3; i++) await app.pagar({ ...A, monto: 30 });
    assert.equal((await app.pagar({ ...A, monto: 1299 })).aprobado, true, 'Ana: dentro de su perfil');

    for (let i = 0; i < 3; i++) await app.pagar({ ...C, monto: 30 });
    assert.equal((await app.pagar({ ...C, monto: 1299 })).aprobado, false, 'Carlos: fuera de su perfil');
  });

  test('las tarjetas de distintos clientes no se mezclan', async () => {
    await app.pagar({ ...C, monto: 30 });
    await app.pagar({ ...A, monto: 30 });
    await app.pagar({ ...C, monto: 30 });
    assert.equal(afd('carlos').estado, 'q2');
    assert.equal(afd('ana').estado, 'q1');
  });
});

describe('Respuestas del cliente', () => {
  async function conAlerta() {
    const token = await app.login();
    for (let i = 0; i < 3; i++) await app.pagar({ ...C, monto: 20 });
    return { token, id: alertas()[0].id };
  }

  test('"Sí, fui yo" descarta la alerta y reinicia el AFD', async () => {
    const { token, id } = await conAlerta();
    const r = await app.pedir(`/api/alertas/${id}/respuesta`, { cuerpo: { fuiYo: true }, token });
    assert.equal(r.status, 200);
    assert.equal(alertas()[0].estado, 'descartada');
    assert.equal(afd().estado, 'q0');
    assert.equal((await app.pagar({ ...C, monto: 2000 })).aprobado, true, 'tras confirmar, el cargo grande pasa');
  });

  test('"No fui yo" bloquea la tarjeta', async () => {
    const { token, id } = await conAlerta();
    await app.pedir(`/api/alertas/${id}/respuesta`, { cuerpo: { fuiYo: false }, token });
    assert.equal(alertas()[0].estado, 'confirmada');
    assert.equal(app.usuarios.carlos.tarjeta.bloqueada, true);
  });

  test('una alerta sólo se puede responder una vez', async () => {
    const { token, id } = await conAlerta();
    await app.pedir(`/api/alertas/${id}/respuesta`, { cuerpo: { fuiYo: false }, token });
    const r = await app.pedir(`/api/alertas/${id}/respuesta`, { cuerpo: { fuiYo: true }, token });
    assert.equal(r.status, 409);
    assert.equal(app.usuarios.carlos.tarjeta.bloqueada, true);
  });

  test('no se pueden responder alertas de otro cliente', async () => {
    const { id } = await conAlerta();
    const tokenAna = await app.login('ana');
    assert.equal((await app.pedir(`/api/alertas/${id}/respuesta`, { cuerpo: { fuiYo: true }, token: tokenAna })).status, 404);
  });

  test('alerta inexistente → 404', async () => {
    const token = await app.login();
    assert.equal((await app.pedir('/api/alertas/no-existe/respuesta', { cuerpo: { fuiYo: true }, token })).status, 404);
  });

  test('"fui yo" en una alerta de fraude no desbloquea la tarjeta', async () => {
    const token = await app.login();
    for (let i = 0; i < 3; i++) await app.pagar({ ...C, monto: 20 });
    await app.pagar({ ...C, monto: 3000 });
    const fraude = alertas().find((a) => a.nivel === 'fraude');
    await app.pedir(`/api/alertas/${fraude.id}/respuesta`, { cuerpo: { fuiYo: true }, token });
    assert.equal(app.usuarios.carlos.tarjeta.bloqueada, true);
    assert.equal(afd().estado, 'q6');
  });
});

describe('Bloqueo manual', () => {
  test('bloquear y desbloquear; desbloquear reinicia el AFD y cierra alertas pendientes', async () => {
    const token = await app.login();
    for (let i = 0; i < 3; i++) await app.pagar({ ...C, monto: 20 });
    await app.pagar({ ...C, monto: 3000 });
    const r = await app.pedir('/api/tarjeta/bloqueo', { cuerpo: { bloqueada: false }, token });
    assert.equal(r.datos.tarjeta.bloqueada, false);
    assert.equal(afd().estado, 'q0');
    assert.ok(alertas().every((a) => a.estado !== 'pendiente'), 'no quedan alertas viejas en pantalla');
    assert.equal((await app.pagar({ ...C, monto: 10 })).aprobado, true);
  });

  test('"bloqueada" debe ser booleano', async () => {
    const token = await app.login();
    for (const bloqueada of ['false', 'true', 0, 1, null, undefined]) {
      const r = await app.pedir('/api/tarjeta/bloqueo', { cuerpo: { bloqueada }, token });
      assert.equal(r.status, 400, JSON.stringify(bloqueada));
    }
    assert.equal(app.usuarios.carlos.tarjeta.bloqueada, false);
  });

  test('bloquear manualmente rechaza los cargos', async () => {
    const token = await app.login();
    await app.pedir('/api/tarjeta/bloqueo', { cuerpo: { bloqueada: true }, token });
    assert.equal((await app.pagar({ ...C, monto: 10 })).motivo, 'Tarjeta bloqueada');
  });
});

describe('Concurrencia', () => {
  test('20 cargos simultáneos: saldo consistente y una sola alerta', async () => {
    const rs = await Promise.all(Array.from({ length: 20 }, () => app.pagar({ ...C, monto: 10 })));
    assert.ok(rs.every((r) => r.aprobado));
    assert.equal(app.usuarios.carlos.saldo, 4800);
    assert.equal(alertas().length, 1);
  });
});
