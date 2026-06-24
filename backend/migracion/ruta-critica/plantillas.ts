/**
 * Loader de PLANTILLAS DE RUTA (F5-E7, Pieza B). `CP_Tiempos.csv` (156 = 26 procesos × 6 artículos) →
 * `PlantillaRuta` + `PlantillaRutaProceso` + `PlantillaRutaDep`, una plantilla por ARTÍCULO.
 *
 * F5-E2 ya sembró DOS plantillas (artículos 1/6 y 6/6) con datos bakeados; este ETL formal carga las
 * SEIS desde el CSV real, IDEMPOTENTE por NOMBRE de plantilla (si ya existe NO se re-crea: el usuario
 * o el seed pudieron tocarla — mismo criterio que el seed). Carga VÍA el dominio (`crearPlantilla`,
 * A1), que valida procesos/antecesores y RECHAZA CICLOS.
 *
 * El encadenamiento PROPIO por artículo manda (la ficha): `CP_Tiempos.Antecesor` referencia el
 * `NumProcesoRC`/`NumProceso` del proceso antecesor DENTRO del mismo artículo. Se traduce a
 * `idProcesoDef` del catálogo de v2 (vía el puente IdCP_Procesos → ProcesoDef). `Antecesor=0` (o
 * vacío) = proceso raíz (sin antecesor).
 */
import { crearPlantilla, listarPlantillas } from '../../src/dominio/ruta-critica/plantillasRuta.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';
import type { ContextoBd } from '../../src/comun/transaccion.js';
import type { PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import { parsearEntero, parsearTexto } from '../comun/valores.js';
import { intentarCrear } from '../comun/saneo.js';
import type { Reporte } from '../comun/reporte.js';

import { construirPuenteProcesos, type ProcesoV2 } from './comun.js';

/** Resultado del loader de plantillas. */
export interface ResultadoPlantillas {
  creadas: number;
  existentes: number;
  omitidas: number;
  renglones: number;
}

/** Un renglón crudo de `CP_Tiempos` para un artículo: proceso, tiempo y el NumProceso de su antecesor. */
interface RenglonTiempo {
  idCpProcesos: string;
  numProceso: number;
  tiempo: number;
  numAntecesor: number | null;
}

/**
 * Carga las plantillas de ruta (una por artículo de `CP_Articulos`). Idempotente por nombre de
 * plantilla. Devuelve conteos para el cuadre.
 */
export async function cargarPlantillas(
  sesion: SesionUsuario,
  cliente: PrismaClient,
  reporte: Reporte,
  idArticuloPorIdViejo: Map<string, number>,
): Promise<ResultadoPlantillas> {
  const bd: ContextoBd = { cliente };
  const resultado: ResultadoPlantillas = { creadas: 0, existentes: 0, omitidas: 0, renglones: 0 };

  const { porIdViejo: procesoPorIdViejo } = await construirPuenteProcesos(cliente);

  // Nombre de artículo (CP_Articulos.Descripcion) por IdCP_Articulos, para nombrar la plantilla.
  const nombreArticuloPorIdViejo = new Map<string, string>();
  for (const f of leerCsv('CP_Articulos.csv')) {
    const idViejo = (f.IdCP_Articulos ?? '').trim();
    const nombre = parsearTexto(f.Descripcion);
    if (idViejo !== '' && nombre !== null) nombreArticuloPorIdViejo.set(idViejo, nombre);
  }

  // Plantillas existentes por nombre (idempotencia).
  const existentes = await listarPlantillas(sesion, true, bd);
  const nombresExistentes = new Set(existentes.map((p) => p.nombre.trim()));

  // Agrupa CP_Tiempos por IdCP_Articulos.
  const porArticulo = new Map<string, RenglonTiempo[]>();
  for (const f of leerCsv('CP_Tiempos.csv')) {
    const idArt = (f.IdCP_Articulos ?? '').trim();
    const idProc = (f.IdCP_Procesos ?? '').trim();
    const numProceso = parsearEntero(f.IdCP_Procesos); // IdCP_Procesos == NumProceso (1..26)
    const tiempo = parsearEntero(f.Tiempo) ?? 0;
    const numAntecesor = parsearEntero(f.Antecesor);
    if (idArt === '' || idProc === '' || numProceso === null) continue;
    const lista = porArticulo.get(idArt) ?? [];
    lista.push({ idCpProcesos: idProc, numProceso, tiempo, numAntecesor });
    porArticulo.set(idArt, lista);
  }

  for (const [idArtViejo, renglones] of porArticulo) {
    const idArticulo = idArticuloPorIdViejo.get(idArtViejo);
    const nombreArticulo = nombreArticuloPorIdViejo.get(idArtViejo) ?? `Artículo ${idArtViejo}`;
    const nombrePlantilla = `Ruta ${nombreArticulo}`;

    if (idArticulo === undefined) {
      reporte.agregar(
        'Plantilla con artículo sin mapeo (OMITIDA)',
        `IdCP_Articulos=${idArtViejo} (${nombreArticulo})`,
      );
      resultado.omitidas += 1;
      continue;
    }
    if (nombresExistentes.has(nombrePlantilla.trim())) {
      resultado.existentes += 1;
      continue;
    }
    // Si una plantilla del seed ya cubre ESTE artículo (nombre distinto), no duplicar por artículo.
    if (existentes.some((p) => p.idArticuloRC === idArticulo)) {
      reporte.nota(
        `Plantilla de ${nombreArticulo} ya existe (seed/otra) por idArticulo=${String(idArticulo)}; ` +
          'no se duplica.',
      );
      resultado.existentes += 1;
      continue;
    }

    // Traduce NumProceso → idProcesoDef (para los antecesores del encadenamiento propio).
    const procesoPorNum = new Map<number, ProcesoV2>();
    for (const r of renglones) {
      const v2 = procesoPorIdViejo.get(r.idCpProcesos);
      if (v2 !== undefined) procesoPorNum.set(r.numProceso, v2);
    }

    const procesos: {
      idProcesoDef: number;
      tiempoEstandar: number;
      idsAntecesores: number[];
    }[] = [];
    let renglonesOmitidos = 0;
    for (const r of renglones) {
      const v2 = procesoPorIdViejo.get(r.idCpProcesos);
      if (v2 === undefined) {
        renglonesOmitidos += 1;
        continue;
      }
      const idsAntecesores: number[] = [];
      if (r.numAntecesor !== null && r.numAntecesor !== 0) {
        const ant = procesoPorNum.get(r.numAntecesor);
        if (ant !== undefined) idsAntecesores.push(ant.id);
      }
      procesos.push({ idProcesoDef: v2.id, tiempoEstandar: r.tiempo, idsAntecesores });
    }
    if (renglonesOmitidos > 0) {
      reporte.agregar(
        'Plantilla con renglón(es) de proceso sin mapeo (renglón omitido)',
        `IdCP_Articulos=${idArtViejo} omitidos=${String(renglonesOmitidos)}`,
      );
    }
    if (procesos.length === 0) {
      resultado.omitidas += 1;
      continue;
    }

    const creada = await intentarCrear(reporte, 'PlantillaRuta', idArtViejo, () =>
      crearPlantilla(sesion, { nombre: nombrePlantilla, idArticuloRC: idArticulo, procesos }, bd),
    );
    if (creada === null) {
      resultado.omitidas += 1;
      continue;
    }
    nombresExistentes.add(nombrePlantilla.trim());
    existentes.push(creada);
    resultado.creadas += 1;
    resultado.renglones += procesos.length;
  }

  return resultado;
}
