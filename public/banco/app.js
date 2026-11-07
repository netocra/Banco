// ===== SESIÓN =====
const token = sessionStorage.getItem('session_token');

if (!token) {
  window.location.replace('login.html');
}

// ===== ESTADO =====
let datos = null;              // respuesta de /api/yo
let balanceVisible = false;    // inicia oculto, el ojo lo revela
const alertasVistas = new Set();
let primeraCarga = true;

// ===== UTILIDADES =====

function fmt(amount) {
  return amount.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
}

function fecha(iso) {
  return new Date(iso).toLocaleString('es-MX', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

// Los nombres de comercio vienen de terceros: siempre escapar antes de insertar HTML
function esc(texto) {
  return String(texto).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 2800);
}

function showError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.classList.remove('hidden');
}

async function api(ruta, cuerpo) {
  const res = await fetch(ruta, {
    method: cuerpo ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  if (res.status === 401) {
    sessionStorage.removeItem('session_token');
    window.location.replace('login.html');
  }
  const json = await res.json();
  if (!res.ok) throw new Error(json.error);
  return json;
}

// ===== MODALES =====

function openModal(id) {
  const modal = document.getElementById(id);
  modal.querySelectorAll('input').forEach(i => i.value = '');
  modal.querySelectorAll('.error-msg').forEach(e => e.classList.add('hidden'));
  modal.querySelectorAll('[data-saldo]').forEach(e => (e.textContent = datos ? fmt(datos.saldo) : ''));
  modal.classList.remove('hidden');
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.add('hidden');
  });
});

// ===== DASHBOARD =====

async function cargar() {
  datos = await api('/api/yo');
  avisarAlertasNuevas();
  refreshDashboard();
}

function refreshDashboard() {
  const u = datos;
  const hora = new Date().getHours();
  document.getElementById('saludo').textContent = hora < 12 ? 'Buenos días' : hora < 19 ? 'Buenas tardes' : 'Buenas noches';
  document.getElementById('avatar').textContent = u.nombre.split(' ').map(p => p[0]).slice(0, 2).join('');
  document.getElementById('nav-user').textContent = u.nombre;
  document.getElementById('nav-user-card').textContent = u.nombre.toUpperCase();
  document.getElementById('display-balance').textContent = fmt(u.saldo);
  document.getElementById('debit-card').classList.toggle('bloqueada', u.tarjeta.bloqueada);
  document.getElementById('lock-label').textContent = u.tarjeta.bloqueada ? 'Desbloquear' : 'Bloquear';
  document.getElementById('lock-ayuda').textContent = u.tarjeta.bloqueada
    ? 'Vuelve a permitir cargos con tu tarjeta.'
    : 'Congela los cargos por tu seguridad.';
  renderCardData();
  renderAlertas();
  renderTransactions();
}

function renderCardData() {
  const t = datos.tarjeta;
  document.getElementById('display-account').textContent = balanceVisible ? t.numero : t.enmascarada;
  document.getElementById('display-extra').textContent = balanceVisible ? `VENCE ${t.exp}   CVV ${t.cvv}` : 'VENCE **/**   CVV ***';
}

function renderTransactions() {
  const list = document.getElementById('transaction-list');
  if (datos.movimientos.length === 0) {
    list.innerHTML = '<li class="empty-state">Sin movimientos aún.</li>';
    return;
  }

  const flecha = (d) => `<svg viewBox="0 0 24 24"><path d="${d}" /></svg>`;
  const ABAJO = 'M12 5v14M6 13l6 6 6-6';
  const ARRIBA = 'M12 19V5M6 11l6-6 6 6';
  function icono(tx) {
    if (tx.tipo === 'rechazo') return '!';
    if (tx.tipo === 'compra') return esc((tx.comercio ?? tx.descripcion).trim().charAt(0).toUpperCase());
    if (tx.tipo === 'deposito') return flecha(ABAJO);
    if (tx.tipo === 'retiro') return flecha(ARRIBA);
    return flecha(tx.monto > 0 ? ABAJO : ARRIBA);
  }

  list.innerHTML = datos.movimientos
    .map(tx => {
      const isCredit = tx.monto > 0;
      const clase = tx.tipo === 'rechazo' ? 'rejected' : isCredit ? 'credit' : 'debit';
      return `
        <li class="${tx.tipo === 'rechazo' ? 'tx-rechazo' : ''}">
          <div class="tx-info">
            <span class="tx-icon tx-icon--${tx.tipo === 'transferencia' && isCredit ? 'entrada' : tx.tipo}">${icono(tx)}</span>
            <div>
              <div class="tx-desc">${esc(tx.descripcion)}</div>
              <div class="tx-date">${fecha(tx.fecha)}${tx.motivo ? ' · ' + esc(tx.motivo) : ''}</div>
            </div>
          </div>
          <span class="tx-amount ${clase}">
            ${isCredit ? '+' : ''}${fmt(tx.monto)}
          </span>
        </li>`;
    })
    .join('');
}

// ===== ALERTAS =====

function renderAlertas() {
  const pendientes = datos.alertas.filter(a => a.estado === 'pendiente');
  document.getElementById('alertas').innerHTML = pendientes
    .map(a => `
      <div class="alerta alerta--${a.nivel}">
        <div class="alerta-head">
          <div>
            <strong>${esc(a.titulo)}</strong>
            <div class="tx-date">${fecha(a.fecha)}</div>
          </div>
        </div>
        <p>${esc(a.mensaje)}</p>
        <div class="modal-actions">
          ${a.nivel === 'fraude'
            ? `<button class="btn-primary" onclick="responderAlerta('${a.id}', false)">Entendido</button>`
            : `<button class="btn-secondary" onclick="responderAlerta('${a.id}', true)">Sí, fui yo</button>
               <button class="btn-danger" onclick="responderAlerta('${a.id}', false)">No fui yo · Bloquear</button>`}
        </div>
      </div>`)
    .join('');
}

function avisarAlertasNuevas() {
  for (const a of datos.alertas) {
    if (alertasVistas.has(a.id)) continue;
    alertasVistas.add(a.id);
    if (primeraCarga || a.estado !== 'pendiente') continue;
    showToast(a.titulo);
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(`Banco BBUA · ${a.titulo}`, { body: a.mensaje });
    }
  }
  primeraCarga = false;
}

async function responderAlerta(id, fuiYo) {
  try {
    datos = await api(`/api/alertas/${id}/respuesta`, { fuiYo });
  } catch (err) {
    return cargar().then(() => showToast(err.message));
  }
  refreshDashboard();
  showToast(fuiYo ? 'Gracias por confirmarlo.' : 'Tarjeta bloqueada.');
}


// ===== TOGGLE VISIBILIDAD =====

function toggleVisibility() {
  balanceVisible = !balanceVisible;
  renderCardData();
}

// ===== BLOQUEO DE TARJETA =====

async function toggleLock() {
  const bloquear = !datos.tarjeta.bloqueada;
  try {
    datos = await api('/api/tarjeta/bloqueo', { bloqueada: bloquear });
  } catch (err) {
    return showToast(err.message);
  }
  refreshDashboard();
  showToast(bloquear ? 'Tarjeta bloqueada.' : 'Tarjeta desbloqueada.');
}

// ===== LOGOUT =====

document.getElementById('btn-logout').addEventListener('click', async () => {
  await api('/api/logout', {}).catch(() => {});
  sessionStorage.removeItem('session_token');
  window.location.href = 'login.html';
});

// ===== DEPÓSITO =====

async function handleDeposit() {
  const monto = parseFloat(document.getElementById('deposit-amount').value);
  try {
    datos = await api('/api/depositar', { monto });
  } catch (err) {
    return showError('deposit-error', err.message);
  }
  closeModal('modal-deposit');
  refreshDashboard();
  showToast(`Depósito de ${fmt(monto)} realizado.`);
}

// ===== RETIRO =====

async function handleWithdraw() {
  const monto = parseFloat(document.getElementById('withdraw-amount').value);
  try {
    datos = await api('/api/retirar', { monto });
  } catch (err) {
    return showError('withdraw-error', err.message);
  }
  closeModal('modal-withdraw');
  refreshDashboard();
  showToast(`Retiro de ${fmt(monto)} realizado.`);
}

// ===== TRANSFERENCIA =====

async function handleTransfer() {
  const destino = document.getElementById('transfer-dest').value.trim().toLowerCase();
  const monto   = parseFloat(document.getElementById('transfer-amount').value);
  try {
    datos = await api('/api/transferir', { destino, monto });
  } catch (err) {
    return showError('transfer-error', err.message);
  }
  closeModal('modal-transfer');
  refreshDashboard();
  showToast(`Transferencia de ${fmt(monto)} enviada.`);
}

// ===== TIEMPO REAL =====
// El servidor avisa por Server-Sent Events cada vez que cambia algo de esta cuenta
// (una compra en la tienda, un intento del script, una transferencia recibida...).

function escucharCambios() {
  const fuente = new EventSource(`/api/eventos?token=${encodeURIComponent(token)}`);
  fuente.addEventListener('cambio', () => cargar());
}

// ===== TECLADO NUMÉRICO =====
// Cada panel tiene un teclado que escribe en su campo de monto (también se puede teclear).

document.querySelectorAll('[data-teclado]').forEach((teclado) => {
  const campo = document.getElementById(teclado.dataset.teclado);
  const teclas = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'borrar'];
  teclado.innerHTML = teclas.map((t) => t === 'borrar'
    ? '<button type="button" data-tecla="borrar" aria-label="Borrar"><svg viewBox="0 0 24 24"><path d="M9 6h11v12H9l-6-6 6-6ZM13 10l4 4M17 10l-4 4" /></svg></button>'
    : `<button type="button" data-tecla="${t}">${t}</button>`).join('');
  teclado.addEventListener('click', (e) => {
    const tecla = e.target.closest('[data-tecla]')?.dataset.tecla;
    if (!tecla) return;
    let v = campo.value;
    if (tecla === 'borrar') v = v.slice(0, -1);
    else if (tecla === '.' && v.includes('.')) return;
    else if (/\.\d{2}$/.test(v)) return;          // máximo dos decimales
    else v = (v === '0' && tecla !== '.') ? tecla : v + tecla;
    campo.value = v;
  });
});

// ===== DESLIZA PARA ENVIAR =====
// Arrastrar la perilla hasta el final envía; un clic normal también.

(() => {
  const boton = document.querySelector('.deslizar');
  const perilla = boton.querySelector('.deslizar-perilla');
  let inicio = null;
  let arrastro = false;

  perilla.addEventListener('pointerdown', (e) => {
    inicio = e.clientX;
    arrastro = false;
    perilla.setPointerCapture(e.pointerId);
    boton.classList.add('arrastrando');
  });
  perilla.addEventListener('pointermove', (e) => {
    if (inicio === null) return;
    const max = boton.clientWidth - perilla.offsetWidth - 8;
    const dx = Math.max(0, Math.min(max, e.clientX - inicio));
    if (dx > 4) arrastro = true;
    perilla.style.transform = `translateX(${dx}px)`;
  });
  perilla.addEventListener('pointerup', (e) => {
    if (inicio === null) return;
    const max = boton.clientWidth - perilla.offsetWidth - 8;
    const llego = e.clientX - inicio > max * 0.8;
    inicio = null;
    boton.classList.remove('arrastrando');
    perilla.style.transform = '';
    if (llego) handleTransfer();
  });
  // Si fue arrastre, ignorar el clic que el navegador dispara al soltar
  boton.addEventListener('click', (e) => {
    if (arrastro) { e.stopImmediatePropagation(); e.preventDefault(); arrastro = false; }
  }, true);
})();

// ===== INIT =====
if (token) {
  if ('Notification' in window && Notification.permission === 'default') {
    document.addEventListener('click', () => Notification.requestPermission(), { once: true });
  }
  cargar().then(escucharCambios);
}
