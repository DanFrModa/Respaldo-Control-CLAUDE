/**
 * Loader del BOM de modelos (F1-E7). Carga los tres tipos de renglón de receta:
 *
 *  • `ModelosTela.csv`  (~791)  → `ModeloTela`  (telas del BOM, consumo + banderas).
 *  • `ModelosHab.csv`   (~7163) → `ModeloAvio`  (avíos/habilitación del BOM, consumo + banderas).
 *  • `ModelosBor.csv` + `Bordados.csv` (~2378 / 2964) → `ModeloArte` (el ARTE del modelo).
 *
 * Regla A1: la carga usa los servicios de dominio `reemplazarTelasBom`, `reemplazarAviosBom` y
 * `crearArte`. Para la idempotencia del ETL, telas y avíos se agrupan POR MODELO y se llama al
 * "set-completo" del dominio: el dominio hace el diff (agrega/quita/actualiza) de forma atómica
 * (A2). Re-ejecutar produce el mismo estado.
 *
 * ⚙️ **Todo se escribe POR LOTES, nunca registro por registro** (regla de Gabriel, `CLAUDE.md` §8):
 * los tres tipos de renglón se agrupan POR MODELO y cada modelo se resuelve en UNA transacción —
 * el arte incluido, con su renglón de mapeo dentro de la misma transacción. Los mapeos se cargan
 * de un golpe con `cargarMapaNumerico` (cero `leerMapeo` por fila). Si un lote de arte truena por
 * data sucia, se reintenta renglón por renglón: la tolerancia del ETL no se paga con rendimiento
 * en el caso normal.
 *
 * ⚠️ **El ARTE ya NO sale de un catálogo** (V1-E3d, §Post-F9.35). `Bordados.csv` se lee aquí
 * como FUENTE de los datos del arte (nombre/tipo/puntadas/precio) y cada renglón de
 * `ModelosBor.csv` crea el arte DENTRO de su modelo — o sea, un arte usado por 3 modelos produce
 * 3 artes, uno por modelo (es la duplicación que decidió Daniel). Los artes que NINGÚN modelo usa
 * NO se migran y se REPORTAN (la depuración que Daniel pedía, gratis).
 *
 * Banderas del viejo → campos del BOM v2:
 *  • `bPreCosto`  → `paraPreCosto`
 *  • `bProduccion` → `paraProduccion`
 *  • `bCosto`     → `paraCosto`
 *
 * Renglones con modelo/tela/avío sin mapeo, y artes sin datos en `Bordados.csv`, van al REPORTE
 * (§7: no null silencioso).
 *
 * `ModelosTela.csv` usa `IdTelasDis` (no `IdTelas`): se resuelve con `ENTIDAD_MAPEO.telaPorIdTelasDis`.
 * `ModelosHab.csv` usa `IdHabilitacion`: se resuelve con `ENTIDAD_MAPEO.avio`.
 * `ModelosBor.csv` no tiene precio: se toma el `Precio` de `Bordados.csv` (era el precio de
 * referencia del catálogo, la misma cascada que aplicaba el costeo). Si tampoco lo trae, queda
 * `null` en BD (nullable para el ETL, ADR-0009).
 */
import { reemplazarAviosBom, reemplazarTelasBom } from '../../src/dominio/modelos/bom-modelo.js';
import { crearArte } from '../../src/dominio/modelos/arte-modelo.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';
import { enTransaccion, type ContextoBd, type Tx } from '../../src/comun/transaccion.js';
import type { PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import { mapearTipoArte } from '../comun/mapeos-enum.js';
import {
  ENTIDAD_MAPEO,
  cargarMapaNumerico,
  guardarMapeo,
  type ClienteMapeo,
} from '../comun/mapeo.js';
import type { Reporte } from '../comun/reporte.js';
import { intentarCrear, LIMITES, truncarYReportar } from '../comun/saneo.js';
import { parsearBandera, parsearDinero, parsearEntero, parsearTexto } from '../comun/valores.js';
import type { ResultadoLoader } from './clientes.js';

// ── Transformación de banderas (lógica pura — cubierta por unit tests) ──────────

/**
 * Transforma un renglón de `ModelosTela.csv` a los campos de `ModeloTela` del dominio.
 * Banderas: `bPreCosto`→`paraPreCosto`, `bProduccion`→`paraProduccion`, `bCosto`→`paraCosto`.
 *
 * Exportada para unit tests (transformación pura sin BD).
 */
export function transformarRenglonTela(fila: Record<string, string>): {
  paraPreCosto: boolean;
  paraProduccion: boolean;
  paraCosto: boolean;
  consumoPorPrenda: number;
} {
  return {
    consumoPorPrenda: parsearDinero(fila.CantTela) ?? 0,
    paraPreCosto: parsearBandera(fila.bPreCosto),
    paraProduccion: parsearBandera(fila.bProduccion),
    paraCosto: parsearBandera(fila.bCosto),
  };
}

/**
 * Transforma un renglón de `ModelosHab.csv` a los campos de `ModeloAvio` del dominio.
 * Banderas: `bPreCosto`→`paraPreCosto`, `bProduccion`→`paraProduccion`, `bCosto`→`paraCosto`.
 *
 * Exportada para unit tests.
 */
export function transformarRenglonAvio(fila: Record<string, string>): {
  paraPreCosto: boolean;
  paraProduccion: boolean;
  paraCosto: boolean;
  consumoPorPrenda: number;
} {
  return {
    consumoPorPrenda: parsearDinero(fila.CantHab) ?? 0,
    paraPreCosto: parsearBandera(fila.bPreCosto),
    paraProduccion: parsearBandera(fila.bProduccion),
    paraCosto: parsearBandera(fila.bCosto),
  };
}

// ── Loader principal de BOM ──────────────────────────────────────────────────────

/** Resultado extendido con los tres tipos de renglón del BOM. */
export interface ResultadoBom {
  telas: ResultadoLoader;
  avios: ResultadoLoader;
  artes: ResultadoLoader;
  /** Renglones omitidos por modelo/componente sin mapeo. */
  sinMapeo: number;
}

export async function cargarBom(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
): Promise<ResultadoBom> {
  const bd: ContextoBd = { cliente: cliente as PrismaClient };

  // Cargar mapas en paralelo (evita N+1 de leerMapeo por cada fila).
  const [mapaModelo, mapaTelasDis, mapaAvio] = await Promise.all([
    cargarMapaNumerico(cliente, ENTIDAD_MAPEO.modelo),
    cargarMapaNumerico(cliente, ENTIDAD_MAPEO.telaPorIdTelasDis),
    cargarMapaNumerico(cliente, ENTIDAD_MAPEO.avio),
  ]);

  const telasBom = await cargarTelasBom(sesion, bd, reporte, mapaModelo, mapaTelasDis);
  const aviosBom = await cargarAviosBom(sesion, bd, reporte, mapaModelo, mapaAvio);
  const artes = await cargarArtesModelos(sesion, bd, cliente, reporte, mapaModelo);

  return {
    telas: telasBom,
    avios: aviosBom,
    artes,
    sinMapeo: telasBom.omitidos + aviosBom.omitidos + artes.omitidos,
  };
}

// ── Telas del BOM ────────────────────────────────────────────────────────────────

async function cargarTelasBom(
  sesion: SesionUsuario,
  bd: ContextoBd,
  reporte: Reporte,
  mapaModelo: Map<string, number>,
  mapaTelasDis: Map<string, number>,
): Promise<ResultadoLoader> {
  const filas = leerCsv('ModelosTela.csv');

  // Agrupar por IdModelos (el dominio trabaja con set-completo por modelo).
  const porModelo = new Map<
    number,
    Array<{
      idTela: number;
      consumoPorPrenda: number;
      paraPreCosto: boolean;
      paraProduccion: boolean;
      paraCosto: boolean;
    }>
  >();

  let sinMapeoModelo = 0;
  let sinMapeoTela = 0;

  for (const fila of filas) {
    const idModeloViejo = fila.IdModelos?.trim() ?? '';
    const idModeloNuevo = mapaModelo.get(idModeloViejo);
    if (idModeloNuevo === undefined) {
      sinMapeoModelo += 1;
      reporte.agregar(
        'BOM telas: modelo sin mapeo (renglón omitido)',
        `IdModelos=${idModeloViejo} (IdModelosTela=${fila.IdModelosTela ?? '?'})`,
      );
      continue;
    }

    const idTelaVieja = fila.IdTelasDis?.trim() ?? '';
    const idTelaNueva = mapaTelasDis.get(idTelaVieja);
    if (idTelaNueva === undefined) {
      sinMapeoTela += 1;
      reporte.agregar(
        'BOM telas: tela sin mapeo (renglón omitido)',
        `IdTelasDis=${idTelaVieja} (IdModelos=${idModeloViejo}, IdModelosTela=${fila.IdModelosTela ?? '?'})`,
      );
      continue;
    }

    const renglonExistente = porModelo.get(idModeloNuevo);
    const { consumoPorPrenda, paraPreCosto, paraProduccion, paraCosto } =
      transformarRenglonTela(fila);
    const renglonNuevo = {
      idTela: idTelaNueva,
      consumoPorPrenda,
      paraPreCosto,
      paraProduccion,
      paraCosto,
    };
    if (renglonExistente === undefined) {
      porModelo.set(idModeloNuevo, [renglonNuevo]);
    } else {
      // Si el mismo idTela ya está en el set, ignorar el duplicado (la PK es (idModelo, idTela)).
      if (!renglonExistente.some((r) => r.idTela === idTelaNueva)) {
        renglonExistente.push(renglonNuevo);
      }
    }
  }

  // Conteo HONESTO (§7): leer de un golpe los renglones que YA existen en BD para los modelos
  // a tocar, así una 2ª corrida idempotente reporta `creados=0` / `existentes=N` (no infla).
  const idsModelos = [...porModelo.keys()];
  const existentesBd = await (bd.cliente as PrismaClient).modeloTela.findMany({
    where: { idModelo: { in: idsModelos } },
    select: { idModelo: true, idTela: true },
  });
  const yaPresentes = new Set(existentesBd.map((r) => `${String(r.idModelo)}:${String(r.idTela)}`));

  // Aplicar el set-completo por modelo.
  let creados = 0;
  let existentes = 0;
  const omitidos = sinMapeoModelo + sinMapeoTela;
  let omitidosValidacion = 0;

  for (const [idModelo, telas] of porModelo.entries()) {
    const resultado = await intentarCrear(reporte, 'BOM-Tela', idModelo, () =>
      reemplazarTelasBom(sesion, idModelo, telas, bd),
    );
    if (resultado === null) {
      omitidosValidacion += telas.length;
      continue;
    }
    // Cuenta cada renglón como nuevo (no estaba en BD antes) o ya existente (estaba).
    for (const t of telas) {
      if (yaPresentes.has(`${String(idModelo)}:${String(t.idTela)}`)) existentes += 1;
      else creados += 1;
    }
  }

  return { creados, existentes, omitidos, omitidosValidacion };
}

// ── Avíos del BOM ────────────────────────────────────────────────────────────────

async function cargarAviosBom(
  sesion: SesionUsuario,
  bd: ContextoBd,
  reporte: Reporte,
  mapaModelo: Map<string, number>,
  mapaAvio: Map<string, number>,
): Promise<ResultadoLoader> {
  const filas = leerCsv('ModelosHab.csv');

  const porModelo = new Map<
    number,
    Array<{
      idAvio: number;
      consumoPorPrenda: number;
      paraPreCosto: boolean;
      paraProduccion: boolean;
      paraCosto: boolean;
    }>
  >();

  let sinMapeoModelo = 0;
  let sinMapeoAvio = 0;

  for (const fila of filas) {
    const idModeloViejo = fila.IdModelos?.trim() ?? '';
    const idModeloNuevo = mapaModelo.get(idModeloViejo);
    if (idModeloNuevo === undefined) {
      sinMapeoModelo += 1;
      reporte.agregar(
        'BOM avíos: modelo sin mapeo (renglón omitido)',
        `IdModelos=${idModeloViejo} (IdModelosHab=${fila.IdModelosHab ?? '?'})`,
      );
      continue;
    }

    const idAvioViejo = fila.IdHabilitacion?.trim() ?? '';
    const idAvioNuevo = mapaAvio.get(idAvioViejo);
    if (idAvioNuevo === undefined) {
      sinMapeoAvio += 1;
      reporte.agregar(
        'BOM avíos: avío sin mapeo (renglón omitido)',
        `IdHabilitacion=${idAvioViejo} (IdModelos=${idModeloViejo}, IdModelosHab=${fila.IdModelosHab ?? '?'})`,
      );
      continue;
    }

    const renglonExistente = porModelo.get(idModeloNuevo);
    const { consumoPorPrenda, paraPreCosto, paraProduccion, paraCosto } =
      transformarRenglonAvio(fila);
    const renglonNuevo = {
      idAvio: idAvioNuevo,
      consumoPorPrenda,
      paraPreCosto,
      paraProduccion,
      paraCosto,
    };
    if (renglonExistente === undefined) {
      porModelo.set(idModeloNuevo, [renglonNuevo]);
    } else {
      if (!renglonExistente.some((r) => r.idAvio === idAvioNuevo)) {
        renglonExistente.push(renglonNuevo);
      }
    }
  }

  // Conteo HONESTO (§7): renglones que YA existen en BD (re-corrida idempotente → existentes).
  const idsModelos = [...porModelo.keys()];
  const existentesBd = await (bd.cliente as PrismaClient).modeloAvio.findMany({
    where: { idModelo: { in: idsModelos } },
    select: { idModelo: true, idAvio: true },
  });
  const yaPresentes = new Set(existentesBd.map((r) => `${String(r.idModelo)}:${String(r.idAvio)}`));

  let creados = 0;
  let existentes = 0;
  const omitidos = sinMapeoModelo + sinMapeoAvio;
  let omitidosValidacion = 0;

  for (const [idModelo, avios] of porModelo.entries()) {
    const resultado = await intentarCrear(reporte, 'BOM-Avio', idModelo, () =>
      reemplazarAviosBom(sesion, idModelo, avios, bd),
    );
    if (resultado === null) {
      omitidosValidacion += avios.length;
      continue;
    }
    for (const a of avios) {
      if (yaPresentes.has(`${String(idModelo)}:${String(a.idAvio)}`)) existentes += 1;
      else creados += 1;
    }
  }

  return { creados, existentes, omitidos, omitidosValidacion };
}

// ── ARTE de los modelos (V1-E3d: ya NO hay catálogo) ─────────────────────────────

/** Datos del arte tal como venían en el catálogo viejo (`Bordados.csv`). */
interface ArteViejo {
  nombre: string;
  tipo: ReturnType<typeof mapearTipoArte>;
  descripcion: string | undefined;
  puntadas: number | undefined;
  precio: number | undefined;
}

/** Un arte pendiente de crear en un modelo, ya resuelto contra el catálogo viejo. */
interface ArtePorCrear {
  /** Clave COMPUESTA del mapeo: `<IdBordados>:<IdModelos>` (un arte viejo → N artes nuevos). */
  clave: string;
  idModeloViejo: string;
  datos: ArteViejo;
}

/**
 * Lee `Bordados.csv` a un mapa `IdBordados → datos del arte`. Es la FUENTE de los datos; ya no
 * crea ningún catálogo (V1-E3d). Los que ningún modelo use se quedarán sin migrar y se reportan.
 */
function leerCatalogoArteViejo(reporte: Reporte): Map<string, ArteViejo> {
  const mapa = new Map<string, ArteViejo>();
  for (const fila of leerCsv('Bordados.csv')) {
    const idViejo = fila.IdBordados?.trim() ?? '';
    const nombreCrudo = parsearTexto(fila.Nombre);
    if (idViejo === '' || nombreCrudo === null) {
      reporte.agregar('Arte con id o nombre vacío en Bordados.csv (omitido)', `Id=${idViejo}`);
      continue;
    }
    const nombre =
      truncarYReportar(reporte, 'Arte', idViejo, 'nombre', nombreCrudo, LIMITES.arte.nombre) ??
      nombreCrudo;
    const descripcion =
      truncarYReportar(
        reporte,
        'Arte',
        idViejo,
        'descripcion',
        parsearTexto(fila.Descripcion),
        LIMITES.arte.descripcion,
      ) ?? undefined;
    const puntadasRaw = parsearEntero(fila.Puntadas);
    const precioRaw = parsearDinero(fila.Precio);
    mapa.set(idViejo, {
      nombre,
      tipo: mapearTipoArte(fila.BorEst),
      descripcion,
      puntadas: puntadasRaw === null ? undefined : Math.max(0, puntadasRaw),
      precio: precioRaw === null ? undefined : Math.max(0, precioRaw),
    });
  }
  return mapa;
}

/**
 * Crea el ARTE dentro de cada modelo a partir de `ModelosBor.csv` + `Bordados.csv`.
 *
 * Un arte usado por N modelos produce N artes (uno por modelo): es la DUPLICACIÓN que decidió
 * Daniel (§Post-F9.35). Los artes del catálogo viejo que ningún modelo usa NO se migran y se
 * REPORTAN (nunca se tiran en silencio). Idempotente: el mapeo `<IdBordados>:<IdModelos>` evita
 * volver a crear lo ya migrado (y el nombre repetido dentro del modelo también lo impediría).
 */
async function cargarArtesModelos(
  sesion: SesionUsuario,
  bd: ContextoBd,
  cliente: ClienteMapeo,
  reporte: Reporte,
  mapaModelo: Map<string, number>,
): Promise<ResultadoLoader> {
  const catalogoViejo = leerCatalogoArteViejo(reporte);
  const filas = leerCsv('ModelosBor.csv');

  // Igual que telas y avíos: el mapeo se carga DE UN GOLPE (no un `leerMapeo` por fila — ese era
  // justo el N+1 que este loader dice evitar) y los artes se AGRUPAN POR MODELO para escribirlos
  // por lotes, en una transacción por modelo (regla de Gabriel: los ETL escriben por lotes, NUNCA
  // registro por registro). ~2,378 renglones pasaban de ~2,378 transacciones a una por modelo.
  const mapaArte = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.modeloArte);

  const porModelo = new Map<number, ArtePorCrear[]>();

  let creados = 0;
  let existentes = 0;
  let omitidos = 0;
  let omitidosValidacion = 0;
  const usados = new Set<string>();
  const vistos = new Set<string>();

  for (const fila of filas) {
    const idModeloViejo = fila.IdModelos?.trim() ?? '';
    const idArteViejo = fila.IdBordados?.trim() ?? '';

    // IdModelos=0 en el CSV es un renglón "sin modelo" (dato inválido del viejo): omitir.
    if (idModeloViejo === '0' || idModeloViejo === '') {
      reporte.agregar(
        'Arte: IdModelos=0 (renglón sin modelo, omitido)',
        `IdModelosBor=${fila.IdModelosBor ?? '?'}, IdBordados=${idArteViejo || '?'}`,
      );
      omitidos += 1;
      continue;
    }
    const idModelo = mapaModelo.get(idModeloViejo);
    if (idModelo === undefined) {
      omitidos += 1;
      reporte.agregar(
        'Arte: modelo sin mapeo (renglón omitido)',
        `IdModelos=${idModeloViejo} (IdModelosBor=${fila.IdModelosBor ?? '?'})`,
      );
      continue;
    }
    const datos = catalogoViejo.get(idArteViejo);
    if (datos === undefined) {
      omitidos += 1;
      reporte.agregar(
        'Arte: sin datos en Bordados.csv (renglón omitido)',
        `IdBordados=${idArteViejo || '?'} (IdModelos=${idModeloViejo})`,
      );
      continue;
    }
    usados.add(idArteViejo);

    // Un mismo arte repetido para el mismo modelo en el CSV: una sola vez (el unique lo impediría).
    const clave = `${idArteViejo}:${idModeloViejo}`;
    if (vistos.has(clave)) {
      continue;
    }
    vistos.add(clave);

    // Idempotencia: si ya migramos ESTE par, no se vuelve a crear.
    if (mapaArte.has(clave)) {
      existentes += 1;
      continue;
    }

    const pendientes = porModelo.get(idModelo);
    if (pendientes === undefined) {
      porModelo.set(idModelo, [{ clave, idModeloViejo, datos }]);
    } else {
      pendientes.push({ clave, idModeloViejo, datos });
    }
  }

  for (const [idModelo, artes] of porModelo.entries()) {
    const resultado = await crearArtesDeUnModelo(sesion, bd, reporte, idModelo, artes);
    creados += resultado.creados;
    omitidosValidacion += resultado.omitidosValidacion;
  }

  // La DEPURACIÓN que pedía Daniel: el arte que ningún modelo usa no se migra… pero se REPORTA.
  const sinUso = [...catalogoViejo.entries()].filter(([id]) => !usados.has(id));
  reporte.nota(
    `Arte del catálogo viejo NO migrado por no usarlo ningún modelo: ${String(sinUso.length)} ` +
      `de ${String(catalogoViejo.size)} (depuración §Post-F9.35).`,
  );
  for (const [id, datos] of sinUso) {
    reporte.agregar(
      'Arte sin uso en ningún modelo (NO migrado)',
      `IdBordados=${id}, nombre="${datos.nombre}", tipo=${datos.tipo}`,
    );
  }

  return { creados, existentes, omitidos, omitidosValidacion };
}

/**
 * Crea, EN UN LOTE, todo el arte pendiente de UN modelo: una sola transacción para los k artes
 * (el dominio se une a ella por `bd.tx`, A2) con su renglón de mapeo dentro de la MISMA
 * transacción — si algo revienta, no queda ni arte sin mapeo ni mapeo sin arte.
 *
 * Si el lote falla (una fila sucia envenena la transacción de Postgres y se lleva a las buenas),
 * se REINTENTA renglón por renglón, cada uno en su transacción: así se conserva la tolerancia del
 * ETL (§7: una fila mala nunca aborta la carga) sin pagar una transacción por fila en el caso
 * normal, que es el de siempre.
 */
async function crearArtesDeUnModelo(
  sesion: SesionUsuario,
  bd: ContextoBd,
  reporte: Reporte,
  idModelo: number,
  artes: ArtePorCrear[],
): Promise<{ creados: number; omitidosValidacion: number }> {
  try {
    await enTransaccion(async (tx) => {
      for (const arte of artes) {
        await crearArteYMapear(sesion, tx, idModelo, arte);
      }
    }, bd);
    return { creados: artes.length, omitidosValidacion: 0 };
  } catch (error) {
    reporte.agregar(
      'Arte: lote del modelo REINTENTADO renglón por renglón (data sucia en el lote)',
      `idModelo=${String(idModelo)} · artes=${String(artes.length)} · ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  let creados = 0;
  let omitidosValidacion = 0;
  for (const arte of artes) {
    const hecho = await intentarCrear(reporte, 'ModeloArte', arte.clave, () =>
      enTransaccion((tx) => crearArteYMapear(sesion, tx, idModelo, arte), bd),
    );
    if (hecho === null) {
      omitidosValidacion += 1;
    } else {
      creados += 1;
    }
  }
  return { creados, omitidosValidacion };
}

/** Crea UN arte dentro del modelo y guarda su mapeo, los DOS en la transacción que recibe. */
async function crearArteYMapear(
  sesion: SesionUsuario,
  tx: Tx,
  idModelo: number,
  arte: ArtePorCrear,
): Promise<void> {
  const creado = await crearArte(
    sesion,
    idModelo,
    {
      nombre: arte.datos.nombre,
      tipo: arte.datos.tipo,
      ...(arte.datos.descripcion === undefined ? {} : { descripcion: arte.datos.descripcion }),
      ...(arte.datos.puntadas === undefined ? {} : { puntadas: arte.datos.puntadas }),
      ...(arte.datos.precio === undefined ? {} : { precio: arte.datos.precio }),
    },
    { tx },
  );
  await guardarMapeo(tx, ENTIDAD_MAPEO.modeloArte, arte.clave, creado.id, {
    nombre: creado.nombre,
    idModeloViejo: arte.idModeloViejo,
  });
}
