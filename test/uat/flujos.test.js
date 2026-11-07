// UAT · Flujos completos en un navegador real, como los haría un usuario
// Requiere Chromium. Usa CHROMIUM_PATH o /usr/bin/chromium.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { iniciar, TARJETAS } from '../qa/helper.js';

const RUTA_CHROMIUM = process.env.CHROMIUM_PATH ?? '/usr/bin/chromium';
const C = TARJETAS.carlos;

let app, navegador, contexto, errores;

before(async () => {
  app = await iniciar();
  navegador = await chromium.launch({ executablePath: existsSync(RUTA_CHROMIUM) ? RUTA_CHROMIUM : undefined });
});
after(async () => {
  await navegador?.close();
  await app?.cerrar();
});
beforeEach(async () => {
  app.reiniciar();
  await contexto?.close();
  contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
  // Sin internet: en la exposición puede no haber red, la app debe funcionar igual
  await contexto.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  errores = [];
});

async function pagina() {
  const p = await contexto.newPage();
  p.on('pageerror', (e) => errores.push(e.message));
  p.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|ERR_INTERNET|net::/.test(m.text())) errores.push(m.text());
  });
  return p;
}

async function entrarAlBanco(usuario = 'carlos', password = '1234') {
  const p = await pagina();
  await p.goto(`${app.base}/banco/login.html`);
  await p.fill('#input-user', usuario);
  await p.fill('#input-pass', password);
  await p.click('#form-login button[type=submit]');
  await p.waitForURL(/index\.html/);
  await p.waitForFunction(() => document.getElementById('nav-user').textContent.length > 0);
  return p;
}

async function abrirTienda() {
  const p = await pagina();
  await p.goto(`${app.base}/tienda/`);
  await p.waitForSelector('.producto');
  return p;
}

async function pagarEnTienda(p, productos, tarjeta = C) {
  for (const id of productos) await p.click(`[data-add="${id}"]`);
  await p.click('.cart-btn');
  await p.click('#btn-checkout');
  await p.fill('#pago-titular', 'Carlos Mendez');
  await p.fill('#pago-numero', tarjeta.numero);
  await p.fill('#pago-exp', tarjeta.exp);
  await p.fill('#pago-cvv', tarjeta.cvv);
  await p.click('#btn-pagar');
  await p.waitForFunction(() => !document.getElementById('resultado').classList.contains('hidden')
    || !document.getElementById('pago-error').classList.contains('hidden'));
}

const saldo = (p) => p.textContent('#display-balance');

describe('Banco: acceso', () => {
  test('contraseña incorrecta muestra el error y no entra', async () => {
    const p = await pagina();
    await p.goto(`${app.base}/banco/login.html`);
    await p.fill('#input-user', 'carlos');
    await p.fill('#input-pass', 'mala');
    await p.click('#form-login button[type=submit]');
    await p.waitForSelector('#login-error:not(.hidden)');
    assert.match(p.url(), /login\.html/);
  });

  test('login correcto muestra nombre, tarjeta enmascarada, saldo e historial', async () => {
    const p = await entrarAlBanco();
    assert.equal(await p.textContent('#nav-user'), 'Carlos Méndez');
    assert.equal(await p.textContent('#display-account'), '4521 **** **** 9804');
    assert.match(await saldo(p), /5,000\.00/);
    assert.equal(await p.locator('#transaction-list li').count(), 5);
    assert.deepEqual(errores, []);
  });

  test('el dashboard sin sesión redirige al login', async () => {
    const p = await pagina();
    await p.goto(`${app.base}/banco/index.html`);
    await p.waitForURL(/login\.html/);
  });

  test('cerrar sesión regresa al login y ya no deja entrar con "atrás"', async () => {
    const p = await entrarAlBanco();
    await p.click('#btn-logout');
    await p.waitForURL(/login\.html/);
    await p.goto(`${app.base}/banco/index.html`);
    await p.waitForURL(/login\.html/);
  });

  test('el ojo muestra y oculta número, vencimiento y CVV', async () => {
    const p = await entrarAlBanco();
    assert.match(await p.textContent('#display-extra'), /\*\*\*/);
    await p.click('#btn-toggle-visibility');
    assert.equal(await p.textContent('#display-account'), '4521 8834 6672 9804');
    assert.match(await p.textContent('#display-extra'), /08\/29.*417/);
    await p.click('#btn-toggle-visibility');
    assert.equal(await p.textContent('#display-account'), '4521 **** **** 9804');
  });
});

describe('Banco: operaciones', () => {
  test('depósito: monto inválido muestra error; válido actualiza saldo y movimientos', async () => {
    const p = await entrarAlBanco();
    await p.click('text=Depositar');
    await p.fill('#deposit-amount', '0');
    await p.click('#modal-deposit .btn-primary');
    await p.waitForSelector('#deposit-error:not(.hidden)');
    await p.fill('#deposit-amount', '250.50');
    await p.click('#modal-deposit .btn-primary');
    await p.waitForSelector('#modal-deposit.hidden', { state: 'attached' });
    assert.match(await saldo(p), /5,250\.50/);
    assert.match(await p.textContent('#transaction-list li:first-child'), /Depósito/);
  });

  test('retiro mayor al saldo muestra el error y no cambia el saldo', async () => {
    const p = await entrarAlBanco();
    await p.click('text=Retirar');
    await p.fill('#withdraw-amount', '999999');
    await p.click('#modal-withdraw .btn-primary');
    await p.waitForSelector('#withdraw-error:not(.hidden)');
    assert.match(await saldo(p), /5,000\.00/);
  });

  test('transferencia: destino inexistente da error; a Ana le llega en vivo', async () => {
    const carlos = await entrarAlBanco();
    const ana = await entrarAlBanco('ana', '4321');
    await carlos.click('text=Transferir');
    await carlos.fill('#transfer-dest', 'nadie');
    await carlos.fill('#transfer-amount', '100');
    await carlos.click('#modal-transfer .btn-primary');
    await carlos.waitForSelector('#transfer-error:not(.hidden)');
    await carlos.fill('#transfer-dest', 'ana');
    await carlos.click('#modal-transfer .btn-primary');
    await carlos.waitForSelector('#modal-transfer.hidden', { state: 'attached' });
    assert.match(await saldo(carlos), /4,900\.00/);
    await ana.waitForFunction(() => /3,300\.00/.test(document.getElementById('display-balance').textContent));
  });

  test('bloquear y desbloquear desde la app', async () => {
    const p = await entrarAlBanco();
    await p.click('#btn-lock');
    await p.waitForSelector('#debit-card.bloqueada');
    assert.equal(await p.textContent('#lock-label'), 'Desbloquear');
    assert.equal((await app.pagar({ ...C, monto: 10 })).motivo, 'Tarjeta bloqueada');
    await p.click('#btn-lock');
    await p.waitForSelector('#debit-card:not(.bloqueada)');
  });
});

describe('Tienda', () => {
  test('catálogo, carrito, cantidades y persistencia al recargar', async () => {
    const p = await abrirTienda();
    assert.equal(await p.locator('.producto').count(), 8);
    await p.click('[data-add="sticker"]');
    await p.click('[data-add="sticker"]');
    await p.click('[data-add="mouse"]');
    assert.equal(await p.textContent('#cart-count'), '3');
    await p.reload();
    await p.waitForSelector('.producto');
    assert.equal(await p.textContent('#cart-count'), '3');
    await p.click('.cart-btn');
    assert.match(await p.textContent('#cart-total'), /449\.00/);
    // quitar todo deja el carrito vacío y deshabilita pagar
    while (await p.locator('.qty button:first-child').count()) await p.locator('.qty button:first-child').first().click();
    assert.equal(await p.textContent('#cart-count'), '0');
    assert.equal(await p.isDisabled('#btn-checkout'), true);
  });

  test('el formulario da formato al número y al vencimiento', async () => {
    const p = await abrirTienda();
    await p.click('[data-add="taza"]');
    await p.click('.cart-btn');
    await p.click('#btn-checkout');
    await p.type('#pago-numero', '4521abc883466729804');
    await p.type('#pago-exp', '0829');
    await p.type('#pago-cvv', '41a7');
    assert.equal(await p.inputValue('#pago-numero'), '4521 8834 6672 9804');
    assert.equal(await p.inputValue('#pago-exp'), '08/29');
    assert.equal(await p.inputValue('#pago-cvv'), '417');
  });

  test('pago aprobado vacía el carrito y aparece en el banco sin recargar', async () => {
    const banco = await entrarAlBanco();
    const tienda = await abrirTienda();
    await pagarEnTienda(tienda, ['mouse']);
    assert.equal(await tienda.isVisible('#resultado'), true);
    assert.match(await tienda.textContent('#res-monto'), /399\.00/);
    assert.equal(await tienda.textContent('#cart-count'), '0');
    await banco.waitForFunction(() => /Mouse inalámbrico/.test(document.querySelector('#transaction-list li').textContent));
    assert.match(await saldo(banco), /4,601\.00/);
  });

  test('CVV incorrecto muestra el rechazo y conserva el carrito', async () => {
    const p = await abrirTienda();
    await pagarEnTienda(p, ['taza'], { ...C, cvv: '000' });
    assert.match(await p.textContent('#pago-error'), /Datos de la tarjeta incorrectos/);
    assert.equal(await p.textContent('#cart-count'), '1');
  });

  test('las imágenes sin internet no dejan la página en un ciclo de errores', async () => {
    const p = await pagina();
    let peticiones = 0;
    p.on('request', (r) => { if (!r.url().startsWith(app.base)) peticiones++; });
    await p.goto(`${app.base}/tienda/`);
    await p.waitForSelector('.producto');
    await p.evaluate(() => document.querySelectorAll('.producto img').forEach((i) => i.scrollIntoView()));
    await p.waitForTimeout(1500);
    assert.ok(peticiones <= 16, `${peticiones} peticiones externas: las imágenes se siguen reintentando`);
  });
});

describe('Detector de fraude visto por el usuario', () => {
  test('tres compras en la tienda: alerta en vivo y "Sí, fui yo" la quita', async () => {
    const banco = await entrarAlBanco();
    const tienda = await abrirTienda();
    for (let i = 0; i < 3; i++) {
      await pagarEnTienda(tienda, ['cable']);
      await tienda.click('#resultado .btn');
    }
    await banco.waitForSelector('.alerta--sospecha');
    await banco.click('.alerta--sospecha >> text=Sí, fui yo');
    await banco.waitForSelector('.alerta', { state: 'detached' });
  });

  test('ataque: tarjeta bloqueada en vivo; desbloquear limpia las alertas', async () => {
    const banco = await entrarAlBanco();
    for (let i = 0; i < 3; i++) await app.comprar({ sticker: 1 }, C);
    await app.comprar({ teclado: 1, audifonos: 1 }, C);
    await banco.waitForSelector('#debit-card.bloqueada');
    await banco.waitForSelector('.alerta--fraude');
    assert.match(await banco.textContent('#transaction-list li:first-child'), /Rechazado/);
    await banco.click('#btn-lock');
    await banco.waitForSelector('#debit-card:not(.bloqueada)');
    await banco.waitForSelector('.alerta', { state: 'detached' });
  });

  test('sondeo de saldo desde la tienda: el cargo que sí alcanza se rechaza', async () => {
    const banco = await entrarAlBanco();
    const tienda = await abrirTienda();
    await pagarEnTienda(tienda, ['laptop']);
    assert.match(await tienda.textContent('#pago-error'), /Fondos insuficientes/);
    await tienda.click('#pago .btn-ghost');
    await tienda.click('.cart-btn');
    await tienda.locator('.qty button:first-child').click();
    await tienda.click('#carrito .icon-btn');
    await pagarEnTienda(tienda, ['teclado', 'teclado', 'teclado', 'teclado']);
    await tienda.click('#pago .btn-ghost');
    await tienda.click('.cart-btn');
    for (let i = 0; i < 2; i++) await tienda.locator('.qty button:first-child').click();
    await tienda.click('#carrito .icon-btn');
    await tienda.click('.cart-btn');
    await tienda.click('#btn-checkout');
    await tienda.click('#btn-pagar');
    await tienda.waitForSelector('#pago-error:not(.hidden)');
    assert.match(await tienda.textContent('#pago-error'), /sospecha de fraude/);
    await banco.waitForSelector('#debit-card.bloqueada');
  });

  test('un comercio con HTML malicioso se muestra como texto', async () => {
    const banco = await entrarAlBanco();
    await app.pagar({ ...C, monto: 10, comercio: '<img src=x onerror="window.__xss=1">', concepto: '<b>hola</b>' });
    await banco.waitForFunction(() => document.querySelector('#transaction-list li').textContent.includes('<img'));
    assert.equal(await banco.evaluate(() => window.__xss), undefined);
    assert.equal(await banco.locator('#transaction-list img, #transaction-list b').count(), 0);
  });
});

describe('Diseño en celular (375 px)', () => {
  for (const [nombre, abrir] of [['banco', () => entrarAlBanco()], ['tienda', () => abrirTienda()]]) {
    test(`${nombre}: sin scroll horizontal`, async () => {
      await contexto.close();
      contexto = await navegador.newContext({ viewport: { width: 375, height: 800 } });
      await contexto.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
      const p = await abrir();
      const ancho = await p.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(ancho <= 375, `scrollWidth ${ancho}`);
    });
  }

  test('tienda: el CVV no se sale del formulario', async () => {
    await contexto.close();
    contexto = await navegador.newContext({ viewport: { width: 375, height: 800 } });
    await contexto.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    const p = await abrirTienda();
    await p.click('[data-add="taza"]');
    await p.click('.cart-btn');
    await p.click('#btn-checkout');
    const form = await p.locator('#form-pago').boundingBox();
    const cvv = await p.locator('#pago-cvv').boundingBox();
    assert.ok(cvv.x + cvv.width <= form.x + form.width);
  });
});
