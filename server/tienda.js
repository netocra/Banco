// ===== TECHOSTORE: catálogo y cobro =====
// La tienda calcula el total con sus propios precios y cobra a través de la pasarela del banco.
import { procesarPago } from './pagos.js';

export const COMERCIO = 'Amason';
export const MAX_POR_PRODUCTO = 99;

export const PRODUCTOS = [
  { id: 'sticker',   nombre: 'Sticker holográfico',     precio: 25 },
  { id: 'llavero',   nombre: 'Llavero de acrílico',     precio: 45 },
  { id: 'taza',      nombre: 'Taza para programadores', precio: 189 },
  { id: 'cable',     nombre: 'Cable USB-C trenzado',    precio: 149 },
  { id: 'mouse',     nombre: 'Mouse inalámbrico',       precio: 399 },
  { id: 'teclado',   nombre: 'Teclado mecánico',        precio: 1299 },
  { id: 'audifonos', nombre: 'Audífonos Bluetooth',     precio: 899 },
  { id: 'laptop',    nombre: 'Laptop 14" Ryzen 7',      precio: 15999 },
];

// items: { idProducto: cantidad }
export function comprar({ items, tarjeta } = {}) {
  const carrito = items && typeof items === 'object' && !Array.isArray(items) ? items : {};
  const lineas = Object.entries(carrito)
    .map(([id, cantidad]) => ({ producto: PRODUCTOS.find((p) => p.id === id), cantidad: Math.floor(Number(cantidad)) }))
    .filter((l) => l.producto && l.cantidad > 0);

  if (!lineas.length) return { aprobado: false, motivo: 'El carrito está vacío' };
  if (lineas.some((l) => l.cantidad > MAX_POR_PRODUCTO)) {
    return { aprobado: false, motivo: `Cantidad no permitida (máximo ${MAX_POR_PRODUCTO} por producto)` };
  }

  const monto = lineas.reduce((s, l) => s + l.producto.precio * l.cantidad, 0);
  const unidades = lineas.reduce((s, l) => s + l.cantidad, 0);
  const concepto = lineas.length === 1 && unidades === 1 ? lineas[0].producto.nombre : `${unidades} artículos`;

  const datosTarjeta = tarjeta && typeof tarjeta === 'object' ? tarjeta : {};
  return procesarPago({ ...datosTarjeta, monto, comercio: COMERCIO, concepto });
}
