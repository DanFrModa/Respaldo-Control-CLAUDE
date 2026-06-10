# CONTROL v2 — Hoja de ruta (explicada para Gabriel)

> Documento vivo, en cristiano. Resume **dónde vamos, cómo funciona el trabajo, qué pasa en cada fase/tarea y cuánto puede tardar**. La versión técnica y "ley" del proyecto es `PLANMAESTRO.md`; esto es el mapa simple. — *Actualizado: 10-jun-2026.*

---

## 1. En una frase

Ya **entendimos por completo el sistema viejo y diseñamos el nuevo** (eso está hecho y validado). **Ahora estamos construyendo la fundación (F0).** De aquí en adelante es ejecución por etapas, verificando contigo en cada una.

---

## 2. ¿Cuánto llevamos? (sin maquillaje)

Te doy **dos marcadores** y no los mezclo, para no engañarte:

**A) Entender el negocio + diseñar el sistema → ✅ 100 %**
La ingeniería inversa (292 formularios, 116 tablas), las decisiones del dueño y el plan maestro: terminado y validado por Daniel. *Esta es la parte más difícil de pensar de todo el proyecto, y ya está.*

**B) Construir el software (las 9 fases F0–F8) → ~5 %**
Apenas arrancamos. La fundación (F0) va al **~30 %**.

```
Entender + diseñar : ██████████  100 %   ✅ hecho
Construir el software : ▓░░░░░░░░░   ~5 %   🔨 (F0 al ~30%)
```

> **No te asustes con ese 5 %:** (1) lo más valioso y difícil —entender y diseñar— ya está; ahora es ejecutar. (2) Las fases no pesan igual. (3) Hay código **ya probado** del primer intento (`control-v2/`) que vamos a reaprovechar, y eso acelera las próximas etapas.
>
> Si quisieras **un solo número** para "todo el esfuerzo del proyecto" (diseño + construcción), estaríamos alrededor de **un tercio**; pero en términos de *software funcionando*, es ese ~5 %.

---

## 3. Cómo funciona el trabajo (el "motor")

Cada pedazo de trabajo (una **tarea**) pasa siempre por el mismo circuito:

1. **Yo (orquestador)** parto el trabajo en tareas y escribo la especificación de cada una.
2. Un **coder** (agente) la construye.
3. Un **reviewer** (agente independiente, que no vio cómo lo hizo el coder) la revisa: corre las pruebas, **levanta el sistema** y busca errores. Si algo no cumple, el coder corrige **antes** de avanzar.
4. **Yo verifico** y te lo muestro funcionando.
5. **Tú verificas** (en el navegador o con `docker compose up`) y das el visto bueno.
6. Recién entonces se integra (rama de tarea → `prueba` → `main`) y pasamos a lo siguiente.

**Regla de oro:** nada avanza con algo en rojo, y nada se hace "a la mala" para arreglarlo después.

| Quién | Hace qué |
|---|---|
| **Tú (Gabriel)** | Verificas cada etapa + los pasos manuales de infraestructura (alta de Railway y Cloudflare R2 cuando toque). |
| **Yo (lead)** | Coordino, decido arquitectura, reviso y te reporto. No escribo el código de producción. |
| **Agentes** | Construyen (coder) y se revisan entre ellos (reviewer). |

---

## 4. Las 9 fases — qué recibes en cada una

| Fase | En cristiano, qué te entrega | Tamaño | Estado |
|---|---|---|---|
| **F0 · Fundación** | El esqueleto funcionando: login, usuarios/permisos, el "molde" de pantallas, todo dockerizado y desplegable. Un primer CRUD (Almacenes) que fija el estándar. | Grande | 🔨 ~30 % |
| **F1 · Catálogos + Modelos** | Las "listas maestras" (clientes, telas, avíos, colores, tallas…) y el catálogo de modelos con su **receta** (de qué está hecho cada modelo) + fotos. | Grande | ⬜ |
| **F2 · Pedidos + Órdenes** | Capturar pedidos y convertirlos en **órdenes de producción** con su matriz color × talla. Impreso de la orden. | Mediano | ⬜ |
| **F3 · Producción / WIP** | El corazón operativo: corte, mandar/recibir **maquila**, avance por etapas, y la **captura única** que actualiza inventario + cuenta del maquilero a la vez. | Muy grande | ⬜ |
| **F4 · Compras / Materiales** | Qué materiales faltan por cada orden, **órdenes de compra** con autorización, recepción, y el tablero "qué tengo / qué me falta". | Grande | ⬜ |
| **F5 · Ruta Crítica** ⭐ | El módulo estrella: flujo de trabajo con **fechas que se calculan solas**, semáforos y bandeja de tareas por persona. | Muy grande | ⬜ |
| **F6 · Calidad + EsMa** | Auditorías de calidad (AQL) y el **estado de cuenta** completo de los maquileros. | Mediano | ⬜ |
| **F7 · Costos / EDR + Indicadores** | El **costeo**, el estado de resultados automático y los **tableros de KPIs**. | Grande | ⬜ |
| **F8 · Migración + Go-live** | Pasar **10+ años** de datos reales, correr v1 y v2 **en paralelo** unas semanas hasta que cuadren, y **encender** el sistema nuevo. | Grande | ⬜ |

> Se construyen **en orden** porque cada fase se apoya en la anterior (no se puede hacer producción sin catálogos, ni ruta crítica sin producción).

---

## 5. F0 por dentro — las 5 etapas (aquí estamos parados)

| Etapa | Qué hace | Estado |
|---|---|---|
| **E1 · Esqueleto dockerizado** | Backend + frontend + base de datos levantando con un comando; la página se ve en el navegador. | ✅ **listo** |
| **E1.1 · Tema claro/oscuro** | Tu pedido: arranca en claro, botón arriba para cambiar y se recuerda. (base de la apariencia) | 🔨 **ahora** |
| **E2 · Datos + lógica** | Mover lo probado de `control-v2/` al backend nuevo: el modelo de datos (Prisma) y los **motores comunes** (folios, inventario/kardex, auditoría, permisos, archivos) con sus **~90 pruebas** en verde. | ⬜ sigue |
| **E3 · API + login real** | Las rutas del backend con su "menú" **OpenAPI** + **login real** con bloqueo a los 5 intentos + permisos verificados en el servidor. | ⬜ |
| **E4 · Frontend de verdad** | Login + el **molde de pantallas** responsive (los 13 módulos, mostrados según permisos) + el **primer CRUD completo** (Almacenes) que fija el estándar para todo el sistema. Aquí entra el diseño cuidado (Tailwind/shadcn) **y tu tema claro/oscuro**. | ⬜ |
| **E5 · Infra + cierre** | Pruebas automáticas (CI), configuración de Railway, la **guía paso a paso** para que des de alta Railway + R2, ADRs, y limpiar la cantera `control-v2/`. | ⬜ |
| **Cierre F0** | Verificación integral + lo **despliegas en Railway** con mi guía. | ⬜ |

---

## 6. ¿Cuánto tarda? (estimación gruesa — con su asterisco)

El equipo de agentes comprime en **horas** lo que a una persona le tomaría **semanas**. Pero el **calendario real** no lo manda la velocidad de tecleo, sino tres cosas: **tus verificaciones**, los **pasos manuales de infra**, y al final el **periodo de paralelo obligatorio**. Por eso doy rangos.

| Tramo | Trabajo de agentes | Calendario realista\* |
|---|---|---|
| **Terminar F0** (E1.1 → E5) | unas pocas jornadas | **~1–2 semanas** (incluye que des de alta Railway + R2) |
| **Cada fase de módulos** (F1–F7) | ~1–3 jornadas c/u | según tus verificaciones; varias semanas en total |
| **F8 Migración + go-live** | la migración: jornadas | **+2–4 semanas fijas** de v1 y v2 en paralelo |

\* Asume que verificas con cierta prontitud y que Railway/R2 no se traban. Si te tardas en verificar o la infra da lata, se estira.

**Las 2–4 semanas de paralelo NO se aceleran**: es el seguro de que los inventarios y las cuentas cuadran **antes** de apagar el sistema viejo. Es a propósito.

**Traducción honesta:**
- La **fundación (F0)** puede estar lista en cosa de **1 a 2 semanas**.
- El **sistema completo hasta encenderlo en producción**: del orden de **unos pocos meses**, mandado sobre todo por las fases pesadas (**F3** producción y **F5** ruta crítica) y por las semanas de paralelo del final.

---

## 7. Lo que sigue, ya mismo

1. Termino **E1.1** (tu tema claro/oscuro) → reviewer → yo verifico → te muestro.
2. Con tu OK: **commit de E1** y arranco **E2** (datos + lógica desde la cantera `control-v2/`).
3. Te voy mostrando **cada etapa antes de seguir**, igual que hasta ahora.

---

## 8. Lo que necesito de ti

- **Verificar cada etapa** — 5 minutos en el navegador o con `docker compose up`.
- En el **cierre de F0**: dar de alta **Railway** (3 servicios: frontend, backend, Postgres) y **Cloudflare R2** (archivos), con la guía paso a paso que te dejaré. Te acompaño en vivo.
- Más adelante, si surge una duda **nueva** de negocio, la validamos. El negocio base ya está validado por Daniel: eso **no** se re-valida.

---

*¿Algo de esto lo quieres más detallado o con otro nivel de zoom? Dímelo y lo ajusto — este documento es vivo.*
