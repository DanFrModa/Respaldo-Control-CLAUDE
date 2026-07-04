/**
 * Loader de MUESTRARIOS históricos (F7-E6). `IP_MuesPend` (21) → `Muestrario`.
 *
 * Carga VÍA el dominio (A1): `crearMuestrario` (solicitud) y luego, según el estado del viejo,
 * `entregarMuestrario` (si trae `FechaEntregado`) o `cancelarMuestrario` (si `Cancelado`), o
 * `actualizarMuestrario` para reflejar `BoardsOK`/`MuestrasOK` de los que siguen pendientes. Así el
 * KPI de cumplimiento (`fechaEntregado <= fechaRequerida`) queda bien poblado. Idempotente por
 * `MapeoMigracion(IdIP_MuesPend)`. Empresa (A9) = la de la sesión (el viejo no la llevaba → favorita).
 *
 * FRICTIONS de origen (§7: se LISTAN, no se inventan):
 *  • `IP_MuesPend.Cliente` es TEXTO libre (p. ej. "Varios", "Walmart"), NO un id. Se resuelve por
 *    NOMBRE normalizado contra el catálogo de clientes migrado. Sin match (p. ej. "Walmart",
 *    "Soriana" no están con ese nombre exacto) → muestrario OMITIDO y LISTADO (idCliente es
 *    obligatorio; no se crea un cliente nuevo desde este ETL).
 *  • `Temporada` es TEXTO ("Primavera Verano"); se resuelve por nombre contra el catálogo. Sin match
 *    → sin temporada (idTemporada es opcional).
 *  • `IdUsuarioSolicitante` viejo se PRESERVA como `solicitanteId` (sesión con ese id; sin FK,
 *    ADR-0005; F9 remapea). Si es 0/vacío → sesión de sistema.
 */
import {
  actualizarMuestrario,
  cancelarMuestrario,
  crearMuestrario,
  entregarMuestrario,
} from '../../src/dominio/indicadores/muestrarios.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';
import type { ContextoBd } from '../../src/comun/transaccion.js';
import type { PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import { ENTIDAD_MAPEO, guardarMapeo, leerMapeo, type ClienteMapeo } from '../comun/mapeo.js';
import type { Reporte } from '../comun/reporte.js';
import { intentarCrear } from '../comun/saneo.js';
import {
  normalizarParaDedup,
  parsearBandera,
  parsearEntero,
  parsearFecha,
  parsearTexto,
} from '../comun/valores.js';
import type { ResultadoLoader } from './clientes.js';

/** `YYYY-MM-DD` (UTC) de una fecha, o `undefined` si no había. */
function aIso(fecha: Date | null): string | undefined {
  return fecha === null ? undefined : fecha.toISOString().slice(0, 10);
}

/** Carga IP_MuesPend → Muestrario (con su ciclo de vida: solicitud → entrega/cancelación). */
export async function cargarMuestrarios(
  sesionBase: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
): Promise<ResultadoLoader> {
  const cli = cliente as PrismaClient;
  const bd: ContextoBd = { cliente: cli };
  const r: ResultadoLoader = { creados: 0, existentes: 0, omitidos: 0, omitidosValidacion: 0 };

  // Cliente por nombre normalizado; temporada por nombre normalizado (catálogos ya migrados).
  const clientePorNombre = new Map<string, number>();
  for (const c of await cli.cliente.findMany({ select: { id: true, nombre: true } })) {
    clientePorNombre.set(normalizarParaDedup(c.nombre), c.id);
  }
  const temporadaPorNombre = new Map<string, number>();
  for (const t of await cli.temporada.findMany({ select: { id: true, nombre: true } })) {
    temporadaPorNombre.set(normalizarParaDedup(t.nombre), t.id);
  }

  for (const f of leerCsv('IP_MuesPend.csv')) {
    const idViejo = (f.IdIP_MuesPend ?? '').trim();
    if (idViejo === '') {
      r.omitidos += 1;
      continue;
    }
    if ((await leerMapeo(cliente, ENTIDAD_MAPEO.muestrario, idViejo)) !== null) {
      r.existentes += 1;
      continue;
    }

    const nombreCliente = parsearTexto(f.Cliente);
    const idCliente =
      nombreCliente === null ? undefined : clientePorNombre.get(normalizarParaDedup(nombreCliente));
    if (idCliente === undefined) {
      reporte.agregar(
        'IP_MuesPend con cliente (texto) sin match en el catálogo (OMITIDO — idCliente obligatorio)',
        `IdIP_MuesPend=${idViejo} Cliente="${f.Cliente ?? ''}"`,
      );
      r.omitidos += 1;
      continue;
    }
    const fechaRequerida = aIso(parsearFecha(f.FechaRequerida));
    if (fechaRequerida === undefined) {
      reporte.agregar(
        'IP_MuesPend sin FechaRequerida (OMITIDO — es obligatoria)',
        `IdIP_MuesPend=${idViejo}`,
      );
      r.omitidos += 1;
      continue;
    }

    const nombreTemporada = parsearTexto(f.Temporada);
    const idTemporada =
      nombreTemporada === null
        ? undefined
        : temporadaPorNombre.get(normalizarParaDedup(nombreTemporada));
    if (nombreTemporada !== null && idTemporada === undefined) {
      reporte.agregar(
        'IP_MuesPend con temporada (texto) sin match (se deja SIN temporada)',
        `IdIP_MuesPend=${idViejo} Temporada="${f.Temporada ?? ''}"`,
      );
    }
    const categoria = parsearTexto(f.Categoria) ?? undefined;
    const cantBoards = parsearEntero(f.CantBoards) ?? 0;
    const cantMuestras = parsearEntero(f.CantMuestras) ?? 0;
    const boardsOK = parsearEntero(f.BoardsOK) ?? 0;
    const muestrasOK = parsearEntero(f.MuestrasOK) ?? 0;
    const fechaSolicitado = aIso(parsearFecha(f.FechaSolicitado));
    const fechaEntregado = aIso(parsearFecha(f.FechaEntregado));
    const cancelado = parsearBandera(f.Cancelado);

    // Sesión con el solicitante viejo (preserva `solicitanteId`) + empresa base.
    const solicitanteViejo = parsearEntero(f.IdUsuarioSolicitante);
    const sesion: SesionUsuario =
      solicitanteViejo !== null && solicitanteViejo > 0
        ? { ...sesionBase, id: String(solicitanteViejo) }
        : sesionBase;

    const creado = await intentarCrear(reporte, 'Muestrario', idViejo, () =>
      crearMuestrario(
        sesion,
        {
          idCliente,
          categoria,
          ...(idTemporada === undefined ? {} : { idTemporada }),
          cantBoards,
          cantMuestras,
          ...(fechaSolicitado === undefined ? {} : { fechaSolicitado }),
          fechaRequerida,
        },
        bd,
      ),
    );
    if (creado === null) {
      r.omitidosValidacion = (r.omitidosValidacion ?? 0) + 1;
      continue;
    }

    // Ciclo de vida: cancelado → cancelar; entregado → entregar; pendiente con avance → actualizar.
    if (cancelado) {
      await intentarCrear(reporte, 'Muestrario (cancelar)', idViejo, () =>
        cancelarMuestrario(sesion, creado.id, { motivo: 'Migrado como cancelado (histórico)' }, bd),
      );
    } else if (fechaEntregado !== undefined) {
      await intentarCrear(reporte, 'Muestrario (entregar)', idViejo, () =>
        entregarMuestrario(sesion, creado.id, { fechaEntregado, boardsOK, muestrasOK }, bd),
      );
    } else if (boardsOK > 0 || muestrasOK > 0) {
      await intentarCrear(reporte, 'Muestrario (avance)', idViejo, () =>
        actualizarMuestrario(sesion, creado.id, { boardsOK, muestrasOK }, bd),
      );
    }

    await guardarMapeo(cliente, ENTIDAD_MAPEO.muestrario, idViejo, creado.id);
    r.creados += 1;
  }
  return r;
}
