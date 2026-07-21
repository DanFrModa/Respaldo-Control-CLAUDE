/**
 * Loader del BOM de modelos (F1-E7). Carga los tres tipos de renglón de receta:
 *
 *  • `ModelosTela.csv`  (~791)  → `ModeloTela`  (telas del BOM, consumo + banderas).
 *  • `ModelosHab.csv`   (~7163) → `ModeloAvio`  (avíos/habilitación del BOM, consumo + banderas).
 *  • `ModelosBor.csv`   (~2378) → `ModeloBordado` (bordados del BOM, sin banderas, precio nullable).
 *
 * Regla A1: la carga usa los servicios de dominio `reemplazarTelasBom`, `reemplazarAviosBom`,
 * `reemplazarBordadosBom`. Para la idempotencia del ETL, el loader agrupa los renglones POR
 * MODELO y llama al "set-completo" del dominio: el dominio hace el diff (agrega/quita/actualiza)
 * de forma atómica (A2). Re-ejecutar produce el mismo estado.
 *
 * Banderas del viejo → campos del BOM v2:
 *  • `bPreCosto`  → `paraPreCosto`
 *  • `bProduccion` → `paraProduccion`
 *  • `bCosto`     → `paraCosto`
 *
 * Renglones con modelo/tela/avío/bordado sin mapeo van al REPORTE (§7: no null silencioso).
 *
 * `ModelosTela.csv` usa `IdTelasDis` (no `IdTelas`): se resuelve con `ENTIDAD_MAPEO.telaPorIdTelasDis`.
 * `ModelosHab.csv` usa `IdHabilitacion`: se resuelve con `ENTIDAD_MAPEO.avio`.
 * `ModelosBor.csv` no tiene precio: el precio queda `null` en BD (nullable para el ETL, ADR-0009).
 */
import {
  reemplazarAviosBom,
  reemplazarBordadosBom,
  reemplazarTelasBom,
} from '../../src/dominio/modelos/bom-modelo.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';
import type { ContextoBd } from '../../src/comun/transaccion.js';
import type { PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import { ENTIDAD_MAPEO, cargarMapaNumerico, type ClienteMapeo } from '../comun/mapeo.js';
import { prescanUso, type PrescanUso } from '../comun/prescan-uso.js';
import type { Reporte } from '../comun/reporte.js';
import { intentarCrear } from '../comun/saneo.js';
import { parsearBandera, parsearDinero } from '../comun/valores.js';
import { resolverVentana } from '../comun/ventana.js';
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
  bordados: ResultadoLoader;
  /** Renglones omitidos por modelo/componente sin mapeo. */
  sinMapeo: number;
}

export async function cargarBom(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
  prescan?: PrescanUso | null,
): Promise<ResultadoBom> {
  const bd: ContextoBd = { cliente: cliente as PrismaClient };
  // Prescan de USO: con ventana activa los renglones de BOM de modelos NO migrados van al
  // bucket `fueraVentana` (cascada modelo → BOM), no al ruido de "modelo sin mapeo".
  const pre = prescan === undefined ? prescanUso(resolverVentana()) : prescan;

  // Cargar mapas en paralelo (evita N+1 de leerMapeo por cada fila).
  const [mapaModelo, mapaTelasDis, mapaAvio, mapaBordado] = await Promise.all([
    cargarMapaNumerico(cliente, ENTIDAD_MAPEO.modelo),
    cargarMapaNumerico(cliente, ENTIDAD_MAPEO.telaPorIdTelasDis),
    cargarMapaNumerico(cliente, ENTIDAD_MAPEO.avio),
    cargarMapaNumerico(cliente, ENTIDAD_MAPEO.bordado),
  ]);

  const telasBom = await cargarTelasBom(sesion, bd, reporte, mapaModelo, mapaTelasDis, pre);
  const aviosBom = await cargarAviosBom(sesion, bd, reporte, mapaModelo, mapaAvio, pre);
  const bordadosBom = await cargarBordadosBom(sesion, bd, reporte, mapaModelo, mapaBordado, pre);

  const fueraVentana =
    (telasBom.fueraVentana ?? 0) + (aviosBom.fueraVentana ?? 0) + (bordadosBom.fueraVentana ?? 0);
  if (fueraVentana > 0) {
    reporte.nota(
      `BOM fuera de ventana: ${String(fueraVentana)} renglones de modelos NO migrados ` +
        `(cascada modelo → BOM) — NO migrados.`,
    );
  }

  return {
    telas: telasBom,
    avios: aviosBom,
    bordados: bordadosBom,
    sinMapeo: telasBom.omitidos + aviosBom.omitidos + bordadosBom.omitidos,
  };
}

// ── Telas del BOM ────────────────────────────────────────────────────────────────

async function cargarTelasBom(
  sesion: SesionUsuario,
  bd: ContextoBd,
  reporte: Reporte,
  mapaModelo: Map<string, number>,
  mapaTelasDis: Map<string, number>,
  pre: PrescanUso | null,
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
  let fueraVentana = 0;

  for (const fila of filas) {
    const idModeloViejo = fila.IdModelos?.trim() ?? '';
    // Cascada de la ventana: renglón de un modelo excluido por USO → bucket propio.
    if (pre !== null && !pre.modelosId.has(idModeloViejo)) {
      fueraVentana += 1;
      continue;
    }
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

  return { creados, existentes, omitidos, omitidosValidacion, fueraVentana };
}

// ── Avíos del BOM ────────────────────────────────────────────────────────────────

async function cargarAviosBom(
  sesion: SesionUsuario,
  bd: ContextoBd,
  reporte: Reporte,
  mapaModelo: Map<string, number>,
  mapaAvio: Map<string, number>,
  pre: PrescanUso | null,
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
  let fueraVentana = 0;

  for (const fila of filas) {
    const idModeloViejo = fila.IdModelos?.trim() ?? '';
    // Cascada de la ventana: renglón de un modelo excluido por USO → bucket propio.
    if (pre !== null && !pre.modelosId.has(idModeloViejo)) {
      fueraVentana += 1;
      continue;
    }
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

  return { creados, existentes, omitidos, omitidosValidacion, fueraVentana };
}

// ── Bordados del BOM ─────────────────────────────────────────────────────────────

async function cargarBordadosBom(
  sesion: SesionUsuario,
  bd: ContextoBd,
  reporte: Reporte,
  mapaModelo: Map<string, number>,
  mapaBordado: Map<string, number>,
  pre: PrescanUso | null,
): Promise<ResultadoLoader> {
  const filas = leerCsv('ModelosBor.csv');

  const porModelo = new Map<number, Array<{ idBordado: number; precio?: number }>>();

  let sinMapeoModelo = 0;
  let sinMapeoBordado = 0;
  let fueraVentana = 0;

  for (const fila of filas) {
    const idModeloViejo = fila.IdModelos?.trim() ?? '';

    // IdModelos=0 en el CSV es un renglón "sin modelo" (dato inválido del viejo): omitir.
    if (idModeloViejo === '0' || idModeloViejo === '') {
      reporte.agregar(
        'BOM bordados: IdModelos=0 (renglón sin modelo, omitido)',
        `IdModelosBor=${fila.IdModelosBor ?? '?'}, IdBordados=${fila.IdBordados ?? '?'}`,
      );
      sinMapeoModelo += 1;
      continue;
    }

    // Cascada de la ventana: renglón de un modelo excluido por USO → bucket propio.
    if (pre !== null && !pre.modelosId.has(idModeloViejo)) {
      fueraVentana += 1;
      continue;
    }

    const idModeloNuevo = mapaModelo.get(idModeloViejo);
    if (idModeloNuevo === undefined) {
      sinMapeoModelo += 1;
      reporte.agregar(
        'BOM bordados: modelo sin mapeo (renglón omitido)',
        `IdModelos=${idModeloViejo} (IdModelosBor=${fila.IdModelosBor ?? '?'})`,
      );
      continue;
    }

    const idBordadoViejo = fila.IdBordados?.trim() ?? '';
    const idBordadoNuevo = mapaBordado.get(idBordadoViejo);
    if (idBordadoNuevo === undefined) {
      sinMapeoBordado += 1;
      reporte.agregar(
        'BOM bordados: bordado sin mapeo (renglón omitido)',
        `IdBordados=${idBordadoViejo} (IdModelos=${idModeloViejo}, IdModelosBor=${fila.IdModelosBor ?? '?'})`,
      );
      continue;
    }

    // No hay precio en el CSV viejo: queda null en BD (ADR-0009).
    const renglonExistente = porModelo.get(idModeloNuevo);
    const renglonNuevo = { idBordado: idBordadoNuevo };
    if (renglonExistente === undefined) {
      porModelo.set(idModeloNuevo, [renglonNuevo]);
    } else {
      if (!renglonExistente.some((r) => r.idBordado === idBordadoNuevo)) {
        renglonExistente.push(renglonNuevo);
      }
    }
  }

  // Conteo HONESTO (§7): renglones que YA existen en BD (re-corrida idempotente → existentes).
  const idsModelos = [...porModelo.keys()];
  const existentesBd = await (bd.cliente as PrismaClient).modeloBordado.findMany({
    where: { idModelo: { in: idsModelos } },
    select: { idModelo: true, idBordado: true },
  });
  const yaPresentes = new Set(
    existentesBd.map((r) => `${String(r.idModelo)}:${String(r.idBordado)}`),
  );

  let creados = 0;
  let existentes = 0;
  const omitidos = sinMapeoModelo + sinMapeoBordado;
  let omitidosValidacion = 0;

  for (const [idModelo, bordados] of porModelo.entries()) {
    const resultado = await intentarCrear(reporte, 'BOM-Bordado', idModelo, () =>
      reemplazarBordadosBom(sesion, idModelo, bordados, bd),
    );
    if (resultado === null) {
      omitidosValidacion += bordados.length;
      continue;
    }
    for (const b of bordados) {
      if (yaPresentes.has(`${String(idModelo)}:${String(b.idBordado)}`)) existentes += 1;
      else creados += 1;
    }
  }

  return { creados, existentes, omitidos, omitidosValidacion, fueraVentana };
}
