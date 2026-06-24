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
import {
  registrarMovimientoPt,
  registrarMovimientoTela,
  registrarTraspasoTela,
  type LineaMovimientoPt,
  type LineaMovimientoTela,
} from '../../comun/kardex.js';
import { ORIGEN } from '../../comun/origenes.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { enTransaccion, type ContextoBd, type Tx } from '../../comun/transaccion.js';

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

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// MODO MIGRACIÓN del INVENTARIO de TELAS (kardex histórico — F4-E6, Pieza B)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// Migra el histórico de TELAS (Entradas/Salidas/EntradasDet/SalidasDet del viejo) al kardex de v2
// (D3), vía el motor de kardex de tela (`comun/kardex.ts`, A1: el ÚNICO que escribe). Espejo del
// modo-migración de PT (arriba) pero para la dimensión tela×lote×almacén (D5). Igual que en PT:
//  • Transaccional (A2) / folio atómico (A3) / auditado (A7) — lo da el motor.
//  • `origenTipo = ORIGEN.migracion`, `origenId` = clave vieja (idempotencia + trazabilidad).
//  • Fecha y tipo de movimiento EXPLÍCITOS (el histórico preserva la fecha de `Entradas`/`Salidas`).
//  • NO valida existencia no-negativo (es histórico: un descuadre del viejo se preserva y se LISTA
//    en el cuadre, JAMÁS se corrige en silencio — §7).
//
// MODELO de los DOS COMPONENTES (ExTela1/ExTela2, decisión documentada en el reporte F4-E6):
//  el viejo guardaba dos sub-existencias por tela×color×almacén (`TelaEnt1`/`TelaEnt2`, las dos
//  partes físicas de la MISMA tela — p. ej. Felpa + Cardigan). v2 UNIFICÓ Telas+TelasDis en UNA
//  `Tela` con un `tipoComponente` (ADR-0009/D5): NO hay dos telas por renglón. Por eso el loader
//  suma `TelaEnt1+TelaEnt2` en UNA cantidad de la tela parent y preserva el desglose en las
//  observaciones del lote/movimiento. El motor recibe ya esa cantidad sumada (este helper no decide
//  el desglose: solo escribe la línea tela×lote que el loader le arma).

/** Una línea de tela ya resuelta por el loader (ids del catálogo + lote + cantidad sumada). */
export interface LineaTelaMigrada {
  idTela: number;
  /** Lote legacy sintetizado (define el color/teñido, D5). */
  idLote: number;
  /** Cantidad de tela (= `TelaEnt1+TelaEnt2` / `TelaSal1+TelaSal2`), POSITIVA. */
  cantidad: number;
  /** Costo unitario del movimiento de ENTRADA legacy (de `TelasColores.Precio`); NULL en salidas (D1). */
  costoUnit?: number | null;
}

/** Un movimiento de TELA histórico (entrada de compra o salida a orden) a migrar. */
export interface MovimientoTelaMigrado {
  idEmpresa: number;
  /** Tipo de movimiento del catálogo (define la dirección: entrada/salida). */
  idTipoMov: number;
  idAlmacen: number;
  fecha: Date;
  /** Clave vieja estable (idempotencia/trazabilidad). */
  origenId: string;
  /** Origen del hecho: `migracion` (default) o `salida-tela-orden` para salidas ligadas a orden. */
  origenTipo?: typeof ORIGEN.migracion | typeof ORIGEN.salidaTelaOrden;
  lineas: LineaTelaMigrada[];
  observaciones?: string;
}

/**
 * Crea UN movimiento de kardex de TELA HISTÓRICO (una entrada de compra legacy o una salida a
 * orden), con su fecha/tipo ORIGINALES, en UNA transacción (A2/A3/A7) vía el motor. NO valida
 * existencia (histórico). Idempotencia: el loader verifica que el `origenId` no exista ANTES de
 * llamar. Devuelve el id del `Movimiento` creado.
 */
export async function crearMovimientoTelaMigrado(
  sesion: SesionUsuario,
  entrada: MovimientoTelaMigrado,
  bd?: ContextoBd,
): Promise<number> {
  const lineas: LineaMovimientoTela[] = entrada.lineas.map((l) => ({
    idTela: l.idTela,
    idLote: l.idLote,
    cantidad: l.cantidad,
    costoUnit: l.costoUnit ?? null,
  }));
  const movimiento = await registrarMovimientoTela(
    sesion,
    {
      idEmpresa: entrada.idEmpresa,
      idTipoMov: entrada.idTipoMov,
      idAlmacen: entrada.idAlmacen,
      fecha: entrada.fecha,
      origenTipo: entrada.origenTipo ?? ORIGEN.migracion,
      origenId: entrada.origenId,
      lineas,
      ...(entrada.observaciones === undefined ? {} : { observaciones: entrada.observaciones }),
    },
    bd,
  );
  return movimiento.id;
}

/** Un PAR de traspaso de tela histórico (salida del origen + entrada al destino) a migrar. */
export interface TraspasoTelaMigrado {
  idEmpresa: number;
  /** Tipo de la pata de SALIDA (dirección `salida`, p. ej. `transferencia-salida`). */
  idTipoMovSalida: number;
  /** Tipo de la pata de ENTRADA (dirección `entrada`, p. ej. `transferencia-entrada`). */
  idTipoMovEntrada: number;
  idAlmacenOrigen: number;
  idAlmacenDestino: number;
  fecha: Date;
  /** Clave vieja estable de la SALIDA (idempotencia de la pata de salida). */
  origenIdSalida: string;
  /** Clave vieja estable de la ENTRADA (idempotencia de la pata de entrada). */
  origenIdEntrada: string;
  /** Renglones (tela×lote×cantidad) — los mismos en ambas patas (el viejo movía igual cantidad). */
  lineas: LineaTelaMigrada[];
  observaciones?: string;
}

/**
 * Migra UN par de traspaso de TELA legacy como DOS patas (salida del origen + entrada al destino)
 * en LA MISMA transacción (A2), vía el motor (`registrarTraspasoTela`). Espejo del traspaso normal
 * de telas pero con fecha/origen históricos: NO valida existencia (histórico) y sella cada pata con
 * su `origenId` legacy para idempotencia (el loader verifica AMBOS antes de llamar). El `origenTipo`
 * de las patas lo pone el motor (`traspaso`); el loader marca el mapeo legacy aparte. Devuelve los
 * ids de las dos patas creadas.
 */
export async function crearTraspasoTelaMigrado(
  sesion: SesionUsuario,
  entrada: TraspasoTelaMigrado,
  bd?: ContextoBd,
): Promise<{ idSalida: number; idEntrada: number }> {
  const lineas: LineaMovimientoTela[] = entrada.lineas.map((l) => ({
    idTela: l.idTela,
    idLote: l.idLote,
    cantidad: l.cantidad,
    // El traspaso no revalúa: el costo viaja en la entrada de compra, no en el movimiento interno.
    costoUnit: null,
  }));
  const { salida, entrada: entradaMov } = await registrarTraspasoTela(
    sesion,
    {
      idEmpresa: entrada.idEmpresa,
      idTipoMovSalida: entrada.idTipoMovSalida,
      idTipoMovEntrada: entrada.idTipoMovEntrada,
      idAlmacenOrigen: entrada.idAlmacenOrigen,
      idAlmacenDestino: entrada.idAlmacenDestino,
      fecha: entrada.fecha,
      lineas,
      ...(entrada.observaciones === undefined ? {} : { observaciones: entrada.observaciones }),
    },
    bd,
  );
  return { idSalida: salida.id, idEntrada: entradaMov.id };
}

/**
 * Crea (idempotente) el LOTE legacy de un color de tela (D5) — el lote sintetizado que agrupa la
 * existencia histórica de esa tela×color (decisión (f) de Daniel). En el viejo NO había lotes: la
 * existencia era por tela×color×almacén (`TelasColAlm`). Para que v2 (existencia por tela×lote×
 * almacén) cuadre con el viejo, se sintetiza UN lote por color (clave determinista pasada por el
 * loader), reusado por TODAS las entradas/salidas de ese color. La PRIMERA entrada lo materializa
 * (factura/proveedor/fecha de esa entrada); las siguientes lo reusan. El componente del lote es la
 * tela parent (v2 unificó los dos componentes en una sola Tela, ADR-0009).
 *
 * Se hace por acceso DIRECTO a la tabla (no por el dominio de telas, que crea lotes en un ajuste
 * con su propia clave aleatoria): el lote legacy es un artefacto de la migración con clave estable.
 * Idempotente por `Lote.clave` (@unique): si ya existe, devuelve su id sin tocar nada.
 */
export async function asegurarLoteLegacyTela(
  tx: Tx,
  sesion: SesionUsuario,
  datos: {
    clave: string;
    idColor: number;
    idTela: number;
    cantidadComponente: number;
    idProveedor?: number;
    factura?: string;
    fecha?: Date;
    observaciones?: string;
  },
): Promise<number> {
  const existe = await tx.lote.findUnique({ where: { clave: datos.clave }, select: { id: true } });
  if (existe !== null) return existe.id;
  const creado = await tx.lote.create({
    data: {
      clave: datos.clave,
      idColor: datos.idColor,
      ...(datos.idProveedor === undefined ? {} : { idProveedor: datos.idProveedor }),
      ...(datos.factura === undefined ? {} : { factura: datos.factura }),
      ...(datos.fecha === undefined ? {} : { fecha: datos.fecha }),
      ...(datos.observaciones === undefined ? {} : { observaciones: datos.observaciones }),
      componentes: {
        create: [{ idTela: datos.idTela, cantidad: datos.cantidadComponente }],
      },
      creadoPorId: sesion.id,
      modificadoPorId: sesion.id,
    },
    select: { id: true },
  });
  return creado.id;
}

/** Re-export para que el loader pueda abrir/componer la transacción del lote legacy. */
export { enTransaccion };
