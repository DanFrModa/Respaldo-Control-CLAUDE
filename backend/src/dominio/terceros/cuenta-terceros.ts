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
  esquemaMovimientoTerceroCrear,
  esquemaMovimientoTerceroCancelar,
  esquemaEstadoCuentaTerceroQuery,
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
import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { siguienteFolio } from '../../comun/secuencias.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

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

/** Proyecta un movimiento del MOTOR (fuente "motor") a la forma del contrato; oculta el monto si aplica. */
function aMovimientoSalida(
  m: MovimientoConTercero,
  puedeVerImportes: boolean,
): MovimientoTerceroSalida {
  const nombre = m.cliente?.nombre ?? m.proveedor?.nombre ?? '';
  const idTercero = m.idCliente ?? m.idProveedor ?? 0;
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
        ...(datos.observaciones === undefined ? {} : { observaciones: datos.observaciones }),
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
  return aMovimientoSalida(creado, puedeVerImportes);
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

  return aMovimientoSalida(inverso, puedeVerImportes);
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
  const movimientosMotor = filasMotor.map((m) => aMovimientoSalida(m, puedeVerImportes));

  // Convivencia EsMa (solo proveedor y solo si NO se filtra por un origen concreto del motor).
  const movimientosEsMa =
    tipoTercero === 'proveedor' && filtros.origen === undefined
      ? await proyectarMovimientosEsMa(cliente, idEmpresa, idTercero, nombre, {
          desde: filtros.desde,
          hasta: filtros.hasta,
          // EsMa marca el segmento en su propia columna `conFactura`; el proyector la traduce.
          segmento,
          puedeVerImportes,
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
