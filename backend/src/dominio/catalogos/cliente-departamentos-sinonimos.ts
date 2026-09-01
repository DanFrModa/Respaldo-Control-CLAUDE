/**
 * ⭐⭐ LOS DOS NOMBRES DEL DEPARTAMENTO — resolver el SINÓNIMO de una búsqueda (§Post-F9.172(a)).
 *
 * **EL PROBLEMA, medido.** El importador de OC escribe la División **dos veces**
 * (`dominio/pedidos/importacion-pdf.ts`): al catálogo **con FK** (`resolverOCrearDepartamento`) y
 * como **texto crudo** en `OrdenReferencia.valor` (D7), que es un `String` **sin llave**. Fusionar
 * «2-HOMBRE» en «Caballeros» (§Post-F9.122(a)) repunta las cinco llaves entrantes del catálogo… y
 * la ORDEN sigue diciendo «2-HOMBRE», así que el `contains` de la búsqueda no la alcanza.
 *
 * **LA DECISIÓN DE DANIEL, textual: *«Está bien la 3. Lo que propones.»*** — el texto capturado del
 * documento del cliente **NO se reescribe NUNCA**: es la única prueba de qué pidió, y reescribirlo
 * es justo lo que `Cotizacion.nombreDepartamento` se congela a propósito para no hacer. Buscar
 * «Caballeros» encuentra las órdenes que dicen «2-HOMBRE» **porque el sistema sabe que uno se
 * fusionó en el otro**, no porque le haya cambiado el papel al cliente.
 *
 * 🔴 **RESUELVE EN LOS DOS SENTIDOS, y ésa es la razón de que esto no sea un `findMany` suelto.**
 * Buscar el DESTINO tiene que encontrar el ORIGEN (el caso que originó la decisión) **y al revés**,
 * porque quien tiene el papel viejo en la mano busca por el nombre viejo. Por eso lo que se devuelve
 * no es "la cadena hacia arriba" sino el **GRUPO ENTERO** de la fusión: todos los departamentos
 * conectados por `idFusionadoEn`, subiendo hacia el canónico Y bajando hacia los absorbidos. Con
 * A→B→C, buscar cualquiera de los tres trae los otros dos.
 *
 * ⚠️ **RENDIMIENTO — esto lo usan tres pantallas, una es el Centro de Órdenes.** El conjunto se
 * resuelve **UNA vez por consulta** y su resultado entra en el `where`: NUNCA se recorre la cadena
 * por fila. El recorrido va **por niveles y por lotes** (`id in (…)`), así que son 1 consulta de
 * arranque + 1 por nivel de la cadena — y las cadenas reales tienen uno o dos eslabones. El catálogo
 * es chico y capturado a mano (`ClienteDepartamento`, D13/R16).
 *
 * ⚠️ **NO se limita al cliente de la búsqueda**, a propósito: `armarBusqueda` es un embudo compartido
 * que no siempre sabe de qué cliente se está hablando, y las aristas de fusión sólo existen DENTRO de
 * un cliente (`fusionarDepartamentosCliente` lo exige). Lo único que puede colarse es que dos
 * clientes tengan un departamento con el mismo nombre y uno de ellos lo haya fusionado; el resultado
 * —traer también las órdenes del otro con el nombre hermano— sigue siendo del mismo departamento
 * semántico, y esta búsqueda ya es difusa (`contains`) por diseño.
 */
import type { ContextoBd } from '../../comun/transaccion.js';

import { clienteLectura } from '../../comun/transaccion.js';

/**
 * Tope de NIVELES al recorrer el grupo de fusión. Una cadena real tiene uno o dos eslabones
 * («2-HOMBRE» → «Caballeros»); 20 es holgadísimo, y es el mismo tope que usa `colorCanonico`.
 *
 * Es el **PARACAÍDAS, no la solución**: el recorrido ya no puede dar vueltas (lleva su conjunto de
 * visitados, y un nodo repetido no vuelve a expandirse), y además el dominio no puede cerrar un
 * anillo — la fusión LIMPIA el rastro del canónico y reactivar a mano lo borra. Esta migración
 * tampoco trae backfill (REGLA 0-B), que fue la única fuente conocida de anillos en los colores.
 */
const MAX_NIVELES_FUSION = 20;

/** Fila mínima del catálogo para caminar el grupo de fusión. */
interface NodoFusion {
  id: number;
  nombre: string;
  idFusionadoEn: number | null;
}

/**
 * Nombres SINÓNIMOS que hay que sumar a una búsqueda de texto: los departamentos del mismo grupo de
 * fusión que alguno de los que ya casan con `texto`.
 *
 * Devuelve los nombres **ya recortados** y **sin los que el propio `texto` ya encontraría** (ésos
 * los cubre el `contains` de siempre; repetirlos sólo engordaría el `OR`). Sin coincidencias, sin
 * fusiones o con `texto` vacío devuelve `[]` — y entonces la búsqueda se comporta EXACTAMENTE como
 * antes de esta etapa, que es lo que la hace segura cuando el rastro no está (REGLA 0-B).
 *
 * No verifica permiso: es un ayudante de lectura de la propia consulta, y quien la llama ya pasó su
 * gate (`ordenes.ver`, `costos.ver`, `produccion.wip-ver`).
 */
export async function sinonimosDeDepartamentos(
  texto: string | undefined,
  bd?: ContextoBd,
): Promise<string[]> {
  const buscado = texto?.trim() ?? '';
  if (buscado === '') {
    return [];
  }
  const cliente = clienteLectura(bd);
  const seleccion = { id: true, nombre: true, idFusionadoEn: true } as const;

  // Semilla: los departamentos que el texto ya encuentra por nombre. Si ninguno casa, no hay
  // sinónimo que resolver y se acabó en UNA consulta.
  const semilla: NodoFusion[] = await cliente.clienteDepartamento.findMany({
    where: { nombre: { contains: buscado, mode: 'insensitive' } },
    select: seleccion,
  });
  if (semilla.length === 0) {
    return [];
  }

  const vistos = new Map<number, NodoFusion>(semilla.map((d) => [d.id, d]));
  let frontera = semilla;

  for (let nivel = 0; nivel < MAX_NIVELES_FUSION && frontera.length > 0; nivel++) {
    // ARRIBA: a quién se fue cada uno de la frontera. ABAJO: a quiénes se llevó. Las dos patas van
    // en la MISMA consulta (un `OR`), así que cada nivel cuesta un viaje, no dos.
    const haciaArriba = [
      ...new Set(
        frontera
          .map((d) => d.idFusionadoEn)
          .filter((id): id is number => id !== null && !vistos.has(id)),
      ),
    ];
    const idsFrontera = frontera.map((d) => d.id);
    const vecinos: NodoFusion[] = await cliente.clienteDepartamento.findMany({
      where: {
        OR: [
          ...(haciaArriba.length > 0 ? [{ id: { in: haciaArriba } }] : []),
          { idFusionadoEn: { in: idsFrontera } },
        ],
      },
      select: seleccion,
    });

    frontera = vecinos.filter((d) => !vistos.has(d.id));
    for (const d of frontera) {
      vistos.set(d.id, d);
    }
  }

  // Fuera los que el `contains` de siempre ya trae: sólo interesan los nombres que la búsqueda NO
  // alcanzaría sola.
  const enMinusculas = buscado.toLocaleLowerCase();
  const sinonimos = [...vistos.values()]
    .map((d) => d.nombre.trim())
    .filter((nombre) => nombre !== '' && !nombre.toLocaleLowerCase().includes(enMinusculas));
  return [...new Set(sinonimos)];
}
