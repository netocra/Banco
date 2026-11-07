// ===== MANEJO DE MONTOS =====
// Todo el dinero se maneja redondeado a centavos para no acumular errores de punto flotante.

export const MONTO_MAXIMO = 1_000_000;

export function redondear(n) {
  return Math.round(n * 100) / 100;
}

// Convierte la entrada del cliente en un monto válido, o null.
// Sólo acepta números o texto numérico (no booleanos, arreglos ni notación que dé Infinity).
export function leerMonto(valor) {
  if (typeof valor === 'string') {
    if (!/^\s*\d+(\.\d+)?\s*$/.test(valor)) return null;
    valor = Number(valor);
  }
  if (typeof valor !== 'number' || !Number.isFinite(valor)) return null;
  const monto = redondear(valor);
  return monto >= 0.01 && monto <= MONTO_MAXIMO ? monto : null;
}
