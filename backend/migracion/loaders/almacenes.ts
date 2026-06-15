/**
 * Loader de ALMACENES (F1-E6). Dos fuentes:
 *  • `IPT_Almacenes.csv` (3: Primeras/Segundas/Tránsito) → `Almacen` tipo **PT**. El viejo NO
 *    trae bandera de activo aquí: se migran los 3 como PROVISIONALES (se registra en el
 *    reporte; Gabriel decide cuáles conservar/desactivar).
 *  • `Almacenes.csv` (56, 6 activos) → `Almacen` tipo **TELA**, SOLO los activos.
 *
 * Carga VÍA el dominio (A1): `crearAlmacen`. Decisión de `idEmpresa`: el servicio de dominio
 * `crearAlmacen` EXIGE una empresa existente y ACTIVA (no acepta `null` aunque el schema sí
 * permita almacenes globales); por eso se asignan a **FR Moda** (la empresa principal, id
 * recibido del loader de empresas). Se documenta esta decisión (el seed F0 no siembra
 * almacenes, así que no hay convención previa que calcar). Idempotente por nombre dentro de
 * la empresa. Persiste el mapeo `IdIPT_Almacenes → idAlmacen` y `IdAlmacenes → idAlmacen`.
 */
import { crearAlmacen } from '../../src/dominio/admin/almacenes.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';
import type { ContextoBd } from '../../src/comun/transaccion.js';
import type { PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import {
  ENTIDAD_MAPEO,
  guardarMapeo,
  type ClienteMapeo,
  type DatosMapeo,
  type EntidadMapeo,
} from '../comun/mapeo.js';
import type { Reporte } from '../comun/reporte.js';
import { intentarCrear, LIMITES, truncarYReportar } from '../comun/saneo.js';
import { parsearBandera, parsearTexto } from '../comun/valores.js';
import type { ResultadoLoader } from './clientes.js';

/** Busca un almacén por nombre dentro de la empresa (idempotencia). */
async function idAlmacenPorNombre(
  cliente: ClienteMapeo,
  idEmpresa: number,
  nombre: string,
): Promise<number | null> {
  const fila = await cliente.almacen.findFirst({
    where: { idEmpresa, nombre: { equals: nombre, mode: 'insensitive' } },
    select: { id: true },
  });
  return fila?.id ?? null;
}

export async function cargarAlmacenes(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
  idEmpresa: number,
): Promise<ResultadoLoader> {
  // La sesión de sistema usa esta empresa como activa, para que `crearAlmacen` la asigne.
  const sesionEmpresa: SesionUsuario = { ...sesion, idEmpresaActiva: idEmpresa };
  const bd: ContextoBd = { cliente: cliente as PrismaClient };
  let creados = 0;
  let existentes = 0;
  let omitidos = 0;
  let omitidosValidacion = 0;

  async function crearUno(
    nombreCrudo: string,
    tipo: 'PT' | 'TELA',
    entidad: EntidadMapeo,
    idViejo: string | undefined,
    datosMapeo: DatosMapeo,
  ): Promise<void> {
    const nombre =
      truncarYReportar(
        reporte,
        'Almacen',
        idViejo,
        'nombre',
        nombreCrudo,
        LIMITES.almacen.nombre,
      ) ?? nombreCrudo;
    let idNuevo = await idAlmacenPorNombre(cliente, idEmpresa, nombre);
    if (idNuevo === null) {
      // Tolerante a cualquier error de fila (incluido el choque de nombre PT vs TELA, que el
      // unique (idEmpresa, nombre) rechaza): se reporta y se cuenta como omitido por validación.
      const creado = await intentarCrear(reporte, 'Almacen', idViejo, () =>
        crearAlmacen(sesionEmpresa, { nombre, tipo }, bd),
      );
      if (creado === null) {
        omitidosValidacion += 1;
        return;
      }
      idNuevo = creado.id;
      creados += 1;
    } else {
      existentes += 1;
    }
    if (idViejo !== undefined) {
      await guardarMapeo(cliente, entidad, idViejo, idNuevo, datosMapeo);
    }
  }

  // ── IPT_Almacenes → PT (provisional, los 3) ──────────────────────────────────
  const ipt = leerCsv('IPT_Almacenes.csv');
  reporte.nota(
    `Almacenes PT (IPT_Almacenes): migrados como PROVISIONALES a la empresa ${String(idEmpresa)} ` +
      '(FR Moda). El viejo no trae bandera de activo en esta tabla; Gabriel decide cuáles conservar.',
  );
  for (const fila of ipt) {
    const nombre = parsearTexto(fila.Almacen);
    if (nombre === null) {
      omitidos += 1;
      continue;
    }
    await crearUno(nombre, 'PT', ENTIDAD_MAPEO.almacenIpt, fila.IdIPT_Almacenes, {
      nombre,
      tipoAlmacenViejo: parsearTexto(fila.TipoAlmacen),
      provisional: true,
    });
  }

  // ── Almacenes → TELA (solo activos) ──────────────────────────────────────────
  const telas = leerCsv('Almacenes.csv');
  for (const fila of telas) {
    const nombre = parsearTexto(fila.Almacen);
    if (nombre === null) {
      omitidos += 1;
      continue;
    }
    if (!parsearBandera(fila.Activo)) {
      omitidos += 1;
      continue; // solo activos (los inactivos no se migran; no son incidencia)
    }
    await crearUno(nombre, 'TELA', ENTIDAD_MAPEO.almacenTela, fila.IdAlmacenes, { nombre });
  }

  return { creados, existentes, omitidos, omitidosValidacion };
}
