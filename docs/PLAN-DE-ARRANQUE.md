# Plan de arranque a producción — CONTROL v2

> **Acordado con Daniel el 24-ago-2026, de madrugada.** Nació de su decisión: *"Ya quiero lanzar la
> primera versión de producción. **En dos días**"* — y de la respuesta honesta a su repregunta
> (*"¿crees que estamos listos en dos días, o necesitamos más tiempo?"*), que fue: **el software sí; el
> arranque completo no, y las razones no son de código.** Daniel: *"Ok. Vamos a hacerlo bien."*
>
> Este documento manda sobre el orden de trabajo hasta el arranque. El estado vivo sigue en
> `HOJA-DE-RUTA.md`; las decisiones de negocio, en `Documentacion_MJD/DECISIONES.md`.

---

## La decisión que ordena todo: se DIVIDE, no se pospone

⭐ **Arranque escalonado.** No se retrasa la fecha: se **acota el alcance del primer día**.

- **Arrancan** desarrollo, compras, inventarios y producción.
- **Con TRES usuarios** —Daniel y dos que aguanten un tropiezo—, no con los 23.
- **Finanzas NO entra** en el primer arranque.

⚖️ **Por qué, y es la razón de fondo del plan:** *con tres usuarios un tropiezo es una llamada; con
veintitrés es una crisis.* Llevaba meses de construcción y Daniel tiene razón en que *"ya se fue mucho
tiempo"* — pero **arrancar con todos de golpe, sin ensayo y sin respaldo probado, es cómo un sistema
bueno se gana mala fama en su primera semana**, y esa fama cuesta más que dos semanas de retraso.

---

## Calendario

### 🌙 Lunes 24 (madrugada) — el lead
- Cerrar **V1-E4e** (el impreso, 0.021).
- **V1-E4d/e-bis**: fecha de entrega **obligatoria** + alta de dirección **en el desplegable**
  (§Post-F9.103/.104).
- **Días de crédito** (§Post-F9.98) + **retirar el factor de conversión** (§Post-F9.97).
  🔴 Va temprano porque **hoy el aging de CxC es FALSO**, y eso no puede salir a producción.
- Arrancar **V1-E6**.

### 📅 Martes 25 — el lead
**Los seis bloqueantes de arranque:**
1. **Permisos a los 18 roles funcionales de RC** — hoy nacen **sin uno solo**: quien reciba únicamente
   ese rol entra y **no ve nada**.
2. **Guard anti-lockout de usuarios** — existe para roles, **no para usuarios**. Con 23 creándose a
   mano, desactivar al último admin **deja el sistema sin llave**.
3. **Cambio de contraseña de auto-servicio** (hoy sólo el admin puede cambiarlas).
4. **Los 10 catálogos de uso general** — hoy **clientes y proveedores, con sus condiciones, los ve
   cualquiera** que entre. Decisión de Daniel: *leer libre, editar con permiso*; se resuelve **parejo en
   los diez o no se resuelve**.
5. **Cabeceras de seguridad en nginx** (HSTS, CSP, X-Frame-Options, nosniff, Referrer-Policy).
6. ⭐ **Migrar los 23 usuarios reales con sus roles** — *es una fase entera (F10) que quedó pendiente*, y
   lo más largo del día. Sin ella, el día del arranque **sólo puede entrar Daniel**.

### 📅 Martes 25 — Gabriel, EN PARALELO
- 🔴 **RESTAURAR UN RESPALDO Y COMPROBAR QUE SIRVE.** Nunca se ha hecho. *Un respaldo que nunca se
  restauró es una hipótesis, no una red.* **Si esto falla, el arranque se pospone. No se discute.**
- Correr `reparar-secuencias` y el **salto de folios de OC** (⚠️ irreversible; el número lo da Daniel).

### 📅 Miércoles 26 — EL ENSAYO, con Daniel (medio día)
Recorrer la cadena completa con **una orden real**: pedido → orden → receta liberada → explosión →
compra → recepción → corte → maquila → recibo → entrega → costos.

🔴 **No es una demostración: es una cacería.** Lo que salga se arregla **el mismo día**.

⚖️ **Por qué este día existe, con evidencia:** el 23-ago, en **un solo día de uso casual**, Daniel
encontró **seis defectos reales** —los avisos amarillos, el color escondido, el impreso partido, la
fecha que faltaba, la dirección, el botón—. **Ese ritmo no ha bajado.** Es mejor que los encuentre él en
un ensayo que sus usuarios en su primer día.

### 📅 Jueves 27 — ARRANQUE
Operación real con **tres usuarios**, sin finanzas.

### 📅 Después
- **Los 23 usuarios**, cuando la primera semana esté limpia.
- **Finanzas**, cuando llegue el corte de SINUBE. ⚠️ **Precondición innegociable:** el ETL de apertura
  **no se corre hasta que `clientes.dias_credito` esté capturado** — si no, produce la misma cartera
  falsa que el defecto que se acaba de arreglar, *sólo que con el código sano y sin nada a qué culpar*.

---

## Riesgos, y qué se hace con cada uno

| Riesgo | Respuesta |
|---|---|
| **El ensayo encuentra mucho** | **Es lo más probable.** Por eso el arranque es el jueves y no el miércoles: el colchón ya está en el plan |
| **El respaldo no restaura** | 🔴 **Se pospone el arranque.** Sin red no se arranca |
| **La migración de usuarios se complica** | Se arranca con **3 usuarios creados a mano**; los 23 entran después |
| **El corte de SINUBE no llega** | **No afecta**: finanzas ya está fuera de este arranque |

---

## Lo que se necesita de Daniel (corto, pero es camino crítico)

1. **El número del salto de folios** de OC — irreversible.
2. **Quiénes son los otros dos usuarios** del arranque.
3. **Apartar el miércoles en la mañana** para el ensayo.

---

## Lo que queda FUERA del primer arranque, y por qué

Son reales y están decididos, pero **no impiden operar**:

- **La medida del avío en la orden de compra** (§Post-F9.100) — sin ella una OC de cierres es
  impracticable, pero se puede capturar a mano mientras tanto.
- **«¿Con esto queda cubierto?»** (§Post-F9.99) — el faltante chico que persigue al comprador.
- **Los avíos por color** — etapa del tamaño de la de la tela; **espera decisión de Daniel**.
- Los **dos cabos del reviewer del PR #209** — van en la próxima etapa que toque `mrp.ts`.
- El **chip de procedencia del proveedor** (`'mas-barato'` hoy es invisible) y la etiqueta **«La de
  siempre»**, que se lee como una dirección más y no como un estado.
