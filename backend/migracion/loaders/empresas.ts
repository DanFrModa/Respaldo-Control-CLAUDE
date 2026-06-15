/**
 * Loader de EMPRESAS (F1-E6). `Empresas.csv` (8, solo 2 activas) → upsert SOLO de las
 * ACTIVAS que falten. FR Moda (Activa=1) ya existe (seed F0); FALTA **Marilyn Fitness**
 * (Activa=1, UPC 7500092). Las 6 inactivas NO migran (se registran en el reporte).
 *
 * Carga VÍA el dominio (A1): `crearEmpresa`. Idempotente por nombre. Persiste el mapeo
 * `IdEmpresas → idEmpresa`. Devuelve el id de FR Moda (la empresa de los almacenes).
 *
 * IMPORTANTE (acta Gabriel / memoria): Marilyn/MJD es ANTIGUO; Marilyn Fitness se migra
 * porque está ACTIVA en el viejo y es parte del grupo FR Moda (misma empresa renombrada en
 * lo comercial, pero fila propia en `Empresas`). NO se crea ninguna empresa inactiva.
 */
import { crearEmpresa } from '../../src/dominio/admin/empresas.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';
import type { ContextoBd } from '../../src/comun/transaccion.js';
import type { PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import { ENTIDAD_MAPEO, guardarMapeo, type ClienteMapeo } from '../comun/mapeo.js';
import type { Reporte } from '../comun/reporte.js';
import { parsearBandera, parsearTexto } from '../comun/valores.js';
import type { ResultadoLoader } from './clientes.js';

/** Resultado de empresas: el resumen estándar + el id de FR Moda (para los almacenes). */
export interface ResultadoEmpresas extends ResultadoLoader {
  idFrModa: number | null;
}

async function idPorNombre(cliente: ClienteMapeo, nombre: string): Promise<number | null> {
  const fila = await cliente.empresa.findFirst({
    where: { nombre: { equals: nombre, mode: 'insensitive' } },
    select: { id: true },
  });
  return fila?.id ?? null;
}

export async function cargarEmpresas(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
): Promise<ResultadoEmpresas> {
  const bd: ContextoBd = { cliente: cliente as PrismaClient };
  const filas = leerCsv('Empresas.csv');
  let creados = 0;
  let existentes = 0;
  let omitidos = 0;
  let idFrModa: number | null = null;

  for (const fila of filas) {
    const idViejo = fila.IdEmpresas;
    const nombre = parsearTexto(fila.Empresa);
    const activa = parsearBandera(fila.Activa);

    if (nombre === null) {
      omitidos += 1;
      continue;
    }
    if (!activa) {
      omitidos += 1;
      reporte.agregar(
        'Empresas inactivas NO migradas (decisión: solo activas)',
        `Id=${idViejo ?? '?'} · ${nombre}`,
      );
      continue;
    }

    let idNuevo = await idPorNombre(cliente, nombre);
    if (idNuevo === null) {
      const creada = await crearEmpresa(
        sesion,
        {
          nombre,
          razonSocial: parsearTexto(fila.RazonSocial) ?? undefined,
          identificador: parsearTexto(fila.Identificador) ?? undefined,
          upc: parsearTexto(fila.UPCEmp) ?? undefined,
          // La favorita ya es FR Moda (seed F0): NO la cambiamos aquí.
          favorita: false,
          paraIpt: parsearBandera(fila.ParaIPT),
          paraEdr: parsearBandera(fila.ParaEdoRes),
        },
        bd,
      );
      idNuevo = creada.id;
      creados += 1;
    } else {
      existentes += 1;
    }

    if (idViejo !== undefined) {
      await guardarMapeo(cliente, ENTIDAD_MAPEO.empresa, idViejo, idNuevo, { nombre });
    }
    if (nombre.toLowerCase() === 'fr moda') {
      idFrModa = idNuevo;
    }
  }

  if (idFrModa === null) {
    // FR Moda debería existir por el seed F0; si no, los almacenes caerán en la favorita.
    const fila = await cliente.empresa.findFirst({
      where: { favorita: true },
      select: { id: true },
    });
    idFrModa = fila?.id ?? null;
    reporte.nota(
      'No se halló empresa "FR Moda" por nombre; los almacenes usarán la empresa favorita.',
    );
  }

  return { creados, existentes, omitidos, idFrModa };
}
