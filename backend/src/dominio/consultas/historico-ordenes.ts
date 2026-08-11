/**
 * ARCHIVO HISTÓRICO DE ÓRDENES del sistema viejo — consulta (§Post-F9.26).
 *
 * Daniel (10-ago-2026): *"me gustaría tenerlas también como archivo histórico de órdenes. Normalmente
 * cuando queremos consultar algo de información, lo hacemos más desde las órdenes de producción que
 * del catálogo de modelos. Para poder buscar por cliente, número de modelo, tipo de prenda, fecha de
 * producción, maquilero, etc."*
 *
 * SOLO LECTURA, y a propósito: este módulo no exporta ni una función que escriba. El archivo se
 * llena UNA vez con el ETL (`migracion/loaders/historico-ordenes.ts`) y desde ahí es de consulta.
 * Son las ~5,200 órdenes que la ventana de 2025-2026 (§Post-F9.24) deja fuera de lo operativo.
 *
 * PERMISO: se REUSA `ordenes.ver` — quien puede ver órdenes puede ver las viejas. Cero permisos
 * nuevos, cero seed.
 *
 * A9: todo se filtra por la empresa activa de la sesión.
 *
 * EL FILTRO DE MAQUILERO MIRA TODOS LOS LADOS. Daniel (§Post-F9.27): *"es importante que vayan
 * todos. Y no solo el primero. Lo mismo para estampadores."* En el viejo, el taller de la cabecera
 * no es necesariamente quien trabajó la orden —se corta en uno, se cosen partidas en dos o tres y
 * se estampa en otro—, así que la búsqueda cubre la cabecera, los tres campos abiertos con TODOS
 * los participantes y, como red, los movimientos de producción.
 */
import {
  esquemaHistoricoOrdenesQuery,
  type DatosHistoricoOrdenesQuery,
  type HistoricoOrdenDetalle,
  type HistoricoOrdenesPagina,
  type HistoricoOrdenResumen,
} from '../../contrato/index.js';
import type { Prisma } from '../../datos/index.js';

import { ErrorNoEncontrado } from '../../comun/errores.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

/** Proyección compartida por listado y detalle (el modelo aporta tipo de prenda y género). */
const incluirResumen = {
  modelo: {
    select: {
      codigo: true,
      descripcion: true,
      tipoProducto: { select: { nombre: true } },
      genero: { select: { nombre: true } },
    },
  },
} satisfies Prisma.HistoricoOrdenV1Include;

type OrdenConModelo = Prisma.HistoricoOrdenV1GetPayload<{ include: typeof incluirResumen }>;

/** Fecha (solo día) a `YYYY-MM-DD`, o null. */
const aFecha = (d: Date | null): string | null =>
  d === null ? null : d.toISOString().slice(0, 10);

function aResumen(o: OrdenConModelo): HistoricoOrdenResumen {
  return {
    id: o.id,
    numero: o.numero,
    fecha: aFecha(o.fecha),
    fechaEntrega: aFecha(o.fechaEntrega),
    idModelo: o.idModelo,
    // Si el modelo no se pudo ligar al migrar, se muestra el código que traía el viejo: que la
    // orden aparezca "sin modelo" por un mapeo fallido sería peor que mostrar el texto crudo.
    modelo: o.modelo?.codigo ?? o.codigoModeloV1,
    descripcionModelo: o.modelo?.descripcion ?? null,
    tipoProducto: o.modelo?.tipoProducto?.nombre ?? null,
    genero: o.modelo?.genero?.nombre ?? null,
    cliente: o.cliente,
    maquilero: o.maquilero,
    cortadores: o.cortadores,
    maquileros: o.maquileros,
    estampadores: o.estampadores,
    etiquetaMarca: o.etiquetaMarca,
    totalPiezas: o.totalPiezas,
    cancelada: o.cancelada,
  };
}

/** Arma el `where` de Prisma con los filtros del buscador. */
function construirWhere(
  idEmpresa: number,
  f: DatosHistoricoOrdenesQuery,
): Prisma.HistoricoOrdenV1WhereInput {
  const contiene = (valor: string): Prisma.StringFilter => ({
    contains: valor,
    mode: 'insensitive',
  });

  const where: Prisma.HistoricoOrdenV1WhereInput = { idEmpresa };

  if (f.incluirCanceladas === 'false') where.cancelada = false;
  if (f.idModelo !== undefined) where.idModelo = f.idModelo;
  if (f.cliente !== undefined && f.cliente !== '') where.cliente = contiene(f.cliente);

  // Tipo de prenda y género viven en el MODELO: se filtran a través de la relación, sin duplicar
  // esos campos en el archivo (y sin que una orden sin modelo ligado se cuele).
  if (f.idTipoProducto !== undefined || f.idGenero !== undefined) {
    where.modelo = {
      ...(f.idTipoProducto === undefined ? {} : { idTipoProducto: f.idTipoProducto }),
      ...(f.idGenero === undefined ? {} : { idGenero: f.idGenero }),
    };
  }

  if (f.desde !== undefined || f.hasta !== undefined) {
    where.fecha = {
      ...(f.desde === undefined ? {} : { gte: new Date(`${f.desde}T00:00:00.000Z`) }),
      ...(f.hasta === undefined ? {} : { lte: new Date(`${f.hasta}T00:00:00.000Z`) }),
    };
  }

  // El taller: la cabecera, los campos abiertos con TODOS los que la trabajaron (§Post-F9.27) o
  // los procesos. Los campos abiertos van primero porque resuelven la mayoría sin subquery; el
  // `some` sobre procesos se queda como red por si un nombre solo vive ahí.
  if (f.maquilero !== undefined && f.maquilero !== '') {
    where.OR = [
      { maquilero: contiene(f.maquilero) },
      { cortadores: contiene(f.maquilero) },
      { maquileros: contiene(f.maquilero) },
      { estampadores: contiene(f.maquilero) },
      { procesos: { some: { tercero: contiene(f.maquilero) } } },
    ];
  }

  // La caja de búsqueda libre. Va en `AND` para que no se coma los otros filtros (si fuera otro
  // `OR` al mismo nivel, buscar "azul" con cliente="X" traería órdenes de cualquier cliente).
  if (f.busqueda !== undefined && f.busqueda !== '') {
    where.AND = [
      {
        OR: [
          { numero: contiene(f.busqueda) },
          { cliente: contiene(f.busqueda) },
          { codigoModeloV1: contiene(f.busqueda) },
          { modelo: { codigo: contiene(f.busqueda) } },
          { modelo: { descripcion: contiene(f.busqueda) } },
        ],
      },
    ];
  }

  return where;
}

/**
 * Cláusula de orden de UNA columna, con los NULOS SIEMPRE AL FINAL.
 *
 * En Postgres `DESC` implica `NULLS FIRST`, y el orden por defecto del archivo es justamente
 * `fecha desc`: sin esto, la primera página se llenaba con las órdenes viejas que no traían fecha
 * (el viejo la dejaba vacía a menudo) en vez de con las más recientes — que es lo que se busca. Lo
 * mismo con el cliente. `numero` y `totalPiezas` no son nullable: van con la forma simple.
 */
function columnaDeOrden(
  columna: DatosHistoricoOrdenesQuery['ordenarPor'],
  direccion: 'asc' | 'desc',
): Prisma.HistoricoOrdenV1OrderByWithRelationInput {
  switch (columna) {
    case 'fecha':
      return { fecha: { sort: direccion, nulls: 'last' } };
    case 'cliente':
      return { cliente: { sort: direccion, nulls: 'last' } };
    default:
      return { [columna]: direccion };
  }
}

/** Lista el archivo con filtros y paginación. Permiso `ordenes.ver`. */
export async function listarHistoricoOrdenes(
  sesion: SesionUsuario,
  filtros: unknown,
  bd?: ContextoBd,
): Promise<HistoricoOrdenesPagina> {
  verificarPermiso(sesion, 'ordenes.ver');
  const f = validarEntrada(esquemaHistoricoOrdenesQuery, filtros);
  const cliente = clienteLectura(bd);
  const where = construirWhere(sesion.idEmpresaActiva, f);

  // Desempate por id: sin él, dos órdenes de la misma fecha pueden bailar entre páginas.
  const orderBy: Prisma.HistoricoOrdenV1OrderByWithRelationInput[] = [
    columnaDeOrden(f.ordenarPor, f.direccion),
    { id: 'desc' },
  ];

  const [total, filas] = await Promise.all([
    cliente.historicoOrdenV1.count({ where }),
    cliente.historicoOrdenV1.findMany({
      where,
      include: incluirResumen,
      orderBy,
      skip: (f.pagina - 1) * f.porPagina,
      take: f.porPagina,
    }),
  ]);

  return {
    datos: filas.map(aResumen),
    total,
    pagina: f.pagina,
    porPagina: f.porPagina,
  };
}

/** Ficha completa de una orden histórica: su matriz color×talla y quién la trabajó. */
export async function obtenerHistoricoOrden(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<HistoricoOrdenDetalle> {
  verificarPermiso(sesion, 'ordenes.ver');
  const cliente = clienteLectura(bd);

  const orden = await cliente.historicoOrdenV1.findFirst({
    where: { id, idEmpresa: sesion.idEmpresaActiva },
    include: {
      ...incluirResumen,
      lineas: { orderBy: [{ color: 'asc' }, { id: 'asc' }] },
      procesos: { orderBy: [{ fecha: 'asc' }, { id: 'asc' }] },
    },
  });
  if (orden === null) throw new ErrorNoEncontrado('Orden histórica', id);

  return {
    ...aResumen(orden),
    tela: orden.tela,
    composicion: orden.composicion,
    observaciones: orden.observaciones,
    motivoCancelada: orden.motivoCancelada,
    idOrdenV1: orden.idOrdenV1,
    lineas: orden.lineas.map((l) => ({ color: l.color, talla: l.talla, cantidad: l.cantidad })),
    procesos: orden.procesos.map((p) => ({
      tipo: p.tipo,
      fecha: aFecha(p.fecha),
      tercero: p.tercero,
      cantidad: p.cantidad,
      observaciones: p.observaciones,
    })),
  };
}
