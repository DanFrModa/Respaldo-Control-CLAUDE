# Guía: montar Railway + Cloudflare R2 para CONTROL v2

> **Para quién:** Gabriel (operación manual en los dashboards; nada de esto lo puede hacer
> un agente). **Tiempo estimado:** 60–75 min la primera vez (son **dos** servicios, no uno).
> Verificada contra la documentación oficial de Railway (config-as-code, variables, y la red
> privada — el sufijo `.railway.internal`) y Cloudflare R2 (tokens S3) en **junio 2026**; los
> nombres exactos de menús pueden variar con rediseños del dashboard — los pasos marcados con ⚠️
> incluyen qué confirmar en pantalla. **Excepción:** el **IP del resolver interno** `fd12::10`
> NO sale de la doc oficial de Railway (la doc de red privada no publica ningún resolver IP);
> es **dato de soporte/comunidad** — ver el detalle en §8.1.

## Qué vas a montar

La arquitectura es **dos servicios separados y dockerizados** (ADR-0001): solo el **frontend
es público**; el **backend y Postgres son privados** (red interna de Railway). El navegador
habla con el frontend (nginx), y el nginx reenvía `/api` al backend por la red privada.

```
Proyecto Railway "control-v2"
├── environment production  ← rama main
│   ├── servicio  backend    (Root Directory backend/,  PRIVADO  — sin dominio público)
│   ├── servicio  frontend   (Root Directory frontend/, PÚBLICO  — con dominio)
│   └── servicio  Postgres   (PRIVADO + respaldos)
└── environment prueba       ← rama prueba   ── copia de lo anterior (BD y buckets separados)

Cloudflare R2
├── bucket control-v2-prod
├── bucket control-v2-prueba
└── 1 API token S3 (Object Read & Write, SOLO esos buckets)
```

La configuración de build/deploy de cada servicio **ya está versionada** en
[`backend/railway.json`](../backend/railway.json) y
[`frontend/railway.json`](../frontend/railway.json): build por **Dockerfile**, healthcheck,
restart `ON_FAILURE`, y —en el backend— las **migraciones Prisma como `preDeployCommand`**
(`npx prisma migrate deploy`). Railway lee esos archivos del repo y **lo definido en código
manda sobre el dashboard** — no configures build/deploy a mano.

### El proxy `/api` del frontend se configura por variable (no se edita código)

El nginx del frontend reenvía `/api` a un upstream **configurable por variables de entorno**
(la imagen procesa la plantilla `nginx.conf.template` con envsubst al arrancar). El MISMO
artefacto Docker sirve en local y en Railway **sin tocar código**:

- **docker-compose (local):** no pones nada — usa los defaults (`BACKEND_UPSTREAM=backend:3000`
  y resolver autodetectado `127.0.0.11`).
- **Railway:** en el servicio **frontend** pones **dos** variables (paso 5):
  **`BACKEND_UPSTREAM=backend.railway.internal:3000`** (el host privado del backend) y
  **`DNS_RESOLVER=[fd12::10]`** (el resolver interno de Railway, IPv6 — dato de soporte/comunidad,
  no doc oficial; ver §8.1). Si falta `BACKEND_UPSTREAM`, el frontend servirá el SPA pero
  `/api/...` dará 502 (apuntaría al host de compose, que no existe en Railway). El checklist del
  §8 lo verifica en vivo.

> Detalle: el nombre del host privado es `<NOMBRE-DEL-SERVICIO>.railway.internal`. Si nombras
> el servicio backend exactamente **`backend`**, el host es `backend.railway.internal`. El
> backend ya escucha en `::` (dual-stack), requisito de la red privada de Railway, que es
> **IPv6**: el DNS interno resuelve a registros AAAA, así que un servicio que solo bindea a
> `0.0.0.0` (IPv4) da 502 — por eso el backend usa `::` (ADR-0001). El consejo genérico de
> Railway de "bind a `0.0.0.0`" aplica solo a apps **públicas**; para la red privada es `::`.
>
> El nginx del frontend re-resuelve el host del backend **en cada request** (usa el `resolver`
> de `DNS_RESOLVER` con TTL corto), así que aunque Railway le cambie la IP IPv6 al backend en
> cada redeploy, el proxy la sigue sin quedarse con una IP vieja. En local el resolver se
> autodetecta; en Railway pones `DNS_RESOLVER=[fd12::10]`. Más detalle y un riesgo conocido
> (nginx en red privada) en **§8.1**.

### Requisitos previos

- Cuenta de Railway con un plan de pago (Hobby alcanza para empezar) y acceso al repo de
  GitHub `DanFrModa/Respaldo-Control-CLAUDE`.
- Cuenta de Cloudflare (R2 pide activar el servicio; pide tarjeta aunque el uso inicial entre
  en la capa gratuita).
- Las ramas `main` y `prueba` existen en GitHub.
- Una terminal con `openssl` para generar secretos (en Windows: Git Bash sirve).

---

## 1. Crear el proyecto en Railway

1. En [railway.com](https://railway.com) → **New Project**.
2. Nómbralo `control-v2` (el nombre es libre; este es el que usaremos en la guía).
3. Quedas en el **canvas** del proyecto, en el environment por defecto (`production`).

## 2. Agregar Postgres y activar sus respaldos

1. En el canvas: **Create / + New** → **Database** → **Add PostgreSQL**.
   Railway crea el servicio `Postgres` con su volumen persistente y genera las variables
   (`DATABASE_URL`, `PGHOST`, `PGUSER`, …).
2. ⚠️ Verifica la versión: debe ser **Postgres 17** (la imagen oficial actual). Si el
   template ofreciera otra major, usa la 17 — el proyecto está probado contra 17.
3. **Backups (no lo dejes para después — plan §2, "respaldos automáticos desde el día 1"):**
   selecciona el servicio Postgres → pestaña **Backups** → habilita al menos **Daily**;
   activa también **Weekly** y **Monthly** si el plan lo permite (se combinan).
   - Restaurar (cuando haga falta): misma pestaña → **Restore** del respaldo deseado →
     Railway lo "stagea" como cambio → **Deploy** para aplicarlo. Ojo: restaurar elimina los
     respaldos más nuevos que el restaurado.
4. **NO actives el TCP proxy público de la BD** (Settings → Networking del servicio
   Postgres): la app le habla por la red privada interna. Sin proxy público no hay puerta
   expuesta a internet ni costo de egreso.

> El segundo respaldo (pg_dump diario cifrado hacia R2, plan §2/§11) es un job de la app
> (pg-boss) que se construye en una fase posterior — no es un paso de esta guía.

## 3. Crear el servicio BACKEND desde GitHub (privado)

1. En el canvas: **Create / + New** → **GitHub Repo** → autoriza Railway en GitHub si lo
   pide → elige `DanFrModa/Respaldo-Control-CLAUDE`, rama **`main`**.
2. ⚠️ **Nombra el servicio `backend`** (Settings → el nombre del servicio). El nombre se usa
   para el host privado `backend.railway.internal` que consume el frontend — si lo nombras
   distinto, ajusta también el target del nginx (ver el pendiente de código de arriba).
3. **Root Directory:** servicio backend → **Settings** → **Root Directory** = `backend`.
   Con esto Railway construye desde `backend/Dockerfile` y lee `backend/railway.json`.
   (El primer deploy antes de fijar el root puede fallar — es normal, el repo no tiene app en
   la raíz.)
4. Confirma que Railway detectó el **config as code**: en Settings/Deployments debe usar el
   **Dockerfile** (builder `DOCKERFILE`) y, en el deploy, correr el `preDeployCommand`
   (`npx prisma migrate deploy`) y el healthcheck `/api/health` — **no captures eso a mano**.
5. **NO le generes dominio público.** El backend vive en la red privada; solo el frontend lo
   alcanza por `backend.railway.internal`. (Settings → Networking: deja **sin** Public
   Networking; la red privada está activa por defecto entre servicios del mismo environment.)
6. Variables del backend → ve al **paso 5** (las define este servicio).

## 4. Crear el servicio FRONTEND desde GitHub (público)

1. En el canvas: **Create / + New** → **GitHub Repo** → mismo repo
   `DanFrModa/Respaldo-Control-CLAUDE`, rama **`main`**.
2. Nombra el servicio `frontend`.
3. **Root Directory:** Settings → **Root Directory** = `frontend`. Railway construye desde
   `frontend/Dockerfile` (nginx) y lee `frontend/railway.json` (healthcheck `/`).
4. **Dominio público:** servicio frontend → **Settings** → **Networking** → **Generate
   Domain**. Si pregunta el **target port**, usa **80** (el nginx del frontend escucha en
   80). Anota el dominio (`algo.up.railway.app`) — lo necesitas para `BETTER_AUTH_URL`.
5. **Variables del frontend** (pestaña **Variables** del servicio frontend):
   - **`BACKEND_UPSTREAM`** = **`backend.railway.internal:3000`** — el upstream al que el nginx
     reenvía `/api` por la red privada. ⚠️ Usa el nombre **exacto** del servicio backend: si lo
     llamaste `backend`, el host es `backend.railway.internal`; si le pusiste otro, ajústalo.
   - **`DNS_RESOLVER`** = **`[fd12::10]`** — el resolver DNS interno de Railway (IPv6 ULA de la
     red privada; **con corchetes**). nginx lo usa para resolver el backend en cada request
     (ver el recuadro del encabezado y §8.1). En local no se pone (se autodetecta); en Railway
     conviene fijarlo explícito para no depender de lo que traiga `/etc/resolv.conf`.
     ⚠️ **`fd12::10` es dato de soporte/comunidad de Railway (Help Station), NO doc oficial.** Es
     estable, pero confírmalo al desplegar (lo verás en el `/etc/resolv.conf` del contenedor
     frontend; la autodetección termina apuntando justo a ese valor dentro de Railway).

   El contrato del API ya viaja dentro de la imagen del frontend, así que no necesita nada más
   (ADR-0006).

## 5. Variables del servicio BACKEND (environment production)

Servicio **backend** → pestaña **Variables** → agrega (editor RAW si prefieres pegarlas
juntas):

| Variable               | Valor                               | Notas                                                                                                                                                                                            |
| ---------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`         | `${{Postgres.DATABASE_URL}}`        | **Literal, con las llaves.** Es una _reference variable_: Railway inyecta la URL **privada** de la BD (`postgres.railway.internal`). Si tu servicio de BD no se llama `Postgres`, usa su nombre |
| `BETTER_AUTH_SECRET`   | salida de `openssl rand -base64 32` | Genera UNO para production y OTRO distinto para prueba. No lo reutilices ni lo subas a ningún lado                                                                                              |
| `BETTER_AUTH_URL`      | `https://<dominio-del-frontend>`    | El dominio **público del frontend** (paso 4.4), con `https://` y sin barra final. Es el origen que ve el navegador; el backend valida contra él                                                |
| `R2_ACCOUNT_ID`        | Account ID de Cloudflare            | Lo obtienes en el paso 7                                                                                                                                                                        |
| `R2_ACCESS_KEY_ID`     | Access Key del token R2             | Paso 7                                                                                                                                                                                          |
| `R2_SECRET_ACCESS_KEY` | Secret Key del token R2             | Paso 7                                                                                                                                                                                          |
| `R2_BUCKET`            | `control-v2-prod`                   | En prueba será `control-v2-prueba`                                                                                                                                                              |

(Los nombres son exactamente los de [`backend/.env.example`](../backend/.env.example) — el
código los valida. `PORT` y `LOG_LEVEL` tienen default; Railway puede inyectar su propio
`PORT` y el backend lo respeta.)

Al guardar variables (con la BD ya creada) Railway redeploya el backend. El deploy corre:
build del Dockerfile → `preDeployCommand` (`npx prisma migrate deploy` contra la BD del
environment) → arranque → healthcheck `/api/health`.

> **Seed inicial:** la imagen del backend **no** siembra sola en Railway (el seed automático
> solo aplica en `docker-compose` local, vía `SEED_ON_START=true`). Para crear el usuario
> `admin` y los datos de fundación la primera vez en una BD de Railway, corre el seed una vez
> (ver `backend/README.md`). La vía más simple: agrega temporalmente `SEED_ON_START=true` a
> las variables del backend para un arranque y luego quítala (el entrypoint corre el seed
> idempotente). ⚠️ Si en cambio lo corres **desde tu máquina** (`npx prisma db seed`), la
> `DATABASE_URL` privada (`...railway.internal`) **no resuelve fuera de Railway**: para eso usa
> la variable **`DATABASE_PUBLIC_URL`** que expone el servicio Postgres (pasa por el TCP proxy
> y factura un poco de egress; está bien para una corrida puntual). Es idempotente (upserts).

## 6. Environment `prueba` (rama `prueba`)

1. En la barra superior, abre el **dropdown de environments** → **+ New Environment** →
   **Duplicate Environment** sobre `production`. Railway copia **los tres servicios y sus
   variables**; revisa los cambios "staged" y aplícalos (**Deploy**). Resultado: un Postgres
   NUEVO y vacío + backend + frontend propios del environment `prueba`.
2. **Cambia la rama de deploy** (la config de Source es **por environment**): con `prueba`
   seleccionado en el dropdown → para **cada** servicio (backend y frontend) → **Settings** →
   sección del repo (**Source**) → elige la rama **`prueba`** como trigger del auto-deploy.
   ⚠️ Vuelve al dropdown, párate en `production` y confirma que ahí los dos servicios sigan en
   `main`.
3. **Dominio de prueba:** environment `prueba` → servicio **frontend** → Settings →
   Networking → **Generate Domain** (será distinto al de production). El backend de prueba
   sigue **sin** dominio público.
4. **Ajusta las variables del backend de prueba** (la duplicación copió las de production):
   - `BETTER_AUTH_SECRET` → genera otro (`openssl rand -base64 32`).
   - `BETTER_AUTH_URL` → el dominio del **frontend de prueba** (paso 6.3).
   - `R2_BUCKET` → `control-v2-prueba`.
   - `DATABASE_URL` → no la toques: la referencia `${{Postgres.DATABASE_URL}}` apunta sola al
     Postgres DEL environment.
   - (Las variables del **frontend** —`BACKEND_UPSTREAM` y `DNS_RESOLVER`— NO se tocan:
     `backend.railway.internal` y el resolver `[fd12::10]` son los mismos en cualquier
     environment, así que sirven igual en prueba.)
5. **Backups del Postgres de prueba:** pestaña Backups → al menos **Daily**.
6. **Seed de la BD de prueba:** igual que en el paso 5 (la primera vez, para tener `admin`).
7. Mantenimiento posterior: si production y prueba se desalinean, usa **Sync** en el canvas
   (parado en el environment destino, eliges el origen y aplicas los cambios staged).

## 7. Cloudflare R2: buckets y token S3

1. Dashboard de Cloudflare → **R2 object storage** (activa R2 si es la primera vez).
2. **Crear los buckets** (Create bucket): `control-v2-prod` y `control-v2-prueba`. Ubicación
   automática está bien; **no** les actives acceso público — todo el acceso es por URLs
   firmadas (presigned) que genera el backend.
3. **Anota el Account ID:** visible en la página de R2, bajo **Account Details** (es el mismo
   de la URL del dashboard). Ese es `R2_ACCOUNT_ID`.
4. **Crear el token S3:** en **Account Details** → **Manage** junto a **API Tokens** → crea un
   **Account API token** (vive aunque te cambie el rol; los _User API tokens_ se desactivan si
   te sacan de la cuenta):
   - Permiso: **Object Read & Write** (leer/escribir/listar objetos; nada de administrar
     buckets — menos privilegio que **Admin Read & Write**).
   - Alcance: **solo** los buckets `control-v2-prod` y `control-v2-prueba` (los permisos a
     nivel de objeto permiten restringir a buckets específicos al crear el token).
   - Sin TTL (o con renovación calendarizada, a tu criterio).
5. Al crearlo te muestra **Access Key ID** y **Secret Access Key** **una sola vez** (la Secret
   no se puede volver a ver) — cópialas directo a las variables del backend de ambos
   environments (`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`). No las guardes en archivos del
   repo.
6. No hay que configurar endpoint en ningún dashboard: el backend lo arma como
   `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`.

## 7.1. ⭐ El respaldo MENSUAL cifrado a R2 (V1-E6a)

> **Por qué existe habiendo backups de Railway.** Los de Railway están **encendidos** y cubren el día
> a día. Éste es el **segundo** respaldo que exige `PLANMAESTRO.md` §91 (*"además de los backups de
> Railway"*), y su único valor es el caso en que **el problema SEA Railway**: cuenta suspendida,
> servicio borrado por error, caída larga del proveedor, o mudarse. Un respaldo que vive dentro de
> Railway se va con el barco. **Cadencia mensual** por decisión de Gabriel (17-ago-2026).

### Las variables (backend, en cada environment)

| Variable | Obligatoria | Qué pasa si falta |
| --- | --- | --- |
| **`RESPALDO_LLAVE`** | **SÍ** (≥24 chars) | El job **no se programa** y queda una corrida en `FALLO`/`CONFIGURACION` + log. **No hay respaldo.** |
| `RESPALDO_RETENCION` | no (def. **12**) | Conserva 12 copias = un año de respaldos mensuales |
| `RESPALDO_CRON` | no (def. `0 8 1 * *` UTC) | Día 1 de cada mes, 02:00 hora del centro de México |
| `RESPALDO_TIMEOUT_MIN` | no (def. **180**) | Si el `pg_dump` se cuelga, lo corta a las 3 h y deja la corrida en `FALLO` |
| `RESPALDO_ACTIVO=false` | no | Lo apaga **a propósito**: avisa y **no** deja rastro rojo |
| `R2_*` reales | SÍ | Con credenciales dummy **no se programa** y deja rastro rojo |

Generar la llave: `openssl rand -base64 32`

### 🔑 La llave: guárdala TAMBIÉN fuera de Railway

**En el gestor de contraseñas de Gabriel y de Daniel.** Si se pierde, **los respaldos son
irrecuperables: no hay puerta trasera**, y eso es por diseño — una puerta trasera al respaldo es una
puerta trasera a todo el negocio.

⚠️ Guardar la llave **sólo** en Railway anula el sentido del respaldo: en el escenario para el que
existe —Railway no está— te quedarías con los archivos cifrados y sin con qué abrirlos.

### Cómo saber si está funcionando

**Administración › Bitácora**, filtro de entidad **`RespaldoBd`** (permiso `admin.ver-bitacora`):
acción `CREAR` = respaldo hecho; `OTRO` = corrida fallida, con el paso y el error en el detalle.
También en la tabla `respaldo_corrida` y en el log de Railway (prefijo `⛔ RESPALDO A R2 FALLIDO`).

⚠️ **El aviso es PASIVO: no hay correo ni notificación.** Con corridas mensuales eso pesa más, no
menos — **si falla en enero, nadie lo nota hasta junio**. Revisar esa bitácora tiene que ser parte del
procedimiento mensual hasta que exista notificación activa.

### Restaurar (desde `backend/`, siempre con `--env-file=.env`)

```bash
# 1. ¿Qué respaldos hay?
npx tsx --env-file=.env scripts/restaurar-respaldo.ts --listar

# 2. SIEMPRE a una base NUEVA y vacía — nunca encima de producción
npx tsx --env-file=.env scripts/restaurar-respaldo.ts \
  --key respaldos/bd/2026/control-2026-09-01T080000Z.dump.enc \
  --destino postgresql://usuario:clave@host:5432/ensayo_restauracion
```

Baja de R2 → descifra (verifica integridad: llave equivocada o archivo corrupto dan **error claro y
sin dejar volcado a medias**) → `pg_restore`. Si la base destino ya tiene tablas **se niega**, salvo
`--si-estoy-seguro`.

**Comprobar el archivo ANTES de descifrar** (útil si se sospecha corrupción, y **no necesita la
llave**): cada corrida guarda el **SHA-256 del archivo cifrado** en `respaldo_corrida.sha256`; pásalo
con `--sha256 <hex>` y el script verifica la huella antes de tocar nada.

**Dos vías para correrlo, según el escenario:**

| Escenario | Cómo |
| --- | --- |
| **Railway en pie** (restaurar por un borrado, probar un ensayo) | Dentro del contenedor del backend: la imagen trae `scripts/` y el cliente PostgreSQL 17 |
| **Railway ya no está** ← *el escenario para el que existe este respaldo* | Desde un **checkout del repo**, en cualquier máquina con Node 22 y cliente **PostgreSQL ≥ 17** |

⚠️ El cliente debe ser **≥ 17**: `pg_dump`/`pg_restore` se niegan a trabajar contra un servidor más
nuevo que ellos, y Railway es PG17. Que la segunda vía no dependa de la plataforma caída es
deliberado — un procedimiento de emergencia que exige que la plataforma siga en pie no sirve de nada.

**Qué NO trae el volcado:** el esquema `pgboss` se excluye a propósito (estado transitorio: restaurarlo
re-dispararía trabajos de fechas pasadas). Consecuencia asumida: un evento ya publicado a la cola pero
aún no consumido se pierde — es recuperable re-disparándolo, y se prefiere eso a revivir trabajos
viejos. `evento_outbox` **sí** entra completo, y los ya procesados **no** se re-disparan (el publicador
filtra por `publicadoEn: null`).

**Prueba de restauración periódica** (`PLANMAESTRO` §91 la exige): repetir el paso 2 contra una base de
ensayo y comprobar que aparecen las tablas y datos esperados. Hay un ensayo automático en la suite de
integración, pero **eso valida el código, no el respaldo real de producción**.

## 8. Verificación final (checklist)

En **ambos** environments:

- [ ] El deploy del **backend** termina en verde (Deployments → logs: build del Dockerfile,
      `preDeployCommand` con `prisma migrate deploy` aplicando migraciones, arranque,
      healthcheck `/api/health` OK).
- [ ] El deploy del **frontend** termina en verde (build del Dockerfile nginx, healthcheck `/`).
- [ ] `https://<dominio-frontend>/` carga la pantalla de login de CONTROL v2.
- [ ] `https://<dominio-frontend>/api/health` responde `200` con `{"estado":"ok","bd":"ok"}`
      (esto prueba que el proxy nginx → `backend.railway.internal` funciona; si da **502**,
      revisa las variables `BACKEND_UPSTREAM` y `DNS_RESOLVER` del frontend (paso 5) y que el
      backend esté arriba; si da **503**, la BD no contesta → revisa `DATABASE_URL`).
- [ ] El login funciona con el usuario `admin` (corre el seed si aún no lo hiciste, paso 5/6).
      Cambia la contraseña al entrar.
- [ ] Push a la rama `prueba` → deploya SOLO el environment prueba; push a `main` → SOLO
      production (los dos servicios de ese environment).
- [ ] Postgres: pestaña Backups muestra respaldos programados; el TCP proxy público está
      apagado. El backend **no** tiene dominio público.
- [ ] R2: los 2 buckets existen; el token aparece en Manage API Tokens con permiso Object
      Read & Write limitado a esos buckets.

## 8.1. Consideración: re-despliegues del backend (red privada IPv6)

En la red privada de Railway la IP IPv6 interna del backend **puede cambiar cuando el backend
se vuelve a desplegar** (redeploy). El nginx del frontend está preparado para eso:

- **Cómo está hoy (resolución por request):** el `proxy_pass` usa una **variable**
  (`set $backend_upstream ${BACKEND_UPSTREAM}; proxy_pass http://$backend_upstream$request_uri;`)
  junto con una directiva `resolver`. Con variable, nginx **vuelve a resolver el host en cada
  request** (no cachea la IP al arrancar), con un TTL corto (`valid=10s`). Así, tras un redeploy
  del backend, el frontend toma la IP nueva **solo**, sin intervención.
- **El `resolver` se configura por variable `DNS_RESOLVER`** (con autodetección de respaldo):
  en local no se pone y se autodetecta de `/etc/resolv.conf` (`127.0.0.11` en docker-compose);
  en Railway se fija **`DNS_RESOLVER=[fd12::10]`** (paso 5) — el resolver interno de la red
  privada de Railway, IPv6 ULA fijo, **con corchetes**. Fijarlo explícito evita depender de lo
  que traiga el `/etc/resolv.conf` del contenedor.
  ⚠️ **`fd12::10` es un dato de soporte/comunidad de Railway (Help Station), NO está en la doc
  oficial.** Es estable desde que existe la red privada, pero por eso conviene confirmarlo al
  desplegar (el contenido de `/etc/resolv.conf` del contenedor frontend lo muestra; de hecho la
  autodetección termina apuntando justo a ese valor dentro de Railway).
- **Si vieras 502 tras un redeploy del backend:** lo primero y más rápido es **reiniciar el
  servicio frontend** en Railway (Deployments → Redeploy / Restart). Al reiniciar, nginx
  regenera su config y vuelve a resolver el backend. (Con la resolución por request de arriba no
  debería hacer falta, pero queda como red de seguridad.)
- **Nota de afinación:** este comportamiento por-request solo se puede comprobar de verdad **en
  Railway** (en local no aplica porque la IP del backend no cambia). El `valid=10s` del resolver
  acota —pero no elimina— la ventana en que nginx podría tener una IP vieja tras un redeploy
  (nginx no admite TTL 0); para F0/prueba es aceptable.

> ⚠️ **Riesgo conocido (documentado, mitigado):** personal de Railway desaconseja usar **nginx**
> como reverse-proxy hacia la **red privada** por los matices de DNS/IPv6/caché que aquí
> resolvemos, y sugiere **Caddy** (re-resuelve DNS solo, sin `resolver` manual). En CONTROL v2 el
> frontend es nginx por arquitectura (sirve los estáticos del SPA), así que **lo mantenemos** y
> mitigamos con: `proxy_pass` por variable (re-resolución por request), `resolver` explícito
> `[fd12::10]` con `ipv6=on`, y TTL corto. Si en el despliegue real apareciera un problema de
> conectividad interna difícil de domar, la alternativa evaluable es un sidecar/imagen Caddy
> para el proxy de `/api` (decisión para un ADR, fuera de F0). Fuente: Railway Help Station.

## 9. Problemas comunes

| Síntoma                                                          | Causa probable                                                                                     | Arreglo                                                                                                                                            |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Primer deploy falla con "no app found" o build en la raíz       | Root Directory sin configurar                                                                       | Settings → Root Directory = `backend` (o `frontend`) y redeploy                                                                                   |
| El frontend carga pero `/api/...` da **502 Bad Gateway**        | Falta/mal `BACKEND_UPSTREAM` (el default `backend:3000` no existe en Railway) o `DNS_RESOLVER` del frontend, o el backend está caído | Frontend → Variables → `BACKEND_UPSTREAM=backend.railway.internal:3000` + `DNS_RESOLVER=[fd12::10]` (paso 5); usa el nombre EXACTO del servicio backend. Verifica que el backend esté arriba |
| Deploy del backend verde pero healthcheck falla y lo tumba      | `DATABASE_URL` mal (no es la reference variable) o migración colgada                                | Variables → confirma `${{Postgres.DATABASE_URL}}`; revisa logs del pre-deploy. El healthcheck espera hasta `healthcheckTimeout` (300 s)           |
| `/api/health` responde **503**                                  | El backend arrancó pero la BD no responde                                                           | Revisa que el Postgres esté arriba y `DATABASE_URL` correcta                                                                                       |
| Login redirige mal o la sesión no se mantiene                   | `BETTER_AUTH_URL` no coincide con el dominio **del frontend** (o sin `https://`)                    | Corrige la variable en el backend y redeploy                                                                                                       |
| No puedo entrar: no existe el usuario `admin`                   | La BD de ese environment no se sembró                                                               | Corre el seed una vez (paso 5/6; `backend/README.md`)                                                                                              |
| Estás bloqueado tras 5 intentos de login                        | Regla del negocio (doc 00 §1.1)                                                                     | Otro admin te desbloquea; si eres el único admin, ver `backend/README.md` (reset por SQL/seed)                                                     |
| Subida de archivos falla con error S3                           | Token R2 sin alcance al bucket del environment, o `R2_BUCKET` con typo                              | Revisa el alcance del token y el nombre exacto del bucket                                                                                          |
| Cambié algo de build/deploy en el dashboard y "no agarra"       | `railway.json` manda sobre el dashboard                                                             | Cambia build/deploy editando el `railway.json` del servicio en un PR (es infraestructura versionada)                                              |
| `prisma: not found` en el pre-deploy                            | La imagen no tiene la CLI de Prisma en runtime                                                      | No pasa con nuestro setup: el `preDeployCommand` corre en la **imagen del Dockerfile**, y la etapa runner copia `node_modules` completo (con la CLI de Prisma y `prisma/migrations`) — verificado. (Este problema solo aplicaría a builds con Railpack/Nixpacks, que omiten devDependencies; nosotros usamos Dockerfile.) Si pasara, avisa al equipo (cambio de código por PR) |

## 9.1. ⭐ «No se pueden subir fotos» — las cuatro trampas de R2

> Estas cuatro estaban **enterradas** en la ficha de una etapa de junio
> (`docs/hoja-de-ruta/F1-etapas.md:222`). Viven aquí porque es donde uno las busca. *(Pasó de nuevo el
> 15-ago-2026: Daniel no pudo subir fotos en `prueba` y hubo que ir a arqueologiar la ficha vieja.)*

**Primero: el mensaje de la pantalla te dice DÓNDE mirar.** Los dos textos salen de
`frontend/src/api/subida-archivo.ts` y significan cosas distintas:

| Lo que dice la pantalla | Qué pasó | Dónde está la causa |
| --- | --- | --- |
| *«No se pudo guardar la imagen. Puede tratarse de un problema de **configuración del almacenamiento**, no de tu conexión…»* | El navegador **no recibió respuesta**: el `PUT` a R2 murió por CORS o por permisos (R2 rechaza **sin cabeceras CORS** y el navegador lo disfraza de falla de red) | **Trampas 1, 2 o 4** de abajo |
| *«El almacenamiento **rechazó** la imagen (error 403 / 400…)»* | R2 **sí** contestó, y el número es la pista | El código HTTP acota la causa |

**Para acotar en 10 segundos:** F12 → pestaña **Red** → intenta subir → busca la línea a
`*.r2.cloudflarestorage.com`. **403** = llave o credenciales (1 o 2). **Bloqueada por CORS** = política
del bucket (4).

**Las cuatro trampas, en orden de probabilidad:**

1. **El token S3 debe ser «Object Read & Write»** con alcance al bucket. **Read-only da `403
   AccessDenied` en el PUT** y se ve exactamente como un "error de CORS". Ojo también con que el token
   **no haya expirado ni se haya rotado**.
2. **Las variables del backend deben ser las REALES**, no los valores de relleno: `R2_ACCOUNT_ID`,
   `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. Si alguna quedó en `dev`, la URL se firma
   con credenciales falsas y R2 la rechaza igual. *(El firmado de la URL es **local**: el backend no
   contacta a R2 para generarla, así que una credencial falsa no falla hasta que el navegador sube.)*
3. **No firmar `content-length` ni `content-type`** en el PUT prefirmado — el navegador los maneja como
   cabeceras especiales. *(Ya resuelto en código; no lo re-rompas.)* En la misma línea: el SDK v3 de AWS
   añade **checksum CRC32 por defecto** y R2 lo rechaza → por eso el cliente lleva
   `requestChecksumCalculation: 'WHEN_REQUIRED'` (`backend/src/comun/archivos.ts`).
4. **La política CORS del bucket** debe permitir **PUT y GET desde el origen público del frontend** de
   ESE environment. Si el dominio de Railway cambió en algún redeploy, el origen viejo ya no coincide y
   el navegador bloquea.

**Y una quinta, distinta pero del mismo día:** `BETTER_AUTH_URL` debe apuntar al **dominio público del
frontend**; si no, falla cerrar sesión y la sesión da 401.

⚠️ **Las ocho pantallas que suben archivos comparten el mismo camino**
(`frontend/src/api/subida-archivo.ts`): foto de modelo, foto de arte, adjuntos de
desarrollo/orden/pedido, PDF de proveedor, logo de empresa y PDF de entrada de tela. **Si fallan
TODAS, es configuración** (esta sección). **Si falla UNA sola, es código** de esa pantalla.

## 10. Pasos manuales en GitHub (no en Railway/R2)

- **Crear la rama `prueba`** si aún no existe (desde `main`): es la base del flujo
  tarea → `prueba` → `main` y la rama del environment de prueba.
- **Instalar la app de Renovate** en el repo
  ([github.com/apps/renovate](https://github.com/apps/renovate), dándole acceso a
  `DanFrModa/Respaldo-Control-CLAUDE`): sin la app instalada, el `.github/renovate.json` no
  hace nada. Sus PRs llegan contra la rama `prueba` con la etiqueta `dependencias` y pasan por
  el mismo CI/review que cualquier PR.
- **Proteger las ramas** `main` y `prueba` (Settings → Branches → Branch protection):
  exigir PR + status checks en verde para mergear. El CI nuevo (`.github/workflows/ci.yml`)
  publica estos checks: **`backend`**, **`frontend`**, **`imagenes-docker`** y **`e2e`** —
  márcalos como requeridos. (El CI corre en TODO PR a `prueba`/`main`, sin filtro de paths,
  así que no hace falta el truco del workflow "no-op" del intento anterior.)

## 11. Qué queda en manos de los agentes (NO lo hagas a mano)

- Cambios a `railway.json`, CI, esquema/migraciones, seed y la plantilla de nginx: por PR con
  review. (El target del backend en nginx ya es configurable por la variable
  `BACKEND_UPSTREAM` — no requiere cambio de código para Railway, solo poner la variable.)
- El job de `pg_dump` diario cifrado hacia R2 (respaldo doble, plan §2/§11): fase posterior
  con pg-boss.
- PR environments (ambiente efímero por PR): opcional, se evaluará después de F0.
