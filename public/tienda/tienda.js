// ===== CATÁLOGO (lo da el servidor de la tienda) =====
let PRODUCTOS = [];

// ===== CARRITO (se guarda en localStorage) =====
let carrito = {};
try { carrito = JSON.parse(localStorage.getItem('carrito')) ?? {}; } catch { carrito = {}; }

function guardar() {
  try { localStorage.setItem('carrito', JSON.stringify(carrito)); } catch { /* sin almacenamiento */ }
  renderCarrito();
  renderEnCarrito();
}

const fmt = (n) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const producto = (id) => PRODUCTOS.find((p) => p.id === id);
const total = () => Object.entries(carrito).reduce((s, [id, c]) => s + (producto(id)?.precio ?? 0) * c, 0);

function agregar(id) {
  carrito[id] = (carrito[id] ?? 0) + 1;
  guardar();
  // Pequeño pulso en la pieza (puede estar oculta por un filtro)
  const pieza = document.querySelector(`.producto[data-id="${id}"]`);
  if (!pieza) return;
  pieza.classList.remove('pulso');
  void pieza.offsetWidth;
  pieza.classList.add('pulso');
}

function cambiar(id, delta) {
  carrito[id] = (carrito[id] ?? 0) + delta;
  if (carrito[id] <= 0) delete carrito[id];
  guardar();
}

// ===== IMÁGENES =====

// Imágenes de producto (Unsplash / dominio público)
const IMAGENES = {
  sticker:   'https://images.unsplash.com/photo-1572375992501-4b0892d50c69?w=400&q=80',
  llavero:   'https://images.unsplash.com/photo-1611532736597-de2d4265fba3?w=400&q=80',
  taza:      'https://images.unsplash.com/photo-1533776992670-a72f4c28235e?q=80&w=400&auto=format&fit=crop',
  cable:     'https://images.unsplash.com/photo-1583863788434-e58a36330cf0?w=400&q=80',
  mouse:     'https://images.unsplash.com/photo-1527864550417-7fd91fc51a46?w=400&q=80',
  teclado:   'https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=400&q=80',
  audifonos: 'https://images.unsplash.com/photo-1628329567705-f8f7150c3cff?q=80&w=400&auto=format&fit=crop',
  laptop:    'https://images.unsplash.com/photo-1636211993589-6daf32038bd1?q=80&w=400&auto=format&fit=crop',
};
const imagen = (id, ancho) => (IMAGENES[id] ?? 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&q=80').replace('w=400', `w=${ancho}`);

// Si una imagen no carga (p. ej. sin internet), se quita y queda el nombre como fondo
const SIN_IMAGEN = "this.onerror = null; this.parentElement.classList.add('sin-imagen'); this.remove()";

// ===== CATEGORÍAS Y ORDEN =====

const CATEGORIAS = [
  { id: 'todo',       nombre: 'Todo',        incluye: () => true },
  { id: 'audio',      nombre: 'Audio',       incluye: (p) => ['audifonos'].includes(p.id) },
  { id: 'computo',    nombre: 'Cómputo',     incluye: (p) => ['laptop', 'teclado', 'mouse', 'cable'].includes(p.id) },
  { id: 'escritorio', nombre: 'Escritorio',  incluye: (p) => ['taza', 'teclado', 'mouse', 'llavero'].includes(p.id) },
  { id: 'regalos',    nombre: 'Regalos',     incluye: (p) => p.precio <= 200 },
];

// Orden curado para "Destacados"
const CURADO = ['audifonos', 'taza', 'mouse', 'llavero', 'laptop', 'teclado', 'cable', 'sticker'];

const ORDENES = [
  { nombre: 'Destacados', ordenar: (a, b) => CURADO.indexOf(a.id) - CURADO.indexOf(b.id) },
  { nombre: 'Precio ↑',   ordenar: (a, b) => a.precio - b.precio },
  { nombre: 'Precio ↓',   ordenar: (a, b) => b.precio - a.precio },
];

const estado = { categoria: 'todo', orden: 0, busqueda: '', destacado: null };

const normalizar = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function visibles() {
  const cat = CATEGORIAS.find((c) => c.id === estado.categoria);
  const q = normalizar(estado.busqueda.trim());
  return PRODUCTOS
    .filter((p) => cat.incluye(p) && normalizar(p.nombre).includes(q))
    .sort(ORDENES[estado.orden].ordenar);
}

function renderPestanas() {
  document.getElementById('pestanas').innerHTML = CATEGORIAS.map((c) => `
    <button class="pestana ${c.id === estado.categoria ? 'activa' : ''}" role="tab"
            aria-selected="${c.id === estado.categoria}" onclick="elegirCategoria('${c.id}')">${c.nombre}</button>`).join('');
}

function elegirCategoria(id) {
  estado.categoria = id;
  estado.destacado = null;
  renderPestanas();
  renderCatalogo();
}

function cambiarOrden() {
  estado.orden = (estado.orden + 1) % ORDENES.length;
  estado.destacado = null;
  document.getElementById('orden-texto').textContent = ORDENES[estado.orden].nombre;
  renderCatalogo();
}

function destacar(id) {
  if (estado.destacado === id) return;
  estado.destacado = id;
  renderCatalogo();
  document.getElementById('catalogo').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ===== MOSAICO =====
// Patrón: 1 pieza grande (2 filas), 3 chicas, 2 medianas; después izquierda + mediana.
const FORMAS = ['grande', 'chica', 'chica', 'chica', 'mediana', 'mediana'];
const forma = (i) => FORMAS[i] ?? (i % 2 === 0 ? 'izquierda' : 'mediana');

const flecha = '<svg class="flecha" viewBox="0 0 20 20" aria-hidden="true"><path d="M6 14 14 6M7 6h7v7" /></svg>';

function controlGrande(p) {
  const n = carrito[p.id] ?? 0;
  if (!n) {
    return `<div class="control">
        <button class="control-principal" data-add="${p.id}" onclick="agregar('${p.id}')">Agregar ${flecha}</button>
        <span class="control-precio">${fmt(p.precio)}</span>
      </div>`;
  }
  return `<div class="control">
      <button class="control-principal" onclick="abrirCarrito()">En carrito ${flecha}</button>
      <div class="control-cantidad">
        <button onclick="cambiar('${p.id}', -1)" aria-label="Quitar uno">−</button>
        <span>${n}</span>
        <button data-add="${p.id}" onclick="agregar('${p.id}')" aria-label="Agregar uno">+</button>
      </div>
    </div>`;
}

function pieza(p, i) {
  const f = forma(i);
  const grande = f === 'grande';
  return `
    <article class="producto forma-${f}" data-id="${p.id}" style="--i: ${i}"
             ${grande ? '' : `onclick="if (!event.target.closest('button')) destacar('${p.id}')"`}>
      <div class="producto-img" data-nombre="${p.nombre}">
        <img src="${imagen(p.id, grande ? 1200 : 600)}" alt="${p.nombre}" loading="lazy" onerror="${SIN_IMAGEN}" />
      </div>
      <div class="etiqueta">
        <h3>${p.nombre}</h3>
        <p class="precio">${fmt(p.precio)}</p>
      </div>
      ${grande
        ? `<div class="control-slot" data-control="${p.id}">${controlGrande(p)}</div>`
        : `<span class="en-carrito" data-badge="${p.id}"></span>
           <button class="mas" data-add="${p.id}" onclick="agregar('${p.id}')" aria-label="Agregar ${p.nombre}">+</button>`}
    </article>`;
}

function renderCatalogo() {
  let lista = visibles();
  // La pieza elegida pasa al lugar grande
  if (estado.destacado && lista.some((p) => p.id === estado.destacado)) {
    lista = [producto(estado.destacado), ...lista.filter((p) => p.id !== estado.destacado)];
  }

  document.getElementById('coleccion-cuenta').textContent = lista.length;
  document.getElementById('sin-resultados').classList.toggle('hidden', lista.length > 0);

  const nota = lista.length >= 4 ? `
    <aside class="nota forma-mediana" style="--i: ${lista.length}">
      <p class="nota-sup">Amason × Banco BBUA</p>
      <p class="nota-texto">Envío gratis desde $999.<br />Cada pago protegido contra fraude.</p>
    </aside>` : '';

  document.getElementById('catalogo').innerHTML = lista.map(pieza).join('') + nota;
  renderEnCarrito();
}

// Actualiza sólo las marcas de "en carrito" y el control grande, sin redibujar el mosaico
function renderEnCarrito() {
  document.querySelectorAll('[data-badge]').forEach((el) => {
    const n = carrito[el.dataset.badge] ?? 0;
    el.textContent = n ? `${n} en carrito` : '';
  });
  document.querySelectorAll('[data-control]').forEach((el) => {
    const p = producto(el.dataset.control);
    if (p) el.innerHTML = controlGrande(p);
  });
}

// ===== CARRITO (cajón) =====

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
            <div class="ci-foto" data-nombre="${p.nombre}"><img src="${imagen(id, 200)}" alt="" onerror="${SIN_IMAGEN}" /></div>
            <div class="ci-info">
              <div>${p.nombre}</div>
              <small>${fmt(p.precio)}</small>
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

function abrirCarrito() { document.getElementById('carrito').classList.remove('hidden'); }
function cerrarCarrito() { document.getElementById('carrito').classList.add('hidden'); }

// ===== PAGO =====

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

// ===== PEGAR DATOS DE TARJETA =====
// Reconoce el texto que copia el botón de la tarjeta en Banco BBUA
// (Titular / Número / Vence / CVV) y llena los cuatro campos de una vez.

function leerDatosTarjeta(texto) {
  const numero = texto.match(/\b(?:\d[ -]?){13,19}\b/)?.[0].replace(/\D/g, '');
  const exp = texto.match(/\b(0[1-9]|1[0-2])\s*\/\s*(\d{2})\b/);
  const cvv = texto.match(/cvv\D{0,3}(\d{3,4})/i)?.[1];
  const titular = texto.match(/titular\s*:\s*(.+)/i)?.[1].trim();
  if (!numero || !exp || !cvv) return null;
  return { numero, exp: `${exp[1]}/${exp[2]}`, cvv, titular };
}

function llenarTarjeta(d) {
  const poner = (id, valor) => {
    const campo = document.getElementById(id);
    campo.value = valor;
    campo.dispatchEvent(new Event('input')); // aplica el formato de cada campo
  };
  if (d.titular) poner('pago-titular', d.titular);
  poner('pago-numero', d.numero);
  poner('pago-exp', d.exp);
  poner('pago-cvv', d.cvv);
}

function avisoPegado(texto, error = false) {
  const aviso = document.getElementById('pago-error');
  aviso.textContent = texto;
  aviso.classList.toggle('aviso-ok', !error);
  aviso.classList.remove('hidden');
}

// Ctrl+V en cualquier campo del formulario
document.getElementById('form-pago').addEventListener('paste', (e) => {
  const datos = leerDatosTarjeta(e.clipboardData?.getData('text') ?? '');
  if (!datos) return; // pegado normal
  e.preventDefault();
  llenarTarjeta(datos);
  avisoPegado('Datos de la tarjeta pegados.');
});

// Botón "Pegar datos de tarjeta"
async function pegarTarjeta() {
  try {
    const datos = leerDatosTarjeta(await navigator.clipboard.readText());
    if (!datos) return avisoPegado('No hay datos de tarjeta copiados. Cópialos desde Banco BBUA.', true);
    llenarTarjeta(datos);
    avisoPegado('Datos de la tarjeta pegados.');
  } catch {
    avisoPegado('El navegador no dio acceso al portapapeles. Haz clic en un campo y presiona Ctrl+V.', true);
  }
}

// Se envía a la pasarela de Banco BBUA
document.getElementById('form-pago').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('btn-pagar');
  const err = document.getElementById('pago-error');
  const monto = total();

  btn.disabled = true;
  btn.textContent = 'Procesando…';
  err.classList.add('hidden');
  err.classList.remove('aviso-ok');

  try {
    const res = await fetch('/api/tienda/compra', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: carrito,
        tarjeta: {
          numero: document.getElementById('pago-numero').value,
          exp: document.getElementById('pago-exp').value,
          cvv: document.getElementById('pago-cvv').value,
          titular: document.getElementById('pago-titular').value,
        },
      }),
    });
    const r = await res.json();

    if (r.aprobado) {
      carrito = {};
      guardar();
      e.target.reset();
      cerrarPago();
      document.getElementById('res-auth').textContent = r.autorizacion;
      document.getElementById('res-monto').textContent = fmt(r.monto ?? monto);
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

document.getElementById('buscar').addEventListener('input', (e) => {
  estado.busqueda = e.target.value;
  estado.destacado = null;
  renderCatalogo();
});

fetch('/api/tienda/productos')
  .then((r) => r.json())
  .then((productos) => {
    PRODUCTOS = productos;
    // Quitar del carrito guardado productos que ya no existan
    for (const id of Object.keys(carrito)) if (!producto(id)) delete carrito[id];
    renderPestanas();
    renderCatalogo();
    renderCarrito();
  });
