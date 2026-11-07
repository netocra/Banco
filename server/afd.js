// ===== AUTÓMATA FINITO DETERMINISTA: DETECTOR DE CARD TESTING =====
//
// M = (Q, Σ, δ, q0, F)
//
// Igual que en los sistemas antifraude de los bancos, el detector no juzga un cargo
// aislado sino la secuencia: cuántos intentos llegan seguidos en poco tiempo
// (velocidad) y si después aparece un cargo fuera del perfil del cliente.
//
// Cada intento se traduce a un símbolo de Σ con base en su contexto (tiempo desde el
// intento anterior y compra promedio del cliente). El AFD lee esos símbolos y, al
// llegar a un estado de aceptación, el banco dispara una alerta o bloquea la tarjeta.

export const UMBRALES = {
  ventanaMin: 5,        // dos intentos con menos de 5 min entre sí se consideran seguidos
  grandeMinimo: 1000,   // un cargo grande es de al menos $1,000...
  factorPerfil: 3,      // ...o del triple de la compra promedio del cliente, lo que sea mayor
};

// Σ — alfabeto de entrada
export const ALFABETO = {
  c: 'Intento de cargo dentro del perfil del cliente (aprobado o con datos incorrectos)',
  g: 'Cargo grande: fuera del perfil del cliente',
  t: 'Pausa: pasaron más de 5 min desde el intento anterior',
};

// Q — estados
export const ESTADOS = {
  q0: 'Sin actividad reciente',
  q1: '1 intento',
  q2: '2 intentos seguidos',
  q3: 'Ráfaga de intentos: tarjeta posiblemente probada',
  q4: 'Fraude: cargo grande tras la ráfaga',
};

export const INICIAL = 'q0';

// F — estados de aceptación (disparan alerta)
export const ACEPTACION = ['q3', 'q4'];

// δ — función de transición
export const DELTA = {
  q0: { c: 'q1', g: 'q1', t: 'q0' },
  q1: { c: 'q2', g: 'q2', t: 'q0' },
  q2: { c: 'q3', g: 'q3', t: 'q0' },
  q3: { c: 'q3', g: 'q4', t: 'q0' },
  q4: { c: 'q4', g: 'q4', t: 'q4' }, // absorbente: tarjeta bloqueada
};

export function transicion(estado, simbolo) {
  const siguiente = DELTA[estado]?.[simbolo];
  if (!siguiente) throw new Error(`δ(${estado}, ${simbolo}) no está definida`);
  return siguiente;
}

export function esAceptacion(estado) {
  return ACEPTACION.includes(estado);
}

export function umbralGrande(promedioCliente) {
  return Math.max(UMBRALES.grandeMinimo, UMBRALES.factorPerfil * (promedioCliente || 0));
}

// Traduce un intento de cargo a símbolo(s) de Σ.
// Si pasó más de la ventana desde el intento anterior, antes se emite 't'.
export function simbolosDelIntento({ monto, msDesdeAnterior, promedioCliente }) {
  const simbolos = [];
  if (msDesdeAnterior != null && msDesdeAnterior > UMBRALES.ventanaMin * 60_000) {
    simbolos.push('t');
  }
  simbolos.push(monto >= umbralGrande(promedioCliente) ? 'g' : 'c');
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
