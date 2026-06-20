/**
 * MODO MIGRACIÓN del INVENTARIO PT (kardex histórico — F3-E6, Pieza B) — capa de dominio (A1).
 *
 * El servicio normal de inventario (`movimientos-pt.ts`) está afinado para la CAPTURA nueva: exige
 * `inventario-pt.mover`, valida la matriz color×talla con tallas/colores ACTIVOS del catálogo, sella
 * la fecha con la del formulario, valida no-negativo en salidas, etc. El ETL del histórico, en
 * cambio, debe PRESERVAR el inventario viejo tal cual: la fecha ORIGINAL de cada `IPT_Movs`, su tipo
 * de movimiento (incluso "Inventario Inicial", que el día a día NO captura), y —decisión (c) de
 * `DECISIONES.md` bloque F3-E6— SIN desglose de color/talla (el viejo NO los tenía en IPT): cada
 * movimiento entra con un Color y una Talla SENTINELA `(sin especificar)`, inactivos, que NO
 * aparecen en los selectores de captura.
 *
 * Para no ENSUCIAR el servicio normal con banderas de migración (E2–E5 y el API REST quedan
 * INTACTOS: estas funciones NO se exponen en ninguna ruta Zod/REST), el modo migración vive en una
 * función DEDICADA aquí. Sigue siendo:
 *  • Transaccional (A2): el movimiento (encabezado + detalle + bitácora) en UNA transacción — lo
 *    garantiza el motor de kardex (`comun/kardex.ts`), el ÚNICO que escribe `Movimiento`/`*Det`.
 *  • Atómico en folio (A3): folio por secuencia "movimiento" POR EMPRESA, NUNCA Max()+1 (lo da el
 *    motor).
 *  • Auditado (A7): `creadoPorId`/`modificadoPorId` + `Bitacora` del movimiento (lo hace el motor).
 *  • Por empresa (A9): el `idEmpresa` se pasa EXPLÍCITO (el histórico abarca empresas 7 y 8 — el
 *    loader lo deriva de la empresa del MODELO viejo, `IPT_Modelos.IdEmpresas`).
 *  • D3 — la existencia NUNCA se materializa: cada `IPT_Movs` es un movimiento (entrada o salida
 *    según `EnSa`); la existencia de v2 es la SUMA de esos movimientos. NO se migra
 *    `IPT_Mod_Alm.Existencia` (el saldo editable del viejo, que D3 erradica): solo se usa en el
 *    cuadre para CONTRASTAR (cuadre-f3) y LISTAR los descuadres, jamás como dato.
 *  • D1/D2 — `costoUnit` queda NULL en toda F3 (el motor ni lo recibe).
 *
 * Lo que RELAJA respecto al servicio normal (excepciones históricas, documentadas):
 *  • `origenTipo = ORIGEN.migracion` (no `movimientoManual`): así el cuadre verifica el NO doble
 *    conteo (todo movimiento de kardex de F3 viene de esta migración, ni uno de un recibo/cargo).
 *  • `origenId` = clave vieja `IPT_MovsDet.IdIPT_MovsDet` (idempotencia + trazabilidad fila→fila).
 *  • Fecha EXPLÍCITA de `IPT_Movs.Fecha` (NO now()).
 *  • Tipo de movimiento EXPLÍCITO por id (incluso direcciones que el día a día no captura).
 *  • Color/Talla SENTINELA inactivos (el viejo no tenía esa dimensión en IPT — decisión (c)).
 *  • NO valida existencia no-negativa: el histórico se carga tal cual lo dejó el viejo (un inicial
 *    de saldo negativo o un descuadre del viejo se preserva y se LISTA en el cuadre, no se corrige).
 *
 * La integridad referencial (modelo/almacén/color/talla del catálogo, tipo de movimiento) la
 * garantizan las FK de la BD y el loader, que YA resolvió los ids vía `MapeoMigracion`/seed.
 */
import { registrarMovimientoPt, type LineaMovimientoPt } from '../../comun/kardex.js';
import { ORIGEN } from '../../comun/origenes.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import type { ContextoBd } from '../../comun/transaccion.js';

/**
 * Un movimiento de IPT histórico a migrar (snapshot de UN `IPT_MovsDet` ligado a su `IPT_Movs`),
 * con los ids YA resueltos por el loader (modelo×almacén vía `IPT_Mod_Alm`, tipo de movimiento del
 * catálogo, color/talla sentinela). La `cantidad` es SIEMPRE positiva (el signo lo da la dirección
 * del tipo de movimiento — entrada suma, salida resta).
 */
export interface MovimientoIptMigrado {
  /** Empresa dueña del movimiento y de su folio (A9) — derivada de la empresa del modelo viejo. */
  idEmpresa: number;
  /** Tipo de movimiento del catálogo `TipoMovimientoInventario` (define la dirección). */
  idTipoMov: number;
  /** Almacén afectado (resuelto del mapeo `Almacen:IPT`). */
  idAlmacen: number;
  /** Modelo (resuelto de `IPT_Modelos.NumMod` → `Modelo`). */
  idModelo: number;
  /** Color SENTINELA `(sin especificar)`, inactivo — decisión (c). */
  idColorSentinela: number;
  /** Talla SENTINELA `(sin especificar)`, inactiva — decisión (c). */
  idTallaSentinela: number;
  /** Cantidad de prendas, entera y POSITIVA. */
  cantidad: number;
  /** Fecha ORIGINAL del movimiento (`IPT_Movs.Fecha`). */
  fecha: Date;
  /** Clave vieja `IPT_MovsDet.IdIPT_MovsDet` (idempotencia/trazabilidad). */
  origenId: string;
  /** Observación informativa (`IPT_Movs.ObsMovs`/`Referencia`/`IdRecibos`). */
  observaciones?: string;
}

/**
 * Crea UN movimiento de kardex PT HISTÓRICO (un `IPT_MovsDet`), con color/talla SENTINELA, su fecha
 * y tipo ORIGINALES, en UNA transacción (A2/A3/A7) vía el motor de kardex. NO valida existencia ni
 * pendientes (es histórico). Idempotencia: el loader verifica que el `origenId` no exista ANTES de
 * llamar (suma directa de `MovimientoDetPt`), así una 2ª corrida no duplica. Devuelve el id del
 * `Movimiento` creado.
 */
export async function crearMovimientoIptMigrado(
  sesion: SesionUsuario,
  entrada: MovimientoIptMigrado,
  bd?: ContextoBd,
): Promise<number> {
  const linea: LineaMovimientoPt = {
    idModelo: entrada.idModelo,
    idColor: entrada.idColorSentinela,
    idTalla: entrada.idTallaSentinela,
    cantidad: entrada.cantidad,
  };
  const movimiento = await registrarMovimientoPt(
    sesion,
    {
      idEmpresa: entrada.idEmpresa,
      idTipoMov: entrada.idTipoMov,
      idAlmacen: entrada.idAlmacen,
      fecha: entrada.fecha,
      origenTipo: ORIGEN.migracion,
      origenId: entrada.origenId,
      lineas: [linea],
      ...(entrada.observaciones === undefined ? {} : { observaciones: entrada.observaciones }),
    },
    bd,
  );
  return movimiento.id;
}
