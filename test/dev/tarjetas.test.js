// DEV · Pruebas unitarias de utilidades de tarjetas
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { limpiar, luhnValido, formatear, enmascarar } from '../../server/tarjetas.js';

describe('limpiar', () => {
  test('quita espacios, guiones y cualquier no-dígito', () => {
    assert.equal(limpiar('4521 8834-6672.9804'), '4521883466729804');
  });
  test('tolera null, undefined, números y objetos', () => {
    assert.equal(limpiar(null), '');
    assert.equal(limpiar(undefined), '');
    assert.equal(limpiar(1234), '1234');
    assert.equal(limpiar({}), '');
  });
});

describe('luhnValido', () => {
  test('acepta números válidos de prueba', () => {
    for (const n of ['4521883466729804', '4521991033451230', '4111111111111111', '5500005555555559', '378282246310005']) {
      assert.ok(luhnValido(n), n);
    }
  });
  test('acepta el número con espacios', () => {
    assert.ok(luhnValido('4521 8834 6672 9804'));
  });
  test('rechaza un dígito verificador incorrecto', () => {
    assert.equal(luhnValido('4521883466729801'), false);
  });
  test('rechaza longitudes fuera de 13–19', () => {
    assert.equal(luhnValido('0'), false);
    assert.equal(luhnValido('000000000000'), false); // 12 dígitos aunque pase Luhn
    assert.equal(luhnValido('0'.repeat(20)), false);
  });
  test('rechaza vacío y valores no textuales', () => {
    assert.equal(luhnValido(''), false);
    assert.equal(luhnValido(null), false);
    assert.equal(luhnValido(undefined), false);
  });
});

describe('formatear y enmascarar', () => {
  test('agrupa de 4 en 4', () => {
    assert.equal(formatear('4521883466729804'), '4521 8834 6672 9804');
    assert.equal(formatear('378282246310005'), '3782 8224 6310 005');
  });
  test('enmascara mostrando sólo los primeros y últimos 4', () => {
    assert.equal(enmascarar('4521 8834 6672 9804'), '4521 **** **** 9804');
  });
});
