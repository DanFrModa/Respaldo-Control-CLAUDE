/**
 * MOTOR de cuenta corriente de terceros (F9-E1; D12/D15/R10; doc
 * `Documentacion_MJD/PROPUESTA-Finanzas-y-Proveedores.md` §3). El corazón de la fase F9: un ÚNICO
 * libro de movimientos por tercero del que cuelgan CxC (clientes), CxP (proveedores) y —por
 * convivencia de lectura— EsMa (F6). Toda la lógica de negocio vive AQUÍ (A1); las rutas delegan.
 *
 * Reglas de oro:
 *  • `saldo(tercero) = Σ monto` (con el signo ya aplicado por `signoDeOrigen`), NUNCA una columna
 *    editable (D3). NO existe ninguna operación que "ponga" el saldo: solo se registran movimientos.
 *  • El API recibe `importe` POSITIVO; el servidor le pone el signo por el `origen`.
 *  • DOS vistas = dos FILTROS del mismo libro: operativa (todo) y fiscal (`esFiscal`). No dos libros.
 *  • Cancelación = movimiento INVERSO auditado (D3/A7), NUNCA edición/borrado (patrón kardex).
 *  • Para un PROVEEDOR, el saldo y el estado de cuenta INCLUYEN EsMa (convivencia, opción b) sin
 *    migrar datos: `convivencia-esma.ts` reusa la fórmula de F6 → no-regresión de los saldos.
 *
 * Innegociables: A1 (lógica aquí), A2 (alta/cancelación en una transacción con bitácora), A3 (folio
 * por secuencia atómica), A4 (`terceros.ver`/`.administrar`/`.fiscal`), A7 (bitácora), A9 (empresa
 * activa), D3 (saldo derivado). Los IMPORTES se ocultan (null) si falta `consultas.ver-importes`.
 */
import {
  esquemaCorreccionSinFactura,
  esquemaMovimientoTerceroCrear,
  esquemaMovimientoTerceroCancelar,
  esquemaEstadoCuentaTerceroQuery,
  type DatosCorreccionSinFactura,
  type DatosMovimientoTerceroCrear,
  type DatosMovimientoTerceroCancelar,
  type EstadoCuentaTerceroQuery,
  type MovimientoTerceroSalida,
  type SaldoTerceroSalida,
  type EstadoCuentaTerceroSalida,
  type TipoTerceroClave,
} from '../../contrato/index.js';
import { type Prisma, type OrigenMovimientoTercero, type TipoTercero } from '../../datos/index.js';
import type { z } from 'zod';

import { datosCreacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import {
  tienePermiso,
  verificarCorrectorSinFactura,
  verificarPermiso,
  type SesionUsuario,
} from '../../comun/permisos.js';
import { siguienteFolio } from '../../comun/secuencias.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

import {
  esCorregibleMotor,
  importeGuardadoDe,
  MENSAJE_TIENE_FACTURA,
  MENSAJE_SIN_CAMBIOS,
  resolverCambios,
} from '../finanzas/correccion-comun.js';
import { esOrigenCargo, signoDeOrigen } from './origen-tercero.js';
import { resolverEsFiscalMotor } from './segmento-motor.js';
import { exigirTercero, obtenerNombreTercero } from './terceros.js';
import { aporteEsMaSaldo, proyectarMovimientosEsMa } from './convivencia-esma.js';
import { segmentoWhere } from './cxp/facturacion-cxp.js';

/**
 * Clave de la secuencia de folios del motor de terceros (A3, por empresa). Se exporta para que el
 * MODO MIGRACIÓN (F9-E6, `terceros/migracion.ts`) reserve el bloque de folios sobre la MISMA serie
 * que el alta normal — una sola numeración por empresa, sin series paralelas.
 */
export const CLAVE_SECUENCIA_TERCERO = 'movimiento-tercero';

/**
 * Bloqueo por MOVIMIENTO dentro de la transacción de cancelación (concurrencia, D3). Serializa dos
 * cancelaciones del MISMO movimiento: solo una crea el inverso; la otra, al re-leer bajo READ
 * COMMITTED, ve `cancelado=true` y falla limpio (`ErrorConflicto`) en vez de crear un segundo inverso
 * (el write-skew vetado en F8-E3/E4). Mismo patrón que `esma/pagos.ts`, con namespace propio. El id
 * del movimiento es único global, así que basta como segunda clave. Se libera al commit. La defensa
 * en profundidad es el índice único sobre `idMovimientoInverso`.
 */
async function bloquearMovimiento(tx: Tx, id: number): Promise<void> {
  const NAMESPACE = 0x54430001; // "TC1": cancelación de movimiento de tercero (distinto del de EsMa)
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NAMESPACE}::int, ${id}::int)`;
}

/** Convierte un `YYYY-MM-DD` al `Date` UTC que Prisma guarda en `@db.Date`. */
function aDateColumna(valor: string): Date {
  return new Date(`${valor}T00:00:00.000Z`);
}

/** Redondeo monetario a 2 decimales. */
function redondear2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** `include` para proyectar un movimiento con el nombre del tercero. */
const incluirTercero = {
  cliente: { select: { nombre: true } },
  proveedor: { select: { nombre: true } },
} satisfies Prisma.MovimientoTerceroInclude;

type MovimientoConTercero = Prisma.MovimientoTerceroGetPayload<{ include: typeof incluirTercero }>;

/** Lo que la proyección necesita saber de QUIEN pregunta (no del movimiento). */
interface ContextoProyeccion {
  puedeVerImportes: boolean;
  /** Bandera de la persona (fila 0.145): decide el `corregible` de cada renglón. */
  puedeCorregir: boolean;
}

/** Proyecta un movimiento del MOTOR (fuente "motor") a la forma del contrato; oculta el monto si aplica. */
function aMovimientoSalida(
  m: MovimientoConTercero,
  ctx: ContextoProyeccion,
): MovimientoTerceroSalida {
  const { puedeVerImportes } = ctx;
  const nombre = m.cliente?.nombre ?? m.proveedor?.nombre ?? '';
  const idTercero = m.idCliente ?? m.idProveedor ?? 0;
  const corregible = esCorregibleMotor(m, ctx.puedeCorregir);
  return {
    fuente: 'motor',
    id: m.id,
    idEmpresa: m.idEmpresa,
    folio: Number(m.folio),
    tipoTercero: m.tipoTercero,
    idTercero,
    tercero: nombre,
    fecha: m.fecha.toISOString().slice(0, 10),
    origen: m.origen,
    monto: puedeVerImportes ? m.monto.toNumber() : null,
    fechaVencimiento:
      m.fechaVencimiento === null ? null : m.fechaVencimiento.toISOString().slice(0, 10),
    esFiscal: m.esFiscal,
    uuidCfdi: m.uuidCfdi,
    rfcTercero: m.rfcTercero,
    idArchivoCfdi: m.idArchivoCfdi,
    refTipo: m.refTipo,
    refId: m.refId,
    observaciones: m.observaciones,
    cancelado: m.cancelado,
    esInverso: m.idMovimientoInverso !== null,
    idMovimientoCorregido: m.idMovimientoCorregido,
    // En el motor el texto que se lee y el que está guardado son el mismo (no hay adornos).
    observacionesGuardadas: m.observaciones,
    // POSITIVO siempre, y oculto sólo por permiso. La regla vive en `importeGuardadoDe`, compartida
    // con EsMa: cuando estaba escrita a mano en cada sitio, el motor la cumplía y EsMa no.
    importeGuardado: importeGuardadoDe(m.monto.toNumber(), puedeVerImportes),
    corregible,
    // Un movimiento del motor no está aplicado a nada: si se corrige, se corrige entero.
    importeCorregible: corregible,
    creadoEn: m.creadoEn.toISOString(),
    creadoPorId: m.creadoPorId,
  };
}

/**
 * Fecha de VENCIMIENTO derivada (aging D15d): solo los CARGOS vencen (fecha + días de crédito del
 * tercero). Los ABONOS/pagos no vencen → null. Un tercero de contado (0 días) vence el mismo día.
 *
 * Se exporta para que el MODO MIGRACIÓN (F9-E6) derive el vencimiento con la MISMA fórmula que el
 * alta normal (A1: un solo lugar de verdad del aging — nunca se recalcula en el ETL).
 */
export function calcularVencimiento(
  origen: OrigenMovimientoTercero,
  fecha: Date,
  diasCredito: number,
): Date | null {
  if (!esOrigenCargo(origen)) {
    return null;
  }
  return new Date(fecha.getTime() + diasCredito * 86_400_000);
}

/** Los dos campos scalar del tercero según el tipo (D15a: exactamente uno poblado). */
function camposTercero(
  tipoTercero: TipoTercero,
  idTercero: number,
): { idCliente: number | null; idProveedor: number | null } {
  return tipoTercero === 'cliente'
    ? { idCliente: idTercero, idProveedor: null }
    : { idCliente: null, idProveedor: idTercero };
}

// ── Alta de un movimiento ──────────────────────────────────────────────────────────────────────────

/**
 * Registra un movimiento de cuenta corriente de un tercero (A2/A3/A7). El servidor resuelve el signo
 * del `monto` por el `origen` (`signoDeOrigen`) y deriva la fecha de vencimiento (aging). Permiso
 * `terceros.administrar` (A4). Empresa activa (A9).
 */
export async function registrarMovimientoTercero(
  sesion: SesionUsuario,
  entrada: z.input<typeof esquemaMovimientoTerceroCrear>,
  bd?: ContextoBd,
): Promise<MovimientoTerceroSalida> {
  verificarPermiso(sesion, 'terceros.administrar');
  return registrarMovimientoTerceroInterno(sesion, entrada, bd);
}

/**
 * MISMO alta, SIN el guard de permiso. **Uso interno del dominio, jamás desde una ruta REST.**
 *
 * Existe para los cargos que nacen como CONSECUENCIA de un acto ya autorizado por otro permiso
 * (§Post-F9.15 punto (a), resuelto en §Post-F9.21): quien confirma una entrada de tela tiene
 * `inventario-telas.mover`, no `terceros.administrar`, y exigirle el segundo permiso obligaría a que
 * Finanzas capturara a mano la cuenta por pagar de cada factura que ya se recibió — justo lo que
 * Daniel pidió evitar. El llamador YA verificó el permiso de SU operación y corre dentro de SU
 * transacción; aquí solo se registra el movimiento.
 */
export async function registrarMovimientoTerceroInterno(
  sesion: SesionUsuario,
  entrada: z.input<typeof esquemaMovimientoTerceroCrear>,
  bd?: ContextoBd,
  /**
   * Columnas que NO son parte del contrato del API y sólo puede poner el dominio. Van como parámetro
   * aparte —y no como campos más de `entrada`— justamente para que ninguna ruta pueda mandarlas.
   *
   *  • `idMovimientoCorregido` (fila 0.145): el movimiento nuevo apunta al que sustituye.
   *
   *  • `observacionesConservadas` (fila 0.145): la nota que la corrección **ARRASTRA** tal cual,
   *    porque el usuario no la tocó. Va por aquí y NO por `entrada` para que **no se vuelva a
   *    validar**: `esquemaMovimientoTerceroCrear` limita las observaciones a 1000 caracteres, pero
   *    el ETL de apertura las escribe **sin validar ninguna** (`terceros/migracion.ts`, un
   *    `createManyAndReturn` que no pasa por Zod) desde una columna de texto libre del CSV
   *    (`migracion/loaders/terceros-saldos.ts`). Reenviándola por `entrada`, corregir **sólo la
   *    fecha** de un movimiento migrado con una nota larga devolvería **400 por un campo que el
   *    usuario ni tocó** — el mismo defecto que el cajón tenía con el importe, ahora del lado del
   *    servidor. Lo que el usuario PROPONE sí viaja por `entrada` y sí se valida: es entrada suya.
   */
  extras?: { idMovimientoCorregido?: number; observacionesConservadas?: string },
): Promise<MovimientoTerceroSalida> {
  const datos: DatosMovimientoTerceroCrear = validarEntrada(esquemaMovimientoTerceroCrear, entrada);
  const idEmpresa = sesion.idEmpresaActiva;
  const puedeVerImportes = tienePermiso(sesion, 'consultas.ver-importes');

  const creado = await enTransaccion(async (tx) => {
    const tercero = await exigirTercero(tx, datos.tipoTercero, datos.idTercero);

    const origen = datos.origen;
    const fecha = aDateColumna(datos.fecha);
    // El signo lo pone el origen; el importe llega positivo (validado por Zod).
    const monto = redondear2(signoDeOrigen(origen) * datos.importe);
    // SEGMENTO con/sin factura (fila 0.110): si el llamador no lo dijo, lo deriva la modalidad del
    // proveedor —y si no tiene modalidad, se rechaza la captura en vez de elegir "sin factura" en
    // silencio—. Lo dicho explícitamente se respeta: ver el TSDoc de `segmento-motor.ts`. La
    // modalidad viene de `exigirTercero`, leída en ESTA misma transacción.
    const esFiscal = resolverEsFiscalMotor(
      datos.tipoTercero,
      tercero.modalidadFacturacion,
      datos.esFiscal,
    );
    const fechaVencimiento = calcularVencimiento(origen, fecha, tercero.diasCredito);
    const folio = await siguienteFolio(tx, idEmpresa, CLAVE_SECUENCIA_TERCERO);

    const fila = await tx.movimientoTercero.create({
      data: {
        idEmpresa,
        folio,
        tipoTercero: datos.tipoTercero,
        ...camposTercero(datos.tipoTercero, datos.idTercero),
        fecha,
        origen,
        monto,
        fechaVencimiento,
        esFiscal,
        ...(datos.uuidCfdi === undefined ? {} : { uuidCfdi: datos.uuidCfdi }),
        ...(datos.rfcTercero === undefined ? {} : { rfcTercero: datos.rfcTercero }),
        ...(datos.idArchivoCfdi === undefined ? {} : { idArchivoCfdi: datos.idArchivoCfdi }),
        ...(datos.refTipo === undefined ? {} : { refTipo: datos.refTipo }),
        ...(datos.refId === undefined ? {} : { refId: datos.refId }),
        // Las dos fuentes de la nota son EXCLUYENTES por construcción (ver `extras`): la propuesta
        // por el usuario pasa por Zod; la arrastrada por una corrección, no.
        ...(datos.observaciones === undefined ? {} : { observaciones: datos.observaciones }),
        ...(extras?.observacionesConservadas === undefined
          ? {}
          : { observaciones: extras.observacionesConservadas }),
        ...(extras?.idMovimientoCorregido === undefined
          ? {}
          : { idMovimientoCorregido: extras.idMovimientoCorregido }),
        ...datosCreacion(sesion),
      },
      include: incluirTercero,
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'MovimientoTercero',
      idEntidad: fila.id,
      accion: 'CREAR',
      datos: {
        tipoTercero: datos.tipoTercero,
        idTercero: datos.idTercero,
        origen,
        monto,
        esFiscal,
      },
    });

    return fila;
  }, bd);

  // Se proyecta el creado directamente (no se re-consulta con `terceros.ver`: quien administra ya
  // registró; el retorno no debe exigir un permiso adicional).
  return aMovimientoSalida(creado, {
    puedeVerImportes,
    puedeCorregir: sesion.puedeCorregirSinFactura,
  });
}

// ── Cancelación (inverso auditado) ───────────────────────────────────────────────────────────────

/**
 * Cancela un movimiento por su INVERSO auditado (D3/A7): crea un movimiento con el monto negado, lo
 * enlaza al original (`idMovimientoInverso`) y marca el original `cancelado`. NUNCA edita/borra. Un
 * movimiento ya cancelado, o que es él mismo un inverso, no se puede cancelar (`ErrorConflicto`). El
 * inverso NO copia el `uuidCfdi` (único) — un CFDI no se duplica; el saldo (operativo y fiscal) neta
 * porque original + inverso suman 0. Permiso `terceros.administrar` (A4). Empresa activa (A9).
 */
export async function cancelarMovimientoTercero(
  sesion: SesionUsuario,
  id: number,
  cuerpo: z.input<typeof esquemaMovimientoTerceroCancelar>,
  bd?: ContextoBd,
): Promise<MovimientoTerceroSalida> {
  verificarPermiso(sesion, 'terceros.administrar');
  return cancelarMovimientoTerceroInterno(sesion, id, cuerpo, bd);
}

/**
 * MISMA cancelación, SIN el guard de permiso. **Uso interno del dominio, jamás desde una ruta REST.**
 * El espejo de {@link registrarMovimientoTerceroInterno}: si un acto autorizado creó el cargo (la
 * confirmación de una entrada de tela), DESHACER ese acto tiene que poder deshacerlo, o la cuenta
 * por pagar quedaría con un cargo de una entrada cancelada.
 */
export async function cancelarMovimientoTerceroInterno(
  sesion: SesionUsuario,
  id: number,
  cuerpo: z.input<typeof esquemaMovimientoTerceroCancelar>,
  bd?: ContextoBd,
): Promise<MovimientoTerceroSalida> {
  const datos: DatosMovimientoTerceroCancelar = validarEntrada(
    esquemaMovimientoTerceroCancelar,
    cuerpo,
  );
  const idEmpresa = sesion.idEmpresaActiva;
  const puedeVerImportes = tienePermiso(sesion, 'consultas.ver-importes');

  const inverso = await enTransaccion(async (tx) => {
    // Serializa las cancelaciones del MISMO movimiento ANTES de leer sus guardas (D3): dos
    // cancelaciones concurrentes no pueden crear dos inversos (la 2ª ve `cancelado=true` y falla).
    await bloquearMovimiento(tx, id);
    const original = await tx.movimientoTercero.findFirst({
      where: { id, idEmpresa },
      select: {
        id: true,
        tipoTercero: true,
        idCliente: true,
        idProveedor: true,
        fecha: true,
        origen: true,
        monto: true,
        esFiscal: true,
        rfcTercero: true,
        cancelado: true,
        idMovimientoInverso: true,
      },
    });
    if (original === null) {
      throw new ErrorNoEncontrado('MovimientoTercero', id);
    }
    if (original.idMovimientoInverso !== null) {
      throw new ErrorConflicto(
        'Ese movimiento es un inverso de cancelación: no se puede cancelar.',
      );
    }
    if (original.cancelado) {
      throw new ErrorConflicto('Ese movimiento ya está cancelado.');
    }

    const folio = await siguienteFolio(tx, idEmpresa, CLAVE_SECUENCIA_TERCERO);
    const creado = await tx.movimientoTercero.create({
      data: {
        idEmpresa,
        folio,
        tipoTercero: original.tipoTercero,
        idCliente: original.idCliente,
        idProveedor: original.idProveedor,
        // El inverso se fecha HOY (es un hecho nuevo — patrón kardex); el saldo neta all-time.
        fecha: new Date(),
        origen: original.origen,
        monto: redondear2(-original.monto.toNumber()),
        // El reverso no vence; conserva la marca fiscal para que la vista fiscal también nete.
        fechaVencimiento: null,
        esFiscal: original.esFiscal,
        ...(original.rfcTercero === null ? {} : { rfcTercero: original.rfcTercero }),
        refTipo: 'cancelacion',
        refId: original.id,
        idMovimientoInverso: original.id,
        observaciones: datos.motivo,
        ...datosCreacion(sesion),
      },
      include: incluirTercero,
    });

    await tx.movimientoTercero.update({
      where: { id: original.id },
      data: { cancelado: true, modificadoPorId: sesion.id },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'MovimientoTercero',
      idEntidad: original.id,
      accion: 'CANCELAR',
      datos: {
        folioInverso: folio.toString(),
        idMovimientoInverso: creado.id,
        motivo: datos.motivo,
      },
    });

    return creado;
  }, bd);

  return aMovimientoSalida(inverso, {
    puedeVerImportes,
    puedeCorregir: sesion.puedeCorregirSinFactura,
  });
}

// ── CORRECCIÓN de un movimiento SIN FACTURA (fila 0.145) ──────────────────────────────────────────

/**
 * ⭐⭐ CORRIGE un movimiento SIN FACTURA del libro: **anula el viejo y captura el bueno**, en UNA
 * transacción (A2), ligados entre sí.
 *
 * DANIEL (6-sep-2026, §Post-F9.203): *«Quiero tener manera de modificar cualquier registro que se
 * meta en cualquier estado de cuenta de los proveedores sin factura. **Sólo yo. Nadie más ni con
 * permiso. Sólo yo.**»* Sobre la forma, tras plantearle el costo: *«Sí, está bien **con rastro**.»*
 *
 * ## Se COMPONE de lo que ya existía, no lo reimplementa
 *
 * La corrección es exactamente {@link cancelarMovimientoTerceroInterno} seguido de
 * {@link registrarMovimientoTerceroInterno}, dentro de la misma transacción. Eso no es una
 * comodidad: es lo que garantiza que la corrección herede el folio por secuencia atómica (A3), el
 * signo por origen, el bloqueo por movimiento, el inverso auditado (D3) y la bitácora (A7) —sin una
 * segunda copia de esas reglas que se pueda quedar atrás—.
 *
 * ## Qué cambia y qué NO
 *
 * Cambian el **importe**, la **fecha** y las **observaciones**. El tercero, el origen y el segmento
 * se toman del movimiento corregido y no de la petición: cambiar de proveedor o de concepto no es
 * corregir un renglón, es otro renglón (y para eso ya está cancelar + capturar).
 *
 * La `refTipo`/`refId` del original SÍ se copian: siguen apuntando a la operación real que originó
 * el movimiento (una recepción, una corrida de pagos). La liga de la corrección vive en su propia
 * columna, `idMovimientoCorregido`, para no pisar aquélla.
 *
 * ## Las guardas
 *
 *  • **la BANDERA de la persona** ({@link verificarCorrectorSinFactura}), que no es un permiso y no
 *    se reparte con ningún rol;
 *  • **`terceros.administrar`**, además: la bandera abre una puerta nueva, no exime de poder operar
 *    la cuenta corriente. Falla CERRADO;
 *  • **SIN FACTURA de verdad**: `esFiscal = false` y sin UUID ni archivo de CFDI colgando. Un
 *    renglón con comprobante fiscal queda intocable **aunque sea del mismo proveedor** — el segmento
 *    es del MOVIMIENTO, no del tercero (un proveedor `ambos` tiene de los dos);
 *  • vivo y no siendo él mismo un inverso de cancelación (eso lo re-verifica el cancelador).
 *
 * ## 🔴 NO SE REVALIDA LO QUE NADIE PROPUSO — y por qué importa el día del ETL de apertura
 *
 * La nota del movimiento viaja por DOS caminos distintos según de quién sea:
 *
 *  • la que el usuario **PROPONE** va por `entrada` y la valida Zod (`.max(1000)`), como toda
 *    captura suya;
 *  • la que sólo se **ARRASTRA** —porque él no la tocó— va por `extras.observacionesConservadas`,
 *    el canal del dominio, y **no se vuelve a validar**.
 *
 * ⚠️ **No es una sutileza: es un 400 esperando fecha.** El ETL de apertura de terceros escribe las
 * observaciones **sin validar ninguna** ({@link insertarAperturasMigradas} inserta con
 * `createManyAndReturn`, que no pasa por Zod) desde una columna de texto libre del CSV
 * (`migracion/loaders/terceros-saldos.ts`). Reenviando siempre la nota por `entrada`, corregir
 * **sólo la fecha** de un movimiento migrado con una nota de más de 1000 caracteres fallaba con
 * *«Too big: expected string to have <=1000 characters»* — **por un campo que el usuario ni tocó**.
 * Es la misma forma del defecto que el cajón tenía con el importe, del lado del servidor.
 *
 * 🔑 Y la otra mitad, que la prueba también pinza: **no revalidarla no puede significar perderla**.
 * Si la nota arrastrada no se pasara por ningún camino, corregir la fecha borraría la nota en
 * silencio — un defecto peor que el que se venía a arreglar.
 */
export async function corregirMovimientoTercero(
  sesion: SesionUsuario,
  id: number,
  cuerpo: z.input<typeof esquemaCorreccionSinFactura>,
  bd?: ContextoBd,
): Promise<MovimientoTerceroSalida> {
  verificarCorrectorSinFactura(sesion);
  verificarPermiso(sesion, 'terceros.administrar');
  const datos: DatosCorreccionSinFactura = validarEntrada(esquemaCorreccionSinFactura, cuerpo);
  const idEmpresa = sesion.idEmpresaActiva;

  return enTransaccion(async (tx) => {
    const original = await tx.movimientoTercero.findFirst({
      where: { id, idEmpresa },
      select: {
        id: true,
        tipoTercero: true,
        idCliente: true,
        idProveedor: true,
        fecha: true,
        origen: true,
        monto: true,
        esFiscal: true,
        uuidCfdi: true,
        idArchivoCfdi: true,
        refTipo: true,
        refId: true,
        observaciones: true,
        cancelado: true,
        idMovimientoInverso: true,
      },
    });
    if (original === null) {
      throw new ErrorNoEncontrado('MovimientoTercero', id);
    }
    // La BANDERA ya se verificó arriba (y lanzó 403 si faltaba), así que aquí se pasa `true`: lo que
    // queda por comprobar son las condiciones del RENGLÓN. Es la MISMA función que decide el
    // `corregible` de cada fila del estado de cuenta, para que la pantalla y el servidor no puedan
    // contestar distinto.
    if (!esCorregibleMotor(original, true)) {
      // El mensaje distingue los dos motivos, porque el remedio de cada uno es distinto.
      throw new ErrorConflicto(
        original.esFiscal || original.uuidCfdi !== null || original.idArchivoCfdi !== null
          ? MENSAJE_TIENE_FACTURA
          : 'Ese movimiento ya está cancelado, o es el inverso de una cancelación: no se corrige.',
      );
    }

    // El `monto` guardado lleva el SIGNO del origen; el importe que se corrige es POSITIVO (igual
    // que en el alta). Se compara en positivo y el signo lo vuelve a poner el motor.
    const antes = {
      monto: Math.abs(original.monto.toNumber()),
      fecha: original.fecha.toISOString().slice(0, 10),
      observaciones: original.observaciones,
    };
    const cambios = resolverCambios(antes, datos);
    if (!cambios.hayCambio) {
      throw new ErrorValidacion(MENSAJE_SIN_CAMBIOS);
    }
    // ¿La nota es ENTRADA del usuario, o sólo se arrastra? De eso depende si se valida o no.
    const propusoObservaciones = datos.observaciones !== undefined;

    await cancelarMovimientoTerceroInterno(sesion, id, { motivo: datos.motivo }, { tx });

    const idTercero = original.idCliente ?? original.idProveedor;
    if (idTercero === null) {
      // Imposible por el CHECK de exclusividad, pero el tipo lo admite: mejor un error claro que un
      // `!` que mienta.
      throw new ErrorConflicto('El movimiento no apunta a ningún tercero.');
    }
    const nuevo = await registrarMovimientoTerceroInterno(
      sesion,
      {
        tipoTercero: original.tipoTercero,
        idTercero,
        fecha: cambios.fecha,
        origen: original.origen,
        importe: cambios.monto,
        // Explícito: el corregido conserva el segmento del corregido (que es SIN factura, por la
        // guarda de arriba). No se deja derivar de la modalidad del proveedor, para que corregir
        // nunca pueda mover un renglón de segmento sin que nadie lo pida.
        esFiscal: false,
        ...(original.refTipo === null ? {} : { refTipo: original.refTipo }),
        ...(original.refId === null ? {} : { refId: original.refId }),
        // 🔴 LA NOTA SÓLO PASA POR EL CONTRATO SI EL USUARIO LA PROPUSO. Si sólo se arrastra, viaja
        // por `extras` —el canal del dominio— y NO se vuelve a validar: ver el TSDoc de
        // `registrarMovimientoTerceroInterno`. Reenviarla siempre por aquí hacía que corregir la
        // fecha de un movimiento MIGRADO con una nota de más de 1000 caracteres fallara con 400 por
        // un campo que nadie tocó. Es el mismo principio que el cajón aplica al importe: **no se
        // revalida lo que nadie propuso.**
        ...(propusoObservaciones && cambios.observaciones !== null
          ? { observaciones: cambios.observaciones }
          : {}),
      },
      { tx },
      {
        idMovimientoCorregido: original.id,
        ...(!propusoObservaciones && cambios.observaciones !== null
          ? { observacionesConservadas: cambios.observaciones }
          : {}),
      },
    );

    // A7 «con rastro»: qué decía ANTES, qué dice ahora, quién y por qué. Va sobre el movimiento
    // CORREGIDO (el viejo), que es el que alguien va a ir a buscar cuando pregunte qué pasó.
    await registrarBitacora(tx, sesion, {
      entidad: 'MovimientoTercero',
      idEntidad: original.id,
      accion: 'MODIFICAR',
      datos: {
        operacion: 'corregir-sin-factura',
        motivo: datos.motivo,
        idNuevo: nuevo.id,
        antes,
        despues: {
          monto: cambios.monto,
          fecha: cambios.fecha,
          observaciones: cambios.observaciones,
        },
      },
    });

    return nuevo;
  }, bd);
}

// ── Saldo derivado ──────────────────────────────────────────────────────────────────────────────────

/**
 * Calcula el SALDO derivado de un tercero (D3): `saldo = Σ monto` del motor + (para un proveedor) el
 * aporte de EsMa (convivencia). Devuelve el desglose operativo/fiscal + el aporte de cada fuente.
 * Permiso `terceros.ver` (A4). Los importes se ocultan (null) sin `consultas.ver-importes`.
 */
export async function calcularSaldoTercero(
  sesion: SesionUsuario,
  tipoTercero: TipoTerceroClave,
  idTercero: number,
  bd?: ContextoBd,
): Promise<SaldoTerceroSalida> {
  verificarPermiso(sesion, 'terceros.ver');
  const cliente = clienteLectura(bd);
  const idEmpresa = sesion.idEmpresaActiva;
  const nombre = await obtenerNombreTercero(cliente, tipoTercero, idTercero);
  const puedeVerImportes = tienePermiso(sesion, 'consultas.ver-importes');

  const filtroTercero = camposTercero(tipoTercero, idTercero);
  // Σ monto del motor: TODOS los movimientos netean (original + inverso suman 0), así el saldo cuadra.
  const [operativo, fiscal] = await Promise.all([
    cliente.movimientoTercero.aggregate({
      where: { idEmpresa, ...filtroTercero },
      _sum: { monto: true },
    }),
    cliente.movimientoTercero.aggregate({
      where: { idEmpresa, ...filtroTercero, esFiscal: true },
      _sum: { monto: true },
    }),
  ]);
  const saldoMovimientos = redondear2(operativo._sum.monto?.toNumber() ?? 0);
  const saldoMovimientosFiscal = redondear2(fiscal._sum.monto?.toNumber() ?? 0);

  // Convivencia EsMa (solo proveedores): reusa la fórmula de F6 → no-regresión de los saldos.
  const esProveedor = tipoTercero === 'proveedor';
  const saldoEsMa = esProveedor ? await aporteEsMaSaldo(cliente, idEmpresa, idTercero, false) : 0;
  const saldoEsMaFiscal = esProveedor
    ? await aporteEsMaSaldo(cliente, idEmpresa, idTercero, true)
    : 0;

  const saldo = redondear2(saldoMovimientos + saldoEsMa);
  const saldoFiscal = redondear2(saldoMovimientosFiscal + saldoEsMaFiscal);
  const oculto = (v: number): number | null => (puedeVerImportes ? v : null);

  return {
    tipoTercero,
    idTercero,
    tercero: nombre,
    saldo: oculto(saldo),
    saldoFiscal: oculto(saldoFiscal),
    // El segmento SIN factura (§Post-F9.57) es el resto: lo calcula el servidor para que la
    // partición en dos tenga UN solo lugar de verdad y nadie la reste a mano en una pantalla.
    saldoSinFactura: oculto(redondear2(saldo - saldoFiscal)),
    saldoMovimientos: oculto(saldoMovimientos),
    saldoEsMa: oculto(saldoEsMa),
    incluyeEsMa: esProveedor,
  };
}

// ── Estado de cuenta (saldo + movimientos paginados, motor + EsMa) ──────────────────────────────────

/**
 * Estado de cuenta de un tercero: su saldo derivado + la página de movimientos (motor + —para un
 * proveedor— EsMa por convivencia), en una línea de tiempo por fecha desc. La vista `fiscal` filtra a
 * los movimientos con CFDI (motor) y con factura (EsMa) y EXIGE `terceros.fiscal` (A4). El
 * `segmento` con/sin factura (V1-E3f pieza B, §Post-F9.57) filtra la MISMA columna pero es
 * OPERATIVO y le basta `terceros.ver`: es la partición que pidió Daniel para los proveedores que
 * *"algunas cosas sean con factura y otras sin factura"*, y no debe quedar tras el candado del
 * contador. Permiso base `terceros.ver`. La mezcla motor+EsMa se pagina en memoria (volumen por tercero moderado, igual que
 * el estado de cuenta de EsMa). Empresa activa (A9). Importes ocultables.
 *
 * ALCANCE DEL PERMISO FISCAL (decisión D12, opción b): `terceros.fiscal` gatea SOLO esta VISTA
 * pre-filtrada (el reporte del contador). Los ATRIBUTOS fiscales de cada renglón (`esFiscal`,
 * `uuidCfdi`, `rfcTercero`, `idArchivoCfdi`) y el `saldoFiscal` SÍ viajan en la vista operativa con
 * `terceros.ver` a propósito — "dos vistas = dos filtros del MISMO libro", coherente con EsMa/F6
 * (la distinción con/sin factura siempre fue visible en el estado de cuenta operativo) y con que el
 * RFC ya es visible en el catálogo de proveedores. Enmascarar esos campos, si se decide, será en E3.
 */
export async function estadoDeCuentaTercero(
  sesion: SesionUsuario,
  tipoTercero: TipoTerceroClave,
  idTercero: number,
  parametros: z.input<typeof esquemaEstadoCuentaTerceroQuery> = {},
  bd?: ContextoBd,
): Promise<EstadoCuentaTerceroSalida> {
  verificarPermiso(sesion, 'terceros.ver');
  const filtros: EstadoCuentaTerceroQuery = validarEntrada(
    esquemaEstadoCuentaTerceroQuery,
    parametros,
  );
  const soloFiscal = filtros.vista === 'fiscal';
  if (soloFiscal) {
    verificarPermiso(sesion, 'terceros.fiscal');
  }
  // La vista fiscal ya es "solo con factura": pedir además `segmento: 'sin'` sería contradictorio
  // y devolvería una lista vacía sin explicar por qué. Se corta con un mensaje claro.
  if (soloFiscal && filtros.segmento === 'sin') {
    throw new ErrorValidacion(
      'La vista fiscal solo muestra movimientos CON factura: no se puede combinar con el segmento ' +
        '"sin factura".',
    );
  }
  const segmento = soloFiscal ? 'con' : filtros.segmento;

  const cliente = clienteLectura(bd);
  const idEmpresa = sesion.idEmpresaActiva;
  const nombre = await obtenerNombreTercero(cliente, tipoTercero, idTercero);
  const puedeVerImportes = tienePermiso(sesion, 'consultas.ver-importes');

  // Renglones del MOTOR (todos los de la empresa+tercero que cumplen el filtro; se paginan luego).
  const where: Prisma.MovimientoTerceroWhereInput = {
    idEmpresa,
    ...camposTercero(tipoTercero, idTercero),
    ...segmentoWhere(segmento),
    ...(filtros.origen === undefined ? {} : { origen: filtros.origen }),
    ...rangoFechaMotor(filtros.desde, filtros.hasta),
    // Se muestra el libro COMPLETO (incluidos cancelados y sus inversos): es el rastro de auditoría
    // fiel, y el saldo neta (original + inverso = 0). Cada renglón trae `cancelado`/`esInverso` para
    // que la UI (E2) los distinga o filtre. NO se ocultan aquí (D3/A7: transparencia).
  };
  const filasMotor = await cliente.movimientoTercero.findMany({
    where,
    include: incluirTercero,
  });
  const movimientosMotor = filasMotor.map((m) =>
    aMovimientoSalida(m, { puedeVerImportes, puedeCorregir: sesion.puedeCorregirSinFactura }),
  );

  // Convivencia EsMa (solo proveedor y solo si NO se filtra por un origen concreto del motor).
  const movimientosEsMa =
    tipoTercero === 'proveedor' && filtros.origen === undefined
      ? await proyectarMovimientosEsMa(cliente, idEmpresa, idTercero, nombre, {
          desde: filtros.desde,
          hasta: filtros.hasta,
          // EsMa marca el segmento en su propia columna `conFactura`; el proyector la traduce.
          segmento,
          puedeVerImportes,
          // Fila 0.145: la bandera de la persona viaja hasta el proyector para que cada renglón
          // EsMa diga si ESTA persona lo puede corregir (el cargo, nunca).
          puedeCorregir: sesion.puedeCorregirSinFactura,
        })
      : [];

  // Línea de tiempo unificada, determinista: fecha desc, luego creadoEn desc, luego id desc.
  const todos = [...movimientosMotor, ...movimientosEsMa].sort(
    (a, b) =>
      b.fecha.localeCompare(a.fecha) ||
      b.creadoEn.localeCompare(a.creadoEn) ||
      b.id - a.id ||
      a.fuente.localeCompare(b.fuente),
  );

  const total = todos.length;
  const inicio = (filtros.pagina - 1) * filtros.porPagina;
  const movimientos = todos.slice(inicio, inicio + filtros.porPagina);

  const saldo = await calcularSaldoTercero(sesion, tipoTercero, idTercero, bd);

  return {
    tipoTercero,
    idTercero,
    tercero: nombre,
    vista: filtros.vista,
    segmento,
    desde: filtros.desde ?? null,
    hasta: filtros.hasta ?? null,
    saldo,
    movimientos,
    total,
    pagina: filtros.pagina,
    porPagina: filtros.porPagina,
    totalPaginas: Math.max(1, Math.ceil(total / filtros.porPagina)),
  };
}

/** Rango sobre la columna `fecha` (@db.Date) del motor, inclusivo en ambos extremos. */
function rangoFechaMotor(
  desde: string | undefined,
  hasta: string | undefined,
): { fecha?: { gte?: Date; lte?: Date } } {
  if (desde === undefined && hasta === undefined) {
    return {};
  }
  return {
    fecha: {
      ...(desde === undefined ? {} : { gte: aDateColumna(desde) }),
      ...(hasta === undefined ? {} : { lte: aDateColumna(hasta) }),
    },
  };
}
