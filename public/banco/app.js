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
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
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
  document.getElementById('nav-user').textContent = u.nombre;
  document.getElementById('nav-user-card').textContent = u.nombre.toUpperCase();
  document.getElementById('display-balance').textContent = fmt(u.saldo);
  document.getElementById('debit-card').classList.toggle('bloqueada', u.tarjeta.bloqueada);
  document.getElementById('lock-label').textContent = u.tarjeta.bloqueada ? 'Desbloquear' : 'Bloquear';
  renderCardData();
  renderAlertas();
  renderAfd();
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

  const ETIQUETAS = { deposito: 'DEP', retiro: 'RET', transferencia: 'TRF', compra: 'CMP', rechazo: 'RCH' };

  list.innerHTML = datos.movimientos
    .map(tx => {
      const isCredit = tx.monto > 0;
      const clase = tx.tipo === 'rechazo' ? 'rejected' : isCredit ? 'credit' : 'debit';
      const simbolo = tx.simbolo ? `<span class="tx-sym" title="Símbolo leído por el AFD">${esc(tx.simbolo)}</span>` : '';
      return `
        <li class="${tx.tipo === 'rechazo' ? 'tx-rechazo' : ''}">
          <div class="tx-info">
            <span class="tx-icon tx-icon--${tx.tipo}">${ETIQUETAS[tx.tipo] ?? ''}</span>
            <div>
              <div class="tx-desc">${esc(tx.descripcion)} ${simbolo}</div>
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
      new Notification(`Banco Techo · ${a.titulo}`, { body: a.mensaje });
    }
  }
  primeraCarga = false;
}

async function responderAlerta(id, fuiYo) {
  datos = await api(`/api/alertas/${id}/respuesta`, { fuiYo });
  refreshDashboard();
  showToast(fuiYo ? 'Gracias, reiniciamos el monitor.' : 'Tarjeta bloqueada.');
}

// ===== AUTÓMATA =====

function renderAfd() {
  const { estado, nombreEstado, cadena, ultimaTransicion } = datos.afd;
  const svg = document.getElementById('afd');

  svg.querySelectorAll('.estado').forEach(g => g.classList.toggle('activo', g.dataset.q === estado));
  svg.querySelectorAll('[data-t]').forEach(el => el.classList.remove('ultima'));
  if (ultimaTransicion) {
    svg.querySelectorAll(`[data-t="${ultimaTransicion.de}${ultimaTransicion.a}"]`).forEach(el => el.classList.add('ultima'));
  }

  const badge = document.getElementById('afd-badge');
  badge.textContent = `${estado} · ${nombreEstado}`;
  badge.className = `badge ${estado === 'q4' ? 'badge--fraude' : estado === 'q3' ? 'badge--sospecha' : ''}`;
  document.getElementById('afd-cadena').textContent = cadena || 'ε';
}

// ===== TOGGLE VISIBILIDAD =====

function toggleVisibility() {
  balanceVisible = !balanceVisible;
  renderCardData();
}

// ===== BLOQUEO DE TARJETA =====

async function toggleLock() {
  const bloquear = !datos.tarjeta.bloqueada;
  datos = await api('/api/tarjeta/bloqueo', { bloqueada: bloquear });
  refreshDashboard();
  showToast(bloquear ? 'Tarjeta bloqueada.' : 'Tarjeta desbloqueada. Monitor reiniciado.');
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

// ===== INIT =====
if (token) {
  if ('Notification' in window && Notification.permission === 'default') {
    document.addEventListener('click', () => Notification.requestPermission(), { once: true });
  }
  cargar().then(escucharCambios);
}
