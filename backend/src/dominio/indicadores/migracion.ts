/**
 * MODO MIGRACIÓN del INVENTARIO CÍCLICO (F7-E6, cierre de fase) — capa de dominio (A1).
 *
 * El servicio normal (`inventario-ciclico.ts`) está afinado para el CONTEO NUEVO contra el kardex de
 * v2 (D3/D6): el ALTA enumera los artículos con existencia ≠ 0 del almacén y CONGELA `cantTeorica`
 * desde la suma de movimientos EN ESE INSTANTE (`existenciaPtBloqueada`); el cierre APLICA el ajuste
 * como MOVIMIENTO de kardex. El histórico, en cambio, viene de un sistema EXTERNO (Proscai, DECISIÓN
 * D6): `Alm_InvCic` guarda, por modelo y fecha, `CantProscai` (el teórico que Proscai reportaba) y
 * `CantReal` (el conteo físico). Ese teórico NO se puede recalcular desde el kardex de v2 (es de otro
 * sistema) y —por D6— NO reconcilia contra v2: es "solo consultable, NO comparable contra el kardex".
 *
 * Por eso el histórico NO puede pasar por `crearInventarioCiclico` (congelaría `cantTeorica` desde la
 * vista `existencia_pt` de v2, PISANDO el `CantProscai` externo, y exigiría color/talla/orden que el
 * viejo no tiene). Se inserta aquí, en modo migración:
 *  • `cantTeorica = CantProscai` (ORIGEN EXTERNO histórico, D6 — NO es la suma del kardex de v2).
 *  • `cantReal = CantReal` (NULL si el viejo no la trae).
 *  • SIN ajuste de kardex (`idMovimientoAjuste = NULL` — D6: no reconcilia contra v2). El motor de
 *    kardex NUNCA se toca: estos registros no generan ni un `Movimiento`.
 *  • Color/Talla SENTINELA `(sin especificar)` inactivos (los mismos de F3-E6/IPT) + `idOrden = NULL`:
 *    el viejo Proscai NO tenía esa dimensión (solo modelo). Ver `loaders/indicadores-ciclico.ts`.
 *  • Almacén SENTINELA `(Migración Proscai)` inactivo: el viejo no dice qué almacén, y por D6 estos
 *    conteos no cuelgan de un almacén real de v2 (no comparables). Ver el loader.
 *  • estado = `cerrado`: el conteo histórico está TERMINADO y es INMUTABLE. Aquí `cerrado` NO
 *    significa "ajuste aplicado" (no lo hay): significa "histórico cerrado, no admite más captura ni
 *    ajuste". Las transiciones del servicio normal (`capturarConteo`/`generarAjusteCiclico`/
 *    `cancelarInventarioCiclico`) RECHAZAN un `cerrado`, así que el histórico queda a salvo de que
 *    alguien intente re-contarlo o generarle un ajuste. La vista de exactitud SÍ lo muestra (D6:
 *    consultable) con exactitud = CantReal − CantProscai y sin liga a movimiento.
 *
 * Sigue siendo: A2 (transacción), A3 (folio por secuencia "inventario-ciclico" por empresa — el
 * histórico consume folios propios, idempotente vía `MapeoMigracion` para no re-consumir), A7
 * (bitácora, `operacion: 'migracion'`), A9 (idEmpresa explícito). NO se expone en ninguna ruta REST.
 * Idempotencia: el loader resuelve "ya existe" por el `MapeoMigracion` de `IdAlm_InvCic` ANTES de
 * llamar (una 2ª corrida no duplica ni consume otro folio).
 */
import { registrarBitacora } from '../../comun/auditoria.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { siguienteFolio } from '../../comun/secuencias.js';
import { enTransaccion, type ContextoBd } from '../../comun/transaccion.js';

/** Clave de la secuencia de folios de los cíclicos (A3, por empresa) — la misma del servicio normal. */
const CLAVE_SECUENCIA_CICLICO = 'inventario-ciclico';

/** Un renglón de inventario cíclico HISTÓRICO Proscai a migrar (snapshot de UN `Alm_InvCic`). */
export interface InventarioCiclicoHistoricoMigrado {
  /** Empresa dueña y de su folio (A9). El loader la fija (empresa favorita — Proscai no la trae). */
  idEmpresa: number;
  /** Almacén SENTINELA `(Migración Proscai)`, inactivo (D6: no es un almacén real de v2). */
  idAlmacen: number;
  /** Modelo resuelto desde `Alm_InvCic.ModeloIC` (texto = código) → `Modelo`. */
  idModelo: number;
  /** Color SENTINELA `(sin especificar)`, inactivo (el viejo no tenía color en el cíclico). */
  idColor: number;
  /** Talla SENTINELA `(sin especificar)`, inactiva (el viejo no tenía talla en el cíclico). */
  idTalla: number;
  /** Teórico EXTERNO de Proscai (`CantProscai`). NO es la suma del kardex de v2 (D6). Entero. */
  cantTeorica: number;
  /** Conteo físico (`CantReal`). NULL si el viejo no lo trae. Entero. */
  cantReal: number | null;
  /** Fecha original del conteo (`Alm_InvCic.FechaIC`), a medianoche UTC (`@db.Date`). */
  fecha: Date;
  /** Observación informativa (traza del origen Proscai). */
  observaciones?: string | null;
}

/** Resultado de migrar un cíclico histórico. */
export interface ResultadoInventarioCiclicoHistorico {
  id: number;
  folio: bigint;
}

/**
 * Crea UN inventario cíclico HISTÓRICO Proscai (encabezado CERRADO + su único renglón), SIN tocar el
 * kardex (D6), en UNA transacción (A2/A3/A7). El renglón se sella como `contado` (fecha/usuario del
 * ETL) cuando trae `cantReal`; su `cantTeorica` es el `CantProscai` externo y `idMovimientoAjuste`
 * queda NULL (no reconcilia contra v2). Idempotencia: el loader verifica el `MapeoMigracion` de
 * `IdAlm_InvCic` ANTES de llamar. Devuelve el id + el folio del cíclico creado.
 */
export async function crearInventarioCiclicoMigrado(
  sesion: SesionUsuario,
  entrada: InventarioCiclicoHistoricoMigrado,
  bd?: ContextoBd,
): Promise<ResultadoInventarioCiclicoHistorico> {
  return enTransaccion(async (tx) => {
    const folio = await siguienteFolio(tx, entrada.idEmpresa, CLAVE_SECUENCIA_CICLICO);
    const contado = entrada.cantReal !== null;
    const inv = await tx.inventarioCiclico.create({
      data: {
        folio,
        idEmpresa: entrada.idEmpresa,
        idAlmacen: entrada.idAlmacen,
        fecha: entrada.fecha,
        // `cerrado` = histórico terminado e inmutable (NO "ajuste aplicado"; ver TSDoc del módulo).
        estado: 'cerrado',
        ...(entrada.observaciones == null ? {} : { observaciones: entrada.observaciones }),
        detalles: {
          create: [
            {
              idModelo: entrada.idModelo,
              idColor: entrada.idColor,
              idTalla: entrada.idTalla,
              idOrden: null,
              // Teórico EXTERNO de Proscai (D6): NO es Σ de movimientos del kardex de v2.
              cantTeorica: entrada.cantTeorica,
              cantReal: entrada.cantReal,
              ...(contado ? { contadoEn: entrada.fecha, contadoPorId: sesion.id } : {}),
              // idMovimientoAjuste NULL: el histórico NO reconcilia contra el kardex de v2 (D6).
              creadoPorId: sesion.id,
              modificadoPorId: sesion.id,
            },
          ],
        },
        creadoPorId: sesion.id,
        modificadoPorId: sesion.id,
      },
      select: { id: true, folio: true },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'InventarioCiclico',
      idEntidad: inv.id,
      accion: 'CREAR',
      datos: {
        operacion: 'migracion',
        origen: 'proscai',
        idEmpresa: entrada.idEmpresa,
        folio: folio.toString(),
        cantTeorica: entrada.cantTeorica,
        cantReal: entrada.cantReal,
      },
    });

    return { id: inv.id, folio: inv.folio };
  }, bd);
}
