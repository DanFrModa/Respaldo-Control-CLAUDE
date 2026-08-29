/**
 * ⭐ QUÉ CUELGA DE UN DEPARTAMENTO DEL CLIENTE, Y POR QUÉ LA FUSIÓN LAS REPUNTA **TODAS**
 * (§Post-F9.122(a) — «los departamentos están revueltos… hay mujer, dama, caballero, hombre»).
 *
 * El importador de OC por PDF da de alta un departamento **cada vez que la OC trae un texto nuevo**
 * (`pedidos/importacion-pdf.ts`, `resolverOCrearDepartamento`). Compara por nombre insensible a
 * mayúsculas, pero `"2-HOMBRE"` y `"Caballeros"` son textos distintos ⇒ el catálogo se llena de
 * SINÓNIMOS del mismo departamento. Y el departamento no es una etiqueta suelta: **la lista de
 * precios cuelga de cliente + departamento** (§Post-F9.109), así que dos nombres para lo mismo
 * **parten el trabajo en dos mundos que no se ven entre sí**.
 *
 * ⚠️ **AQUÍ LA FUSIÓN REPUNTA; NO BLOQUEA — y es lo contrario de la de COLORES.** `fusionarColores`
 * se NIEGA cuando el origen ya se usa (§Post-F9.129) porque `Color` tiene DOCE llaves entrantes y
 * varias son movimientos ya asentados (corte, kardex de PT) que no se pueden mover sin volverlos
 * incoherentes entre sí. `ClienteDepartamento` no se parece en nada a eso: sus CUATRO llaves
 * entrantes son relaciones 1:N simples sobre documentos que **siguen vivos y editables**, y
 * justamente **lo que hay que arreglar es que apunten al departamento bueno**. Bloquear aquí dejaría
 * a Daniel exactamente igual de atorado que hoy: los departamentos revueltos son los que YA tienen
 * proyectos y listas colgando — si se prohibiera fusionar los usados, la fusión no serviría para
 * nada.
 *
 * ⚠️ **LA LISTA DE ABAJO NO SE MANTIENE A MANO SIN RED.** `cliente-departamentos-fusion-referencias.test.ts`
 * **lee `prisma/schema.prisma`**, recorta `model ClienteDepartamento`, extrae sus relaciones de vuelta
 * y exige que esta lista las cubra TODAS, con igualdad exacta (sobrar también es rojo). Si mañana
 * alguien le cuelga una FK nueva al departamento y no la agrega aquí, la prueba se pone **roja** en
 * vez de dejar el hueco abierto: la fusión repuntaría tres de cinco tablas y la quinta se quedaría
 * apuntando a un departamento apagado, en silencio. Es la misma red que se puso en los colores
 * después de que la lista se enumerara mal TRES veces.
 *
 * 🔴 **LO QUE ESTA FUSIÓN **NO** ALCANZA, y hay que decirlo con nombre** (son COPIAS de TEXTO, no
 * llaves foráneas, así que repuntar FKs no las toca):
 *
 *  1. **`Cotizacion.nombreDepartamento`** — snapshot CONGELADO a propósito (*"el nombre del
 *     departamento tal como se imprimió"*). **NO se toca, y está bien que no se toque:** un papel de
 *     marzo no se reescribe porque en agosto se hayan unificado dos catálogos. Se declara aquí para
 *     que nadie lo lea como un olvido.
 *  2. **`OrdenReferencia.valor`** del campo «División» — el importador guarda el texto CRUDO de la OC
 *     (`"2-HOMBRE"`) como referencia de la orden (D7) y está **indexado para búsqueda**
 *     (`@@index([idClienteCampo, valor])`). ⇒ Después de una fusión, los proyectos y las listas ya
 *     quedan unificados **pero la búsqueda por referencia sigue partida**. Es la QUINTA PIEZA
 *     pendiente de decidir (ver `HOJA-DE-RUTA.md` §4): no se arregla aquí porque tocar un valor
 *     capturado de un documento del cliente es una decisión de negocio de Daniel, no un efecto
 *     colateral de limpiar un catálogo.
 */
import type { Prisma } from '../../datos/index.js';
import type { Tx } from '../../comun/transaccion.js';

/** Lo que un repunte dejó hecho: cuántas filas se movieron y cuáles se DESCARTARON (con su porqué). */
export interface RepunteHecho {
  /** Filas que ahora apuntan al departamento canónico. */
  movidos: number;
  /**
   * Filas que NO se pudieron mover y se retiraron, con sus valores, para que la decisión quede
   * AUDITABLE y rehacible a mano. Hoy sólo lo usa `factores` (ver {@link colisionDeFactores}).
   */
  descartados?: Prisma.JsonObject[];
}

/**
 * Una referencia entrante a `ClienteDepartamento` que la fusión **sabe repuntar**. `relacion` es el
 * nombre del campo de vuelta en `model ClienteDepartamento` (lo verifica la prueba contra el
 * esquema); `etiqueta` es cómo se le dice al usuario en la vista previa.
 */
export interface ReferenciaARepuntar {
  relacion: string;
  etiqueta: string;
  /** Cuántas filas cuelgan HOY de este departamento. Lo usa la vista previa Y el repunte. */
  contar: (tx: Tx, idDepartamento: number) => Promise<number>;
  /** Mueve las filas del origen al destino dentro de la transacción de la fusión. */
  repuntar: (tx: Tx, contexto: ContextoRepunte) => Promise<RepunteHecho>;
}

/** Lo que un repunte necesita saber: de dónde, a dónde y de qué cliente (los tres del mismo cliente). */
export interface ContextoRepunte {
  idCliente: number;
  idOrigen: number;
  idDestino: number;
}

/**
 * ⭐ **LA COLISIÓN QUE ES EL CORAZÓN DE ESTA FUSIÓN.**
 *
 * `ClienteFactores` lleva `@@unique([idCliente, idClienteDepartamento])`: un cliente tiene **como
 * mucho un** juego de factores por departamento. Si el departamento que se queda **y** el que se
 * absorbe tienen factores propios, un `updateMany` a secas **choca con ese unique** y revienta la
 * fusión entera.
 *
 * ⚠️ **Y la receta de los colores NO traduce.** Allá la colisión de `TelaColor` se resuelve
 * *rellenando huecos* (el destino se queda con su valor y toma del origen sólo lo que tenía en NULL)
 * y borrando la fila sobrante. Aquí **no hay hueco que rellenar**: los cuatro porcentajes son NOT
 * NULL, así que siempre están los dos juegos completos y hay que **elegir uno**.
 *
 * ⚖️ **GANA EL DEL DEPARTAMENTO QUE SE QUEDA.** Razón: el canónico es la identidad que sobrevive a la
 * fusión —conserva su id, su nombre y su historia—, y sus factores **son parte de esa identidad**. Que
 * los del absorbido lo pisaran significaría que el departamento sale de la fusión con el mismo nombre
 * y **otro precio**: el cambio más caro del sistema (el factor *es* el precio dicho de otra forma,
 * §Post-F9.125) ocurriendo como efecto colateral invisible de una limpieza de catálogo.
 *
 * ⚠️ **Y no se pierde en silencio:** los cuatro valores del absorbido se escriben en la BITÁCORA antes
 * de retirar la fila, de modo que la decisión es auditable y **rehacible a mano** si Daniel dice que
 * los buenos eran los otros. Tampoco se BLOQUEA la fusión por esto: bloquear devolvería a Daniel al
 * problema que esta etapa viene a resolver. Se avisa ANTES en la vista previa —con la misma función
 * que decide en el repunte, no con un resumen paralelo— y se ejecuta.
 *
 * ⚠️ **`destinoYaTieneFactores` existe por el caso de VARIOS absorbidos, y no es un adorno.** Los
 * orígenes se procesan **en orden**: si dos absorbidos traen factores y el canónico no, el PRIMERO se
 * los lleva y el SEGUNDO ya choca. Leyendo la base, el repunte ve eso correctamente (el primero ya
 * escribió); pero la VISTA PREVIA no escribe nada, así que leyendo la base vería *"ninguno choca"* y le
 * prometería al usuario que se mueven los dos. Por eso la previa **simula el avance** y le pasa aquí el
 * estado que habrá — pero **la decisión la sigue tomando esta función y sólo ésta**. *Compartir la
 * función y no el estado es lo que mantiene honestas a las dos guardas.*
 *
 * @returns los factores del ORIGEN que se van a descartar, o `null` si no hay colisión.
 */
export async function colisionDeFactores(
  tx: Tx,
  contexto: ContextoRepunte,
  opciones: { destinoYaTieneFactores?: boolean } = {},
): Promise<{
  idFactoresOrigen: number;
  margenPct: string;
  descuentosPct: string;
  regaliasPct: string;
  costoVentasPct: string;
} | null> {
  const { idCliente, idOrigen, idDestino } = contexto;
  const delOrigen = await tx.clienteFactores.findFirst({
    where: { idCliente, idClienteDepartamento: idOrigen },
  });
  if (delOrigen === null) {
    return null;
  }
  const destinoTieneFactores =
    opciones.destinoYaTieneFactores ??
    (await tx.clienteFactores.findFirst({
      where: { idCliente, idClienteDepartamento: idDestino },
      select: { id: true },
    })) !== null;
  if (!destinoTieneFactores) {
    return null; // el destino no tiene: la fila del origen se MUEVE tal cual, no hay nada que elegir.
  }
  return {
    idFactoresOrigen: delOrigen.id,
    margenPct: delOrigen.margenPct.toString(),
    descuentosPct: delOrigen.descuentosPct.toString(),
    regaliasPct: delOrigen.regaliasPct.toString(),
    costoVentasPct: delOrigen.costoVentasPct.toString(),
  };
}

/**
 * Las CUATRO referencias entrantes de `ClienteDepartamento`, TODAS repuntables. El orden es el del
 * peso que tienen para el usuario: primero lo que se ve en pantalla (proyectos, listas, cotizaciones)
 * y al final la configuración (factores), que es la única con colisión posible.
 */
export const REFERENCIAS_A_REPUNTAR: ReferenciaARepuntar[] = [
  {
    relacion: 'proyectos',
    etiqueta: 'proyectos de desarrollo',
    contar: (tx, id) => tx.proyecto.count({ where: { idClienteDepartamento: id } }),
    repuntar: async (tx, { idOrigen, idDestino }) => {
      const { count } = await tx.proyecto.updateMany({
        where: { idClienteDepartamento: idOrigen },
        data: { idClienteDepartamento: idDestino },
      });
      return { movidos: count };
    },
  },
  {
    relacion: 'listasPrecios',
    etiqueta: 'listas de precios',
    contar: (tx, id) => tx.listaPrecios.count({ where: { idClienteDepartamento: id } }),
    repuntar: async (tx, { idOrigen, idDestino }) => {
      const { count } = await tx.listaPrecios.updateMany({
        where: { idClienteDepartamento: idOrigen },
        data: { idClienteDepartamento: idDestino },
      });
      return { movidos: count };
    },
  },
  {
    relacion: 'cotizaciones',
    etiqueta: 'cotizaciones',
    contar: (tx, id) => tx.cotizacion.count({ where: { idClienteDepartamento: id } }),
    repuntar: async (tx, { idOrigen, idDestino }) => {
      // Se mueve la LLAVE, nunca `nombreDepartamento`: ese snapshot va congelado a propósito
      // (el papel que ya se imprimió no se reescribe). Ver la cabecera de este archivo.
      const { count } = await tx.cotizacion.updateMany({
        where: { idClienteDepartamento: idOrigen },
        data: { idClienteDepartamento: idDestino },
      });
      return { movidos: count };
    },
  },
  {
    relacion: 'factores',
    etiqueta: 'factores de precio del departamento',
    contar: (tx, id) => tx.clienteFactores.count({ where: { idClienteDepartamento: id } }),
    repuntar: async (tx, contexto) => {
      const colision = await colisionDeFactores(tx, contexto);
      if (colision !== null) {
        // ⚖️ Gana el del departamento que SE QUEDA; el del absorbido se retira DESPUÉS de quedar
        // escrito en la bitácora (lo hace `fusionarDepartamentosCliente` con este `descartados`).
        await tx.clienteFactores.delete({ where: { id: colision.idFactoresOrigen } });
        return {
          movidos: 0,
          descartados: [
            {
              margenPct: colision.margenPct,
              descuentosPct: colision.descuentosPct,
              regaliasPct: colision.regaliasPct,
              costoVentasPct: colision.costoVentasPct,
              porQue: 'el departamento que se conserva ya tenía factores propios; ganan los suyos',
            },
          ],
        };
      }
      const { count } = await tx.clienteFactores.updateMany({
        where: { idClienteDepartamento: contexto.idOrigen },
        data: { idClienteDepartamento: contexto.idDestino },
      });
      return { movidos: count };
    },
  },
];

/** Un uso encontrado: qué es y cuántos renglones son. */
export interface UsoDeDepartamento {
  relacion: string;
  etiqueta: string;
  cuenta: number;
}

/**
 * Cuenta, dentro de la transacción, TODO lo que cuelga del departamento. Es la función que usan **las
 * dos guardas**: la vista previa que le dice al usuario qué va a pasar, y (vía la misma lista) el
 * repunte que lo hace. Devuelve todas las relaciones, incluso en cero, para que la vista previa pueda
 * decir "0 listas de precios" en vez de callar.
 */
export async function contarUsosDeDepartamento(
  tx: Tx,
  idDepartamento: number,
): Promise<UsoDeDepartamento[]> {
  const usos: UsoDeDepartamento[] = [];
  for (const referencia of REFERENCIAS_A_REPUNTAR) {
    const cuenta = await referencia.contar(tx, idDepartamento);
    usos.push({ relacion: referencia.relacion, etiqueta: referencia.etiqueta, cuenta });
  }
  return usos;
}
