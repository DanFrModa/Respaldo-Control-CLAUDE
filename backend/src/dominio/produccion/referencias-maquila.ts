/**
 * ⭐ EL TOPE DEL PRECIO DE MAQUILA — fila 0.242 (`DECISIONES.md` §Post-F9.250(d) → §Post-F9.255).
 *
 * DANIEL: *«el precio de maquila sí lo debe capturar producción… Lo que hay que hacer es **validar que
 * no pueda ponerlo más caro que el que está en la cotización a menos que se le autorice. Yo
 * autorizo**»*. Y al cerrarlo (§Post-F9.255, «Ok. La B»): la referencia la captura también producción,
 * y lo que él autoriza es sólo **pasarse del 5 %**.
 *
 * ## La referencia: UNA POR PROCESO
 *
 *  • Procesos que **NO son arte** (`TipoProceso.esArte = false`; hoy, costura): una fila
 *    `OrdenReferenciaProceso` (orden × proceso). Nace PRE-LLENADA del concepto `maquila` del precosto
 *    vigente al ligar la orden a su desarrollo ({@link prellenarReferenciaDeCostura}), o se captura a
 *    mano ({@link capturarReferenciaMaquila}).
 *  • Procesos de **ARTE** (estampado, bordado, aplicación, lavado y los que se den de alta): la SUMA de
 *    los `OrdenArte.precio` de ese tipo que la orden NO excluyó (§Post-F9.254). Dos estampados ⇒ la
 *    suma de los dos, y **si a cualquiera le falta precio el proceso no tiene referencia**
 *    ({@link sumarReferenciaDeArte}).
 *
 * ## Las tres reglas
 *
 *  1. **Sin referencia no sale el envío** del proceso (`registrarEnvioMaquila`,
 *     {@link exigirReferenciaParaEnvio}). Para todos, sin excepción: es la regla de Daniel
 *     (*«es indispensable tener el precio de referencia para poder generar la salida a maquila»*).
 *  2. **El tope:** se rechaza `precio > referencia × 1.05` ({@link FACTOR_TOPE_SOBREPRECIO}, el
 *     ÚNICO sitio donde vive el 5 %). Sin freno hacia abajo. Se compara en `Prisma.Decimal`.
 *  3. **La excepción:** con `ordenes.autorizar-sobreprecio` (reservado, `SOLO_ADMINISTRADOR`) el
 *     precio pasa, y queda en la bitácora **y** en `OrdenReferenciaEvento` (`accion: sobreprecio`),
 *     para que la consulta de Daniel enseñe las veces que se autorizó pasarse
 *     ({@link exigirPrecioDentroDelTope}).
 *
 * ## Dónde se topa (todos los puntos donde se fija lo que se le paga a un taller)
 *
 * El precio se compara REDONDEADO como se guarda ({@link precioComoSeGuarda}); los esquemas además
 * rechazan más de dos decimales.
 *
 * | Punto | Contra qué |
 * |---|---|
 * | `Orden.maquilaOrd` (precios-orden) | la referencia de costura (sin ella, no se captura) |
 * | `Orden.aplicacionOrd` (precios-orden) | la suma de TODOS los artes no excluidos (el campo es uno solo) |
 * | `precioPactado` del ENVÍO | la del proceso del envío (sin ella, no sale) |
 * | `precioPactado` escrito a mano en el RECIBO | la del proceso, si existe ({@link referenciaSiExiste}); el heredado del envío no se re-topa |
 * | `precioReal` al VALIDAR el cargo EsMa | **SIEMPRE** la VIGENTE del proceso del cargo, si existe — sea igual o no al propuesto ({@link sobreprecioYaAutorizado} acepta una autorización previa por ese mismo precio) |
 *
 * **Lo que NO se topa, a propósito:**
 *  • **Corte y empaque**: son SERVICIOS sobre la orden (`servicio`), no un `TipoProceso`; no hay
 *    referencia de maquila contra la cual compararlos (Daniel habló de maquila y estampado).
 *  • **El ETL y el modo migración** (`produccion/migracion.ts::crearEtapaMigrada`/`crearEnvioMigrado`,
 *    `esma/migracion.ts::crearCargoEsMaMigrado`): cargan el histórico de Access, que no tiene
 *    referencias (REGLA 0-B: se tolera, no se compensa). No pasan por estas puertas.
 *
 * ⚠️ **`aplicacionOrd` es UN precio para todos los artes** y el cargo propuesto lo usa para CADA
 * proceso que no es costura (`esma/cargo-propuesto.ts`, su regla de dinero se queda). Toparlo contra
 * la suma deja que, con estampado $5 y bordado $8, el cargo del estampado se PROPONGA a $13. **La red
 * que lo frena es la validación del cargo**, que topa SIEMPRE por proceso (el reviewer de la 0.242
 * midió que, cuando se saltaba el tope al validar el propuesto, ese $13 se pagaba sin llave ni rastro).
 *
 * ## El rastro
 *
 * Todo cambio de una referencia —pre-llenado, captura a mano, un precio de arte movido por la receta o
 * por el panel— deja un `OrdenReferenciaEvento` inmutable (D3/A7) con anterior → nuevo, quién y
 * cuándo. Lo lee la consulta {@link listarCambiosDeReferencias} (`ordenes.autorizar-sobreprecio`).
 *
 * Innegociables: A1 (la regla vive aquí), A2 (todo dentro de la transacción del acto), A4 (llaves),
 * A7 (bitácora + evento), A9 (empresa activa), D3 (el rastro sólo se inserta).
 */
import {
  esquemaReferenciaMaquilaPatchCuerpo,
  esquemaReferenciasCambiosFiltros,
  type DatosReferenciaMaquilaPatch,
  type ReferenciaProcesoSalida,
  type ReferenciasCambiosLista,
  type ReferenciasCambiosFiltros,
  type ReferenciasOrdenSalida,
} from '../../contrato/index.js';
import { Prisma, type PuntoPrecioMaquila } from '../../datos/index.js';

import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import {
  inicioDelDiaDelNegocio,
  inicioDelDiaSiguienteDelNegocio,
} from '../../comun/fecha-negocio.js';
import { nombreDeUsuario, nombresDeUsuarios } from '../../comun/nombres-usuario.js';
import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import {
  clienteLectura,
  enTransaccion,
  type ClienteLectura,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

import { CONCEPTO_MAQUILA } from '../desarrollo/conceptos-precosto.js';
import { CODIGO_PROCESO_COSTURA } from '../esma/cargo-propuesto.js';
import { puedeVerReferenciasDeMaquila } from '../modelos/precios-de-modelo.js';
import { exigirOrdenAbiertaPorId } from './cierre-orden.js';

// ── La regla, pura ───────────────────────────────────────────────────────────────────────────

/**
 * ⭐ EL 5 %, EN UN SOLO SITIO (§Post-F9.253(1): *«pongamos 5 % de margen hacia arriba»*). Se rechaza
 * `precio > referencia × FACTOR_TOPE_SOBREPRECIO`; hacia abajo no hay freno.
 */
export const FACTOR_TOPE_SOBREPRECIO = new Prisma.Decimal('1.05');

/** La llave reservada que deja pasarse del tope (y ver la consulta de cambios). */
export const PERMISO_SOBREPRECIO = 'ordenes.autorizar-sobreprecio' as const;

/** Un monto que se puede comparar en Decimal. */
export type ValorDecimal = Prisma.Decimal | number | string;

/**
 * El tope que se ENSEÑA: el precio MÁS ALTO en centavos que no excede `referencia × 1.05` (se trunca
 * hacia abajo: con referencia $33.33 el producto es 34.9965, y enseñar «$35.00» sería prometer un
 * precio que {@link excedeTope} rechaza). En la comparación de {@link excedeTope} el PRECIO sí se
 * redondea como se guarda ({@link precioComoSeGuarda}); lo que queda SIN redondear es
 * `referencia × 1.05` — este truncado es sólo para enseñarlo.
 */
export function topeDeReferencia(referencia: Prisma.Decimal): Prisma.Decimal {
  return referencia.mul(FACTOR_TOPE_SOBREPRECIO).toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
}

/**
 * El precio TAL COMO SE GUARDA: las columnas de precio son `Decimal(12,2)` y Postgres redondea
 * `ROUND_HALF_UP` al guardar. El tope se compara contra ESTE valor, no contra lo tecleado.
 */
export function precioComoSeGuarda(precio: ValorDecimal): Prisma.Decimal {
  return new Prisma.Decimal(precio).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * ¿El precio pasa del tope de la referencia? (`precio > referencia × 1.05`, en Decimal).
 *
 * ⚠️ Se compara el precio REDONDEADO como se guardaría ({@link precioComoSeGuarda}), no el tecleado:
 * con referencia $33.33 (tope 34.9965), un 34.996 sin redondear «no excede» y se guardaba como
 * $35.00 — por encima del tope (lo midió el reviewer de la 0.242). Los esquemas ya rechazan más de dos
 * decimales; esto es la defensa del dominio para quien lo llame sin pasar por ellos.
 */
export function excedeTope(precio: ValorDecimal, referencia: Prisma.Decimal): boolean {
  return precioComoSeGuarda(precio).gt(referencia.mul(FACTOR_TOPE_SOBREPRECIO));
}

/** Por qué un proceso NO tiene referencia. */
export type FaltaReferencia = 'sin-referencia' | 'arte-sin-renglones' | 'arte-sin-precio';

/** La referencia de un proceso, o por qué falta. */
export type ResultadoReferencia =
  | { referencia: Prisma.Decimal; falta: null }
  | { referencia: null; falta: FaltaReferencia };

/**
 * La referencia de un proceso de ARTE a partir de sus renglones VIVOS (no excluidos): la SUMA de sus
 * precios. Sin renglones ⇒ el proceso no está en la orden; con uno sin precio ⇒ la referencia no se
 * puede saber (sumar los demás la dejaría por debajo de lo cotizado y el tope mentiría hacia abajo).
 */
export function sumarReferenciaDeArte(
  renglones: readonly { precio: Prisma.Decimal | null }[],
): ResultadoReferencia {
  if (renglones.length === 0) return { referencia: null, falta: 'arte-sin-renglones' };
  let suma = new Prisma.Decimal(0);
  for (const r of renglones) {
    if (r.precio === null) return { referencia: null, falta: 'arte-sin-precio' };
    suma = suma.add(r.precio);
  }
  return { referencia: suma, falta: null };
}

// ── Concurrencia ─────────────────────────────────────────────────────────────────────────────

/**
 * Bloqueo de los PRECIOS de una orden dentro de la transacción: advisory lock transaccional por
 * empresa+orden con NAMESPACE PROPIO (0x50 = 'P' de Precios; las etapas usan 0x4F). Lo toman la
 * captura de precios de la orden, la de referencias, el envío y el recibo (después del de etapas), la
 * validación del cargo EsMa y toda mutación de la receta (después del de su versión). **Siempre es el
 * ÚLTIMO candado que se toma**, así que no forma ciclos con ningún otro. Serializa los dos lados del
 * tope: nadie mueve la referencia mientras otro compara un precio contra ella, y el encadenado
 * anterior→nuevo del rastro es real (D3/A7).
 */
export async function bloquearPreciosDeOrden(
  tx: Tx,
  idEmpresa: number,
  idOrden: number,
): Promise<void> {
  const clave1 = ((idEmpresa * 1_000_003) ^ 0x50000000) | 0;
  const clave2 = idOrden | 0;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${clave1}::int, ${clave2}::int)`;
}

// ── Lectura de la referencia ─────────────────────────────────────────────────────────────────

/** Lo mínimo de un tipo de proceso para resolver su referencia. */
export interface ProcesoParaReferencia {
  id: number;
  nombre: string;
  esArte: boolean;
}

/** La referencia del proceso en la orden (ver el encabezado del módulo). */
export async function resolverReferencia(
  cliente: ClienteLectura,
  idOrden: number,
  proceso: ProcesoParaReferencia,
): Promise<ResultadoReferencia> {
  if (proceso.esArte) {
    const renglones = await cliente.ordenArte.findMany({
      where: { idOrden, idTipoArte: proceso.id, excluido: false },
      select: { precio: true },
    });
    return sumarReferenciaDeArte(renglones);
  }
  const fila = await cliente.ordenReferenciaProceso.findUnique({
    where: { idOrden_idTipoProceso: { idOrden, idTipoProceso: proceso.id } },
    select: { precio: true },
  });
  return fila === null
    ? { referencia: null, falta: 'sin-referencia' }
    : { referencia: fila.precio, falta: null };
}

/**
 * La referencia de `Orden.aplicacionOrd`: la suma de TODOS los artes vivos de la orden, de cualquier
 * tipo (el campo es uno solo para todos los procesos que no son costura — ver el hueco del encabezado).
 */
export async function referenciaDeTodosLosArtes(
  cliente: ClienteLectura,
  idOrden: number,
): Promise<ResultadoReferencia> {
  const renglones = await cliente.ordenArte.findMany({
    where: { idOrden, excluido: false },
    select: { precio: true },
  });
  return sumarReferenciaDeArte(renglones);
}

/** El tipo de proceso de COSTURA (por su código canónico), o null si el catálogo no lo tiene. */
export async function procesoDeCostura(
  cliente: ClienteLectura,
): Promise<ProcesoParaReferencia | null> {
  return cliente.tipoProceso.findUnique({
    where: { codigo: CODIGO_PROCESO_COSTURA },
    select: { id: true, nombre: true, esArte: true },
  });
}

/** `$1,234.50` para los mensajes. */
function pesos(valor: ValorDecimal): string {
  return `$${new Prisma.Decimal(valor).toFixed(2)}`;
}

// ── Las guardas ──────────────────────────────────────────────────────────────────────────────

/** El mensaje de una referencia que falta, dicho para quien tiene que resolverlo. */
function mensajeFaltaReferencia(
  falta: FaltaReferencia,
  nombreProceso: string,
  queSeIntenta: string,
): string {
  switch (falta) {
    case 'sin-referencia':
      return (
        `La orden no tiene precio de referencia de «${nombreProceso}»: sin él ${queSeIntenta}. ` +
        'Captúralo en el panel de precios de la orden (Referencias).'
      );
    case 'arte-sin-renglones':
      return (
        `La orden no lleva ningún arte de «${nombreProceso}» en su receta: sin él no hay precio de ` +
        `referencia y ${queSeIntenta}. Antes hay que definir que la OP lleva «${nombreProceso}»: ` +
        `Desarrollo tiene que agregar ese arte (con su precio) a la receta de la orden.`
      );
    case 'arte-sin-precio':
      return (
        `Uno o más artes de «${nombreProceso}» de la orden no tienen precio: sin él no hay precio de ` +
        `referencia y ${queSeIntenta}. Captúralo en el panel de precios de la orden (Referencias).`
      );
  }
}

/**
 * ⭐ REGLA 1 — **sin referencia no sale el envío** (§Post-F9.253(2)). Devuelve la referencia para que
 * el llamador tope el precio pactado. Sin excepción por permiso: la llave reservada autoriza pasarse
 * del tope, no salir sin precio de referencia.
 */
export async function exigirReferenciaParaEnvio(
  tx: Tx,
  idOrden: number,
  proceso: ProcesoParaReferencia,
): Promise<Prisma.Decimal> {
  const resultado = await resolverReferencia(tx, idOrden, proceso);
  if (resultado.referencia === null) {
    throw new ErrorConflicto(
      mensajeFaltaReferencia(resultado.falta, proceso.nombre, 'no puede salir a maquila'),
    );
  }
  return resultado.referencia;
}

/** Lo que necesita la guarda del tope. */
export interface PrecioATopar {
  idOrden: number;
  /** Proceso del precio; `null` = todos los de arte a la vez (`Orden.aplicacionOrd`). */
  idTipoProceso: number | null;
  /** Cómo se llama lo topado en los mensajes («Costura», «los artes de la orden»). */
  nombre: string;
  precio: ValorDecimal;
  referencia: Prisma.Decimal;
  punto: PuntoPrecioMaquila;
}

/**
 * ⭐ REGLAS 2 Y 3 — el tope y su excepción. Si el precio no pasa del tope, no hace nada. Si pasa:
 *  • sin `ordenes.autorizar-sobreprecio` → `ErrorConflicto` (con los montos sólo si la sesión ve
 *    referencias; si no, sin cifras — la 0.249: un monto en una frase llega igual que en un campo);
 *  • con ella → PASA, y deja el sobreprecio en `OrdenReferenciaEvento` y en la bitácora, dentro de la
 *    transacción del acto (si el acto hace rollback, el rastro tampoco existe).
 *
 * Devuelve `true` cuando se autorizó un sobreprecio.
 */
export async function exigirPrecioDentroDelTope(
  tx: Tx,
  sesion: SesionUsuario,
  datos: PrecioATopar,
): Promise<boolean> {
  if (!excedeTope(datos.precio, datos.referencia)) return false;

  const tope = topeDeReferencia(datos.referencia);
  if (!tienePermiso(sesion, PERMISO_SOBREPRECIO)) {
    const cifras = puedeVerReferenciasDeMaquila(sesion)
      ? ` (${pesos(datos.precio)} contra un tope de ${pesos(tope)}: referencia ` +
        `${pesos(datos.referencia)} + 5 %)`
      : '';
    throw new ErrorConflicto(
      `El precio rebasa el tope autorizado de «${datos.nombre}»${cifras}. Pasarse de la ` +
        'referencia más 5 % lo autoriza sólo quien lleva «autorizar sobreprecio» (Daniel): pídele ' +
        'que lo capture él, o ajusta el precio.',
    );
  }

  const precio = precioComoSeGuarda(datos.precio);
  await tx.ordenReferenciaEvento.create({
    data: {
      idOrden: datos.idOrden,
      idTipoProceso: datos.idTipoProceso,
      accion: 'sobreprecio',
      referenciaNueva: datos.referencia,
      precioAutorizado: precio,
      punto: datos.punto,
      capturadoPorId: sesion.id,
    },
  });
  await registrarBitacora(tx, sesion, {
    entidad: 'Orden',
    idEntidad: datos.idOrden,
    accion: 'MODIFICAR',
    datos: {
      operacion: 'sobreprecio-autorizado',
      punto: datos.punto,
      idTipoProceso: datos.idTipoProceso,
      referencia: datos.referencia.toNumber(),
      tope: tope.toNumber(),
      precioAutorizado: precio.toNumber(),
    },
  });
  return true;
}

/**
 * La referencia de un precio que puede NO tenerla (recibo escrito a mano, validación del cargo EsMa):
 * esos actos vienen DESPUÉS de un envío que ya la exigió, así que si hoy falta (una orden de antes de
 * esta versión, o un arte excluido después del envío) se TOLERA (REGLA 0-B) en vez de frenar el pago:
 * devuelve `null` y el llamador no topa. Si existe, el llamador aplica {@link exigirPrecioDentroDelTope}.
 */
export async function referenciaSiExiste(
  cliente: ClienteLectura,
  idOrden: number,
  proceso: ProcesoParaReferencia,
): Promise<Prisma.Decimal | null> {
  return (await resolverReferencia(cliente, idOrden, proceso)).referencia;
}

/**
 * ¿Daniel (o quien lleve la llave) ya AUTORIZÓ este mismo precio por encima del tope, en esta orden y
 * este proceso? Lo usa la validación del cargo EsMa: el envío que él dejó salir a $12 con referencia
 * $10 no tiene que volver a autorizarse para pagarse a $12.
 *
 * El ALCANCE, tal como está hoy (default del lead, ⏳ pendiente de que Daniel lo confirme):
 *  • **Sólo esta orden y este proceso.** No cuenta una autorización de otra orden (ni de otra empresa)
 *    ni de otro proceso, ni la de `aplicacionOrd` (que no tiene proceso). Lo amarran S1/S2 en
 *    `referencias-maquila.int.test.ts`.
 *  • **No vence:** sigue valiendo aunque la referencia BAJE después.
 *  • **No se gasta:** sirve para varios cargos de esa orden y ese proceso al mismo precio.
 *  • **No queda atada al envío ni al maquilero** que la originó: vale para cualquier cargo de esa
 *    orden y ese proceso.
 *  • **Coincide por precio EXACTO** (como se guarda): pagar MENOS que lo autorizado pero MÁS que el
 *    tope pide autorizar de nuevo.
 */
export async function sobreprecioYaAutorizado(
  cliente: ClienteLectura,
  datos: { idOrden: number; idTipoProceso: number; precio: ValorDecimal },
): Promise<boolean> {
  const previo = await cliente.ordenReferenciaEvento.findFirst({
    where: {
      idOrden: datos.idOrden,
      idTipoProceso: datos.idTipoProceso,
      accion: 'sobreprecio',
      precioAutorizado: precioComoSeGuarda(datos.precio),
    },
    select: { id: true },
  });
  return previo !== null;
}

/**
 * La referencia que manda sobre un precio de la ORDEN (`maquilaOrd` → costura; `aplicacionOrd` → todos
 * los artes). Capturar el precio sin referencia se rechaza: no hay contra qué toparlo, y producción la
 * puede capturar ella misma en el mismo panel.
 */
export async function referenciaParaPrecioDeOrden(
  tx: Tx,
  idOrden: number,
  campo: 'maquila' | 'aplicacion',
): Promise<{ referencia: Prisma.Decimal; idTipoProceso: number | null; nombre: string }> {
  if (campo === 'maquila') {
    const costura = await procesoDeCostura(tx);
    if (costura === null) {
      throw new ErrorConflicto(
        'El catálogo de procesos no tiene «costura»: no hay contra qué topar el precio de maquila.',
      );
    }
    const resultado = await resolverReferencia(tx, idOrden, costura);
    if (resultado.referencia === null) {
      throw new ErrorConflicto(
        mensajeFaltaReferencia(
          resultado.falta,
          costura.nombre,
          'no se le puede capturar el precio',
        ),
      );
    }
    return { referencia: resultado.referencia, idTipoProceso: costura.id, nombre: costura.nombre };
  }
  const resultado = await referenciaDeTodosLosArtes(tx, idOrden);
  if (resultado.referencia === null) {
    throw new ErrorConflicto(
      resultado.falta === 'arte-sin-renglones'
        ? 'La orden no lleva ningún arte en su receta: no hay precio de referencia contra el cual ' +
            'topar el precio de aplicación.'
        : 'Uno o más artes de la orden no tienen precio: sin él no hay precio de referencia de la ' +
            'aplicación. Captúralo en el panel de precios de la orden (Referencias).',
    );
  }
  return { referencia: resultado.referencia, idTipoProceso: null, nombre: 'los artes de la orden' };
}

// ── El rastro de los artes (lo usa toda mutación de la receta) ───────────────────────────────

/** Referencia de cada proceso de arte de la orden (null = no se puede saber). */
export type FotoReferenciasDeArte = ReadonlyMap<number, Prisma.Decimal | null>;

/** Toma la foto de las referencias de arte de la orden (antes y después de mutar la receta). */
export async function fotoReferenciasDeArte(
  cliente: ClienteLectura,
  idOrden: number,
): Promise<FotoReferenciasDeArte> {
  const renglones = await cliente.ordenArte.findMany({
    where: { idOrden, excluido: false },
    select: { idTipoArte: true, precio: true },
  });
  const porTipo = new Map<number, { precio: Prisma.Decimal | null }[]>();
  for (const r of renglones) {
    const lista = porTipo.get(r.idTipoArte) ?? [];
    lista.push({ precio: r.precio });
    porTipo.set(r.idTipoArte, lista);
  }
  const foto = new Map<number, Prisma.Decimal | null>();
  for (const [idTipo, lista] of porTipo) {
    foto.set(idTipo, sumarReferenciaDeArte(lista).referencia);
  }
  return foto;
}

/** ¿Dos referencias son la misma? (null = sin referencia). */
function mismaReferencia(a: Prisma.Decimal | null, b: Prisma.Decimal | null): boolean {
  if (a === null || b === null) return a === b;
  return a.equals(b);
}

/**
 * Deja un evento `arte` por cada proceso cuya referencia cambió entre dos fotos (un precio movido, un
 * arte agregado, quitado o restaurado). Es lo que hace que la consulta de Daniel vea TODO cambio de
 * referencia de arte, venga del panel de referencias o de la receta. Devuelve cuántos dejó.
 */
export async function registrarCambiosDeReferenciaDeArte(
  tx: Tx,
  sesion: SesionUsuario,
  idOrden: number,
  antes: FotoReferenciasDeArte,
  despues: FotoReferenciasDeArte,
  nota: string | null,
): Promise<number> {
  const tipos = new Set<number>([...antes.keys(), ...despues.keys()]);
  const cambios = [...tipos]
    .sort((a, b) => a - b)
    .map((idTipo) => ({
      idTipo,
      anterior: antes.get(idTipo) ?? null,
      nueva: despues.get(idTipo) ?? null,
    }))
    .filter((c) => !mismaReferencia(c.anterior, c.nueva));
  if (cambios.length === 0) return 0;
  await tx.ordenReferenciaEvento.createMany({
    data: cambios.map((c) => ({
      idOrden,
      idTipoProceso: c.idTipo,
      accion: 'arte' as const,
      referenciaAnterior: c.anterior,
      referenciaNueva: c.nueva,
      nota,
      capturadoPorId: sesion.id,
    })),
  });
  return cambios.length;
}

// ── El pre-llenado (al ligar la orden a su desarrollo) ───────────────────────────────────────

/**
 * ⭐ PRE-LLENA la referencia de COSTURA desde el precosto vigente del desarrollo, si la orden todavía
 * no la tiene (§Post-F9.252: *«debería de llenarse por mí»* + la propuesta del lead de pre-llenarla).
 * Corre dentro de `ligarOrdenNucleo` (salida a producción y liga manual), así que la cadena existe.
 *
 * El precosto vigente es **lo último negociado** (§Post-F9.251, *«NO a la información que metió
 * originalmente desarrollo»*): el `idPrecosto` del renglón de lista de precios MÁS RECIENTE del
 * desarrollo, que `registrarRonda` re-apunta en cada ronda; si el desarrollo nunca entró a una lista,
 * su última versión CONGELADA (decisión del lead). El concepto es `maquila` (`CONCEPTO_MAQUILA`) y
 * su `importe` es el precio por prenda (es un ancla de «sólo precio»). **NO** se usa
 * `Modelo.maquilaBase`: Daniel lo descartó.
 *
 * Una vez puesta, la referencia se QUEDA (§Post-F9.252(3): *«el tope de ESTA orden es el que yo
 * puse»*): una ronda posterior no la mueve sola. Sin precosto o con la maquila en $0, no se
 * pre-llena nada (producción la captura). Devuelve la referencia que puso, o null.
 */
export async function prellenarReferenciaDeCostura(
  tx: Tx,
  sesion: SesionUsuario,
  idOrden: number,
  idDesarrollo: number,
  idEmpresa: number,
): Promise<Prisma.Decimal | null> {
  const costura = await procesoDeCostura(tx);
  if (costura === null) return null;
  await bloquearPreciosDeOrden(tx, idEmpresa, idOrden);
  const ya = await tx.ordenReferenciaProceso.findUnique({
    where: { idOrden_idTipoProceso: { idOrden, idTipoProceso: costura.id } },
    select: { id: true },
  });
  if (ya !== null) return null;

  const idPrecosto = await idPrecostoVigente(tx, idDesarrollo, idEmpresa);
  if (idPrecosto === null) return null;
  const lineas = await tx.precostoLinea.findMany({
    where: { idPrecosto, conceptoCosto: { codigo: CONCEPTO_MAQUILA } },
    select: { importe: true },
  });
  const referencia = lineas.reduce((s, l) => s.add(l.importe), new Prisma.Decimal(0));
  if (lineas.length === 0 || referencia.lte(0)) return null;

  await tx.ordenReferenciaProceso.create({
    data: {
      idOrden,
      idTipoProceso: costura.id,
      precio: referencia,
      origen: 'precosto',
      ...datosCreacion(sesion),
    },
  });
  await tx.ordenReferenciaEvento.create({
    data: {
      idOrden,
      idTipoProceso: costura.id,
      accion: 'prellenado',
      referenciaAnterior: null,
      referenciaNueva: referencia,
      nota: `Del precosto vigente del desarrollo (id ${String(idPrecosto)}).`,
      capturadoPorId: sesion.id,
    },
  });
  await registrarBitacora(tx, sesion, {
    entidad: 'Orden',
    idEntidad: idOrden,
    accion: 'MODIFICAR',
    datos: {
      operacion: 'referencia-maquila-prellenada',
      idTipoProceso: costura.id,
      idPrecosto,
      referencia: referencia.toNumber(),
    },
  });
  return referencia;
}

/** El precosto vigente de un desarrollo: el de su renglón de lista más reciente, o su último congelado. */
async function idPrecostoVigente(
  tx: Tx,
  idDesarrollo: number,
  idEmpresa: number,
): Promise<number | null> {
  const linea = await tx.listaPreciosLinea.findFirst({
    where: { idDesarrollo, lista: { idEmpresa } },
    orderBy: { id: 'desc' },
    select: { idPrecosto: true },
  });
  if (linea !== null) return linea.idPrecosto;
  const congelado = await tx.precosto.findFirst({
    where: { idDesarrollo, estado: 'congelado', desarrollo: { proyecto: { idEmpresa } } },
    orderBy: { version: 'desc' },
    select: { id: true },
  });
  return congelado?.id ?? null;
}

// ── Captura (PATCH /ordenes/:id/referencias-maquila) ─────────────────────────────────────────────────

/**
 * CAPTURA una referencia de la orden (`ordenes.precio-maquila`, la misma llave que el precio real:
 * §Post-F9.255, *«también producción»*). Dos formas:
 *  • `{ idTipoProceso, precio }` — un proceso que NO es arte: crea o cambia su `OrdenReferenciaProceso`
 *    (origen `manual`);
 *  • `{ idOrdenArte, precio }` — un renglón de ARTE de la orden: cambia su `OrdenArte.precio` (su
 *    proceso suma sus renglones) y lo marca `ajustado` (lo movió una persona a propósito, así que el
 *    aviso de desalineación contra el modelo no debe gritar). **NO** revoca la firma de Desarrollo ni
 *    sube la versión de la receta: el precio del arte no cambia QUÉ se compra (decisión del lead,
 *    `version-receta.ts` / fila 0.257).
 *
 * En UNA transacción (A2): guarda de orden CERRADA (lo primero), candado de precios, la escritura, su
 * `OrdenReferenciaEvento` (si cambió algo) y la bitácora. Capturar el mismo valor que ya había es un
 * no-op sin rastro. Devuelve las referencias de la orden (el ECO, sin reja de consulta: fila 0.198).
 */
export async function capturarReferenciaMaquila(
  sesion: SesionUsuario,
  idOrden: number,
  entrada: DatosReferenciaMaquilaPatch,
  bd?: ContextoBd,
): Promise<ReferenciasOrdenSalida> {
  verificarPermiso(sesion, 'ordenes.precio-maquila');
  const datos = validarEntrada(esquemaReferenciaMaquilaPatchCuerpo, entrada);
  const nota = datos.nota == null || datos.nota === '' ? null : datos.nota;
  const precio = precioComoSeGuarda(datos.precio);

  await enTransaccion(async (tx) => {
    await exigirOrdenAbiertaPorId(
      tx,
      sesion.idEmpresaActiva,
      idOrden,
      'le pueden capturar referencias de precio',
    );
    await bloquearPreciosDeOrden(tx, sesion.idEmpresaActiva, idOrden);
    const orden = await tx.orden.findFirst({
      where: { id: idOrden, idEmpresa: sesion.idEmpresaActiva },
      select: { id: true, estado: true },
    });
    if (orden === null) throw new ErrorNoEncontrado('Orden', idOrden);
    if (orden.estado === 'cancelada') {
      throw new ErrorConflicto('La orden está cancelada; no se le pueden capturar referencias.');
    }

    if ('idTipoProceso' in datos) {
      const proceso = await tx.tipoProceso.findUnique({
        where: { id: datos.idTipoProceso },
        select: { id: true, nombre: true, esArte: true, activo: true },
      });
      if (proceso === null) throw new ErrorNoEncontrado('TipoProceso', datos.idTipoProceso);
      if (proceso.esArte) {
        throw new ErrorValidacion(
          `«${proceso.nombre}» es un proceso de arte: su referencia es el precio de sus artes en la ` +
            'orden. Captúralo en el renglón del arte.',
        );
      }
      if (!proceso.activo) {
        throw new ErrorValidacion(`El tipo de proceso «${proceso.nombre}» está desactivado.`);
      }
      const anterior = await tx.ordenReferenciaProceso.findUnique({
        where: { idOrden_idTipoProceso: { idOrden, idTipoProceso: proceso.id } },
        select: { precio: true },
      });
      if (anterior !== null && anterior.precio.equals(precio)) return;
      await tx.ordenReferenciaProceso.upsert({
        where: { idOrden_idTipoProceso: { idOrden, idTipoProceso: proceso.id } },
        create: {
          idOrden,
          idTipoProceso: proceso.id,
          precio,
          origen: 'manual',
          ...datosCreacion(sesion),
        },
        update: { precio, origen: 'manual', ...datosModificacion(sesion) },
      });
      await tx.ordenReferenciaEvento.create({
        data: {
          idOrden,
          idTipoProceso: proceso.id,
          accion: 'captura',
          referenciaAnterior: anterior?.precio ?? null,
          referenciaNueva: precio,
          nota,
          capturadoPorId: sesion.id,
        },
      });
      await registrarBitacora(tx, sesion, {
        entidad: 'Orden',
        idEntidad: idOrden,
        accion: 'MODIFICAR',
        datos: {
          operacion: 'referencia-maquila',
          idTipoProceso: proceso.id,
          referenciaAnterior: anterior === null ? null : anterior.precio.toNumber(),
          referenciaNueva: precio.toNumber(),
        },
      });
      return;
    }

    const renglon = await tx.ordenArte.findFirst({
      where: { id: datos.idOrdenArte, idOrden },
      select: { id: true, precio: true, excluido: true, descripcion: true },
    });
    if (renglon === null) throw new ErrorNoEncontrado('Renglón de arte', datos.idOrdenArte);
    if (renglon.excluido) {
      throw new ErrorConflicto(
        `El arte «${renglon.descripcion}» está excluido de esta orden: no suma a la referencia.`,
      );
    }
    if (renglon.precio !== null && renglon.precio.equals(precio)) return;
    const antes = await fotoReferenciasDeArte(tx, idOrden);
    await tx.ordenArte.update({
      where: { id: renglon.id },
      data: { precio, estado: 'ajustado', ...datosModificacion(sesion) },
    });
    const despues = await fotoReferenciasDeArte(tx, idOrden);
    await registrarCambiosDeReferenciaDeArte(tx, sesion, idOrden, antes, despues, nota);
    await registrarBitacora(tx, sesion, {
      entidad: 'Orden',
      idEntidad: idOrden,
      accion: 'MODIFICAR',
      datos: {
        operacion: 'referencia-maquila-arte',
        idOrdenArte: renglon.id,
        referenciaAnterior: renglon.precio === null ? null : renglon.precio.toNumber(),
        referenciaNueva: precio.toNumber(),
      },
    });
  }, bd);

  return proyectarReferenciasOrden(sesion, idOrden, bd);
}

// ── Lectura (GET /ordenes/:id/referencias-maquila) ───────────────────────────────────────────────────

/** Las referencias de la orden para el panel de precios (`ordenes.ver`; montos con su regla). */
export async function obtenerReferenciasOrden(
  sesion: SesionUsuario,
  idOrden: number,
  bd?: ContextoBd,
): Promise<ReferenciasOrdenSalida> {
  verificarPermiso(sesion, 'ordenes.ver');
  return proyectarReferenciasOrden(sesion, idOrden, bd);
}

/**
 * La MISMA proyección SIN reja de consulta, para UN uso: el eco de {@link capturarReferenciaMaquila}
 * (fila 0.198 — la escritura ya autorizó con su propia llave). Los montos se siguen tapando con
 * {@link puedeVerReferenciasDeMaquila}, que incluye a quien captura.
 *
 * Qué procesos lista: los que NO son arte (activos, o con referencia ya capturada) y los de ARTE que la
 * orden lleva (con al menos un renglón no excluido).
 */
export async function proyectarReferenciasOrden(
  sesion: SesionUsuario,
  idOrden: number,
  bd?: ContextoBd,
): Promise<ReferenciasOrdenSalida> {
  const cliente = clienteLectura(bd);
  const orden = await cliente.orden.findFirst({
    where: { id: idOrden, idEmpresa: sesion.idEmpresaActiva },
    select: { id: true, folio: true },
  });
  if (orden === null) throw new ErrorNoEncontrado('Orden', idOrden);
  const ver = puedeVerReferenciasDeMaquila(sesion);

  const [filas, artes, noArte, eventos] = await Promise.all([
    cliente.ordenReferenciaProceso.findMany({
      where: { idOrden },
      select: { idTipoProceso: true, precio: true, origen: true },
    }),
    cliente.ordenArte.findMany({
      where: { idOrden, excluido: false },
      orderBy: { id: 'asc' },
      select: { id: true, idTipoArte: true, descripcion: true, posicion: true, precio: true },
    }),
    cliente.tipoProceso.findMany({
      where: { esArte: false },
      select: { id: true, codigo: true, nombre: true, activo: true },
    }),
    cliente.ordenReferenciaEvento.findMany({
      where: { idOrden, accion: { not: 'sobreprecio' }, idTipoProceso: { not: null } },
      orderBy: { id: 'desc' },
      distinct: ['idTipoProceso'],
      select: { idTipoProceso: true, capturadoPorId: true, capturadoEn: true },
    }),
  ]);
  const idsArte = [...new Set(artes.map((a) => a.idTipoArte))];
  const tiposArte =
    idsArte.length === 0
      ? []
      : await cliente.tipoProceso.findMany({
          where: { id: { in: idsArte } },
          select: { id: true, codigo: true, nombre: true },
        });
  const nombres = await nombresDeUsuarios(
    cliente,
    eventos.map((e) => e.capturadoPorId),
  );
  const ultimo = new Map(eventos.map((e) => [e.idTipoProceso, e]));
  const cambioDe = (idTipo: number): ReferenciaProcesoSalida['ultimoCambio'] => {
    const e = ultimo.get(idTipo);
    return e === undefined
      ? null
      : {
          capturadoPor: nombreDeUsuario(nombres, e.capturadoPorId),
          capturadoEn: e.capturadoEn.toISOString(),
        };
  };
  const monto = (valor: Prisma.Decimal | null): number | null =>
    !ver || valor === null ? null : valor.toNumber();

  const filaPorTipo = new Map(filas.map((f) => [f.idTipoProceso, f]));
  const procesos: ReferenciaProcesoSalida[] = [];
  for (const p of noArte
    .filter((t) => t.activo || filaPorTipo.has(t.id))
    .sort((a, b) => a.id - b.id)) {
    const fila = filaPorTipo.get(p.id);
    procesos.push({
      idTipoProceso: p.id,
      codigo: p.codigo,
      nombre: p.nombre,
      esArte: false,
      estado: fila === undefined ? 'sin-referencia' : 'lista',
      referencia: monto(fila?.precio ?? null),
      tope: fila === undefined ? null : monto(topeDeReferencia(fila.precio)),
      origen: fila?.origen ?? null,
      renglones: [],
      ultimoCambio: cambioDe(p.id),
    });
  }
  for (const t of [...tiposArte].sort((a, b) => a.id - b.id)) {
    const suyos = artes.filter((a) => a.idTipoArte === t.id);
    const resultado = sumarReferenciaDeArte(suyos);
    procesos.push({
      idTipoProceso: t.id,
      codigo: t.codigo,
      nombre: t.nombre,
      esArte: true,
      estado: resultado.referencia === null ? 'arte-sin-precio' : 'lista',
      referencia: monto(resultado.referencia),
      tope: resultado.referencia === null ? null : monto(topeDeReferencia(resultado.referencia)),
      origen: null,
      renglones: suyos.map((a) => ({
        idOrdenArte: a.id,
        descripcion: a.descripcion,
        posicion: a.posicion,
        precio: monto(a.precio),
      })),
      ultimoCambio: cambioDe(t.id),
    });
  }

  return { idOrden: orden.id, folioOrden: Number(orden.folio), ocultas: !ver, procesos };
}

// ── La consulta de Daniel (GET /ordenes/referencias-maquila/cambios) ─────────────────────────────────

/** Tope duro de renglones de la consulta (con aviso honesto, `truncado`). */
export const LIMITE_CAMBIOS_REFERENCIAS = 500;

/**
 * ⭐ LA CONSULTA DE REFERENCIAS CAMBIADAS (§Post-F9.255, recomendación del lead): qué orden, qué
 * proceso, de cuánto a cuánto, quién y cuándo — y en la MISMA lista, los sobreprecios autorizados.
 * Es lo que vuelve operable la (b): sin ella, el rastro existe y nadie lo mira. Llave reservada
 * `ordenes.autorizar-sobreprecio`. Empresa activa (A9). La más reciente primero.
 */
export async function listarCambiosDeReferencias(
  sesion: SesionUsuario,
  query: ReferenciasCambiosFiltros,
  bd?: ContextoBd,
): Promise<ReferenciasCambiosLista> {
  verificarPermiso(sesion, PERMISO_SOBREPRECIO);
  const filtros = validarEntrada(esquemaReferenciasCambiosFiltros, query);
  const cliente = clienteLectura(bd);

  const where: Prisma.OrdenReferenciaEventoWhereInput = {
    orden: {
      idEmpresa: sesion.idEmpresaActiva,
      ...(filtros.folio === undefined ? {} : { folio: BigInt(filtros.folio) }),
    },
    ...(filtros.soloSobreprecios ? { accion: 'sobreprecio' as const } : {}),
    ...(filtros.desde === undefined && filtros.hasta === undefined
      ? {}
      : {
          capturadoEn: {
            ...(filtros.desde === undefined ? {} : { gte: inicioDelDiaDelNegocio(filtros.desde) }),
            ...(filtros.hasta === undefined
              ? {}
              : { lt: inicioDelDiaSiguienteDelNegocio(filtros.hasta) }),
          },
        }),
  };
  const filasMas = await cliente.ordenReferenciaEvento.findMany({
    where,
    orderBy: { id: 'desc' },
    take: LIMITE_CAMBIOS_REFERENCIAS + 1,
    select: {
      id: true,
      idOrden: true,
      orden: { select: { folio: true } },
      idTipoProceso: true,
      tipoProceso: { select: { nombre: true } },
      accion: true,
      referenciaAnterior: true,
      referenciaNueva: true,
      precioAutorizado: true,
      punto: true,
      nota: true,
      capturadoPorId: true,
      capturadoEn: true,
    },
  });
  const truncado = filasMas.length > LIMITE_CAMBIOS_REFERENCIAS;
  const filas = truncado ? filasMas.slice(0, LIMITE_CAMBIOS_REFERENCIAS) : filasMas;
  const nombres = await nombresDeUsuarios(
    cliente,
    filas.map((f) => f.capturadoPorId),
  );
  const num = (v: Prisma.Decimal | null): number | null => (v === null ? null : v.toNumber());
  return {
    eventos: filas.map((f) => ({
      id: f.id,
      idOrden: f.idOrden,
      folioOrden: Number(f.orden.folio),
      idTipoProceso: f.idTipoProceso,
      proceso: f.tipoProceso?.nombre ?? null,
      accion: f.accion,
      referenciaAnterior: num(f.referenciaAnterior),
      referenciaNueva: num(f.referenciaNueva),
      precioAutorizado: num(f.precioAutorizado),
      punto: f.punto,
      nota: f.nota,
      capturadoPor: nombreDeUsuario(nombres, f.capturadoPorId),
      capturadoEn: f.capturadoEn.toISOString(),
    })),
    truncado,
    limite: LIMITE_CAMBIOS_REFERENCIAS,
  };
}
