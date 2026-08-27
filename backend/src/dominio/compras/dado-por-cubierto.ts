/**
 * ⭐⭐ **«CON ESTO QUEDA CUBIERTO» — el faltante chico que alguien decidió NO perseguir**
 * (V1-E8e, `DECISIONES.md` §Post-F9.99).
 *
 * DE DÓNDE SALE. Daniel, usando la explosión de materiales en `prueba`:
 *
 * > *"En las telas, compré **480 en lugar de 481** que era el cálculo de la tela. Y me sigue
 * > poniendo que me falta comprar 1 kilo… no sé cómo manejar eso, pero **a veces pasa eso en la
 * > realidad**. Y **no voy a hacer otra OC por 1 kilo**."*
 *
 * Hasta hoy `RequerimientoOrden` sólo guardaba **cuánto se necesita**. No existía el concepto de
 * *"esto ya lo doy por surtido aunque falte un pedacito"*, así que el faltante lo perseguía para
 * siempre: cada explosión volvía a ofrecerle comprar 1 kilo.
 *
 * ── LA REGLA, CON SU RAZÓN ───────────────────────────────────────────────────────────────────────
 *
 * ⭐ **Se pregunta EN EL MOMENTO de decidir, no después.** Cuando el comprador baja la cantidad por
 * debajo de lo que se necesitaba —en la revisión previa, lo que V1-E3z hizo posible—, la pantalla
 * pregunta qué significa: *"el resto sigue pendiente"* o *"con esto queda cubierto"*. Ahí es cuando
 * la persona sabe la respuesta; un interruptor escondido en otra pantalla la obligaría a acordarse
 * y a buscarlo.
 *
 * **Se pregunta SIEMPRE que se baja, sin umbral.** Un umbral sería otro número inventado, y de todos
 * modos es un clic.
 *
 * 🔴 **El default es «sigue pendiente». NUNCA se cierra solo.** Nada de esto pasa por omisión: sin
 * una respuesta explícita, el faltante sigue vivo. Es la mitad de la decisión que protege al
 * sistema de taparle a alguien un faltante que sí importaba.
 *
 * 🔴 **Por qué NO una tolerancia automática** (que es lo primero que se le ocurre a uno, y está
 * descartado con razón): **1 kg de 481 es nada, pero 1 kg de 5 es el 20 %**. Un porcentaje único o
 * **tapa faltantes de verdad** o no sirve. *Que la persona lo diga es más barato y más honesto que
 * adivinarlo.*
 *
 * ── DÓNDE VIVE LA MARCA, Y POR QUÉ NO DONDE PARECÍA ──────────────────────────────────────────────
 *
 * 🔴 **NO puede vivir en `RequerimientoOrden`.** Ese snapshot se **borra y se reescribe ENTERO en
 * cada explosión** (`deleteMany` + recreación, `mrp.ts`). Una bandera ahí se borraría la próxima vez
 * que alguien explotara la orden y **el faltante volvería sin que nadie entendiera por qué**. Vive
 * en su propia tabla (`RequerimientoCubierto`), con una identidad DURABLE: *(orden, material,
 * color)*.
 *
 * ⚠️ **Y el COLOR está en esa identidad porque el neteo razona con él.** Desde V1-E3u (telas,
 * §Post-F9.89) y V1-E8c (avíos, §Post-F9.126) un renglón de explosión ES *(material, color)*: la
 * clave que usan el neteo y la agrupación es {@link claveMaterialColor}, y ésta cuelga de LA MISMA.
 * Una marca por material a secas cubriría el cierre rojo y seguiría pidiendo los otros tres — o
 * peor, los taparía todos.
 *
 * ⚠️ **Es un LIBRO de actos, no un estado que se pisa** (D3, el criterio del kardex): cada acto
 * INSERTA un renglón y lo cubierto es la **Σ de los vivos**. *"Volver a pedirlo"* sella
 * `canceladoEn` y deja de contar — nunca borra, así el rastro de A7 sobrevive a la corrección.
 *
 * ── UN CRITERIO, NO DOS ──────────────────────────────────────────────────────────────────────────
 *
 * El requerimiento queda satisfecho cuando **comprometido + dado-por-cubierto ≥ requerido**, y esa
 * resta se hace en UN solo sitio: {@link pendienteDeComprar} (`comprometido-en-oc.ts`, junto a la
 * única verdad sobre *"cuánto ya compré"*). Este módulo aporta el sumando; no calcula el pendiente
 * por su cuenta.
 *
 * ── 🔴 LO QUE ESTE MÓDULO **NO** GARANTIZA, DICHO EN VEZ DE CALLADO ───────────────────────────────
 *
 * **Dos actos SIMULTÁNEOS sobre el mismo renglón pueden cubrir de más.** No hay lock: los dos leen el
 * mismo pendiente y los dos escriben su acto, así que un renglón de 481 con dos compras de 480 a la
 * vez podría quedar con 2 cubiertos en vez de 1. **No rompe ninguna invariante** —la marca sólo
 * RESTA, nunca vuelve nada negativo, y `pendienteDeComprar` clampa en 0— y las dos personas
 * *pidieron* dejar de perseguirlo; lo peor que pasa es que se deje de comprar un pedacito más de lo
 * que una sola habría cerrado. Los dos actos quedan en la tabla con su autor, y **«volver a
 * pedirlo» los deshace**. Se declara en vez de meter un `pg_advisory_xact_lock` para proteger una
 * invariante que no existe.
 *
 * **Cancelar la OC NO deshace la marca.** El material vuelve a pedirse (la OC deja de cubrir) pero el
 * pedazo cerrado sigue cerrado, así que se compraría de menos. Atarlo exigiría decidir *qué marca*
 * muere con *qué OC* —algo que §Post-F9.99 no dice— y el camino honesto ya existe: «volver a pedirlo».
 *
 * Innegociables: A1 (toda la regla aquí; la ruta valida y delega) · A2 (una transacción) ·
 * A4 (`compras.administrar`, el MISMO permiso que genera las OC: quien compra, decide qué no se
 * compra) · A7 (quién, cuándo, contra qué requerido y con qué cantidad comprada) · A9 (la orden
 * tiene que ser de la empresa activa, o 404).
 */
import type { DatosDarPorCubierto, DarPorCubiertoSalida } from '../../contrato/index.js';

import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorNoEncontrado } from '../../comun/errores.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { clienteLectura, enTransaccion, type ContextoBd } from '../../comun/transaccion.js';
import {
  claveMaterialColor,
  comprometidoEnOc,
  pendienteDeComprar,
  repartirComprometidoPorColor,
  colorDelRenglon,
  claveMaterial,
} from './comprometido-en-oc.js';
import { redondearCantidadCompra, seGuardaComoAlgo } from './reparto-ordenes.js';

/**
 * Lo dado por cubierto de un conjunto de órdenes: `idOrden → (claveMaterialColor → cantidad)`.
 *
 * La cantidad es la **Σ de los actos VIVOS** (los cancelados no cuentan, D3), a la escala de
 * `RequerimientoOrden.cantidadAComprar` (4 decimales) — la misma en la que se decidió.
 */
export type CubiertoPorOrden = Map<number, Map<string, number>>;

/**
 * ⭐ LA función de lectura: cuánto se dio por cubierto, por orden y por renglón *(material, color)*.
 * Lectura pura (no escribe nada): se puede llamar dentro o fuera de una transacción.
 *
 * ⚠️ **No filtra por empresa y no hace falta**, a diferencia de {@link comprometidoEnOc}: una marca
 * cuelga de UNA orden de producción, y quien llama ya verificó (A9) que esas órdenes son de la
 * empresa activa — es la misma razón por la que `estatusMaterialesOrden` lee su snapshot por
 * `idOrden` a secas. Se pide el parámetro igual para que la firma no invite a saltarse esa
 * verificación río arriba.
 *
 * @param idsOrden órdenes de producción a leer; vacío = mapa vacío (no consulta).
 */
export async function dadoPorCubierto(
  idsOrden: readonly number[],
  bd?: ContextoBd,
): Promise<CubiertoPorOrden> {
  const resultado: CubiertoPorOrden = new Map();
  if (idsOrden.length === 0) return resultado;

  const cliente = clienteLectura(bd);
  const filas = await cliente.requerimientoCubierto.findMany({
    // D3: los actos deshechos («volver a pedirlo») siguen ahí para auditarlos, pero dejan de contar.
    where: { idOrden: { in: [...idsOrden] }, canceladoEn: null },
    select: {
      idOrden: true,
      idTela: true,
      idAvio: true,
      idTelaColor: true,
      idColorPrenda: true,
      cantidad: true,
    },
  });

  for (const f of filas) {
    const porClave = resultado.get(f.idOrden) ?? new Map<string, number>();
    const clave = claveMaterialColor(f);
    porClave.set(clave, (porClave.get(clave) ?? 0) + Number(f.cantidad));
    resultado.set(f.idOrden, porClave);
  }
  return resultado;
}

/** Lo dado por cubierto de UN renglón en UNA orden (0 si nadie decidió nada). */
export function cubiertoDe(
  mapa: CubiertoPorOrden,
  idOrden: number,
  renglon: {
    idTela: number | null;
    idAvio: number | null;
    idTelaColor: number | null;
    idColorPrenda: number | null;
  },
): number {
  return mapa.get(idOrden)?.get(claveMaterialColor(renglon)) ?? 0;
}

// ── ⭐⭐ EL REPARTO POR OP DE LO QUE SE DA POR CUBIERTO (desde la revisión previa) ────────────────

/** Una línea del plan, vista por el reparto de lo que se da por cubierto. */
export interface LineaParaCubrir {
  idOrden: number;
  /** Lo que el SISTEMA proponía comprar para esa OP (= su pendiente, ya en escala de la columna). */
  cantidadPropuesta: number;
  /** Lo que se va a comprar de verdad para esa OP, tras el ajuste del comprador. */
  cantidad: number;
  /** ¿Esa línea SÍ se va a escribir? Una que no llega al mínimo guardable no compra nada. */
  seEscribe: boolean;
}

/** Lo que le toca dar por cubierto a UNA OP. */
export interface CubiertoDeUnaOrden {
  idOrden: number;
  cantidad: number;
}

/**
 * ⭐⭐ **A QUÉ OP LE TOCA CADA PEDAZO DEL FALTANTE** (V1-E8e) — función PURA.
 *
 * Un renglón de la revisión previa agrupa varias OP (§Post-F9.86: *se ve junto, se guarda
 * repartido*), pero la marca es de UNA orden. El faltante de cada OP es **lo que se le proponía
 * comprar menos lo que se le va a comprar de verdad**.
 *
 * 🔴 **Una línea que NO se escribe cuenta como comprada en CERO**, no como comprada. Es la
 * diferencia que hace que el renglón cierre de verdad: bajar el total puede dejar a una OP con
 * `0.004`, que la generación se salta (`seEscribe: false`, V1-E3z). Si esa OP se diera por cubierta
 * sólo por su diferencia, se quedaría con una astilla pendiente **para siempre** — el mismo defecto
 * que la etapa vino a cerrar, en chiquito.
 *
 * ⚠️ **Suma exactamente el faltante del renglón** y no hace falta cuadrar nada a mano: la propuesta
 * y el total se reparten entre las OP con la MISMA función (`repartirEntreOrdenes`), y el pendiente
 * de cada OP ya llega redondeado a la escala de la columna, así que `cantidadPropuesta` de una OP es
 * **exactamente** su pendiente. Repartir el faltante con una segunda regla propia sería justo la
 * clase de cálculo paralelo que se desincroniza.
 *
 * @returns una entrada por OP con faltante (> 0); las que se compran completas no aparecen.
 */
export function repartoDadoPorCubierto(lineas: readonly LineaParaCubrir[]): CubiertoDeUnaOrden[] {
  const salida: CubiertoDeUnaOrden[] = [];
  for (const l of lineas) {
    const comprada = l.seEscribe ? l.cantidad : 0;
    const faltante = redondearCantidadCompra(Math.max(0, l.cantidadPropuesta - comprada));
    if (!seGuardaComoAlgo(faltante)) continue;
    salida.push({ idOrden: l.idOrden, cantidad: faltante });
  }
  return salida;
}

// ── ⭐⭐ LA OPERACIÓN (la segunda puerta: dar por cubierto DESDE la explosión) ────────────────────

/**
 * ⭐⭐ **DAR POR CUBIERTO —o VOLVER A PEDIR— DESDE EL RENGLÓN DE LA EXPLOSIÓN** (§Post-F9.99).
 *
 * La decisión pide dos puertas, y ésta es la segunda: *"un «dar por cubierto» desde la explosión,
 * para los casos que **ya se escaparon** — como el que originó esto, que ya estaba generado"*. La
 * primera (la de la revisión previa) vive en `mrp.ts`, en el mismo acto de generar la OC.
 *
 * **Qué hace, exactamente:**
 *  • `cubierto: true` — da por cubierto **lo que hoy falta** de cada renglón nombrado. Lo que falta
 *    lo calcula el SERVIDOR con el criterio único ({@link pendienteDeComprar}), no la pantalla (A1):
 *    lo que el comprador está diciendo es *"esto ya no me lo pidas"*, no un número.
 *  • `cubierto: false` — **«volver a pedirlo»**: cancela (suave, D3) todos los actos vivos de esos
 *    renglones. El faltante reaparece tal cual, y el rastro de quién lo había cerrado se conserva.
 *
 * ⚠️ **Es idempotente por construcción.** Darlo por cubierto dos veces no escribe el segundo acto:
 * la segunda vez ya no falta nada (`pendiente = 0`) y no hay qué cubrir. No hace falta una guarda
 * aparte — el propio criterio es la guarda.
 *
 * ⚠️ **Los ids de snapshot son una DIRECCIÓN, no la identidad.** Se resuelven a *(orden, material,
 * color)* dentro de la misma transacción y lo que se guarda es eso: si alguien vuelve a explotar
 * después, los ids cambian pero la marca sigue en pie. (Es el mismo trato que ya reciben en
 * `generar-oc`: la selección viaja por id y el dominio la traduce.)
 *
 * A9: cualquier renglón cuya orden no sea de la empresa activa —o que no exista— responde 404 con
 * su id. Permiso `compras.administrar`.
 */
export async function darPorCubierto(
  sesion: SesionUsuario,
  datos: DatosDarPorCubierto,
  bd?: ContextoBd,
): Promise<DarPorCubiertoSalida> {
  verificarPermiso(sesion, 'compras.administrar');
  const idEmpresa = sesion.idEmpresaActiva;
  const ids = [...new Set(datos.idsRequerimiento)];

  return enTransaccion(async (tx) => {
    // A9 primero: el snapshot se filtra por la EMPRESA de su orden. Un renglón ajeno no existe.
    const filas = await tx.requerimientoOrden.findMany({
      where: { id: { in: ids }, orden: { idEmpresa } },
      select: {
        id: true,
        idOrden: true,
        idTela: true,
        idAvio: true,
        idTelaColor: true,
        idColorPrenda: true,
        unidad: true,
        cantidadAComprar: true,
        tela: { select: { nombre: true } },
        avio: { select: { clave: true, descripcion: true } },
        telaColor: { select: { nombre: true } },
        colorPrenda: { select: { nombre: true } },
        orden: { select: { folio: true } },
      },
      // Determinista: con dos renglones del mismo material la bitácora tiene que salir siempre igual.
      orderBy: [{ idOrden: 'asc' }, { id: 'asc' }],
    });
    const encontrados = new Set(filas.map((f) => f.id));
    const ajeno = ids.find((id) => !encontrados.has(id));
    if (ajeno !== undefined) {
      throw new ErrorNoEncontrado('Requerimiento', ajeno);
    }

    const idsOrden = [...new Set(filas.map((f) => f.idOrden))];
    const comprometido = await comprometidoEnOc(idEmpresa, idsOrden, { tx });
    const cubierto = await dadoPorCubierto(idsOrden, { tx });

    /**
     * ⚠️ El `enOc` de cada renglón se resuelve con la MISMA regla del acervo sin color que usan la
     * explosión y el plan (`repartirComprometidoPorColor`), y por eso hace falta ver JUNTOS a todos
     * los hermanos del mismo material de la misma OP. Calcularlo con `comprometidoDe` a secas —el
     * total del material— le daría a cada color el `enOc` de todos y el pendiente saldría en cero:
     * daríamos por cubierto **cero** y el comprador se quedaría con su faltante y sin aviso.
     */
    const enOcPorFila = new Map<number, number>();
    {
      // 🔴 Se leen TODOS los renglones de esas órdenes, no sólo los nombrados: los hermanos que el
      // comprador no marcó siguen siendo parte del reparto del acervo sin color.
      const hermanos = await tx.requerimientoOrden.findMany({
        where: { idOrden: { in: idsOrden } },
        select: {
          id: true,
          idOrden: true,
          idTela: true,
          idAvio: true,
          idTelaColor: true,
          idColorPrenda: true,
          cantidadAComprar: true,
        },
        orderBy: [{ idOrden: 'asc' }, { id: 'asc' }],
      });
      const porOrdenMaterial = new Map<string, typeof hermanos>();
      for (const f of hermanos) {
        const llave = `${String(f.idOrden)}|${claveMaterial(f)}`;
        const grupo = porOrdenMaterial.get(llave) ?? [];
        grupo.push(f);
        porOrdenMaterial.set(llave, grupo);
      }
      for (const grupo of porOrdenMaterial.values()) {
        const cabeza = grupo[0];
        if (cabeza === undefined) continue;
        const repartido = repartirComprometidoPorColor(
          grupo.map((f) => ({
            idColor: colorDelRenglon(f),
            cantidadAComprar: Number(f.cantidadAComprar),
          })),
          comprometido.get(cabeza.idOrden)?.get(claveMaterial(cabeza)),
        );
        grupo.forEach((f, i) => {
          enOcPorFila.set(f.id, repartido[i]?.enOc ?? 0);
        });
      }
    }

    const nombreDe = (f: (typeof filas)[number]): string => {
      const material =
        f.tela?.nombre ?? (f.avio === null ? '—' : `${f.avio.clave} — ${f.avio.descripcion}`);
      const color = f.telaColor?.nombre ?? f.colorPrenda?.nombre ?? null;
      return color === null ? material : `${material} · ${color}`;
    };

    const afectados: DarPorCubiertoSalida['afectados'] = [];

    for (const f of filas) {
      const enOc = enOcPorFila.get(f.id) ?? 0;
      const yaCubierto = cubiertoDe(cubierto, f.idOrden, f);
      if (datos.cubierto) {
        const pendiente = pendienteDeComprar(Number(f.cantidadAComprar), enOc, yaCubierto);
        // Nada que cubrir = nada que escribir. Es lo que vuelve idempotente a la operación, y
        // también lo que evita guardar un acto de cero que después nadie sabría interpretar.
        if (!seGuardaComoAlgo(pendiente)) continue;
        await tx.requerimientoCubierto.create({
          data: {
            idOrden: f.idOrden,
            idTela: f.idTela,
            idAvio: f.idAvio,
            idTelaColor: f.idTelaColor,
            idColorPrenda: f.idColorPrenda,
            cantidad: pendiente,
            // RASTRO (A7): contra qué requerido y con qué comprado se tomó la decisión. NO se usa
            // para calcular después —el cálculo lee siempre el snapshot vivo—, se guarda para poder
            // reconstruir la decisión tal como se tomó.
            cantidadRequerida: Number(f.cantidadAComprar),
            cantidadComprada: enOc,
            origen: 'explosion',
            ...datosCreacion(sesion),
          },
        });
        afectados.push({
          idRequerimiento: f.id,
          idOrden: f.idOrden,
          folioOrden: Number(f.orden.folio),
          material: nombreDe(f),
          unidad: f.unidad,
          cantidad: pendiente,
        });
        continue;
      }
      // ── VOLVER A PEDIRLO: cancelación SUAVE de los actos vivos de ESE renglón (D3) ──
      const vivos = await tx.requerimientoCubierto.findMany({
        where: {
          idOrden: f.idOrden,
          idTela: f.idTela,
          idAvio: f.idAvio,
          idTelaColor: f.idTelaColor,
          idColorPrenda: f.idColorPrenda,
          canceladoEn: null,
        },
        select: { id: true, cantidad: true },
      });
      if (vivos.length === 0) continue;
      await tx.requerimientoCubierto.updateMany({
        where: { id: { in: vivos.map((v) => v.id) } },
        data: {
          canceladoEn: new Date(),
          canceladoPorId: sesion.id,
          ...datosModificacion(sesion),
        },
      });
      afectados.push({
        idRequerimiento: f.id,
        idOrden: f.idOrden,
        folioOrden: Number(f.orden.folio),
        material: nombreDe(f),
        unidad: f.unidad,
        cantidad: redondearCantidadCompra(vivos.reduce((s, v) => s + Number(v.cantidad), 0)),
      });
    }

    if (afectados.length > 0) {
      await registrarBitacora(tx, sesion, {
        entidad: 'Orden',
        // La bitácora cuelga de la PRIMERA orden tocada y nombra a todas: es un solo acto del
        // comprador aunque roce varias OP (el mismo criterio que el acto en bloque de §Post-F9.88).
        idEntidad: afectados[0]?.idOrden ?? 0,
        accion: datos.cubierto ? 'OTRO' : 'CANCELAR',
        datos: {
          dadoPorCubierto: datos.cubierto,
          origen: 'explosion',
          renglones: afectados.map((a) => ({
            idOrden: a.idOrden,
            folioOrden: a.folioOrden,
            material: a.material,
            cantidad: a.cantidad,
          })),
        },
      });
    }

    return { cubierto: datos.cubierto, afectados };
  }, bd);
}
