// ===== AUTÓMATA FINITO DETERMINISTA: DETECTOR DE CARD TESTING =====
//
// M = (Q, Σ, δ, q0, F)
//
// Cada intento de cargo sobre una tarjeta se traduce a un símbolo del alfabeto Σ.
// La secuencia de intentos de una tarjeta forma una cadena; el AFD la lee símbolo
// por símbolo y, al llegar a un estado de aceptación, el banco dispara una alerta.

// Umbrales usados para clasificar cada cargo
export const UMBRALES = {
  pequeno: 50,              // cargo ≤ $50 → cargo de prueba
  grande: 1000,             // cargo ≥ $1,000 → cargo grande
  ventanaMin: 10,           // más de 10 min sin cargos → pausa (reinicia el patrón)
};

// Σ — alfabeto de entrada
export const ALFABETO = {
  p: 'Cargo pequeño (≤ $50) con datos correctos',
  r: 'Intento rechazado por datos incorrectos (CVV o vencimiento)',
  n: 'Cargo normal (entre $50 y $1,000)',
  g: 'Cargo grande (≥ $1,000)',
  t: 'Pausa: pasaron más de 10 min desde el intento anterior',
};

// Q — estados
export const ESTADOS = {
  q0: 'Normal',
  q1: '1 cargo de prueba',
  q2: '2 cargos de prueba',
  q3: 'Tarjeta siendo probada',
  q4: 'Fraude: cargo grande tras pruebas',
};

export const INICIAL = 'q0';

// F — estados de aceptación (disparan alerta)
export const ACEPTACION = ['q3', 'q4'];

// δ — función de transición
export const DELTA = {
  q0: { p: 'q1', r: 'q1', n: 'q0', g: 'q0', t: 'q0' },
  q1: { p: 'q2', r: 'q2', n: 'q0', g: 'q0', t: 'q0' },
  q2: { p: 'q3', r: 'q3', n: 'q0', g: 'q0', t: 'q0' },
  q3: { p: 'q3', r: 'q3', n: 'q3', g: 'q4', t: 'q0' },
  q4: { p: 'q4', r: 'q4', n: 'q4', g: 'q4', t: 'q4' }, // absorbente: tarjeta bloqueada
};

export function transicion(estado, simbolo) {
  const siguiente = DELTA[estado]?.[simbolo];
  if (!siguiente) throw new Error(`δ(${estado}, ${simbolo}) no está definida`);
  return siguiente;
}

export function esAceptacion(estado) {
  return ACEPTACION.includes(estado);
}

// Traduce un intento de cargo a símbolo(s) de Σ.
// Si pasó más de la ventana desde el intento anterior, antes se emite 't'.
export function simbolosDelIntento({ monto, datosValidos, msDesdeAnterior }) {
  const simbolos = [];
  if (msDesdeAnterior != null && msDesdeAnterior > UMBRALES.ventanaMin * 60_000) {
    simbolos.push('t');
  }
  if (!datosValidos) simbolos.push('r');
  else if (monto <= UMBRALES.pequeno) simbolos.push('p');
  else if (monto >= UMBRALES.grande) simbolos.push('g');
  else simbolos.push('n');
  return simbolos;
}

// Evalúa una cadena completa y devuelve la traza de transiciones.
export function evaluar(cadena, estado = INICIAL) {
  const traza = [];
  for (const simbolo of cadena) {
    const siguiente = transicion(estado, simbolo);
    traza.push({ de: estado, simbolo, a: siguiente });
    estado = siguiente;
  }
  return { final: estado, aceptada: esAceptacion(estado), traza };
}

export function definicion() {
  return { estados: ESTADOS, alfabeto: ALFABETO, delta: DELTA, inicial: INICIAL, aceptacion: ACEPTACION, umbrales: UMBRALES };
}
