/**
 * COSTO REAL por orden (F7-E1; doc 06-Costos-y-EDR §3; DECISIONES.md D1/D2). Toda la lógica vive AQUÍ
 * (A1); las rutas solo validan permiso + Zod y delegan.
 *
 * TRES orígenes del costo de materiales (los dos primeros de doc 06 §3; el REAL lo pidió DANIEL el
 * 26-jul-2026, `DECISIONES.md` §Post-F9.5):
 *  • TEÓRICO (`*Calc`) — calculado de la **RECETA CONGELADA DE LA ORDEN** `paraCosto` (V1-E3d,
 *    §Post-F9.43) × su precio congelado (o el de catálogo si esa orden no congeló ninguno), referido
 *    a las piezas CORTADAS (la producción):
 *      telaPorPrenda   = Σ ( OrdenTela.consumoPorPrenda × (OrdenTela.precio ?? Tela.precioSugerido) )
 *      aviosPorPrenda  = Σ ( OrdenAvio.consumoPorPrenda × (OrdenAvio.precio ?? Avio.precioReferencia) )
 *      procesosPorPrenda = (maquilaOrd ?? modelo.maquilaBase) + (aplicacionOrd ?? 0) + Σ artes de la OP
 *      tela/avios/procesos (TOTALES) = por-prenda × cortado
 *    La REGALÍA NO entra (D2): va sobre la venta (lista de precios).
 *  • REAL DE COMPRAS (`*Real`) — lo REALMENTE comprado: Σ de las líneas de OC autorizada+ ligadas a
 *    la orden, más el consumo sin compra propia valuado a ÚLTIMO PRECIO DE COMPRA (genéricos y
 *    compras compartidas entre órdenes). Vive en `costo-real-compras.ts`; aquí solo se consume.
 *    Solo aplica a TELA y AVÍOS (los procesos no se compran con OC de material).
 *  • GUARDADO (`*Cost`) — lo que el usuario confirma o AJUSTA; `costoTotal` = Σ de los GUARDADOS
 *    (`telaCost + procesosCost + aviosCost + otros`). Es el dinero que manda.
 *
 * Costo unitario = `costoTotal` ÷ base de prorrateo (D2). ⭐ Desde 0.061 el default es `recibido`
 * (piezas recibidas de costura, §Post-F9.154(b)); hasta esa versión fue `cortado`. Cambiar la base
 * cambia el unitario porque el total es fijo y el divisor varía.
 *
 * Innegociables: A1, A2 (guardar es transacción), A4 (`costos.ver`/`costos.capturar`), A7 (Bitácora,
 * módulo financiero), A9 (empresa activa). Importes en `null` sin `consultas.ver-importes`. Una orden
 * marcada `noCostear` NO se puede costear (se rechaza con mensaje claro).
 */
import type {
  CostoOrdenGuardarCuerpo,
  CostoOrdenSalida,
  ListaCostosPagina,
  ListaCostosQuery,
} from '../../contrato/index.js';
import { Prisma } from '../../datos/index.js';
import { esquemaCostoOrdenGuardarCuerpo, esquemaListaCostosQuery } from '../../contrato/index.js';
import type { z } from 'zod';

import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado } from '../../comun/errores.js';
import { verificarPermiso, tienePermiso, type SesionUsuario } from '../../comun/permisos.js';
import { clienteLectura, enTransaccion, type ContextoBd } from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

import { exigirOrdenAbierta } from '../produccion/cierre-orden.js';
import { armarBusquedaConSinonimos } from '../produccion/ordenes.js';

import {
  BASE_PRORRATEO_DEFAULT,
  baseProrrateoAGuardar,
  cantidadDeBase,
  cantidadesDeOrden,
  cantidadesDeOrdenes,
  divisorCongelado,
  unitarioODeuda,
  type CantidadesOrden,
} from './cantidades.js';
import {
  calcularCostoRealDeOrden,
  realVacio,
  resumenReal,
  type RealDeOrden,
} from './costo-real-compras.js';
import { num, redondear2 } from './decimales.js';

/** Cliente de LECTURA. */
type ClienteLectura = ReturnType<typeof clienteLectura>;

/**
 * `select` de la orden con su RECETA CONGELADA `paraCosto` y su costo guardado. Es un SUPERCONJUNTO
 * de `seleccionOrdenReal` (`costo-real-compras.ts`): trae también el `idTela`/`idAvio` y el
 * nombre/unidad de cada material, para que el motor del costo REAL pueda reusar esta MISMA lectura
 * (una sola consulta de la orden, también dentro de la transacción de guardado).
 */
const seleccionOrdenCosto = {
  id: true,
  folio: true,
  idEmpresa: true,
  idModelo: true,
  idCliente: true,
  noCostear: true,
  // ⭐ 0.061: el cierre de la orden. `cerradaEn` decide DOS cosas: que no se pueda capturar su
  // costo, y que la lectura devuelva el unitario CONGELADO en vez de recalcularlo en vivo.
  estado: true,
  cerradaEn: true,
  maquilaOrd: true,
  aplicacionOrd: true,
  cliente: { select: { nombre: true } },
  modelo: { select: { codigo: true, descripcion: true, maquilaBase: true } },
  // ⭐ V1-E3d (§Post-F9.43): el costeo lee la RECETA CONGELADA DE LA ORDEN, no el BOM del modelo.
  // Los renglones EXCLUIDOS (la jareta que esta orden no lleva) quedan fuera en la consulta: no se
  // costean. Es el "cuesten distinto" del criterio de cierre de la etapa.
  recetaTelas: {
    where: { paraCosto: true, excluido: false },
    select: {
      idTela: true,
      consumoPorPrenda: true,
      precio: true,
      tela: { select: { nombre: true, unidadMedida: true, precioSugerido: true } },
    },
  },
  recetaAvios: {
    where: { paraCosto: true, excluido: false },
    select: {
      idAvio: true,
      consumoPorPrenda: true,
      precio: true,
      avio: {
        select: {
          clave: true,
          descripcion: true,
          unidad: true,
          precioReferencia: true,
          esGenerico: true,
        },
      },
    },
  },
  recetaArtes: { where: { excluido: false }, select: { precio: true } },
  costoOrden: true,
} satisfies Prisma.OrdenSelect;

type OrdenConCosto = Prisma.OrdenGetPayload<{ select: typeof seleccionOrdenCosto }>;

/** Costo TEÓRICO por prenda (los tres componentes), determinista sobre la receta paraCosto. */
export interface TeoricoPorPrenda {
  tela: number;
  avios: number;
  procesos: number;
}

/**
 * Calcula el costo teórico POR PRENDA de una orden (**receta de la ORDEN** × precio + procesos).
 *
 * ⭐ V1-E3d (§Post-F9.43): el precio de cada renglón es **el que la orden congeló**; si esa orden no
 * congeló ninguno (`precio` NULL: recetas anteriores a esta etapa, backfilleadas por la migración)
 * cae al precio de catálogo, que es exactamente lo que hacía antes. Así el histórico costea igual
 * que ayer y lo nuevo costea con SU precio — que es lo que Daniel pidió: *"el precio del modelo es
 * referencia; el real se define en la OP"*.
 */
export function teoricoPorPrenda(orden: OrdenConCosto): TeoricoPorPrenda {
  const tela = orden.recetaTelas.reduce(
    (s, t) =>
      s +
      num(t.consumoPorPrenda) *
        (t.precio === null ? num(t.tela.precioSugerido) : t.precio.toNumber()),
    0,
  );
  const avios = orden.recetaAvios.reduce(
    (s, a) =>
      s +
      num(a.consumoPorPrenda) *
        (a.precio === null ? num(a.avio.precioReferencia) : a.precio.toNumber()),
    0,
  );
  // ARTE: desde V1-E3d el arte vive congelado en la ORDEN, con SU precio (§Post-F9.35: "el precio
  // del modelo es referencia; el real se define en la OP"). ⚠️ Entra UNA vez, SIN multiplicar por
  // cantidad — invariante heredada de la pieza A y cubierta por `costo-orden.test.ts`.
  const arte = orden.recetaArtes.reduce((s, a) => s + num(a.precio), 0);
  // Maquila de la ORDEN (fallback a la base del modelo) + estampado/aplicación + arte.
  const maquila =
    orden.maquilaOrd == null ? num(orden.modelo.maquilaBase) : orden.maquilaOrd.toNumber();
  const aplicacion = num(orden.aplicacionOrd);
  const procesos = maquila + aplicacion + arte;
  return { tela, avios, procesos };
}

/** Proyecta una orden + sus cantidades + su costo a la forma del contrato (ocultando importes). */
function aCostoOrdenSalida(
  orden: OrdenConCosto,
  cant: CantidadesOrden,
  real: RealDeOrden,
  verImportes: boolean,
): CostoOrdenSalida {
  // Sin `consultas.ver-importes` TODO importe va a null; con él se redondea (o null si es nulo real).
  const money = (v: number | null): number | null =>
    verImportes ? (v === null ? null : redondear2(v)) : null;

  const pp = teoricoPorPrenda(orden);
  const cortado = cant.cortado;
  const teoTela = pp.tela * cortado;
  const teoAvios = pp.avios * cortado;
  const teoProcesos = pp.procesos * cortado;
  const teoTotal = teoTela + teoAvios + teoProcesos;

  const g = orden.costoOrden;
  const guardado = g
    ? {
        telaCalc: money(g.telaCalc == null ? null : g.telaCalc.toNumber()),
        telaCost: money(g.telaCost == null ? null : g.telaCost.toNumber()),
        telaReal: money(g.telaReal == null ? null : g.telaReal.toNumber()),
        procesosCalc: money(g.procesosCalc == null ? null : g.procesosCalc.toNumber()),
        procesosCost: money(g.procesosCost == null ? null : g.procesosCost.toNumber()),
        aviosCalc: money(g.aviosCalc == null ? null : g.aviosCalc.toNumber()),
        aviosCost: money(g.aviosCost == null ? null : g.aviosCost.toNumber()),
        aviosReal: money(g.aviosReal == null ? null : g.aviosReal.toNumber()),
        otros: money(g.otros == null ? null : g.otros.toNumber()),
        descOtros: g.descOtros,
        costoTotal: money(g.costoTotal == null ? null : g.costoTotal.toNumber()),
        baseProrrateo: g.baseProrrateo,
        observaciones: g.observaciones,
        creadoEn: g.creadoEn.toISOString(),
        modificadoEn: g.modificadoEn.toISOString(),
      }
    : null;

  // Costo unitario: del guardado (total ÷ base guardada) o, si aún no se costea, del teórico ÷ la
  // base POR DEFECTO (`recibido` desde 0.061 — antes `cortado`; ver `cantidades.ts`).
  const base = g ? g.baseProrrateo : BASE_PRORRATEO_DEFAULT;
  const totalParaUnit = g ? (g.costoTotal == null ? null : g.costoTotal.toNumber()) : teoTotal;
  // ⭐⭐ 0.061 — CONGELADO vs EN VIVO (§Post-F9.154(c)). La orden CERRADA devuelve el divisor y el
  // unitario que se persistieron al cerrarla; la ABIERTA los recalcula en cada lectura, como
  // siempre. Es la diferencia entre "el costo ya se cerró" y "el costo va cambiando", que es
  // exactamente lo que Daniel preguntó.
  const congeladoEn = orden.cerradaEn === null ? null : (g?.congeladoEn ?? null);
  const congelado = divisorCongelado(orden, g);
  const cantidadBase = congelado ?? cantidadDeBase(cant, base);
  // La regla ÚNICA decide el unitario Y por qué falta cuando falta (`unitarioODeuda`): la misma que
  // usa la lista de costos, para que las dos puertas no redacten distinto. Con la orden cerrada
  // recibe el divisor congelado, así que el resultado tampoco puede moverse.
  const unit = unitarioODeuda(totalParaUnit, cantidadBase, base, verImportes);

  return {
    idOrden: orden.id,
    folio: Number(orden.folio),
    idModelo: orden.idModelo,
    codigoModelo: orden.modelo.codigo,
    descripcionModelo: orden.modelo.descripcion,
    idCliente: orden.idCliente,
    cliente: orden.cliente.nombre,
    noCostear: orden.noCostear,
    cantidades: {
      pedido: cant.pedido,
      cortado: cant.cortado,
      recibido: cant.recibido,
      vendido: cant.vendido,
    },
    teorico: {
      telaPorPrenda: money(pp.tela),
      aviosPorPrenda: money(pp.avios),
      procesosPorPrenda: money(pp.procesos),
      tela: money(teoTela),
      avios: money(teoAvios),
      procesos: money(teoProcesos),
      total: money(teoTotal),
    },
    real: resumenReal(real, verImportes),
    guardado,
    unitario: {
      base,
      cantidadBase,
      costoUnitario: money(unit.costoUnitario),
      motivoSinUnitario: unit.motivoSinUnitario,
      textoSinUnitario: unit.textoSinUnitario,
      // Con valor, la pantalla sabe que estos números NO se van a mover más (0.061).
      congeladoEn: congeladoEn === null ? null : congeladoEn.toISOString(),
    },
    // ⭐ 0.061: la orden CERRADA no admite captura de costo (lo rechaza `guardarCostoOrden`).
    ordenCerrada: orden.cerradaEn !== null,
  };
}

/** Obtiene una orden de la empresa activa con su receta+costo, o lanza `ErrorNoEncontrado`. */
async function ordenConCosto(
  sesion: SesionUsuario,
  idOrden: number,
  cliente: ClienteLectura,
): Promise<OrdenConCosto> {
  const orden = await cliente.orden.findFirst({
    where: { id: idOrden, idEmpresa: sesion.idEmpresaActiva },
    select: seleccionOrdenCosto,
  });
  if (orden === null) {
    throw new ErrorNoEncontrado('Orden', idOrden);
  }
  return orden;
}

/**
 * COSTO de una orden (A4 `costos.ver`, A9): los TRES orígenes juntos — el TEÓRICO en vivo (receta ×
 * precios de catálogo), el REAL de compras (lo comprado en OC + lo valuado a último precio, petición
 * de Daniel del 26-jul-2026) y el GUARDADO (o null si aún no se costea) — más las cantidades
 * derivadas y el costo unitario. Importes en `null` sin `consultas.ver-importes`.
 */
export async function obtenerCostoOrden(
  sesion: SesionUsuario,
  idOrden: number,
  bd?: ContextoBd,
): Promise<CostoOrdenSalida> {
  verificarPermiso(sesion, 'costos.ver');
  const cliente = clienteLectura(bd);
  const orden = await ordenConCosto(sesion, idOrden, cliente);
  const [cant, real] = await Promise.all([
    cantidadesDeOrden(idOrden, bd),
    calcularCostoRealDeOrden(orden, bd),
  ]);
  return aCostoOrdenSalida(orden, cant, real, tienePermiso(sesion, 'consultas.ver-importes'));
}

/** Opciones de `guardarCostoOrden` (hoy solo la de migración). */
export interface OpcionesGuardarCosto {
  /**
   * ¿Calcular (y congelar) el REAL de compras? Default `true` — es el camino interactivo.
   * El **ETL de migración** lo apaga (`false`): manda los tres componentes EXPLÍCITOS del CSV viejo,
   * así que el real no se usaría para ningún default, y calcularlo por cada una de las ~2,500
   * órdenes históricas costaría un puñado de consultas por orden **para congelar un número de HOY en
   * una orden de los 90** — justo lo contrario de lo que documenta la columna `*Real`. Con `false`
   * las columnas `telaReal`/`aviosReal` NO se tocan (quedan NULL, o conservan lo que hubiera).
   */
  calcularReal?: boolean;
}

/**
 * GUARDA (crea o ajusta) el costo de una orden (A4 `costos.capturar`, A2 transacción, A7 Bitácora).
 * Congela el TEÓRICO al momento (`*Calc`) y el REAL de compras (`*Real`), toma los GUARDADOS del
 * cuerpo, arma `costoTotal` = Σ guardados y persiste. RECHAZA si la orden está marcada `noCostear`.
 *
 * QUÉ PASA CON UN COMPONENTE QUE **NO VIENE** EN EL CUERPO (`undefined`):
 *  • Si la orden **YA estaba costeada**, se **CONSERVA** el valor guardado. "Lo ya costeado no se
 *    mueve" (Daniel): omitir un campo NUNCA lo pisa. Para borrarlo hay que mandar `null` explícito.
 *  • Si es el **PRIMER** costeo, cae a su DEFAULT: `telaCost`/`aviosCost` al **REAL de compras**
 *    cuando la orden tiene compras ligadas y autorizadas (cambio pedido por DANIEL, 26-jul-2026), y
 *    al teórico congelado cuando no las tiene (el comportamiento anterior). `procesosCost` cae
 *    SIEMPRE al teórico (los procesos no se compran con OC de material).
 * Lo mismo aplica a `otros`/`descOtros`/`observaciones`: omitir = conservar; `null` = borrar.
 *
 * ⭐ **`baseProrrateo` YA NO es la excepción a "omitir = conservar" (0.061).** Hasta esta versión su
 * esquema Zod traía `.default('cortado')`, así que nunca llegaba `undefined` al dominio: **un PUT
 * que la omitiera PISABA la base de una orden ya costeada** y le cambiaba el costo unitario sin que
 * nadie lo pidiera (el total no se mueve; el divisor sí). Era un defecto latente documentado como
 * decisión — y al pasar el default a `recibido` (§Post-F9.154(b)) habría dejado de ser latente: cada
 * PUT descuidado habría reescrito la base de las órdenes viejas. Hoy el campo es `.optional()` SIN
 * default y se comporta como todos los demás:
 *  • si la orden YA estaba costeada, omitirlo CONSERVA la base guardada;
 *  • si es el PRIMER costeo, cae a {@link BASE_PRORRATEO_DEFAULT} (`recibido`).
 * La respuesta sigue garantizando que `baseProrrateo` viene siempre (es la fila guardada, no el
 * cuerpo). El ETL de migración, que la omitía adrede para tomar el default, ahora toma `recibido` en
 * el primer costeo — y eso es justo lo que la decisión pide para lo que se capture de aquí en
 * adelante (REGLA 0-B: el histórico ya costeado NO se reescribe).
 *
 * El objeto de salida se arma con lo que esta misma función ya leyó/escribió: **no se recalcula** el
 * costo real para responder. Consecuencia deliberada: a diferencia de antes (cuando el retorno
 * pasaba por `obtenerCostoOrden`), aquí **ya NO se re-verifica `costos.ver`** — se considera
 * implicado por `costos.capturar` (quien captura, ve lo que captura), la ruta ya exige
 * `costos.capturar` (A4) y el ocultamiento de importes sigue gobernado por `consultas.ver-importes`.
 */
export async function guardarCostoOrden(
  sesion: SesionUsuario,
  idOrden: number,
  cuerpo: z.input<typeof esquemaCostoOrdenGuardarCuerpo>,
  bd?: ContextoBd,
  opciones: OpcionesGuardarCosto = {},
): Promise<CostoOrdenSalida> {
  verificarPermiso(sesion, 'costos.capturar');
  const datos: CostoOrdenGuardarCuerpo = validarEntrada(esquemaCostoOrdenGuardarCuerpo, cuerpo);
  const calcularReal = opciones.calcularReal ?? true;

  return enTransaccion(async (tx) => {
    const orden = await tx.orden.findFirst({
      where: { id: idOrden, idEmpresa: sesion.idEmpresaActiva },
      select: seleccionOrdenCosto,
    });
    if (orden === null) {
      throw new ErrorNoEncontrado('Orden', idOrden);
    }
    if (orden.noCostear) {
      throw new ErrorConflicto(
        'Esta orden está marcada como "no costear": no se puede capturar su costo.',
      );
    }
    // ⭐ 0.061: la orden CERRADA tiene el costo congelado — capturarlo lo movería. Guarda ÚNICA.
    exigirOrdenAbierta(orden, 'puede capturar su costo');

    // Teórico congelado (× cortado) al momento de guardar (usa la MISMA transacción, A2).
    const cant = await cantidadesDeOrden(idOrden, { tx });
    const pp = teoricoPorPrenda(orden);
    const telaCalc = redondear2(pp.tela * cant.cortado);
    const procesosCalc = redondear2(pp.procesos * cant.cortado);
    const aviosCalc = redondear2(pp.avios * cant.cortado);

    // REAL de compras congelado al momento de guardar (misma transacción, A2). Una sola vez.
    const real: RealDeOrden = calcularReal
      ? await calcularCostoRealDeOrden(orden, { tx })
      : realVacio();
    const telaReal = real.calculado.tela;
    const aviosReal = real.calculado.avios;

    // Defaults del PRIMER costeo (con compras ⇒ el real; sin compras ⇒ el teórico).
    const previo = orden.costoOrden;
    const defaultTela = real.calculado.hayCompras ? telaReal : telaCalc;
    const defaultAvios = real.calculado.hayCompras ? aviosReal : aviosCalc;

    /** Omitir un campo CONSERVA lo guardado; si es el primer costeo, cae a su default. */
    const resolver = (
      delCuerpo: number | null | undefined,
      guardado: Prisma.Decimal | null | undefined,
      porDefecto: number | null,
    ): number | null => {
      if (delCuerpo !== undefined) return delCuerpo;
      if (previo !== null) return guardado?.toNumber() ?? null;
      return porDefecto;
    };

    // La base sigue la MISMA regla que los importes (0.061): omitir conserva; el primer costeo cae
    // al default. No pasa por `resolver` porque no es un Decimal ni admite `null`; la regla vive
    // PURA en `cantidades.ts` para poder probarla sin BD.
    const baseProrrateo = baseProrrateoAGuardar(datos.baseProrrateo, previo?.baseProrrateo);

    const telaCost = resolver(datos.telaCost, previo?.telaCost, defaultTela);
    const procesosCost = resolver(datos.procesosCost, previo?.procesosCost, procesosCalc);
    const aviosCost = resolver(datos.aviosCost, previo?.aviosCost, defaultAvios);
    const otros = resolver(datos.otros, previo?.otros, null);
    const descOtros = datos.descOtros !== undefined ? datos.descOtros : (previo?.descOtros ?? null);
    const observaciones =
      datos.observaciones !== undefined ? datos.observaciones : (previo?.observaciones ?? null);

    const costoTotal = redondear2(
      (telaCost ?? 0) + (procesosCost ?? 0) + (aviosCost ?? 0) + (otros ?? 0),
    );

    const comunes = {
      telaCalc: new Prisma.Decimal(telaCalc),
      procesosCalc: new Prisma.Decimal(procesosCalc),
      aviosCalc: new Prisma.Decimal(aviosCalc),
      // Solo se sella el real cuando de verdad se calculó (el ETL de migración no lo hace).
      ...(calcularReal
        ? { telaReal: new Prisma.Decimal(telaReal), aviosReal: new Prisma.Decimal(aviosReal) }
        : {}),
      telaCost: telaCost === null ? null : new Prisma.Decimal(telaCost),
      procesosCost: procesosCost === null ? null : new Prisma.Decimal(procesosCost),
      aviosCost: aviosCost === null ? null : new Prisma.Decimal(aviosCost),
      otros: otros === null ? null : new Prisma.Decimal(otros),
      descOtros,
      costoTotal: new Prisma.Decimal(costoTotal),
      baseProrrateo,
      observaciones,
    };

    const yaExiste = previo !== null;
    const guardado = await tx.costoOrden.upsert({
      where: { idOrden },
      create: {
        idOrden,
        idEmpresa: orden.idEmpresa,
        ...comunes,
        ...datosCreacion(sesion),
      },
      update: { ...comunes, ...datosModificacion(sesion) },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'CostoOrden',
      idEntidad: idOrden,
      accion: yaExiste ? 'MODIFICAR' : 'CREAR',
      datos: {
        telaCost,
        procesosCost,
        aviosCost,
        otros,
        costoTotal,
        baseProrrateo,
        ...(calcularReal
          ? { telaReal, aviosReal, realDeCompras: real.calculado.hayCompras }
          : { realOmitido: true }),
      },
    });

    // La salida se arma con lo que ya está en memoria (orden + cantidades + real + fila guardada):
    // NO se vuelve a calcular el real ni se relee la orden.
    return aCostoOrdenSalida(
      { ...orden, costoOrden: guardado },
      cant,
      real,
      tienePermiso(sesion, 'consultas.ver-importes'),
    );
  }, bd);
}

/**
 * LISTA DE COSTOS (ex `ListaCostos`): órdenes YA costeadas de la empresa activa (A9), con su costo
 * total y unitario. Filtros por modelo/cliente + búsqueda (folio/modelo/cliente/referencia D7). Solo
 * lectura (`costos.ver`). Importes en `null` sin `consultas.ver-importes`. Paginación de SERVIDOR.
 */
export async function listarCostos(
  sesion: SesionUsuario,
  parametros: z.input<typeof esquemaListaCostosQuery> = {},
  bd?: ContextoBd,
): Promise<ListaCostosPagina> {
  verificarPermiso(sesion, 'costos.ver');
  const filtros: ListaCostosQuery = validarEntrada(esquemaListaCostosQuery, parametros);
  const cliente = clienteLectura(bd);
  const verImportes = tienePermiso(sesion, 'consultas.ver-importes');

  const where: Prisma.CostoOrdenWhereInput = {
    idEmpresa: sesion.idEmpresaActiva,
    orden: {
      ...(filtros.idModelo === undefined ? {} : { idModelo: filtros.idModelo }),
      ...(filtros.idCliente === undefined ? {} : { idCliente: filtros.idCliente }),
      ...(await armarBusquedaConSinonimos(filtros.busqueda, bd)),
    },
  };

  const orderBy: Prisma.CostoOrdenOrderByWithRelationInput =
    filtros.ordenarPor === 'costoTotal'
      ? { costoTotal: filtros.direccion }
      : filtros.ordenarPor === 'fecha'
        ? { orden: { fecha: filtros.direccion } }
        : { orden: { folio: filtros.direccion } };

  const [total, filas] = await Promise.all([
    cliente.costoOrden.count({ where }),
    cliente.costoOrden.findMany({
      where,
      orderBy,
      skip: (filtros.pagina - 1) * filtros.porPagina,
      take: filtros.porPagina,
      select: {
        idOrden: true,
        costoTotal: true,
        baseProrrateo: true,
        // ⭐ 0.061: el congelado del cierre (la lista respeta lo mismo que el detalle).
        congeladoEn: true,
        cantidadBaseCongelada: true,
        orden: {
          select: {
            folio: true,
            fecha: true,
            cerradaEn: true,
            idModelo: true,
            modelo: { select: { codigo: true } },
            idCliente: true,
            cliente: { select: { nombre: true } },
          },
        },
      },
    }),
  ]);

  const cant = await cantidadesDeOrdenes(
    filas.map((f) => f.idOrden),
    bd,
  );
  const money = (v: number | null): number | null =>
    verImportes ? (v === null ? null : redondear2(v)) : null;

  const datos = filas.map((f) => {
    const c = cant.get(f.idOrden) ?? { pedido: 0, cortado: 0, recibido: 0, vendido: 0 };
    // ⭐ 0.061: la orden CERRADA usa su divisor CONGELADO; la abierta lo recalcula en vivo. La
    // MISMA decisión y la MISMA regla que el detalle (`divisorCongelado` + `unitarioODeuda`), para que
    // la lista y la ficha de la orden nunca digan números distintos.
    const cantidadBase = divisorCongelado(f.orden, f) ?? cantidadDeBase(c, f.baseProrrateo);
    const total = f.costoTotal == null ? null : f.costoTotal.toNumber();
    const unit = unitarioODeuda(total, cantidadBase, f.baseProrrateo, verImportes);
    return {
      idOrden: f.idOrden,
      folio: Number(f.orden.folio),
      idModelo: f.orden.idModelo,
      codigoModelo: f.orden.modelo.codigo,
      idCliente: f.orden.idCliente,
      cliente: f.orden.cliente.nombre,
      fecha: f.orden.fecha === null ? null : f.orden.fecha.toISOString().slice(0, 10),
      cortado: c.cortado,
      costoTotal: money(total),
      costoUnitario: money(unit.costoUnitario),
      motivoSinUnitario: unit.motivoSinUnitario,
      textoSinUnitario: unit.textoSinUnitario,
      baseProrrateo: f.baseProrrateo,
    };
  });

  return {
    datos,
    total,
    pagina: filtros.pagina,
    porPagina: filtros.porPagina,
    totalPaginas: Math.max(1, Math.ceil(total / filtros.porPagina)),
  };
}
