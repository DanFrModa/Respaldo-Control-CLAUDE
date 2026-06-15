/**
 * Loader de CLIENTES (F1-E6). `Clientes.csv` (117) → catálogo `Cliente` + por cliente un
 * `ClienteCampo` 'No. de pedido del cliente' (D7; el VALOR "Monarch" migra en F2/F9 — aquí
 * solo la DEFINICIÓN del campo).
 *
 * Carga VÍA el dominio (A1): `crearCliente` + `agregarCampoCliente`. Idempotente: si el
 * cliente ya existe (por nombre, único global) se reutiliza; si el campo D7 ya existe, no se
 * duplica. Persiste el mapeo `IdClientes → idCliente` (reusado por F2).
 */
import {
  agregarCampoCliente,
  crearCliente,
  listarCamposCliente,
} from '../../src/dominio/catalogos/clientes.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';
import { ErrorConflicto } from '../../src/comun/errores.js';
import type { ContextoBd } from '../../src/comun/transaccion.js';
import type { PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import { ENTIDAD_MAPEO, guardarMapeo, type ClienteMapeo } from '../comun/mapeo.js';
import type { Reporte } from '../comun/reporte.js';
import { parsearTexto } from '../comun/valores.js';

/** Etiqueta del campo D7 que se siembra por cliente (semilla del `Monarch` viejo). */
export const CAMPO_D7_PEDIDO_CLIENTE = 'No. de pedido del cliente';

/** Resultado resumido de un loader (para el log y el reporte de cuadre). */
export interface ResultadoLoader {
  /** Cuántos registros nuevos se crearon. */
  creados: number;
  /** Cuántos ya existían (idempotencia). */
  existentes: number;
  /** Cuántos se omitieron por dato inválido (van al reporte). */
  omitidos: number;
}

/** Busca por nombre (único global) en la BD para resolver idempotencia y mapeo. */
async function idClientePorNombre(cliente: ClienteMapeo, nombre: string): Promise<number | null> {
  const fila = await cliente.cliente.findFirst({
    where: { nombre: { equals: nombre, mode: 'insensitive' } },
    select: { id: true },
  });
  return fila?.id ?? null;
}

export async function cargarClientes(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
): Promise<ResultadoLoader> {
  const bd: ContextoBd = { cliente: cliente as PrismaClient };
  const filas = leerCsv('Clientes.csv');
  let creados = 0;
  let existentes = 0;
  let omitidos = 0;

  for (const fila of filas) {
    const idViejo = fila.IdClientes;
    const nombre = parsearTexto(fila.Cliente);
    if (nombre === null) {
      omitidos += 1;
      reporte.agregar('Clientes con nombre vacío (omitidos)', `IdClientes=${idViejo ?? '?'}`);
      continue;
    }

    let idNuevo = await idClientePorNombre(cliente, nombre);
    if (idNuevo === null) {
      const creado = await crearCliente(sesion, { nombre }, bd);
      idNuevo = creado.id;
      creados += 1;
    } else {
      existentes += 1;
    }

    if (idViejo !== undefined) {
      await guardarMapeo(cliente, ENTIDAD_MAPEO.cliente, idViejo, idNuevo, { nombre });
    }

    // Campo D7 'No. de pedido del cliente' (idempotente: no duplicar si ya está).
    const campos = await listarCamposCliente(sesion, idNuevo, { incluirInactivos: true }, bd);
    const yaTiene = campos.some(
      (c) => c.etiqueta.toLowerCase() === CAMPO_D7_PEDIDO_CLIENTE.toLowerCase(),
    );
    if (!yaTiene) {
      try {
        await agregarCampoCliente(sesion, idNuevo, { etiqueta: CAMPO_D7_PEDIDO_CLIENTE }, bd);
      } catch (error) {
        // Carrera/duplicado: idempotente, no es incidencia (el dominio ya lo valida).
        if (!(error instanceof ErrorConflicto)) {
          throw error;
        }
      }
    }
  }

  return { creados, existentes, omitidos };
}
