# CONTROL v2 — Hoja de ruta (explicada para Gabriel)

> Documento vivo, en cristiano. Resume **dónde vamos, cómo funciona el trabajo, qué pasa en cada fase/tarea y cuánto puede tardar**. La versión técnica y "ley" del proyecto es `PLANMAESTRO.md`; esto es el mapa simple. — *Actualizado: 11-jun-2026.*

---

## 1. En una frase

Ya entendimos el sistema viejo, diseñamos el nuevo, y **terminamos de construir la fundación (F0)**: la app ya corre de punta a punta (login real, menú por permisos, primer módulo funcionando). **Lo único que falta para verla en internet es tu alta manual de Railway + Cloudflare R2** (con la guía que te dejé). Después arranca **F1 (Catálogos + Modelos)**.

---

## 2. ¿Cuánto llevamos? (sin maquillaje)

Te doy **dos marcadores** y no los mezclo, para no engañarte:

**A) Entender el negocio + diseñar el sistema → ✅ 100 %**
La ingeniería inversa (292 formularios, 116 tablas), las decisiones del dueño y el plan maestro: terminado y validado por Daniel.

**B) Construir el software (las 9 fases F0–F8) → ~12–15 %**
**F0 (la fundación) está CONSTRUIDA** ✅ — falta solo que la despliegues en Railway. Siguen las 8 fases de módulos (F1–F8).

```
Entender + diseñar    : ██████████  100 %   ✅ hecho
Construir el software : █▓░░░░░░░░  ~12-15% (F0 ✅ construida; falta tu despliegue)
```

> **Por qué F0 vale más de lo que parece:** es la fundación sobre la que se monta TODO — login, seguridad por permisos, el motor de datos/inventario, el contrato del API, y el "molde" de pantalla (CRUD) que se replica en cada módulo. Lo más difícil de la plomería ya está. Las fases siguientes (F1–F7) son "rellenar" módulos sobre esa base usando el patrón ya hecho.
>
> Si juntas todo el esfuerzo (diseño + construcción), vamos por **un poco más de un tercio**.

---

## 3. Cómo funciona el trabajo (el "motor")

Cada pedazo de trabajo (una **tarea**) pasa siempre por el mismo circuito:

1. **Yo (orquestador)** parto el trabajo en tareas y escribo la especificación de cada una.
2. Un **coder** (agente) la construye. (Cuando hace falta investigar algo —p.ej. la doc de Railway— sumo un **researcher**.)
3. Un **reviewer** (agente independiente, que no vio cómo lo hizo el coder) la revisa: corre las pruebas, **levanta el sistema** y busca errores. **El reviewer tiene la última palabra**: si encuentra algo (por mínimo que sea), vuelve al coder y no se cierra hasta que quede limpio.
4. **Yo verifico** y te lo muestro funcionando.
5. **Tú verificas** (en el navegador o con `docker compose up`) y das el visto bueno.
6. Recién entonces se integra (rama de tarea → `prueba` → `main`).

**Reglas de oro:** nada avanza con algo en rojo; **"todo lo menor es mayor"** (ningún detalle se deja para después); cada agente es fresco por etapa.

| Quién | Hace qué |
|---|---|
| **Tú (Gabriel)** | Verificas cada etapa + los pasos manuales de infraestructura (Railway y Cloudflare R2). |
| **Yo (lead)** | Coordino, decido arquitectura, reviso y te reporto. No escribo el código de producción. |
| **Agentes** | Construyen (coder), investigan (researcher) y se revisan entre ellos (reviewer). |

---

## 4. Las 9 fases — qué recibes en cada una

| Fase | En cristiano, qué te entrega | Tamaño | Estado |
|---|---|---|---|
| **F0 · Fundación** | El esqueleto funcionando: login, usuarios/permisos, el "molde" de pantallas, todo dockerizado y desplegable. Un primer CRUD (Almacenes) que fija el estándar. | Grande | ✅ **construida** (falta tu despliegue) |
| **F1 · Catálogos + Modelos** | Las "listas maestras" (clientes, telas, avíos, colores, tallas…) y el catálogo de modelos con su **receta** + fotos. | Grande | ⬜ **sigue** |
| **F2 · Pedidos + Órdenes** | Capturar pedidos y convertirlos en **órdenes de producción** con su matriz color × talla. | Mediano | ⬜ |
| **F3 · Producción / WIP** | El corazón operativo: corte, mandar/recibir **maquila**, avance por etapas, y la **captura única** que actualiza inventario + cuenta del maquilero a la vez. | Muy grande | ⬜ |
| **F4 · Compras / Materiales** | Qué materiales faltan por orden, **órdenes de compra** con autorización, recepción, y el tablero "qué tengo / qué falta". | Grande | ⬜ |
| **F5 · Ruta Crítica** ⭐ | El módulo estrella: flujo de trabajo con **fechas que se calculan solas**, semáforos y bandeja de tareas por persona. | Muy grande | ⬜ |
| **F6 · Calidad + EsMa** | Auditorías de calidad (AQL) y el **estado de cuenta** completo de los maquileros. | Mediano | ⬜ |
| **F7 · Costos / EDR + Indicadores** | El **costeo**, el estado de resultados automático y los **tableros de KPIs**. | Grande | ⬜ |
| **F8 · Migración + Go-live** | Pasar **10+ años** de datos reales, correr v1 y v2 **en paralelo** unas semanas hasta que cuadren, y **encender** el sistema nuevo. | Grande | ⬜ |

> Se construyen **en orden** porque cada fase se apoya en la anterior.

---

## 5. F0 por dentro — las 5 etapas (TODAS terminadas ✅)

| Etapa | Qué hace | Estado |
|---|---|---|
| **E1 · Esqueleto dockerizado** | Backend + frontend + base de datos levantando con un comando. | ✅ en main |
| **E1.1 · Tema claro/oscuro** | Tu pedido: arranca en claro, botón arriba para cambiar, se recuerda. | ✅ en main |
| **E2 · Datos + lógica** | Modelo de datos (Prisma, 14 tablas) + motores comunes (folios, inventario, auditoría, permisos) + seed real de FR Moda. **114 pruebas.** | ✅ en main |
| **E3 · API + login real** | Rutas del backend + "menú" **OpenAPI** + **login real** con bloqueo a 5 intentos + permisos en el servidor. **+35 pruebas (149 en total en el backend).** | ✅ en main |
| **E4 · Frontend de verdad** | Login + molde de pantallas responsive (13 módulos por permisos) + **CRUD completo de Almacenes** (con reactivar) + diseño (Tailwind/shadcn) + tu tema. **38 pruebas** (incl. navegador). | ✅ en main |
| **E5 · Infra + cierre** | Pruebas automáticas (CI), config de Railway, la **guía de despliegue**, ADRs, y limpieza (se borró la cantera `control-v2/`). | ✅ en main |
| **Cierre F0** | Todo verde con `docker compose up`. **Pendiente: TÚ despliegas en Railway** con la guía. | 🔜 **tu turno** |

Hoy mismo puedes correr todo en tu PC con `docker compose up` y usar la app en `http://localhost:8080`.

---

## 6. ¿Cuánto tarda? (estimación gruesa — con su asterisco)

El equipo de agentes comprime en **horas** lo que a una persona le tomaría **semanas**. Pero el **calendario real** lo manda otra cosa: **tus verificaciones**, los **pasos manuales de infra**, y al final el **periodo de paralelo obligatorio**.

| Tramo | Trabajo de agentes | Calendario realista\* |
|---|---|---|
| **Desplegar F0 en Railway** (tu parte) | — | unas **horas** siguiendo la guía (te acompaño) |
| **Cada fase de módulos** (F1–F7) | ~1–3 jornadas c/u | según tus verificaciones; varias semanas en total |
| **F8 Migración + go-live** | la migración: jornadas | **+2–4 semanas fijas** de v1 y v2 en paralelo |

\* Si te tardas en verificar o la infra da lata, se estira.

**Las 2–4 semanas de paralelo NO se aceleran**: es el seguro de que inventarios y cuentas cuadran **antes** de apagar el viejo. Es a propósito.

**Traducción honesta:** el **sistema completo hasta encenderlo en producción** es del orden de **unos pocos meses**, mandado sobre todo por las fases pesadas (**F3** producción y **F5** ruta crítica) y por las semanas de paralelo del final.

---

## 7. Lo que sigue, ya mismo

1. **Cierro E5** (review + mi verificación) — es la última etapa de F0.
2. **Tú das de alta Railway + Cloudflare R2** siguiendo `docs/GUIA-RAILWAY-R2.md` (te acompaño en vivo). Ahí CONTROL v2 queda **en internet** (ambiente de prueba y producción).
3. Arrancamos **F1 (Catálogos + Modelos)** — y aquí ya puedo **paralelizar varios coders** porque los catálogos son módulos independientes.

---

## 8. Lo que necesito de ti

- **Verificar cada etapa** — 5 minutos en el navegador o con `docker compose up`.
- **AHORA, al cerrar F0:** dar de alta **Railway** (3 servicios: frontend público, backend y Postgres privados) y **Cloudflare R2** (archivos), con la guía paso a paso. Te acompaño en vivo; es tu mayor "trabajo manual" del proyecto.
- Más adelante, si surge una duda **nueva** de negocio, la validamos. El negocio base ya está validado por Daniel.

---

*¿Algo de esto lo quieres más detallado o con otro nivel de zoom? Dímelo — este documento es vivo.*
