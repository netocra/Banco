// ===== DATOS DE USUARIOS =====
const USERS = {
  carlos: { password: '1234', name: 'Carlos Méndez', account: '4521 **** **** 9801', balance: 5000 },
  ana:    { password: '4321', name: 'Ana García',    account: '4521 **** **** 1234', balance: 3200 },
};

document.getElementById('form-login').addEventListener('submit', (e) => {
  e.preventDefault();

  const username = document.getElementById('input-user').value.trim().toLowerCase();
  const password  = document.getElementById('input-pass').value;
  const errorEl   = document.getElementById('login-error');

  if (USERS[username] && USERS[username].password === password) {
    errorEl.classList.add('hidden');

    // Guardar sesión en sessionStorage y redirigir al dashboard
    sessionStorage.setItem('session_user', username);
    sessionStorage.setItem('session_data', JSON.stringify(USERS[username]));

    window.location.href = 'index.html';
  } else {
    errorEl.classList.remove('hidden');
  }
});
