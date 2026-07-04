/**
 * Loader del CATÁLOGO DE DEFECTOS de calidad (F6-E6).
 *
 *   `CC_Catalogo.csv` (40) → `DefectoCatalogo` (catálogo GLOBAL, doc 09 §2).
 *
 * Carga VÍA el servicio de dominio `crearDefecto` (A1: nada de `prisma.create` de catálogo en el
 * ETL). Mapeo de campos:
 *  • `Clave → clave`, `Descripcion → descripcion`, `Pag → pag`, `AQL → nivelAQL` (Decimal 1/2.5/10),
 *    `Favorito → favorito` (bool).
 *  • `severidad` NO viene en el CSV: se INFIERE del AQL ({@link severidadDesdeAql}) — es METADATO
 *    informativo (decisión (a): NO entra en el veredicto), por eso queda marcado "para revisión" en
 *    el reporte, no es un veredicto migrado.
 *  • `categoria` → null; `aplicaGeneral` → true para TODOS (v1 no clasificaba por tipo de producto,
 *    decisión (d)); `tiposProducto` → vacío (el tipo se etiqueta a mano después).
 *
 * Idempotencia: por el `MapeoMigracion` de `IdCC_Catalogo` (y, defensivamente, por la `clave` única
 * insensible a mayúsculas — retoma una corrida parcial sin duplicar). Solo 40 filas: SECUENCIAL (la
 * clave es @unique; el paralelismo solo introduciría carreras que no valen la pena para 40 registros).
 */
import { crearDefecto } from '../../src/dominio/calidad/defectos.js';
import type { SeveridadDefectoClave } from '../../src/contrato/index.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';
import type { ContextoBd } from '../../src/comun/transaccion.js';
import type { PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import { ENTIDAD_MAPEO, guardarMapeo, leerMapeo, type ClienteMapeo } from '../comun/mapeo.js';
import type { Reporte } from '../comun/reporte.js';
import { intentarCrear, truncarTexto, truncarYReportar } from '../comun/saneo.js';
import { parsearBandera, parsearDinero, parsearTexto } from '../comun/valores.js';
import type { ResultadoLoader } from './clientes.js';

/** Topes de texto del defecto, calcados del Zod de `contrato/esquemas/calidad.ts` (esquemaDefectoCrear). */
const MAX_CLAVE = 50;
const MAX_DESCRIPCION = 300;
const MAX_PAG = 50;

/**
 * Infiere la SEVERIDAD (metadato informativo, decisión (a)) del nivel AQL del viejo: los defectos de
 * AQL más estricto son los más graves. `1 → crítico`, `2.5 → mayor`, `10 → menor` (y cualquier otro
 * nivel cae en `menor`, el más laxo). PURA (unit-testeable). NO es un veredicto: se revisa a mano.
 */
export function severidadDesdeAql(nivelAQL: number): SeveridadDefectoClave {
  if (nivelAQL === 1) return 'critico';
  if (nivelAQL === 2.5) return 'mayor';
  return 'menor';
}

/** Carga el catálogo de defectos (`CC_Catalogo` → `DefectoCatalogo`). Idempotente, vía dominio. */
export async function cargarDefectos(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
): Promise<ResultadoLoader> {
  const bd: ContextoBd = { cliente: cliente as PrismaClient };
  const cli = cliente as PrismaClient;

  reporte.nota(
    'Calidad/defectos: SEVERIDAD inferida del AQL (metadato, NO veredicto — decisión a): ' +
      '1→crítico, 2.5→mayor, 10→menor. Revisar/afinar a mano.',
  );
  reporte.nota(
    'Calidad/defectos: todos entran con aplicaGeneral=true (v1 no clasificaba por tipo de producto — ' +
      'decisión d); el tipo de producto se etiqueta a mano después.',
  );

  const resultado: ResultadoLoader = {
    creados: 0,
    existentes: 0,
    omitidos: 0,
    omitidosValidacion: 0,
  };

  for (const f of leerCsv('CC_Catalogo.csv')) {
    const idViejo = (f.IdCC_Catalogo ?? '').trim();
    const claveCruda = (f.Clave ?? '').trim();
    if (idViejo === '' || claveCruda === '') {
      reporte.agregar(
        'Defecto sin IdCC_Catalogo/Clave (omitido)',
        `IdCC_Catalogo="${idViejo}" Clave="${claveCruda}"`,
      );
      resultado.omitidos += 1;
      continue;
    }

    // Idempotencia 1: ¿ya mapeado?
    const ya = await leerMapeo(cliente, ENTIDAD_MAPEO.defectoCatalogo, idViejo);
    if (ya !== null) {
      resultado.existentes += 1;
      continue;
    }
    // Idempotencia 2: ¿ya existe por clave (corrida parcial previa / seed)? → mapear y contar existente.
    const porClave = await cli.defectoCatalogo.findFirst({
      where: { clave: { equals: claveCruda, mode: 'insensitive' } },
      select: { id: true },
    });
    if (porClave !== null) {
      await guardarMapeo(cliente, ENTIDAD_MAPEO.defectoCatalogo, idViejo, porClave.id);
      resultado.existentes += 1;
      continue;
    }

    const nivelAQL = parsearDinero(f.AQL);
    if (nivelAQL === null) {
      reporte.agregar(
        'Defecto con AQL no numérico (omitido)',
        `IdCC_Catalogo=${idViejo} AQL="${f.AQL ?? ''}"`,
      );
      resultado.omitidos += 1;
      continue;
    }

    const clave =
      truncarYReportar(reporte, 'DefectoCatalogo', idViejo, 'clave', claveCruda, MAX_CLAVE) ??
      claveCruda;
    const descripcion =
      truncarYReportar(
        reporte,
        'DefectoCatalogo',
        idViejo,
        'descripcion',
        parsearTexto(f.Descripcion) ?? claveCruda,
        MAX_DESCRIPCION,
      ) ?? claveCruda;
    const pag = truncarTexto(parsearTexto(f.Pag), MAX_PAG);

    const creado = await intentarCrear(reporte, 'DefectoCatalogo', idViejo, () =>
      crearDefecto(
        sesion,
        {
          clave,
          descripcion,
          pag: pag ?? undefined,
          nivelAQL,
          favorito: parsearBandera(f.Favorito),
          severidad: severidadDesdeAql(nivelAQL),
          aplicaGeneral: true,
          tiposProducto: [],
        },
        bd,
      ),
    );
    if (creado === null) {
      resultado.omitidosValidacion = (resultado.omitidosValidacion ?? 0) + 1;
      continue;
    }
    await guardarMapeo(cliente, ENTIDAD_MAPEO.defectoCatalogo, idViejo, creado.id, {
      clave,
      nivelAQL,
      severidad: severidadDesdeAql(nivelAQL),
    });
    resultado.creados += 1;
  }

  return resultado;
}
