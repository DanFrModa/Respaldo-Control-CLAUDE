/**
 * ⭐ Fila 0.242 — ayudante de pruebas: le pone a una orden una REFERENCIA de precio de maquila ALTA en
 * cada proceso que ya existe en el catálogo, para que las pruebas que NO tratan del tope puedan seguir
 * mandando a maquila (sin referencia, `registrarEnvioMaquila` rechaza la salida — §Post-F9.253(2)).
 *
 * ⚠️ NO es para probar el tope: la guarda tiene sus pruebas explícitas en
 * `dominio/produccion/referencias-maquila.int.test.ts` (envío rechazado sin referencia, con
 * sobreprecio sin la llave y aceptado con ella). Este ayudante escribe directo en la base, a
 * propósito: no deja rastro (`OrdenReferenciaEvento`) ni bitácora, porque no es un acto de nadie.
 *
 * Cómo: para cada `TipoProceso` existente —
 *  • que NO es arte → una fila `OrdenReferenciaProceso` con `precio`;
 *  • que es arte → un renglón `OrdenArte` de ese tipo con `precio` (su referencia es la suma).
 */
import type { PrismaClient } from '../datos/index.js';

/** Referencia que se siembra por omisión: muy por encima de cualquier precio de las pruebas. */
export const REFERENCIA_ABIERTA = 1000;

export async function abrirReferenciasDeMaquila(
  cliente: PrismaClient,
  idOrden: number,
  precio: number = REFERENCIA_ABIERTA,
  /** Sólo estos procesos (por código). Sin él, todos los del catálogo. */
  codigos?: readonly string[],
): Promise<void> {
  const procesos = await cliente.tipoProceso.findMany({
    ...(codigos === undefined ? {} : { where: { codigo: { in: [...codigos] } } }),
    select: { id: true, nombre: true, esArte: true },
  });
  const noArte = procesos.filter((p) => !p.esArte);
  const arte = procesos.filter((p) => p.esArte);
  if (noArte.length > 0) {
    await cliente.ordenReferenciaProceso.createMany({
      data: noArte.map((p) => ({
        idOrden,
        idTipoProceso: p.id,
        precio,
        origen: 'manual' as const,
      })),
      skipDuplicates: true,
    });
  }
  if (arte.length > 0) {
    await cliente.ordenArte.createMany({
      data: arte.map((p) => ({
        idOrden,
        idTipoArte: p.id,
        descripcion: `Referencia de prueba de ${p.nombre}`,
        precio,
        agregadoAMano: true,
      })),
    });
  }
}
