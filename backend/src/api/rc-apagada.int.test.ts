/**
 * Pruebas de integración del INTERRUPTOR de la Ruta Crítica **por el API REAL** (V1-E3t,
 * `DECISIONES.md §Post-F9.36 punto 1`).
 *
 * Levantan la app Fastify de verdad (better-auth incluido) contra el Postgres efímero y entran con
 * el **admin del seed** — el usuario con MÁS permisos que existe en el sistema. Si a él la Ruta
 * Crítica le queda cerrada, le queda cerrada a todos.
 *
 * Prueban la capa que de verdad manda de §Post-F9.68 (*el backend rechaza la operación*): esconder
 * el menú y cerrar la ruta son de presentación y se le pueden brincar tecleando la URL o llamando
 * al API a mano. Aquí se comprueba el **403 del SERVIDOR**, en los cuatro permisos del módulo
 * (`rc.ruta-ver`, `rc.programar`, `rc.capturar`, `rc.catalogo-ver`), y que la sesión no le entrega
 * al frontend ni una clave `rc.*` con la que pintar un menú.
 *
 * ⭐ Y lo hacen **con las ocho filas `RolPermiso` PUESTAS** (`reotorgarPermisosApagadosAlAdmin` en
 * el `beforeEach`): el seed también resta los apagados, así que sin este paso las pruebas pasarían
 * por el efecto colateral del seed y no por la cerradura. Es además el estado REAL de una base que
 * todavía no se ha re-sembrado con `SEED_ON_START=true`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { construirApp } from '../app.js';
import { CLAVES_PERMISO, permisoApagado } from '../contrato/index.js';
import type { PrismaClient } from '../datos/index.js';
import { clientePruebas, limpiarBaseDatos } from '../pruebas/contexto.js';
import { sembrar } from '../../prisma/seed.js';

let cliente: PrismaClient;
let app: FastifyInstance;

const PASSWORD_ADMIN = 'Control.2026!';

/** Cookie de una sesión de ADMIN lista para reenviar en peticiones protegidas. */
async function cookieAdmin(): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/username',
    payload: { username: 'admin', password: PASSWORD_ADMIN },
  });
  expect(res.statusCode).toBe(200);
  const set = res.headers['set-cookie'];
  const cookies = set === undefined ? [] : Array.isArray(set) ? set : [set];
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

beforeAll(async () => {
  cliente = clientePruebas();
  app = await construirApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await cliente.$disconnect();
});

/**
 * Re-otorga al rol `Administrador` TODOS los permisos de un módulo apagado, deshaciendo la resta
 * que hace el seed. Devuelve cuántas filas quedaron (la prueba lo afirma: si el día de mañana el
 * catálogo cambiara, el número tiene que moverse a la vista, no callarse).
 *
 * ⭐ Por qué (hallazgo del reviewer, D4): el seed y el filtro de la sesión son REDUNDANTES a
 * propósito, y con el seed haciendo su trabajo **quitar el filtro dejaba 12 de 13 pruebas verdes**
 * — pasaban porque la fila `RolPermiso` ya no existía, no porque el filtro mordiera, mientras el
 * encabezado de este archivo presumía de probar *"el 403 aunque la fila siga en la base"*.
 *
 * Y no es un escenario de laboratorio: **es el estado real de `prueba` hasta que alguien despliegue
 * con `SEED_ON_START=true`**. Poniendo las filas de vuelta en cada prueba, el ÚNICO que puede negar
 * el acceso es `cargarPermisosDeUsuario`, que es lo que este archivo dice medir.
 */
async function reotorgarPermisosApagadosAlAdmin(): Promise<number> {
  const apagados = await cliente.permiso.findMany({
    where: { clave: { in: [...CLAVES_PERMISO.filter(permisoApagado)] } },
    select: { id: true },
  });
  const rolAdmin = await cliente.rol.findUniqueOrThrow({ where: { nombre: 'Administrador' } });
  await cliente.rolPermiso.createMany({
    data: apagados.map((p) => ({ idRol: rolAdmin.id, idPermiso: p.id })),
    skipDuplicates: true,
  });
  return cliente.rolPermiso.count({
    where: { idRol: rolAdmin.id, idPermiso: { in: apagados.map((p) => p.id) } },
  });
}

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  await sembrar(cliente);
  // ⭐ D4: la base queda como la `prueba` que AÚN NO se ha re-sembrado — con los `rc.*` puestos en
  // el rol del admin. Así todo lo que sigue mide LA CERRADURA (el filtro de la sesión) y no el
  // efecto colateral del seed.
  const puestos = await reotorgarPermisosApagadosAlAdmin();
  expect(puestos, 'el escenario D4 exige las 8 filas rc.* puestas').toBe(8);
});

describe('Ruta Crítica APAGADA (V1-E3t) — el servidor la cierra', () => {
  /** Una ruta de LECTURA por cada permiso del módulo (el 403 no depende del método). */
  const ENDPOINTS: readonly (readonly [permiso: string, url: string])[] = [
    ['rc.ruta-ver', '/api/ruta-critica/ordenes/1/ruta'],
    ['rc.ruta-ver', '/api/ruta-critica/bandeja'],
    ['rc.ruta-ver', '/api/ruta-critica/alertas/conteo'],
    ['rc.ruta-ver', '/api/ruta-critica/concentrado'],
    ['rc.ruta-ver', '/api/ruta-critica/analisis'],
    ['rc.ruta-ver', '/api/ruta-critica/ordenes/1/hitos'],
    ['rc.catalogo-ver', '/api/ruta-critica/familias'],
    ['rc.catalogo-ver', '/api/ruta-critica/articulos'],
  ];

  it.each(ENDPOINTS)('%s → 403 en %s, hasta para el ADMIN', async (_permiso, url) => {
    const cookie = await cookieAdmin();
    const res = await app.inject({ method: 'GET', url, headers: { cookie } });
    // 403 y no 404/500: el guard corta ANTES de tocar el dominio (deny-by-default, A4).
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ codigo: 'PERMISO' });
  });

  // Las de ESCRITURA, cada una con su método real Y UN CUERPO VÁLIDO. Las dos cosas importan: con
  // el método equivocado el servidor responde 404 y con un cuerpo inválido 400 (Fastify valida
  // ANTES del preHandler), y en los dos casos la prueba pasaría sin haber tocado el permiso.
  it('programar la RC de una orden (rc.programar, POST) da 403', async () => {
    const cookie = await cookieAdmin();
    const res = await app.inject({
      method: 'POST',
      url: '/api/ruta-critica/ordenes/1/programar',
      headers: { cookie },
      payload: {
        idArticuloRC: 1,
        fechaEntregaRC: '2026-09-01',
        idTipoTela: 1,
        idAplicacion: 1,
        esResurtido: false,
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ codigo: 'PERMISO' });
  });

  it('capturar el cumplimiento de un proceso (rc.capturar, PUT) da 403', async () => {
    const cookie = await cookieAdmin();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/ruta-critica/procesos/1/cumplimiento',
      headers: { cookie },
      payload: { cumplido: true, fechaReal: '2026-09-01' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ codigo: 'PERMISO' });
  });

  // ── Las superficies de RC servidas DESDE OTRO MÓDULO ────────────────────────────────────────
  //
  // Son la familia de defectos más traicionera de esta etapa: NO se llaman `rc.*`, así que el
  // interruptor no las toca, y quedan como un tablero de ceros vivo. Se buscaron EXHAUSTIVAMENTE
  // (el método está en la ficha `V1-E3t`): las cuatro vistas materializadas construidas sobre
  // `ruta_orden` —`kpi_entregas_a_tiempo`, `kpi_lead_time_proceso`, `kpi_cuellos_botella`,
  // `kpi_desempeno_responsable`— y todos sus consumidores. Salieron DOS, y las dos se prueban aquí.
  it('los KPIs de Ruta Crítica de Indicadores caen con el módulo (piden las DOS llaves)', async () => {
    // Superficie 1/2: `/api/indicadores/rc*` iba con `indicadores.ver` a secas, que el admin SÍ
    // tiene. Sin `conTodosPermisos` habría quedado abierta.
    const cookie = await cookieAdmin();
    const res = await app.inject({
      method: 'GET',
      url: '/api/indicadores/rc?anio=2026',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(403);
    // Y el resto de Indicadores sigue ENCENDIDO: apagar la RC no puede tumbar el módulo vecino.
    const wip = await app.inject({
      method: 'GET',
      url: '/api/indicadores/wip',
      headers: { cookie },
    });
    expect(wip.statusCode).toBe(200);
  });

  it('la PORTADA no pinta el mosaico «Entregas a tiempo», que también sale de la RC', async () => {
    // Superficie 2/2 (hallazgo del reviewer, D1): `GET /api/resumen` calculaba `entregasATiempo`
    // con `indicadores.ver` a secas, y su fuente —`kpi_entregas_a_tiempo`— es 100 % `ruta_orden`.
    // Con la RC apagada el admin recibía `{porcentaje: null, medibles: 0}` y la PRIMERA pantalla
    // del sistema pintaba un mosaico «Entregas a tiempo · —% · RC» muerto para siempre.
    //
    // 🔴 El valor que pone ROJA esta prueba es cualquier objeto: hoy `entregasATiempo` es `null`
    // porque el dominio ni consulta; con el gate viejo (`puedeIndicadores` solo) llega
    // `{"porcentaje":null,"medibles":0,"deltaPuntos":null}`, que NO es `null` y el frontend PINTA.
    // Por eso se exige `toBeNull()` y no `porcentaje === null`, que pasaría en los dos mundos.
    const cookie = await cookieAdmin();
    const res = await app.inject({ method: 'GET', url: '/api/resumen', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const resumen = res.json<{
      entregasATiempo: unknown;
      ordenesPorVencer: unknown;
      wipMaquila: unknown;
      existenciaPt: unknown;
    }>();

    // TODO lo que sale de la RC, en null…
    expect(resumen.entregasATiempo).toBeNull();
    expect(resumen.ordenesPorVencer).toBeNull();
    // …y lo que NO sale de la RC, vivo: apagar la RC no puede vaciar la portada entera (sin esto,
    // un `/api/resumen` roto o una sesión sin permisos también pasaría las dos líneas de arriba).
    expect(resumen.wipMaquila).not.toBeNull();
    expect(resumen.existenciaPt).not.toBeNull();
  });

  // ⭐ PRUEBA DE DERIVA del campo `apagado` del contrato (hallazgo del reviewer, D2). La pantalla
  // de Roles lo consume para deshabilitar la casilla, pero su ÚNICA prueba usaba un fixture con
  // `apagado: true` escrito a mano: nunca tocaba al PRODUCTOR (`dominio/admin/permisos.ts`), así
  // que `apagado: false` fijo pasaba en verde. Esto lo mide contra el interruptor de verdad.
  it('GET /api/permisos marca `apagado` en los rc.* y sólo en ellos', async () => {
    const cookie = await cookieAdmin();
    const res = await app.inject({ method: 'GET', url: '/api/permisos', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const catalogo = res.json<
      { modulo: string; permisos: { clave: string; apagado: boolean }[] }[]
    >();
    const porClave = new Map(
      catalogo.flatMap((g) => g.permisos).map((p) => [p.clave, p.apagado] as const),
    );

    // Las OCHO claves del módulo apagado, cada una en `true`.
    const rc = [...porClave.keys()].filter((c) => c.startsWith('rc.'));
    expect(rc).toHaveLength(8);
    for (const clave of rc) {
      expect(porClave.get(clave), `${clave} debe venir apagado`).toBe(true);
    }
    // Y NADIE más: el valor que pondría roja esta línea es un `apagado: true` de más (p. ej. si el
    // prefijo se calculara mal y `rc` casara con otro módulo).
    const encendidos = [...porClave.entries()].filter(([, apagado]) => apagado);
    expect(encendidos.map(([clave]) => clave).sort()).toEqual([...rc].sort());
    expect(porClave.get('almacenes.ver')).toBe(false);
  });

  it('la sesión no le entrega al frontend ni una clave rc.* (menú y ruta se apagan solos)', async () => {
    const cookie = await cookieAdmin();
    const res = await app.inject({ method: 'GET', url: '/api/sesion', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const { permisos } = res.json<{ permisos: string[] }>();

    expect(permisos.filter((p) => p.startsWith('rc.'))).toEqual([]);
    // Y NO se llevó de corbata a nadie más: todo lo que no está apagado sigue en la sesión del
    // admin (sin esto, "no hay rc.*" también pasaría con la sesión vacía o el login roto).
    const esperados = CLAVES_PERMISO.filter((clave) => !permisoApagado(clave));
    expect([...permisos].sort()).toEqual([...esperados].sort());
  });

  it('un rol A LA MEDIDA con rc.* tampoco entra (ahí el seed no llega NUNCA)', async () => {
    // El `beforeEach` ya deja los `rc.*` puestos en el rol de sistema; esto cubre el caso que el
    // seed **no puede** tocar ni queriendo: un rol creado a mano por Gabriel desde Administración ›
    // Roles. `sembrarRoles` sólo sincroniza los roles que él mismo define POR NOMBRE, así que aquí
    // la única cosa entre el usuario y la Ruta Crítica es `cargarPermisosDeUsuario`.
    const permiso = await cliente.permiso.findUniqueOrThrow({ where: { clave: 'rc.ruta-ver' } });
    const rolALaMedida = await cliente.rol.create({
      data: {
        nombre: 'RC a la medida (prueba)',
        descripcion: 'Rol creado a mano, fuera del seed',
        esSistema: false,
        permisos: { create: [{ idPermiso: permiso.id }] },
      },
    });
    const admin = await cliente.usuario.findUniqueOrThrow({ where: { username: 'admin' } });
    await cliente.usuarioRol.create({ data: { idUsuario: admin.id, idRol: rolALaMedida.id } });

    // La premisa, afirmada: el rol existe, NO es de sistema y trae el permiso.
    const vivo = await cliente.rol.findUniqueOrThrow({
      where: { id: rolALaMedida.id },
      include: { permisos: { include: { permiso: true } } },
    });
    expect(vivo.esSistema).toBe(false);
    expect(vivo.permisos.map((rp) => rp.permiso.clave)).toEqual(['rc.ruta-ver']);

    const cookie = await cookieAdmin();
    const res = await app.inject({
      method: 'GET',
      url: '/api/ruta-critica/bandeja',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(403);
  });
});
