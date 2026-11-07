// ===== DATOS SIMULADOS (en memoria; se reinician al arrancar el servidor) =====
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { INICIAL } from './afd.js';
import { limpiar } from './tarjetas.js';

const DIA = 86_400_000;

// Compras de días anteriores: forman el perfil de gasto de cada cliente
function historial(compras) {
  return compras.map(([dias, concepto, comercio, monto]) => ({
    id: randomUUID(),
    fecha: new Date(Date.now() - dias * DIA).toISOString(),
    tipo: 'compra',
    descripcion: `${concepto} · ${comercio}`,
    comercio,
    monto: -monto,
  }));
}

function nuevoUsuario({ password, nombre, saldo, numero, exp, cvv, compras }) {
  return {
    password,
    nombre,
    saldo,
    tarjeta: { numero, exp, cvv, bloqueada: false },
    afd: { estado: INICIAL, cadena: '', ultimoIntento: null },
    movimientos: historial(compras),
    alertas: [],
  };
}

export const usuarios = {
  carlos: nuevoUsuario({
    password: '1234', nombre: 'Carlos Méndez', saldo: 5000, numero: '4521883466729804', exp: '08/29', cvv: '417',
    compras: [[9, 'Despensa', 'Soriana', 642], [7, 'Suscripción', 'Netflix', 219], [5, 'Gasolina', 'Pemex', 500], [3, 'Viaje', 'Uber', 143], [1, 'Comida', 'Oxxo', 87]],
  }),
  ana: nuevoUsuario({
    password: '4321', nombre: 'Ana García', saldo: 3200, numero: '4521991033451230', exp: '03/28', cvv: '952',
    compras: [[12, 'Zapatos', 'Liverpool', 1450], [8, 'Suscripción', 'Spotify', 129], [4, 'Medicinas', 'Farmacias Guadalajara', 260], [2, 'Cena', 'Sanborns', 380]],
  }),
};

// Emite 'cambio' con el id del usuario afectado (lo escuchan las conexiones SSE)
export const eventos = new EventEmitter();
eventos.setMaxListeners(100);

export function notificar(...ids) {
  for (const id of ids) eventos.emit('cambio', id);
}

export function buscarPorTarjeta(numero) {
  const n = limpiar(numero);
  return Object.entries(usuarios).find(([, u]) => u.tarjeta.numero === n) ?? null;
}

export function agregarMovimiento(usuario, mov) {
  const m = { id: randomUUID(), fecha: new Date().toISOString(), ...mov };
  usuario.movimientos.push(m);
  return m;
}

export function agregarAlerta(usuario, alerta) {
  const a = { id: randomUUID(), fecha: new Date().toISOString(), estado: 'pendiente', ...alerta };
  usuario.alertas.push(a);
  return a;
}
