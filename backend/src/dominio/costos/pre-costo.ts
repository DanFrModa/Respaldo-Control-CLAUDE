/**
 * PRE-COSTO por modelo + LISTA DE PRECIOS (F7-E1; doc 06-Costos-y-EDR §2/§5, 01-Modelos §2/§3;
 * DECISIONES.md D1/D2). Toda la lógica vive AQUÍ (A1); las rutas solo validan permiso + Zod.
 *
 * El pre-costo NO es una tabla: es CÁLCULO de dominio sobre la receta (verificado: `PreCostos` no era
 * tabla en el viejo). Reproduce las consultas `CostoTela`/`CostoHabilitacion`/`CostoBordado`:
 *  • Tela   = Σ ( consumo × precio resuelto )                [renglones `paraPreCosto`]
 *  • Avíos  = Σ ( consumo × precio resuelto )                [renglones `paraPreCosto`]
 *  • Arte   = Σ `ModeloArte.precio`                          — UNA vez por modelo, SIN cantidad
 *  • Maquila= `Modelo.maquilaBase`
 *  • Costo  = Tela + Avíos + Arte + Maquila        (SIN regalías — la regalía va sobre la venta, D2)
 *
 * ⭐ **V1-E3e (§Post-F9.48): este módulo DEJÓ DE SER UN MOTOR APARTE.** Hasta agosto de 2026 el
 * pre-costo rápido valuaba el mismo renglón distinto que la receta y que el precosto persistido —
 * cuatro divergencias, no una—: (1) sin amarre usaba `Avio.precioReferencia` en vez de la cascada
 * completa; (2) **no conocía `promedio-medidas`** (ni miraba `AvioMedida`); (3) **ignoraba
 * `consumoPorTalla`** y siempre usaba `consumoPorPrenda`; y (4) multiplicaba el precio CRUDO en vez
 * de redondearlo antes, como sí hace el motor persistido. Daniel: *"No hay ningún motivo por el cual
 * tener dos precios distintos. Hay que unificarlo."* Las cuatro quedaron cerradas: aquí ya no hay
 * aritmética propia — se llaman `resolverPrecioTela`/`resolverPrecioAvioCatalogo`
 * (`resolucion-precios.ts`) con el ESCALÓN 1 de última compra real, y se redondea con la misma regla
 * (`redondear2`/`redondear4` de `decimales.ts`) que usa `desarrollo/precostos.ts`.
 *
 * ⚠️ Este módulo **no escribe nada** (es lectura pura, sin `create`/`update`/`enTransaccion`): por eso
 * alinearlo **no mueve ningún precio pactado**. Lo congelado vive en `Precosto`/`PrecostoLinea` y se
 * lee tal cual se guardó.
 *
 * La LISTA DE PRECIOS (ex `ListaPreciosEd`) agrega a cada modelo su precio sugerido parametrizado
 * ({@link calcularPrecioSugerido}: utilidad + regalías, redondeo al alza), filtrable por género y
 * activos/inactivos.
 *
 * Innegociables: A1 (lógica aquí), A4 (`precostos.consultar`), A9 (config. de precios por empresa
 * activa; los catálogos son globales — ADR-0007). Los IMPORTES/precios se OCULTAN (null) sin
 * `consultas.ver-importes` (mismo criterio que EsMa).
 */
import type { ListaPreciosSalida, PreCostoModelo } from '../../contrato/index.js';
import type { Prisma } from '../../datos/index.js';
import { z } from 'zod';

import { ErrorNoEncontrado } from '../../comun/errores.js';
import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';
import { conRecetaCompartida, conRecetaCompartidaDeUno } from '../modelos/receta-compartida.js';

import { num, numOrNull, promedioSimple, redondear2, redondear4 } from './decimales.js';
import { calcularPrecioSugerido, type ParametrosPrecioSugerido } from './precio-sugerido.js';
import {
  resolverPrecioAvioCatalogo,
  resolverPrecioTela,
  type CompraRealPrecio,
} from './resolucion-precios.js';
import {
  claveMaterial,
  claveMaterialProveedor,
  leerUltimosPreciosCompra,
  SIN_ULTIMOS_PRECIOS,
  type UltimosPreciosCompra,
} from './ultimo-precio-compra.js';

/** Cliente de LECTURA. */
type ClienteLectura = ReturnType<typeof clienteLectura>;

/**
 * Parámetros de precio (utilidad/regalías) de la empresa activa (A9). Si la config no los trae, cae a
 * los defaults vigentes de Propiedades.csv (50/10, ya seedeados desde F0) para no romper el cálculo.
 */
export async function parametrosPrecioEmpresa(
  cliente: ClienteLectura,
  idEmpresa: number,
): Promise<ParametrosPrecioSugerido> {
  const cfg = await cliente.configuracionEmpresa.findUnique({
    where: { idEmpresa },
    select: { utilidadSugerida: true, regaliasBase: true },
  });
  return {
    utilidadSugerida: cfg?.utilidadSugerida == null ? 50 : cfg.utilidadSugerida.toNumber(),
    regaliasBase: cfg?.regaliasBase == null ? 10 : cfg.regaliasBase.toNumber(),
  };
}

/**
 * `include` para traer la receta paraPreCosto de un modelo con TODO lo que la cascada única necesita.
 *
 * Es EXACTAMENTE el mismo `include` del precosto persistido (`desarrollo/precostos.ts`
 * → `incluirBomModelo`) más el género: el amarre R17, los proveedores del avío (para el "más
 * barato"), sus **medidas activas** (R5/B11 → `promedio-medidas`) y el **consumo por talla** (R18).
 * Cualquier campo que falte aquí es una divergencia esperando a pasar (V1-E3e cerró cuatro).
 */
const incluirReceta = {
  genero: { select: { nombre: true } },
  telas: {
    where: { paraPreCosto: true },
    select: {
      idTela: true,
      consumoPorPrenda: true,
      idTelaProveedor: true,
      telaProveedor: {
        select: { idProveedor: true, precio: true, manejaPrecioPorColor: true },
      },
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
          // R5/B11: medidas ACTIVAS del avío "por medida" → su promedio simple gana la cascada.
          medidas: { where: { activo: true }, select: { precio: true } },
        },
      },
      // R18: cuando el consumo se captura POR TALLA, el pre-costo usa el PROMEDIO SIMPLE de las
      // medidas capturadas (idéntico al precosto persistido), no `consumoPorPrenda`.
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

type ModeloConReceta = Prisma.ModeloGetPayload<{ include: typeof incluirReceta }>;

/** Números CRUDOS del pre-costo (sin ocultar), reutilizados por el detalle y la lista de precios. */
interface NumerosPreCosto {
  telas: { idTela: number; tela: string; consumo: number; precio: number; importe: number }[];
  avios: {
    idAvio: number;
    clave: string;
    descripcion: string;
    consumo: number;
    precio: number;
    importe: number;
  }[];
  artes: { idArte: number; arte: string; precio: number }[];
  totalTela: number;
  totalAvios: number;
  totalArte: number;
  maquila: number;
  costoTotal: number;
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
 * Ids de los materiales `paraPreCosto` de unos modelos, para pedir sus últimas compras EN UN LOTE
 * (la lista de precios recorre el catálogo entero: un `findFirst` por renglón sería un N+1).
 */
function materialesDeModelos(modelos: readonly ModeloConReceta[]): {
  telas: number[];
  avios: number[];
} {
  return {
    telas: modelos.flatMap((m) => m.telas.map((t) => t.idTela)),
    avios: modelos.flatMap((m) => m.avios.map((a) => a.idAvio)),
  };
}

/**
 * Calcula los números crudos del pre-costo de un modelo (función determinista sobre su receta).
 *
 * ⭐ V1-E3e: usa la MISMA cascada y el MISMO redondeo que el precosto persistido — sin excepciones
 * ni ramas propias. `ultimos` trae las últimas compras REALES ya leídas por lote (§Post-F9.48);
 * pasar {@link SIN_ULTIMOS_PRECIOS} equivale a la cascada de catálogo de siempre.
 */
function numerosPreCosto(modelo: ModeloConReceta, ultimos: UltimosPreciosCompra): NumerosPreCosto {
  const telas = modelo.telas.map((t) => {
    // Mismo redondeo del motor persistido: lo que se muestra y lo que multiplica son EL MISMO
    // número (el importe crudo `consumo × precio` fue la 4ª divergencia que cerró V1-E3e).
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
    const precio = redondear2(resuelto.precio ?? 0);
    return {
      idTela: t.idTela,
      tela: t.tela.nombre,
      consumo,
      precio,
      importe: redondear2(consumo * precio),
    };
  });
  const avios = modelo.avios.map((a) => {
    // R18: el consumo POR TALLA se promedia (era la 3ª divergencia: el pre-costo lo ignoraba).
    const consumo = redondear4(
      a.consumoPorTalla && a.tallas.length > 0
        ? promedioSimple(a.tallas.map((x) => num(x.consumo)))
        : num(a.consumoPorPrenda),
    );
    const resuelto = resolverPrecioAvioCatalogo({
      precioReferencia: numOrNull(a.avio.precioReferencia),
      idAvioProveedor: a.idAvioProveedor,
      // R5/B11: el avío "por medida" se costea con el promedio de sus medidas (2ª divergencia).
      medidas: a.avio.medidas.map((m) => num(m.precio)),
      proveedores: a.avio.proveedores.map((p) => ({
        idProveedor: p.idProveedor,
        precio: numOrNull(p.precio),
      })),
      ultimaCompra: aCompraReal(ultimos, claveMaterial('avio', a.idAvio)),
      ultimaCompraProveedorAmarrado:
        a.idAvioProveedor === null
          ? null
          : aCompraReal(ultimos, claveMaterialProveedor('avio', a.idAvio, a.idAvioProveedor), true),
    });
    const precio = redondear2(resuelto.precio ?? 0);
    return {
      idAvio: a.idAvio,
      clave: a.avio.clave,
      descripcion: a.avio.descripcion,
      consumo,
      precio,
      importe: redondear2(consumo * precio),
    };
  });
  // El arte vive DENTRO del modelo desde V1-E3d (§Post-F9.35): UN solo precio, sin catálogo detrás.
  const artes = modelo.artes.map((a) => ({
    idArte: a.id,
    arte: a.descripcion,
    precio: num(a.precio),
  }));

  const totalTela = telas.reduce((s, t) => s + t.importe, 0);
  const totalAvios = avios.reduce((s, a) => s + a.importe, 0);
  const totalArte = artes.reduce((s, a) => s + a.precio, 0);
  const maquila = num(modelo.maquilaBase);
  const costoTotal = totalTela + totalAvios + totalArte + maquila;

  return { telas, avios, artes, totalTela, totalAvios, totalArte, maquila, costoTotal };
}

/**
 * PRE-COSTO de un modelo (A4 `precostos.consultar`, A9 para los parámetros de precio). Devuelve la
 * receta valuada + el precio sugerido. Los importes/precios van en `null` sin `consultas.ver-importes`.
 */
export async function calcularPreCosto(
  sesion: SesionUsuario,
  idModelo: number,
  bd?: ContextoBd,
): Promise<PreCostoModelo> {
  verificarPermiso(sesion, 'precostos.consultar');
  const cliente = clienteLectura(bd);

  const propio = await cliente.modelo.findUnique({
    where: { id: idModelo },
    include: incluirReceta,
  });
  if (propio === null) {
    throw new ErrorNoEncontrado('Modelo', idModelo);
  }
  // 🔴 V1-E9b — LA RECETA COMPARTIDA POR `include` (§Post-F9.167). Aquí la receta llega por NOMBRE
  // DE RELACIÓN (`telas`/`avios`/`avios.tallas`/`artes`) sin nombrar nunca la tabla: es la clase de
  // lectura que el conteo del plan no vio. Sin este injerto, un modelo de producción DERIVADO
  // precostearía con la receta VACÍA —sólo maquila, corte y empaque— sin lanzar y sin verse raro,
  // y de ese número sale el precio que se cotiza en la cara del cliente.
  const modelo = await conRecetaCompartidaDeUno(propio, (idPadre) =>
    cliente.modelo.findUnique({ where: { id: idPadre }, include: incluirReceta }),
  );

  // §Post-F9.48: escalón 1 de la cascada = la última COMPRA REAL, acotada a la empresa activa (A9).
  const ultimos = await leerUltimosPreciosCompra(
    cliente,
    sesion.idEmpresaActiva,
    materialesDeModelos([modelo]),
  );
  const n = numerosPreCosto(modelo, ultimos);
  const params = await parametrosPrecioEmpresa(cliente, sesion.idEmpresaActiva);
  const sugerido = calcularPrecioSugerido(n.costoTotal, params);

  const verImportes = tienePermiso(sesion, 'consultas.ver-importes');
  const $ = (v: number): number | null => (verImportes ? redondear2(v) : null);

  return {
    idModelo: modelo.id,
    codigo: modelo.codigo,
    descripcion: modelo.descripcion,
    telas: n.telas.map((t) => ({
      idTela: t.idTela,
      tela: t.tela,
      consumoPorPrenda: t.consumo,
      precioUnitario: $(t.precio),
      importe: $(t.importe),
    })),
    avios: n.avios.map((a) => ({
      idAvio: a.idAvio,
      clave: a.clave,
      descripcion: a.descripcion,
      consumoPorPrenda: a.consumo,
      precioUnitario: $(a.precio),
      importe: $(a.importe),
    })),
    artes: n.artes.map((a) => ({
      idArte: a.idArte,
      arte: a.arte,
      precio: $(a.precio),
    })),
    totalTela: $(n.totalTela),
    totalAvios: $(n.totalAvios),
    totalArte: $(n.totalArte),
    maquila: $(n.maquila),
    costoTotal: $(n.costoTotal),
    utilidadSugerida: verImportes ? params.utilidadSugerida : null,
    regaliasBase: verImportes ? params.regaliasBase : null,
    precioSugerido: $(sugerido.precioSugerido),
  };
}

/**
 * Filtros de la LISTA DE PRECIOS EN DOMINIO (tipos nativos: `boolean`), distinto del esquema de la URL
 * del contrato (`esquemaListaPreciosQuery`, con `z.stringbool`). La ruta coacciona la querystring y
 * pasa AQUÍ el valor nativo; re-validar `stringbool` sobre un booleano ya coaccionado lanzaría (Zod
 * 4.4.x) → 400 espurio (mismo patrón que `*Dominio` de WIP, hotfix F2 PR #56).
 */
const esquemaListaPreciosDominio = z.object({
  idGenero: z.number().int().positive().optional(),
  incluirInactivos: z.boolean().default(false),
});

/** Parámetros que acepta {@link listaPrecios} (forma nativa, no la de la URL). */
export type ParametrosListaPrecios = z.input<typeof esquemaListaPreciosDominio>;

/**
 * LISTA DE PRECIOS (ex `ListaPreciosEd`): cada modelo con su costo estimado y su precio sugerido,
 * filtrable por género y activos/inactivos (A4 `precostos.consultar`, A9 params por empresa). Importes
 * en `null` sin `consultas.ver-importes`. La usa la pantalla y el impreso PDF R9.
 */
export async function listaPrecios(
  sesion: SesionUsuario,
  parametros: ParametrosListaPrecios = {},
  bd?: ContextoBd,
): Promise<ListaPreciosSalida> {
  verificarPermiso(sesion, 'precostos.consultar');
  const filtros = validarEntrada(esquemaListaPreciosDominio, parametros);
  const cliente = clienteLectura(bd);

  const where: Prisma.ModeloWhereInput = {
    ...(filtros.incluirInactivos ? {} : { activo: true }),
    ...(filtros.idGenero === undefined ? {} : { idGenero: filtros.idGenero }),
  };

  // V1-E9b — misma receta compartida que el precosto de la ficha, en LOTE: los padres de toda la
  // página se leen en UNA consulta (nada de N+1) y varios hijos pueden compartir el mismo.
  const modelos = await conRecetaCompartida(
    await cliente.modelo.findMany({ where, orderBy: { codigo: 'asc' }, include: incluirReceta }),
    (idsPadre) =>
      cliente.modelo.findMany({ where: { id: { in: idsPadre } }, include: incluirReceta }),
  );
  const params = await parametrosPrecioEmpresa(cliente, sesion.idEmpresaActiva);
  // UNA sola consulta de últimas compras para TODOS los modelos de la lista (no una por renglón).
  const ultimos =
    modelos.length === 0
      ? SIN_ULTIMOS_PRECIOS
      : await leerUltimosPreciosCompra(
          cliente,
          sesion.idEmpresaActiva,
          materialesDeModelos(modelos),
        );

  const verImportes = tienePermiso(sesion, 'consultas.ver-importes');
  const $ = (v: number): number | null => (verImportes ? redondear2(v) : null);

  const filas = modelos.map((m) => {
    const n = numerosPreCosto(m, ultimos);
    const sugerido = calcularPrecioSugerido(n.costoTotal, params);
    return {
      idModelo: m.id,
      codigo: m.codigo,
      descripcion: m.descripcion,
      genero: m.genero?.nombre ?? null,
      activo: m.activo,
      costo: $(n.costoTotal),
      precioSugerido: $(sugerido.precioSugerido),
    };
  });

  return {
    utilidadSugerida: verImportes ? params.utilidadSugerida : null,
    regaliasBase: verImportes ? params.regaliasBase : null,
    filas,
  };
}
