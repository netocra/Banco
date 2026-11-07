// ===== DATOS SIMULADOS =====
const USERS = {
  carlos: { password: '1234', name: 'Carlos Méndez', account: '4521 8834 6672 9801', accountMasked: '4521 **** **** 9801', balance: 5000 },
  ana:    { password: '4321', name: 'Ana García',    account: '4521 9910 3345 1234', accountMasked: '4521 **** **** 1234', balance: 3200 },
};

// ===== SESIÓN =====
const sessionUser = sessionStorage.getItem('session_user');

if (!sessionUser || !USERS[sessionUser]) {
  window.location.replace('login.html');
}

// ===== ESTADO =====
let transactions  = [];
let balanceVisible = false;   // inicia oculto, el ojo lo revela

// ===== UTILIDADES =====

function fmt(amount) {
  return amount.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
}

function now() {
  return new Date().toLocaleString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
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

function clearError(id) {
  const el = document.getElementById(id);
  el.textContent = '';
  el.classList.add('hidden');
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

function refreshDashboard() {
  const u = USERS[sessionUser];
  document.getElementById('nav-user').textContent = u.name;
  document.getElementById('nav-user-card').textContent = u.name.toUpperCase();
  document.getElementById('display-balance').textContent = fmt(u.balance);
  document.getElementById('display-account').textContent = balanceVisible ? u.account : u.accountMasked;
  renderTransactions();
}

function renderTransactions() {
  const list = document.getElementById('transaction-list');
  if (transactions.length === 0) {
    list.innerHTML = '<li class="empty-state">Sin movimientos aún.</li>';
    return;
  }

  list.innerHTML = transactions
    .slice()
    .reverse()
    .map(tx => {
      const isCredit = tx.amount > 0;
      return `
        <li>
          <div class="tx-info">
            <span class="tx-icon">${tx.icon}</span>
            <div>
              <div class="tx-desc">${tx.description}</div>
              <div class="tx-date">${tx.date}</div>
            </div>
          </div>
          <span class="tx-amount ${isCredit ? 'credit' : 'debit'}">
            ${isCredit ? '+' : ''}${fmt(tx.amount)}
          </span>
        </li>`;
    })
    .join('');
}

function addTransaction(description, amount, icon) {
  transactions.push({ description, amount, icon, date: now() });
}

// ===== TOGGLE VISIBILIDAD =====

function toggleVisibility() {
  balanceVisible = !balanceVisible;
  const u = USERS[sessionUser];
  document.getElementById('display-account').textContent = balanceVisible ? u.account : u.accountMasked;
}

// ===== LOGOUT =====

document.getElementById('btn-logout').addEventListener('click', () => {
  sessionStorage.removeItem('session_user');
  sessionStorage.removeItem('session_data');
  window.location.href = 'login.html';
});

// ===== DEPÓSITO =====

function handleDeposit() {
  const amount = parseFloat(document.getElementById('deposit-amount').value);

  if (!amount || amount <= 0) {
    showError('deposit-error', 'Ingresa un monto válido mayor a cero.');
    return;
  }

  USERS[sessionUser].balance += amount;
  addTransaction('Depósito', amount, '⬇️');
  closeModal('modal-deposit');
  refreshDashboard();
  showToast(`✅ Depósito de ${fmt(amount)} realizado.`);
}

// ===== RETIRO =====

function handleWithdraw() {
  const amount  = parseFloat(document.getElementById('withdraw-amount').value);
  const balance = USERS[sessionUser].balance;

  if (!amount || amount <= 0) {
    showError('withdraw-error', 'Ingresa un monto válido mayor a cero.');
    return;
  }
  if (amount > balance) {
    showError('withdraw-error', `Saldo insuficiente. Disponible: ${fmt(balance)}`);
    return;
  }

  USERS[sessionUser].balance -= amount;
  addTransaction('Retiro', -amount, '⬆️');
  closeModal('modal-withdraw');
  refreshDashboard();
  showToast(`✅ Retiro de ${fmt(amount)} realizado.`);
}

// ===== TRANSFERENCIA =====

function handleTransfer() {
  const dest    = document.getElementById('transfer-dest').value.trim().toLowerCase();
  const amount  = parseFloat(document.getElementById('transfer-amount').value);
  const balance = USERS[sessionUser].balance;

  if (!dest) {
    showError('transfer-error', 'Ingresa una cuenta destino.');
    return;
  }
  if (dest === sessionUser) {
    showError('transfer-error', 'No puedes transferirte a ti mismo.');
    return;
  }
  if (!USERS[dest]) {
    showError('transfer-error', `Usuario "${dest}" no encontrado. Prueba con "ana".`);
    return;
  }
  if (!amount || amount <= 0) {
    showError('transfer-error', 'Ingresa un monto válido mayor a cero.');
    return;
  }
  if (amount > balance) {
    showError('transfer-error', `Saldo insuficiente. Disponible: ${fmt(balance)}`);
    return;
  }

  USERS[sessionUser].balance -= amount;
  USERS[dest].balance        += amount;
  addTransaction(`Transferencia a ${USERS[dest].name}`, -amount, '↔️');
  closeModal('modal-transfer');
  refreshDashboard();
  showToast(`✅ Transferencia de ${fmt(amount)} enviada a ${USERS[dest].name}.`);
}

// ===== INIT =====
refreshDashboard();
