# Detector de patrones de fraude (card testing)

Proyecto de Teoría de la Computación — Ernesto Gabriel Flores de la Rosa y Alan Seth Manjarrez Gomez Llanos.

Un **Autómata Finito Determinista** lee la secuencia de cargos de cada tarjeta y reconoce el patrón de *card testing*: varios cargos pequeños o intentos fallidos seguidos, y después un cargo grande. Cuando llega a un estado de aceptación, el banco alerta al cliente o bloquea la tarjeta.

## Cómo correrlo

Requiere Node 20 o más reciente. No hay dependencias que instalar.

```bash
npm start            # levanta el banco y la tienda en http://localhost:3000
npm run ataque       # en otra terminal: alguien con los datos de la tarjeta de Carlos la prueba en TechoStore
npm run pruebas      # corre cadenas de prueba por el AFD e imprime la traza
npm run pruebas -- rrppg pptpp   # evalúa cadenas propias
```

- Banco: http://localhost:3000/banco/ (usuarios `carlos / 1234` y `ana / 4321`)
- Tienda: http://localhost:3000/tienda/ (paga con los datos de la tarjeta que ves en el banco al darle al ojo)
- Definición del AFD en JSON: http://localhost:3000/api/afd

Para la demo: abre el banco como `carlos` y corre `npm run ataque`. El script simula a alguien que ya tiene el número, vencimiento y CVV de la tarjeta y automatiza compras baratas en TechoStore para comprobar que funciona, y luego una compra cara. Con `--tarjeta`, `--exp` y `--cvv` se puede apuntar a otra tarjeta (por ejemplo la de Ana: `npm run ataque -- --tarjeta 4521991033451230 --exp 03/28 --cvv 952`). La app se ve como un banco normal: el AFD trabaja por detrás, y el cliente sólo ve la alerta "¿fuiste tú?" cuando el autómata llega a q3, y el cargo grande rechazado con la tarjeta bloqueada cuando llega a q4. Para mostrar el autómata en sí, usa `npm run pruebas` o `/api/afd`. Los datos viven en memoria; para empezar de cero, reinicia el servidor.

## El autómata

M = (Q, Σ, δ, q0, F)

**Σ** — cada intento de cargo se traduce a un símbolo:

| Símbolo | Significado |
|---|---|
| `p` | Cargo pequeño (≤ $50) con datos correctos |
| `r` | Intento rechazado por datos incorrectos (CVV o vencimiento) |
| `n` | Cargo normal (entre $50 y $1,000) |
| `g` | Cargo grande (≥ $1,000) |
| `t` | Pausa: más de 10 min desde el intento anterior (se emite antes del símbolo del cargo) |

**Q** = {q0 Normal, q1 1 prueba, q2 2 pruebas, q3 Tarjeta siendo probada, q4 Fraude}

**F** = {q3, q4}. Al entrar a q3 se alerta al cliente ("¿fuiste tú?"). Si el siguiente paso llevaría a q4, el banco rechaza ese cargo y bloquea la tarjeta.

**δ**

|      | p  | r  | n  | g  | t  |
|------|----|----|----|----|----|
| →q0  | q1 | q1 | q0 | q0 | q0 |
| q1   | q2 | q2 | q0 | q0 | q0 |
| q2   | q3 | q3 | q0 | q0 | q0 |
| *q3  | q3 | q3 | q3 | q4 | q0 |
| *q4  | q4 | q4 | q4 | q4 | q4 |

Los umbrales están en `server/afd.js`.

## Estructura

```
server/afd.js            el AFD: Σ, Q, δ, F y la traducción de cargos a símbolos
server/pagos.js          pasarela de pagos: alimenta el AFD y decide aprobar, alertar o bloquear
server/server.js         API y archivos estáticos (sólo módulos nativos de Node)
public/banco/            app del cliente, con alertas en tiempo real (SSE)
public/tienda/           tienda con carrito y pago con tarjeta
server/tienda.js         catálogo de TechoStore y cobro (calcula el total en el servidor)
scripts/card-tester.js   simulador del ataque: compras automatizadas en TechoStore (sólo servidor local)
scripts/probar-afd.js    pruebas del autómata para el reporte
```
