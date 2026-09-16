/**
 * SIEMBRA de los datos ficticios de FINANZAS (ver `migracion/sembrar-demo-finanzas.ts`).
 *
 * 🔴 TODO PASA POR EL DOMINIO (A1). Aquí no hay un solo `prisma.create` de un catálogo, de un
 * movimiento de cuenta corriente, de un pago ni de una corrida: se llaman los MISMOS servicios que
 * usa la aplicación (`crearProveedor`, `crearCuentaPagoProveedor`, `crearCliente`,
 * `crearConceptoPago`, `registrarMovimientoCxp`/`Cxc`, `registrarMovimientoTercero`,
 * `cancelarMovimientoCxp`, `crearAbonoMaquilero`/`crearDescuentoMaquilero`, `crearCorrida`,
 * `guardarRenglonCorrida`, `cerrarCorrida`, `ejecutarCorrida`, `aplicarCotejo`, `atenderCotejo`).
 *
 * La razón no es estética: en Finanzas el **saldo es Σ de movimientos** (D3), el **vencimiento** lo
 * deriva el motor de la fecha + los días de crédito, el **segmento con/sin factura** lo resuelve la
 * modalidad del proveedor, el **folio del documento** lo reparte la secuencia atómica al cerrar la
 * corrida y el **veredicto del cotejo** lo recalcula el dominio por suma directa. Si esto insertara
 * filas a pelo, las pantallas enseñarían números que el motor no reconoce — o sea, una mentira que
 * probar.
 *
 * Lo ÚNICO que se escribe directo es `mapeo_migracion`, que es metadato de la migración y no un dato
 * del negocio (la misma excepción que documenta `migracion/comun/mapeo.ts` y que usa el sembrador de
 * inventarios). Ahí queda anotado cada id sembrado bajo una entidad `Demo:Fin:*`: es lo que hace la
 * corrida IDEMPOTENTE (si la clave ya está mapeada y la fila sigue viva, se salta) y lo que permite
 * el borrado de un golpe.
 *
 * ## El ORDEN importa, y no es casual
 *
 * Las corridas se EJECUTAN antes de que existan las facturas en rojo. Una factura que no cuadra
 * **frena la ejecución** de cualquier corrida donde ese proveedor tenga renglón (§Post-F9.232 (c)):
 * si se sembraran primero las facturas, el propio sembrador se bloquearía a sí mismo — y con razón.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { PrismaClient } from '../../../src/datos/index.js';
import type { SesionUsuario } from '../../../src/comun/permisos.js';
import { ErrorConflicto } from '../../../src/comun/errores.js';

import { crearCliente } from '../../../src/dominio/catalogos/clientes.js';
import { crearConceptoPago } from '../../../src/dominio/catalogos/conceptos-pago.js';
import { crearCuentaPagoProveedor } from '../../../src/dominio/catalogos/proveedor-cuentas-pago.js';
import { crearProveedor } from '../../../src/dominio/catalogos/proveedores.js';
import {
  crearAbonoMaquilero,
  crearDescuentoMaquilero,
  revisarMovimiento,
} from '../../../src/dominio/esma/movimientos.js';
import {
  cerrarCorrida,
  crearCorrida,
  ejecutarCorrida,
  guardarRenglonCorrida,
} from '../../../src/dominio/pagos/corrida.js';
import { aplicarCotejo, atenderCotejo } from '../../../src/dominio/pagos/cotejo.js';
import { registrarMovimientoTercero } from '../../../src/dominio/terceros/cuenta-terceros.js';
import {
  cancelarMovimientoCxp,
  registrarMovimientoCxp,
} from '../../../src/dominio/terceros/cxp/cxp.js';
import { registrarMovimientoCxc } from '../../../src/dominio/terceros/cxc/cxc.js';

import { Reporte } from '../../comun/reporte.js';
import { construirCfdiDemo, totalCfdi } from '../cfdi.js';

import { catalogoCfdiFinanzas } from './cfdi.js';
import {
  CLIENTES_DEMO_FIN,
  CONCEPTOS_DEMO_FIN,
  CORRIDAS_DEMO_FIN,
  ENTIDAD_DEMO_FIN,
  FACTURAS_COTEJO_DEMO,
  MOVIMIENTOS_CXC_DEMO,
  MOVIMIENTOS_CXP_DEMO,
  MOVIMIENTOS_ESMA_DEMO,
  PREFIJO_DEMO_FIN,
  PROVEEDORES_DEMO_FIN,
  type EntidadDemoFin,
  type MovimientoDemoFin,
} from './datos.js';

/** Tamaño de lote de los catálogos (se crean por bloques; cada uno en su transacción). */
const LOTE_CATALOGOS = 10;

/** Orígenes que CxP acepta capturar a mano (el resto va por el motor, como en la aplicación). */
const ORIGENES_CAPTURABLES_CXP = new Set([
  'entrada_sin_factura',
  'nota_credito',
  'pago',
  'abono',
  'descuento',
]);

/** Lo que devuelve una siembra (lo imprime el script y lo leen las pruebas). */
export interface ResultadoSiembraFinanzas {
  proveedores: number;
  cuentasPago: number;
  clientes: number;
  conceptosPago: number;
  movimientosCxp: number;
  movimientosCxc: number;
  movimientosEsMa: number;
  corridas: number;
  renglonesCorrida: number;
  facturasCotejo: number;
  cotejosAplicados: number;
  cfdiEscritos: number;
  /** Lo que ya estaba de una corrida anterior (idempotencia: no se volvió a crear). */
  existentes: number;
  reporte: Reporte;
}

/** Opciones de la corrida. */
export interface OpcionesSiembraFinanzas {
  /** Empresa sobre la que se siembran los DOCUMENTOS (los catálogos son globales, ADR-0007). */
  idEmpresa: number;
  /** Carpeta donde se escriben los XML ficticios. `null` = no escribir ninguno. */
  dirCfdi: string | null;
  /** Ensayo en seco: no escribe NADA (ni base ni archivos). */
  simular: boolean;
}

// ── Mapeo (idempotencia + inventario de lo sembrado) ─────────────────────────────────────────────

/** Lee el id ya mapeado de una clave demo, o `null`. */
async function leerDemo(
  cliente: PrismaClient,
  entidad: EntidadDemoFin,
  clave: string,
): Promise<number | null> {
  const fila = await cliente.mapeoMigracion.findUnique({
    where: { entidad_claveVieja: { entidad, claveVieja: clave } },
    select: { idNuevo: true },
  });
  if (fila === null) return null;
  const n = Number(fila.idNuevo);
  return Number.isFinite(n) ? n : null;
}

/** Anota (upsert) la correspondencia clave demo → id real. */
async function anotarDemo(
  cliente: PrismaClient,
  entidad: EntidadDemoFin,
  clave: string,
  id: number,
  datos?: Record<string, string | number>,
): Promise<void> {
  await cliente.mapeoMigracion.upsert({
    where: { entidad_claveVieja: { entidad, claveVieja: clave } },
    update: { idNuevo: String(id), ...(datos === undefined ? {} : { datos }) },
    create: {
      entidad,
      claveVieja: clave,
      idNuevo: String(id),
      ...(datos === undefined ? {} : { datos }),
    },
  });
}

/** Todos los ids ya anotados bajo una entidad `Demo:Fin:*`. */
async function idsMapeados(cliente: PrismaClient, entidad: EntidadDemoFin): Promise<number[]> {
  const filas = await cliente.mapeoMigracion.findMany({
    where: { entidad },
    select: { idNuevo: true },
  });
  return [...new Set(filas.map((f) => Number(f.idNuevo)).filter((n) => Number.isFinite(n)))];
}

/** Contador de lo creado vs. lo que ya estaba. */
class Marcador {
  creados = 0;
  existentes = 0;
}

/**
 * Asegura UNA fila demo: si la clave ya está mapeada **y** la fila sigue viva, la reutiliza; si el
 * mapeo apunta a algo que ya no existe (alguien lo borró a mano), vuelve a crearla y re-apunta el
 * mapeo. Esa doble comprobación es lo que hace la corrida re-ejecutable sin duplicar y sin romperse.
 */
async function asegurar(
  cliente: PrismaClient,
  entidad: EntidadDemoFin,
  clave: string,
  sigueViva: (id: number) => Promise<boolean>,
  crear: () => Promise<number>,
  marcador: Marcador,
): Promise<{ id: number; nuevo: boolean }> {
  const mapeado = await leerDemo(cliente, entidad, clave);
  if (mapeado !== null && (await sigueViva(mapeado))) {
    marcador.existentes += 1;
    return { id: mapeado, nuevo: false };
  }
  const id = await crear();
  await anotarDemo(cliente, entidad, clave, id);
  marcador.creados += 1;
  return { id, nuevo: true };
}

/** Parte una lista en bloques de `tam` (para crear los catálogos por lotes, no uno por uno). */
function enBloques<T>(lista: T[], tam: number): T[][] {
  const bloques: T[][] = [];
  for (let i = 0; i < lista.length; i += tam) bloques.push(lista.slice(i, i + tam));
  return bloques;
}

/** Fecha `YYYY-MM-DD` desplazada `dias` desde hoy (negativo = al pasado). */
export function fechaDemo(dias: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/**
 * Anota en `mapeo_migracion` lo que el DOMINIO creó por dentro y este script no nombró: el
 * movimiento INVERSO de una cancelación, el pago de CxP o de EsMa que nació al ejecutar una corrida,
 * y cualquier otro renglón que cuelgue de un tercero ficticio. Va por LOTES (`createMany` con
 * `skipDuplicates`), y corre justo después de sembrar: en ese momento todo lo que cuelga de los
 * terceros ficticios lo acaba de crear el sembrador.
 *
 * 🔑 Es la pieza que permite que `--limpiar` trabaje con un **conjunto cerrado** y que su chequeo de
 * invasión distinga «esto lo hice yo» de «esto lo capturó alguien encima».
 */
async function anotarDerivados(
  cliente: PrismaClient,
  raices: { idsProveedor: number[]; idsCliente: number[] },
): Promise<void> {
  const nuevas: { entidad: string; claveVieja: string; idNuevo: string }[] = [];
  const agregar = (
    entidad: EntidadDemoFin,
    prefijo: string,
    ids: number[],
    ya: Set<number>,
  ): void => {
    for (const id of ids) {
      if (ya.has(id)) continue;
      ya.add(id);
      nuevas.push({ entidad, claveVieja: `${prefijo}-${String(id)}`, idNuevo: String(id) });
    }
  };

  const yaMov = new Set(await idsMapeados(cliente, ENTIDAD_DEMO_FIN.movimientoTercero));
  agregar(
    ENTIDAD_DEMO_FIN.movimientoTercero,
    'MT-AUTO',
    (
      await cliente.movimientoTercero.findMany({
        where: {
          OR: [
            { idProveedor: { in: raices.idsProveedor } },
            { idCliente: { in: raices.idsCliente } },
          ],
        },
        select: { id: true },
      })
    ).map((x) => x.id),
    yaMov,
  );

  const yaPago = new Set(await idsMapeados(cliente, ENTIDAD_DEMO_FIN.pagoEsMa));
  agregar(
    ENTIDAD_DEMO_FIN.pagoEsMa,
    'PAGO-AUTO',
    (
      await cliente.pagoMaquilero.findMany({
        where: { idMaquilero: { in: raices.idsProveedor } },
        select: { id: true },
      })
    ).map((x) => x.id),
    yaPago,
  );

  const yaAbono = new Set(await idsMapeados(cliente, ENTIDAD_DEMO_FIN.abonoEsMa));
  agregar(
    ENTIDAD_DEMO_FIN.abonoEsMa,
    'ABO-AUTO',
    (
      await cliente.abonoMaquilero.findMany({
        where: { idMaquilero: { in: raices.idsProveedor } },
        select: { id: true },
      })
    ).map((x) => x.id),
    yaAbono,
  );

  const yaDesc = new Set(await idsMapeados(cliente, ENTIDAD_DEMO_FIN.descuentoEsMa));
  agregar(
    ENTIDAD_DEMO_FIN.descuentoEsMa,
    'DES-AUTO',
    (
      await cliente.descuentoMaquilero.findMany({
        where: { idMaquilero: { in: raices.idsProveedor } },
        select: { id: true },
      })
    ).map((x) => x.id),
    yaDesc,
  );

  for (const bloque of enBloques(nuevas, 200)) {
    await cliente.mapeoMigracion.createMany({ data: bloque, skipDuplicates: true });
  }
}

// ── La siembra ───────────────────────────────────────────────────────────────────────────────────

/** Siembra (o completa) el juego de datos ficticios de finanzas. Idempotente. */
export async function sembrarDemoFinanzas(
  cliente: PrismaClient,
  sesion: SesionUsuario,
  opciones: OpcionesSiembraFinanzas,
): Promise<ResultadoSiembraFinanzas> {
  const reporte = new Reporte('DATOS FICTICIOS DE FINANZAS — resumen de la corrida');
  const m = new Marcador();

  if (opciones.simular) {
    reporte.nota('ENSAYO EN SECO (--simular): no se escribió nada en la base ni en disco.');
    return resumenSimulado(reporte);
  }

  // 1. Proveedores (catálogo GLOBAL, ADR-0007). Los roles se resuelven por su código.
  const rolesPorCodigo = new Map(
    (await cliente.rolProveedor.findMany({ select: { id: true, codigo: true } })).map((r) => [
      r.codigo,
      r.id,
    ]),
  );
  const idsProveedor = new Map<string, number>();
  let proveedoresNuevos = 0;
  for (const bloque of enBloques(PROVEEDORES_DEMO_FIN, LOTE_CATALOGOS)) {
    const hechos = await Promise.all(
      bloque.map(async (p) => {
        const roles = p.roles
          .map((c) => rolesPorCodigo.get(c))
          .filter((x): x is number => x !== undefined);
        if (roles.length === 0) {
          throw new Error(
            `El seed base no tiene los roles de proveedor ${p.roles.join('/')}: corre el seed antes de sembrar.`,
          );
        }
        const { id, nuevo } = await asegurar(
          cliente,
          ENTIDAD_DEMO_FIN.proveedor,
          p.clave,
          async (x) => (await cliente.proveedor.count({ where: { id: x } })) > 0,
          async () =>
            (
              await crearProveedor(sesion, {
                nombre: p.nombre,
                nombreCorto: p.nombreCorto,
                razonSocial: p.nombre,
                rfc: p.rfc,
                regimenFiscalSat: p.regimenFiscalSat,
                diasCredito: p.diasCredito,
                modalidadFacturacion: p.modalidadFacturacion,
                moneda: 'MXN',
                email: p.email,
                telefono: p.telefono,
                direccion: p.direccion,
                roles,
              })
            ).id,
          m,
        );
        if (nuevo) proveedoresNuevos += 1;
        return [p.clave, id] as const;
      }),
    );
    for (const [clave, id] of hechos) idsProveedor.set(clave, id);
  }

  // 2. Cuentas de pago (el destino del depósito). Sin ellas, la relación CON factura no se cierra.
  const idsCuenta = new Map<string, number>();
  let cuentasPago = 0;
  for (const p of PROVEEDORES_DEMO_FIN) {
    const idProveedor = idsProveedor.get(p.clave);
    if (idProveedor === undefined) throw new Error(`${p.clave}: proveedor no sembrado.`);
    for (const c of p.cuentas) {
      const { id, nuevo } = await asegurar(
        cliente,
        ENTIDAD_DEMO_FIN.cuentaPago,
        c.clave,
        async (x) => (await cliente.proveedorCuentaPago.count({ where: { id: x } })) > 0,
        async () =>
          (
            await crearCuentaPagoProveedor(sesion, idProveedor, {
              beneficiario: c.beneficiario,
              banco: c.banco,
              tipoCuenta: c.tipoCuenta,
              cuenta: c.cuenta,
              alias: c.alias,
              esFiscal: c.esFiscal,
              notas: `${PREFIJO_DEMO_FIN}cuenta ficticia — se borra con --limpiar.`,
            })
          ).id,
        m,
      );
      idsCuenta.set(c.clave, id);
      if (nuevo) cuentasPago += 1;
    }
  }

  // 3. Clientes (catálogo GLOBAL). Sus días de crédito son la base del aging de CxC.
  const idsCliente = new Map<string, number>();
  let clientesNuevos = 0;
  for (const bloque of enBloques(CLIENTES_DEMO_FIN, LOTE_CATALOGOS)) {
    const hechos = await Promise.all(
      bloque.map(async (c) => {
        const { id, nuevo } = await asegurar(
          cliente,
          ENTIDAD_DEMO_FIN.cliente,
          c.clave,
          async (x) => (await cliente.cliente.count({ where: { id: x } })) > 0,
          async () =>
            (
              await crearCliente(sesion, {
                nombre: c.nombre,
                razonSocial: c.razonSocial,
                contacto: c.contacto,
                telefono: c.telefono,
                email: c.email,
                direccion: c.direccion,
                diasCredito: c.diasCredito,
                ...(c.rfc === null ? {} : { rfc: c.rfc }),
              })
            ).id,
          m,
        );
        if (nuevo) clientesNuevos += 1;
        return [c.clave, id] as const;
      }),
    );
    for (const [clave, id] of hechos) idsCliente.set(clave, id);
  }

  // 4. Conceptos de pago (lo que se paga y NO es un proveedor).
  const idsConcepto = new Map<string, number>();
  let conceptosNuevos = 0;
  for (const c of CONCEPTOS_DEMO_FIN) {
    const { id, nuevo } = await asegurar(
      cliente,
      ENTIDAD_DEMO_FIN.conceptoPago,
      c.clave,
      async (x) => (await cliente.conceptoPago.count({ where: { id: x } })) > 0,
      async () =>
        (
          await crearConceptoPago(sesion, {
            nombre: c.nombre,
            rubro: c.rubro,
            formaPagoPreferida: c.formaPagoPreferida,
            predeterminado: false,
            notas: `${PREFIJO_DEMO_FIN}concepto ficticio — se borra con --limpiar.`,
          })
        ).id,
      m,
    );
    idsConcepto.set(c.clave, id);
    if (nuevo) conceptosNuevos += 1;
  }

  // 5. Movimientos de CxP y CxC. EN SERIE a propósito: cada uno toma su folio de una secuencia
  //    atómica (A3) y el motor serializa por tercero; en paralelo sólo se estorbarían.
  const movimientosCxp = await sembrarMovimientos(cliente, sesion, {
    lista: MOVIMIENTOS_CXP_DEMO,
    idsTercero: idsProveedor,
    lado: 'proveedor',
    marcador: m,
  });
  const movimientosCxc = await sembrarMovimientos(cliente, sesion, {
    lista: MOVIMIENTOS_CXC_DEMO,
    idsTercero: idsCliente,
    lado: 'cliente',
    marcador: m,
  });

  // 6. EsMa: el FOLD del maquilero. Estos renglones salen DENTRO del estado de cuenta de CxP del
  //    proveedor (fuente `esma`) y su saldo los incluye — sin ellos el fold no se ve.
  let movimientosEsMa = 0;
  for (const mv of MOVIMIENTOS_ESMA_DEMO) {
    const idMaquilero = idsProveedor.get(mv.maquilero);
    if (idMaquilero === undefined) throw new Error(`${mv.clave}: maquilero no sembrado.`);
    const entidad =
      mv.tipo === 'abono' ? ENTIDAD_DEMO_FIN.abonoEsMa : ENTIDAD_DEMO_FIN.descuentoEsMa;
    const cuerpo = {
      idMaquilero,
      monto: mv.importe,
      fecha: fechaDemo(mv.dias),
      observaciones: mv.observaciones,
      ...(mv.conFactura === undefined ? {} : { conFactura: mv.conFactura }),
    };
    const { id, nuevo } = await asegurar(
      cliente,
      entidad,
      mv.clave,
      async (x) =>
        mv.tipo === 'abono'
          ? (await cliente.abonoMaquilero.count({ where: { id: x } })) > 0
          : (await cliente.descuentoMaquilero.count({ where: { id: x } })) > 0,
      async () =>
        (
          await (mv.tipo === 'abono'
            ? crearAbonoMaquilero(sesion, cuerpo)
            : crearDescuentoMaquilero(sesion, cuerpo))
        ).id,
      m,
    );
    if (nuevo) movimientosEsMa += 1;

    // ⭐ REVISAR es un acto aparte, y en EsMa **sólo lo revisado suma al saldo** (fila 0.115). Se
    // comprueba SIEMPRE (no sólo al crear): si una corrida anterior murió entre la captura y la
    // revisión, la siguiente la completa. Y se lee el estado antes de llamar, porque `revisar` de
    // algo ya revisado lanza 409 — el sembrador no debe pelearse consigo mismo.
    if (mv.revisar) {
      const estado =
        mv.tipo === 'abono'
          ? await cliente.abonoMaquilero.findUnique({
              where: { id },
              select: { estadoRevision: true },
            })
          : await cliente.descuentoMaquilero.findUnique({
              where: { id },
              select: { estadoRevision: true },
            });
      if (estado !== null && estado.estadoRevision === 'capturado') {
        await revisarMovimiento(sesion, mv.tipo, id);
      }
    }
  }

  // 7. Corridas semanales. ⚠️ Van ANTES de las facturas en rojo: una factura que no cuadra frena la
  //    ejecución de la corrida de ese proveedor, y el sembrador se bloquearía a sí mismo.
  const { corridas, renglones } = await sembrarCorridas(cliente, sesion, {
    idsProveedor,
    idsConcepto,
    idsCuenta,
    marcador: m,
    reporte,
  });

  // 8. Facturas de proveedor + su COTEJO contra los documentos que emitimos.
  const { facturas, cotejos } = await sembrarCotejo(cliente, sesion, {
    idsProveedor,
    marcador: m,
    reporte,
  });

  // 9. ⭐ ANOTAR LOS DERIVADOS (inversos de cancelación, pagos nacidos al ejecutar la corrida…), para
  //    que el conjunto que `--limpiar` borra salga ENTERO del mapeo.
  await anotarDerivados(cliente, {
    idsProveedor: [...idsProveedor.values()],
    idsCliente: [...idsCliente.values()],
  });

  // 10. Los CFDI ficticios (archivos; no se importan aquí — se dejan listos para probarlos a mano).
  const cfdiEscritos =
    opciones.dirCfdi === null
      ? 0
      : await escribirCfdiFinanzas(cliente, opciones.idEmpresa, opciones.dirCfdi, reporte);

  reporte.nota(
    `Todo lo sembrado lleva el prefijo "${PREFIJO_DEMO_FIN.trim()}" y queda anotado en ` +
      'mapeo_migracion bajo las entidades Demo:Fin:* (es lo que borra --limpiar). El sembrador de ' +
      'INVENTARIOS usa Demo:* y no se toca: cada uno se limpia por su lado.',
  );
  reporte.nota(
    'NO se sembraron CARGOS de EsMa (EsMaCargo): nacen del RECIBO de maquila de producción ' +
      '(F3-E4), no de un servicio de Finanzas — el fold del maquilero se ve con sus abonos, ' +
      'descuentos y pagos.',
  );

  // ⚠️ Todos los conteos son de lo CREADO EN ESTA CORRIDA, no del tamaño del catálogo. En la
  // segunda corrida salen en cero y lo que ya estaba se cuenta en `existentes` — que es lo que
  // deja ver la idempotencia de un vistazo. Enseñar aquí el largo de la lista haría que la
  // segunda corrida dijera «6 proveedores» sin haber creado ninguno.
  return {
    proveedores: proveedoresNuevos,
    cuentasPago,
    clientes: clientesNuevos,
    conceptosPago: conceptosNuevos,
    movimientosCxp,
    movimientosCxc,
    movimientosEsMa,
    corridas,
    renglonesCorrida: renglones,
    facturasCotejo: facturas,
    cotejosAplicados: cotejos,
    cfdiEscritos,
    existentes: m.existentes,
    reporte,
  };
}

/** Resultado de un ensayo en seco (todo en cero, con su nota). */
function resumenSimulado(reporte: Reporte): ResultadoSiembraFinanzas {
  return {
    proveedores: 0,
    cuentasPago: 0,
    clientes: 0,
    conceptosPago: 0,
    movimientosCxp: 0,
    movimientosCxc: 0,
    movimientosEsMa: 0,
    corridas: 0,
    renglonesCorrida: 0,
    facturasCotejo: 0,
    cotejosAplicados: 0,
    cfdiEscritos: 0,
    existentes: 0,
    reporte,
  };
}

// ── Movimientos de cuenta corriente ──────────────────────────────────────────────────────────────

interface ContextoMovimientos {
  lista: MovimientoDemoFin[];
  idsTercero: Map<string, number>;
  lado: 'proveedor' | 'cliente';
  marcador: Marcador;
}

/**
 * Registra los movimientos de un lado (CxP o CxC), **por la misma puerta que la aplicación**:
 *
 *  • los orígenes que un usuario captura a mano van por `registrarMovimientoCxp`/`Cxc`, que son los
 *    que resuelven el segmento con/sin factura y verifican el permiso del módulo;
 *  • `factura_proveedor`/`factura_cliente` NO se capturan a mano en ningún lado (los pone el parser
 *    de CFDI), así que van por el MOTOR `registrarMovimientoTercero` — exactamente el mismo servicio
 *    en el que delega el importador de CFDI.
 *
 * El que trae `cancelarCon` se cancela acto seguido: la cancelación es un movimiento INVERSO
 * auditado (D3), nunca una edición ni un borrado, y hay que poder verlo.
 */
async function sembrarMovimientos(
  cliente: PrismaClient,
  sesion: SesionUsuario,
  ctx: ContextoMovimientos,
): Promise<number> {
  let hechos = 0;
  for (const mv of ctx.lista) {
    const idTercero = ctx.idsTercero.get(mv.tercero);
    if (idTercero === undefined)
      throw new Error(`${mv.clave}: el tercero ${mv.tercero} no está sembrado.`);
    const fecha = fechaDemo(mv.dias);

    const { id, nuevo } = await asegurar(
      cliente,
      ENTIDAD_DEMO_FIN.movimientoTercero,
      mv.clave,
      async (x) => (await cliente.movimientoTercero.count({ where: { id: x } })) > 0,
      async () => {
        if (ORIGENES_CAPTURABLES_CXP.has(mv.origen)) {
          const cuerpo = {
            fecha,
            // El `Set` ya garantizó que el origen es uno de los capturables; el cast sólo se lo
            // dice al compilador, que no puede deducirlo de un `Set<string>`.
            origen: mv.origen as
              | 'entrada_sin_factura'
              | 'nota_credito'
              | 'pago'
              | 'abono'
              | 'descuento',
            importe: mv.importe,
            observaciones: mv.observaciones,
            ...(mv.esFiscal === undefined ? {} : { esFiscal: mv.esFiscal }),
          };
          return ctx.lado === 'proveedor'
            ? (await registrarMovimientoCxp(sesion, idTercero, cuerpo)).id
            : (await registrarMovimientoCxc(sesion, idTercero, cuerpo)).id;
        }
        return (
          await registrarMovimientoTercero(sesion, {
            tipoTercero: ctx.lado,
            idTercero,
            fecha,
            origen: mv.origen,
            importe: mv.importe,
            observaciones: mv.observaciones,
            ...(mv.esFiscal === undefined ? {} : { esFiscal: mv.esFiscal }),
            ...(mv.uuidCfdi === undefined ? {} : { uuidCfdi: mv.uuidCfdi }),
          })
        ).id;
      },
      ctx.marcador,
    );
    if (nuevo) hechos += 1;

    // La cancelación se comprueba SIEMPRE (no sólo cuando el movimiento acaba de nacer): si una
    // corrida anterior murió entre el alta y la cancelación, la segunda la completa en vez de dejar
    // un movimiento a medias para siempre.
    if (mv.cancelarCon !== undefined) {
      const actual = await cliente.movimientoTercero.findUnique({
        where: { id },
        select: { cancelado: true },
      });
      if (actual !== null && !actual.cancelado && ctx.lado === 'proveedor') {
        await cancelarMovimientoCxp(sesion, id, { motivo: mv.cancelarCon });
      }
    }
  }
  return hechos;
}

// ── Corridas semanales de pago ───────────────────────────────────────────────────────────────────

interface ContextoCorridas {
  idsProveedor: Map<string, number>;
  idsConcepto: Map<string, number>;
  idsCuenta: Map<string, number>;
  marcador: Marcador;
  reporte: Reporte;
}

/** El lunes de la semana de hace `semanas` semanas, en `YYYY-MM-DD`. */
function semanaDe(semanas: number): string {
  return fechaDemo(-7 * semanas);
}

/**
 * Arma las corridas ficticias de punta a punta: crear → capturar renglones → cerrar (ahí se reparten
 * los FOLIOS DE DOCUMENTO) → ejecutar (ahí nacen los pagos reales, de EsMa o de CxP). La que va en
 * `borrador` se queda a medias a propósito.
 */
async function sembrarCorridas(
  cliente: PrismaClient,
  sesion: SesionUsuario,
  ctx: ContextoCorridas,
): Promise<{ corridas: number; renglones: number }> {
  let corridas = 0;
  let renglones = 0;

  for (const c of CORRIDAS_DEMO_FIN) {
    const yaEsta = await leerDemo(cliente, ENTIDAD_DEMO_FIN.corrida, c.clave);
    if (yaEsta !== null && (await cliente.corridaPago.count({ where: { id: yaEsta } })) > 0) {
      ctx.marcador.existentes += 1;
      continue;
    }

    // ⚠️ La corrida es lo ÚNICO que puede chocar con algo que ya exista en `prueba`: el dominio no
    // deja abrir dos BORRADORES de la misma semana y segmento, y Daniel puede tener el suyo. Si
    // pasa, se dice en el reporte y se sigue con lo demás — matar toda la siembra por eso dejaría a
    // Daniel sin las pantallas que sí se podían sembrar. (Es la única excepción, y no es «tragarse
    // un error»: queda escrito, con nombre y motivo.)
    let creada: { id: number; folio: number };
    try {
      // El detalle envuelve al encabezado (`{ corrida, secciones, bloqueos… }`): el id vive adentro.
      const detalle = await crearCorrida(sesion, {
        semana: semanaDe(c.semanasAtras),
        conFactura: c.conFactura,
        notas: c.notas,
      });
      creada = { id: detalle.corrida.id, folio: detalle.corrida.folio };
    } catch (error) {
      if (!(error instanceof ErrorConflicto)) throw error;
      ctx.reporte.agregar(
        'Corridas de pago NO sembradas',
        // Se cita SÓLO el segmento y se deja que el mensaje del dominio ponga la semana: él la da
        // ya normalizada al LUNES, y enseñar aquí la fecha cruda daría dos fechas distintas para
        // la misma semana — justo lo que hace dudar de si son dos corridas o una.
        `${c.clave} (${c.conFactura ? 'CON' : 'SIN'} factura): ` +
          `${error.message} — el resto de la siembra siguió; si quieres esta corrida ficticia, ` +
          'cierra o borra ese borrador y vuelve a correr el sembrador.',
      );
      continue;
    }
    await anotarDemo(cliente, ENTIDAD_DEMO_FIN.corrida, c.clave, creada.id, {
      clave: c.clave,
      folio: creada.folio,
    });
    ctx.marcador.creados += 1;
    corridas += 1;

    for (const r of c.renglones) {
      const idCuenta = r.cuenta === null ? null : ctx.idsCuenta.get(r.cuenta);
      if (r.cuenta !== null && idCuenta === undefined) {
        throw new Error(`${c.clave}: la cuenta ${r.cuenta} no está sembrada.`);
      }
      const idProveedor = r.proveedor === null ? undefined : ctx.idsProveedor.get(r.proveedor);
      const idConcepto = r.concepto === null ? undefined : ctx.idsConcepto.get(r.concepto);
      if (r.proveedor !== null && idProveedor === undefined) {
        throw new Error(`${c.clave}: el proveedor ${r.proveedor} no está sembrado.`);
      }
      if (r.concepto !== null && idConcepto === undefined) {
        throw new Error(`${c.clave}: el concepto ${r.concepto} no está sembrado.`);
      }
      await guardarRenglonCorrida(sesion, creada.id, {
        ...(idProveedor === undefined ? {} : { idProveedor }),
        ...(idConcepto === undefined ? {} : { idConcepto }),
        monto: r.monto,
        formaPago: r.formaPago,
        idCuenta: idCuenta ?? null,
        concepto: r.texto,
        ...(r.referencia === undefined ? {} : { referencia: r.referencia }),
      });
      renglones += 1;
    }

    if (c.estado === 'borrador') continue;
    await cerrarCorrida(sesion, creada.id);
    await ejecutarCorrida(sesion, creada.id);
  }

  return { corridas, renglones };
}

// ── Facturas de proveedor y su cotejo ────────────────────────────────────────────────────────────

interface ContextoCotejo {
  idsProveedor: Map<string, number>;
  marcador: Marcador;
  reporte: Reporte;
}

/**
 * Siembra las facturas sujetas a cotejo y las liga contra los documentos emitidos.
 *
 * La factura nace por el MOTOR con `origen = factura_proveedor` y **sin** `refTipo` — que es
 * exactamente la condición de `sujetaACotejo`: la factura de maquila o de servicios que se coteja
 * contra el documento que nosotros emitimos, no contra una orden de compra. El veredicto
 * (`cuadra`/`descuadre`) **no se escribe**: lo recalcula el dominio por suma directa de las ligas.
 */
async function sembrarCotejo(
  cliente: PrismaClient,
  sesion: SesionUsuario,
  ctx: ContextoCotejo,
): Promise<{ facturas: number; cotejos: number }> {
  let facturas = 0;
  let cotejos = 0;

  for (const f of FACTURAS_COTEJO_DEMO) {
    const idProveedor = ctx.idsProveedor.get(f.proveedor);
    if (idProveedor === undefined) throw new Error(`${f.clave}: proveedor no sembrado.`);

    const { id, nuevo } = await asegurar(
      cliente,
      ENTIDAD_DEMO_FIN.movimientoTercero,
      f.clave,
      async (x) => (await cliente.movimientoTercero.count({ where: { id: x } })) > 0,
      async () =>
        (
          await registrarMovimientoTercero(sesion, {
            tipoTercero: 'proveedor',
            idTercero: idProveedor,
            fecha: fechaDemo(f.dias),
            origen: 'factura_proveedor',
            importe: f.importe,
            // Una factura timbrada es fiscal por definición, y el UUID lo exige. Se manda explícito
            // (la evidencia manda sobre la modalidad del catálogo, `resolverEsFiscalMotor`).
            esFiscal: true,
            uuidCfdi: f.uuidCfdi,
            rfcTercero: PROVEEDORES_DEMO_FIN.find((p) => p.clave === f.proveedor)?.rfc ?? '',
            observaciones: f.observaciones,
          })
        ).id,
      ctx.marcador,
    );
    if (nuevo) facturas += 1;
    if (!nuevo) continue;

    if (f.aplicaA === null) {
      ctx.reporte.agregar(
        'Cotejo de facturas',
        `${f.clave}: EN ROJO y sin ninguna liga (${f.importe.toFixed(2)}) — ${f.observaciones}`,
      );
      continue;
    }

    const idCorrida = await leerDemo(cliente, ENTIDAD_DEMO_FIN.corrida, f.aplicaA.corrida);
    const idProveedorDoc = ctx.idsProveedor.get(f.aplicaA.proveedor);
    const documento =
      idCorrida === null || idProveedorDoc === undefined
        ? null
        : await cliente.renglonCorridaPago.findFirst({
            where: { idCorrida, idProveedor: idProveedorDoc, folioDocumento: { not: null } },
            select: { id: true, folioDocumento: true },
            orderBy: { folioDocumento: 'asc' },
          });
    // Si su corrida no se pudo sembrar (arriba), la factura se queda SIN liga: en rojo y sin
    // explicación, que es un estado legítimo de la bandeja. Se dice, y se sigue — no se inventa un
    // documento ni se tira la siembra entera por una dependencia que ya quedó escrita.
    if (documento === null) {
      ctx.reporte.agregar(
        'Cotejo de facturas',
        `${f.clave}: se quedó EN ROJO y sin liga porque la corrida ${f.aplicaA.corrida} no se ` +
          'sembró (mira «Corridas de pago NO sembradas»).',
      );
      continue;
    }

    await aplicarCotejo(sesion, id, {
      aplicaciones: [{ idRenglon: documento.id, importe: f.aplicaA.importe }],
    });
    cotejos += 1;

    if (f.atenderCon !== undefined) {
      await atenderCotejo(sesion, id, { nota: f.atenderCon });
    }

    const diferencia = f.importe - f.aplicaA.importe;
    ctx.reporte.agregar(
      'Cotejo de facturas',
      `${f.clave}: factura ${f.importe.toFixed(2)} contra el documento ` +
        `${String(documento.folioDocumento)} por ${f.aplicaA.importe.toFixed(2)} → ` +
        (diferencia === 0
          ? 'CUADRA'
          : `EN ROJO por ${diferencia.toFixed(2)}${f.atenderCon === undefined ? ' (sin atender: FRENA el pago)' : ' (atendida: deja de frenar)'}`),
    );
  }

  return { facturas, cotejos };
}

// ── CFDI ficticios ───────────────────────────────────────────────────────────────────────────────

/** Escribe los XML ficticios en `dir` (los sobrescribe: emisor/receptor dependen de la empresa). */
async function escribirCfdiFinanzas(
  cliente: PrismaClient,
  idEmpresa: number,
  dir: string,
  reporte: Reporte,
): Promise<number> {
  const empresa = await cliente.empresa.findUnique({
    where: { id: idEmpresa },
    select: { nombre: true, rfc: true },
  });
  const rfcCapturado = empresa?.rfc?.trim() ?? '';
  const rfcEmpresa = rfcCapturado === '' ? 'XAXX010101000' : rfcCapturado;
  // Mientras la empresa no tenga RFC, se usa el genérico del público en general Y un nombre NEUTRO:
  // estos archivos se versionan en el repo, que es PÚBLICO, y ahí no tiene por qué quedar el nombre
  // de nadie. En cuanto la empresa capture su RFC, el archivo se reescribe con sus datos, que es lo
  // que el importador exige para no rechazarlo por receptor (o emisor) ajeno.
  const nombreEmpresa =
    rfcCapturado === '' ? 'Empresa de prueba' : (empresa?.nombre ?? 'Empresa de prueba');
  if (rfcCapturado === '') {
    reporte.nota(
      'La empresa no tiene RFC capturado: los CFDI ficticios salieron a nombre de XAXX010101000. ' +
        'Al capturar el RFC en Administración › Empresas, vuelve a correr el sembrador para que ' +
        'los archivos se reescriban con él (si no, el importador los rechaza por RFC ajeno).',
    );
  } else {
    // 🔴 EL AVISO QUE IMPORTA VA PEGADO AL HECHO, no sólo en el TSDoc de arriba. Con RFC capturado,
    // estos archivos dejan de ser 100 % inventados: llevan el RFC y el nombre REALES de la empresa,
    // y la carpeta por omisión está DENTRO de un repositorio PÚBLICO. Quien corra esto en `prueba`
    // tiene que enterarse ahí mismo, no al leer el código fuente del sembrador.
    reporte.nota(
      `🔴 OJO: los CFDI ficticios se escribieron con el RFC REAL de la empresa (${rfcEmpresa}) ` +
        `en ${dir}. El resto del contenido es inventado, pero ESE dato no lo es y el repositorio ` +
        'es PÚBLICO: NO comitees estos archivos. Si sólo los quieres para importarlos a mano, ' +
        'corre el sembrador con --cfdi-dir=<una ruta fuera del repo>, o con --sin-cfdi si no los ' +
        'necesitas.',
    );
  }

  await mkdir(dir, { recursive: true });
  const catalogo = catalogoCfdiFinanzas(fechaDemo);
  for (const c of catalogo) {
    // En una VENTA el emisor es la empresa; en una compra, el receptor. Es el mismo constructor con
    // los dos papeles cambiados de sitio.
    const datos =
      c.lado === 'venta' ? { ...c, emisorRfc: rfcEmpresa, emisorNombre: nombreEmpresa } : c;
    const receptorRfc = c.lado === 'venta' ? (c.receptorRfc ?? '') : rfcEmpresa;
    const receptorNombre = c.lado === 'venta' ? (c.receptorNombre ?? '') : nombreEmpresa;
    await writeFile(
      join(dir, c.archivo),
      construirCfdiDemo(datos, receptorRfc, receptorNombre),
      'utf8',
    );
    reporte.agregar(
      'CFDI ficticios escritos',
      `${c.archivo} · ${c.lado} · total ${totalCfdi(c).toFixed(2)} — ${c.nota}`,
    );
  }
  return catalogo.length;
}
