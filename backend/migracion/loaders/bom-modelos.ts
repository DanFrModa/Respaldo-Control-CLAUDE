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
 * ⚠️ **LO QUE SE CAPTURÓ EN v2, EL ETL NO LO BORRA — NUNCA** (DANIEL, 15-ago-2026, D2 de V1-E3e:
 * *"la migración actualiza lo que viene del Access, pero nunca borra lo que se capturó en el sistema
 * nuevo"*). El endpoint del BOM es SET-COMPLETO: lo que no va en el payload, el dominio lo borra. Y
 * los ETL son **re-corribles por diseño** (F10 los vuelve a pasar, y el ensayo varias veces). Sin
 * protección, cada corrida arrasaría trabajo humano en silencio. Este loader lo evita en DOS
 * dimensiones, y las dos hacen falta:
 *
 *  1. **El AMARRE de precio** (`ModeloTela.idTelaProveedor` / `ModeloAvio.idAvioProveedor`, R17): lo
 *     captura Desarrollo en v2 y Access no lo trae, así que se RE-ENVÍA el que ya está en BD (si no,
 *     todos volverían a NULL, apagando la cascada de precios del precosto y del MRP).
 *  2. **Los RENGLONES ENTEROS capturados en v2** (una tela o un avío que el modelo lleva y que el
 *     Access nunca tuvo): se re-envían **tal cual están en BD** —consumo, banderas y amarre—, así
 *     que el set-completo no los ve como sobrantes. Sin esto, re-correr el ETL borraba el renglón y,
 *     **por cascada, sus `ModeloAvioTalla`** (el consumo por talla capturado a mano, R18).
 *
 * **El CSV manda en lo que trae; la BD manda en lo que el CSV no trae.** Consecuencia asumida y
 * explícita: un renglón que se BORRE en Access después de una corrida ya no se borra en v2 (queda
 * como si fuera captura nueva). Es exactamente el intercambio que pidió Daniel — perder una baja
 * rara del sistema viejo es reparable a mano; perder captura del sistema nuevo, no.
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
  //
  // 🔑 De la MISMA lectura sale el AMARRE de precio (`idTelaProveedor`, R17). Access NO lo trae
  // —lo captura Desarrollo en v2—, y el endpoint del BOM es SET-COMPLETO: lo que no viene en el
  // payload se borra. Sin re-enviarlo, re-correr este ETL (son idempotentes y re-corribles POR
  // DISEÑO, y F10 los vuelve a pasar) dejaría en NULL todos los amarres capturados, apagando en
  // silencio la cascada de precios del precosto y del MRP. El CSV manda en consumo y banderas; el
  // amarre lo manda la BD.
  const idsModelos = [...porModelo.keys()];
  const existentesBd = await (bd.cliente as PrismaClient).modeloTela.findMany({
    where: { idModelo: { in: idsModelos } },
    select: {
      idModelo: true,
      idTela: true,
      idTelaProveedor: true,
      // D2 (Daniel, 15-ago-2026): con esto se pueden RE-ENVIAR tal cual los renglones que el CSV
      // no trae — los capturados en v2 —, para que el set-completo no los borre.
      consumoPorPrenda: true,
      paraPreCosto: true,
      paraProduccion: true,
      paraCosto: true,
    },
  });
  const yaPresentes = new Set(existentesBd.map((r) => `${String(r.idModelo)}:${String(r.idTela)}`));
  const amarrePorRenglon = new Map(
    existentesBd
      .filter((r) => r.idTelaProveedor !== null)
      .map((r) => [`${String(r.idModelo)}:${String(r.idTela)}`, r.idTelaProveedor]),
  );
  // Renglones ya en BD, agrupados por modelo (para detectar los que el CSV no trae).
  const enBdPorModelo = new Map<number, typeof existentesBd>();
  for (const r of existentesBd) {
    const lista = enBdPorModelo.get(r.idModelo);
    if (lista === undefined) enBdPorModelo.set(r.idModelo, [r]);
    else lista.push(r);
  }

  // Aplicar el set-completo por modelo.
  let creados = 0;
  let existentes = 0;
  const omitidos = sinMapeoModelo + sinMapeoTela;
  let omitidosValidacion = 0;

  for (const [idModelo, telas] of porModelo.entries()) {
    // Se conserva el amarre YA capturado de cada renglón (ver arriba): sin esto el set-completo
    // lo pondría en NULL.
    const conAmarre = telas.map((t) => {
      const amarre = amarrePorRenglon.get(`${String(idModelo)}:${String(t.idTela)}`);
      return amarre === undefined ? t : { ...t, idTelaProveedor: amarre };
    });
    // ⭐ D2: los renglones que ESTÁN en BD y NO vienen en el CSV se capturaron en v2 → se re-envían
    // TAL CUAL para que el set-completo no los borre. El CSV manda en lo que trae; la BD en el resto.
    const delCsv = new Set(telas.map((t) => t.idTela));
    const capturadosEnV2 = (enBdPorModelo.get(idModelo) ?? [])
      .filter((r) => !delCsv.has(r.idTela))
      .map((r) => ({
        idTela: r.idTela,
        consumoPorPrenda: r.consumoPorPrenda.toNumber(),
        paraPreCosto: r.paraPreCosto,
        paraProduccion: r.paraProduccion,
        paraCosto: r.paraCosto,
        idTelaProveedor: r.idTelaProveedor,
      }));
    const resultado = await intentarCrear(reporte, 'BOM-Tela', idModelo, () =>
      reemplazarTelasBom(sesion, idModelo, [...conAmarre, ...capturadosEnV2], bd),
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
  // Y de la misma lectura, el AMARRE de precio del renglón (`idAvioProveedor`, R17): el CSV de
  // Access no lo trae y el set-completo lo borraría al re-correr el ETL (mismo motivo que en
  // telas — ver el comentario de `cargarTelasBom`).
  const idsModelos = [...porModelo.keys()];
  const existentesBd = await (bd.cliente as PrismaClient).modeloAvio.findMany({
    where: { idModelo: { in: idsModelos } },
    select: {
      idModelo: true,
      idAvio: true,
      idAvioProveedor: true,
      // D2: para poder re-enviar íntegros los renglones capturados en v2 (ver `cargarTelasBom`).
      // ⚠️ `consumoPorTalla` NO viaja en el payload del set-completo y el dominio NO lo pisa al
      // actualizar, así que el toggle R18 sobrevive solo — lo que hay que salvar es EL RENGLÓN:
      // si desaparece del set, se borra y con él, POR CASCADA, sus `ModeloAvioTalla`.
      consumoPorPrenda: true,
      paraPreCosto: true,
      paraProduccion: true,
      paraCosto: true,
    },
  });
  const yaPresentes = new Set(existentesBd.map((r) => `${String(r.idModelo)}:${String(r.idAvio)}`));
  const amarrePorRenglon = new Map(
    existentesBd
      .filter((r) => r.idAvioProveedor !== null)
      .map((r) => [`${String(r.idModelo)}:${String(r.idAvio)}`, r.idAvioProveedor]),
  );
  const enBdPorModelo = new Map<number, typeof existentesBd>();
  for (const r of existentesBd) {
    const lista = enBdPorModelo.get(r.idModelo);
    if (lista === undefined) enBdPorModelo.set(r.idModelo, [r]);
    else lista.push(r);
  }

  let creados = 0;
  let existentes = 0;
  const omitidos = sinMapeoModelo + sinMapeoAvio;
  let omitidosValidacion = 0;

  for (const [idModelo, avios] of porModelo.entries()) {
    const conAmarre = avios.map((a) => {
      const amarre = amarrePorRenglon.get(`${String(idModelo)}:${String(a.idAvio)}`);
      return amarre === undefined ? a : { ...a, idAvioProveedor: amarre };
    });
    // ⭐ D2: renglones capturados en v2 (no vienen del Access) → se re-envían tal cual. Sin esto,
    // re-correr el ETL los borraba junto con su consumo por talla (R18) sin decir una palabra.
    const delCsv = new Set(avios.map((a) => a.idAvio));
    const capturadosEnV2 = (enBdPorModelo.get(idModelo) ?? [])
      .filter((r) => !delCsv.has(r.idAvio))
      .map((r) => ({
        idAvio: r.idAvio,
        consumoPorPrenda: r.consumoPorPrenda.toNumber(),
        paraPreCosto: r.paraPreCosto,
        paraProduccion: r.paraProduccion,
        paraCosto: r.paraCosto,
        idAvioProveedor: r.idAvioProveedor,
      }));
    const resultado = await intentarCrear(reporte, 'BOM-Avio', idModelo, () =>
      reemplazarAviosBom(sesion, idModelo, [...conAmarre, ...capturadosEnV2], bd),
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

/**
 * Datos del arte tal como venían en el catálogo viejo (`Bordados.csv`).
 *
 * ⚠️ V1-E3f: el arte nuevo ya NO tiene `nombre` (§Post-F9.52 punto 1) y su `descripcion` es
 * OBLIGATORIA. El `nombre` viejo se conserva aquí por dos razones: es lo que se guarda como
 * `descripcion` cuando la vieja venía vacía —la MISMA regla que aplicó la migración SQL, para que
 * ETL y migración dejen exactamente lo mismo— y viaja al `mapeo_migracion` como rastro (D3).
 */
interface ArteViejo {
  nombre: string;
  /** Código del tipo en el catálogo único (`bordado` / `estampado`). */
  codigoTipo: ReturnType<typeof mapearTipoArte>;
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
  /** Id del tipo en el catálogo único, ya resuelto desde `datos.codigoTipo` (V1-E3f). */
  idTipoArte: number;
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
      codigoTipo: mapearTipoArte(fila.BorEst),
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

  // V1-E3f: el tipo del arte es una FK al catálogo único (`TipoProceso` con `esArte`). Se resuelve
  // el id UNA vez por corrida (no por fila) desde el `codigo`, que es la clave estable — la misma
  // traducción que hizo la migración SQL (`bordado`/`estampado`).
  const tiposArte = new Map(
    (
      await cliente.tipoProceso.findMany({
        where: { esArte: true },
        select: { id: true, codigo: true },
      })
    ).map((t) => [t.codigo, t.id] as const),
  );

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

    const idTipoArte = tiposArte.get(datos.codigoTipo);
    if (idTipoArte === undefined) {
      omitidos += 1;
      reporte.agregar(
        'Arte: tipo del catálogo único no encontrado (renglón omitido)',
        `codigo=${datos.codigoTipo} — ¿corriste el seed? (IdBordados=${idArteViejo})`,
      );
      continue;
    }

    const pendientes = porModelo.get(idModelo);
    if (pendientes === undefined) {
      porModelo.set(idModelo, [{ clave, idModeloViejo, datos, idTipoArte }]);
    } else {
      pendientes.push({ clave, idModeloViejo, datos, idTipoArte });
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
      `IdBordados=${id}, nombre="${datos.nombre}", tipo=${datos.codigoTipo}`,
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
      // V1-E3f: la descripción es el campo visible y es OBLIGATORIA; si el catálogo viejo no la
      // traía se usa el NOMBRE viejo — la misma regla que aplicó la migración SQL, para que una
      // base migrada y una cargada por ETL queden idénticas (D3: el dato no se pierde).
      descripcion: arte.datos.descripcion ?? arte.datos.nombre,
      idTipoArte: arte.idTipoArte,
      ...(arte.datos.puntadas === undefined ? {} : { puntadas: arte.datos.puntadas }),
      ...(arte.datos.precio === undefined ? {} : { precio: arte.datos.precio }),
    },
    { tx },
  );
  await guardarMapeo(tx, ENTIDAD_MAPEO.modeloArte, arte.clave, creado.id, {
    // El NOMBRE viejo se conserva en el rastro aunque el arte nuevo ya no lo tenga (D3).
    nombre: arte.datos.nombre,
    descripcion: creado.descripcion,
    idModeloViejo: arte.idModeloViejo,
  });
}
