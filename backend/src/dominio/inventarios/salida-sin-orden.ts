/**
 * ⭐⭐ LA SALIDA QUE NO ES POR OP — las DECISIONES en un solo sitio (fila 0.104).
 *
 * ## Qué pidió Daniel
 *
 * 2-sep-2026: *«el 99 % sale por medio de una OP pero deberíamos tener la opción de sacar alguna
 * venta o cualquier otra cosa»*. Cerrado el 3-sep: *«por ahora que toque **sólo inventarios**… pero
 * **sí debe existir una salida por otro medio que sólo ajuste de inventario**… **siempre autorizada
 * sólo por mí. Nadie más**»*. Y el 4-sep (§Post-F9.193 respuesta 12) nombró los casos: *«sacar por
 * ejemplo una **devolución**, o una **venta de avíos que ya no se usen**… Lo mismo en telas»*.
 *
 * ## Qué NO es
 *
 * 🔴 **NO toca compras, ni CxP, ni notas de crédito, ni facturación.** *«Por ahora que toque sólo
 * inventarios»*: una devolución al proveedor aquí es una SALIDA de kardex y nada más; el papel
 * (nota de crédito, ajuste de la cuenta del proveedor) sigue viviendo fuera del sistema. A qué
 * proveedor se le devolvió, o a quién se le vendió, viaja en el MOTIVO obligatorio — no en una FK,
 * que sería empezar a construir el módulo que Daniel aplazó.
 *
 * ## Dónde vive cada mitad
 *
 * Este módulo es LAS DECISIONES: quién puede (el permiso) y cómo se llama cada caso (el concepto y
 * su tipo de movimiento). La ORQUESTACIÓN vive en el dominio de cada dimensión —
 * `partidas-telas.ts` para telas por color y `avios.ts` para avíos—, porque ahí ya está, medida y
 * probada, la regla de no dejar el inventario en negativo (advisory lock + suma directa de
 * `MovimientoDet*`, jamás la vista — D3/ADR-0010 §3). Escribirla otra vez aquí habría sido tener
 * DOS reglas de no-negativo que se pueden ir separando; la del kardex tiene que ser LA MISMA en
 * todos los flujos, letra por letra.
 *
 * ## 🔑 Por qué el permiso es PROPIO
 *
 * `inventario-telas.mover` e `inventario-avios.mover` los lleva hoy medio organigrama (bajan hasta
 * `Secretarial`, herencia de la cascada vieja que la fila 0.105 dejó explícita). Reusarlos habría
 * sido lo contrario de lo que Daniel pidió. {@link PERMISO_SALIDA_SIN_ORDEN} nace en
 * `SOLO_ADMINISTRADOR` (`prisma/seed.ts`): sólo lo llevan `Administrador` y
 * `AdministracionDireccion`, los niveles 1 y 20 del sistema viejo. Ningún perfil operativo lo
 * otorga, y la prueba de reparto truena si alguien se lo cuela a uno.
 *
 * ## 🔑 Y por qué gobierna TAMBIÉN la cancelación
 *
 * Cancelar un movimiento es, por D3, registrar su INVERSO: la tela o el avío VUELVEN al inventario.
 * O sea, cancelar una salida sin orden es deshacer la decisión que sólo el dueño puede tomar. Si
 * eso se quedara con el `.mover` de siempre, la puerta que este permiso cierra tendría una ventana
 * abierta al lado. {@link exigirPermisoParaCancelarSalidaSinOrden} la cierra: las cancelaciones
 * NORMALES siguen pidiendo sólo `.mover`, y las de ESTAS salidas piden además la llave del dueño.
 */
import type { ClavePermiso, ConceptoSalidaSinOrden } from '../../contrato/index.js';

import { ErrorValidacion } from '../../comun/errores.js';
import { ORIGEN } from '../../comun/origenes.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import type { Tx } from '../../comun/transaccion.js';

/**
 * La llave del dueño. Se declara UNA vez y se usa desde las dos dimensiones, para que no pueda
 * pasar que telas exija una cosa y avíos otra.
 */
export const PERMISO_SALIDA_SIN_ORDEN: ClavePermiso = 'salida-material.registrar';

/**
 * Concepto → `codigo` del tipo de movimiento de kardex.
 *
 * 🔑 **POR QUÉ TIPOS DEDICADOS Y NO UN `ajuste-salida` CON EL MOTIVO EN PROSA.** El kardex es la
 * ventana por la que se pregunta *«¿a dónde se fue esta tela?»*, y ahí sólo se ve el NOMBRE del
 * tipo de movimiento. Con un ajuste genérico, una devolución al proveedor y una venta quedarían
 * indistinguibles de un error de conteo salvo leyendo las observaciones renglón por renglón — y
 * peor: mezcladas con los ajustes de verdad, que son otra cosa (corregir lo que el sistema creía).
 * Es el MISMO criterio, y con las mismas palabras, con que F7-E5 estrenó `ajuste-ciclico-entrada`
 * / `-salida` en vez de reusar el ajuste genérico: *«tipos DEDICADOS para poder rastrear en el
 * kardex qué diferencias vinieron de un cíclico»*.
 *
 * `otro` es la excepción, y a propósito: es el *«o cualquier otra cosa»* del 2-sep, un caso que
 * nadie ha nombrado todavía. Reusa el **«Otras Salidas»** que el sistema viejo ya traía (uno de los
 * 19 canónicos de `IPT_TiposMov`) en vez de estrenar un tipo para un hueco sin nombre. Cuando
 * alguno de esos casos se llame de alguna manera, ése sí estrenará el suyo.
 *
 * ⚠️ Los tres códigos tienen que existir en `TipoMovimientoInventario` y estar ACTIVOS: los siembra
 * `prisma/seed.ts` (`otras-salidas` desde siempre; los otros dos son de esta fila). Si faltara
 * alguno, el dominio lanza un `ErrorValidacion` que dice re-sembrar — nunca escribe un movimiento
 * a medias.
 */
export const CODIGO_TIPO_MOV_POR_CONCEPTO: Readonly<Record<ConceptoSalidaSinOrden, string>> = {
  /** Se le regresa material al proveedor (no cuadró, llegó mal, se canceló la compra). */
  'devolucion-proveedor': 'devolucion-proveedor',
  /** Se vende material que ya no se va a usar (el caso literal de Daniel con los avíos). */
  venta: 'venta-material',
  /** Cualquier otra causa: reusa el «Otras Salidas» de siempre. */
  otro: 'otras-salidas',
};

/**
 * ⛔ Los DOS rótulos que esta fila estrenó y que NO puede escribir nadie más.
 *
 * ## El defecto que esto cierra (hallazgo del reviewer, 2ª ronda)
 *
 * Los tipos de movimiento son un catálogo GLOBAL y activo, y los escritores GENÉRICOS de
 * inventario —el ajuste de tela por color, el ajuste LEGADO de tela por lote (`telas.ts`, que
 * entonces seguía expuesto en `POST /inventarios/telas/ajustes`; esa ruta se retiró en la fila
 * 0.170, la guarda se quedó), el de avíos y el movimiento manual de producto
 * terminado— aceptan **cualquier** `idTipoMov` que no sea de dirección `traspaso`. Así que, recién
 * sembrados, «Devolución a Proveedor» y «Venta de Material» quedaban al alcance de cualquiera con
 * `inventario-*.mover` —que son 8 de los 9 perfiles— y, de propina, aparecían en el desplegable de
 * movimientos de PT, donde nadie los pidió.
 *
 * ⚠️ **Son CUATRO puertas, no tres.** La legada por lote se pasó por alto en la primera lista y hay
 * que contarla siempre: cerrar tres de cuatro deja el rótulo igual de falsificable, sólo que por la
 * puerta de al lado. Es la misma simetría que la CANCELACIÓN ya reconocía
 * ({@link exigirPermisoParaCancelarSalidaSinOrden} se llama también desde `telas.ts`).
 *
 * 🔑 **Por qué eso derribaba la premisa de la fila.** El argumento para estrenar tipos DEDICADOS es
 * que el kardex pueda distinguir una devolución de una venta y de un error de conteo. Pero un tipo
 * dedicado es, implícitamente, **una afirmación sobre quién lo escribió**: si cualquiera puede
 * estampar «Venta de Material», el rótulo no clasifica mejor —clasifica igual de mal y con más
 * confianza, porque quien lea el kardex creerá que eso lo autorizó el dueño—. La llave estaba
 * puesta en la puerta documentada y la ventana de al lado, abierta.
 *
 * ⚠️ **Esto NO es la deuda vieja** de que `inventario-*.mover` baje hasta `Secretarial`: ahí el
 * efecto físico (sacar material con un ajuste) ya existía y se decide cuando Daniel arme los
 * perfiles reales. Lo que no existía antes de esta fila son **estos dos rótulos**, y con ellos la
 * apariencia de que la salida la autorizó él.
 *
 * `otras-salidas` NO entra aquí a propósito: existe desde el sistema viejo, lo usa el producto
 * terminado con toda legitimidad, y reservarlo sería quitarle una capacidad que ya tenía.
 */
export const CODIGOS_TIPO_RESERVADOS: ReadonlySet<string> = new Set([
  CODIGO_TIPO_MOV_POR_CONCEPTO['devolucion-proveedor'],
  CODIGO_TIPO_MOV_POR_CONCEPTO.venta,
]);

/**
 * RECHAZA que un escritor GENÉRICO de inventario estampe uno de los rótulos reservados
 * ({@link CODIGOS_TIPO_RESERVADOS}). Se llama con el `idTipoMov` que llegó de la captura, DENTRO de
 * la transacción y ANTES de escribir nada.
 *
 * No hay llamador legítimo que los necesite: las dos funciones buenas
 * (`registrarSalidaTelaColorSinOrden` / `registrarSalidaAvioSinOrden`) los resuelven **por código**,
 * no por id, así que ni pasan por aquí. Por eso se rechaza en seco en vez de pedir la llave: un
 * camino alterno para escribir el mismo rótulo sería otra vez dos puertas para una decisión.
 *
 * El mensaje dice A DÓNDE ir, que es lo que convierte un rechazo en una instrucción.
 */
export async function rechazarTipoReservado(tx: Tx, idTipoMov: number): Promise<void> {
  const tipo = await tx.tipoMovimientoInventario.findUnique({
    where: { id: idTipoMov },
    select: { codigo: true, nombre: true },
  });
  if (tipo !== null && CODIGOS_TIPO_RESERVADOS.has(tipo.codigo)) {
    throw new ErrorValidacion(
      `"${tipo.nombre}" no se captura como un movimiento manual: es una salida que sólo autoriza ` +
        `la dirección. Se registra en «Salida de material sin orden». Para corregir el inventario ` +
        `usa un ajuste.`,
    );
  }
}

/**
 * Exige la llave del dueño para REGISTRAR una salida sin orden (A4, deny-by-default). La llaman
 * las dos dimensiones como PRIMERA línea de su función, antes de validar nada más: quien no puede,
 * ni siquiera llega a que le digan si la captura estaba bien.
 *
 * ⚠️ Es la guarda DE VERDAD (A1). Que la pantalla esconda la opción a quien no la tiene es
 * cortesía; esto es lo que la niega.
 */
export function exigirPermisoSalidaSinOrden(sesion: SesionUsuario): void {
  verificarPermiso(sesion, PERMISO_SALIDA_SIN_ORDEN);
}

/**
 * Exige la llave del dueño para CANCELAR, pero **sólo si lo que se cancela es —o deshace— una
 * salida sin orden**. Para cualquier otro movimiento no hace nada: las cancelaciones normales de
 * tela y avío siguen pidiendo su `.mover` de siempre y esta fila no le cambia el gobierno a nadie.
 *
 * ## ⭐ Por qué mira la CADENA y no sólo el movimiento que tiene delante (2ª ronda del reviewer)
 *
 * Al cancelar una salida sin orden nace su INVERSO, y ese inverso lleva `origenTipo = cancelacion`
 * (lo pone el motor), NO `salida-sin-orden`. Mirando sólo el `origenTipo` del movimiento que se
 * cancela, el inverso quedaba fuera de la llave: con `inventario-*.mover` se podía cancelar el
 * inverso y **el material volvía a salir**, deshaciendo la marcha atrás que el dueño había dado.
 *
 * Así que cuando el movimiento es una cancelación se sigue el enlace `idMovimientoInverso` hacia
 * atrás —eslabón a eslabón, porque un inverso también se puede cancelar— hasta encontrar el
 * movimiento de origen. Si ese origen es una salida sin orden, se pide la llave.
 *
 * ⚠️ **La severidad, dicha con honestidad:** esto no le da capacidad nueva a nadie (quien tiene
 * `.mover` puede sacar la misma cantidad con un `ajuste-salida`) y el movimiento que resultaba
 * quedaba tipado «Ajuste (Salida)», no con el rótulo reservado. Se cierra igual porque el criterio
 * de la fila es que la llave se pida en TODAS las puertas, y ésta era barata de cerrar.
 *
 * ## 🔴 Por qué el recorrido lleva un CONJUNTO DE VISITADOS y no un contador (3ª ronda)
 *
 * La primera versión cortaba a los 20 eslabones **y al agotarse salía del bucle sin exigir nada**.
 * Eso es un **fail-open en una guarda de seguridad**: el reviewer lo midió y encontró que a
 * profundidad 20 un `.mover` pelado ya podía cancelar. La precondición era exótica —hacen falta 20
 * cancelaciones encadenadas, y **cada una exigió la llave**, así que sólo el dueño podía construir
 * la cadena—, pero un defecto conocido no es «menor», y menos cuando abre justo la puerta que la
 * función existe para cerrar.
 *
 * 🔑 **El conjunto es estrictamente mejor que cualquier tope**, y por eso no se subió el número:
 *  • **Termina siempre.** Cada vuelta añade un id nuevo al conjunto y la tabla es finita, así que
 *    un ciclo se detecta al reencontrar un id — que es lo único que el tope venía a evitar.
 *  • **Siempre llega al origen.** Sin corte artificial, una cadena legítima de la longitud que sea
 *    se recorre entera. Un «fail-closed al agotar» habría cerrado el hueco metiendo una **falsa
 *    negación**: una cadena de 25 cancelaciones de un ajuste NORMAL —que no tiene nada que ver con
 *    esta fila— habría quedado bloqueada para quien sólo trae `.mover`.
 *
 * ⚠️ **Y las dos salidas ANORMALES ahora fallan CERRADAS** (ciclo, y eslabón que apunta a un
 * movimiento inexistente): en las dos, la cadena está corrupta y es imposible saber si el origen
 * era una salida sin orden. Ante la duda, en una guarda se pide la llave. Ninguna de las dos es
 * alcanzable hoy —el enlace lo escribe sólo el motor de kardex y ningún código de producción borra
 * un `Movimiento` (D3: cancelar NUNCA borra)—, así que cerrarlas no le quita capacidad a nadie:
 * es la red por si algún día esas dos premisas dejan de ser ciertas.
 */
export async function exigirPermisoParaCancelarSalidaSinOrden(
  tx: Tx,
  sesion: SesionUsuario,
  movimiento: { origenTipo: string | null; idMovimientoInverso: number | null },
): Promise<void> {
  /** Los ids YA consultados. Reencontrar uno es, por definición, un ciclo. */
  const visitados = new Set<number>();
  let actual: { origenTipo: string | null; idMovimientoInverso: number | null } = movimiento;
  for (;;) {
    // Llegamos al origen y ES una salida sin orden: la llave.
    if (actual.origenTipo === ORIGEN.salidaSinOrden) {
      verificarPermiso(sesion, PERMISO_SALIDA_SIN_ORDEN);
      return;
    }
    // Llegamos al origen y NO lo es: esta fila no le cambia el gobierno a nadie. Única salida
    // que deja pasar, y sólo porque aquí la cadena SÍ se recorrió entera.
    if (actual.origenTipo !== ORIGEN.cancelacion || actual.idMovimientoInverso === null) {
      return;
    }
    const idAnterior = actual.idMovimientoInverso;
    if (visitados.has(idAnterior)) {
      // Ciclo: la cadena no tiene origen, así que no hay forma de saber qué se está deshaciendo.
      verificarPermiso(sesion, PERMISO_SALIDA_SIN_ORDEN);
      return;
    }
    visitados.add(idAnterior);
    const anterior = await tx.movimiento.findUnique({
      where: { id: idAnterior },
      select: { origenTipo: true, idMovimientoInverso: true },
    });
    if (anterior === null) {
      // Eslabón roto: mismo caso que el ciclo — cadena corrupta, se pide la llave.
      verificarPermiso(sesion, PERMISO_SALIDA_SIN_ORDEN);
      return;
    }
    actual = anterior;
  }
}
