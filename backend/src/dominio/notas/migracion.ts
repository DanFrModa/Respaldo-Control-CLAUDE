/**
 * MODO MIGRACIÓN del módulo NOTAS DE SALIDA (F4-E6) — capa de dominio (A1).
 *
 * El servicio normal (`notas-salida.ts`) está afinado para la CAPTURA nueva: folio de la secuencia
 * atómica POR EMPRESA, EXIGE renglones estructurados (XOR avío/tela contra catálogo, con la tela
 * ligada a su salida-a-orden de E1), un almacén ORIGEN válido en el encabezado, y al CONFIRMAR
 * DESCUENTA el kardex de avíos. El ETL del histórico, en cambio, debe PRESERVAR las notas viejas
 * tal cual: folio original (`Notas.NumNota`), maquilero EXPLÍCITO, los renglones como TEXTO LIBRE
 * (`descripcionLegacy` — `NotasDet.Descripcion` NO se parsea a catálogo), y SIN impacto retroactivo
 * a inventario (las notas legacy son DOCUMENTO HISTÓRICO; solo las notas NUEVAS de v2 descuentan
 * kardex — ver `04-Inventarios.md` §"Cómo conecta" y la ficha F4-E6).
 *
 * Para no ENSUCIAR el servicio normal con banderas de migración (E5 y el API REST quedan INTACTOS:
 * estas funciones NO se exponen en ninguna ruta Zod/REST), el modo migración vive en funciones
 * DEDICADAS aquí. Siguen siendo:
 *  • Transaccionales (A2): encabezado + renglones + bitácora en UNA transacción.
 *  • Auditadas (A7): `creadoPorId`/`modificadoPorId` + `Bitacora` (origen ETL).
 *  • Por empresa (A9): el `idEmpresa` se pasa EXPLÍCITO (el histórico abarca varias empresas).
 *
 * Lo que RELAJAN respecto al servicio normal (excepciones históricas, documentadas):
 *  • Folio EXPLÍCITO (preserva `NumNota`), no de la secuencia.
 *  • Renglones de SOLO `descripcionLegacy` (sin avío/tela/lote/movimiento): la data vieja era texto
 *    libre; el XOR avío/tela del servicio normal NO aplica al histórico. `cantidad` = 0 (el viejo
 *    no la desglosaba por renglón estructurado).
 *  • Almacén SENTINELA en el encabezado: el viejo no tenía almacén origen en la nota; se usa un
 *    almacén `(histórico — sin almacén)` INACTIVO (lo asegura el loader), espejo del Color/Talla
 *    sentinela de F3-E6. Mantiene la FK NOT NULL `idAlmacen` sin inventar un almacén real.
 *  • Estatus EXPLÍCITO `confirmada` (es un documento ya emitido en el viejo), PERO **SIN** los
 *    efectos de confirmar: NO se descuenta kardex de avíos NI se sella `confirmadaPorId` con una
 *    operación real — `confirmadaEn`/`confirmadaPorId` se ponen como sello histórico informativo.
 *
 * Lo que CONSERVAN: las FK de la BD (maquilero/almacén/orden existen — el loader las resolvió vía
 * MapeoMigracion/sentinela antes de llamar). Idempotencia: el LOADER resuelve "ya existe" por el
 * unique `(idEmpresa, numNota)`/mapeo ANTES de llamar; aquí solo se crea.
 */
import { EstatusNotaSalida, type Prisma } from '../../datos/index.js';

import { registrarBitacora } from '../../comun/auditoria.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { enTransaccion, type ContextoBd } from '../../comun/transaccion.js';

/** Un renglón LEGACY de nota a migrar (de `NotasDet`): SIEMPRE texto libre, ligado a una orden. */
export interface LineaNotaMigrada {
  /** Orden de producción v2 destino (de `NotasDet.IdOrdenes`, ya resuelta por el loader). */
  idOrden: number;
  /** Texto de `NotasDet.Descripcion` → `descripcionLegacy` (sin catálogo). */
  descripcionLegacy: string;
}

/** Encabezado + renglones de una nota a migrar (snapshot del viejo `Notas`). */
export interface NotaMigrada {
  /** Folio EXPLÍCITO = `Notas.NumNota` (preserva la numeración histórica). */
  numNota: bigint | number;
  idEmpresa: number;
  /** Maquilero (Proveedor) de `Notas.IdMaquileros` (ya resuelto por el loader). */
  idMaquilero: number;
  /** Almacén SENTINELA del encabezado (lo asegura el loader; el viejo no tenía almacén origen). */
  idAlmacen: number;
  /** Fecha de elaboración (de `Notas.FechaElaboracion`). Obligatoria (la columna es NOT NULL). */
  fechaElaboracion: Date;
  /** Fecha de envío (de `Notas.FechaEnvio`). Opcional. */
  fechaEnvio?: Date | null;
  observaciones?: string | null;
  /** Sello histórico de confirmación (informativo; NO hubo descuento real de kardex). */
  confirmadaEn?: Date | null;
  confirmadaPorId?: string | null;
  /** Renglones legacy (texto libre, cada uno ligado a su orden). */
  lineas: LineaNotaMigrada[];
}

/** Resultado de migrar una nota. */
export interface ResultadoNotaMigrada {
  idNotaSalida: number;
  /** # de renglones (NotaSalidaLinea) creados. */
  lineas: number;
}

/**
 * Crea una nota de salida HISTÓRICA con su encabezado y sus renglones legacy (texto libre), en UNA
 * transacción (A2/A7). Estatus `confirmada` (documento ya emitido en el viejo) PERO **SIN** descontar
 * el kardex de avíos NI tocar la tela: las notas legacy son documento histórico (anti-doble-conteo
 * contra el kardex que migra la Pieza B). Idempotencia: el loader resuelve "ya existe" por
 * `(idEmpresa, numNota)`/mapeo ANTES de llamar; aquí solo se crea.
 */
export async function crearNotaMigrada(
  sesion: SesionUsuario,
  entrada: NotaMigrada,
  bd?: ContextoBd,
): Promise<ResultadoNotaMigrada> {
  return enTransaccion(async (tx) => {
    const nota = await tx.notaSalida.create({
      data: {
        numNota: BigInt(entrada.numNota),
        idEmpresa: entrada.idEmpresa,
        idMaquilero: entrada.idMaquilero,
        idAlmacen: entrada.idAlmacen,
        fechaElaboracion: entrada.fechaElaboracion,
        fechaEnvio: entrada.fechaEnvio ?? null,
        observaciones: entrada.observaciones ?? null,
        estatus: EstatusNotaSalida.confirmada,
        confirmadaEn: entrada.confirmadaEn ?? null,
        confirmadaPorId: entrada.confirmadaPorId ?? null,
        creadoPorId: sesion.id,
        modificadoPorId: sesion.id,
      },
    });

    let lineas = 0;
    if (entrada.lineas.length > 0) {
      const datos: Prisma.NotaSalidaLineaCreateManyInput[] = entrada.lineas.map((l) => ({
        idNotaSalida: nota.id,
        idOrden: l.idOrden,
        // Sin material de catálogo (legacy): avío/tela/lote/movimientos NULL; cantidad 0.
        cantidad: 0,
        descripcionLegacy: l.descripcionLegacy,
        creadoPorId: sesion.id,
        modificadoPorId: sesion.id,
      }));
      await tx.notaSalidaLinea.createMany({ data: datos });
      lineas = datos.length;
    }

    await registrarBitacora(tx, sesion, {
      entidad: 'NotaSalida',
      idEntidad: nota.id,
      accion: 'CREAR',
      datos: {
        operacion: 'migracion',
        numNota: Number(entrada.numNota),
        idEmpresa: entrada.idEmpresa,
        idMaquilero: entrada.idMaquilero,
        lineas,
      },
    });

    return { idNotaSalida: nota.id, lineas };
  }, bd);
}
