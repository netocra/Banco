// ===== PASARELA DE PAGOS DEL BANCO =====
// Todo cargo de un comercio pasa por aquí. Cada intento se traduce a símbolos de Σ
// y se alimenta al AFD de la tarjeta antes de decidir si se aprueba.
import { randomBytes } from 'node:crypto';
import { simbolosDelIntento, transicion, esAceptacion, UMBRALES, FRAUDE } from './afd.js';
import { buscarPorTarjeta, agregarMovimiento, agregarAlerta, notificar } from './db.js';
import { limpiar, luhnValido } from './tarjetas.js';
import { leerMonto, redondear } from './dinero.js';

// El perfil de gasto se arma con compras de días anteriores, para que las compras de
// una ráfaga en curso no bajen el promedio y con él el umbral de "cargo grande".
const ANTIGUEDAD_PERFIL_MS = 24 * 60 * 60 * 1000;

const MAX_CADENA = 40;

export function procesarPago({ numero, exp, cvv, monto, comercio, concepto } = {}) {
  numero = limpiar(numero);
  monto = leerMonto(monto);
  comercio = String(comercio || 'Comercio desconocido').slice(0, 60);
  concepto = String(concepto || 'Compra').slice(0, 80);

  if (!luhnValido(numero)) return rechazo('Número de tarjeta inválido');
  if (!monto) return rechazo('Monto inválido');

  const encontrado = buscarPorTarjeta(numero);
  if (!encontrado) return rechazo('Tarjeta no emitida por Banco BBUA');
  const [id, usuario] = encontrado;
  const { tarjeta, afd } = usuario;

  if (tarjeta.bloqueada) {
    agregarMovimiento(usuario, { tipo: 'rechazo', descripcion: `Intento con tarjeta bloqueada · ${comercio}`, comercio, monto: -monto });
    notificar(id);
    return rechazo('Tarjeta bloqueada');
  }

  const datosValidos = String(exp ?? '').trim() === tarjeta.exp && String(cvv ?? '').trim() === tarjeta.cvv;
  const ahora = Date.now();
  const fondosSuficientes = monto <= usuario.saldo;
  const simbolos = simbolosDelIntento({
    monto,
    rechazado: !datosValidos || !fondosSuficientes,
    msDesdeAnterior: afd.ultimoIntento ? ahora - afd.ultimoIntento : null,
    promedioCliente: compraPromedio(usuario),
  });

  // Paso del AFD
  const estadoAnterior = afd.estado;
  let estado = estadoAnterior;
  for (const s of simbolos) {
    const siguiente = transicion(estado, s);
    afd.ultimaTransicion = { de: estado, simbolo: s, a: siguiente };
    estado = siguiente;
  }
  afd.estado = estado;
  afd.cadena = (afd.cadena + simbolos.join('')).slice(-MAX_CADENA);
  afd.ultimoIntento = ahora;

  // Decisión del banco
  let motivo = null;
  if (estado === FRAUDE) motivo = 'Cargo bloqueado por sospecha de fraude';
  else if (!datosValidos) motivo = 'Datos de la tarjeta incorrectos';
  else if (!fondosSuficientes) motivo = 'Fondos insuficientes';

  const simbolo = simbolos.at(-1);
  if (motivo) {
    agregarMovimiento(usuario, { tipo: 'rechazo', descripcion: `Rechazado · ${comercio}`, comercio, monto: -monto, simbolo, motivo });
  } else {
    usuario.saldo = redondear(usuario.saldo - monto);
    agregarMovimiento(usuario, { tipo: 'compra', descripcion: `${concepto} · ${comercio}`, comercio, monto: -monto, simbolo });
  }

  // Al ENTRAR a un estado de aceptación se dispara la alerta
  if (estado !== estadoAnterior && esAceptacion(estado)) {
    if (estado === 'q4') {
      agregarAlerta(usuario, {
        nivel: 'sospecha',
        titulo: 'Intentaron cobrar con tu tarjeta varias veces',
        mensaje: `Rechazamos varios cargos seguidos con tu tarjeta. El último fue en ${comercio} por $${monto.toLocaleString('es-MX')} (${motivo.toLowerCase()}). ¿Fuiste tú?`,
      });
    } else if (estado === 'q5') {
      agregarAlerta(usuario, {
        nivel: 'sospecha',
        titulo: 'Tu tarjeta podría estar siendo probada',
        mensaje: `Detectamos varios intentos de cargo seguidos en menos de ${UMBRALES.ventanaMin} minutos. El último fue en ${comercio} por $${monto.toLocaleString('es-MX')}. ¿Fuiste tú?`,
      });
    } else {
      tarjeta.bloqueada = true;
      agregarAlerta(usuario, {
        nivel: 'fraude',
        titulo: 'Bloqueamos tu tarjeta',
        mensaje: `Después de varios intentos sospechosos se intentó un cargo fuera de lo habitual de $${monto.toLocaleString('es-MX')} en ${comercio}. Lo rechazamos y bloqueamos tu tarjeta.`,
      });
    }
  }

  notificar(id);
  return motivo
    ? rechazo(motivo)
    : { aprobado: true, autorizacion: randomBytes(3).toString('hex').toUpperCase(), monto };
}

// Compra promedio del cliente: su perfil de gasto
function compraPromedio(usuario) {
  const limite = Date.now() - ANTIGUEDAD_PERFIL_MS;
  const compras = usuario.movimientos.filter((m) => m.tipo === 'compra' && new Date(m.fecha).getTime() <= limite);
  if (!compras.length) return 0;
  return compras.reduce((s, m) => s - m.monto, 0) / compras.length;
}

function rechazo(motivo) {
  return { aprobado: false, motivo };
}
