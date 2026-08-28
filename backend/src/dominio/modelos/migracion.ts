/**
 * MODO MIGRACIÓN del módulo MODELOS (V1-E8j) — capa de dominio (A1).
 *
 * El servicio normal (`modelos.ts` → `crearModelo`) está afinado para la CAPTURA nueva y desde
 * §Post-F9.134 hace nacer **todo modelo en DESARROLLO**: sin nº de producción, con el código
 * tecleado guardado además como `codigoDesarrollo`, **exigiendo tipo de prenda y género** (los dos
 * dígitos con los que después se le arma el número) y con el catálogo de producción llenándose SÓLO
 * por «pasar a producción». Es lo correcto para el día a día y es lo que Daniel pidió.
 *
 * El ETL del histórico de Access carga otra cosa: **~4,987 modelos que YA son de producción, sin
 * orden ninguna y SIN GÉNERO** —`Modelos.csv` ni siquiera trae la columna—. Su código de 5 dígitos
 * *es* su nº de producción, nunca pasaron por Desarrollo y no hay nada que numerarles. Si entraran
 * por el servicio normal, la exigencia de los dos dígitos los rechazaría a todos y la marca los
 * dejaría en desarrollo con un nº de desarrollo inventado.
 *
 * ⚠️ **Cómo se evita que la regla viva en dos lados.** Esta función **NO llama a `crearModelo`**:
 * las dos comparten {@link crearModeloNucleo}, que hace lo común (código único, FKs válidas, la
 * fila, la auditoría y la bitácora) y **recibe la nomenclatura ya decidida**. La exigencia de los
 * dígitos vive UNA sola vez, en `crearModelo`, **por encima** del núcleo — así la migración entra
 * por debajo sin banderas y sin que nadie tenga que acordarse de excluirla. Mismo patrón que
 * `promoverAProduccionNucleo` y `ligarOrdenNucleo`, y que el modo migración de órdenes, compras,
 * notas, inventarios, RC y terceros: estas funciones **no se exponen en ninguna ruta Zod/REST**.
 *
 * Lo único que RELAJA respecto al alta normal:
 *  • **No exige los dos dígitos** (el histórico no los tiene y no los necesita).
 *  • **Marca de nomenclatura de PRODUCCIÓN**: `origen: 'produccion'`; `codigoDesarrollo: null`
 *    (nunca fue de desarrollo — inventarle uno haría que su código apareciera DOS veces en la
 *    búsqueda por texto, que mira las dos columnas); y `numeroProduccion` derivado del código cuando
 *    tiene la forma de 5 dígitos, para que **OCUPE** su consecutivo (285 de los 4,987 traen códigos
 *    no numéricos —`51783a`, `M-18`— y ésos se quedan en null, como manda el esquema).
 */
import type { z } from 'zod';

import { esquemaModeloCrearMigracion } from '../../contrato/esquemas/modelo.js';

import type { SesionUsuario } from '../../comun/permisos.js';
import { verificarPermiso } from '../../comun/permisos.js';
import { enTransaccion, type ContextoBd } from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

import {
  conConflictoDeCodigo,
  crearModeloNucleo,
  type MarcaNomenclaturaModelo,
  type ModeloConRelaciones,
} from './modelos.js';
import { numeroProduccionDeCodigo } from './nomenclatura.js';

/** Entrada del alta en modo migración: la del alta normal con los DOS DÍGITOS opcionales. */
export type EntradaCrearModeloMigrado = z.input<typeof esquemaModeloCrearMigracion>;

/** La marca del histórico: producción, sin nº de desarrollo y con el número derivado del código. */
export function marcaProduccionMigrada(codigo: string): MarcaNomenclaturaModelo {
  return {
    origen: 'produccion',
    codigoDesarrollo: null,
    numeroProduccion: numeroProduccionDeCodigo(codigo),
  };
}

/**
 * Crea un modelo HISTÓRICO, ya en el catálogo de producción (ETL de Access, F1-E7).
 *
 * @param sesion Sesión del ETL (necesita `modelos.administrar`, igual que el alta normal).
 * @param entrada Datos del CSV; los dos dígitos son opcionales aquí (ver el encabezado).
 * @param bd Contexto de BD: el loader pasa su cliente; si ya hay `tx`, se une a ella (A2).
 */
export async function crearModeloMigrado(
  sesion: SesionUsuario,
  entrada: EntradaCrearModeloMigrado,
  bd?: ContextoBd,
): Promise<ModeloConRelaciones> {
  verificarPermiso(sesion, 'modelos.administrar');
  const datos = validarEntrada(esquemaModeloCrearMigracion, entrada);

  return conConflictoDeCodigo(datos.codigo, () =>
    enTransaccion(
      async (tx) => crearModeloNucleo(tx, sesion, datos, marcaProduccionMigrada(datos.codigo)),
      bd,
    ),
  );
}
