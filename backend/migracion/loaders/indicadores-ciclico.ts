/**
 * Loader del INVENTARIO CÍCLICO HISTÓRICO (F7-E6). `Alm_InvCic` (542) → `InventarioCiclico` (CERRADO).
 *
 * ⭐ DECISIÓN D6 (histórico Proscai): estos conteos vienen de un sistema EXTERNO (Proscai), "solo
 * consultables, NO comparables contra el kardex v2". Por eso NO pasan por `crearInventarioCiclico`
 * (que congelaría el teórico DESDE el kardex de v2, pisando `CantProscai`, y exigiría color/talla/
 * orden que el viejo no tiene). Se cargan VÍA el MODO MIGRACIÓN del dominio
 * (`crearInventarioCiclicoMigrado`, A1), que:
 *   • guarda `cantTeorica = CantProscai` (ORIGEN EXTERNO, NO la suma del kardex de v2),
 *   • `cantReal = CantReal` (NULL si el viejo no lo trae),
 *   • estado `cerrado` (histórico inmutable; no admite re-conteo ni ajuste — ver TSDoc del dominio),
 *   • SIN ajuste de kardex (`idMovimientoAjuste = NULL`): NO reconcilia contra v2 (D6).
 *
 * SENTINELAS (el viejo Proscai solo tenía MODELO + fecha, sin desglose):
 *   • Color/Talla `(sin especificar)` INACTIVOS — los MISMOS de F3-E6/IPT (`asegurarSentinelas`).
 *   • Almacén `(Migración Proscai)` INACTIVO (tipo PT) — no es un almacén real de v2 (D6). `idOrden`
 *     queda NULL (no hay orden en el cíclico Proscai).
 *
 * Un renglón por fila `Alm_InvCic` (cada fila = un modelo contado en una fecha) → un encabezado con
 * su único detalle (el viejo era una BITÁCORA plana, sin agrupar en hojas; se preserva 1:1). Empresa
 * (A9) = la favorita (el viejo no la llevaba). Idempotente por `MapeoMigracion(IdAlm_InvCic)`;
 * secuencial para no contender el folio de secuencia (542 filas, cada una una transacción corta).
 */
import {
  crearInventarioCiclicoMigrado,
  type InventarioCiclicoHistoricoMigrado,
} from '../../src/dominio/indicadores/migracion.js';
import type { ContextoBd } from '../../src/comun/transaccion.js';
import type { PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import {
  cargarMapaNumerico,
  ENTIDAD_MAPEO,
  guardarMapeo,
  type ClienteMapeo,
} from '../comun/mapeo.js';
import type { Reporte } from '../comun/reporte.js';
import { intentarCrear } from '../comun/saneo.js';
import { sesionEtl } from '../comun/sesion-etl.js';
import { parsearEntero, parsearFechaSoloDia } from '../comun/valores.js';
import { asegurarSentinelas } from './ipt-kardex.js';
import type { ResultadoLoader } from './clientes.js';

/** Nombre del almacén SENTINELA del cíclico histórico Proscai (INACTIVO, tipo PT). */
export const ALMACEN_SENTINELA_PROSCAI = '(Migración Proscai)';

/**
 * Upsert IDEMPOTENTE del almacén SENTINELA `(Migración Proscai)` (INACTIVO, tipo PT, de la empresa
 * dada). Es un artefacto técnico de la migración (D6: estos cíclicos no cuelgan de un almacén real de
 * v2), por eso nace INACTIVO (no sale en los selectores). Devuelve su id.
 */
export async function asegurarAlmacenSentinela(
  cliente: ClienteMapeo,
  idEmpresa: number,
): Promise<number> {
  const alm = await cliente.almacen.upsert({
    where: { idEmpresa_nombre: { idEmpresa, nombre: ALMACEN_SENTINELA_PROSCAI } },
    update: {},
    create: { nombre: ALMACEN_SENTINELA_PROSCAI, tipo: 'PT', activo: false, idEmpresa },
    select: { id: true },
  });
  return alm.id;
}

/** Carga Alm_InvCic → InventarioCiclico (histórico cerrado, D6). Empresa = `idEmpresa` (favorita). */
export async function cargarCiclicoHistorico(
  cliente: ClienteMapeo,
  reporte: Reporte,
  idEmpresa: number,
): Promise<ResultadoLoader> {
  const cli = cliente as PrismaClient;
  const bd: ContextoBd = { cliente: cli };
  const sesion = sesionEtl(idEmpresa);
  const r: ResultadoLoader = { creados: 0, existentes: 0, omitidos: 0, omitidosValidacion: 0 };

  reporte.nota(
    'Inventario cíclico (D6): histórico Proscai cargado como registros CERRADOS, cantTeorica = ' +
      'CantProscai (ORIGEN EXTERNO, no comparable contra el kardex v2), SIN ajuste de kardex. Color/' +
      'Talla `(sin especificar)` + almacén `(Migración Proscai)` INACTIVOS; sin orden.',
  );

  const idAlmacen = await asegurarAlmacenSentinela(cliente, idEmpresa);
  const { idColor, idTalla } = await asegurarSentinelas(cliente);

  // Código de modelo (v2) → idModelo (Alm_InvCic.ModeloIC es el CÓDIGO, no un id).
  const idPorCodigo = new Map<string, number>();
  for (const m of await cli.modelo.findMany({ select: { id: true, codigo: true } })) {
    idPorCodigo.set(m.codigo.trim().toUpperCase(), m.id);
  }
  const yaMigrados = new Set(
    (await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.inventarioCiclicoHist)).keys(),
  );

  for (const f of leerCsv('Alm_InvCic.csv')) {
    const idViejo = (f.IdAlm_InvCic ?? '').trim();
    if (idViejo === '') {
      r.omitidos += 1;
      continue;
    }
    if (yaMigrados.has(idViejo)) {
      r.existentes += 1;
      continue;
    }
    const codigo = (f.ModeloIC ?? '').trim().toUpperCase();
    const idModelo = idPorCodigo.get(codigo);
    if (idModelo === undefined) {
      reporte.agregar(
        'Alm_InvCic con ModeloIC sin match por código en v2 (OMITIDO)',
        `IdAlm_InvCic=${idViejo} ModeloIC="${f.ModeloIC ?? ''}"`,
      );
      r.omitidos += 1;
      continue;
    }
    const cantTeorica = parsearEntero(f.CantProscai);
    const fecha = parsearFechaSoloDia(f.FechaIC);
    if (cantTeorica === null || fecha === null) {
      reporte.agregar(
        'Alm_InvCic sin CantProscai/FechaIC parseable (OMITIDO — no se inventan)',
        `IdAlm_InvCic=${idViejo} CantProscai="${f.CantProscai ?? ''}" FechaIC="${f.FechaIC ?? ''}"`,
      );
      r.omitidos += 1;
      continue;
    }
    const cantReal = parsearEntero(f.CantReal);

    const entrada: InventarioCiclicoHistoricoMigrado = {
      idEmpresa,
      idAlmacen,
      idModelo,
      idColor,
      idTalla,
      cantTeorica,
      cantReal,
      fecha,
      observaciones: `Histórico Proscai (D6) · ModeloIC="${f.ModeloIC ?? ''}"`,
    };
    const creado = await intentarCrear(reporte, 'InventarioCiclico', idViejo, () =>
      crearInventarioCiclicoMigrado(sesion, entrada, bd),
    );
    if (creado === null) {
      r.omitidosValidacion = (r.omitidosValidacion ?? 0) + 1;
      continue;
    }
    await guardarMapeo(cliente, ENTIDAD_MAPEO.inventarioCiclicoHist, idViejo, creado.id);
    yaMigrados.add(idViejo);
    r.creados += 1;
  }
  return r;
}
