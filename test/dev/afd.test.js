// DEV · Pruebas unitarias del autómata
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALFABETO, ESTADOS, DELTA, INICIAL, ACEPTACION, FRAUDE, UMBRALES,
  transicion, esAceptacion, evaluar, simbolosDelIntento, umbralGrande, definicion,
} from '../../server/afd.js';

const Q = Object.keys(ESTADOS);
const Σ = Object.keys(ALFABETO);
const MIN = 60_000;

describe('Definición formal M = (Q, Σ, δ, q0, F)', () => {
  test('δ es total: definida para cada par (q, s) de Q × Σ', () => {
    for (const q of Q) for (const s of Σ) assert.ok(Q.includes(DELTA[q][s]), `δ(${q}, ${s}) = ${DELTA[q][s]}`);
  });

  test('δ no tiene estados ni símbolos fuera de Q y Σ', () => {
    assert.deepEqual(Object.keys(DELTA).sort(), [...Q].sort());
    for (const q of Q) assert.deepEqual(Object.keys(DELTA[q]).sort(), [...Σ].sort());
  });

  test('q0 ∈ Q, F ⊆ Q y el estado de fraude ∈ F', () => {
    assert.ok(Q.includes(INICIAL));
    for (const f of ACEPTACION) assert.ok(Q.includes(f));
    assert.ok(ACEPTACION.includes(FRAUDE));
  });

  test('el estado de fraude es absorbente', () => {
    for (const s of Σ) assert.equal(transicion(FRAUDE, s), FRAUDE);
  });

  test('todos los estados son alcanzables desde q0', () => {
    const vistos = new Set([INICIAL]);
    const cola = [INICIAL];
    while (cola.length) {
      const actual = cola.shift();
      for (const s of Σ) {
        const q = DELTA[actual][s];
        if (!vistos.has(q)) { vistos.add(q); cola.push(q); }
      }
    }
    assert.deepEqual([...vistos].sort(), [...Q].sort());
  });

  test('t regresa a q0 desde cualquier estado que no sea fraude', () => {
    for (const q of Q.filter((q) => q !== FRAUDE)) assert.equal(transicion(q, 't'), INICIAL);
  });

  test('transicion lanza error con un símbolo o estado inválido', () => {
    assert.throws(() => transicion('q0', 'x'));
    assert.throws(() => transicion('q99', 'c'));
    assert.throws(() => transicion('q0', ''));
  });

  test('definicion() expone la 5-tupla completa', () => {
    const d = definicion();
    for (const k of ['estados', 'alfabeto', 'delta', 'inicial', 'aceptacion', 'fraude', 'umbrales']) assert.ok(k in d, k);
  });
});

describe('Lenguaje reconocido', () => {
  const casos = [
    // [cadena, estado final esperado, descripción]
    ['',       'q0', 'cadena vacía'],
    ['c',      'q1', 'una compra'],
    ['g',      'q1', 'una compra grande aislada'],
    ['cc',     'q2', 'dos compras seguidas'],
    ['ctctc',  'q1', 'compras espaciadas'],
    ['rc',     'q2', 'error de CVV y luego la compra correcta'],
    ['r',      'q3', 'un rechazo'],
    ['ccc',    'q5', 'tres compras seguidas → ráfaga'],
    ['ggg',    'q5', 'tres compras grandes seguidas → ráfaga'],
    ['crc',    'q5', 'compra, rechazo, compra: tres intentos seguidos'],
    ['cr',     'q2', 'compra y luego un error de CVV'],
    ['ccr',    'q5', 'dos compras y un rechazo'],
    ['rr',     'q4', 'dos rechazos → sondeo'],
    ['rrrrrr', 'q4', 'muchos rechazos siguen en sondeo'],
    ['rrc',    'q4', 'sondeo y un cargo dentro del perfil'],
    ['rg',     'q5', 'un rechazo y luego un cargo grande'],
    ['ccccg',  'q6', 'ataque de ráfaga completo'],
    ['cccg',   'q6', 'ráfaga mínima y cargo grande'],
    ['rrg',    'q6', 'sondeo de saldo exitoso'],
    ['rrtg',   'q1', 'sondeo, pausa y cargo grande: la pausa reinicia'],
    ['cctcc',  'q2', 'la pausa reinicia la cuenta de la ráfaga'],
    ['cccgt',  'q6', 'una pausa no saca del fraude'],
    ['cccgcc', 'q6', 'después del fraude todo sigue en fraude'],
  ];

  for (const [w, final, desc] of casos) {
    test(`"${w || 'ε'}" termina en ${final} (${desc})`, () => {
      const r = evaluar(w);
      assert.equal(r.final, final);
      assert.equal(r.aceptada, esAceptacion(final));
      assert.equal(r.traza.length, w.length);
    });
  }

  test('ninguna cadena sin r de 1 o 2 símbolos llega a aceptación', () => {
    for (const a of 'cgt') {
      assert.equal(evaluar(a).aceptada, false);
      for (const b of 'cgt') assert.equal(evaluar(a + b).aceptada, false, a + b);
    }
  });

  test('la traza encadena correctamente los estados', () => {
    const { traza } = evaluar('crrg');
    assert.equal(traza[0].de, 'q0');
    for (let i = 1; i < traza.length; i++) assert.equal(traza[i].de, traza[i - 1].a);
  });

  test('evaluar acepta un estado inicial distinto', () => {
    assert.equal(evaluar('g', 'q5').final, 'q6');
  });
});

describe('Traducción de un cargo a símbolos', () => {
  test('primer intento (sin anterior) no emite pausa', () => {
    assert.deepEqual(simbolosDelIntento({ monto: 100, msDesdeAnterior: null, promedioCliente: 0 }), ['c']);
  });

  test('exactamente en el límite de la ventana no es pausa; un ms después sí', () => {
    const v = UMBRALES.ventanaMin * MIN;
    assert.deepEqual(simbolosDelIntento({ monto: 100, msDesdeAnterior: v }), ['c']);
    assert.deepEqual(simbolosDelIntento({ monto: 100, msDesdeAnterior: v + 1 }), ['t', 'c']);
  });

  test('rechazado tiene prioridad sobre el monto', () => {
    assert.deepEqual(simbolosDelIntento({ monto: 99999, rechazado: true }), ['r']);
    assert.deepEqual(simbolosDelIntento({ monto: 1, rechazado: true, msDesdeAnterior: 10 * MIN }), ['t', 'r']);
  });

  test('umbral grande: mínimo $1,000 sin historial', () => {
    assert.equal(umbralGrande(0), 1000);
    assert.equal(umbralGrande(undefined), 1000);
    assert.equal(umbralGrande(NaN), 1000);
  });

  test('umbral grande: triple del promedio cuando lo supera', () => {
    assert.equal(umbralGrande(500), 1500);
    assert.equal(umbralGrande(333), 1000);
  });

  test('exactamente en el umbral es grande; un centavo menos no', () => {
    assert.deepEqual(simbolosDelIntento({ monto: 1000, promedioCliente: 0 }), ['g']);
    assert.deepEqual(simbolosDelIntento({ monto: 999.99, promedioCliente: 0 }), ['c']);
    assert.deepEqual(simbolosDelIntento({ monto: 1500, promedioCliente: 500 }), ['g']);
    assert.deepEqual(simbolosDelIntento({ monto: 1499.99, promedioCliente: 500 }), ['c']);
  });
});
