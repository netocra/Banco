// ===== SERVIDOR: Banco BBUA + Amason =====
// Sin dependencias: sólo módulos nativos de Node.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { usuarios, buscarUsuario, eventos, notificar, agregarMovimiento } from './db.js';
import { procesarPago } from './pagos.js';
import { PRODUCTOS, comprar } from './tienda.js';
import { definicion, INICIAL, FRAUDE } from './afd.js';
import { formatear, enmascarar } from './tarjetas.js';
import { leerMonto, redondear } from './dinero.js';

const PUERTO = Number(process.env.PORT) || 3000;
const PUBLICO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// token → id de usuario
const sesiones = new Map();

// ===== UTILIDADES HTTP =====

// Error con código HTTP; su mensaje sí se le muestra al cliente
class ErrorHttp extends Error {
  constructor(status, mensaje) {
    super(mensaje);
    this.status = status;
  }
}

function json(res, status, datos) {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(datos));
}

// Lee el cuerpo JSON; siempre devuelve un objeto plano
async function leerCuerpo(req) {
  let cuerpo = '';
  for await (const trozo of req) {
    cuerpo += trozo;
    if (cuerpo.length > 1e5) throw new ErrorHttp(413, 'Cuerpo demasiado grande');
  }
  if (!cuerpo) return {};
  let datos;
  try {
    datos = JSON.parse(cuerpo);
  } catch {
    throw new ErrorHttp(400, 'JSON inválido');
  }
  if (datos === null || typeof datos !== 'object' || Array.isArray(datos)) {
    throw new ErrorHttp(400, 'Se esperaba un objeto JSON');
  }
  return datos;
}

function usuarioDeSesion(req, url) {
  const auth = req.headers.authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : url.searchParams.get('token');
  const id = sesiones.get(token);
  return id ? [id, usuarios[id]] : [null, null];
}

function alertasPendientes(u) {
  return u.alertas.filter((a) => a.estado === 'pendiente');
}

function resumen(id) {
  const u = usuarios[id];
  return {
    usuario: id,
    nombre: u.nombre,
    saldo: u.saldo,
    tarjeta: {
      numero: formatear(u.tarjeta.numero),
      enmascarada: enmascarar(u.tarjeta.numero),
      exp: u.tarjeta.exp,
      cvv: u.tarjeta.cvv,
      bloqueada: u.tarjeta.bloqueada,
    },
    movimientos: u.movimientos.slice(-30).reverse(),
    alertas: u.alertas.slice().reverse(),
  };
}

// ===== API =====

async function api(req, res, url) {
  const ruta = url.pathname;
  const metodo = req.method;

  if (metodo === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST',
    });
    return res.end();
  }

  // --- Públicas ---
  if (metodo === 'GET' && ruta === '/api/afd') return json(res, 200, definicion());

  if (metodo === 'POST' && ruta === '/api/login') {
    const { usuario, password } = await leerCuerpo(req);
    const id = String(usuario ?? '').trim().toLowerCase();
    const cuenta = buscarUsuario(id);
    if (!cuenta || typeof password !== 'string' || cuenta.password !== password) {
      return json(res, 401, { error: 'Usuario o contraseña incorrectos.' });
    }
    const token = randomUUID();
    sesiones.set(token, id);
    return json(res, 200, { token, usuario: id });
  }

  // Pasarela del banco para comercios
  if (metodo === 'POST' && ruta === '/api/pagos') {
    return json(res, 200, procesarPago(await leerCuerpo(req)));
  }

  // Amason
  if (metodo === 'GET' && ruta === '/api/tienda/productos') return json(res, 200, PRODUCTOS);
  if (metodo === 'POST' && ruta === '/api/tienda/compra') {
    return json(res, 200, comprar(await leerCuerpo(req)));
  }

  // --- Requieren sesión ---
  const [id, u] = usuarioDeSesion(req, url);
  if (!u) return json(res, 401, { error: 'Sesión no válida' });

  if (metodo === 'GET' && ruta === '/api/eventos') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('event: cambio\ndata: {}\n\n');
    const alCambiar = (afectado) => {
      if (afectado === id) res.write('event: cambio\ndata: {}\n\n');
    };
    const latido = setInterval(() => res.write(': ping\n\n'), 25_000);
    eventos.on('cambio', alCambiar);
    req.on('close', () => {
      clearInterval(latido);
      eventos.off('cambio', alCambiar);
    });
    return;
  }

  if (metodo === 'GET' && ruta === '/api/yo') return json(res, 200, resumen(id));

  if (metodo === 'POST' && ruta === '/api/logout') {
    sesiones.delete((req.headers.authorization ?? '').slice(7));
    return json(res, 200, { ok: true });
  }

  if (metodo === 'POST' && ruta === '/api/depositar') {
    const monto = leerMonto((await leerCuerpo(req)).monto);
    if (!monto) return json(res, 400, { error: 'Ingresa un monto válido mayor a cero.' });
    u.saldo = redondear(u.saldo + monto);
    agregarMovimiento(u, { tipo: 'deposito', descripcion: 'Depósito', monto });
    notificar(id);
    return json(res, 200, resumen(id));
  }

  if (metodo === 'POST' && ruta === '/api/retirar') {
    const monto = leerMonto((await leerCuerpo(req)).monto);
    if (!monto) return json(res, 400, { error: 'Ingresa un monto válido mayor a cero.' });
    if (monto > u.saldo) return json(res, 400, { error: `Saldo insuficiente. Disponible: $${u.saldo.toFixed(2)}` });
    u.saldo = redondear(u.saldo - monto);
    agregarMovimiento(u, { tipo: 'retiro', descripcion: 'Retiro', monto: -monto });
    notificar(id);
    return json(res, 200, resumen(id));
  }

  if (metodo === 'POST' && ruta === '/api/transferir') {
    const cuerpo = await leerCuerpo(req);
    const destino = String(cuerpo.destino ?? '').trim().toLowerCase();
    const monto = leerMonto(cuerpo.monto);
    const d = buscarUsuario(destino);
    if (!destino) return json(res, 400, { error: 'Ingresa una cuenta destino.' });
    if (destino === id) return json(res, 400, { error: 'No puedes transferirte a ti mismo.' });
    if (!d) return json(res, 400, { error: `Usuario "${destino}" no encontrado.` });
    if (!monto) return json(res, 400, { error: 'Ingresa un monto válido mayor a cero.' });
    if (monto > u.saldo) return json(res, 400, { error: `Saldo insuficiente. Disponible: $${u.saldo.toFixed(2)}` });
    u.saldo = redondear(u.saldo - monto);
    d.saldo = redondear(d.saldo + monto);
    agregarMovimiento(u, { tipo: 'transferencia', descripcion: `Transferencia a ${d.nombre}`, monto: -monto });
    agregarMovimiento(d, { tipo: 'transferencia', descripcion: `Transferencia de ${u.nombre}`, monto });
    notificar(id, destino);
    return json(res, 200, resumen(id));
  }

  // Bloquear / desbloquear tarjeta. Al desbloquear, el AFD vuelve a q0 y se cierran las alertas pendientes.
  if (metodo === 'POST' && ruta === '/api/tarjeta/bloqueo') {
    const { bloqueada } = await leerCuerpo(req);
    if (typeof bloqueada !== 'boolean') return json(res, 400, { error: '"bloqueada" debe ser true o false' });
    u.tarjeta.bloqueada = bloqueada;
    if (!bloqueada) {
      u.afd = { estado: INICIAL, cadena: '', ultimoIntento: null };
      for (const a of alertasPendientes(u)) a.estado = 'cerrada';
    }
    notificar(id);
    return json(res, 200, resumen(id));
  }

  // Responder a una alerta: "fui yo" reinicia el AFD; "no fui yo" bloquea la tarjeta.
  const m = ruta.match(/^\/api\/alertas\/([\w-]+)\/respuesta$/);
  if (metodo === 'POST' && m) {
    const alerta = u.alertas.find((a) => a.id === m[1]);
    if (!alerta) return json(res, 404, { error: 'Alerta no encontrada' });
    if (alerta.estado !== 'pendiente') return json(res, 409, { error: 'La alerta ya fue respondida' });
    const { fuiYo } = await leerCuerpo(req);
    if (typeof fuiYo !== 'boolean') return json(res, 400, { error: '"fuiYo" debe ser true o false' });
    if (fuiYo) {
      alerta.estado = 'descartada';
      if (u.afd.estado !== FRAUDE) u.afd = { estado: INICIAL, cadena: '', ultimoIntento: null };
    } else {
      alerta.estado = 'confirmada';
      u.tarjeta.bloqueada = true;
    }
    notificar(id);
    return json(res, 200, resumen(id));
  }

  return json(res, 404, { error: 'Ruta no encontrada' });
}

// ===== ARCHIVOS ESTÁTICOS =====

async function estatico(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Método no permitido');
  }
  let ruta;
  try {
    ruta = decodeURIComponent(url.pathname);
  } catch {
    throw new ErrorHttp(400, 'URL inválida');
  }
  if (ruta === '/') ruta = '/index.html';
  if (ruta.endsWith('/')) ruta += 'index.html';
  const archivo = path.normalize(path.join(PUBLICO, ruta));
  if (!archivo.startsWith(PUBLICO + path.sep)) return json(res, 403, { error: 'Prohibido' });
  try {
    const contenido = await fs.readFile(archivo);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(archivo)] ?? 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : contenido);
  } catch {
    // /banco → /banco/
    try {
      await fs.access(path.join(archivo, 'index.html'));
      res.writeHead(301, { Location: url.pathname + '/' });
      res.end();
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('No encontrado');
    }
  }
}

export function crearServidor() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    try {
      if (url.pathname.startsWith('/api/')) await api(req, res, url);
      else await estatico(req, res, url);
    } catch (err) {
      if (res.headersSent) return res.end();
      // Si no se leyó todo el cuerpo, la conexión ya no es reutilizable
      if (err instanceof ErrorHttp && err.status === 413) res.setHeader('Connection', 'close');
      if (err instanceof ErrorHttp) return json(res, err.status, { error: err.message });
      console.error(err);
      json(res, 500, { error: 'Error interno del servidor' });
    }
  });
}

// Sólo escucha si se ejecuta directamente (las pruebas importan crearServidor)
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) crearServidor().listen(PUERTO, () => {
  console.log(`\nBanco BBUA     → http://localhost:${PUERTO}/banco/`);
  console.log(`Amason         → http://localhost:${PUERTO}/tienda/`);
  console.log(`Definición AFD → http://localhost:${PUERTO}/api/afd\n`);
});
