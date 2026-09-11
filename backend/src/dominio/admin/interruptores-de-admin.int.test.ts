/**
 * ⭐⭐ LOS CINCO INTERRUPTORES QUE COLGABAN DE `roles.administrar` (fila 0.120).
 *
 * # Qué defecto cierra esta prueba
 *
 * Hasta la 0.120, CINCO facultades de negocio —en tres módulos que no se hablan— preguntaban por
 * `roles.administrar` como si fuera un «modo dios»:
 *
 * | dónde | qué concedía de pasada |
 * |---|---|
 * | `ruta-critica/cumplimiento.ts` | capturar CUALQUIER proceso de la RC, sin filtro por responsabilidad |
 * | `ruta-critica/rutaOrden.ts` | salir como responsable de todo proceso (badge "tú") |
 * | `ruta-critica/bandeja.ts` | ver la bandeja COMPLETA, sin filtro por responsabilidad |
 * | `compras/ordenes-compra.ts` | editar una orden de compra YA autorizada |
 * | `produccion/tipos-proceso.ts` | mover la bandera que mete prenda al inventario de PT |
 *
 * O sea: darle a alguien «administrar roles y permisos» le regalaba, **sin que nadie lo decidiera y
 * sin que se viera desde ninguna pantalla**, otras cuatro facultades que nada tienen que ver. Es
 * literalmente la queja con la que Daniel mandó quitar la cascada del seed el 3-sep-2026:
 *
 * > *«puede haber alguien que tenga el permiso A pero no el B, y otra persona que tenga el B pero no
 * > el A. Si se hace por cascada nos vamos a tener que conformar con que algunas personas accedan a
 * > cosas que no deberían.»*
 *
 * …y aquí tener A implicaba B, C, D y E. **No cambiaba el comportamiento de hoy** (las cinco
 * colgaban del mismo perfil), pero volvía imposible el reparto por puesto del arranque: no había
 * cinco interruptores que mover, había uno.
 *
 * # Las dos baterías, y por qué hacen falta las dos
 *
 * | Batería | Qué prueba | Cuándo debe fallar |
 * |---|---|---|
 * | **UNA LLAVE, UNA PUERTA** | que tener una de las llaves nuevas NO concede ninguna de las otras | si alguien vuelve a colapsar dos facultades bajo un solo permiso |
 * | **EQUIVALENCIA HACIA ATRÁS** | que quien hoy es administrador sigue pudiendo las cinco cosas | si la fila le quitó a alguien algo que ya tenía |
 *
 * La primera es la TESIS de la fila; la segunda es su promesa de no romper nada. Y las dos incluyen
 * el mismo control negativo: **`roles.administrar` a secas ya no abre NINGUNA de las cinco puertas**
 * — sin eso, nada probaría que el interruptor viejo se desconectó de verdad.
 *
 * ⚠️ **Y dos de los cinco tienen ESPEJO EN LA PANTALLA**, que esta prueba no alcanza:
 * `OrdenesCompraPagina.tsx` (el botón «Editar» de una OC firmada) y `TiposProcesoPagina.tsx` (la
 * casilla de la bandera) preguntaban también por `roles.administrar`. Si el espejo se desfasa del
 * dominio, o la pantalla promete algo que se come un 409, o le esconde el control a quien sí puede
 * —el interruptor existiría y nadie lo alcanzaría—. Los cubren sus propias pruebas de componente.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CLAVES_PERMISO, type ClavePermiso } from '../../contrato/index.js';
import { ErrorConflicto, ErrorPermiso } from '../../comun/errores.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import type { Empresa, PrismaClient } from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { actualizarOC, autorizarOC, crearOC } from '../compras/ordenes-compra.js';
import { actualizarTipoProceso, crearTipoProceso } from '../produccion/tipos-proceso.js';
import { consultarBandeja } from '../ruta-critica/bandeja.js';
import { completarProceso } from '../ruta-critica/cumplimiento.js';
import { obtenerRutaOrden } from '../ruta-critica/rutaOrden.js';

let cliente: PrismaClient;
let empresa: Empresa;
/** Id del usuario que protagoniza las pruebas: NO tiene ningún rol, así que no es responsable de nada. */
let idUsuarioSinRoles: string;
/** Renglón de RC activo, cuyo proceso es responsabilidad de un rol AJENO al usuario. */
let idRutaAjena: number;
let idOrdenConRc: number;
/** OC ya autorizada (o sea, fuera de los estatus que cualquiera edita). */
let idOcAutorizada: number;
/** Tipo de proceso con la bandera de PT APAGADA. */
let idTipoProceso: number;

const bd = () => ({ cliente });

/**
 * Los permisos OPERATIVOS de las cinco facultades: los que cualquiera del piso lleva y que sólo
 * sirven para poder *intentar* la operación. Ninguno de ellos es una de las llaves nuevas — se dan
 * siempre, para que lo único que cambie entre un caso y otro sea la llave bajo prueba.
 */
const OPERATIVOS: ClavePermiso[] = [
  'rc.ruta-ver',
  'rc.capturar',
  'compras.ver',
  'compras.administrar',
  'tipos-proceso.ver',
  'tipos-proceso.administrar',
];

/** Las cuatro llaves que la fila 0.120 sacó de debajo de `roles.administrar`. */
const LLAVES_NUEVAS: ClavePermiso[] = [
  'rc.capturar-cualquiera',
  'rc.bandeja-completa',
  'compras.editar-autorizada',
  'tipos-proceso.marcar-entrada-pt',
];

/** Sesión del usuario sin roles, con los operativos MÁS las llaves que se le quieran dar. */
function sesionCon(...llaves: ClavePermiso[]): SesionUsuario {
  return sesionDePrueba({
    id: idUsuarioSinRoles,
    idEmpresaActiva: empresa.id,
    permisos: [...OPERATIVOS, ...llaves],
  });
}

// ── Las cinco facultades, cada una como una función que o funciona o revienta ────────────────
//
// Se escriben así —y no inline— para que la matriz de abajo pueda cruzar CADA llave contra TODAS
// las puertas sin repetir el cuerpo, que es justo donde se cuela el copy-paste que deja una
// combinación sin medir.

/** (1) Capturar un proceso de RC del que el usuario NO es responsable. */
async function capturarProcesoAjeno(sesion: SesionUsuario): Promise<void> {
  await completarProceso(sesion, idRutaAjena, undefined, bd());
}

/** (2) Salir como responsable del proceso ajeno en la ruta de la orden (badge "tú"). */
async function saleComoResponsableDeTodo(sesion: SesionUsuario): Promise<boolean> {
  const ruta = await obtenerRutaOrden(sesion, idOrdenConRc, bd());
  return ruta.procesos.every((p) => p.esResponsableActual);
}

/** (3) ¿La bandeja viene SIN filtro de responsabilidad (trae la tarea ajena)? */
async function bandejaTraeLaTareaAjena(sesion: SesionUsuario): Promise<boolean> {
  const pagina = await consultarBandeja(sesion, {}, bd());
  return pagina.datos.some((t) => t.idRutaOrden === idRutaAjena);
}

/** (4) Editar una OC ya autorizada. */
async function editarOcAutorizada(sesion: SesionUsuario): Promise<void> {
  await actualizarOC(sesion, idOcAutorizada, { observaciones: 'tocada' }, bd());
}

/** (5) Mover la bandera `generaEntradaPt` de un tipo de proceso. */
async function prenderBanderaPt(sesion: SesionUsuario): Promise<boolean> {
  const tipo = await actualizarTipoProceso(
    sesion,
    { id: idTipoProceso, generaEntradaPt: true },
    bd(),
  );
  return tipo.generaEntradaPt;
}

beforeAll(() => {
  cliente = clientePruebas();
});
afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  empresa = await crearEmpresaPrueba(cliente);

  // ── El usuario: SIN ningún rol, o sea responsable de NADA por la vía normal (ProcesoDefRol) ──
  const usuario = await cliente.usuario.create({
    data: { username: 'sin-roles', nombre: 'Sin Roles', email: 'sin-roles@x.local' },
  });
  idUsuarioSinRoles = usuario.id;

  // ── RC: una orden con un proceso activo cuyo responsable es un rol que el usuario NO tiene ──
  const clienteNeg = await cliente.cliente.create({ data: { nombre: 'Liverpool' } });
  const modelo = await cliente.modelo.create({ data: { codigo: 'A-100', descripcion: 'X' } });
  const orden = await cliente.orden.create({
    data: {
      folio: BigInt(1),
      idEmpresa: empresa.id,
      idModelo: modelo.id,
      idCliente: clienteNeg.id,
      rcActiva: true,
    },
  });
  idOrdenConRc = orden.id;
  const proceso = await cliente.procesoDef.create({ data: { codigo: 'corte', nombre: 'CORTE' } });
  const rolAjeno = await cliente.rol.create({ data: { nombre: 'Cortadores', descripcion: 'x' } });
  await cliente.procesoDefRol.create({ data: { idProcesoDef: proceso.id, idRol: rolAjeno.id } });
  const renglon = await cliente.rutaOrden.create({
    data: {
      idOrden: orden.id,
      idProcesoDef: proceso.id,
      secuencia: 0,
      duracionDias: 1,
      estado: 'activo',
    },
  });
  idRutaAjena = renglon.id;

  // ── Compras: una OC autorizada ──
  const proveedor = await cliente.proveedor.create({ data: { nombre: 'Telas del Norte' } });
  const direccion = await cliente.direccionEntrega.create({
    data: { nombre: 'Naucalpan', direccion: 'Av. Siempre Viva 123', favorita: true },
  });
  const sesionCompras = sesionDePrueba({
    idEmpresaActiva: empresa.id,
    permisos: ['compras.ver', 'compras.administrar', 'compras.autorizar'],
  });
  const oc = await crearOC(
    sesionCompras,
    {
      fechaEntrega: '2026-09-30',
      idDireccionEntrega: direccion.id,
      idProveedor: proveedor.id,
      lineas: [],
    },
    bd(),
  );
  await autorizarOC(sesionCompras, oc.id, bd());
  idOcAutorizada = oc.id;

  // ── Producción: un tipo de proceso con la bandera APAGADA ──
  const tipo = await crearTipoProceso(
    sesionDePrueba({
      idEmpresaActiva: empresa.id,
      permisos: ['tipos-proceso.ver', 'tipos-proceso.administrar'],
    }),
    { codigo: 'maquila', nombre: 'Maquila' },
    bd(),
  );
  idTipoProceso = tipo.id;
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. UNA LLAVE, UNA PUERTA — la tesis de Daniel: tener A no concede B
// ─────────────────────────────────────────────────────────────────────────────

describe('⭐ una llave abre SÓLO su puerta (fila 0.120)', () => {
  it('`rc.capturar-cualquiera` captura el proceso ajeno… y NADA de compras ni de PT', async () => {
    const sesion = sesionCon('rc.capturar-cualquiera');

    // 🔴🔴 EL ORDEN DE ESTAS LÍNEAS ES PARTE DE LA PRUEBA — NO LAS REACOMODES.
    //
    // Esto NO es una matriz de celdas independientes: es una SECUENCIA, y dos de las cinco puertas
    // comparten el estado del mundo. `capturarProcesoAjeno` COMPLETA el renglón, y la bandeja sólo
    // devuelve tareas ACTIVAS ⇒ después de capturar, `bandejaTraeLaTareaAjena` da `false`
    // **pase lo que pase con el permiso**, y la aserción se cumpliría por el efecto secundario en
    // vez de por la regla.
    //
    // Medido: con la captura PRIMERO, colapsar las dos llaves de la RC en `bandeja.ts`
    // —exactamente el error que esta fila vino a evitar— SOBREVIVÍA la prueba en verde. Con la
    // bandeja primero, esa mutación muere. Así que la bandeja se mide ANTES de capturar, y la
    // captura va AL FINAL. Es el único sitio del repo que cruza `rc.bandeja-completa` con
    // `rc.capturar-cualquiera`: si esta prueba no las separa, nada lo hace.
    //
    // ⚠️ La misma cautela vale para cualquier puerta que se agregue aquí: antes de encadenar una
    // aserción nueva, preguntarse **qué estado deja la de arriba**.

    // Las ajenas, PRIMERO (mientras la tarea sigue activa y la bandeja puede verla o no).
    await expect(bandejaTraeLaTareaAjena(sesion)).resolves.toBe(false);
    await expect(editarOcAutorizada(sesion)).rejects.toBeInstanceOf(ErrorConflicto);
    await expect(prenderBanderaPt(sesion)).resolves.toBe(false);

    // Su puerta, AL FINAL: captura un proceso del que no es responsable.
    await expect(capturarProcesoAjeno(sesion)).resolves.toBeUndefined();
  });

  it('`rc.bandeja-completa` ve la bandeja entera… pero NO captura el proceso ajeno', async () => {
    const sesion = sesionCon('rc.bandeja-completa');

    // Su puerta: la bandeja llega sin filtro de responsabilidad.
    await expect(bandejaTraeLaTareaAjena(sesion)).resolves.toBe(true);

    // ⭐ EL CASO DE DANIEL, literal: tiene A (ver todo) y NO tiene B (capturar todo).
    await expect(capturarProcesoAjeno(sesion)).rejects.toBeInstanceOf(ErrorPermiso);
    await expect(saleComoResponsableDeTodo(sesion)).resolves.toBe(false);
    await expect(editarOcAutorizada(sesion)).rejects.toBeInstanceOf(ErrorConflicto);
    await expect(prenderBanderaPt(sesion)).resolves.toBe(false);
  });

  it('`compras.editar-autorizada` edita la OC firmada… y no toca la RC ni la bandera', async () => {
    const sesion = sesionCon('compras.editar-autorizada');

    // Su puerta.
    await editarOcAutorizada(sesion);
    const oc = await cliente.ordenCompra.findUniqueOrThrow({ where: { id: idOcAutorizada } });
    expect(oc.observaciones).toBe('tocada');

    // Las ajenas.
    await expect(capturarProcesoAjeno(sesion)).rejects.toBeInstanceOf(ErrorPermiso);
    await expect(bandejaTraeLaTareaAjena(sesion)).resolves.toBe(false);
    await expect(prenderBanderaPt(sesion)).resolves.toBe(false);
  });

  it('`tipos-proceso.marcar-entrada-pt` mueve la bandera… y nada más', async () => {
    const sesion = sesionCon('tipos-proceso.marcar-entrada-pt');

    // Su puerta.
    await expect(prenderBanderaPt(sesion)).resolves.toBe(true);

    // Las ajenas.
    await expect(capturarProcesoAjeno(sesion)).rejects.toBeInstanceOf(ErrorPermiso);
    await expect(bandejaTraeLaTareaAjena(sesion)).resolves.toBe(false);
    await expect(editarOcAutorizada(sesion)).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('⭐ el badge "tú" sigue a la CAPTURA, no a la bandeja (rutaOrden.ts)', async () => {
    // `esResponsableActual` contesta «¿este proceso me toca?». Si divergiera de lo que contesta
    // `exigirCapturaProceso`, la pantalla mentiría: badge sin captura ⇒ 403 al pulsar; captura sin
    // badge ⇒ puede hacerlo y nadie se lo dice. Por eso comparten clave — y por eso se mide.
    await expect(saleComoResponsableDeTodo(sesionCon('rc.capturar-cualquiera'))).resolves.toBe(
      true,
    );
    await expect(saleComoResponsableDeTodo(sesionCon('rc.bandeja-completa'))).resolves.toBe(false);
    await expect(saleComoResponsableDeTodo(sesionCon())).resolves.toBe(false);
  });

  it('🔴 `roles.administrar` A SECAS ya NO abre ninguna de las cinco puertas', async () => {
    // El control negativo de toda la fila: si esto pasara a verde, el interruptor volvió.
    const sesion = sesionCon('roles.administrar');

    await expect(capturarProcesoAjeno(sesion)).rejects.toBeInstanceOf(ErrorPermiso);
    await expect(saleComoResponsableDeTodo(sesion)).resolves.toBe(false);
    await expect(bandejaTraeLaTareaAjena(sesion)).resolves.toBe(false);
    await expect(editarOcAutorizada(sesion)).rejects.toBeInstanceOf(ErrorConflicto);
    await expect(prenderBanderaPt(sesion)).resolves.toBe(false);
  });

  it('⭐ las CUATRO llaves juntas bastan: `roles.administrar` ya no hace falta para nada', async () => {
    // La mitad simétrica del control negativo de arriba. Aquélla dice que el interruptor viejo ya
    // no abre nada; ésta, que las llaves nuevas abren TODO lo que él abría — sin él. Entre las dos
    // queda demostrado que la facultad se mudó entera, y no que se duplicó en dos sitios.
    const sesion = sesionCon(...LLAVES_NUEVAS);

    await expect(bandejaTraeLaTareaAjena(sesion)).resolves.toBe(true);
    await expect(saleComoResponsableDeTodo(sesion)).resolves.toBe(true);
    await expect(prenderBanderaPt(sesion)).resolves.toBe(true);
    await editarOcAutorizada(sesion);
    // La captura va al final: completa el renglón y dejaría a las demás sin tarea activa.
    await expect(capturarProcesoAjeno(sesion)).resolves.toBeUndefined();
  });

  it('sin ninguna llave nueva, las cinco puertas están cerradas (deny-by-default, A4)', async () => {
    const sesion = sesionCon();

    await expect(capturarProcesoAjeno(sesion)).rejects.toBeInstanceOf(ErrorPermiso);
    await expect(saleComoResponsableDeTodo(sesion)).resolves.toBe(false);
    await expect(bandejaTraeLaTareaAjena(sesion)).resolves.toBe(false);
    await expect(editarOcAutorizada(sesion)).rejects.toBeInstanceOf(ErrorConflicto);
    await expect(prenderBanderaPt(sesion)).resolves.toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. EQUIVALENCIA HACIA ATRÁS — quien hoy puede, sigue pudiendo
// ─────────────────────────────────────────────────────────────────────────────

describe('⭐ equivalencia: el ADMINISTRADOR de hoy sigue pudiendo las cinco cosas', () => {
  it('una sesión con el catálogo COMPLETO (perfil Administrador) abre las cinco puertas', async () => {
    // El perfil `Administrador` del seed lleva `[...CLAVES_PERMISO]` (ver prisma/seed.ts): aquí se
    // usa EL CATÁLOGO ENTERO, no una lista escrita a mano, para que la prueba no se quede corta si
    // mañana aparece una sexta facultad. Es la comprobación de que la fila no le quitó nada a quien
    // ya lo tenía. El reparto —que las cuatro llaves nuevas caigan en ESE perfil y sólo en él— lo
    // mide aparte `src/datos/reparto-de-permisos.test.ts`, que lee el seed en vez de suponerlo.
    const admin = sesionDePrueba({
      id: idUsuarioSinRoles,
      idEmpresaActiva: empresa.id,
      permisos: [...CLAVES_PERMISO],
    });

    await expect(bandejaTraeLaTareaAjena(admin)).resolves.toBe(true);
    await expect(saleComoResponsableDeTodo(admin)).resolves.toBe(true);
    await expect(prenderBanderaPt(admin)).resolves.toBe(true);
    await editarOcAutorizada(admin);
    expect(
      (await cliente.ordenCompra.findUniqueOrThrow({ where: { id: idOcAutorizada } }))
        .observaciones,
    ).toBe('tocada');
    // La captura va al final: cierra el renglón y dejaría a las demás sin tarea activa.
    await expect(capturarProcesoAjeno(admin)).resolves.toBeUndefined();
  });
});
