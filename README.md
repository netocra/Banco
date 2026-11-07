# Detector de patrones de fraude (card testing)

Proyecto de Teoría de la Computación — Ernesto Gabriel Flores de la Rosa y Alan Seth Manjarrez Gomez Llanos.

Un **Autómata Finito Determinista** lee la secuencia de cargos de cada tarjeta y reconoce dos formas de probar una tarjeta robada: una **ráfaga** de intentos en poco tiempo (velocidad), o un **sondeo de saldo** (varios intentos rechazados, por ejemplo montos grandes que van bajando), seguidos de un cargo fuera del perfil del cliente. Como en los sistemas antifraude de los bancos, ningún cargo se juzga aislado: lo que importa es la secuencia. Cuando llega a un estado de aceptación, el banco alerta al cliente o bloquea la tarjeta.

## Cómo correrlo

Requiere Node 20 o más reciente. La app no tiene dependencias; `npm install` sólo hace falta para las pruebas de navegador.

```bash
npm start            # levanta el banco y la tienda en http://localhost:3000
npm run ataque       # en otra terminal: alguien con los datos de la tarjeta de Carlos la prueba en TechoStore
npm run ataque -- --modo saldo   # mismo caso, pero con compras grandes que van bajando hasta que una pase
npm run pruebas      # corre cadenas de prueba por el AFD e imprime la traza
npm run pruebas -- cccg cctcc   # evalúa cadenas propias
npm test             # pipeline de pruebas: DEV → QA → UAT
```

## Pruebas

`npm test` corre tres etapas en orden; si una falla, las siguientes no se ejecutan.

| Etapa | Qué prueba | Comando |
|---|---|---|
| DEV | Unitarias: que δ sea total, alcanzabilidad, el lenguaje reconocido, límites de los umbrales, Luhn | `npm run test:dev` |
| QA | Integración contra el servidor real: sesiones, montos inválidos, transferencias, pasarela, ráfaga, sondeo de saldo, perfil del cliente, alertas, tienda, archivos estáticos, eventos en vivo, entradas maliciosas, concurrencia | `npm run test:qa` |
| UAT | Flujos completos en Chromium: login, operaciones, tienda, alertas en vivo, ataque, XSS, diseño en celular, sin internet | `npm run test:uat` |

La UAT necesita Chromium (`/usr/bin/chromium` o la ruta en `CHROMIUM_PATH`) y `npm install` para `playwright-core`. Se corre sin acceso a internet a propósito, para asegurar que la demo funcione sin red.

- Banco: http://localhost:3000/banco/ (usuarios `carlos / 1234` y `ana / 4321`)
- Tienda: http://localhost:3000/tienda/ (paga con los datos de la tarjeta que ves en el banco al darle al ojo)
- Definición del AFD en JSON: http://localhost:3000/api/afd

Para la demo: abre el banco como `carlos` y corre `npm run ataque`. El script simula a alguien que ya tiene el número, vencimiento y CVV de la tarjeta y automatiza compras baratas en TechoStore para comprobar que funciona, y luego una compra cara. Con `--tarjeta`, `--exp` y `--cvv` se puede apuntar a otra tarjeta (por ejemplo la de Ana: `npm run ataque -- --tarjeta 4521991033451230 --exp 03/28 --cvv 952`). La app se ve como un banco normal: el AFD trabaja por detrás, y el cliente sólo ve la alerta "¿fuiste tú?" cuando el autómata llega a q4 o q5, y el cargo grande rechazado con la tarjeta bloqueada cuando llega a q6. Para mostrar el autómata en sí, usa `npm run pruebas` o `/api/afd`. Los datos viven en memoria; para empezar de cero, reinicia el servidor.

## El autómata

M = (Q, Σ, δ, q0, F)

Antes de entrar al AFD, cada intento de cargo se traduce a un símbolo usando su contexto:

- **Tiempo desde el intento anterior.** Si pasaron más de 5 minutos, primero se emite `t`.
- **Perfil del cliente.** Un cargo es grande si es de al menos $1,000 o del triple de la compra promedio del cliente, lo que sea mayor. Carlos gasta en promedio ~$318, así que su umbral es $1,000; Ana gasta ~$555, así que el suyo es ~$1,664.

**Σ**

| Símbolo | Significado |
|---|---|
| `c` | Cargo dentro del perfil del cliente |
| `g` | Cargo grande: fuera del perfil del cliente |
| `r` | Intento rechazado: fondos insuficientes o datos incorrectos |
| `t` | Pausa: más de 5 min desde el intento anterior (se emite antes del símbolo del cargo) |

**Q**

| Estado | Significado |
|---|---|
| q0 | Sin actividad reciente |
| q1 | 1 intento |
| q2 | 2 intentos seguidos |
| q3 | Intento rechazado |
| q4 | Rechazos repetidos: posible sondeo de saldo |
| q5 | Ráfaga de intentos: tarjeta posiblemente probada |
| q6 | Fraude: cargo grande tras rechazos o ráfaga |

**F** = {q4, q5, q6}. Al entrar a q4 o q5 se alerta al cliente ("¿fuiste tú?") y el cargo sigue su curso normal. Si el siguiente paso llevaría a q6, el banco rechaza ese cargo y bloquea la tarjeta. Si el cliente responde "fui yo", el AFD vuelve a q0.

**δ**

|      | c  | g  | r  | t  |
|------|----|----|----|----|
| →q0  | q1 | q1 | q3 | q0 |
| q1   | q2 | q2 | q2 | q0 |
| q2   | q5 | q5 | q5 | q0 |
| q3   | q2 | q5 | q4 | q0 |
| *q4  | q4 | q6 | q4 | q0 |
| *q5  | q5 | q6 | q5 | q0 |
| *q6  | q6 | q6 | q6 | q6 |

Ejemplos:

| Cadena | Caso | Resultado |
|---|---|---|
| `c`, `ctctc`, `g` | Compras normales o una compra grande aislada | No se acepta |
| `rc` | Error al teclear el CVV y luego la compra correcta | No se acepta |
| `ccc` | Tres mouses en dos minutos | q5: alerta |
| `ccccg` | Ráfaga de compras baratas y una grande (`npm run ataque`) | q6: bloqueo |
| `rrg` | Laptop y 4 teclados rechazados por saldo, luego 2 teclados (`--modo saldo`) | q6: bloqueo |
| `rrrc` | Varios rechazos y luego un cargo dentro del perfil | q4: alerta |

Los umbrales están en `server/afd.js`.

## Estructura

```
server/afd.js            el AFD: Σ, Q, δ, F y la traducción de cargos a símbolos
server/pagos.js          pasarela de pagos: alimenta el AFD y decide aprobar, alertar o bloquear
server/server.js         API y archivos estáticos (sólo módulos nativos de Node)
server/dinero.js         validación de montos y redondeo a centavos
public/banco/            app del cliente, con alertas en tiempo real (SSE)
public/tienda/           tienda con carrito y pago con tarjeta
server/tienda.js         catálogo de TechoStore y cobro (calcula el total en el servidor)
scripts/card-tester.js   simulador del ataque: compras automatizadas en TechoStore (sólo servidor local)
scripts/probar-afd.js    pruebas del autómata para el reporte
scripts/pipeline.js      corre las etapas de prueba DEV → QA → UAT
test/dev, test/qa, test/uat   pruebas automatizadas por etapa
```
