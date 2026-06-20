/**
 * Loader de CARGOS EsMa históricos (F3-E6, Pieza A).
 *
 *   `EsMa.csv` (~11,369: cabecera por maquilero+fecha) + `EsMa_Recibos.csv` (~7,401: un cargo por
 *   renglón) → `EsMaCargo` histórico.
 *
 * Cada renglón de `EsMa_Recibos` es UN cargo, ligado a su `EsMa` (cabecera: maquilero + fecha). En v2
 * el cargo se liga a ORDEN + MAQUILERO + PROCESO, SIN FK al recibo (`idEtapaRecibo = NULL`: la liga
 * formal recibo↔cargo nace en v2 — el viejo no la tenía). Carga vía el MODO MIGRACIÓN del dominio
 * (`crearCargoEsMaMigrado`, A1): NO toca kardex.
 *
 * Mapeo de campos:
 *  • idOrden: `EsMa_Recibos.IdOrdenes` → `Orden.id` (MapeoMigracion de F2). Sin mapeo → cargo
 *    OMITIDO + listado.
 *  • idMaquilero: `EsMa.IdMaquileros` → Proveedor. Según `EsEstampado`: estampadores (1) o
 *    maquileros de costura (0). Sin mapeo → cargo OMITIDO (idMaquilero es NOT NULL).
 *  • idTipoProceso: `EsEstampado` → estampado (1) / costura (0). Falta el TipoProceso → OMITIDO.
 *  • cantidadReal/precioReal: `CantRecEsMa` / `PrecioEsMa` (ya CONCILIADOS en el viejo). Puede nacer
 *    SIN precio (precioReal NULL).
 *  • estado: `RevisionPendiente` 1 → `propuesto` (quedó por revisar); 0 → `validado` (ya conciliado).
 *  • fecha (validadoEn si validado): `EsMa.FechaEsMa`.
 *  • observaciones: combina `EsMa_Recibos.ObsRecibos` + `EsMa.ObsEsMa`.
 *
 * No-cuadre conocido (DOCUMENTADO, NO es error): 12,440 recibos de costura vs 7,401 cargos EsMa — el
 * EsMa del viejo NO tenía relación 1:1 con los recibos (varios recibos podían conciliarse en un cargo,
 * o quedar sin cargo). Por eso el cargo migrado no liga al recibo y el conteo difiere a propósito.
 *
 * Idempotencia: por el `MapeoMigracion` de `IdEsMa_Recibos`.
 */
import { crearCargoEsMaMigrado } from '../../src/dominio/esma/migracion.js';
import type { EstadoCargoEsMa } from '../../src/datos/index.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';
import type { ContextoBd } from '../../src/comun/transaccion.js';
import type { PrismaClient } from '../../src/datos/index.js';

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
import { intentarCrear } from '../comun/saneo.js';
import { parsearBandera, parsearDinero, parsearFecha, parsearTexto } from '../comun/valores.js';
import type { Reporte } from '../comun/reporte.js';
import type { ResultadoLoader } from './clientes.js';
import { cargarMapaOrdenV2 } from './produccion-comun.js';
import { resolverTipoProceso } from './produccion-tipos.js';

/** Cabecera `EsMa`: maquilero + fecha + obs, indexada por `IdEsMa`. */
interface CabeceraEsMa {
  idMaquileroViejo: string;
  fecha: Date | null;
  obs: string | null;
}

function resolverProveedor(crudo: string, mapa: Map<string, number>): number | null {
  const t = crudo.trim();
  if (t === '' || t === '0') return null;
  return mapa.get(t) ?? null;
}

export async function cargarCargosEsMa(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
): Promise<ResultadoLoader> {
  const bd: ContextoBd = { cliente: cliente as PrismaClient };
  const cli = cliente as PrismaClient;

  const idProcCostura = await resolverTipoProceso(cli, 'costura');
  const idProcEstampado = await resolverTipoProceso(cli, 'estampado');
  if (idProcCostura === null || idProcEstampado === null) {
    reporte.agregar(
      'CargoEsMa: falta el TipoProceso costura/estampado (re-sembrar) — flujo OMITIDO',
      'EsMa_Recibos.csv',
    );
    return { creados: 0, existentes: 0, omitidos: 0, omitidosValidacion: 0 };
  }

  const mapaOrdenV2 = await cargarMapaOrdenV2(cliente);
  const mapaMaquilero = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.proveedorPorIdMaquileros);
  const mapaEstampador = await cargarMapaNumerico(
    cliente,
    ENTIDAD_MAPEO.proveedorPorIdEstampadores,
  );

  // Cabeceras EsMa por IdEsMa.
  const cabeceras = new Map<string, CabeceraEsMa>();
  for (const f of leerCsv('EsMa.csv')) {
    const id = (f.IdEsMa ?? '').trim();
    if (id === '') continue;
    cabeceras.set(id, {
      idMaquileroViejo: (f.IdMaquileros ?? '').trim(),
      fecha: parsearFecha(f.FechaEsMa),
      obs: parsearTexto(f.ObsEsMa),
    });
  }

  const resultado: ResultadoLoader = {
    creados: 0,
    existentes: 0,
    omitidos: 0,
    omitidosValidacion: 0,
  };

  const filas = leerCsv('EsMa_Recibos.csv');
  const contribs = await enLotes(
    filas,
    (f) =>
      conReintentoTransitorio(() =>
        procesarCargo(sesion, bd, cli, reporte, f, {
          cabeceras,
          mapaOrdenV2,
          mapaMaquilero,
          mapaEstampador,
          idProcCostura,
          idProcEstampado,
        }),
      ),
    CONCURRENCIA_ETL,
  );

  for (const res of contribs) {
    if (!res.ok) {
      resultado.omitidosValidacion = (resultado.omitidosValidacion ?? 0) + 1;
      continue;
    }
    const e = res.valor;
    if (e === 'creado') resultado.creados += 1;
    else if (e === 'existente') resultado.existentes += 1;
    else if (e === 'omitido') resultado.omitidos += 1;
    else resultado.omitidosValidacion = (resultado.omitidosValidacion ?? 0) + 1;
  }

  return resultado;
}

interface ContextoCargos {
  cabeceras: Map<string, CabeceraEsMa>;
  mapaOrdenV2: Map<string, number>;
  mapaMaquilero: Map<string, number>;
  mapaEstampador: Map<string, number>;
  idProcCostura: number;
  idProcEstampado: number;
}

type EstadoContrib = 'creado' | 'existente' | 'omitido' | 'omitidoValidacion';

async function procesarCargo(
  sesion: SesionUsuario,
  bd: ContextoBd,
  cliente: PrismaClient,
  reporte: Reporte,
  f: Record<string, string>,
  ctx: ContextoCargos,
): Promise<EstadoContrib> {
  const idCargoViejo = (f.IdEsMa_Recibos ?? '').trim();
  const idEsMa = (f.IdEsMa ?? '').trim();
  const idOrdenViejo = (f.IdOrdenes ?? '').trim();

  const ya = await leerMapeo(cliente, ENTIDAD_MAPEO.cargoEsMa, idCargoViejo);
  if (ya !== null) {
    return 'existente';
  }

  const cab = ctx.cabeceras.get(idEsMa);
  if (cab === undefined) {
    reporte.agregar(
      'CargoEsMa con cabecera EsMa inexistente (OMITIDO)',
      `IdEsMa_Recibos=${idCargoViejo} IdEsMa=${idEsMa}`,
    );
    return 'omitido';
  }

  const idOrden = ctx.mapaOrdenV2.get(idOrdenViejo);
  if (idOrden === undefined) {
    reporte.agregar(
      'CargoEsMa con orden sin mapeo (OMITIDO)',
      `IdEsMa_Recibos=${idCargoViejo} IdOrdenes=${idOrdenViejo}`,
    );
    return 'omitido';
  }
  const ordenV2 = await cliente.orden.findUnique({
    where: { id: idOrden },
    select: { idEmpresa: true },
  });
  if (ordenV2 === null) {
    reporte.agregar(
      'CargoEsMa con orden inexistente en v2 (OMITIDO)',
      `IdEsMa_Recibos=${idCargoViejo} IdOrdenes=${idOrdenViejo}`,
    );
    return 'omitido';
  }

  const esEstampado = parsearBandera(f.EsEstampado);
  const idTipoProceso = esEstampado ? ctx.idProcEstampado : ctx.idProcCostura;
  const mapaProv = esEstampado ? ctx.mapaEstampador : ctx.mapaMaquilero;
  const idMaquilero = resolverProveedor(cab.idMaquileroViejo, mapaProv);
  if (idMaquilero === null) {
    reporte.agregar(
      'CargoEsMa con maquilero sin mapeo (OMITIDO — idMaquilero es obligatorio)',
      `IdEsMa_Recibos=${idCargoViejo} IdMaquileros=${cab.idMaquileroViejo} esEstampado=${String(esEstampado)}`,
    );
    return 'omitido';
  }

  // RevisionPendiente 1 → propuesto (quedó por revisar); 0/vacío → validado (ya conciliado).
  const revisionPendiente = parsearBandera(f.RevisionPendiente);
  const estado: EstadoCargoEsMa = revisionPendiente ? 'propuesto' : 'validado';

  const obsRecibos = parsearTexto(f.ObsRecibos);
  const observaciones =
    obsRecibos === null ? cab.obs : cab.obs === null ? obsRecibos : `${obsRecibos}\n${cab.obs}`;

  const creado = await intentarCrear(reporte, 'CargoEsMa', idCargoViejo, () =>
    crearCargoEsMaMigrado(
      sesion,
      {
        idEmpresa: ordenV2.idEmpresa,
        idMaquilero,
        idOrden,
        idTipoProceso,
        cantidadReal: parsearDinero(f.CantRecEsMa),
        precioReal: parsearDinero(f.PrecioEsMa),
        estado,
        observaciones,
        fecha: cab.fecha,
      },
      bd,
    ),
  );
  if (creado === null) {
    return 'omitidoValidacion';
  }
  await guardarMapeo(cliente, ENTIDAD_MAPEO.cargoEsMa, idCargoViejo, creado.idCargo);
  return 'creado';
}
