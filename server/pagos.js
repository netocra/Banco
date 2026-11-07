// ===== PASARELA DE PAGOS DEL BANCO =====
// Todo cargo de un comercio pasa por aquí. Cada intento se traduce a símbolos de Σ
// y se alimenta al AFD de la tarjeta antes de decidir si se aprueba.
import { randomBytes } from 'node:crypto';
import { simbolosDelIntento, transicion, esAceptacion, UMBRALES } from './afd.js';
import { buscarPorTarjeta, agregarMovimiento, agregarAlerta, notificar } from './db.js';
import { limpiar, luhnValido } from './tarjetas.js';

const MAX_CADENA = 40;

export function procesarPago({ numero, exp, cvv, monto, comercio, concepto }) {
  numero = limpiar(numero);
  monto = Math.round(Number(monto) * 100) / 100;
  comercio = String(comercio || 'Comercio desconocido').slice(0, 60);
  concepto = String(concepto || 'Compra').slice(0, 80);

  if (!luhnValido(numero)) return rechazo('Número de tarjeta inválido');
  if (!(monto > 0)) return rechazo('Monto inválido');

  const encontrado = buscarPorTarjeta(numero);
  if (!encontrado) return rechazo('Tarjeta no emitida por Banco Techo');
  const [id, usuario] = encontrado;
  const { tarjeta, afd } = usuario;

  if (tarjeta.bloqueada) {
    agregarMovimiento(usuario, { tipo: 'rechazo', descripcion: `Intento con tarjeta bloqueada · ${comercio}`, comercio, monto: -monto });
    notificar(id);
    return rechazo('Tarjeta bloqueada');
  }

  const datosValidos = String(exp ?? '').trim() === tarjeta.exp && String(cvv ?? '').trim() === tarjeta.cvv;
  const ahora = Date.now();
  const simbolos = simbolosDelIntento({
    monto,
    datosValidos,
    msDesdeAnterior: afd.ultimoIntento ? ahora - afd.ultimoIntento : null,
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
  if (!datosValidos) motivo = 'Datos de la tarjeta incorrectos';
  else if (estado === 'q4') motivo = 'Cargo bloqueado por sospecha de fraude';
  else if (monto > usuario.saldo) motivo = 'Fondos insuficientes';

  const simbolo = simbolos.at(-1);
  if (motivo) {
    agregarMovimiento(usuario, { tipo: 'rechazo', descripcion: `Rechazado · ${comercio}`, comercio, monto: -monto, simbolo, motivo });
  } else {
    usuario.saldo -= monto;
    agregarMovimiento(usuario, { tipo: 'compra', descripcion: `${concepto} · ${comercio}`, comercio, monto: -monto, simbolo });
  }

  // Al ENTRAR a un estado de aceptación se dispara la alerta
  if (estado !== estadoAnterior && esAceptacion(estado)) {
    if (estado === 'q3') {
      agregarAlerta(usuario, {
        nivel: 'sospecha',
        titulo: 'Tu tarjeta podría estar siendo probada',
        mensaje: `Detectamos varios cargos pequeños (≤ $${UMBRALES.pequeno}) o intentos fallidos seguidos. El último fue en ${comercio}. ¿Fuiste tú?`,
      });
    } else {
      tarjeta.bloqueada = true;
      agregarAlerta(usuario, {
        nivel: 'fraude',
        titulo: 'Bloqueamos tu tarjeta',
        mensaje: `Después de los cargos de prueba se intentó un cargo grande de $${monto.toLocaleString('es-MX')} en ${comercio}. Lo rechazamos y bloqueamos tu tarjeta.`,
      });
    }
  }

  notificar(id);
  return motivo
    ? rechazo(motivo)
    : { aprobado: true, autorizacion: randomBytes(3).toString('hex').toUpperCase(), monto };
}

function rechazo(motivo) {
  return { aprobado: false, motivo };
}
