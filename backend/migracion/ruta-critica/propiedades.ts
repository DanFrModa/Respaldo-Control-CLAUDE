/**
 * Loader del COLCHÓN DE COSTURA de la Ruta Crítica (F5-E7, Pieza B).
 *
 * `Propiedades.csv` (1 fila GLOBAL) → `ConfiguracionEmpresa.colchonCostura` de la empresa favorita. El
 * colchón (días) lo SUMA el motor de duración a la costura (ex `Propiedades.ColchonCostura`). El viejo
 * tenía UNA sola tabla de propiedades (mono-empresa); en v2 la configuración es por empresa (A9), así
 * que el colchón se aplica a la empresa FAVORITA (FR Moda). Si Gabriel define empresas adicionales, el
 * colchón de cada una se ajusta luego por el CRUD.
 *
 * Carga VÍA el dominio (`actualizarConfiguracion`, A1/A2/A7), que hace UPSERT idempotente de la
 * `ConfiguracionEmpresa` (no pisa los demás campos: solo fija `colchonCostura`). Re-correr no duplica.
 */
import { actualizarConfiguracion } from '../../src/dominio/admin/empresas.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';
import type { ContextoBd } from '../../src/comun/transaccion.js';
import type { PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import type { Reporte } from '../comun/reporte.js';
import { intentarCrear } from '../comun/saneo.js';
import { parsearEntero } from '../comun/valores.js';

/** Resultado del loader de propiedades. */
export interface ResultadoPropiedades {
  /** ¿Se fijó el colchón en alguna empresa? */
  aplicado: boolean;
  /** Valor del colchón leído del viejo (null si vacío/no encontrado). */
  colchonCostura: number | null;
}

export async function cargarPropiedades(
  sesion: SesionUsuario,
  cliente: PrismaClient,
  reporte: Reporte,
): Promise<ResultadoPropiedades> {
  const bd: ContextoBd = { cliente };
  const filas = leerCsv('Propiedades.csv');
  const fila = filas[0];
  const colchonCostura = fila === undefined ? null : parsearEntero(fila.ColchonCostura);

  if (colchonCostura === null) {
    reporte.nota('Propiedades.ColchonCostura vacío o ausente: no se fija colchón de costura.');
    return { aplicado: false, colchonCostura: null };
  }

  const empresa = await cliente.empresa.findFirst({
    where: { favorita: true },
    select: { id: true, nombre: true },
  });
  if (empresa === null) {
    reporte.agregar(
      'ColchonCostura no aplicado: no hay empresa favorita',
      `colchonCostura=${String(colchonCostura)}`,
    );
    return { aplicado: false, colchonCostura };
  }

  const ok = await intentarCrear(reporte, 'ConfiguracionEmpresa', empresa.id, () =>
    actualizarConfiguracion(sesion, empresa.id, { colchonCostura }, bd),
  );
  if (ok === null) {
    return { aplicado: false, colchonCostura };
  }
  reporte.nota(
    `ColchonCostura=${String(colchonCostura)} fijado en la ConfiguracionEmpresa de "${empresa.nombre}".`,
  );
  return { aplicado: true, colchonCostura };
}
