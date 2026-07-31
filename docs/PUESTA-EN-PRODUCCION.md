# CONTROL v2 — Puesta en producción (de `prueba` a real)

> Qué hay que hacer para usar el sistema "de verdad" una vez que sale de `prueba`, entra a `main` y se pone en el ambiente real. La **fase F10 (Migración + Go-live)** del plan es el hogar formal de esto; este documento es la checklist práctica + los hallazgos del pentest de seguridad (2026-07-07).

## 0. Antes de todo: ¿qué ambiente es "real"?
Hoy el deploy `frontend-eoge-production.up.railway.app` es el de **pruebas** (aunque la URL diga "production"). "Real" = el ambiente con datos y usuarios de FR Moda que la gente usará a diario. Define URL/servicio/base de datos separados de prueba (no reuses la BD de prueba).

## 1. SEGURIDAD — obligatorio antes de real (del pentest autorizado)
1. **Password del admin (CRÍTICO).** Hoy `admin` / `Control.2026!` (del seed) entra como admin — está en el código. Para real:
   - Cambiar el password del admin.
   - **No hornear el password en el seed**: que el bootstrap tome la clave de una **variable de entorno/secreto**, o **forzar el cambio en el primer login**.
   - Invalidar todas las sesiones activas tras el cambio.
   - Idealmente, desactivar/renombrar el `admin` genérico y usar cuentas nominales.
2. **Secretos frescos en real** (no reutilizar los de prueba):
   - `BETTER_AUTH_SECRET` (fuerte y único), `DATABASE_URL`, credenciales de **Cloudflare R2**. Si algún secreto estuvo en prueba, rótalo.
3. **Cabeceras de seguridad en el nginx del frontend** (`frontend/nginx.conf.template`): `Strict-Transport-Security` (HSTS), `Content-Security-Policy`, `X-Frame-Options: DENY` (o `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy`. (Hoy no las manda.)
4. **Rate limit de login**: en real usar un `AUTH_LOGIN_RATE_MAX` sensato (NO el 1000 que se usa para e2e/local; el default 20 está bien). Ya verificado que el limiter funciona (429 tras ~20 intentos).
5. **Registro público**: confirmar que el sign-up sigue cerrado en prod (hoy `sign-up/email` responde pero la creación falla; `sign-up/username` no existe → bien).
6. **`SEED_ON_START`**: sembrar (=`true`) SOLO cuando toque migrar permisos/roles nuevos; el seed NO debe recrear el admin default en prod con clave conocida (ver punto 1).

7. **Roles clericales sobre-privilegiados (RBAC, MEDIO).** El seed arma los roles de forma **sustractiva** partiendo de "Directivo = todo menos administrar-catálogos-maestros y costos". Al bajar a **Asistente (nivel 50)** y **Secretarial (60)** se recorta poco → heredan casi toda la **operación**: mover kardex (PT/telas/avíos), corte/envío/recibo, cancelar producción/compras, pedidos y notas. Radio de daño **acotado** (no borran BD ni modelos/clientes/usuarios, no escalan, los transaccionales son *append-only* D3 → reversibles/auditables), pero un empleado *phished* puede **desorganizar la operación**.
   - **Bug concreto a corregir:** `rc.catalogo-administrar` (crear/**borrar** procesos, plantillas y reglas de **Ruta Crítica**, el módulo más importante) **NO se resta** en `backend/prisma/seed.ts` (def. `directivo`), a diferencia de los otros catálogos (`tipos-proceso.administrar`, `calidad.administrar-catalogo`, `concepto-costo.administrar`, `estado-lista.administrar` sí se restan) → **cascadea hasta Asistente/Secretarial**. *Confirmado en vivo:* un Asistente hace `DELETE /api/rc/procesos/:id` y `/api/rc/plantillas/:id` (404 = autorizado). **Fix:** agregar `'rc.catalogo-administrar'` al `sin(...)` de `directivo` (queda solo en Administrador/AdministracionDireccion, que llevan `[...todos]`). Revisar de paso si Asistente/Secretarial deben mover inventario y cancelar producción o si eso amerita un rol operativo dedicado.

**Ya está BIEN (no tocar):** API auth-gated (401), OpenAPI no expuesto, sin fuga de `.env`/`.git`/source-maps/secretos en el bundle, CORS no permisivo, errores sin stack trace, cookie de sesión `__Secure-`/HttpOnly/Secure/SameSite=Lax, TRACE bloqueado, sin bypass por trucos de ruta. **RBAC vertical** deny-by-default (sin sesión→401, sin permiso→403; sin auto-escalada, sin IDOR, scoping por empresa A9 aplicado). **SQLi:** Prisma parametriza (payloads sin efecto). **XSS:** React auto-escapa, 0 `dangerouslySetInnerHTML`. **Logout invalida** la sesión server-side (401 al reusar) y los endpoints de auth que cambian estado exigen **Origin de confianza** (CSRF). Paginación **acotada** (un `limite` gigante no revienta).

## 2. DATOS — migración a real (F10)
1. **Correr los ETLs** de datos reales que quedaron pendientes/por-fase (desde `backend/`, siempre `npx tsx --env-file=.env migracion/<script>.ts`, NUNCA `npm run etl:*`):
   - Catálogos + modelos + BOM (F1), **fotos masivas** (pendiente: falta la carpeta física `S:\...\FotosMod`).
   - Pedidos/órdenes (F2), histórico de producción/IPT (F3-E6), compras/notas/telas (F4), Ruta Crítica (F5), etc.
   - **Usuarios reales (23)** + sus `UsuarioRol` (F5/F10) — hasta que existan, la RC no tiene responsables asignados.
2. **Migraciones Prisma aplicadas** (`migrate deploy` corre solo en el arranque del contenedor; verificar que todas quedaron).
3. **Cuadres** de cada ETL (los scripts de cuadre por fase) para validar que los totales coinciden con el sistema viejo.

## 3. RESPALDOS — antes de meter datos reales
- **Respaldo doble** (deuda del plan §2.2, mitigación #1 de riesgos, aún sin construir): job diario `pg_dump` cifrado subido a R2. **Montarlo antes del go-live** — hoy nadie tiene backups automáticos.

## 4. INFRAESTRUCTURA (Railway)
- 3 servicios: **frontend público**, **backend y Postgres privados** (red interna).
- Variables de entorno de prod: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`/orígenes de confianza, `AUTH_LOGIN_RATE_MAX`, `DB_WAIT_MAX_INTENTOS`/`DB_WAIT_ESPERA_SEG`, credenciales R2, `SEED_ON_START` (controlado).
- Dominio propio + TLS; health check (`/api/health` ya existe).
- Arranque resiliente a la BD ya está (reintentos de `migrate deploy`); no re-romperlo.

## 5. USUARIOS / RBAC en real
- Crear los usuarios reales con sus roles; asignar `UsuarioRol` (RC).
- **Quitar/inactivar** las cuentas de prueba (`admin` genérico, `prueba`).
- **Deuda conocida — anti-lockout de usuarios** (`backend/src/dominio/admin/usuarios.ts`): no hay guard que impida desactivar/quitar-roles al último admin → cuidar no dejar el sistema sin admin. Arreglar antes o operar con cuidado.

## 6. VERIFICACIÓN FUNCIONAL
- Recorrer los **criterios de salida de cada fase** (F0–F8) contra datos reales, no solo de prueba.
- Confirmar impresos PDF, subida/descarga de archivos a R2 (fotos, adjuntos de orden R6), y los flujos clave (pedido→orden→producción→compras→costos→lista de precios).

## 7. OPERACIÓN
- **Modo mantenimiento** (planeado para F10) para ventanas de carga/actualización.
- Monitoreo de logs (pino) y de los deploys de Railway.
- Plan de rollback (el flujo `prueba`→`main` da el punto de reversión por PR).

---
### Prioridad mínima innegociable para "usarlo en real"
1. Cambiar el password del admin + secretos frescos.  2. Respaldos automáticos montados.  3. Datos reales migrados y cuadrados.  4. Usuarios reales con roles; quitar cuentas de prueba.  5. Cabeceras de seguridad.
