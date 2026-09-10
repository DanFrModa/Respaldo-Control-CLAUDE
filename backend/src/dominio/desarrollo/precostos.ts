/**
 * Precosto PERSISTIDO por desarrollo (F8-E3, D13/R17/R18/R19) — el CORAZÓN de la fase.
 *
 * Convierte el pre-costo "al vuelo" de F7 en filas `Precosto`/`PrecostoLinea` calculadas desde el BOM
 * del modelo con los PRECIOS AMARRADOS de E1 (`resolverPrecioTela`/`resolverPrecioAvio`), el PROMEDIO
 * SIMPLE de las medidas por talla (R18, decisión (g)) y N conceptos de costo (R19), versionable por
 * CONGELADO INMUTABLE (base del re-costeo de negociación, E5).
 *
 * Innegociables aplicados:
 *  • A1 — toda la lógica vive aquí; las rutas sólo validan permiso + Zod y delegan.
 *  • A2 — cada operación multi-tabla (precosto + renglones + bitácora) va en UNA transacción.
 *  • A3 — la VERSIÓN se genera bajo `pg_advisory_xact_lock` por desarrollo (NUNCA Max()+1 en carrera);
 *    el `@@unique([idDesarrollo, version])` la respalda. Además, a lo más UN borrador por desarrollo.
 *  • A7 — auditoría uniforme (`creadoPorId`/`modificadoPorId`) + `Bitacora` en la misma tx.
 *  • A9 — scope por empresa activa en TODA lectura/mutación (el precosto cuelga de desarrollo→proyecto→
 *    empresa); un precosto de otra empresa, para esta sesión, no existe.
 *  • D3 (espíritu) — las versiones CONGELADAS son INMUTABLES: cualquier recalcular/editar/congelar
 *    sobre un congelado → `ErrorConflicto`. Para cambiar, se genera una versión nueva.
 *
 * NO duplica aritmética: reutiliza `redondear2`/`num`/`numOrNull` (`../costos/decimales.js`) y la
 * cascada de precios amarrados (`../costos/resolucion-precios.js`). La REGALÍA no es concepto del costo
 * (D2: va SOBRE la venta — factor de la lista, E4): no se incluye.
 */
import {
  esquemaPrecostoLineaEditar,
  esquemaPrecostoLineaManualCrear,
  type DatosPrecostoLineaEditar,
  type DatosPrecostoLineaManualCrear,
  type PrecostoLineaSalida,
  type PrecostoResumen,
  type PrecostoSalida,
  type PrecostosDesarrolloLista,
} from '../../contrato/esquemas/precosto.js';
import type { Prisma } from '../../datos/index.js';
import type { z } from 'zod';

import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado } from '../../comun/errores.js';
import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { CODIGO_PRISMA, codigoErrorPrisma } from '../../comun/prisma-errores.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';
import { num, numOrNull, promedioSimple, redondear2, redondear4 } from '../costos/decimales.js';
import {
  resolverPrecioAvioCatalogo,
  resolverPrecioTela,
  type CompraRealPrecio,
} from '../costos/resolucion-precios.js';
import {
  claveMaterial,
  claveMaterialProveedor,
  leerUltimosPreciosCompra,
  type UltimosPreciosCompra,
} from '../costos/ultimo-precio-compra.js';
import { conRecetaCompartidaDeUno } from '../modelos/receta-compartida.js';

/** Entradas tipadas de las mutaciones (forma del esquema compartido). */
export type EntradaLineaManual = z.input<typeof esquemaPrecostoLineaManualCrear>;
export type EntradaLineaEditar = z.input<typeof esquemaPrecostoLineaEditar>;

/**
 * Namespace del `pg_advisory_xact_lock` para SERIALIZAR la generación de versión + la regla "un solo
 * borrador" por desarrollo. La segunda tx que genere para el MISMO desarrollo espera a la primera.
 */
const NAMESPACE_LOCK_PRECOSTO = 20_531;

/**
 * Códigos de concepto BASE que el motor del precosto alimenta directo (NO manuales del usuario): del
 * BOM (tela/avíos/arte) o los costos fijos por prenda (maquila y —rediseño R5, B8— corte). Los
 * siembra el seed con `fijo=true` salvo `bordado`. `corte` es el renglón nuevo de R5 (costo de corte
 * separado de la costura; decisión Daniel).
 */
const CONCEPTOS_BOM = ['tela', 'avios', 'maquila', 'corte', 'empaque', 'bordado'] as const;

/** Ids de los conceptos base resueltos por código (se leen una vez por operación). */
interface ConceptosBase {
  tela: number;
  avios: number;
  maquila: number;
  /** Corte (rediseño R5, B8): costo fijo por prenda separado de la maquila. */
  corte: number;
  /** ⭐ Empaque (V1-E8w, §Post-F9.153): la TERCERA ancla fija, *"como si fuera corte"*. */
  empaque: number;
  bordado: number;
}

// ── BOM del modelo (mismas banderas paraPreCosto que F7 + medidas por talla, R18) ──────────────────

/**
 * `include` del BOM `paraPreCosto` con los precios de catálogo Y el AMARRE de E1. Es el de F7
 * (`incluirReceta`) MÁS `consumoPorTalla` + `tallas` de avíos (R18): cuando un avío se consume por
 * talla, el precosto usa el PROMEDIO SIMPLE de sus medidas capturadas (decisión (g)).
 */
const incluirBomModelo = {
  telas: {
    where: { paraPreCosto: true },
    select: {
      idTela: true,
      consumoPorPrenda: true,
      idTelaProveedor: true,
      // `idProveedor`: V1-E3e lo necesita para el escalón 1 con amarre (§Post-F9.48 — el amarre
      // elige el PROVEEDOR y el precio sale de la última compra A ESE proveedor).
      telaProveedor: { select: { idProveedor: true, precio: true, manejaPrecioPorColor: true } },
      tela: { select: { nombre: true, precioSugerido: true } },
    },
  },
  avios: {
    where: { paraPreCosto: true },
    select: {
      idAvio: true,
      consumoPorPrenda: true,
      consumoPorTalla: true,
      idAvioProveedor: true,
      avio: {
        select: {
          clave: true,
          descripcion: true,
          precioReferencia: true,
          proveedores: { select: { idProveedor: true, precio: true } },
          // R5, B11: medidas ACTIVAS del avío "por medida". Si trae ≥1, el precosto usa el PROMEDIO
          // SIMPLE de sus precios (decisión Daniel) en vez de la cascada por proveedor.
          medidas: { where: { activo: true }, select: { precio: true } },
        },
      },
      tallas: { select: { consumo: true } },
    },
  },
  // V1-E3f: el arte perdió el `nombre` — su campo visible es la `descripcion` y el desempate
  // del orden pasó de nombre a `id` (§Post-F9.52 punto 1).
  artes: {
    select: { id: true, descripcion: true, precio: true },
    orderBy: [{ orden: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.ModeloInclude;

type ModeloConBom = Prisma.ModeloGetPayload<{ include: typeof incluirBomModelo }>;

/**
 * 🔴 V1-E9b (§Post-F9.167) — Lee el modelo con su BOM **de quien de verdad es la receta**.
 *
 * Las TRES puertas del precosto (generar, recalcular y restaurar un renglón) leían el modelo con
 * `include: incluirBomModelo`, que trae `telas`/`avios`/`avios.tallas`/`artes` **por nombre de
 * relación, sin nombrar jamás la tabla**: la clase de lectura invisible que el conteo del plan
 * omitió. Con un modelo de producción derivado (V1-E9a) eso habría precosteado con la receta
 * VACÍA — sólo corte, maquila y empaque—, *sin lanzar*, y de ahí sale el precio del cliente.
 *
 * ⚠️ Hoy las tres entran por `Desarrollo.idModelo`, que apunta a un modelo de DESARROLLO ⇒ el
 * resolver es la IDENTIDAD y no cambia nada. Va igual, y a propósito: la regla se cumple **por
 * construcción**, no porque alguien recuerde que hoy ese modelo nunca es un hijo. El día que un
 * desarrollo pueda colgar de un modelo de producción, esto ya está bien.
 */
async function leerModeloConBom(tx: Tx, idModelo: number): Promise<ModeloConBom | null> {
  const propio = await tx.modelo.findUnique({ where: { id: idModelo }, include: incluirBomModelo });
  if (propio === null) {
    return null;
  }
  return conRecetaCompartidaDeUno(propio, (idPadre) =>
    tx.modelo.findUnique({ where: { id: idPadre }, include: incluirBomModelo }),
  );
}

/** Un renglón nuevo (sin `idPrecosto`, que se agrega al insertar en lote). */
type LineaNueva = Omit<Prisma.PrecostoLineaCreateManyInput, 'idPrecosto'>;

/**
 * Forma MÍNIMA de un avío del catálogo para valuarlo (la comparten el renglón del BOM y el renglón
 * MANUAL ligado a un avío). Es justo lo que selecciona {@link incluirBomModelo} para el avío.
 */
interface AvioParaValuar {
  precioReferencia: Prisma.Decimal | null;
  proveedores: {
    idProveedor: number;
    precio: Prisma.Decimal | null;
  }[];
  /** Medidas ACTIVAS del avío "por medida" (R5, B11). */
  medidas: { precio: Prisma.Decimal }[];
}

/** Traduce una entrada del mapa de últimas compras a la forma mínima que pide la cascada. */
function aCompraReal(
  ultimos: UltimosPreciosCompra,
  clave: string,
  porProveedor = false,
): CompraRealPrecio | null {
  const u = (porProveedor ? ultimos.porMaterialProveedor : ultimos.porMaterial).get(clave);
  return u === undefined ? null : { precio: u.precio, idProveedor: u.idProveedor };
}

/**
 * Últimas COMPRAS REALES (§Post-F9.48) de todos los insumos del BOM de un modelo, EN UN LOTE: una
 * consulta para todo el BOM, no una por renglón. Acotadas a la empresa activa (A9).
 */
async function ultimosPreciosDelBom(
  tx: Tx,
  idEmpresa: number,
  modelo: ModeloConBom,
): Promise<UltimosPreciosCompra> {
  return leerUltimosPreciosCompra(tx, idEmpresa, {
    telas: modelo.telas.map((t) => t.idTela),
    avios: modelo.avios.map((a) => a.idAvio),
  });
}

/**
 * Precio de un AVÍO del catálogo, con la ÚNICA regla del precosto (no se duplica en ningún lado):
 *  • avío "por medida" (≥1 medida activa, R5/B11) → PROMEDIO SIMPLE de los precios de sus medidas,
 *    SIN proveedor de traza (el precio no salió de un proveedor);
 *  • si no, la cascada única de V1-E3e (`resolverPrecioAvio`: última compra al proveedor amarrado →
 *    amarre → última compra real → más barato → referencia), que además dice QUÉ proveedor se usó.
 * La usan `lineasBomDesdeModelo` (renglones del BOM) y `agregarLineaManual` (renglón manual ligado
 * a un avío, Daniel ago-2026).
 */
function precioAvioDeCatalogo(
  avio: AvioParaValuar,
  idAvioProveedor: number | null,
  idAvio: number,
  ultimos: UltimosPreciosCompra,
): { precio: number | null; idProveedor: number | null } {
  // La REGLA (medidas → promedio; si no, cascada) vive en `resolverPrecioAvioCatalogo`, compartida
  // con la receta para que la pantalla no pueda enseñar un número distinto del que costea. Aquí
  // solo se aplica el redondeo, que sigue siendo decisión del llamador.
  const resuelto = resolverPrecioAvioCatalogo({
    precioReferencia: numOrNull(avio.precioReferencia),
    idAvioProveedor,
    medidas: avio.medidas.map((m) => num(m.precio)),
    proveedores: avio.proveedores.map((p) => ({
      idProveedor: p.idProveedor,
      precio: numOrNull(p.precio),
    })),
    ultimaCompra: aCompraReal(ultimos, claveMaterial('avio', idAvio)),
    ultimaCompraProveedorAmarrado:
      idAvioProveedor === null
        ? null
        : aCompraReal(ultimos, claveMaterialProveedor('avio', idAvio, idAvioProveedor), true),
  });
  // Se redondea AQUÍ, en las DOS ramas, para que nadie pueda consumir un precio crudo. El promedio
  // de medidas (R5/B11) DIVIDE, así que devuelve decimales infinitos: tres medidas a $1 / $1 / $1.10
  // → 1.0333… Si ese número saliera de aquí, se guardaría en `Decimal(12,2)` como 1.03 mientras el
  // importe se calcularía con 1.0333… → la fila mostraría un importe que no cuadra con su unitario,
  // y ese importe entra al `costoTotal` que se persiste al congelar y de ahí al precio del cliente.
  return {
    precio: resuelto.precio === null ? null : redondear2(resuelto.precio),
    idProveedor: resuelto.idProveedor,
  };
}

/** Orígenes que salen del BOM (se regeneran al recalcular salvo que estén AJUSTADOS, B12). */
const ORIGENES_BOM = ['bom_tela', 'bom_avio', 'bom_arte'] as const;

/**
 * Código del concepto de EMPAQUE. Vive en su propia constante porque **dos** reglas distintas lo
 * miran: la de ancla fija ({@link CONCEPTOS_ANCLA}) y la del contenido mínimo para congelar
 * ({@link exigirCostoCongelable}) — y la segunda existe justamente porque el empaque es la única
 * de las tres anclas que nace con un valor **puesto por el sistema**, no capturado por nadie.
 */
const CONCEPTO_EMPAQUE = 'empaque';

/**
 * Códigos de los conceptos ANCLA fijos (rediseño R5 + V1-E8w): un renglón `manual` por prenda, ÚNICO,
 * que se EDITA pero NO se elimina ni se agrega dos veces — maquila/costura, corte y **empaque**.
 *
 * ⭐ **`empaque` es el tercero** (§Post-F9.153, Daniel 30-ago-2026): *"nos falto meter el costo del
 * empaque. Es un campo adicional…. como si fuera corte"* · *"el empaque no es de catalogo…. es
 * simplemente un campo que casi siempre es el mismo costo"*. Su importe default NO está clavado
 * aquí: sale de `ConfiguracionEmpresa.costoEmpaqueBase` (ver {@link costoEmpaqueDeEmpresa}).
 */
const CONCEPTOS_ANCLA = ['maquila', 'corte', CONCEPTO_EMPAQUE] as const;

/**
 * Costo de empaque por prenda de RESPALDO, para una empresa que todavía no tiene fila de
 * `ConfiguracionEmpresa`. Es **el mismo 2.20 del `ADD COLUMN … DEFAULT` de la migración** —el número
 * que dio Daniel— y no una segunda opinión: si divergieran, una empresa sin configuración costearía
 * distinto que una con la configuración recién sembrada. **El valor de verdad vive en la BD**; esto
 * sólo cubre el hueco de la fila ausente.
 */
export const COSTO_EMPAQUE_DEFECTO = 2.2;

/**
 * ¿Es un renglón ANCLA fijo (B8/B12)? Los renglones auto-creados de origen `manual` bajo uno de los
 * conceptos de {@link CONCEPTOS_ANCLA} — hoy **tres**: `maquila`, `corte` y `empaque` (este último
 * desde V1-E8w / §Post-F9.153). Son ÚNICOS por precosto, editables pero NO eliminables (a diferencia
 * del resto, que en un borrador sí se puede quitar en la calculadora de negociación).
 *
 * ⚠️ La lista NO se repite aquí a propósito: se lee de `CONCEPTOS_ANCLA`, para que agregar una cuarta
 * ancla no deje este docstring mintiendo — que es justo lo que pasó cuando entró `empaque`.
 */
function esAnclaFija(origen: string, conceptoCodigo: string): boolean {
  return origen === 'manual' && (CONCEPTOS_ANCLA as readonly string[]).includes(conceptoCodigo);
}

/**
 * ¿Es el renglón del ancla de EMPAQUE, la que el sistema pone SOLO? Hermana de {@link esAnclaFija},
 * pero para una pregunta distinta: no *"¿se puede borrar?"* sino *"¿esto lo costeó una persona?"*.
 *
 * La respuesta es NO: `generarPrecosto` mete este renglón en TODO precosto nuevo con el default de
 * la empresa (§Post-F9.153), sin que nadie capture nada. Por eso {@link exigirCostoCongelable} lo
 * descuenta al medir si el precosto tiene contenido. Un `manual` bajo `empaque` agregado a mano en
 * un borrador viejo (el camino de V1-E8w) cuenta igual: sigue siendo el costo del empaque, que por
 * sí solo no es el costeo de una prenda.
 */
function esAnclaEmpaque(linea: { origen: string; conceptoCodigo: string }): boolean {
  return linea.origen === 'manual' && linea.conceptoCodigo === CONCEPTO_EMPAQUE;
}

/** Clave de identidad de un renglón BOM (origen + insumo) para casar ajustes con la regeneración. */
function claveBom(l: {
  origen: string | null | undefined;
  idTela?: number | null;
  idAvio?: number | null;
  idModeloArte?: number | null;
}): string {
  return `${l.origen ?? ''}:${l.idTela ?? ''}:${l.idAvio ?? ''}:${l.idModeloArte ?? ''}`;
}

/**
 * Clave de RESPALDO de un renglón de ARTE que perdió su traza (`idModeloArte = null`).
 *
 * Desde V1-E3d el arte es hijo del modelo: al borrarlo, la FK del renglón cae a NULL (SetNull) y
 * su {@link claveBom} se vuelve `"bom_arte:::"` — que ya no empata con NINGÚN renglón regenerado.
 * Si el modelo vuelve a tener un arte IGUAL (se recapturó, o la migración no pudo re-apuntar el
 * renglón viejo), `recalcularDesdeBom` metería el arte otra vez y el borrador mostraría el
 * concepto DUPLICADO: el ajustado huérfano + el regenerado. Con el catálogo viejo no pasaba,
 * porque el id del bordado sobrevivía a que el modelo lo quitara del BOM.
 *
 * El texto que se compara es la **descripción del arte** —el campo visible desde V1-E3f
 * (§Post-F9.52 punto 1; antes era el `nombre`, que ya no existe)—, y la `descripcion` del renglón
 * BOM es exactamente esa. Se normaliza (trim + minúsculas). Límites honestos: si el usuario
 * además RENOMBRÓ la descripción del renglón ajustado, ya no hay por dónde reconocerlo y el
 * renglón sobrevive junto al regenerado; y como al retirarse el nombre **el texto ya no es único
 * dentro del modelo**, dos artes con la misma descripción comparten esta clave de respaldo — el
 * empate lo resuelve el primero que la consuma. En los dos casos el usuario ve el duplicado y lo
 * quita, igual que con cualquier ajustado que no casa.
 */
function claveArtePorNombre(l: { descripcion?: string | null }): string {
  return `bom_arte::nombre:${(l.descripcion ?? '').trim().toLocaleLowerCase()}`;
}

/**
 * Construye los renglones de ORIGEN BOM (tela/avío/arte) de un modelo. La tela y el avío se valúan
 * con la CASCADA de precios amarrados de E1 (tela: amarre → sugerido; avío: amarre → más barato →
 * referencia); el avío por talla usa el PROMEDIO de sus medidas (R18). El arte entra UNA vez, sin
 * cantidad. Determinista: mismos datos ⇒ mismos renglones (la usa `generar` y `recalcular`).
 */
function lineasBomDesdeModelo(
  modelo: ModeloConBom,
  conceptos: ConceptosBase,
  sesion: SesionUsuario,
  ultimos: UltimosPreciosCompra,
): LineaNueva[] {
  const auditoria = datosCreacion(sesion);
  const lineas: LineaNueva[] = [];

  // TELA: consumo × precio resuelto (amarre → sugerido). Traza FIEL: `idTelaProveedor` sólo cuando el
  // precio SALIÓ del amarre (`amarre`/`amarre-color`); si cayó a color-referencia/sugerido, es null
  // (no mentimos "salió de este proveedor" cuando en realidad salió del sugerido genérico).
  for (const t of modelo.telas) {
    // `ModeloTela.consumoPorPrenda` ya es `Decimal(12,4)`, así que aquí redondear es un no-op; se
    // deja para que TODO consumo que se guarde pase por la misma regla (ver el avío por talla).
    const consumo = redondear4(num(t.consumoPorPrenda));
    const resuelto = resolverPrecioTela({
      precioSugerido: numOrNull(t.tela.precioSugerido),
      amarre:
        t.idTelaProveedor !== null && t.telaProveedor !== null
          ? {
              precio: numOrNull(t.telaProveedor.precio),
              manejaPrecioPorColor: t.telaProveedor.manejaPrecioPorColor,
            }
          : null,
      // §Post-F9.48: escalón 1 — la última COMPRA REAL manda sobre el catálogo.
      ultimaCompra: aCompraReal(ultimos, claveMaterial('tela', t.idTela)),
      ultimaCompraProveedorAmarrado:
        t.telaProveedor == null
          ? null
          : aCompraReal(
              ultimos,
              claveMaterialProveedor('tela', t.idTela, t.telaProveedor.idProveedor),
              true,
            ),
    });
    // Redondeado a 2 = la misma regla de todos los renglones (el importe se calcula con ESTE
    // número, no con uno más fino que la columna `Decimal(12,2)` no puede guardar). Hoy es un
    // no-op —la cascada de tela no divide y sus columnas ya son de 2 decimales—, pero deja la
    // invariante en un solo lugar por si mañana alguna gana precisión.
    const precioUnit = redondear2(resuelto.precio ?? 0);
    // Traza FIEL del proveedor: el amarre firma el precio cuando ganó su escalón de catálogo O
    // cuando el escalón 1 (última compra real) salió justamente de ÉL — que es el caso normal desde
    // §Post-F9.48. Si la última compra fue a OTRO proveedor, el renglón NO acredita al amarrado.
    const desdeAmarre =
      resuelto.origen === 'amarre' ||
      resuelto.origen === 'amarre-color' ||
      (resuelto.origen === 'ultimo-precio-compra' &&
        t.telaProveedor != null &&
        resuelto.idProveedor === t.telaProveedor.idProveedor);
    lineas.push({
      idConceptoCosto: conceptos.tela,
      origen: 'bom_tela',
      idTela: t.idTela,
      idTelaProveedor: desdeAmarre ? t.idTelaProveedor : null,
      descripcion: t.tela.nombre,
      consumo,
      precioUnit,
      importe: redondear2(consumo * precioUnit),
      ...auditoria,
    });
  }

  // AVÍO: consumo (o PROMEDIO por talla) × precio resuelto. Traza: idAvio + proveedor REALMENTE usado.
  for (const a of modelo.avios) {
    // El PROMEDIO por talla (R18) es el único punto que CREA precisión nueva en el consumo: las
    // medidas capturadas son `Decimal(12,4)`, pero su media no tiene por qué serlo ((1+2)/3 = 0.666…).
    // Se redondea a 4 —la escala de la columna— por la misma razón que el precio a 2: lo que se
    // guarda y lo que multiplica al importe tienen que ser EL MISMO número, o la fila muestra un
    // consumo y un importe que no cuadran entre sí.
    const consumo = redondear4(
      a.consumoPorTalla && a.tallas.length > 0
        ? promedioSimple(a.tallas.map((x) => num(x.consumo)))
        : num(a.consumoPorPrenda),
    );
    // R5, B11: avío "por medida" → PROMEDIO de sus medidas; si no, la cascada amarrada de E1. La
    // regla vive en `precioAvioDeCatalogo` (la comparte el renglón MANUAL ligado a un avío).
    const resuelto = precioAvioDeCatalogo(a.avio, a.idAvioProveedor, a.idAvio, ultimos);
    const precioUnit = resuelto.precio ?? 0;
    lineas.push({
      idConceptoCosto: conceptos.avios,
      origen: 'bom_avio',
      idAvio: a.idAvio,
      // El proveedor cuyo precio se USÓ (amarre o más barato); null si salió de referencia/medidas.
      idAvioProveedor: resuelto.idProveedor,
      descripcion: `${a.avio.clave} — ${a.avio.descripcion}`,
      consumo,
      precioUnit,
      importe: redondear2(consumo * precioUnit),
      ...auditoria,
    });
  }

  // ARTE (bordado/estampado): su precio vive DENTRO del modelo (V1-E3d), UNA vez, sin cantidad.
  for (const a of modelo.artes) {
    const precio = redondear2(num(a.precio));
    lineas.push({
      idConceptoCosto: conceptos.bordado,
      origen: 'bom_arte',
      idModeloArte: a.id,
      descripcion: a.descripcion,
      consumo: null,
      precioUnit: precio,
      importe: precio,
      ...auditoria,
    });
  }

  return lineas;
}

/**
 * Renglón de MAQUILA (concepto fijo `maquila`, origen `manual` → EDITABLE luego). Su importe default es
 * `Modelo.maquilaBase` (como F7); no lleva consumo. Sobrevive al recalcular desde el BOM.
 */
function lineaMaquila(
  modelo: { maquilaBase: Prisma.Decimal | null },
  conceptos: ConceptosBase,
  sesion: SesionUsuario,
): LineaNueva {
  const maquila = redondear2(num(modelo.maquilaBase));
  return {
    idConceptoCosto: conceptos.maquila,
    origen: 'manual',
    descripcion: 'Maquila',
    consumo: null,
    precioUnit: maquila,
    importe: maquila,
    ...datosCreacion(sesion),
  };
}

/**
 * Renglón de CORTE (rediseño R5, B8): costo fijo por prenda SEPARADO de la maquila/costura (decisión
 * Daniel). Concepto fijo `corte`, origen `manual` (editable luego; sobrevive al recalcular). Su
 * importe default es `Modelo.corteBase` (o $0 si no se capturó); SIN proveedor. Espejo de `lineaMaquila`.
 */
function lineaCorte(
  modelo: { corteBase: Prisma.Decimal | null },
  conceptos: ConceptosBase,
  sesion: SesionUsuario,
): LineaNueva {
  const corte = redondear2(num(modelo.corteBase));
  return {
    idConceptoCosto: conceptos.corte,
    origen: 'manual',
    descripcion: 'Corte',
    consumo: null,
    precioUnit: corte,
    importe: corte,
    ...datosCreacion(sesion),
  };
}

/**
 * ⭐⭐ Renglón de EMPAQUE (V1-E8w, §Post-F9.153): la TERCERA ancla fija por prenda, hermana de
 * `lineaCorte` y `lineaMaquila`. Concepto fijo `empaque`, origen `manual` (editable luego;
 * sobrevive al recalcular desde el BOM). SIN consumo y SIN proveedor.
 *
 * 🔴 **El importe NO viene de ningún catálogo ni de ninguna constante de este archivo**: lo trae
 * {@link costoEmpaqueDeEmpresa} desde `ConfiguracionEmpresa.costoEmpaqueBase`. Daniel: *"Ponle 2.20
 * pesos por default, y ya si cambia, que se pueda modificar"* — y va a cambiar, así que el número
 * tiene que poderse mover **sin un deploy** (mismo patrón que `pctDesvioCompra`).
 *
 * 🔴 **Y por eso el importe se COPIA aquí, en el renglón.** Cambiar el default de la empresa mañana
 * NO reescribe ninguna receta ya hecha: cada precosto se lleva su copia y este valor sólo alimenta
 * los renglones que NACEN después. Los precostos ya congelados —la foto de lo que se cotizó— nunca
 * se tocan (D3).
 */
function lineaEmpaque(
  costoEmpaque: number,
  conceptos: ConceptosBase,
  sesion: SesionUsuario,
): LineaNueva {
  const empaque = redondear2(costoEmpaque);
  return {
    idConceptoCosto: conceptos.empaque,
    origen: 'manual',
    descripcion: 'Empaque',
    consumo: null,
    precioUnit: empaque,
    importe: empaque,
    ...datosCreacion(sesion),
  };
}

/**
 * Costo de EMPAQUE por prenda VIGENTE de la empresa (§Post-F9.153). Vive en `ConfiguracionEmpresa`
 * para que Daniel lo mueva sin un deploy; si la empresa todavía no tiene fila de configuración se
 * usa el mismo default que sembraría el `ADD COLUMN … DEFAULT` de la migración. Mismo patrón que
 * `pctDesvioDeEmpresa` en compras.
 */
async function costoEmpaqueDeEmpresa(tx: Tx, idEmpresa: number): Promise<number> {
  const config = await tx.configuracionEmpresa.findUnique({
    where: { idEmpresa },
    select: { costoEmpaqueBase: true },
  });
  return config === null ? COSTO_EMPAQUE_DEFECTO : num(config.costoEmpaqueBase);
}

/** Resuelve los ids de los conceptos BASE por código (falla claro si el seed no los sembró). */
async function conceptosBase(tx: Tx): Promise<ConceptosBase> {
  const filas = await tx.conceptoCosto.findMany({
    where: { codigo: { in: [...CONCEPTOS_BOM] } },
    select: { id: true, codigo: true },
  });
  const porCodigo = new Map(filas.map((f) => [f.codigo, f.id]));
  const exigir = (codigo: string): number => {
    const id = porCodigo.get(codigo);
    if (id === undefined) {
      throw new Error(
        `Falta el concepto de costo base "${codigo}" (¿se corrió el seed de F8-E1?).`,
      );
    }
    return id;
  };
  return {
    tela: exigir('tela'),
    avios: exigir('avios'),
    maquila: exigir('maquila'),
    corte: exigir('corte'),
    empaque: exigir('empaque'),
    bordado: exigir('bordado'),
  };
}

// ── Proyección / lectura ────────────────────────────────────────────────────────────

/** `include` para leer un precosto con sus renglones + el concepto de cada uno (para agrupar/flags). */
const incluirPrecosto = {
  lineas: {
    orderBy: [{ conceptoCosto: { orden: 'asc' } }, { id: 'asc' }],
    include: {
      conceptoCosto: { select: { codigo: true, nombre: true, orden: true, fijo: true } },
    },
  },
} satisfies Prisma.PrecostoInclude;

type PrecostoConLineas = Prisma.PrecostoGetPayload<{ include: typeof incluirPrecosto }>;

/** Proyecta un renglón a la salida del contrato (importes en null sin `consultas.ver-importes`). */
function aLineaSalida(
  linea: PrecostoConLineas['lineas'][number],
  verImportes: boolean,
): PrecostoLineaSalida {
  const esAncla = esAnclaFija(linea.origen, linea.conceptoCosto.codigo);
  return {
    id: linea.id,
    idConceptoCosto: linea.idConceptoCosto,
    conceptoCodigo: linea.conceptoCosto.codigo,
    conceptoNombre: linea.conceptoCosto.nombre,
    conceptoOrden: linea.conceptoCosto.orden,
    conceptoFijo: linea.conceptoCosto.fijo,
    origen: linea.origen,
    descripcion: linea.descripcion,
    consumo: linea.consumo === null ? null : linea.consumo.toNumber(),
    precioUnit: verImportes ? linea.precioUnit.toNumber() : null,
    importe: verImportes ? linea.importe.toNumber() : null,
    notas: linea.notas,
    idTela: linea.idTela,
    idTelaProveedor: linea.idTelaProveedor,
    idAvio: linea.idAvio,
    idAvioProveedor: linea.idAvioProveedor,
    idModeloArte: linea.idModeloArte,
    // R5, B12: en la calculadora de negociación CUALQUIER renglón de un borrador se puede editar
    // (los BOM pasan a `ajustado`). La UI gatea la edición tras `precosto.congelado`.
    editable: true,
    // Todo se puede quitar en un borrador SALVO los anclas fijos (maquila/corte/empaque: se editan, no se
    // borran). Los BOM quitados reaparecen al recalcular (reset al BOM del modelo); los ajustados no.
    eliminable: !esAncla,
    // R5, B12: renglón de origen BOM ajustado a mano (recalcular no lo pisa; se puede restaurar).
    ajustado: linea.ajustado,
  };
}

/** Proyecta un precosto completo (con el total vivo = Σ importes) a la salida del contrato. */
function aPrecostoSalida(precosto: PrecostoConLineas, verImportes: boolean): PrecostoSalida {
  const totalVivo = redondear2(precosto.lineas.reduce((suma, l) => suma + l.importe.toNumber(), 0));
  return {
    id: precosto.id,
    idDesarrollo: precosto.idDesarrollo,
    version: precosto.version,
    estado: precosto.estado,
    congelado: precosto.estado === 'congelado',
    congeladoEn: precosto.congeladoEn === null ? null : precosto.congeladoEn.toISOString(),
    congeladoPorId: precosto.congeladoPorId,
    costoTotal: verImportes ? totalVivo : null,
    lineas: precosto.lineas.map((l) => aLineaSalida(l, verImportes)),
    creadoEn: precosto.creadoEn.toISOString(),
    creadoPorId: precosto.creadoPorId,
    modificadoEn: precosto.modificadoEn.toISOString(),
    modificadoPorId: precosto.modificadoPorId,
  };
}

// ── Helpers de existencia / estado ────────────────────────────────────────────────────

/** Desarrollo de la EMPRESA ACTIVA (A9), listo para precostear (no apagado). */
async function exigirDesarrolloParaPrecostear(
  tx: Tx,
  id: number,
  idEmpresa: number,
): Promise<{ id: number; idModelo: number }> {
  const desarrollo = await tx.desarrollo.findFirst({
    where: { id, proyecto: { idEmpresa } },
    select: { id: true, idModelo: true, apagado: true },
  });
  if (desarrollo === null) {
    throw new ErrorNoEncontrado('Desarrollo', id);
  }
  if (desarrollo.apagado) {
    throw new ErrorConflicto('No se puede precostear un desarrollo apagado; reactívalo primero.');
  }
  return { id: desarrollo.id, idModelo: desarrollo.idModelo };
}

/** Precosto de la empresa activa (A9), o `ErrorNoEncontrado`. */
async function exigirPrecosto(
  tx: Tx,
  id: number,
  idEmpresa: number,
): Promise<{ id: number; idDesarrollo: number; estado: string; version: number }> {
  const precosto = await tx.precosto.findFirst({
    where: { id, desarrollo: { proyecto: { idEmpresa } } },
    select: { id: true, idDesarrollo: true, estado: true, version: true },
  });
  if (precosto === null) {
    throw new ErrorNoEncontrado('Precosto', id);
  }
  return precosto;
}

/** Regla D3 (espíritu): un precosto CONGELADO es inmutable → cualquier cambio es `ErrorConflicto`. */
function exigirBorrador(precosto: { estado: string; version: number }): void {
  if (precosto.estado !== 'borrador') {
    throw new ErrorConflicto(
      `El precosto v${precosto.version} está CONGELADO (inmutable); genera una versión nueva para cambiarlo.`,
    );
  }
}

/**
 * Lock transaccional por DESARROLLO (advisory). SERIALIZA todas las mutaciones del mismo desarrollo
 * (generar + editar/agregar/eliminar/recalcular/congelar): la 2ª tx espera a la 1ª hasta su commit.
 * Es lo que hace segura la invariante D3 bajo concurrencia — sin él, un `editarLinea` podría leer el
 * precosto como `borrador`, mientras `congelarVersion` corre en paralelo y lo congela, y terminar
 * escribiendo sobre un precosto YA congelado (write-skew). Tomándolo ANTES de leer el estado, la 2ª
 * operación re-lee bajo el lock, ve el congelado y aborta limpio en `exigirBorrador`.
 */
async function bloquearDesarrollo(tx: Tx, idDesarrollo: number): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NAMESPACE_LOCK_PRECOSTO}::int, ${idDesarrollo}::int)`;
}

/**
 * Resuelve el desarrollo (empresa activa, A9) de un precosto y toma su lock. Se usa al inicio de las
 * mutaciones que reciben `idPrecosto`, para que `exigirPrecosto`/`exigirBorrador` corran BAJO el lock.
 */
async function bloquearDesarrolloDePrecosto(
  tx: Tx,
  idPrecosto: number,
  idEmpresa: number,
): Promise<void> {
  const precosto = await tx.precosto.findFirst({
    where: { id: idPrecosto, desarrollo: { proyecto: { idEmpresa } } },
    select: { idDesarrollo: true },
  });
  if (precosto === null) {
    throw new ErrorNoEncontrado('Precosto', idPrecosto);
  }
  await bloquearDesarrollo(tx, precosto.idDesarrollo);
}

// ── Operaciones ─────────────────────────────────────────────────────────────────────

/**
 * GENERA un precosto BORRADOR (siguiente versión) desde el BOM del modelo del desarrollo, con los
 * renglones de tela/avío/arte valuados con los precios amarrados (E1) + la maquila base. A lo más UN
 * borrador por desarrollo (serializado con advisory lock, A3). Requiere `desarrollo.precostear`.
 */
export async function generarPrecosto(
  sesion: SesionUsuario,
  idDesarrollo: number,
  bd?: ContextoBd,
): Promise<PrecostoSalida> {
  verificarPermiso(sesion, 'desarrollo.precostear');

  const idNuevo = await enTransaccion(async (tx) => {
    // Serializa versión + "un solo borrador" + toda mutación del desarrollo (A3/D3; NUNCA Max()+1).
    await bloquearDesarrollo(tx, idDesarrollo);
    const desarrollo = await exigirDesarrolloParaPrecostear(
      tx,
      idDesarrollo,
      sesion.idEmpresaActiva,
    );

    const borrador = await tx.precosto.findFirst({
      where: { idDesarrollo, estado: 'borrador' },
      select: { version: true },
    });
    if (borrador !== null) {
      throw new ErrorConflicto(
        `El desarrollo ya tiene un precosto en BORRADOR (v${borrador.version}); congélalo o edítalo antes de generar otro.`,
      );
    }

    const ultima = await tx.precosto.aggregate({
      where: { idDesarrollo },
      _max: { version: true },
    });
    const version = (ultima._max.version ?? 0) + 1;

    const modelo = await leerModeloConBom(tx, desarrollo.idModelo);
    if (modelo === null) {
      throw new ErrorNoEncontrado('Modelo', desarrollo.idModelo);
    }
    const conceptos = await conceptosBase(tx);
    const ultimos = await ultimosPreciosDelBom(tx, sesion.idEmpresaActiva, modelo);
    const lineas = [
      ...lineasBomDesdeModelo(modelo, conceptos, sesion, ultimos),
      lineaCorte(modelo, conceptos, sesion),
      lineaMaquila(modelo, conceptos, sesion),
      lineaEmpaque(await costoEmpaqueDeEmpresa(tx, sesion.idEmpresaActiva), conceptos, sesion),
    ];

    let precostoId: number;
    try {
      const creado = await tx.precosto.create({
        data: { idDesarrollo, version, estado: 'borrador', ...datosCreacion(sesion) },
        select: { id: true },
      });
      precostoId = creado.id;
    } catch (error) {
      if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
        throw new ErrorConflicto('Se generó otra versión al mismo tiempo; vuelve a intentar.', {
          causa: error,
        });
      }
      throw error;
    }

    await tx.precostoLinea.createMany({
      data: lineas.map((l) => ({ ...l, idPrecosto: precostoId })),
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'Precosto',
      idEntidad: precostoId,
      accion: 'CREAR',
      datos: { idDesarrollo, version, renglones: lineas.length },
    });

    return precostoId;
  }, bd);

  return obtenerPrecosto(sesion, idNuevo, bd);
}

/**
 * RECALCULA los renglones de origen BOM (tela/avío/arte) desde el modelo, SIN tocar los MANUALES
 * (maquila editada y conceptos abiertos sobreviven). Sólo sobre un BORRADOR. Requiere
 * `desarrollo.precostear`.
 */
export async function recalcularDesdeBom(
  sesion: SesionUsuario,
  idPrecosto: number,
  bd?: ContextoBd,
): Promise<PrecostoSalida> {
  verificarPermiso(sesion, 'desarrollo.precostear');

  await enTransaccion(async (tx) => {
    // Lock por desarrollo ANTES de leer el estado: `exigirBorrador` corre serializado (evita el
    // write-skew que violaría D3 si otra tx congela en paralelo).
    await bloquearDesarrolloDePrecosto(tx, idPrecosto, sesion.idEmpresaActiva);
    const precosto = await exigirPrecosto(tx, idPrecosto, sesion.idEmpresaActiva);
    exigirBorrador(precosto);

    const desarrollo = await tx.desarrollo.findUnique({
      where: { id: precosto.idDesarrollo },
      select: { idModelo: true },
    });
    // El precosto ya está en scope, así que su desarrollo existe; defensivo por tipos.
    if (desarrollo === null) {
      throw new ErrorNoEncontrado('Desarrollo', precosto.idDesarrollo);
    }
    const modelo = await leerModeloConBom(tx, desarrollo.idModelo);
    if (modelo === null) {
      throw new ErrorNoEncontrado('Modelo', desarrollo.idModelo);
    }
    const conceptos = await conceptosBase(tx);
    const ultimos = await ultimosPreciosDelBom(tx, sesion.idEmpresaActiva, modelo);

    // R5, B12: los renglones BOM AJUSTADOS a mano en la negociación se PRESERVAN (no se regeneran).
    // Se borran sólo los BOM no ajustados y se re-generan del modelo, SALTANDO los insumos que ya
    // tienen un renglón ajustado (evita duplicar la misma tela/avío/arte). Los quitados a mano SÍ
    // reaparecen (recalcular = reset explícito al BOM del modelo); para conservar un cambio definitivo
    // se edita el BOM del modelo. Los `manual` (maquila/corte/empaque/procesos) nunca los toca este
    // recalcular — y de ahí que subir el `costoEmpaqueBase` de la empresa no mueva una receta ya hecha.
    const ajustadas = await tx.precostoLinea.findMany({
      where: { idPrecosto, ajustado: true, origen: { in: [...ORIGENES_BOM] } },
      select: {
        origen: true,
        idTela: true,
        idAvio: true,
        idModeloArte: true,
        descripcion: true,
      },
    });
    const clavesAjustadas = new Set(ajustadas.map(claveBom));
    // Un ARTE ajustado que perdió su traza (`idModeloArte = null`, ver `claveArtePorNombre`) se
    // reconoce por NOMBRE; si no, el arte reaparecería DUPLICADO al regenerar.
    const artesAjustadasPorNombre = new Set(
      ajustadas
        .filter((l) => l.origen === 'bom_arte' && l.idModeloArte === null)
        .map(claveArtePorNombre),
    );

    await tx.precostoLinea.deleteMany({
      where: { idPrecosto, origen: { in: [...ORIGENES_BOM] }, ajustado: false },
    });
    const lineas = lineasBomDesdeModelo(modelo, conceptos, sesion, ultimos).filter(
      (l) =>
        !clavesAjustadas.has(claveBom(l)) &&
        !(l.origen === 'bom_arte' && artesAjustadasPorNombre.has(claveArtePorNombre(l))),
    );
    if (lineas.length > 0) {
      await tx.precostoLinea.createMany({
        data: lineas.map((l) => ({ ...l, idPrecosto })),
      });
    }
    await tx.precosto.update({ where: { id: idPrecosto }, data: { ...datosModificacion(sesion) } });

    await registrarBitacora(tx, sesion, {
      entidad: 'Precosto',
      idEntidad: idPrecosto,
      accion: 'MODIFICAR',
      datos: { operacion: 'recalcular-bom', renglones: lineas.length },
    });
  }, bd);

  return obtenerPrecosto(sesion, idPrecosto, bd);
}

/**
 * Agrega un renglón MANUAL (estampado, otros procesos, otros…) contra un `ConceptoCosto` ACTIVO — el
 * `fijo` del catálogo NO veta ya (lo que manda es la regla de las anclas de aquí abajo). El importe =
 * `consumo × precioUnit` (si hay consumo) o `precioUnit` a secas. Sólo sobre un BORRADOR. Requiere
 * `desarrollo.precostear`.
 *
 * De los TRES conceptos ANCLA (`maquila`/`corte`/`empaque`) sólo se rechaza el que YA ESTÉ PUESTO en
 * este precosto: son ÚNICOS por prenda, así que el que ya tiene su renglón se EDITA, no se duplica —
 * pero el que falta SÍ se puede agregar a mano (V1-E8w: `empaque` es ancla desde entonces, y los
 * borradores anteriores nacieron sin él). Cualquier otro concepto activo se puede agregar a
 * mano — incluidos tela/avíos como renglón de la calculadora de negociación (R5, B12): un manual bajo
 * tela/avíos queda `origen:'manual'`, sobrevive al recalcular (no viene del BOM) y ES eliminable
 * (`eliminable = !esAncla`), así que no queda atrapado como antes.
 *
 * Petición de Daniel (ago-2026): el renglón se puede LIGAR A UN AVÍO DEL CATÁLOGO (`idAvio`) en
 * vez de teclear su nombre. Entonces el DOMINIO (A1, nunca la ruta ni el frontend) resuelve la
 * descripción (`clave — descripción`) y el PRECIO con la MISMA cascada del BOM
 * ({@link precioAvioDeCatalogo}), y guarda la traza `idAvio`/`idAvioProveedor` (el renglón queda
 * LIGADO, no sólo con el nombre copiado). Un `precioUnit` explícito MANDA sobre el del catálogo, y
 * el renglón se sigue pudiendo editar después (`editarLinea`) — el precio resuelto no queda fijo.
 */
export async function agregarLineaManual(
  sesion: SesionUsuario,
  idPrecosto: number,
  entrada: EntradaLineaManual,
  bd?: ContextoBd,
): Promise<PrecostoSalida> {
  verificarPermiso(sesion, 'desarrollo.precostear');
  const datos: DatosPrecostoLineaManualCrear = validarEntrada(
    esquemaPrecostoLineaManualCrear,
    entrada,
  );

  await enTransaccion(async (tx) => {
    // Lock por desarrollo ANTES de leer el estado: `exigirBorrador` corre serializado (evita el
    // write-skew que violaría D3 si otra tx congela en paralelo).
    await bloquearDesarrolloDePrecosto(tx, idPrecosto, sesion.idEmpresaActiva);
    const precosto = await exigirPrecosto(tx, idPrecosto, sesion.idEmpresaActiva);
    exigirBorrador(precosto);

    const concepto = await tx.conceptoCosto.findUnique({
      where: { id: datos.idConceptoCosto },
      // `fijo` ya NO se trae: la regla de anclas mira `CONCEPTOS_ANCLA` + la presencia en ESTE
      // precosto, no la bandera del catálogo (V1-E8w). Quedaba muerto en el select.
      select: { id: true, codigo: true, nombre: true, activo: true },
    });
    if (concepto === null) {
      throw new ErrorNoEncontrado('ConceptoCosto', datos.idConceptoCosto);
    }
    if (!concepto.activo) {
      throw new ErrorConflicto(`El concepto de costo "${concepto.nombre}" está desactivado.`);
    }
    // ⭐ ANCLA = ÚNICA por precosto, no PROHIBIDA (V1-E8w). La regla real siempre fue "no dos veces"
    // —se edita el que ya está, no se agrega otro—, pero estaba escrita como un veto al concepto, y
    // eso dejaba sin salida a los borradores que NACIERON sin el ancla: el `empaque` de §Post-F9.153
    // es ancla desde hoy, así que todo borrador anterior a esta versión no lo tiene y, con el veto,
    // no habría manera de ponérselo (ni a mano ni recalculando, que no toca los `manual`). Se
    // comprueba la PRESENCIA en ESTE precosto: si ya está, se rechaza igual que antes.
    if ((CONCEPTOS_ANCLA as readonly string[]).includes(concepto.codigo)) {
      const yaExiste = await tx.precostoLinea.findFirst({
        where: { idPrecosto, origen: 'manual', idConceptoCosto: concepto.id },
        select: { id: true },
      });
      if (yaExiste !== null) {
        throw new ErrorConflicto(
          `El concepto "${concepto.nombre}" ya tiene su renglón fijo por prenda; edítalo en vez de agregar otro.`,
        );
      }
    }

    // Renglón LIGADO a un avío del catálogo: el dominio resuelve descripción y precio (cascada de E1).
    let avio: {
      id: number;
      etiqueta: string;
      precio: number | null;
      idProveedor: number | null;
    } | null = null;
    if (datos.idAvio !== undefined) {
      const delCatalogo = await tx.avio.findUnique({
        where: { id: datos.idAvio },
        select: {
          id: true,
          clave: true,
          descripcion: true,
          activo: true,
          precioReferencia: true,
          proveedores: { select: { idProveedor: true, precio: true } },
          medidas: { where: { activo: true }, select: { precio: true } },
        },
      });
      if (delCatalogo === null) {
        throw new ErrorNoEncontrado('Avío', datos.idAvio);
      }
      if (!delCatalogo.activo) {
        throw new ErrorConflicto(
          `El avío "${delCatalogo.clave}" está desactivado; no se puede precostear.`,
        );
      }
      // Sin amarre por Desarrollo (esto no viene del BOM): la cascada arranca en la ÚLTIMA COMPRA
      // REAL del avío (§Post-F9.48) y de ahí cae a "más barato"/referencia. Un renglón manual tiene
      // que valuar igual que uno del BOM: si no, vuelven a existir dos precios para lo mismo.
      const ultimosDelAvio = await leerUltimosPreciosCompra(tx, sesion.idEmpresaActiva, {
        avios: [delCatalogo.id],
      });
      const resuelto = precioAvioDeCatalogo(delCatalogo, null, delCatalogo.id, ultimosDelAvio);
      avio = {
        id: delCatalogo.id,
        etiqueta: `${delCatalogo.clave} — ${delCatalogo.descripcion}`,
        precio: resuelto.precio,
        idProveedor: resuelto.idProveedor,
      };
    }

    // El consumo TECLEADO también se redondea a la escala de su columna (`Decimal(12,4)`): el input
    // es texto libre, así que puede llegar con más decimales de los que se pueden guardar.
    const consumo = datos.consumo == null ? null : redondear4(datos.consumo);
    // El precio TECLEADO manda; si no vino, el del catálogo del avío. Si el avío no tiene NINGÚN
    // precio en la cascada (sin proveedores, sin `precioReferencia` y sin medidas activas) el
    // renglón entra en CERO — mismo criterio que el renglón del BOM, que también valúa 0. Ese cero
    // NO se le avisa al usuario en pantalla (lo ve en la columna Precio y lo puede editar); lo
    // único que queda es la marca `sinPrecioCatalogo` en la bitácora de abajo, para poder
    // rastrearlo después. El esquema ya exige que venga el precio o el avío.
    const sinPrecioCatalogo = datos.precioUnit === undefined && (avio?.precio ?? null) === null;
    const precioUnit = redondear2(datos.precioUnit ?? avio?.precio ?? 0);
    const importe = consumo === null ? precioUnit : redondear2(consumo * precioUnit);

    const linea = await tx.precostoLinea.create({
      data: {
        idPrecosto,
        idConceptoCosto: concepto.id,
        origen: 'manual',
        descripcion: datos.descripcion ?? avio?.etiqueta ?? concepto.nombre,
        consumo,
        precioUnit,
        importe,
        // Traza: el renglón queda LIGADO al avío (y al proveedor cuyo precio se usó), no sólo con
        // su nombre copiado.
        ...(avio === null ? {} : { idAvio: avio.id, idAvioProveedor: avio.idProveedor }),
        ...(datos.notas === undefined ? {} : { notas: datos.notas }),
        ...datosCreacion(sesion),
      },
      select: { id: true },
    });
    await tx.precosto.update({ where: { id: idPrecosto }, data: { ...datosModificacion(sesion) } });

    await registrarBitacora(tx, sesion, {
      entidad: 'Precosto',
      idEntidad: idPrecosto,
      accion: 'MODIFICAR',
      datos: {
        operacion: 'agregar-linea',
        idLinea: linea.id,
        idConcepto: concepto.id,
        ...(avio === null ? {} : { idAvio: avio.id }),
        // El avío no tenía precio en NINGÚN escalón de la cascada y el renglón entró en $0: queda
        // la marca aquí (es lo único que lo delata; en pantalla sólo se ve el 0).
        ...(sinPrecioCatalogo ? { sinPrecioCatalogo: true } : {}),
      },
    });
  }, bd);

  return obtenerPrecosto(sesion, idPrecosto, bd);
}

/**
 * Edita CUALQUIER renglón de un borrador (rediseño R5, B12 — calculadora de negociación en vivo):
 * descripción/consumo/precio/notas (PATCH parcial). El importe se recompone. Si el renglón viene del
 * BOM (tela/avío/arte), al editarlo pasa a `ajustado=true` (traza) para que `recalcularDesdeBom`
 * NO lo pise; `restaurarLineaBom` lo revierte al valor del BOM. Los manuales se editan igual que
 * antes. Sólo sobre un BORRADOR. Requiere `desarrollo.precostear`.
 */
export async function editarLinea(
  sesion: SesionUsuario,
  idPrecosto: number,
  idLinea: number,
  entrada: EntradaLineaEditar,
  bd?: ContextoBd,
): Promise<PrecostoSalida> {
  verificarPermiso(sesion, 'desarrollo.precostear');
  const datos: DatosPrecostoLineaEditar = validarEntrada(esquemaPrecostoLineaEditar, entrada);

  await enTransaccion(async (tx) => {
    // Lock por desarrollo ANTES de leer el estado: `exigirBorrador` corre serializado (evita el
    // write-skew que violaría D3 si otra tx congela en paralelo).
    await bloquearDesarrolloDePrecosto(tx, idPrecosto, sesion.idEmpresaActiva);
    const precosto = await exigirPrecosto(tx, idPrecosto, sesion.idEmpresaActiva);
    exigirBorrador(precosto);

    const linea = await tx.precostoLinea.findFirst({
      where: { id: idLinea, idPrecosto },
      select: { id: true, origen: true, descripcion: true, consumo: true, precioUnit: true },
    });
    if (linea === null) {
      throw new ErrorNoEncontrado('PrecostoLinea', idLinea);
    }

    const descripcion = datos.descripcion ?? linea.descripcion;
    // Mismo redondeo a 4 que en el alta: el consumo tecleado puede traer más decimales de los que
    // la columna guarda, y el importe se calcula con ESTE número.
    const consumoCrudo = datos.consumo === undefined ? numOrNull(linea.consumo) : datos.consumo;
    const consumo = consumoCrudo === null ? null : redondear4(consumoCrudo);
    // El precio se REDONDEA A 2 antes de guardarlo y de calcular el importe (misma regla que el
    // alta). Sin esto, precio e importe de la MISMA fila podían descuadrarse un centavo: la columna
    // es `Decimal(12,2)` y Postgres redondea half-up al guardar (1.005 → 1.01), mientras que
    // `redondear2(1.005)` en JS da 1.00 (artefacto binario: 1.005×100 = 100.4999…). El importe
    // descuadrado entraba al `costoTotal` que se persiste al congelar.
    const precioUnit = redondear2(
      datos.precioUnit === undefined ? linea.precioUnit.toNumber() : datos.precioUnit,
    );
    const importe = consumo === null ? precioUnit : redondear2(consumo * precioUnit);
    // Editar un renglón de origen BOM lo marca AJUSTADO (B12): recalcular ya no lo pisa.
    const esBom = (ORIGENES_BOM as readonly string[]).includes(linea.origen);

    await tx.precostoLinea.update({
      where: { id: idLinea },
      data: {
        descripcion,
        consumo,
        precioUnit,
        importe,
        ...(esBom ? { ajustado: true } : {}),
        ...(datos.notas === undefined ? {} : { notas: datos.notas }),
        ...datosModificacion(sesion),
      },
    });
    await tx.precosto.update({ where: { id: idPrecosto }, data: { ...datosModificacion(sesion) } });

    await registrarBitacora(tx, sesion, {
      entidad: 'Precosto',
      idEntidad: idPrecosto,
      accion: 'MODIFICAR',
      datos: { operacion: 'editar-linea', idLinea },
    });
  }, bd);

  return obtenerPrecosto(sesion, idPrecosto, bd);
}

/**
 * Quita un renglón de un borrador (rediseño R5, B12): en la calculadora de negociación se puede
 * quitar CUALQUIER renglón (una tela/avío/proceso — "se quitan bolsas traseras") SALVO los ANCLAS
 * fijos (maquila/corte/empaque: se editan, no se borran). Un renglón de origen BOM quitado reaparece al
 * `recalcularDesdeBom` (reset al BOM del modelo); para quitarlo definitivamente se edita el BOM del
 * modelo. Sólo sobre un BORRADOR. Requiere `desarrollo.precostear`.
 */
export async function eliminarLinea(
  sesion: SesionUsuario,
  idPrecosto: number,
  idLinea: number,
  bd?: ContextoBd,
): Promise<PrecostoSalida> {
  verificarPermiso(sesion, 'desarrollo.precostear');

  await enTransaccion(async (tx) => {
    // Lock por desarrollo ANTES de leer el estado: `exigirBorrador` corre serializado (evita el
    // write-skew que violaría D3 si otra tx congela en paralelo).
    await bloquearDesarrolloDePrecosto(tx, idPrecosto, sesion.idEmpresaActiva);
    const precosto = await exigirPrecosto(tx, idPrecosto, sesion.idEmpresaActiva);
    exigirBorrador(precosto);

    const linea = await tx.precostoLinea.findFirst({
      where: { id: idLinea, idPrecosto },
      select: { id: true, origen: true, conceptoCosto: { select: { codigo: true, nombre: true } } },
    });
    if (linea === null) {
      throw new ErrorNoEncontrado('PrecostoLinea', idLinea);
    }
    if (esAnclaFija(linea.origen, linea.conceptoCosto.codigo)) {
      throw new ErrorConflicto(
        `El renglón de "${linea.conceptoCosto.nombre}" es fijo por prenda; se edita pero no se elimina.`,
      );
    }

    await tx.precostoLinea.delete({ where: { id: idLinea } });
    await tx.precosto.update({ where: { id: idPrecosto }, data: { ...datosModificacion(sesion) } });

    await registrarBitacora(tx, sesion, {
      entidad: 'Precosto',
      idEntidad: idPrecosto,
      accion: 'MODIFICAR',
      datos: { operacion: 'eliminar-linea', idLinea },
    });
  }, bd);

  return obtenerPrecosto(sesion, idPrecosto, bd);
}

/**
 * RESTAURA un renglón de origen BOM AJUSTADO (rediseño R5, B12) al valor del BOM del modelo: recupera
 * consumo/precio/proveedor del BOM vigente y limpia `ajustado`. Si el insumo YA NO existe en el BOM
 * (se quitó del modelo), la restauración lo ELIMINA (queda igual que un recalcular). Sólo aplica a
 * renglones BOM ajustados de un BORRADOR. Requiere `desarrollo.precostear`.
 */
export async function restaurarLineaBom(
  sesion: SesionUsuario,
  idPrecosto: number,
  idLinea: number,
  bd?: ContextoBd,
): Promise<PrecostoSalida> {
  verificarPermiso(sesion, 'desarrollo.precostear');

  await enTransaccion(async (tx) => {
    await bloquearDesarrolloDePrecosto(tx, idPrecosto, sesion.idEmpresaActiva);
    const precosto = await exigirPrecosto(tx, idPrecosto, sesion.idEmpresaActiva);
    exigirBorrador(precosto);

    const linea = await tx.precostoLinea.findFirst({
      where: { id: idLinea, idPrecosto },
      select: {
        id: true,
        origen: true,
        ajustado: true,
        idTela: true,
        idAvio: true,
        idModeloArte: true,
        descripcion: true,
      },
    });
    if (linea === null) {
      throw new ErrorNoEncontrado('PrecostoLinea', idLinea);
    }
    if (!(ORIGENES_BOM as readonly string[]).includes(linea.origen)) {
      throw new ErrorConflicto('Sólo se restauran renglones que vienen del BOM (tela/avío/arte).');
    }

    const desarrollo = await tx.desarrollo.findUnique({
      where: { id: precosto.idDesarrollo },
      select: { idModelo: true },
    });
    if (desarrollo === null) {
      throw new ErrorNoEncontrado('Desarrollo', precosto.idDesarrollo);
    }
    const modelo = await leerModeloConBom(tx, desarrollo.idModelo);
    if (modelo === null) {
      throw new ErrorNoEncontrado('Modelo', desarrollo.idModelo);
    }
    const conceptos = await conceptosBase(tx);
    const ultimos = await ultimosPreciosDelBom(tx, sesion.idEmpresaActiva, modelo);
    const clave = claveBom(linea);
    // El arte que perdió su traza se reconoce por NOMBRE (ver `claveArtePorNombre`): si el modelo
    // volvió a tener un arte así llamado, restaurar lo REENGANCHA en vez de borrar el renglón.
    const porNombre = linea.origen === 'bom_arte' && linea.idModeloArte === null;
    const original = lineasBomDesdeModelo(modelo, conceptos, sesion, ultimos).find((l) =>
      porNombre
        ? l.origen === 'bom_arte' && claveArtePorNombre(l) === claveArtePorNombre(linea)
        : claveBom(l) === clave,
    );

    if (original === undefined) {
      // El insumo ya no está en el BOM del modelo → restaurar = quitar el renglón.
      await tx.precostoLinea.delete({ where: { id: idLinea } });
    } else {
      await tx.precostoLinea.update({
        where: { id: idLinea },
        data: {
          descripcion: original.descripcion,
          consumo: original.consumo ?? null,
          precioUnit: original.precioUnit,
          importe: original.importe,
          idTelaProveedor: original.idTelaProveedor ?? null,
          idAvioProveedor: original.idAvioProveedor ?? null,
          // Reenganchado por nombre: la traza vuelve a apuntar al arte vigente del modelo (deja de
          // estar huérfana, así que el siguiente recalcular ya casa por id).
          ...(porNombre && typeof original.idModeloArte === 'number'
            ? { idModeloArte: original.idModeloArte }
            : {}),
          ajustado: false,
          ...datosModificacion(sesion),
        },
      });
    }
    await tx.precosto.update({ where: { id: idPrecosto }, data: { ...datosModificacion(sesion) } });

    await registrarBitacora(tx, sesion, {
      entidad: 'Precosto',
      idEntidad: idPrecosto,
      accion: 'MODIFICAR',
      datos: { operacion: 'restaurar-linea-bom', idLinea, eliminado: original === undefined },
    });
  }, bd);

  return obtenerPrecosto(sesion, idPrecosto, bd);
}

/** Renglón visto por el GUARD del congelado: sólo lo que decide si hay contenido costeado. */
export interface RenglonCongelable {
  /** `bom_tela` / `bom_avio` / `bom_arte` / `manual`. */
  origen: string;
  /** Código del concepto de costo (`tela`, `maquila`, `corte`, `empaque`, …). */
  conceptoCodigo: string;
  /** Importe del renglón, ya en número (la columna es `Decimal(12,2)`). */
  importe: number;
}

/**
 * ⭐ V1-E4 (punto 2) — GUARD del congelado: un precosto NO se congela SIN NADA COSTEADO.
 *
 * El caso real: se genera el precosto de un modelo cuya receta todavía está vacía (o cuyos insumos
 * no tienen precio), así que sus renglones nacen en $0.00 — incluidas las anclas de maquila y
 * corte. `congelarVersion` solo exigía "≥1 renglón", así que la versión se congelaba con
 * `costoTotal = 0` y quedaba INMUTABLE (D3). De ahí sale, sin un solo aviso, el `costoUnit` de un
 * renglón de lista de precios y el precio que se le cotiza al cliente: vender a costo cero.
 *
 * Nadie lo nota probando a mano porque el congelado "funciona": la pantalla no truena, solo miente.
 * Es dominio PURO a propósito, para que la regresión se pueda cementar sin base de datos.
 *
 * 🔴🔴 **Por qué mira los RENGLONES y no sólo el total (candado del 31-ago-2026).** La versión 0.060
 * metió el EMPAQUE como tercera ancla fija, con un default de la empresa ($2.20) que `generarPrecosto`
 * pone en **todo** precosto nuevo sin que nadie capture nada (§Post-F9.153). Desde entonces un modelo
 * con la receta vacía ya no suma $0.00: suma $2.20 — **y pasaba esta guarda sin protestar**. La
 * versión se congelaba INMUTABLE, y de ese precosto salía el precio al cliente: una prenda cotizada
 * a su bolsa. El guard seguía en pie, pero ya no protegía de nada real, y el escenario nativo de lo
 * que viene (cotizar en la cita un modelo que se crea en ese momento) es justamente ése.
 *
 * **La regla:** el total, DESCONTANDO el ancla de empaque, tiene que ser **> 0**. O sea, la SUMA de
 * todo lo que no es el empaque automático tiene que aportar:
 * - cualquier renglón de la receta (tela / avío / arte) valuado, **o**
 * - el ancla de **maquila** o la de **corte** con costo capturado, **o**
 * - cualquier renglón MANUAL que la persona haya agregado en la calculadora de negociación.
 *
 * Es EXACTAMENTE la guarda de antes de 0.060 con el empaque descontado: nada que fuera congelable
 * entonces deja de serlo ahora. Y por eso la regla es sobre el CONTENIDO, no sobre el monto:
 * - un precosto de sólo maquila y corte, con la receta vacía, SÍ congela (costeo por proceso: no
 *   toda prenda lleva BOM);
 * - un precosto con receta real cuyo total sea bajísimo ($0.01) SÍ congela;
 * - un empaque subido a $50 a mano NO alcanza: sigue siendo el costo de la bolsa, no el de la prenda.
 *
 * Negativo también se rechaza: un total bajo cero solo puede salir de renglones mal capturados, y
 * congelarlo dejaría un precio de venta por debajo del costo, igual de inmutable.
 */
export function exigirCostoCongelable(
  costoTotal: number,
  renglones: readonly RenglonCongelable[],
): void {
  if (costoTotal < 0) {
    throw new ErrorConflicto(
      `El precosto suma un total NEGATIVO ($${costoTotal.toFixed(2)}); revisa los renglones antes de congelar.`,
    );
  }
  if (costoTotal === 0) {
    throw new ErrorConflicto(
      'El precosto suma $0.00; congelarlo dejaría una versión INMUTABLE en cero, y de ahí sale el precio al cliente. Captura la receta del modelo (telas/avíos) o los costos de maquila y corte antes de congelar.',
    );
  }
  // ⭐ El candado que 0.060 dejó hacer falta: ¿hay algo costeado, o el total es puro empaque?
  //
  // Se SUMA lo que no es empaque, en vez de buscar "algún renglón > 0", para que esto sea LITERAL
  // la guarda de antes de 0.060 con el empaque descontado. Hoy las dos formas dan lo mismo porque
  // todo importe es ≥ 0 por contrato (`precioUnit` y `consumo` son `.nonnegative()` en el esquema,
  // y `maquilaBase`/`costoEmpaqueBase` también), pero el día que entre un renglón NEGATIVO —un
  // descuento en la mesa de negociación, un ETL de precostos— "alguno > 0" dejaría congelar
  // `tela 30 + descuento −30 + empaque 2.20`: un precosto que vale su bolsa, justo el defecto que
  // este candado vino a cerrar. La suma no depende de que esa suposición siga siendo cierta.
  const sinEmpaque = redondear2(
    renglones.reduce((suma, linea) => (esAnclaEmpaque(linea) ? suma : suma + linea.importe), 0),
  );
  if (sinEmpaque > 0) return;
  // El importe del empaque se calcula de los RENGLONES (no restando del total), para que el mensaje
  // diga el número real de la empresa —que es configurable— y no dependa del total que le pasaron.
  const empaque = redondear2(
    renglones.reduce((suma, linea) => (esAnclaEmpaque(linea) ? suma + linea.importe : suma), 0),
  );
  throw new ErrorConflicto(
    `Fuera del EMPAQUE ($${empaque.toFixed(2)}) —que el sistema pone por su cuenta— el precosto no suma NADA costeado. Congelarlo dejaría una versión INMUTABLE de la que sale el precio al cliente. Captura la receta del modelo (telas/avíos/arte) o los costos de maquila y corte antes de congelar.`,
  );
}

/**
 * CONGELA un borrador (A2): valida que tenga ≥1 renglón, calcula y PERSISTE `costoTotal` (Σ importes),
 * marca `estado=congelado` + `congeladoEn`/`congeladoPorId`. La versión queda INMUTABLE (D3). Al haber
 * ≥1 congelado, el estado DERIVADO del desarrollo pasa a "cotizado" SOLO (E2). Requiere
 * `desarrollo.precostear`.
 */
export async function congelarVersion(
  sesion: SesionUsuario,
  idPrecosto: number,
  bd?: ContextoBd,
): Promise<PrecostoSalida> {
  verificarPermiso(sesion, 'desarrollo.precostear');

  await enTransaccion(async (tx) => {
    // Lock por desarrollo ANTES de leer el estado: `exigirBorrador` corre serializado (evita el
    // write-skew que violaría D3 si otra tx congela en paralelo).
    await bloquearDesarrolloDePrecosto(tx, idPrecosto, sesion.idEmpresaActiva);
    const precosto = await exigirPrecosto(tx, idPrecosto, sesion.idEmpresaActiva);
    exigirBorrador(precosto);

    // El `origen` + el código del concepto viajan junto al importe porque la guarda de abajo no
    // mira sólo cuánto suma, sino QUÉ lo suma (el ancla automática de empaque no cuenta).
    const lineas = await tx.precostoLinea.findMany({
      where: { idPrecosto },
      select: { importe: true, origen: true, conceptoCosto: { select: { codigo: true } } },
    });
    if (lineas.length === 0) {
      throw new ErrorConflicto(
        'El precosto no tiene renglones; agrega al menos uno antes de congelar.',
      );
    }
    const renglones: RenglonCongelable[] = lineas.map((l) => ({
      origen: l.origen,
      conceptoCodigo: l.conceptoCosto.codigo,
      importe: l.importe.toNumber(),
    }));
    const costoTotal = redondear2(renglones.reduce((suma, l) => suma + l.importe, 0));
    // V1-E4 (punto 2): la versión que se congela es INMUTABLE y alimenta el precio al cliente.
    exigirCostoCongelable(costoTotal, renglones);

    await tx.precosto.update({
      where: { id: idPrecosto },
      data: {
        estado: 'congelado',
        congeladoEn: new Date(),
        congeladoPorId: sesion.id,
        costoTotal,
        ...datosModificacion(sesion),
      },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'Precosto',
      idEntidad: idPrecosto,
      accion: 'MODIFICAR',
      datos: { operacion: 'congelar', version: precosto.version, costoTotal },
    });
  }, bd);

  return obtenerPrecosto(sesion, idPrecosto, bd);
}

/** Obtiene un precosto completo (con renglones) de la empresa activa, o `ErrorNoEncontrado`. */
export async function obtenerPrecosto(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<PrecostoSalida> {
  verificarPermiso(sesion, 'desarrollo.ver');
  const precosto = await clienteLectura(bd).precosto.findFirst({
    where: { id, desarrollo: { proyecto: { idEmpresa: sesion.idEmpresaActiva } } },
    include: incluirPrecosto,
  });
  if (precosto === null) {
    throw new ErrorNoEncontrado('Precosto', id);
  }
  return aPrecostoSalida(precosto, tienePermiso(sesion, 'consultas.ver-importes'));
}

/**
 * HISTORIAL de precostos de un desarrollo (más nuevo primero), como resúmenes con su total. Scope por
 * empresa activa (A9). Requiere `desarrollo.ver`.
 */
export async function listarPrecostosDeDesarrollo(
  sesion: SesionUsuario,
  idDesarrollo: number,
  bd?: ContextoBd,
): Promise<PrecostosDesarrolloLista> {
  verificarPermiso(sesion, 'desarrollo.ver');
  const cliente = clienteLectura(bd);

  const desarrollo = await cliente.desarrollo.findFirst({
    where: { id: idDesarrollo, proyecto: { idEmpresa: sesion.idEmpresaActiva } },
    select: { id: true },
  });
  if (desarrollo === null) {
    throw new ErrorNoEncontrado('Desarrollo', idDesarrollo);
  }

  const precostos = await cliente.precosto.findMany({
    where: { idDesarrollo },
    orderBy: { version: 'desc' },
    include: { lineas: { select: { importe: true } } },
  });
  const verImportes = tienePermiso(sesion, 'consultas.ver-importes');

  return precostos.map((p): PrecostoResumen => {
    const total = redondear2(p.lineas.reduce((suma, l) => suma + l.importe.toNumber(), 0));
    return {
      id: p.id,
      version: p.version,
      estado: p.estado,
      congelado: p.estado === 'congelado',
      costoTotal: verImportes ? total : null,
      congeladoEn: p.congeladoEn === null ? null : p.congeladoEn.toISOString(),
      congeladoPorId: p.congeladoPorId,
      creadoEn: p.creadoEn.toISOString(),
    };
  });
}
