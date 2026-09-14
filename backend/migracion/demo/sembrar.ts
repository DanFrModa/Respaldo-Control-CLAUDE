/**
 * SIEMBRA de los datos ficticios de INVENTARIOS (ver `migracion/sembrar-demo-inventarios.ts`).
 *
 * 🔴 TODO PASA POR EL DOMINIO (A1). Aquí no hay un solo `prisma.create` de un catálogo, de una
 * orden de compra ni de un movimiento: se llaman los MISMOS servicios que usa la aplicación
 * (`crearProveedor`, `crearTela`, `crearAvio`, `crearOC`, `autorizarOC`, `recibirCompra`,
 * `crearEntradaTela`/`confirmarEntradaTela`, `ajustarInventarioTelaColor`, `traspasarTelaColor`,
 * `ajustarInventarioAvio`, `traspasarAvio`). La razón no es estética: la existencia es Σ de
 * movimientos (D3) y el estatus de una OC lo recalcula el dominio — si esto insertara filas a pelo,
 * los números de las pantallas no cuadrarían con el motor y Daniel estaría probando una mentira.
 *
 * Lo ÚNICO que se escribe directo es `mapeo_migracion`, que es metadato de la migración y no un
 * dato del negocio (la misma excepción que documenta `migracion/comun/mapeo.ts`). Ahí queda anotado
 * cada id sembrado bajo una entidad `Demo:*`: es lo que hace la corrida IDEMPOTENTE (si la clave ya
 * está mapeada y la fila sigue viva, se salta) y lo que permite el borrado de un golpe.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { PrismaClient } from '../../src/datos/index.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';

import { crearAlmacen } from '../../src/dominio/admin/almacenes.js';
import { crearAvio } from '../../src/dominio/catalogos/avios.js';
import { crearDireccionEntrega } from '../../src/dominio/catalogos/direcciones-entrega.js';
import { crearProveedor } from '../../src/dominio/catalogos/proveedores.js';
import { crearTela } from '../../src/dominio/catalogos/telas.js';
import { autorizarOC, crearOC } from '../../src/dominio/compras/ordenes-compra.js';
import { recibirCompra } from '../../src/dominio/compras/recepciones.js';
import {
  confirmarEntradaTela,
  crearEntradaTela,
} from '../../src/dominio/inventarios/entradas-tela.js';
import { ajustarInventarioAvio, traspasarAvio } from '../../src/dominio/inventarios/avios.js';
import {
  ajustarInventarioTelaColor,
  traspasarTelaColor,
} from '../../src/dominio/inventarios/partidas-telas.js';

import { Reporte } from '../comun/reporte.js';

import {
  ALMACENES_DEMO,
  AVIOS_DEMO,
  DIRECCION_DEMO,
  ENTIDAD_DEMO,
  FRACCION_PARCIAL,
  ORDENES_COMPRA_DEMO,
  PREFIJO_DEMO,
  PROVEEDORES_DEMO,
  TELAS_DEMO,
  type EntidadDemo,
  type OcDemo,
} from './datos.js';
import { construirCfdiDemo, totalCfdi, type CfdiDemo } from './cfdi.js';

/** Tamaño de lote de los catálogos (se crean en paralelo por bloques; cada uno en su transacción). */
const LOTE_CATALOGOS = 10;

/** Cuántos días atrás nacen los documentos ficticios (la OC más vieja). */
const DIAS_ATRAS_BASE = 45;

/** Lo que devuelve una siembra (lo imprime el script y lo leen las pruebas). */
export interface ResultadoSiembra {
  proveedores: number;
  almacenes: number;
  telas: number;
  coloresTela: number;
  avios: number;
  ordenesCompra: number;
  entradasTela: number;
  recepciones: number;
  movimientos: number;
  cfdiEscritos: number;
  /** Lo que ya estaba de una corrida anterior (idempotencia: no se volvió a crear). */
  existentes: number;
  reporte: Reporte;
}

/** Opciones de la corrida. */
export interface OpcionesSiembra {
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
  entidad: EntidadDemo,
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
  entidad: EntidadDemo,
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

/** Todos los ids ya anotados bajo una entidad `Demo:*`. */
async function idsMapeados(cliente: PrismaClient, entidad: EntidadDemo): Promise<number[]> {
  const filas = await cliente.mapeoMigracion.findMany({
    where: { entidad },
    select: { idNuevo: true },
  });
  return [...new Set(filas.map((f) => Number(f.idNuevo)).filter((n) => Number.isFinite(n)))];
}

/** Qué material/documentos ficticios hay, para buscar lo que el dominio creó colgando de ellos. */
interface RaicesDemo {
  idsTela: number[];
  idsAvio: number[];
  idsTelaColor: number[];
  idsProveedor: number[];
  idsOc: number[];
}

/**
 * Anota en `mapeo_migracion` lo que el DOMINIO creó por dentro y este script no nombró: movimientos
 * de kardex de recepciones/entradas, partidas de tela y movimientos de cuenta corriente del
 * proveedor ficticio. Va por LOTES (`createMany` con `skipDuplicates`), y corre justo después de
 * sembrar: en ese momento todo lo que cuelga del material ficticio lo acaba de crear el sembrador.
 *
 * 🔑 Es la pieza que permite que `--limpiar` trabaje con un **conjunto cerrado** y que su chequeo de
 * invasión distinga «esto lo hice yo» de «esto lo capturó alguien encima».
 */
async function anotarDerivados(cliente: PrismaClient, raices: RaicesDemo): Promise<void> {
  const nuevas: { entidad: string; claveVieja: string; idNuevo: string }[] = [];
  const agregar = (entidad: EntidadDemo, prefijo: string, ids: number[], ya: Set<number>): void => {
    for (const id of ids) {
      if (ya.has(id)) continue;
      ya.add(id);
      nuevas.push({ entidad, claveVieja: `${prefijo}-${String(id)}`, idNuevo: String(id) });
    }
  };

  const yaMov = new Set(await idsMapeados(cliente, ENTIDAD_DEMO.movimiento));
  agregar(
    ENTIDAD_DEMO.movimiento,
    'MOV-AUTO',
    (
      await cliente.movimiento.findMany({
        where: {
          OR: [
            { detallesTela: { some: { idTela: { in: raices.idsTela } } } },
            { detallesAvio: { some: { idAvio: { in: raices.idsAvio } } } },
          ],
        },
        select: { id: true },
      })
    ).map((x) => x.id),
    yaMov,
  );

  const yaPart = new Set(await idsMapeados(cliente, ENTIDAD_DEMO.partida));
  agregar(
    ENTIDAD_DEMO.partida,
    'PART',
    (
      await cliente.partidaTela.findMany({
        where: { idTelaColor: { in: raices.idsTelaColor } },
        select: { id: true },
      })
    ).map((x) => x.id),
    yaPart,
  );

  const yaRec = new Set(await idsMapeados(cliente, ENTIDAD_DEMO.recepcion));
  agregar(
    ENTIDAD_DEMO.recepcion,
    'REC-AUTO',
    (
      await cliente.recepcionCompra.findMany({
        where: { idOrdenCompra: { in: raices.idsOc } },
        select: { id: true },
      })
    ).map((x) => x.id),
    yaRec,
  );

  const yaMt = new Set(await idsMapeados(cliente, ENTIDAD_DEMO.movimientoTercero));
  agregar(
    ENTIDAD_DEMO.movimientoTercero,
    'MT',
    (
      await cliente.movimientoTercero.findMany({
        where: { idProveedor: { in: raices.idsProveedor } },
        select: { id: true },
      })
    ).map((x) => x.id),
    yaMt,
  );

  const yaEnt = new Set(await idsMapeados(cliente, ENTIDAD_DEMO.entradaTela));
  agregar(
    ENTIDAD_DEMO.entradaTela,
    'ENT-AUTO',
    (
      await cliente.entradaTela.findMany({
        where: { idProveedor: { in: raices.idsProveedor } },
        select: { id: true },
      })
    ).map((x) => x.id),
    yaEnt,
  );

  for (const bloque of enBloques(nuevas, 200)) {
    await cliente.mapeoMigracion.createMany({ data: bloque, skipDuplicates: true });
  }
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
  entidad: EntidadDemo,
  clave: string,
  sigueViva: (id: number) => Promise<boolean>,
  crear: () => Promise<number>,
  marcador: Marcador,
): Promise<number> {
  const mapeado = await leerDemo(cliente, entidad, clave);
  if (mapeado !== null && (await sigueViva(mapeado))) {
    marcador.existentes += 1;
    return mapeado;
  }
  const id = await crear();
  await anotarDemo(cliente, entidad, clave, id);
  marcador.creados += 1;
  return id;
}

/** Parte una lista en bloques de `tam` (para crear los catálogos por lotes, no uno por uno). */
function enBloques<T>(lista: T[], tam: number): T[][] {
  const bloques: T[][] = [];
  for (let i = 0; i < lista.length; i += tam) bloques.push(lista.slice(i, i + tam));
  return bloques;
}

/** Fecha `YYYY-MM-DD` desplazada `dias` desde hoy (negativo = al pasado). */
function fecha(dias: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

// ── La siembra ───────────────────────────────────────────────────────────────────────────────────

/** Siembra (o completa) el juego de datos ficticios de inventarios. Idempotente. */
export async function sembrarDemoInventarios(
  cliente: PrismaClient,
  sesion: SesionUsuario,
  opciones: OpcionesSiembra,
): Promise<ResultadoSiembra> {
  const reporte = new Reporte();
  const m = new Marcador();

  if (opciones.simular) {
    reporte.nota('ENSAYO EN SECO (--simular): no se escribió nada en la base ni en disco.');
    return resumenSimulado(reporte);
  }

  // 1. Dirección de entrega (la exige el alta de OC desde §Post-F9.18).
  const idDireccion = await asegurar(
    cliente,
    ENTIDAD_DEMO.direccionEntrega,
    DIRECCION_DEMO.clave,
    async (id) => (await cliente.direccionEntrega.count({ where: { id } })) > 0,
    async () =>
      (
        await crearDireccionEntrega(sesion, {
          nombre: DIRECCION_DEMO.nombre,
          direccion: DIRECCION_DEMO.direccion,
          contacto: DIRECCION_DEMO.contacto,
          telefono: DIRECCION_DEMO.telefono,
        })
      ).id,
    m,
  );

  // 2. Almacenes DE EMPRESA (los globales del seed son el piso del catálogo: no se tocan).
  const idsAlmacen = new Map<string, number>();
  for (const alm of ALMACENES_DEMO) {
    idsAlmacen.set(
      alm.clave,
      await asegurar(
        cliente,
        ENTIDAD_DEMO.almacen,
        alm.clave,
        async (id) => (await cliente.almacen.count({ where: { id } })) > 0,
        async () =>
          (
            await crearAlmacen(sesion, {
              nombre: alm.nombre,
              tipo: alm.tipo,
              idEmpresa: opciones.idEmpresa,
            })
          ).id,
        m,
      ),
    );
  }

  // 3. Proveedores (catálogo GLOBAL, ADR-0007). Los roles se resuelven por su código.
  const rolesPorCodigo = new Map(
    (await cliente.rolProveedor.findMany({ select: { id: true, codigo: true } })).map((r) => [
      r.codigo,
      r.id,
    ]),
  );
  const idsProveedor = new Map<string, number>();
  for (const bloque of enBloques(PROVEEDORES_DEMO, LOTE_CATALOGOS)) {
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
        const id = await asegurar(
          cliente,
          ENTIDAD_DEMO.proveedor,
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
        return [p.clave, id] as const;
      }),
    );
    for (const [clave, id] of hechos) idsProveedor.set(clave, id);
  }

  // 4. Telas con sus colores (el color es HIJO de la tela, §Post-F9.11).
  const idsTela = new Map<string, number>();
  const idsTelaColor = new Map<string, number>();
  for (const bloque of enBloques(TELAS_DEMO, LOTE_CATALOGOS)) {
    await Promise.all(
      bloque.map(async (t) => {
        const idProveedor = idsProveedor.get(t.proveedor);
        if (idProveedor === undefined) throw new Error(`Tela ${t.clave}: proveedor no sembrado.`);
        const id = await asegurar(
          cliente,
          ENTIDAD_DEMO.tela,
          t.clave,
          async (x) => (await cliente.tela.count({ where: { id: x } })) > 0,
          async () =>
            (
              await crearTela(sesion, {
                nombre: t.nombre,
                idProveedor,
                unidadMedida: t.unidadMedida,
                tipoComponente: 'OTRO',
                precioSugerido: t.precioSugerido,
                nombreCuerpo: t.nombreCuerpo,
                ...(t.nombreComplemento === null
                  ? {}
                  : {
                      nombreComplemento: t.nombreComplemento,
                      ...(t.precioSugeridoComplemento === undefined
                        ? {}
                        : { precioSugeridoComplemento: t.precioSugeridoComplemento }),
                    }),
                colores: t.colores,
              })
            ).id,
          m,
        );
        idsTela.set(t.clave, id);
        // Los colores nacen con la tela: se leen de la base y se anotan uno por uno, porque la OC y
        // la entrada de tela se capturan POR COLOR (`idTelaColor`).
        const filas = await cliente.telaColor.findMany({
          where: { idTela: id },
          select: { id: true, nombre: true },
        });
        for (const [i, color] of t.colores.entries()) {
          const fila = filas.find((f) => f.nombre === color.nombre);
          if (fila === undefined) continue;
          idsTelaColor.set(`${t.clave}#${String(i)}`, fila.id);
          await anotarDemo(cliente, ENTIDAD_DEMO.telaColor, `${t.clave}#${String(i)}`, fila.id);
        }
      }),
    );
  }

  // 5. Avíos, cada uno con su proveedor habitual y su precio (R1).
  const idsAvio = new Map<string, number>();
  for (const bloque of enBloques(AVIOS_DEMO, LOTE_CATALOGOS)) {
    const hechos = await Promise.all(
      bloque.map(async (a) => {
        const idProveedor = idsProveedor.get(a.proveedor);
        if (idProveedor === undefined) throw new Error(`Avío ${a.clave}: proveedor no sembrado.`);
        const id = await asegurar(
          cliente,
          ENTIDAD_DEMO.avio,
          a.clave,
          async (x) => (await cliente.avio.count({ where: { id: x } })) > 0,
          async () =>
            (
              await crearAvio(sesion, {
                clave: a.clave,
                descripcion: a.descripcion,
                unidad: a.unidad,
                presentacion: a.presentacion,
                precioReferencia: a.precio,
                esGenerico: a.esGenerico ?? false,
                seCompraSinColor: a.seCompraSinColor ?? false,
                proveedores: [{ idProveedor, precio: a.precio, habitual: true }],
              })
            ).id,
          m,
        );
        return [a.clave, id] as const;
      }),
    );
    for (const [clave, id] of hechos) idsAvio.set(clave, id);
  }

  // 6. Órdenes de compra + recepciones. En SERIE a propósito: cada documento toma su folio de una
  //    secuencia atómica (A3) y locks por OC (B2); en paralelo sólo se estorbarían.
  let entradasTela = 0;
  let recepciones = 0;
  const precioDe = (clave: string): number =>
    TELAS_DEMO.find((t) => t.clave === clave)?.precioSugerido ??
    AVIOS_DEMO.find((a) => a.clave === clave)?.precio ??
    0;

  for (const [i, oc] of ORDENES_COMPRA_DEMO.entries()) {
    const idProveedor = idsProveedor.get(oc.proveedor);
    const idAlmacen = idsAlmacen.get(oc.almacen);
    if (idProveedor === undefined || idAlmacen === undefined) {
      throw new Error(`${oc.clave}: proveedor o almacén no sembrado.`);
    }
    const yaEsta = await leerDemo(cliente, ENTIDAD_DEMO.ordenCompra, oc.clave);
    if (yaEsta !== null && (await cliente.ordenCompra.count({ where: { id: yaEsta } })) > 0) {
      m.existentes += 1;
      continue;
    }

    const lineas = oc.lineas.map((l) => {
      if (oc.tipo === 'tela') {
        const idTela = idsTela.get(l.material);
        const idTelaColor = idsTelaColor.get(`${l.material}#${String(l.color ?? 0)}`);
        if (idTela === undefined || idTelaColor === undefined) {
          throw new Error(`${oc.clave}: la tela ${l.material} no está sembrada.`);
        }
        return {
          idTela,
          idTelaColor,
          cantidad: l.cantidad,
          precio: precioDe(l.material),
          ...(l.cantidadComplemento === undefined
            ? {}
            : { cantidadComplemento: l.cantidadComplemento }),
        };
      }
      const idAvio = idsAvio.get(l.material);
      if (idAvio === undefined)
        throw new Error(`${oc.clave}: el avío ${l.material} no está sembrado.`);
      return { idAvio, cantidad: l.cantidad, precio: precioDe(l.material) };
    });

    const creada = await crearOC(sesion, {
      idProveedor,
      idDireccionEntrega: idDireccion,
      fechaEntrega: fecha(oc.diasEntrega),
      correspondeA: `${PREFIJO_DEMO}datos de prueba de inventarios`,
      observaciones: `${PREFIJO_DEMO}orden ficticia ${oc.clave} — se borra con --limpiar.`,
      lineas,
    });
    await anotarDemo(cliente, ENTIDAD_DEMO.ordenCompra, oc.clave, creada.id, {
      clave: oc.clave,
      folio: creada.numCompra,
    });
    m.creados += 1;

    if (oc.plan === 'borrador') continue;
    await autorizarOC(sesion, creada.id);
    if (oc.plan === 'ninguna') continue;

    const fechaRecepcion = fecha(-DIAS_ATRAS_BASE + i * 2);
    const cantidadRecibida = (pedida: number): number =>
      oc.plan === 'completa' ? pedida : Math.round(pedida * FRACCION_PARCIAL);

    if (oc.tipo === 'avio') {
      // El avío sí se recibe por la recepción de compra (la tela ya no, §Post-F9.14).
      const rec = await recibirCompra(sesion, {
        idOrdenCompra: creada.id,
        idAlmacen,
        fecha: fechaRecepcion,
        factura: `${PREFIJO_DEMO}F-${oc.clave}`,
        observaciones: `${PREFIJO_DEMO}recepción ficticia`,
        lineas: creada.lineas.map((l) => ({
          idOrdenCompraLinea: l.id,
          cantidad: cantidadRecibida(l.cantidad),
        })),
      });
      await anotarDemo(cliente, ENTIDAD_DEMO.recepcion, `REC-${oc.clave}`, rec.id);
      recepciones += 1;
      continue;
    }

    // TELA: documento de entrada por factura/remisión, contra los renglones de la OC.
    const entrada = await crearEntradaTela(sesion, {
      tipoDocumento: 'remision',
      numeroDocumento: `${PREFIJO_DEMO}R-${oc.clave}`,
      idProveedor,
      fecha: fechaRecepcion,
      idAlmacen,
      observaciones: `${PREFIJO_DEMO}entrada ficticia de ${oc.clave}`,
      lineas: creada.lineas.map((l, j) => {
        const spec = oc.lineas[j];
        const llevaComplemento = l.nombreComplementoTela !== null;
        return {
          idTelaColor: l.idTelaColor ?? 0,
          idOrdenCompraLinea: l.id,
          cantidad: cantidadRecibida(l.cantidad),
          ...(llevaComplemento
            ? { cantidadComplemento: cantidadRecibida(spec?.cantidadComplemento ?? 0) }
            : {}),
          precioUnit: l.precio,
          loteProveedor: `${PREFIJO_DEMO}L-${oc.clave}-${String(j + 1)}`,
        };
      }),
    });
    const confirmada = await confirmarEntradaTela(sesion, entrada.id);
    await anotarDemo(cliente, ENTIDAD_DEMO.entradaTela, `ENT-${oc.clave}`, confirmada.id);
    entradasTela += 1;
    // La entrada confirmada genera la recepción contra la OC: se anota para poder limpiarla.
    for (const r of await cliente.recepcionCompra.findMany({
      where: { idEntradaTela: confirmada.id },
      select: { id: true },
    })) {
      await anotarDemo(
        cliente,
        ENTIDAD_DEMO.recepcion,
        `REC-ENT-${oc.clave}-${String(r.id)}`,
        r.id,
      );
      recepciones += 1;
    }
  }

  // 7. Movimientos sueltos: conteo inicial en el otro almacén + traspasos, para que existencias,
  //    kardex y traspasos tengan de dónde agarrar en MÁS DE UN almacén.
  const movimientos = await sembrarMovimientos(cliente, sesion, {
    idsAlmacen,
    idsTelaColor,
    idsAvio,
    marcador: m,
  });

  // 7-bis. ⭐ ANOTAR LOS DERIVADOS. El dominio crea, por dentro, cosas que este script no nombra: el
  //         movimiento de kardex de una recepción, la partida de una entrada de tela, el cargo de
  //         CxP. Se anotan AQUÍ, recién creados, para que el conjunto que `--limpiar` borra salga
  //         ENTERO del mapeo y nunca haya que deducirlo del almacén (ver la cabecera de
  //         `demo/limpiar.ts`: deducirlo del almacén borraba inventario de verdad).
  await anotarDerivados(cliente, {
    idsTela: [...idsTela.values()],
    idsAvio: [...idsAvio.values()],
    idsTelaColor: [...idsTelaColor.values()],
    idsProveedor: [...idsProveedor.values()],
    idsOc: await idsMapeados(cliente, ENTIDAD_DEMO.ordenCompra),
  });

  // 8. Los CFDI ficticios (archivos; no se importan aquí — se dejan listos para probarlos a mano).
  const cfdiEscritos =
    opciones.dirCfdi === null
      ? 0
      : await escribirCfdiDemo(cliente, opciones.idEmpresa, opciones.dirCfdi, reporte);

  reporte.nota(
    `Todo lo sembrado lleva el prefijo "${PREFIJO_DEMO}" y queda anotado en mapeo_migracion ` +
      `bajo las entidades Demo:* (es lo que borra --limpiar).`,
  );

  return {
    proveedores: PROVEEDORES_DEMO.length,
    almacenes: ALMACENES_DEMO.length,
    telas: TELAS_DEMO.length,
    coloresTela: TELAS_DEMO.reduce((a, t) => a + t.colores.length, 0),
    avios: AVIOS_DEMO.length,
    ordenesCompra: ORDENES_COMPRA_DEMO.length,
    entradasTela,
    recepciones,
    movimientos,
    cfdiEscritos,
    existentes: m.existentes,
    reporte,
  };
}

/** Resultado de un ensayo en seco (todo en cero, con su nota). */
function resumenSimulado(reporte: Reporte): ResultadoSiembra {
  return {
    proveedores: 0,
    almacenes: 0,
    telas: 0,
    coloresTela: 0,
    avios: 0,
    ordenesCompra: 0,
    entradasTela: 0,
    recepciones: 0,
    movimientos: 0,
    cfdiEscritos: 0,
    existentes: 0,
    reporte,
  };
}

// ── Movimientos sueltos ──────────────────────────────────────────────────────────────────────────

interface ContextoMovimientos {
  idsAlmacen: Map<string, number>;
  idsTelaColor: Map<string, number>;
  idsAvio: Map<string, number>;
  marcador: Marcador;
}

/**
 * Conteo inicial + traspasos, TODO por el dominio. El conteo entra por `ajustarInventarioTelaColor`
 * (que es el ajuste que opera hoy: crea una PARTIDA por renglón) y por `ajustarInventarioAvio`; los
 * traspasos por `traspasarTelaColor`/`traspasarAvio`, que escriben las DOS patas atómicas.
 */
async function sembrarMovimientos(
  cliente: PrismaClient,
  sesion: SesionUsuario,
  ctx: ContextoMovimientos,
): Promise<number> {
  const tipos = new Map(
    (await cliente.tipoMovimientoInventario.findMany({ select: { id: true, codigo: true } })).map(
      (t) => [t.codigo, t.id],
    ),
  );
  const idAjusteEntrada = tipos.get('ajuste-entrada');
  const idAjusteSalida = tipos.get('ajuste-salida');
  if (idAjusteEntrada === undefined || idAjusteSalida === undefined) {
    throw new Error(
      'Faltan los tipos de movimiento "ajuste-entrada"/"ajuste-salida" (corre el seed).',
    );
  }
  const telaN = ctx.idsAlmacen.get('ALM-TELA-N');
  const telaS = ctx.idsAlmacen.get('ALM-TELA-S');
  const avioN = ctx.idsAlmacen.get('ALM-AVIO-N');
  const avioS = ctx.idsAlmacen.get('ALM-AVIO-S');
  if (telaN === undefined || telaS === undefined || avioN === undefined || avioS === undefined) {
    throw new Error('Faltan los almacenes ficticios.');
  }

  const color = (clave: string): number => {
    const id = ctx.idsTelaColor.get(clave);
    if (id === undefined) throw new Error(`Color de tela no sembrado: ${clave}`);
    return id;
  };
  const avio = (clave: string): number => {
    const id = ctx.idsAvio.get(clave);
    if (id === undefined) throw new Error(`Avío no sembrado: ${clave}`);
    return id;
  };

  let hechos = 0;
  /**
   * Ejecuta un movimiento ficticio UNA sola vez (idempotente por su clave demo). `hacer` devuelve el
   * id del movimiento que se anota; en un TRASPASO se anota la pata de SALIDA — la de entrada nace
   * en la misma transacción y la limpieza la encuentra sola por el material que toca.
   */
  const unaVez = async (clave: string, hacer: () => Promise<number>): Promise<void> => {
    const antes = ctx.marcador.creados;
    await asegurar(
      cliente,
      ENTIDAD_DEMO.movimiento,
      clave,
      async (x) => (await cliente.movimiento.count({ where: { id: x } })) > 0,
      hacer,
      ctx.marcador,
    );
    if (ctx.marcador.creados > antes) hechos += 1;
  };

  // (a) Conteo físico inicial de tela en el almacén Sur (existencia sin pasar por una OC).
  await unaVez(
    'MOV-AJ-TELA-01',
    async () =>
      (
        await ajustarInventarioTelaColor(sesion, {
          idTipoMov: idAjusteEntrada,
          idAlmacen: telaS,
          fecha: fecha(-DIAS_ATRAS_BASE),
          motivo: `${PREFIJO_DEMO}conteo físico inicial (datos de prueba)`,
          factura: `${PREFIJO_DEMO}CONTEO-1`,
          lineas: [
            {
              idTelaColor: color('TELA-05#0'),
              cantidad: 180,
              loteProveedor: `${PREFIJO_DEMO}L-C1`,
            },
            { idTelaColor: color('TELA-09#1'), cantidad: 95, loteProveedor: `${PREFIJO_DEMO}L-C2` },
            {
              idTelaColor: color('TELA-12#0'),
              cantidad: 240,
              loteProveedor: `${PREFIJO_DEMO}L-C3`,
            },
            {
              idTelaColor: color('TELA-15#1'),
              cantidad: 120,
              cantidadComplemento: 18,
              loteProveedor: `${PREFIJO_DEMO}L-C4`,
            },
          ],
        })
      ).id,
  );

  // (b) Conteo físico inicial de avíos genéricos en el almacén Sur.
  await unaVez(
    'MOV-AJ-AVIO-01',
    async () =>
      (
        await ajustarInventarioAvio(sesion, {
          idTipoMov: idAjusteEntrada,
          idAlmacen: avioS,
          fecha: fecha(-DIAS_ATRAS_BASE),
          motivo: `${PREFIJO_DEMO}conteo físico inicial de genéricos (datos de prueba)`,
          lineas: [
            { idAvio: avio(`${PREFIJO_DEMO}AV-014`), cantidad: 40 },
            { idAvio: avio(`${PREFIJO_DEMO}AV-015`), cantidad: 35 },
            { idAvio: avio(`${PREFIJO_DEMO}AV-026`), cantidad: 6000 },
          ],
        })
      ).id,
  );

  // (c) Traspasos de tela Norte → Sur (dos patas atómicas, D3).
  await unaVez(
    'MOV-TR-TELA-01',
    async () =>
      (
        await traspasarTelaColor(sesion, {
          idAlmacenOrigen: telaN,
          idAlmacenDestino: telaS,
          fecha: fecha(-20),
          motivo: `${PREFIJO_DEMO}traspaso de prueba entre bodegas`,
          lineas: [
            { idTelaColor: color('TELA-01#0'), cantidad: 60, cantidadComplemento: 8 },
            { idTelaColor: color('TELA-02#0'), cantidad: 40 },
          ],
        })
      ).salida.id,
  );
  await unaVez(
    'MOV-TR-TELA-02',
    async () =>
      (
        await traspasarTelaColor(sesion, {
          idAlmacenOrigen: telaN,
          idAlmacenDestino: telaS,
          fecha: fecha(-12),
          motivo: `${PREFIJO_DEMO}segundo traspaso de prueba`,
          lineas: [{ idTelaColor: color('TELA-05#1'), cantidad: 120 }],
        })
      ).salida.id,
  );

  // (d) Traspaso de avíos Norte → Sur.
  await unaVez(
    'MOV-TR-AVIO-01',
    async () =>
      (
        await traspasarAvio(sesion, {
          idAlmacenOrigen: avioN,
          idAlmacenDestino: avioS,
          fecha: fecha(-18),
          motivo: `${PREFIJO_DEMO}traspaso de avíos de prueba`,
          lineas: [
            { idAvio: avio(`${PREFIJO_DEMO}AV-001`), cantidad: 500 },
            { idAvio: avio(`${PREFIJO_DEMO}AV-005`), cantidad: 1200 },
          ],
        })
      ).salida.id,
  );

  // (e) Una salida por ajuste (merma), para que el kardex tenga movimientos en los dos sentidos.
  await unaVez(
    'MOV-AJ-AVIO-02',
    async () =>
      (
        await ajustarInventarioAvio(sesion, {
          idTipoMov: idAjusteSalida,
          idAlmacen: avioN,
          fecha: fecha(-6),
          motivo: `${PREFIJO_DEMO}merma de prueba`,
          lineas: [{ idAvio: avio(`${PREFIJO_DEMO}AV-005`), cantidad: 150 }],
        })
      ).id,
  );

  return hechos;
}

// ── CFDI ficticios ───────────────────────────────────────────────────────────────────────────────

/**
 * Los comprobantes ficticios. Los tres primeros CASAN con las OC que quedan SIN RECIBIR (mismo
 * proveedor y total = Σ de la OC + IVA), que es justo la prueba útil: recibir con su factura. Los
 * dos últimos NO casan a propósito.
 */
export function catalogoCfdiDemo(): CfdiDemo[] {
  const totalOc = (clave: string): number => {
    const oc = ORDENES_COMPRA_DEMO.find((o) => o.clave === clave) as OcDemo;
    return oc.lineas.reduce((suma, l) => {
      const precio =
        TELAS_DEMO.find((t) => t.clave === l.material)?.precioSugerido ??
        AVIOS_DEMO.find((a) => a.clave === l.material)?.precio ??
        0;
      return suma + precio * l.cantidad;
    }, 0);
  };
  return [
    {
      archivo: 'demo-cfdi-casa-oc-04.xml',
      uuid: 'DEM00004-0000-4000-8000-000000000004',
      tipo: 'I',
      emisorRfc: 'DMB200101A02',
      emisorNombre: `${PREFIJO_DEMO}Tejidos Altamar`,
      fecha: fecha(-3),
      subtotal: totalOc('OC-04'),
      concepto: 'Mezclilla 10 oz (datos de prueba)',
      nota: 'CASA con OC-04 (DEMO-Tejidos Altamar), total = Σ de la OC + IVA.',
    },
    {
      archivo: 'demo-cfdi-casa-oc-08.xml',
      uuid: 'DEM00008-0000-4000-8000-000000000008',
      tipo: 'I',
      emisorRfc: 'DMD200101A04',
      emisorNombre: `${PREFIJO_DEMO}Textiles Poniente`,
      fecha: fecha(-2),
      subtotal: totalOc('OC-08'),
      concepto: 'Rib 2x2 240 (datos de prueba)',
      nota: 'CASA con OC-08 (DEMO-Textiles Poniente), total = Σ de la OC + IVA.',
    },
    {
      archivo: 'demo-cfdi-casa-oc-12.xml',
      uuid: 'DEM00012-0000-4000-8000-000000000012',
      tipo: 'I',
      emisorRfc: 'DMF200101A06',
      emisorNombre: `${PREFIJO_DEMO}Cierres y Botones Nogal`,
      fecha: fecha(-1),
      subtotal: totalOc('OC-12'),
      concepto: 'Cierres nylon (datos de prueba)',
      nota: 'CASA con OC-12 (DEMO-Cierres y Botones Nogal), total = Σ de la OC + IVA.',
    },
    {
      archivo: 'demo-cfdi-nota-credito.xml',
      uuid: 'DEM000NC-0000-4000-8000-0000000000nc',
      tipo: 'E',
      emisorRfc: 'DMA200101A01',
      emisorNombre: `${PREFIJO_DEMO}Telas del Bajío`,
      fecha: fecha(-4),
      subtotal: 2500,
      concepto: 'Nota de credito por tela devuelta (datos de prueba)',
      nota: 'Nota de crédito (tipo E) de DEMO-Telas del Bajío: prueba el abono, no casa con una OC.',
    },
    {
      archivo: 'demo-cfdi-no-casa-importe.xml',
      uuid: 'DEM000X1-0000-4000-8000-0000000000x1',
      tipo: 'I',
      emisorRfc: 'DMD200101A04',
      emisorNombre: `${PREFIJO_DEMO}Textiles Poniente`,
      fecha: fecha(-2),
      subtotal: totalOc('OC-08') + 7431.5,
      concepto: 'Rib 2x2 240 (datos de prueba)',
      nota: '🔴 NO CASA: proveedor correcto (OC-08) pero el total viene 7,431.50 + IVA por encima.',
    },
    {
      archivo: 'demo-cfdi-no-casa-proveedor.xml',
      uuid: 'DEM000X2-0000-4000-8000-0000000000x2',
      tipo: 'I',
      emisorRfc: 'DMZ200101A99',
      emisorNombre: `${PREFIJO_DEMO}Proveedor que no está dado de alta`,
      fecha: fecha(-1),
      subtotal: 18900,
      concepto: 'Material sin orden de compra (datos de prueba)',
      nota: '🔴 NO CASA: el emisor NO existe en el catálogo de proveedores.',
    },
  ];
}

/** Escribe los XML ficticios en `dir` (los sobrescribe: el receptor depende de la empresa). */
async function escribirCfdiDemo(
  cliente: PrismaClient,
  idEmpresa: number,
  dir: string,
  reporte: Reporte,
): Promise<number> {
  const empresa = await cliente.empresa.findUnique({
    where: { id: idEmpresa },
    select: { nombre: true, rfc: true },
  });
  const receptorRfc = empresa?.rfc?.trim() ?? '';
  const rfc = receptorRfc === '' ? 'XAXX010101000' : receptorRfc;
  // Mientras la empresa no tenga RFC, el receptor va con el RFC genérico del público en general Y
  // con un nombre NEUTRO: estos archivos se versionan en el repo, que es PÚBLICO, y ahí no tiene por
  // qué quedar el nombre de nadie. En cuanto la empresa capture su RFC, el archivo se reescribe con
  // sus datos reales, que es lo que el importador exige para no rechazarlo por receptor ajeno.
  const nombreReceptor =
    receptorRfc === '' ? 'Empresa receptora (datos de prueba)' : (empresa?.nombre ?? 'Empresa');
  if (receptorRfc === '') {
    reporte.nota(
      'La empresa no tiene RFC capturado: los CFDI ficticios salieron a nombre de XAXX010101000. ' +
        'Al capturar el RFC en Administración › Empresas, vuelve a correr el sembrador para que ' +
        'los archivos se reescriban con él (si no, el importador los rechaza por receptor ajeno).',
    );
  }
  await mkdir(dir, { recursive: true });
  const catalogo = catalogoCfdiDemo();
  for (const c of catalogo) {
    await writeFile(join(dir, c.archivo), construirCfdiDemo(c, rfc, nombreReceptor), 'utf8');
    reporte.agregar(
      'CFDI ficticios escritos',
      `${c.archivo} · emisor ${c.emisorRfc} · total ${totalCfdi(c).toFixed(2)} — ${c.nota}`,
    );
  }
  return catalogo.length;
}
