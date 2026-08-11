/**
 * Loader de NOTAS DE SALIDA históricas (F4-E6, Pieza A).
 *
 *   `Notas.csv` (4,712)    → `NotaSalida`       (encabezado; folio = NumNota)
 *   `NotasDet.csv` (11,459) → `NotaSalidaLinea` (renglones como TEXTO LIBRE — sin catálogo)
 *
 * Carga vía el MODO MIGRACIÓN del dominio (`crearNotaMigrada`, A1): folio EXPLÍCITO, SIN impacto
 * retroactivo a inventario (las notas legacy son DOCUMENTO HISTÓRICO; solo las notas NUEVAS de v2
 * descuentan kardex). Reglas DURAS (nada se pierde en silencio §7):
 *  • idEmpresa: el viejo `Notas` NO trae empresa → se deriva de la PRIMERA orden ligada de sus
 *    renglones (`NotasDet.IdOrdenes` → Orden v2 → `idEmpresa`). Sin ninguna orden mapeable → nota
 *    OMITIDA + listada (no hay empresa a la que pertenezca; el folio es por empresa, A9).
 *  • idMaquilero: `Notas.IdMaquileros` → Proveedor (mapeo F1, rol maquilero). 0/vacío/sin mapeo →
 *    nota OMITIDA + listada (la FK `idMaquilero` es NOT NULL; no se inventa el tercero).
 *  • idAlmacen: el viejo no tenía almacén origen en la nota → almacén SENTINELA INACTIVO
 *    `(histórico — sin almacén)` (lo asegura este loader, espejo del Color/Talla sentinela de F3-E6).
 *  • Renglones: `NotasDet.Descripcion` → `descripcionLegacy` (texto libre, NO mapea a catálogo);
 *    cada renglón se liga a su orden v2 (`NotasDet.IdOrdenes` → mapeo F2). Renglón con orden sin
 *    mapeo o descripción vacía → renglón OMITIDO + listado (no se inventa la liga).
 *  • Ventana de 10 años: configurable (`comun/ventana.ts`); por defecto NO recorta. Lo excluido se
 *    cuenta y reporta.
 *
 * Idempotencia: por el `MapeoMigracion` de `IdNotas` y, en su defecto, por el unique
 * `(idEmpresa, numNota)`. En 2ª corrida no duplica.
 *
 * ⚠️ COLISIÓN DE FOLIO: encontrar una nota con ese `numNota` ya NO basta para darla por "la misma".
 * En el re-volcado del go-live, v2 pudo capturar su propia nota con ese número y el Access traer
 * otra distinta con el mismo — mapearlas juntas era historia pegada al documento equivocado, en
 * silencio. `comun/colision-folio.ts` distingue la recuperación de una corrida cortada (la creó el
 * ETL y nadie más la reclama) de la colisión, que NO se migra y se REPORTA.
 */
import { crearNotaMigrada, type LineaNotaMigrada } from '../../src/dominio/notas/migracion.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';
import type { ContextoBd } from '../../src/comun/transaccion.js';
import { TipoAlmacen, type PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import { CONCURRENCIA_ETL, enLotes } from '../comun/lotes.js';
import {
  cargarMapaNumerico,
  ENTIDAD_MAPEO,
  guardarMapeo,
  leerMapeo,
  type ClienteMapeo,
} from '../comun/mapeo.js';
import { conReintentoTransitorio } from '../comun/reintentos.js';
import type { Reporte } from '../comun/reporte.js';
import { GuardiaFolios } from '../comun/colision-folio.js';
import { intentarCrear } from '../comun/saneo.js';
import { parsearFecha, parsearFechaSoloDia, parsearTexto } from '../comun/valores.js';
import { dentroVentana, type ConfigVentana } from '../comun/ventana.js';
import type { ResultadoLoader } from './clientes.js';

/** Nombre del almacén SENTINELA del histórico de notas (INACTIVO, global, no visible en captura). */
export const ALMACEN_SENTINELA_NOTAS = '(histórico — sin almacén)';

/** Resultado del loader de notas. */
export interface ResultadoNotasSalida {
  notas: ResultadoLoader;
  /** # de renglones (NotaSalidaLinea) creados. */
  lineas: number;
  /** # de notas excluidas por la ventana temporal. */
  fueraVentana: number;
  /**
   * # de notas NO migradas porque el ACCESS trae otra nota con el mismo `numNota` (culpa del
   * origen, no de la base de v2). Ver `comun/colision-folio.ts`.
   */
  duplicadosOrigen: number;
  /**
   * # de notas NO migradas porque su `numNota` ya lo ocupaba una nota CAPTURADA EN V2 (ver
   * `comun/colision-folio.ts`). Se cuentan APARTE de las `existentes`: contarlas ahí era justo lo
   * que las volvía invisibles. Salen listadas una por una en el reporte.
   */
  colisionesFolio: number;
}

/** Empresa+orden v2 de una orden vieja (para resolver empresa de la nota y ligar renglones). */
interface OrdenV2 {
  idOrden: number;
  idEmpresa: number;
}

/** Mapeos + cachés que necesita cada nota. */
interface ContextoNotas {
  mapaMaquilero: Map<string, number>;
  /** IdOrdenes viejo → { idOrden v2, idEmpresa }. */
  ordenV2: Map<string, OrdenV2>;
  detPorNota: Map<string, Record<string, string>[]>;
  idAlmacenSentinela: number;
  ventana: ConfigVentana;
  /** Guardia de colisión de folio del re-volcado (`comun/colision-folio.ts`). */
  guardia: GuardiaFolios;
}

/** Contribución de UNA nota a los conteos. */
interface ContribNota {
  estado:
    | 'creado'
    | 'existente'
    | 'omitido'
    | 'omitidoValidacion'
    | 'fueraVentana'
    // Duplicado del origen o colisión con v2: el desglose lo lleva el guardia.
    | 'folioOcupado';
  lineas: number;
}

/**
 * Asegura (idempotente) el almacén SENTINELA del histórico de notas: GLOBAL (`idEmpresa = null`),
 * INACTIVO (no aparece en los selectores de captura). Acceso DIRECTO a la tabla (no por
 * `crearAlmacen`, que crea ACTIVOS y exige tipo/empresa de captura) — mismo criterio que el
 * Color/Talla sentinela de F3-E6: es un artefacto técnico de la migración, no data de negocio
 * capturable. Tipo `TELA` (el más cercano; es inactivo de todas formas).
 *
 * Se busca con `findFirst` (no `upsert`/`findUnique`): el unique compuesto `(idEmpresa, nombre)`
 * NO aplica cuando `idEmpresa` es NULL (en SQL los NULL son distintos), así que `findUnique` por la
 * clave compuesta con `idEmpresa: null` no es fiable. Se llama UNA vez, secuencialmente, ANTES del
 * bucle concurrente → sin carrera. Re-ejecutar el ETL reusa el mismo sentinela.
 */
export async function asegurarAlmacenSentinela(cliente: ClienteMapeo): Promise<number> {
  const existe = await cliente.almacen.findFirst({
    where: { idEmpresa: null, nombre: ALMACEN_SENTINELA_NOTAS },
    select: { id: true },
  });
  if (existe !== null) return existe.id;
  const creado = await cliente.almacen.create({
    data: { nombre: ALMACEN_SENTINELA_NOTAS, tipo: TipoAlmacen.TELA, activo: false },
    select: { id: true },
  });
  return creado.id;
}

export async function cargarNotasSalida(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
  ventana: ConfigVentana,
): Promise<ResultadoNotasSalida> {
  const bd: ContextoBd = { cliente: cliente as PrismaClient };
  const cli = cliente as PrismaClient;

  const idAlmacenSentinela = await asegurarAlmacenSentinela(cliente);
  reporte.nota(
    `Notas (histórico): cada nota usa el almacén SENTINELA "${ALMACEN_SENTINELA_NOTAS}" (INACTIVO, ` +
      'no visible en captura) — el viejo no registraba almacén origen en la nota. SIN descuento de kardex.',
  );

  const mapaMaquilero = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.proveedorPorIdMaquileros);
  const mapaOrden = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.orden);

  // idEmpresa por orden v2 (para derivar la empresa de la nota). Una query a Orden.
  const ordenV2 = new Map<string, OrdenV2>();
  // mapaOrden: IdOrdenes viejo → idOrden v2. Necesitamos la empresa de cada idOrden v2.
  const idsOrdenV2 = [...new Set(mapaOrden.values())];
  const empresaPorOrden = new Map<number, number>();
  // En lotes para no pasar un IN gigante.
  const TAM = 1000;
  for (let i = 0; i < idsOrdenV2.length; i += TAM) {
    const lote = idsOrdenV2.slice(i, i + TAM);
    const filas = await cli.orden.findMany({
      where: { id: { in: lote } },
      select: { id: true, idEmpresa: true },
    });
    for (const o of filas) empresaPorOrden.set(o.id, o.idEmpresa);
  }
  for (const [idViejo, idNuevo] of mapaOrden) {
    const idEmpresa = empresaPorOrden.get(idNuevo);
    if (idEmpresa !== undefined) {
      ordenV2.set(idViejo, { idOrden: idNuevo, idEmpresa });
    }
  }

  // Detalle agrupado por IdNotas.
  const detPorNota = new Map<string, Record<string, string>[]>();
  for (const f of leerCsv('NotasDet.csv')) {
    const idNota = (f.IdNotas ?? '').trim();
    if (idNota === '') continue;
    const lista = detPorNota.get(idNota) ?? [];
    lista.push(f);
    detPorNota.set(idNota, lista);
  }

  const resultado: ResultadoNotasSalida = {
    notas: { creados: 0, existentes: 0, omitidos: 0, omitidosValidacion: 0 },
    lineas: 0,
    fueraVentana: 0,
    duplicadosOrigen: 0,
    colisionesFolio: 0,
  };

  const ctx: ContextoNotas = {
    mapaMaquilero,
    ordenV2,
    detPorNota,
    idAlmacenSentinela,
    ventana,
    guardia: new GuardiaFolios(
      cliente,
      ENTIDAD_MAPEO.notaSalida,
      'NotaSalida',
      'sus renglones (el material que salió con esa nota)',
    ),
  };

  const filas = leerCsv('Notas.csv');
  const contribs = await enLotes(
    filas,
    (f) => conReintentoTransitorio(() => procesarNota(sesion, bd, cli, reporte, f, ctx)),
    CONCURRENCIA_ETL,
  );

  for (const res of contribs) {
    if (!res.ok) {
      resultado.notas.omitidosValidacion = (resultado.notas.omitidosValidacion ?? 0) + 1;
      continue;
    }
    const c = res.valor;
    if (c.estado === 'creado') resultado.notas.creados += 1;
    else if (c.estado === 'existente') resultado.notas.existentes += 1;
    else if (c.estado === 'omitido') resultado.notas.omitidos += 1;
    else if (c.estado === 'fueraVentana') resultado.fueraVentana += 1;
    // `folioOcupado` lo cuenta el guardia, ya separado en duplicado-de-origen vs colisión-con-v2.
    else if (c.estado !== 'folioOcupado')
      resultado.notas.omitidosValidacion = (resultado.notas.omitidosValidacion ?? 0) + 1;
    resultado.lineas += c.lineas;
  }

  const conteos = ctx.guardia.conteos;
  resultado.duplicadosOrigen = conteos.duplicadoOrigen;
  resultado.colisionesFolio = conteos.colisionV2;
  return resultado;
}

async function procesarNota(
  sesion: SesionUsuario,
  bd: ContextoBd,
  cliente: PrismaClient,
  reporte: Reporte,
  f: Record<string, string>,
  ctx: ContextoNotas,
): Promise<ContribNota> {
  const idViejo = (f.IdNotas ?? '').trim();
  const sin = (estado: ContribNota['estado']): ContribNota => ({ estado, lineas: 0 });

  // Idempotencia primero.
  const ya = await leerMapeo(cliente, ENTIDAD_MAPEO.notaSalida, idViejo);
  if (ya !== null) {
    return sin('existente');
  }

  const numNota = parsearTexto(f.NumNota);
  const numNotaN = numNota === null ? null : Number(numNota);
  if (numNotaN === null || !Number.isFinite(numNotaN)) {
    reporte.agregar('Nota sin NumNota numérico (OMITIDA)', `IdNotas=${idViejo}`);
    return sin('omitido');
  }

  // Maquilero (FK NOT NULL): sin mapeo → omitida.
  const idMaquileroCrudo = (f.IdMaquileros ?? '').trim();
  const idMaquilero =
    idMaquileroCrudo === '' || idMaquileroCrudo === '0'
      ? undefined
      : ctx.mapaMaquilero.get(idMaquileroCrudo);
  if (idMaquilero === undefined) {
    reporte.agregar(
      'Nota con maquilero sin mapeo/vacío (OMITIDA)',
      `IdNotas=${idViejo} IdMaquileros=${idMaquileroCrudo}`,
    );
    return sin('omitido');
  }

  // Renglones legacy: liga cada uno a su orden v2; deriva la empresa de la PRIMERA orden mapeable.
  const dets = ctx.detPorNota.get(idViejo) ?? [];
  const lineas: LineaNotaMigrada[] = [];
  let idEmpresa: number | null = null;
  for (const d of dets) {
    const idOrdenViejo = (d.IdOrdenes ?? '').trim();
    const orden =
      idOrdenViejo === '' || idOrdenViejo === '0' ? undefined : ctx.ordenV2.get(idOrdenViejo);
    if (orden === undefined) {
      reporte.agregar(
        'Nota: renglón con orden sin mapeo (renglón OMITIDO)',
        `IdNotas=${idViejo} IdNotasDet=${(d.IdNotasDet ?? '').trim()} IdOrdenes=${idOrdenViejo}`,
      );
      continue;
    }
    const descripcion = parsearTexto(d.Descripcion);
    if (descripcion === null) {
      reporte.agregar(
        'Nota: renglón con descripción vacía (renglón OMITIDO)',
        `IdNotas=${idViejo} IdNotasDet=${(d.IdNotasDet ?? '').trim()}`,
      );
      continue;
    }
    if (idEmpresa === null) idEmpresa = orden.idEmpresa;
    lineas.push({ idOrden: orden.idOrden, descripcionLegacy: descripcion });
  }

  if (idEmpresa === null) {
    // Ningún renglón con orden mapeable: la nota no tiene empresa a la que pertenecer (folio por
    // empresa, A9). No se migra; se lista (nada se pierde en silencio).
    reporte.agregar(
      'Nota sin ninguna orden mapeable (OMITIDA — no hay empresa para el folio)',
      `IdNotas=${idViejo} renglones=${String(dets.length)}`,
    );
    return sin('omitido');
  }

  // Ventana temporal (por fecha de elaboración).
  const fechaElaboracion = parsearFechaSoloDia(f.FechaElaboracion);
  if (!dentroVentana(fechaElaboracion, ctx.ventana)) {
    return sin('fueraVentana');
  }
  if (fechaElaboracion === null) {
    reporte.agregar('Nota sin FechaElaboracion parseable (OMITIDA)', `IdNotas=${idViejo}`);
    return sin('omitido');
  }

  // Idempotencia adicional por el unique (idEmpresa, numNota). OJO: que exista una nota con ese
  // número NO prueba que sea la misma. Puede ser la corrida anterior cortada entre el `create` y el
  // `guardarMapeo`… o una nota que v2 capturó con ese mismo número, que es OTRO documento.
  const existePorFolio = await cliente.notaSalida.findUnique({
    where: { idEmpresa_numNota: { idEmpresa, numNota: BigInt(numNotaN) } },
    select: { id: true, creadoPorId: true },
  });
  if (existePorFolio !== null) {
    const veredicto = await ctx.guardia.clasificar(idViejo, existePorFolio);
    if (veredicto !== 'recuperacion') {
      ctx.guardia.reportar(reporte, {
        claveVieja: idViejo,
        folio: numNotaN,
        existente: existePorFolio,
        veredicto,
        arrastreFila: `renglones=${String((ctx.detPorNota.get(idViejo) ?? []).length)}`,
      });
      return sin('folioOcupado');
    }
    ctx.guardia.registrarCreado(idViejo, existePorFolio.id);
    await guardarMapeo(cliente, ENTIDAD_MAPEO.notaSalida, idViejo, existePorFolio.id);
    return sin('existente');
  }

  const fechaEnvio = parsearFechaSoloDia(f.FechaEnvio);
  const creada = await intentarCrear(reporte, 'NotaSalida', idViejo, () =>
    crearNotaMigrada(
      sesion,
      {
        numNota: numNotaN,
        idEmpresa,
        idMaquilero,
        idAlmacen: ctx.idAlmacenSentinela,
        fechaElaboracion,
        fechaEnvio,
        observaciones: parsearTexto(f.Observaciones),
        // Sello histórico informativo (no hubo descuento real): la fecha de elaboración del viejo.
        confirmadaEn: parsearFecha(f.FechaElaboracion),
        confirmadaPorId: null,
        lineas,
      },
      bd,
    ),
  );
  if (creada === null) {
    return sin('omitidoValidacion');
  }
  // Se reclama el folio ANTES de mapearlo: entre el create y el guardarMapeo el mapeo aún no está
  // en la BD, y una fila concurrente con el mismo número lo tomaría por "recuperación".
  ctx.guardia.registrarCreado(idViejo, creada.idNotaSalida);
  await guardarMapeo(cliente, ENTIDAD_MAPEO.notaSalida, idViejo, creada.idNotaSalida);
  return { estado: 'creado', lineas: creada.lineas };
}
