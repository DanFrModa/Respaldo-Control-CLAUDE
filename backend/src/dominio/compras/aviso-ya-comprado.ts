/**
 * ⭐⭐⭐ **SI YA SE COMPRÓ, AVISA — Y EL AVISO LLEGA AL COMPRADOR** (0.085, §Post-F9.173(a)).
 *
 * DANIEL, textual: *"Si ya está comprado, **solo avisa que ya está comprado** para ver si se puede
 * cancelar la OC interna, o que **el comprador sepa que cambió**, para hacer lo que tenga que hacer.
 * **No se puede cancelar la OC en automático… eso hay que negociarlo con el proveedor.**"*
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * ## EL HUECO QUE TAPA, y por qué no era el que parecía
 *
 * El sistema ya SABÍA decir *"esto ya está comprado"*: `exigirNoSacarLoComprado`
 * (`produccion/receta-orden.ts`, §Post-F9.79) lo dice —con folio y con camino— en las siete bocas
 * por las que un material SALE de la receta. Pero sólo ahí. **Cambiarle a un material ya comprado el
 * consumo por prenda, el precio o el amarre de proveedor no lo bloqueaba nada y no lo avisaba
 * nadie**: la firma del renglón se caía (que está bien, `revocarFirmaDeRenglones`) y ahí terminaba
 * todo. La OC ya emitida seguía diciendo una cosa y la receta otra, y el único que podía negociarlo
 * con el proveedor —el comprador— no se enteraba.
 *
 * 🔴 **Y no se enteraría nunca por el 409.** El rechazo de la puerta de compra sólo alcanza a quien
 * INTENTA gastar; si ya compró, no va a volver a intentarlo. Un aviso que espera a que alguien
 * tropiece con él no es un aviso: por eso esta etapa lo pone en los TRES sitios donde el comprador
 * sí pasa —la bandeja «Recetas por liberar» (que él ya ve con `desarrollo.ver`), la fila de la
 * receta, y el diálogo de reabrir, ANTES de confirmar.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * ## ⚖️ QUÉ CUENTA COMO "YA COMPRADO" AQUÍ: `ESTATUS_OC_COMPROMETIDA`, y sale de la frase de Daniel
 *
 * *"Eso hay que negociarlo con el proveedor"* — **y sólo desde `autorizada` hay un tercero con quien
 * negociar**. Una OC en `borrador` o `pendiente_autorizacion` se corrige o se borra sin llamarle a
 * nadie: avisar sobre ella sería gritar en falso, y un aviso que grita en falso se aprende a
 * ignorar. Por eso este módulo lee {@link ESTATUS_OC_COMPROMETIDA} —la MISMA lista que la guarda de
 * §Post-F9.79 y la de V1-E4c— y **no** el `<> 'cancelada'` escrito a mano de
 * `recetas-por-liberar.ts`, que responde otra pregunta (*"¿ya hay ALGUIEN esperando esta firma?"*,
 * donde un borrador sí cuenta porque alguien ya se sentó a escribirlo).
 *
 * ⚠️ **NUNCA es un SNAPSHOT.** Todo se deriva EN VIVO de `OrdenCompraLinea` en cada lectura, igual
 * que `comprasComprometidasDeColores`. Guardar el aviso el día del cambio dejaría gritando a una OC
 * que después se des-autorizó — y la des-autorización es justamente uno de los desenlaces que este
 * aviso viene a provocar.
 *
 * 🔴 **EL TECHO HONESTO DEL AVISO ES «YA SE RECIBIÓ», NO «YA SE PAGÓ».** Ningún modelo de CxP liga
 * a una orden de compra (F9 amarra los movimientos al TERCERO y al CFDI, no a la OC), así que el
 * sistema **no puede saber** si eso ya se pagó. Decirlo sería inventar. Se dice hasta donde el dato
 * alcanza y ni una palabra más.
 *
 * A9: sólo cuentan las OC de la empresa activa; una de otra empresa no avisa nada ni se nombra.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * ## ⚠️⚠️ DE QUÉ INVARIANTE DEPENDE ESTE MÓDULO — Y DÓNDE SE ROMPERÍA EN SILENCIO
 *
 * Desde la 0.085 la guarda de §Post-F9.79 (`exigirNoSacarLoComprado`) **ya no filtra el material en
 * el `where`**: pide todo lo comprometido de la orden y lo busca por {@link claveMaterial}. Eso
 * traslada su corrección a un **invariante de dominio**: que una `OrdenCompraLinea` lleve **tela XOR
 * avío, nunca las dos**. `claveMaterial` prefiere la tela, así que una línea con ambas se archivaría
 * bajo `tela-N` y **dejaría de bloquear el avío**, sin error y sin ruido.
 *
 * 🔴 **NO hay `CHECK` en la base que lo garantice.** Hoy se sostiene porque los ÚNICOS dos
 * escritores lo respetan: `compras/ordenes-compra.ts` (valida el XOR al capturar la línea) y el ETL
 * de migración (que ni siquiera escribe `idOrden`, así que sus líneas no llegan aquí).
 *
 * ⇒ **Quien agregue un tercer escritor de `OrdenCompraLinea` tiene que respetar el XOR** o poner el
 * `CHECK` en la base. Si no, el bloqueo de "no saques lo ya comprado" se apaga sin avisar.
 */
import type { EstatusOrdenCompra } from '../../datos/index.js';
import { clienteLectura, type ContextoBd } from '../../comun/transaccion.js';

import { algunaRecibida, claveMaterial, ESTATUS_OC_COMPROMETIDA } from './comprometido-en-oc.js';

/** Una OC que ya comprometió la compra frente al proveedor, tal como se la nombra a una persona. */
export interface OcComprometida {
  /** Id de la OC (para poder llevar a ella desde la pantalla). */
  idOrdenCompra: number;
  /** `numCompra`: el folio con el que todo el mundo la nombra. */
  folio: number;
  estatus: EstatusOrdenCompra;
  /**
   * ⭐ **¿Esta OC YA SE RECIBIÓ?** — lo decide {@link algunaRecibida}, la ÚNICA definición de esa
   * regla, y VIAJA calculado.
   *
   * 🔴 Se manda hecho en vez de dejar que la pantalla lo deduzca del `estatus`, y no es
   * redundancia: **decide el camino que se le ofrece a una persona** (una autorizada se
   * des-autoriza; una recibida NO, ahí toca devolución o ajuste). Deducirlo en el frontend sería
   * una segunda implementación de la regla, en otro lenguaje, a tres archivos de distancia — el
   * mismo pecado que este módulo vino a borrar al fusionar la consulta de la guarda. Mismo
   * precedente que `capturaReparable` (V1-E8h): *lo decide el SERVIDOR, no el texto*.
   */
  recibida: boolean;
}

/** Lo comprometido de UNA orden de producción: el total y el desglose por material. */
export interface ComprasComprometidasDeOrden {
  /** Todas las OC comprometidas de la orden, sin repetir, por folio ascendente. */
  ocs: OcComprometida[];
  /** `claveMaterial` (`tela-5` / `avio-9`) → las OC que compraron ESE material para esta orden. */
  porMaterial: Map<string, OcComprometida[]>;
}

/** Vacío, para las órdenes que no tienen ni una OC comprometida (se devuelve, no se omite). */
function sinCompras(): ComprasComprometidasDeOrden {
  return { ocs: [], porMaterial: new Map() };
}

/**
 * ⭐ **LA función**: qué OC ya comprometidas tiene cada orden de producción, y por qué material.
 *
 * Lectura pura (no escribe): se puede llamar dentro o fuera de una transacción. Por LOTE de órdenes
 * a propósito —la bandeja pinta hasta 100 filas y un N+1 ahí es un N+1 de verdad—; el caso de una
 * sola orden entra por {@link comprasComprometidasDeUnaOrden}.
 *
 * @param idsOrden órdenes de producción a cruzar; vacío = mapa vacío (no consulta).
 */
export async function comprasComprometidasPorOrden(
  idEmpresa: number,
  idsOrden: readonly number[],
  bd?: ContextoBd,
): Promise<Map<number, ComprasComprometidasDeOrden>> {
  const resultado = new Map<number, ComprasComprometidasDeOrden>();
  if (idsOrden.length === 0) return resultado;

  const lineas = await clienteLectura(bd).ordenCompraLinea.findMany({
    where: {
      idOrden: { in: [...idsOrden] },
      // A9 + el criterio de arriba: la OC tiene que ser de esta empresa y estar COMPROMETIDA.
      ordenCompra: { idEmpresa, estatus: { in: [...ESTATUS_OC_COMPROMETIDA] } },
    },
    select: {
      idOrden: true,
      idTela: true,
      idAvio: true,
      idOrdenCompra: true,
      ordenCompra: { select: { numCompra: true, estatus: true } },
    },
    orderBy: { id: 'asc' },
  });

  for (const l of lineas) {
    if (l.idOrden === null) continue; // imposible por el `where`, pero la columna es nullable.
    const oc: OcComprometida = {
      idOrdenCompra: l.idOrdenCompra,
      folio: Number(l.ordenCompra.numCompra),
      estatus: l.ordenCompra.estatus,
      recibida: algunaRecibida([l.ordenCompra.estatus]),
    };
    const acum = resultado.get(l.idOrden) ?? sinCompras();
    agregarSinRepetir(acum.ocs, oc);
    // ⚠️ Una línea LIBRE (texto suelto, sin tela ni avío) cuenta para la ORDEN pero no cubre a
    // ningún renglón de la receta: `claveMaterial` la manda a `libre`, que ningún renglón consulta.
    const clave = claveMaterial(l);
    const deEse = acum.porMaterial.get(clave) ?? [];
    agregarSinRepetir(deEse, oc);
    acum.porMaterial.set(clave, deEse);
    resultado.set(l.idOrden, acum);
  }

  for (const lista of resultado.values()) {
    lista.ocs.sort((a, b) => a.folio - b.folio);
    for (const deEse of lista.porMaterial.values()) deEse.sort((a, b) => a.folio - b.folio);
  }
  return resultado;
}

/** Lo mismo, para UNA orden. Siempre devuelve algo (vacío si no hay compra comprometida). */
export async function comprasComprometidasDeUnaOrden(
  idEmpresa: number,
  idOrden: number,
  bd?: ContextoBd,
): Promise<ComprasComprometidasDeOrden> {
  const mapa = await comprasComprometidasPorOrden(idEmpresa, [idOrden], bd);
  return mapa.get(idOrden) ?? sinCompras();
}

/**
 * Las OC comprometidas que cubren UN material (tela XOR avío) de esa orden. Vacío = no se ha
 * comprado.
 *
 * Se pasa por {@link claveMaterial} y no por el par de ids sueltos a propósito: es la MISMA clave
 * con la que se armó el mapa, así que no hay forma de que el lector y el escritor la escriban
 * distinta (la trampa que `comprometido-en-oc.ts` documenta para *(material, color)*).
 */
export function ocsDeMaterial(
  compras: ComprasComprometidasDeOrden,
  material: { idTela: number | null; idAvio: number | null },
): OcComprometida[] {
  return compras.porMaterial.get(claveMaterial(material)) ?? [];
}

/** Una OC aparece una vez por LÍNEA; en el aviso tiene que aparecer una vez a secas. */
function agregarSinRepetir(lista: OcComprometida[], oc: OcComprometida): void {
  if (!lista.some((y) => y.idOrdenCompra === oc.idOrdenCompra)) lista.push(oc);
}

// ── LA REDACCIÓN (funciones PURAS: se prueban sin base) ─────────────────────────────────────

/**
 * Cómo se NOMBRA cada estatus comprometido delante de una persona.
 *
 * Vive aquí y no se importa de la pantalla a propósito: **el texto lo redacta el servidor** (A1,
 * mismo patrón que `avisoCurva` y `motivoNoCambiarColor`), así que el frontend no arma la frase ni
 * resuelve plurales. Los estatus que NO comprometen no están: si alguno llegara aquí sería un
 * defecto, y `?? String(estatus)` deja que se vea en vez de tragárselo.
 */
const COMO_SE_LLAMA: Partial<Record<EstatusOrdenCompra, string>> = {
  autorizada: 'autorizada',
  recibida_parcial: 'ya recibida en parte',
  recibida_total: 'ya recibida',
};

/** `#12 (autorizada), #15 (ya recibida)` — los folios con su estado, que es lo que decide el camino. */
export function listarOcs(ocs: readonly OcComprometida[]): string {
  return ocs
    .map((o) => `#${String(o.folio)} (${COMO_SE_LLAMA[o.estatus] ?? String(o.estatus)})`)
    .join(', ');
}

/** «la orden de compra» / «las órdenes de compra», según cuántas. */
function comoSeLlamanLasOcs(cuantas: number): string {
  return cuantas > 1 ? 'las órdenes de compra' : 'la orden de compra';
}

/**
 * ⭐ **EL CAMINO, dicho sin mandar a nadie contra un 403** (§Post-F9.145(f)).
 *
 * Des-autorizar una OC exige `compras.desautorizar`, que el seed corta a Administrador y
 * AdministracionDireccion: pintarle ese botón al comprador sería pintarle un 403. Y sobre una OC ya
 * RECIBIDA el botón **no existe para nadie** (Daniel, 20-ago-2026: *"una vez recibido no se puede
 * desautorizar"*), así que mandar ahí a alguien es mandarlo a rebotar. Se nombra el camino Y a quién
 * pedírselo, que es el patrón que ya usa `exigirNoSacarLoComprado`.
 */
function comoSeDeshace(recibida: boolean): string {
  if (recibida) {
    return (
      'Lo que ya se RECIBIÓ no se puede des-autorizar ni cancelar con el proveedor: ese material ya ' +
      'entró al inventario, y el camino honesto es una devolución o un ajuste.'
    );
  }
  return (
    'Cancelarla NO es automático: hay que negociarlo con el proveedor. Des-autorizarla en el ' +
    'sistema es del perfil de Dirección — si no te aparece el botón, pídeselo a quien lo tenga.'
  );
}

/** Un renglón de la receta que acaba de cambiar Y ya estaba comprado. */
export interface RenglonYaComprado {
  /** Nombre del material tal como se le enseña a una persona. */
  material: string;
  ocs: readonly OcComprometida[];
}

/**
 * ⭐⭐ **EL AVISO DE §Post-F9.173(a): "ya está comprado, y acabas de cambiarlo".**
 *
 * 🔴 **AVISA; NO BLOQUEA** — mismo espíritu que `compras/desvio-de-compra.ts` (*"EL DESVÍO AVISA; NO
 * BLOQUEA"*). Cambiar el consumo, el precio o el amarre de un material ya comprado es LEGÍTIMO y a
 * veces es exactamente lo que hay que hacer; lo que no puede pasar es que ocurra **en silencio**.
 * Bloquearlo sería inventarse una regla que Daniel no pidió: él pidió que *avise*.
 *
 * @returns el aviso ya redactado, o `null` si nada de lo que cambió estaba comprado.
 */
export function avisoCambioSobreLoComprado(renglones: readonly RenglonYaComprado[]): string | null {
  const conCompra = renglones.filter((r) => r.ocs.length > 0);
  if (conCompra.length === 0) return null;

  const todas = conCompra.flatMap((r) => r.ocs);
  const recibida = algunaRecibida(todas.map((o) => o.estatus));
  const detalle = conCompra
    .map((r) => `"${r.material}" (${comoSeLlamanLasOcs(r.ocs.length)} ${listarOcs(r.ocs)})`)
    .join('; ');

  return (
    `Acabas de cambiar ${
      conCompra.length > 1
        ? `${String(conCompra.length)} materiales que YA ESTÁN COMPRADOS`
        : 'un material que YA ESTÁ COMPRADO'
    } para esta orden: ${detalle}. La orden de compra NO se corrige sola. ` +
    `${comoSeDeshace(recibida)} ` +
    'Avísale a Compras para que decida qué hacer con ella. Mientras tanto el renglón quedó SIN ' +
    'FIRMAR, así que esta orden aparece en Desarrollo › «Recetas por liberar» con su orden de ' +
    'compra a la vista.'
  );
}

/**
 * ⭐⭐ **EL AVISO ANTES DE REABRIR LA RECETA** (hueco 2 de la 0.085; precedente §Post-F9.145(a):
 * *el aviso llega ANTES de confirmar, no después*).
 *
 * Hasta la 0.084 reabrir sólo dejaba un toast DESPUÉS —y ni siquiera mencionaba las OC—: quien
 * congelaba la compra de una orden entera no sabía si había dinero comprometido hasta que se topaba
 * con ello. Este texto se pinta DENTRO del diálogo, con la orden todavía sin tocar.
 *
 * @returns el aviso, o `null` si esta orden no tiene ninguna compra comprometida.
 */
export function avisoReabrirConCompraComprometida(ocs: readonly OcComprometida[]): string | null {
  if (ocs.length === 0) return null;
  const recibida = algunaRecibida(ocs.map((o) => o.estatus));
  return (
    `Esta orden ya tiene compra comprometida con el proveedor: ${comoSeLlamanLasOcs(ocs.length)} ` +
    `${listarOcs(ocs)}. Reabrir la receta NO las cancela ni las toca: siguen su curso. ` +
    `${comoSeDeshace(recibida)} ` +
    'Si lo que vas a corregir cambia algo de eso, avísale a Compras antes de tocarlo.'
  );
}
