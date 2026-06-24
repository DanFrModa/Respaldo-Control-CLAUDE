/**
 * Loader de EMPRESAS (F1-E6). `Empresas.csv` (8, solo 2 activas) → upsert SOLO de las
 * ACTIVAS que falten. FR Moda (Activa=1) ya existe (seed F0); FALTA **Marilyn Fitness**
 * (Activa=1). Las 6 inactivas NO migran (se registran en el reporte). La columna `UPCEmp`
 * NO se migra: códigos de barra en retiro y `Empresa.upc` fue eliminada (Gabriel 16-jun-2026).
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
import { intentarCrear, LIMITES, truncarYReportar } from '../comun/saneo.js';
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
  let omitidosValidacion = 0;
  let idFrModa: number | null = null;

  for (const fila of filas) {
    const idViejo = fila.IdEmpresas;
    const nombreCrudo = parsearTexto(fila.Empresa);
    const activa = parsearBandera(fila.Activa);

    if (nombreCrudo === null) {
      omitidos += 1;
      continue;
    }
    if (!activa) {
      omitidos += 1;
      reporte.agregar(
        'Empresas inactivas NO migradas (decisión: solo activas)',
        `Id=${idViejo ?? '?'} · ${nombreCrudo}`,
      );
      continue;
    }
    const nombre =
      truncarYReportar(
        reporte,
        'Empresa',
        idViejo,
        'nombre',
        nombreCrudo,
        LIMITES.empresa.nombre,
      ) ?? nombreCrudo;
    const razonSocial = truncarYReportar(
      reporte,
      'Empresa',
      idViejo,
      'razonSocial',
      parsearTexto(fila.RazonSocial),
      LIMITES.empresa.razonSocial,
    );
    const identificador = truncarYReportar(
      reporte,
      'Empresa',
      idViejo,
      'identificador',
      parsearTexto(fila.Identificador),
      LIMITES.empresa.identificador,
    );
    // Empresas.UPCEmp → EXCLUIDA POR DECISIÓN (Gabriel, 16-jun-2026): los códigos de barra están
    // en retiro y la columna destino `Empresa.upc` fue eliminada del modelo. No se lee ni se migra.

    let idNuevo = await idPorNombre(cliente, nombre);
    if (idNuevo === null) {
      const creada = await intentarCrear(reporte, 'Empresa', idViejo, () =>
        crearEmpresa(
          sesion,
          {
            nombre,
            razonSocial: razonSocial ?? undefined,
            identificador: identificador ?? undefined,
            // La favorita ya es FR Moda (seed F0): NO la cambiamos aquí.
            favorita: false,
            paraIpt: parsearBandera(fila.ParaIPT),
            paraEdr: parsearBandera(fila.ParaEdoRes),
          },
          bd,
        ),
      );
      if (creada === null) {
        omitidosValidacion += 1;
        continue;
      }
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

  return { creados, existentes, omitidos, omitidosValidacion, idFrModa };
}
