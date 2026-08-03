/**
 * Loader de AUDITORÍAS de calidad históricas (F6-E6).
 *
 *   `CC_Auditorias.csv` (488, cabecera)   → `Auditoria`
 *   `CC_AuditoriasDet.csv` (15,296, det)  → `AuditoriaDefecto` (defecto→fallas)
 *
 * Carga VÍA el MODO MIGRACIÓN del dominio (`crearAuditoriaMigrada`, A1): crea la auditoría + su
 * detalle en UNA transacción, PRESERVA el folio `NumAuditoria`, el resultado/tipo/cancelación del
 * viejo, y NO dispara el evento de auto-avance de la RC (ver el TSDoc de `crearAuditoriaMigrada`).
 *
 * Mapeos de campos (CSV → v2):
 *  • `NumAuditoria → numAuditoria` (folio preservado; el ETL recalibra la secuencia al final).
 *  • `IdOrdenes → idOrden` (mapa 'Orden' de F2). Sin mapeo → auditoría OMITIDA (idOrden es FK
 *    obligatoria). El `idEmpresa` se deriva de la orden (A9).
 *  • `IdMaquilero → idMaquilero` (mapa 'Proveedor:IdMaquileros'; en el viejo `CC_Auditorias.IdMaquilero`
 *    referencia la tabla `Maquileros` de COSTURA — verificado en `CC_AltaAuditorias`). `0`/vacío →
 *    null; sin mapeo → null + reporte (idMaquilero es nullable).
 *  • `Resultado 1/2/0 → aprobado/reprobado/no_calificado` ({@link resultadoDesdeViejo}, calcado de
 *    `QueResultado` del módulo viejo). `TipoAuditoria 1/2/0 → en_piso/final/no_definida`
 *    ({@link tipoDesdeViejo}, calcado de `QueTipoAudit`).
 *  • `Cancelada → cancelada` (borrado suave). `Observaciones → observaciones`. `TamanoMuestra →
 *    tamanoMuestra` (0 si vacío). Fechas `@db.Date`; si falta `FechaAuditoria` cae a `FechaElaboracion`
 *    (y viceversa).
 *  • `IdUsuariosElaboro/Auditor → elaboroPorId/auditorPorId` como TEXTO del id viejo (sin FK,
 *    ADR-0005); `0`/vacío → null (F10 migrará usuarios y podrá remapearlos).
 *
 * Detalle: cada renglón de `CC_AuditoriasDet` resuelve `idDefecto` por el mapa 'DefectoCatalogo'.
 * Si el defecto no está mapeado, el renglón se OMITE + reporta. El `@@unique(idAuditoria, idDefecto)`
 * exige un renglón por defecto: los pares DUPLICADOS del viejo (p. ej. la auditoría 488) se SUMAN
 * (decisión documentada). Cada `IdCC_AuditoriasDet` viejo se mapea al `AuditoriaDefecto` resultante.
 *
 * VENTANA temporal (`ETL_DESDE`/`ETL_VENTANA_ANIOS`, default inactiva): una auditoría migra solo si
 * (a) su ORDEN está mapeada (cascada: orden fuera de ventana u origen inválido → auditoría al bucket
 * agregado) Y (b) su FECHA propia (`FechaAuditoria`, cae a `FechaElaboracion`) está `dentroVentana`
 * (fuera → bucket agregado `fueraVentana`). El DETALLE sigue a su auditoría (el hijo nunca migra sin
 * el padre). Con la ventana inactiva el comportamiento es EXACTAMENTE el de siempre.
 *
 * Idempotencia: por el `MapeoMigracion` de `IdCC_Auditorias` (y, defensivamente, por el
 * `@@unique(idEmpresa, numAuditoria)`). CONCURRENCIA: cada auditoría + su detalle es una unidad
 * INDEPENDIENTE → `enLotes` (pool acotado) envuelta en `conReintentoTransitorio` (la unidad es
 * idempotente; recupera de cortes de conexión).
 */
import {
  crearAuditoriaMigrada,
  type DefectoAuditoriaMigrado,
} from '../../src/dominio/calidad/auditorias.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';
import type { ContextoBd } from '../../src/comun/transaccion.js';
import type { PrismaClient, ResultadoAuditoria, TipoAuditoria } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import { CONCURRENCIA_ETL, enLotes } from '../comun/lotes.js';
import {
  cargarMapaNumerico,
  ENTIDAD_MAPEO,
  guardarMapeo,
  leerMapeo,
  type ClienteMapeo,
} from '../comun/mapeo.js';
import { MuestraAgregada } from '../comun/muestra.js';
import { conReintentoTransitorio } from '../comun/reintentos.js';
import type { Reporte } from '../comun/reporte.js';
import { intentarCrear } from '../comun/saneo.js';
import {
  parsearBandera,
  parsearEntero,
  parsearFechaSoloDia,
  parsearTexto,
} from '../comun/valores.js';
import { dentroVentana, resolverVentana, type ConfigVentana } from '../comun/ventana.js';
import type { ResultadoLoader } from './clientes.js';

/** Resultado del loader de auditorías (encabezados + agregados del detalle para el reporte/tests). */
export interface ResultadoAuditorias {
  auditorias: ResultadoLoader;
  /** `AuditoriaDefecto` creados (renglones defecto→fallas). */
  detallesCreados: number;
  /** Renglones viejos `CC_AuditoriasDet` mapeados a un `AuditoriaDefecto`. */
  detallesMapeados: number;
  /** Renglones viejos de detalle OMITIDOS (defecto sin mapeo o auditoría omitida). */
  detallesOmitidos: number;
  /** Renglones de detalle EXCLUIDOS en cascada por su auditoría fuera de ventana. */
  detallesFueraVentana: number;
  /** Auditorías cuyo maquilero viejo no resolvió a Proveedor (idMaquilero quedó null). */
  maquileroSinMapeo: number;
}

/** Un renglón crudo de `CC_AuditoriasDet` (agrupado por su auditoría). */
interface DetalleViejo {
  idCcDet: string;
  idCcCatalogo: string;
  numFallas: number;
}

/**
 * Resultado (`CC_Auditorias.Resultado`) del viejo → enum v2 (calca `QueResultado` de `Funciones CC`:
 * 1=Aprobado, 2=Reprobado, resto=No Calificado).
 */
export function resultadoDesdeViejo(crudo: string | undefined | null): ResultadoAuditoria {
  const t = (crudo ?? '').trim();
  if (t === '1') return 'aprobado';
  if (t === '2') return 'reprobado';
  return 'no_calificado';
}

/**
 * Tipo (`CC_Auditorias.TipoAuditoria`) del viejo → enum v2 (calca `QueTipoAudit` de `Funciones CC`:
 * 1=En Piso, 2=Final, resto=No Definida).
 */
export function tipoDesdeViejo(crudo: string | undefined | null): TipoAuditoria {
  const t = (crudo ?? '').trim();
  if (t === '1') return 'en_piso';
  if (t === '2') return 'final';
  return 'no_definida';
}

/** Id de usuario VIEJO como texto (sin FK); `0`/vacío → null. */
function idUsuarioViejo(crudo: string | undefined | null): string | null {
  const t = (crudo ?? '').trim();
  return t === '' || t === '0' ? null : t;
}

/** Contribución de UNA auditoría a los conteos (se suma tras los lotes). */
interface ContribAud {
  estado: 'creado' | 'existente' | 'omitido' | 'omitidoValidacion' | 'fueraVentana';
  detCreados: number;
  detMapeados: number;
  detOmitidos: number;
  /** Detalles excluidos en cascada porque su auditoría quedó fuera de ventana. */
  detFueraVentana: number;
  maquileroSinMapeo: number;
}

interface ContextoAud {
  mapaOrden: Map<string, number>;
  mapaMaquilero: Map<string, number>;
  mapaDefecto: Map<string, number>;
  detPorAud: Map<string, DetalleViejo[]>;
  ventana: ConfigVentana;
  /** Bucket agregado: auditorías con orden no migrada (fuera de ventana u origen inválido). */
  bucketOrdenNoMigrada: MuestraAgregada;
  /** Bucket agregado: auditorías con fecha propia fuera de la ventana temporal. */
  bucketFueraVentana: MuestraAgregada;
}

export async function cargarAuditorias(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
  ventana: ConfigVentana = resolverVentana(),
): Promise<ResultadoAuditorias> {
  const bd: ContextoBd = { cliente: cliente as PrismaClient };
  const cli = cliente as PrismaClient;

  const mapaOrden = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.orden);
  const mapaMaquilero = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.proveedorPorIdMaquileros);
  const mapaDefecto = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.defectoCatalogo);

  // Detalle agrupado por IdCC_Auditorias.
  const detPorAud = new Map<string, DetalleViejo[]>();
  for (const f of leerCsv('CC_AuditoriasDet.csv')) {
    const idAud = (f.IdCC_Auditorias ?? '').trim();
    const idCcDet = (f.IdCC_AuditoriasDet ?? '').trim();
    if (idAud === '' || idCcDet === '') continue;
    const lista = detPorAud.get(idAud) ?? [];
    lista.push({
      idCcDet,
      idCcCatalogo: (f.IdCC_Catalogo ?? '').trim(),
      numFallas: parsearEntero(f.NumFallas) ?? 0,
    });
    detPorAud.set(idAud, lista);
  }

  const ctx: ContextoAud = {
    mapaOrden,
    mapaMaquilero,
    mapaDefecto,
    detPorAud,
    ventana,
    bucketOrdenNoMigrada: new MuestraAgregada(),
    bucketFueraVentana: new MuestraAgregada(),
  };

  const filas = leerCsv('CC_Auditorias.csv');
  const contribs = await enLotes(
    filas,
    (f) => conReintentoTransitorio(() => procesarAuditoria(sesion, bd, cli, reporte, ctx, f)),
    CONCURRENCIA_ETL,
  );

  const resultado: ResultadoAuditorias = {
    auditorias: { creados: 0, existentes: 0, omitidos: 0, omitidosValidacion: 0, fueraVentana: 0 },
    detallesCreados: 0,
    detallesMapeados: 0,
    detallesOmitidos: 0,
    detallesFueraVentana: 0,
    maquileroSinMapeo: 0,
  };
  for (const res of contribs) {
    if (!res.ok) {
      resultado.auditorias.omitidosValidacion = (resultado.auditorias.omitidosValidacion ?? 0) + 1;
      continue;
    }
    const c = res.valor;
    if (c.estado === 'creado') resultado.auditorias.creados += 1;
    else if (c.estado === 'existente') resultado.auditorias.existentes += 1;
    else if (c.estado === 'omitido') resultado.auditorias.omitidos += 1;
    else if (c.estado === 'fueraVentana')
      resultado.auditorias.fueraVentana = (resultado.auditorias.fueraVentana ?? 0) + 1;
    else
      resultado.auditorias.omitidosValidacion = (resultado.auditorias.omitidosValidacion ?? 0) + 1;
    resultado.detallesCreados += c.detCreados;
    resultado.detallesMapeados += c.detMapeados;
    resultado.detallesOmitidos += c.detOmitidos;
    resultado.detallesFueraVentana += c.detFueraVentana;
    resultado.maquileroSinMapeo += c.maquileroSinMapeo;
  }

  ctx.bucketOrdenNoMigrada.volcar(
    reporte,
    'Auditoría con orden no migrada (fuera de ventana u origen inválido) — OMITIDA (agregado)',
  );
  ctx.bucketFueraVentana.volcar(
    reporte,
    'Auditoría FUERA de la ventana temporal (EXCLUIDA con su detalle) (agregado)',
  );

  return resultado;
}

/** Procesa UNA auditoría + su detalle (idempotente, tolerante). Devuelve su contribución. */
async function procesarAuditoria(
  sesion: SesionUsuario,
  bd: ContextoBd,
  cli: PrismaClient,
  reporte: Reporte,
  ctx: ContextoAud,
  f: Record<string, string>,
): Promise<ContribAud> {
  const idViejo = (f.IdCC_Auditorias ?? '').trim();
  const dets = ctx.detPorAud.get(idViejo) ?? [];
  const base = (
    estado: ContribAud['estado'],
    detOmitidos = 0,
    detFueraVentana = 0,
  ): ContribAud => ({
    estado,
    detCreados: 0,
    detMapeados: 0,
    detOmitidos,
    detFueraVentana,
    maquileroSinMapeo: 0,
  });

  // Idempotencia 1: ¿ya mapeada?
  const ya = await leerMapeo(cli, ENTIDAD_MAPEO.auditoria, idViejo);
  if (ya !== null) {
    return base('existente');
  }

  const num = parsearEntero(f.NumAuditoria);
  if (num === null) {
    reporte.agregar('Auditoría sin NumAuditoria numérico (omitida)', `IdCC_Auditorias=${idViejo}`);
    return base('omitido', dets.length);
  }

  const idOrdenViejo = (f.IdOrdenes ?? '').trim();
  const idOrden = ctx.mapaOrden.get(idOrdenViejo);
  if (idOrden === undefined) {
    // Bucket agregado: con la ventana activa pueden ser CIENTOS (órdenes fuera de ventana).
    ctx.bucketOrdenNoMigrada.agregar(
      `IdCC_Auditorias=${idViejo} IdOrdenes=${idOrdenViejo} detalles=${String(dets.length)}`,
    );
    return base('omitido', dets.length);
  }
  const orden = await cli.orden.findUnique({ where: { id: idOrden }, select: { idEmpresa: true } });
  if (orden === null) {
    reporte.agregar(
      'Auditoría con orden inexistente en v2 (OMITIDA)',
      `IdCC_Auditorias=${idViejo} IdOrdenes=${idOrdenViejo}`,
    );
    return base('omitido', dets.length);
  }
  const idEmpresa = orden.idEmpresa;

  // Idempotencia 2 (defensiva): ¿ya existe por (idEmpresa, numAuditoria)? (recupera corrida parcial).
  const existePorFolio = await cli.auditoria.findUnique({
    where: { idEmpresa_numAuditoria: { idEmpresa, numAuditoria: BigInt(num) } },
    select: { id: true },
  });
  if (existePorFolio !== null) {
    await guardarMapeo(cli, ENTIDAD_MAPEO.auditoria, idViejo, existePorFolio.id);
    return base('existente');
  }

  // Fechas (@db.Date): si falta una, cae a la otra. Ambas nulas → omitir (no fabricar fechas).
  const fechaElab = parsearFechaSoloDia(f.FechaElaboracion);
  const fechaAud = parsearFechaSoloDia(f.FechaAuditoria);
  const fechaElaboracion = fechaElab ?? fechaAud;
  const fechaAuditoria = fechaAud ?? fechaElab;
  if (fechaElaboracion === null || fechaAuditoria === null) {
    reporte.agregar(
      'Auditoría sin fecha parseable (OMITIDA — las fechas son obligatorias)',
      `IdCC_Auditorias=${idViejo} FechaElaboracion="${f.FechaElaboracion ?? ''}" FechaAuditoria="${f.FechaAuditoria ?? ''}"`,
    );
    return base('omitido', dets.length);
  }

  // Ventana temporal por la fecha PROPIA de la auditoría (la de auditoría, ya con fallback). El
  // detalle sigue a su auditoría (cascada). Con ventana inactiva `dentroVentana` siempre es true.
  // Va ANTES de resolver el maquilero: una auditoría excluida por ventana NO debe aportar stats ni
  // incidencias de maquilero (sería ruido de registros que a propósito no migran).
  if (!dentroVentana(fechaAuditoria, ctx.ventana)) {
    ctx.bucketFueraVentana.agregar(
      `IdCC_Auditorias=${idViejo} fecha=${fechaAuditoria.toISOString().slice(0, 10)} detalles=${String(dets.length)}`,
    );
    return base('fueraVentana', 0, dets.length);
  }

  // Maquilero (costura): 0/vacío → null; sin mapeo → null + reporte.
  const idMaquileroViejo = (f.IdMaquilero ?? '').trim();
  let idMaquilero: number | null = null;
  let maquileroSinMapeo = 0;
  if (idMaquileroViejo !== '' && idMaquileroViejo !== '0') {
    const m = ctx.mapaMaquilero.get(idMaquileroViejo);
    if (m === undefined) {
      reporte.agregar(
        'Auditoría con maquilero sin mapeo (idMaquilero NULL — es nullable)',
        `IdCC_Auditorias=${idViejo} IdMaquilero=${idMaquileroViejo}`,
      );
      maquileroSinMapeo = 1;
    } else {
      idMaquilero = m;
    }
  }

  // Detalle: resuelve idDefecto, agrupa por defecto SUMANDO fallas (duplicados del viejo), y guarda
  // qué IdCC_AuditoriasDet contribuyeron a cada defecto (para mapearlos al AuditoriaDefecto creado).
  const porDefecto = new Map<number, { numFallas: number; srcs: string[] }>();
  let detOmitidos = 0;
  for (const d of dets) {
    const idDefecto = ctx.mapaDefecto.get(d.idCcCatalogo);
    if (idDefecto === undefined) {
      reporte.agregar(
        'Detalle de auditoría con defecto sin mapeo (OMITIDO)',
        `IdCC_AuditoriasDet=${d.idCcDet} IdCC_Catalogo=${d.idCcCatalogo} IdCC_Auditorias=${idViejo}`,
      );
      detOmitidos += 1;
      continue;
    }
    const prev = porDefecto.get(idDefecto);
    if (prev === undefined) {
      porDefecto.set(idDefecto, { numFallas: d.numFallas, srcs: [d.idCcDet] });
    } else {
      prev.numFallas += d.numFallas;
      prev.srcs.push(d.idCcDet);
    }
  }
  const defectos: DefectoAuditoriaMigrado[] = [...porDefecto.entries()].map(([idDefecto, v]) => ({
    idDefecto,
    numFallas: v.numFallas,
  }));

  const creada = await intentarCrear(reporte, 'Auditoria', idViejo, () =>
    crearAuditoriaMigrada(
      sesion,
      {
        numAuditoria: num,
        idEmpresa,
        idOrden,
        idMaquilero,
        fechaElaboracion,
        fechaAuditoria,
        elaboroPorId: idUsuarioViejo(f.IdUsuariosElaboro),
        auditorPorId: idUsuarioViejo(f.IdUsuariosAuditor),
        tamanoMuestra: parsearEntero(f.TamanoMuestra) ?? 0,
        resultado: resultadoDesdeViejo(f.Resultado),
        tipoAuditoria: tipoDesdeViejo(f.TipoAuditoria),
        observaciones: parsearTexto(f.Observaciones),
        cancelada: parsearBandera(f.Cancelada),
        claveVieja: idViejo,
        defectos,
      },
      bd,
    ),
  );
  if (creada === null) {
    return { ...base('omitidoValidacion', detOmitidos), maquileroSinMapeo };
  }
  await guardarMapeo(cli, ENTIDAD_MAPEO.auditoria, idViejo, creada.idAuditoria);

  // Mapea cada IdCC_AuditoriasDet viejo → el AuditoriaDefecto creado de su defecto.
  const idAudDefPorDefecto = new Map(creada.defectos.map((d) => [d.idDefecto, d.id]));
  const mapeosDet: Promise<void>[] = [];
  let detMapeados = 0;
  for (const [idDefecto, v] of porDefecto) {
    const idAudDef = idAudDefPorDefecto.get(idDefecto);
    if (idAudDef === undefined) continue;
    for (const src of v.srcs) {
      mapeosDet.push(guardarMapeo(cli, ENTIDAD_MAPEO.auditoriaDefecto, src, idAudDef));
      detMapeados += 1;
    }
  }
  await Promise.all(mapeosDet);

  return {
    estado: 'creado',
    detCreados: creada.defectos.length,
    detMapeados,
    detOmitidos,
    detFueraVentana: 0,
    maquileroSinMapeo,
  };
}
