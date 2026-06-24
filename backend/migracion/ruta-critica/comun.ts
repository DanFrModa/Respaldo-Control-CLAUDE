/**
 * Helpers COMPARTIDOS del ETL de la Ruta Crítica (F5-E7, Pieza B).
 *
 * El histórico RC del viejo referencia los PROCESOS por `IdCP_Procesos` (1..26). En v2 los procesos
 * los sembró F5-E1 con un `codigo` kebab-case ESTABLE, en el MISMO orden que `CP_Procesos.csv`
 * (verificado: `IdCP_Procesos == NumProceso == índice de fila`, 1..26). Aquí se reconstruye el puente
 * `IdCP_Procesos → ProcesoDef.id` de v2 leyendo `CP_Procesos.csv` (orden de fila) y casándolo con los
 * `codigo` del catálogo de v2 por posición. NO crea procesos (los siembra E1): solo traduce.
 *
 * Los `codigo` kebab por POSICIÓN se calcan del seed `seed-ruta-critica.ts` (la fuente de verdad del
 * mapeo de E1). Si E1 cambia el orden/codigos, hay que actualizar este arreglo (es la MISMA regla).
 */
import type { PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import type { ClienteMapeo } from '../comun/mapeo.js';

/**
 * Códigos kebab de los 26 procesos de la RC, EN ORDEN de `CP_Procesos.csv` (= NumProceso 1..26).
 * Calcados de `seed-ruta-critica.ts` (PROCESOS_RC). Posición i → `IdCP_Procesos = i+1`.
 */
export const CODIGOS_PROCESO_POR_POSICION: readonly string[] = [
  'revision-orden', // 1
  'ficha-desarrollo', // 2
  'programacion', // 3
  'autorizacion-fit', // 4
  'autorizacion-arte', // 5
  'orden-compra-tela', // 6
  'autorizacion-tono-tela', // 7
  'autorizacion-avios', // 8
  'ficha-tecnica', // 9
  'contramuestra-maquila', // 10
  'orden-compra-habilitaciones', // 11
  'surtido-avios', // 12
  'recepcion-tela', // 13
  'autorizacion-muestras-laboratorio', // 14
  'entrega-moldes-corte', // 15
  'auditoria-corte', // 16
  'corte', // 17
  'envio-procesos', // 18
  'recepcion-procesos', // 19
  'auditoria-calidad-proceso', // 20
  'envio-confeccion', // 21
  'recepcion-confeccion', // 22
  'auditoria-calidad-interna', // 23
  'empaque', // 24
  'entrega-cdis', // 25
  'aceptacion-cliente', // 26
];

/** Datos de un proceso de v2 que el histórico necesita (id + snapshot de banderas). */
export interface ProcesoV2 {
  id: number;
  codigo: string;
  critico: boolean;
  ultimoProceso: boolean;
  esResurtido: boolean;
  condicionAplicabilidad: 'ninguna' | 'soloSiLlevaAplicacion';
}

/**
 * Construye el puente `IdCP_Procesos (string) → ProcesoV2` leyendo el ORDEN de `CP_Procesos.csv` y
 * casándolo con los procesos de v2 por `codigo` (posición). Devuelve también la lista de procesos del
 * CSV que NO encontraron su `codigo` en v2 (deben ser 0 si E1 está sembrado).
 */
export async function construirPuenteProcesos(cliente: PrismaClient): Promise<{
  porIdViejo: Map<string, ProcesoV2>;
  faltantes: { idViejo: string; codigoEsperado: string }[];
}> {
  const procesosV2 = await cliente.procesoDef.findMany({
    select: {
      id: true,
      codigo: true,
      critico: true,
      ultimoProceso: true,
      esResurtido: true,
      condicionAplicabilidad: true,
    },
  });
  const porCodigo = new Map(procesosV2.map((p) => [p.codigo, p]));

  // El orden de fila de CP_Procesos.csv define IdCP_Procesos → posición → codigo (E1).
  const filas = leerCsv('CP_Procesos.csv');
  const porIdViejo = new Map<string, ProcesoV2>();
  const faltantes: { idViejo: string; codigoEsperado: string }[] = [];
  filas.forEach((f, indice) => {
    const idViejo = (f.IdCP_Procesos ?? '').trim();
    if (idViejo === '') return;
    const codigo = CODIGOS_PROCESO_POR_POSICION[indice];
    if (codigo === undefined) return; // CSV con más filas que el set conocido (no debería pasar)
    const v2 = porCodigo.get(codigo);
    if (v2 === undefined) {
      faltantes.push({ idViejo, codigoEsperado: codigo });
      return;
    }
    porIdViejo.set(idViejo, v2);
  });
  return { porIdViejo, faltantes };
}

/** Carga `Rol.nombre → Rol.id` (RBAC único, A4) para casar los `RC_TipoUsuarios` contra los roles. */
export async function cargarRolesPorNombre(cliente: ClienteMapeo): Promise<Map<string, number>> {
  const roles = await cliente.rol.findMany({ select: { id: true, nombre: true } });
  return new Map(roles.map((r) => [r.nombre, r.id]));
}
