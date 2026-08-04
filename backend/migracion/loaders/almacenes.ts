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
 * recibido del loader de empresas). Persiste el mapeo `IdIPT_Almacenes → idAlmacen` y
 * `IdAlmacenes → idAlmacen` — **ese mapeo es lo único que el kardex necesita**.
 *
 * ⚠️ BUG HISTÓRICO CORREGIDO (kardex PT vacío, detectado 31-jul-2026). Desde que F3-E1 hizo que
 * el SEED sembrara los 3 almacenes PT como GLOBALES (`idEmpresa = null`), este loader —que
 * corre DESPUÉS del seed— buscaba la idempotencia SOLO dentro de FR Moda (`where: {idEmpresa,
 * nombre}`), no veía al global y trataba de crearlo; el dominio (`exigirNombreLibre`, que SÍ
 * mira `OR: [{idEmpresa}, {idEmpresa: null}]`) lanzaba `ErrorConflicto`, `intentarCrear` se lo
 * tragaba como `omitidosValidacion` y **`guardarMapeo` nunca corría**. Sin el mapeo
 * `Almacen:IPT`, `etl-ipt` descartaba TODOS los renglones por "almacén sin mapeo" y terminaba
 * "OK" con CERO movimientos (los 6,886 renglones de `IPT_MovsDet` son de los almacenes 1 y 2).
 * "Tránsito" se salvaba de casualidad por el acento (el `mode:'insensitive'` de Postgres es
 * ILIKE: ignora mayúsculas pero NO acentos), dejando además un almacén PT DUPLICADO.
 *
 * El fix: la búsqueda usa la MISMA visibilidad que el dominio (empresa + globales) y compara
 * por nombre NORMALIZADO SIN ACENTOS (el CSV manda: dice "Transito", el seed "Tránsito").
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
import { normalizarParaDedup, parsearBandera, parsearTexto } from '../comun/valores.js';
import type { ResultadoLoader } from './clientes.js';

/** Un almacén candidato ya existente en la BD (para la decisión pura de abajo). */
export interface AlmacenCandidato {
  id: number;
  nombre: string;
  /** `null` = almacén GLOBAL (el que siembra el seed de F3-E1). */
  idEmpresa: number | null;
}

/**
 * Decisión PURA (sin BD, testeable) de a QUÉ almacén existente corresponde un nombre del CSV.
 * Reglas, en orden:
 *  1. Compara por nombre NORMALIZADO sin acentos (`normalizarParaDedup`): el CSV dice
 *     "Transito" y el seed "Tránsito" — para el negocio es el MISMO almacén.
 *  2. Considera los visibles igual que el dominio: los de la empresa **y los GLOBALES**.
 *  3. Si hay varios (el duplicado que dejó el bug: global "Tránsito" + "Transito" de FR Moda),
 *     gana el **GLOBAL** (es el canónico que siembra F3-E1 y contra el que choca el dominio) y
 *     se avisa del duplicado para limpieza manual.
 */
export function elegirAlmacenExistente(
  candidatos: readonly AlmacenCandidato[],
  idEmpresa: number,
  nombre: string,
): { elegido: AlmacenCandidato | null; duplicados: AlmacenCandidato[] } {
  const objetivo = normalizarParaDedup(nombre);
  const visibles = candidatos.filter(
    (c) =>
      (c.idEmpresa === idEmpresa || c.idEmpresa === null) &&
      normalizarParaDedup(c.nombre) === objetivo,
  );
  if (visibles.length === 0) return { elegido: null, duplicados: [] };
  const global = visibles.find((c) => c.idEmpresa === null);
  const elegido = global ?? visibles[0] ?? null;
  return { elegido, duplicados: visibles.filter((c) => c !== elegido) };
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

  // Candidatos EXISTENTES (empresa + globales). Son ~10 filas: se leen de una vez y la decisión
  // se toma en memoria, que además permite comparar SIN ACENTOS (Postgres ILIKE no lo hace).
  const candidatos: AlmacenCandidato[] = await cliente.almacen.findMany({
    where: { OR: [{ idEmpresa }, { idEmpresa: null }] },
    select: { id: true, nombre: true, idEmpresa: true },
  });

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
    const { elegido, duplicados } = elegirAlmacenExistente(candidatos, idEmpresa, nombre);
    let idNuevo: number;
    if (elegido === null) {
      // Tolerante a cualquier error de fila (incluido el choque de nombre PT vs TELA, que el
      // unique (idEmpresa, nombre) rechaza): se reporta y se cuenta como omitido por validación.
      const creado = await intentarCrear(reporte, 'Almacen', idViejo, () =>
        crearAlmacen(sesionEmpresa, { nombre, tipo }, bd),
      );
      if (creado === null) {
        omitidosValidacion += 1;
        // ⚠️ INCIDENCIA DURA (§7): este loader PRODUCE MAPEOS. Un almacén que no se crea NI se
        // mapea deja al kardex sin destino y `etl-ipt` descarta TODOS sus renglones en silencio
        // (fue exactamente el bug del 31-jul-2026). Nunca puede quedar como una línea más.
        reporte.agregar(
          '⛔ ALMACÉN SIN MAPEO — el kardex que lo use quedará VACÍO (revisar YA)',
          `nombre="${nombre}" tipo=${tipo} idViejo=${idViejo ?? '?'} · no se pudo crear ni ` +
            'resolver un existente; sin este mapeo etl-ipt/etl-telas descartan sus movimientos.',
        );
        return;
      }
      idNuevo = creado.id;
      candidatos.push({ id: creado.id, nombre, idEmpresa });
      creados += 1;
    } else {
      idNuevo = elegido.id;
      existentes += 1;
      if (
        normalizarParaDedup(elegido.nombre) === normalizarParaDedup(nombre) &&
        elegido.nombre !== nombre
      ) {
        reporte.agregar(
          'Almacén resuelto por nombre equivalente (acentos/mayúsculas)',
          `CSV="${nombre}" → BD="${elegido.nombre}" (id=${String(elegido.id)}${elegido.idEmpresa === null ? ', GLOBAL del seed' : ''})`,
        );
      }
      for (const dup of duplicados) {
        reporte.agregar(
          'Almacén DUPLICADO en la BD (se mapea al global; limpiar el sobrante a mano)',
          `CSV="${nombre}" → se usa id=${String(idNuevo)}; sobra id=${String(dup.id)} ` +
            `"${dup.nombre}" (idEmpresa=${dup.idEmpresa === null ? 'GLOBAL' : String(dup.idEmpresa)})`,
        );
      }
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

  if (omitidosValidacion > 0) {
    reporte.nota(
      `⛔ ALMACENES: ${String(omitidosValidacion)} sin crear NI mapear. El kardex de PT/telas que ` +
        'los use quedará VACÍO — revisa la sección del reporte ANTES de correr etl-ipt/etl-telas.',
    );
  }
  return { creados, existentes, omitidos, omitidosValidacion };
}
