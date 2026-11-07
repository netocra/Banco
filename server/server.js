// ===== SERVIDOR: Banco Techo + TechoStore =====
// Sin dependencias: sólo módulos nativos de Node.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { usuarios, eventos, notificar, agregarMovimiento } from './db.js';
import { procesarPago } from './pagos.js';
import { definicion, INICIAL } from './afd.js';
import { formatear, enmascarar } from './tarjetas.js';

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

function json(res, status, datos) {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(datos));
}

async function leerCuerpo(req) {
  let cuerpo = '';
  for await (const trozo of req) {
    cuerpo += trozo;
    if (cuerpo.length > 1e5) throw new Error('Cuerpo demasiado grande');
  }
  return cuerpo ? JSON.parse(cuerpo) : {};
}

function usuarioDeSesion(req, url) {
  const auth = req.headers.authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : url.searchParams.get('token');
  const id = sesiones.get(token);
  return id ? [id, usuarios[id]] : [null, null];
}

function montoValido(m) {
  const n = Number(m);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
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
    if (!usuarios[id] || usuarios[id].password !== password) {
      return json(res, 401, { error: 'Usuario o contraseña incorrectos.' });
    }
    const token = randomUUID();
    sesiones.set(token, id);
    return json(res, 200, { token, usuario: id });
  }

  // Pasarela que usan los comercios (la tienda y el script de pruebas)
  if (metodo === 'POST' && ruta === '/api/pagos') {
    return json(res, 200, procesarPago(await leerCuerpo(req)));
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
    const monto = montoValido((await leerCuerpo(req)).monto);
    if (!monto) return json(res, 400, { error: 'Ingresa un monto válido mayor a cero.' });
    u.saldo += monto;
    agregarMovimiento(u, { tipo: 'deposito', descripcion: 'Depósito', monto });
    notificar(id);
    return json(res, 200, resumen(id));
  }

  if (metodo === 'POST' && ruta === '/api/retirar') {
    const monto = montoValido((await leerCuerpo(req)).monto);
    if (!monto) return json(res, 400, { error: 'Ingresa un monto válido mayor a cero.' });
    if (monto > u.saldo) return json(res, 400, { error: `Saldo insuficiente. Disponible: $${u.saldo.toFixed(2)}` });
    u.saldo -= monto;
    agregarMovimiento(u, { tipo: 'retiro', descripcion: 'Retiro', monto: -monto });
    notificar(id);
    return json(res, 200, resumen(id));
  }

  if (metodo === 'POST' && ruta === '/api/transferir') {
    const cuerpo = await leerCuerpo(req);
    const destino = String(cuerpo.destino ?? '').trim().toLowerCase();
    const monto = montoValido(cuerpo.monto);
    if (!destino) return json(res, 400, { error: 'Ingresa una cuenta destino.' });
    if (destino === id) return json(res, 400, { error: 'No puedes transferirte a ti mismo.' });
    if (!usuarios[destino]) return json(res, 400, { error: `Usuario "${destino}" no encontrado.` });
    if (!monto) return json(res, 400, { error: 'Ingresa un monto válido mayor a cero.' });
    if (monto > u.saldo) return json(res, 400, { error: `Saldo insuficiente. Disponible: $${u.saldo.toFixed(2)}` });
    const d = usuarios[destino];
    u.saldo -= monto;
    d.saldo += monto;
    agregarMovimiento(u, { tipo: 'transferencia', descripcion: `Transferencia a ${d.nombre}`, monto: -monto });
    agregarMovimiento(d, { tipo: 'transferencia', descripcion: `Transferencia de ${u.nombre}`, monto });
    notificar(id, destino);
    return json(res, 200, resumen(id));
  }

  // Bloquear / desbloquear tarjeta. Al desbloquear, el AFD vuelve a q0.
  if (metodo === 'POST' && ruta === '/api/tarjeta/bloqueo') {
    const { bloqueada } = await leerCuerpo(req);
    u.tarjeta.bloqueada = Boolean(bloqueada);
    if (!u.tarjeta.bloqueada) u.afd = { estado: INICIAL, cadena: '', ultimoIntento: null };
    notificar(id);
    return json(res, 200, resumen(id));
  }

  // Responder a una alerta: "fui yo" reinicia el AFD; "no fui yo" bloquea la tarjeta.
  const m = ruta.match(/^\/api\/alertas\/([\w-]+)\/respuesta$/);
  if (metodo === 'POST' && m) {
    const alerta = u.alertas.find((a) => a.id === m[1]);
    if (!alerta) return json(res, 404, { error: 'Alerta no encontrada' });
    const { fuiYo } = await leerCuerpo(req);
    if (fuiYo) {
      alerta.estado = 'descartada';
      if (u.afd.estado !== 'q4') u.afd = { estado: INICIAL, cadena: '', ultimoIntento: null };
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

async function estatico(res, url) {
  let ruta = decodeURIComponent(url.pathname);
  if (ruta === '/') ruta = '/index.html';
  if (ruta.endsWith('/')) ruta += 'index.html';
  const archivo = path.normalize(path.join(PUBLICO, ruta));
  if (!archivo.startsWith(PUBLICO + path.sep)) return json(res, 403, { error: 'Prohibido' });
  try {
    const contenido = await fs.readFile(archivo);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(archivo)] ?? 'application/octet-stream' });
    res.end(contenido);
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

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else await estatico(res, url);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) json(res, 400, { error: err.message });
  }
});

servidor.listen(PUERTO, () => {
  console.log(`\nBanco Techo    → http://localhost:${PUERTO}/banco/`);
  console.log(`TechoStore     → http://localhost:${PUERTO}/tienda/`);
  console.log(`Definición AFD → http://localhost:${PUERTO}/api/afd\n`);
});
