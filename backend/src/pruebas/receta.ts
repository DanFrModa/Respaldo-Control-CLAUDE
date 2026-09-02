/**
 * Helper de pruebas: **siembra la RECETA CONGELADA de una orden** copiándola del BOM de su modelo
 * (V1-E3d, §Post-F9.43).
 *
 * POR QUÉ EXISTE. Desde V1-E3d los cuatro consumidores (MRP, habilitación, costeo y el semáforo de
 * "orden completa") leen la receta de la ORDEN, no el BOM del modelo. Los tests de integración que
 * crean órdenes DIRECTO con `cliente.orden.create(...)` —sin pasar por `crearOrden`, que es quien
 * copia la receta— dejarían la orden con la receta VACÍA y probarían un escenario que no existe.
 * Este helper hace lo mismo que hace el alta, para que el fixture siga describiendo lo que quiere
 * describir.
 *
 * ⭐ **«Lo mismo que hace el alta» incluye RESOLVER EL LINAJE** (V1-E9b): la receta de un modelo de
 * producción derivado vive en su modelo de DESARROLLO, y `copiarRecetaDelModelo` la busca ahí con
 * `resolverIdRecetaDeModelo`. Este helper leía el BOM con el `idModelo` pelado, así que con un hijo
 * por color copiaba **cero renglones sin decir nada**; abajo se resuelve igual que el alta, y si aun
 * así no hay nada que sembrar, el helper **lanza** en vez de dejar una orden falsamente vacía.
 *
 * ⚠️ **El precio se deja en NULL a propósito**, igual que el backfill de la migración
 * `20260815140000_receta_en_la_orden`: significa *"esta orden no congeló precio"* y hace que el
 * costeo caiga al catálogo, exactamente como antes de la etapa. Así los fixtures y las
 * expectativas anteriores siguen valiendo. Un test que quiera probar el precio congelado lo escribe
 * él mismo (`opciones.precio` o un update directo).
 */
import type { PrismaClient } from '../datos/index.js';

import { resolverIdRecetaDeModelo } from '../dominio/modelos/receta-compartida.js';

/** Opciones de la siembra. */
export interface OpcionesSembrarReceta {
  /**
   * ¿Dejar la receta LIBERADA (la puerta de compra abierta)? Default `true`, que es lo que hicieron
   * el backfill de la migración y el ETL con las órdenes que ya existían: la puerta es para lo que
   * se compra de aquí en adelante. Un test de la puerta pasa `false`.
   */
  liberada?: boolean;
  /**
   * ⭐⭐ QUIÉN firma la receta. Default: un id de PRUEBA, o sea **una persona**.
   *
   * 🔴 **Antes firmaba con `liberadoPorId: null`, y eso es una TRAMPA ARMADA.** Esa combinación
   * —`liberadoEn` sellado + autor NULL— es exactamente la marca con la que
   * `dominio/produccion/hermanas-de-la-op.ts` reconoce *«esta receta la escribió un backfill, no una
   * persona»* y **la aparta de la comparación entre OP hermanas**. Un fixture que la reprodujera
   * dejaría a sus órdenes fuera del grupo: la primera prueba que sembrara dos hermanas con este
   * helper y esperara un aviso obtendría **SILENCIO**, y parecería que el módulo está roto.
   *
   * Como este helper simula **el alta normal** (lo dice su encabezado), lo honesto es que firme
   * como firma una persona. Un test que quiera de verdad el estado «la firmó la migración» pasa
   * `liberadoPorId: null` a propósito — y entonces sabe lo que está pidiendo.
   */
  liberadoPorId?: string | null;
}

/**
 * Copia el BOM del modelo a la receta de la orden (telas, avíos con sus medidas por talla, y artes).
 * Idempotente: si la orden ya tiene renglones, no hace nada.
 */
export async function sembrarRecetaDeOrden(
  cliente: PrismaClient,
  idOrden: number,
  idModelo: number,
  opciones: OpcionesSembrarReceta = {},
): Promise<void> {
  const liberada = opciones.liberada ?? true;
  // Ver `OpcionesSembrarReceta.liberadoPorId`: firmar con NULL apartaría a la orden de la
  // comparación entre hermanas, que NO es lo que un fixture del alta normal quiere decir.
  const liberadoPorId =
    opciones.liberadoPorId === undefined ? 'usr-pruebas' : opciones.liberadoPorId;

  // ⭐⭐ V1-E9b — **LA RECETA COMPARTIDA, también aquí.** El alta de verdad
  // (`copiarRecetaDelModelo`, `receta-orden.ts`) resuelve el linaje con `resolverIdRecetaDeModelo`
  // ANTES de leer el BOM: un modelo de PRODUCCIÓN derivado (V1-E9a) no tiene receta propia, la
  // **comparte** con su modelo de desarrollo. Este helper lo leía con el `idModelo` pelado, así que
  // sembrar la receta de un hijo por color copiaba **CERO renglones, en silencio** — y una orden sin
  // ni una fila congelada es, para `hermanas-de-la-op.ts`, una orden **sin receta**: queda fuera de
  // la comparación igual que el histórico del Access. Ahí murió la prueba de las dos hermanas.
  const idReceta = await resolverIdRecetaDeModelo(cliente, idModelo);

  const yaTiene = await cliente.ordenTela.count({ where: { idOrden } });
  const yaAvios = await cliente.ordenAvio.count({ where: { idOrden } });
  const yaArtes = await cliente.ordenArte.count({ where: { idOrden } });
  if (yaTiene + yaAvios + yaArtes === 0) {
    const [telas, avios, artes, medidas] = await Promise.all([
      cliente.modeloTela.findMany({ where: { idModelo: idReceta } }),
      cliente.modeloAvio.findMany({ where: { idModelo: idReceta } }),
      cliente.modeloArte.findMany({ where: { idModelo: idReceta } }),
      cliente.modeloAvioTalla.findMany({ where: { idModelo: idReceta } }),
    ]);

    if (telas.length > 0) {
      await cliente.ordenTela.createMany({
        data: telas.map((t) => ({
          idOrden,
          idTela: t.idTela,
          consumoPorPrenda: t.consumoPorPrenda,
          precio: null,
          paraPreCosto: t.paraPreCosto,
          paraProduccion: t.paraProduccion,
          paraCosto: t.paraCosto,
          idTelaProveedor: t.idTelaProveedor,
        })),
      });
    }
    for (const a of avios) {
      const fila = await cliente.ordenAvio.create({
        data: {
          idOrden,
          idAvio: a.idAvio,
          consumoPorPrenda: a.consumoPorPrenda,
          precio: null,
          paraPreCosto: a.paraPreCosto,
          paraProduccion: a.paraProduccion,
          paraCosto: a.paraCosto,
          consumoPorTalla: a.consumoPorTalla,
          idAvioProveedor: a.idAvioProveedor,
        },
        select: { id: true },
      });
      const suyas = medidas.filter((m) => m.idAvio === a.idAvio);
      if (suyas.length > 0) {
        await cliente.ordenAvioTalla.createMany({
          data: suyas.map((m) => ({
            idOrdenAvio: fila.id,
            idTalla: m.idTalla,
            consumo: m.consumo,
            idAvioMedida: m.idAvioMedida,
          })),
        });
      }
    }
    if (artes.length > 0) {
      await cliente.ordenArte.createMany({
        data: artes.map((a) => ({
          idOrden,
          idModeloArte: a.id,
          descripcion: a.descripcion,
          posicion: a.posicion,
          puntadas: a.puntadas,
          precio: a.precio,
          idTipoArte: a.idTipoArte,
          idProveedor: a.idProveedor,
        })),
      });
    }
  }

  const [telasOrden, aviosOrden, artesOrden] = await Promise.all([
    cliente.ordenTela.findMany({ where: { idOrden }, select: { excluido: true } }),
    cliente.ordenAvio.findMany({ where: { idOrden }, select: { excluido: true } }),
    cliente.ordenArte.findMany({ where: { idOrden }, select: { excluido: true } }),
  ]);
  const congelados = [...telasOrden, ...aviosOrden, ...artesOrden];

  /*
   * 🔴 **UN FIXTURE QUE NO SIEMBRA NADA MIENTE EN SILENCIO** — y es exactamente la clase de trampa
   * que este archivo existe para desarmar (ver `OpcionesSembrarReceta.liberadoPorId`).
   *
   * Sin este grito, sembrar sobre un modelo cuyo BOM está vacío —o cuya receta vive en OTRO modelo,
   * el caso del hijo por color de V1-E9b— dejaba la orden **sin una sola fila congelada**, que para
   * medio dominio (el MRP, la habilitación, el costeo, y sobre todo `hermanas-de-la-op.ts`) no es
   * «una receta vacía»: es **una orden que nunca tuvo receta**, o sea histórico del Access. La
   * prueba de al lado se creía apartada por la FIRMA cuando en realidad no había nada que firmar.
   *
   * El fixture no puede corregir eso por su cuenta —no sabe qué quería sembrar el test—, así que
   * lo dice en la cara en vez de dejar pasar un escenario que no existe.
   */
  if (congelados.length === 0) {
    throw new Error(
      `sembrarRecetaDeOrden: el modelo ${String(idModelo)} (receta ${String(idReceta)}) no tiene ` +
        `BOM, así que la orden ${String(idOrden)} se quedó SIN receta congelada — que para el ` +
        'dominio es "esta orden nunca tuvo receta", no "su receta está vacía". Siembra el BOM del ' +
        'modelo (o del modelo de DESARROLLO, si es un hijo por color) ANTES de llamar al helper.',
    );
  }

  // Se libera SOLO si de verdad hay renglones VIVOS: liberar una receta vacía es lo que rechaza
  // `liberarReceta` (y desde la corrección del reviewer, también el backfill y el ETL). Un helper
  // que lo hiciera igual estaría sembrando un estado que el sistema no produce.
  const renglones = congelados.filter((r) => !r.excluido).length;
  if (liberada && renglones > 0) {
    // ⭐ V1-E3h (§Post-F9.72) — LA FIRMA VIVE EN EL RENGLÓN, y la puerta de compra pregunta AHÍ.
    //
    // ⚠️ La lección de este helper: sellar solo `ordenes.receta_liberada_en` fabricaba un estado
    // que **el dominio ya no puede producir** (una orden "liberada" con cero renglones firmados), y
    // con él la puerta contestaba 409 en 46 explosiones de `mrp.int.test.ts` y en dos altas de
    // `ordenes-compra.int.test.ts`. Un fixture que inventa un estado imposible no simplifica: miente.
    //
    // Se firma con la MISMA fecha en los renglones y en la orden —igual que el backfill de
    // `20260819120000_receta_liberada_por_renglon` y que `crearOrdenMigrada`—, pero con un AUTOR
    // (ver `OpcionesSembrarReceta.liberadoPorId`): `liberado_por_id` en NULL significa *"la firmó
    // un backfill"*, y `hermanas-de-la-op.ts` aparta esas órdenes de la comparación.
    const firmadaEn = new Date();
    const firma = { liberadoEn: firmadaEn, liberadoPorId };
    await Promise.all([
      cliente.ordenTela.updateMany({ where: { idOrden }, data: firma }),
      cliente.ordenAvio.updateMany({ where: { idOrden }, data: firma }),
      cliente.ordenArte.updateMany({ where: { idOrden }, data: firma }),
    ]);
    await cliente.orden.update({
      where: { id: idOrden },
      data: { recetaLiberadaEn: firmadaEn, recetaLiberadaPorId: liberadoPorId },
    });
  }
}
