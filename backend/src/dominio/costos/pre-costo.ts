/**
 * PRE-COSTO por modelo + LISTA DE PRECIOS (F7-E1; doc 06-Costos-y-EDR §2/§5, 01-Modelos §2/§3;
 * DECISIONES.md D1/D2). Toda la lógica vive AQUÍ (A1); las rutas solo validan permiso + Zod.
 *
 * El pre-costo NO es una tabla: es CÁLCULO de dominio sobre la receta (verificado: `PreCostos` no era
 * tabla en el viejo). Reproduce las consultas `CostoTela`/`CostoHabilitacion`/`CostoBordado`:
 *  • Tela   = Σ ( `ModeloTela.consumoPorPrenda` × `Tela.precioSugerido` )  [renglones `paraPreCosto`]
 *  • Avíos  = Σ ( `ModeloAvio.consumoPorPrenda` × `Avio.precioReferencia` ) [renglones `paraPreCosto`]
 *  • Bordado= Σ ( `ModeloBordado.precio` ?? `Bordado.precio` )  — UNA vez por modelo, SIN cantidad
 *  • Maquila= `Modelo.maquilaBase`
 *  • Costo  = Tela + Avíos + Bordado + Maquila     (SIN regalías — la regalía va sobre la venta, D2)
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

import { calcularPrecioSugerido, type ParametrosPrecioSugerido } from './precio-sugerido.js';
import { resolverPrecioAvio, resolverPrecioTela } from './resolucion-precios.js';

/** Cliente de LECTURA. */
type ClienteLectura = ReturnType<typeof clienteLectura>;

/** Redondeo monetario a 2 decimales (evita artefactos de float en las sumas). */
function redondear2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Nº de un `Decimal` opcional (null → 0). Patrón ceronulo. */
function num(d: Prisma.Decimal | null | undefined): number {
  return d == null ? 0 : d.toNumber();
}

/** Nº de un `Decimal` opcional CONSERVANDO el null (para la cascada de resolución de precios, F8). */
function numOrNull(d: Prisma.Decimal | null | undefined): number | null {
  return d == null ? null : d.toNumber();
}

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
 * `include` para traer la receta paraPreCosto de un modelo con los precios de catálogo.
 *
 * F8-E1 (R17): además del precio genérico de catálogo (`Tela.precioSugerido`/`Avio.precioReferencia`,
 * el de F7) se trae el AMARRE del BOM cuando existe — el renglón proveedor–producto–precio elegido
 * por Desarrollo. El pre-costo es por modelo (SIN color/talla), así que la cascada de tela se reduce
 * a amarre → sugerido, y la de avío a amarre → más barato → referencia. Un modelo SIN amarres
 * precostea IDÉNTICO a F7 (no-regresión, ver `numerosPreCosto`).
 */
const incluirReceta = {
  genero: { select: { nombre: true } },
  telas: {
    where: { paraPreCosto: true },
    select: {
      idTela: true,
      consumoPorPrenda: true,
      idTelaProveedor: true,
      telaProveedor: { select: { precio: true, manejaPrecioPorColor: true } },
      tela: { select: { nombre: true, precioSugerido: true } },
    },
  },
  avios: {
    where: { paraPreCosto: true },
    select: {
      idAvio: true,
      consumoPorPrenda: true,
      idAvioProveedor: true,
      avio: {
        select: {
          clave: true,
          descripcion: true,
          precioReferencia: true,
          factorConversion: true,
          proveedores: { select: { idProveedor: true, precio: true, factorConversion: true } },
        },
      },
    },
  },
  bordados: {
    select: {
      idBordado: true,
      precio: true,
      bordado: { select: { nombre: true, precio: true } },
    },
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
  bordados: { idBordado: number; bordado: string; precio: number }[];
  totalTela: number;
  totalAvios: number;
  totalBordado: number;
  maquila: number;
  costoTotal: number;
}

/** Calcula los números crudos del pre-costo de un modelo (función determinista sobre su receta). */
function numerosPreCosto(modelo: ModeloConReceta): NumerosPreCosto {
  const telas = modelo.telas.map((t) => {
    const consumo = num(t.consumoPorPrenda);
    // F8-E1: si el BOM amarró un proveedor a esta tela, se resuelve por la cascada (amarre →
    // sugerido); si NO hay amarre, se usa el precio sugerido genérico EXACTO como F7 (no-regresión).
    const precio =
      t.idTelaProveedor !== null && t.telaProveedor !== null
        ? (resolverPrecioTela({
            precioSugerido: numOrNull(t.tela.precioSugerido),
            amarre: {
              precio: numOrNull(t.telaProveedor.precio),
              manejaPrecioPorColor: t.telaProveedor.manejaPrecioPorColor,
            },
          }).precio ?? 0)
        : num(t.tela.precioSugerido);
    return { idTela: t.idTela, tela: t.tela.nombre, consumo, precio, importe: consumo * precio };
  });
  const avios = modelo.avios.map((a) => {
    const consumo = num(a.consumoPorPrenda);
    // F8-E1: si el BOM amarró un proveedor a este avío, se resuelve por la cascada (amarre → más
    // barato → referencia, normalizando por factor); si NO hay amarre, se usa el precioReferencia
    // EXACTO como F7 (no-regresión: F7 NO aplicaba "más barato" en el pre-costo).
    const precio =
      a.idAvioProveedor !== null
        ? (resolverPrecioAvio({
            precioReferencia: numOrNull(a.avio.precioReferencia),
            factorConversionAvio: numOrNull(a.avio.factorConversion),
            idAvioProveedor: a.idAvioProveedor,
            proveedores: a.avio.proveedores.map((p) => ({
              idProveedor: p.idProveedor,
              precio: numOrNull(p.precio),
              factorConversion: numOrNull(p.factorConversion),
            })),
          }).precio ?? 0)
        : num(a.avio.precioReferencia);
    return {
      idAvio: a.idAvio,
      clave: a.avio.clave,
      descripcion: a.avio.descripcion,
      consumo,
      precio,
      importe: consumo * precio,
    };
  });
  const bordados = modelo.bordados.map((b) => ({
    idBordado: b.idBordado,
    bordado: b.bordado.nombre,
    // El precio vive en el renglón del modelo; si falta (histórico), cae al del catálogo (ceronulo).
    precio: b.precio == null ? num(b.bordado.precio) : b.precio.toNumber(),
  }));

  const totalTela = telas.reduce((s, t) => s + t.importe, 0);
  const totalAvios = avios.reduce((s, a) => s + a.importe, 0);
  const totalBordado = bordados.reduce((s, b) => s + b.precio, 0);
  const maquila = num(modelo.maquilaBase);
  const costoTotal = totalTela + totalAvios + totalBordado + maquila;

  return { telas, avios, bordados, totalTela, totalAvios, totalBordado, maquila, costoTotal };
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

  const modelo = await cliente.modelo.findUnique({
    where: { id: idModelo },
    include: incluirReceta,
  });
  if (modelo === null) {
    throw new ErrorNoEncontrado('Modelo', idModelo);
  }

  const n = numerosPreCosto(modelo);
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
    bordados: n.bordados.map((b) => ({
      idBordado: b.idBordado,
      bordado: b.bordado,
      precio: $(b.precio),
    })),
    totalTela: $(n.totalTela),
    totalAvios: $(n.totalAvios),
    totalBordado: $(n.totalBordado),
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

  const modelos = await cliente.modelo.findMany({
    where,
    orderBy: { codigo: 'asc' },
    include: incluirReceta,
  });
  const params = await parametrosPrecioEmpresa(cliente, sesion.idEmpresaActiva);

  const verImportes = tienePermiso(sesion, 'consultas.ver-importes');
  const $ = (v: number): number | null => (verImportes ? redondear2(v) : null);

  const filas = modelos.map((m) => {
    const n = numerosPreCosto(m);
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
