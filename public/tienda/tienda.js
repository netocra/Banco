// ===== CATÁLOGO =====
const COMERCIO = 'TechoStore';

const PRODUCTOS = [
  { id: 'sticker',   nombre: 'Sticker holográfico',       precio: 25 },
  { id: 'llavero',   nombre: 'Llavero de acrílico',       precio: 45 },
  { id: 'taza',      nombre: 'Taza para programadores',   precio: 189 },
  { id: 'cable',     nombre: 'Cable USB-C trenzado',      precio: 149 },
  { id: 'mouse',     nombre: 'Mouse inalámbrico',         precio: 399 },
  { id: 'teclado',   nombre: 'Teclado mecánico',          precio: 1299 },
  { id: 'audifonos', nombre: 'Audífonos Bluetooth',       precio: 899 },
  { id: 'laptop',    nombre: 'Laptop 14" Ryzen 7',        precio: 15999 },
];

// ===== CARRITO (se guarda en localStorage) =====
let carrito = {};
try { carrito = JSON.parse(localStorage.getItem('carrito')) ?? {}; } catch { carrito = {}; }

function guardar() {
  try { localStorage.setItem('carrito', JSON.stringify(carrito)); } catch { /* sin almacenamiento */ }
  renderCarrito();
}

const fmt = (n) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
// Color estable por producto para la miniatura
const hue = (id) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const producto = (id) => PRODUCTOS.find((p) => p.id === id);
const total = () => Object.entries(carrito).reduce((s, [id, c]) => s + producto(id).precio * c, 0);

function agregar(id) {
  carrito[id] = (carrito[id] ?? 0) + 1;
  guardar();
  const btn = document.querySelector(`[data-add="${id}"]`);
  btn.textContent = 'Agregado';
  setTimeout(() => (btn.textContent = 'Agregar al carrito'), 900);
}

function cambiar(id, delta) {
  carrito[id] = (carrito[id] ?? 0) + delta;
  if (carrito[id] <= 0) delete carrito[id];
  guardar();
}

// ===== RENDER =====

function renderCatalogo() {
  document.getElementById('catalogo').innerHTML = PRODUCTOS.map((p) => `
    <article class="producto">
      <div class="producto-img" style="--h: ${hue(p.id)}">${p.nombre.split(' ')[0]}</div>
      <h3>${p.nombre}</h3>
      <p class="precio">${fmt(p.precio)}</p>
      <button class="btn" data-add="${p.id}" onclick="agregar('${p.id}')">Agregar al carrito</button>
    </article>`).join('');
}

function renderCarrito() {
  const ids = Object.keys(carrito);
  document.getElementById('cart-count').textContent = Object.values(carrito).reduce((a, b) => a + b, 0);
  document.getElementById('cart-total').textContent = fmt(total());
  document.getElementById('btn-checkout').disabled = ids.length === 0;
  document.getElementById('cart-items').innerHTML = ids.length
    ? ids.map((id) => {
        const p = producto(id);
        return `
          <li>
                        <div class="ci-info">
              <div>${p.nombre}</div>
              <small>${fmt(p.precio)} c/u</small>
            </div>
            <div class="qty">
              <button onclick="cambiar('${id}', -1)">−</button>
              <span>${carrito[id]}</span>
              <button onclick="cambiar('${id}', 1)">+</button>
            </div>
          </li>`;
      }).join('')
    : '<li class="empty">Tu carrito está vacío.</li>';
}

// ===== CARRITO / PAGO: abrir y cerrar =====

function abrirCarrito() { document.getElementById('carrito').classList.remove('hidden'); }
function cerrarCarrito() { document.getElementById('carrito').classList.add('hidden'); }

function abrirPago() {
  cerrarCarrito();
  document.getElementById('pago-total').textContent = fmt(total());
  document.getElementById('pago-error').classList.add('hidden');
  document.getElementById('pago').classList.remove('hidden');
}
function cerrarPago() { document.getElementById('pago').classList.add('hidden'); }

// Formato automático de los campos de tarjeta
document.getElementById('pago-numero').addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 ');
});
document.getElementById('pago-exp').addEventListener('input', (e) => {
  const d = e.target.value.replace(/\D/g, '').slice(0, 4);
  e.target.value = d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
});
document.getElementById('pago-cvv').addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
});

// ===== PAGO: se envía a la pasarela de Banco Techo =====

document.getElementById('form-pago').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('btn-pagar');
  const err = document.getElementById('pago-error');
  const monto = total();
  const concepto = Object.keys(carrito).length === 1
    ? producto(Object.keys(carrito)[0]).nombre
    : `${Object.values(carrito).reduce((a, b) => a + b, 0)} artículos`;

  btn.disabled = true;
  btn.textContent = 'Procesando…';
  err.classList.add('hidden');

  try {
    const res = await fetch('/api/pagos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        numero: document.getElementById('pago-numero').value,
        exp: document.getElementById('pago-exp').value,
        cvv: document.getElementById('pago-cvv').value,
        titular: document.getElementById('pago-titular').value,
        monto,
        comercio: COMERCIO,
        concepto,
      }),
    });
    const r = await res.json();

    if (r.aprobado) {
      carrito = {};
      guardar();
      e.target.reset();
      cerrarPago();
      document.getElementById('res-auth').textContent = r.autorizacion;
      document.getElementById('res-monto').textContent = fmt(monto);
      document.getElementById('resultado').classList.remove('hidden');
    } else {
      err.textContent = `Pago rechazado: ${r.motivo ?? 'error desconocido'}`;
      err.classList.remove('hidden');
    }
  } catch {
    err.textContent = 'No se pudo contactar al banco.';
    err.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Pagar';
  }
});

// ===== INIT =====
renderCatalogo();
renderCarrito();
