document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();

  const usuario  = document.getElementById('input-user').value.trim().toLowerCase();
  const password = document.getElementById('input-pass').value;
  const errorEl  = document.getElementById('login-error');

  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario, password }),
  });

  if (res.ok) {
    const { token } = await res.json();
    sessionStorage.setItem('session_token', token);
    window.location.href = 'index.html';
  } else {
    errorEl.classList.remove('hidden');
  }
});
