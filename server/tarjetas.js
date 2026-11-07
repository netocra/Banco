// ===== UTILIDADES DE TARJETAS =====

export function limpiar(numero) {
  return String(numero ?? '').replace(/\D/g, '');
}

// Algoritmo de Luhn: valida el dígito verificador de un número de tarjeta
export function luhnValido(numero) {
  const n = limpiar(numero);
  if (n.length < 13 || n.length > 19) return false;
  let suma = 0;
  let doble = false;
  for (let i = n.length - 1; i >= 0; i--) {
    let d = Number(n[i]);
    if (doble) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    suma += d;
    doble = !doble;
  }
  return suma % 10 === 0;
}

export function formatear(numero) {
  return limpiar(numero).replace(/(\d{4})(?=\d)/g, '$1 ');
}

export function enmascarar(numero) {
  const n = limpiar(numero);
  return `${n.slice(0, 4)} **** **** ${n.slice(-4)}`;
}
