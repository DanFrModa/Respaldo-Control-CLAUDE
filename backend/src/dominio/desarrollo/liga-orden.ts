/**
 * ENGANCHE Desarrollo ↔ Producción (F8-E6, D13/R16) — la capa que amarra el expediente de Desarrollo
 * (proyecto → precosto congelado → lista/precio negociado) a la ORDEN de producción que alimenta el
 * MRP/OC. Cinco operaciones, TODA la lógica AQUÍ (A1); las rutas sólo validan permiso + Zod y delegan:
 *
 *  1. `ligarOrden` — crea la `DesarrolloOrden` (una orden liga a lo más UN desarrollo, `idOrden @unique`;
 *     un desarrollo tiene N órdenes por resurtidos). Coherencia (A1): mismo MODELO Y mismo CLIENTE que la
 *     orden, misma empresa (A9), desarrollo no apagado. El estado del desarrollo pasa a
 *     `ligado-produccion` SOLO por el derivado `calcularEstadoDesarrollo` (que cuenta las órdenes) — no se
 *     toca aquí. Permiso `desarrollo.administrar`.
 *  2. `quitarLiga` — borra la fila (la única mutación destructiva del expediente; la liga no es un
 *     snapshot D3, es una relación viva). Permiso `desarrollo.administrar`.
 *  3. `sugerenciaLigaOrden` — PROPUESTA para la UI: el desarrollo candidato (mismo modelo/cliente/empresa,
 *     no apagado, aún no ligado) + `precioSugeridoPedido` = precio del renglón de lista más reciente
 *     (`precioAprobado ?? precioCalculado`). NO escribe el pedido (el flujo F2 aplica el precio). `desarrollo.ver`.
 *  4. `expedienteOrden` — VISTA 360 desde la orden ligada: proyecto, desarrollo (estado derivado),
 *     precosto vigente (última versión CONGELADA + costo), renglón de lista/precio y acuerdos de
 *     negociación (solo lectura). Reusa proyectores de precostos/listas/negociación. `desarrollo.ver`.
 *  5. `tableroDesarrollos` — conteos de desarrollos por ESTADO derivado, AGREGADOS EN EL SERVIDOR
 *     (reusa `conteosDesarrollos`), filtrable por cliente/departamento/temporada. `desarrollo.ver`.
 *
 * Innegociables aplicados: A1 (lógica aquí), A2 (ligar/quitar en transacción con bitácora), A7 (auditoría
 * uniforme), A9 (todo filtrado por la empresa activa). Importes ocultos (null) sin `consultas.ver-importes`.
 */
import {
  esquemaLigarOrdenCuerpo,
  esquemaTableroDesarrollosQuery,
  type CandidatoLigaSalida,
  type DatosLigarOrden,
  type ExpedienteOrdenSalida,
  type LigaEstadoSalida,
  type LigaOrdenSalida,
  type SugerenciaLigaSalida,
  type TableroDesarrollosQuery,
  type TableroDesarrollosSalida,
} from '../../contrato/index.js';
import { datosCreacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { CODIGO_PRISMA, codigoErrorPrisma } from '../../comun/prisma-errores.js';
import { clienteLectura, enTransaccion, type ContextoBd } from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';
import { num, numOrNull } from '../costos/decimales.js';
import { aEventoSalida, incluirEvento } from './negociacion.js';
import { calcularEstadoDesarrollo, incluirEstadoDesarrollo } from './desarrollos.js';
import { conteosDesarrollos } from './proyectos.js';

/** Cliente de lectura (tx o Prisma), para los helpers de proyección. */
type ClienteBd = ReturnType<typeof clienteLectura>;

// ── Proyección de la liga ──────────────────────────────────────────────────────────────

/** Lee la liga de una orden (empresa activa, A9) y la proyecta con el estado derivado del desarrollo. */
async function leerLigaSalida(
  cliente: ClienteBd,
  idOrden: number,
  idEmpresa: number,
): Promise<LigaOrdenSalida> {
  const liga = await cliente.desarrolloOrden.findFirst({
    where: { idOrden, orden: { idEmpresa } },
    select: {
      id: true,
      idOrden: true,
      idDesarrollo: true,
      creadoEn: true,
      creadoPorId: true,
      orden: { select: { folio: true } },
      desarrollo: {
        select: {
          apagado: true,
          numeroCliente: true,
          modelo: { select: { codigo: true } },
          ...incluirEstadoDesarrollo,
        },
      },
    },
  });
  if (liga === null) {
    throw new ErrorNoEncontrado('Liga desarrollo-orden', idOrden);
  }
  return {
    id: liga.id,
    idOrden: liga.idOrden,
    folioOrden: Number(liga.orden.folio),
    idDesarrollo: liga.idDesarrollo,
    codigoModelo: liga.desarrollo.modelo.codigo,
    numeroCliente: liga.desarrollo.numeroCliente,
    estadoDesarrollo: calcularEstadoDesarrollo(liga.desarrollo),
    creadoEn: liga.creadoEn.toISOString(),
    creadoPorId: liga.creadoPorId,
  };
}

// ── Operación 1: LIGAR ───────────────────────────────────────────────────────────────

/**
 * LIGA una orden a un desarrollo (A2). Valida (A1): orden y desarrollo de la MISMA empresa (A9); la orden
 * aún no ligada (`idOrden @unique` lo blinda en BD → `ErrorConflicto` claro si carrera); desarrollo NO
 * apagado; coherencia MISMO modelo Y MISMO cliente (el desarrollo es de ese modelo para ese cliente, la
 * orden lo produce para un cliente). Bitácora en la tx. Requiere `desarrollo.administrar`.
 */
export async function ligarOrden(
  sesion: SesionUsuario,
  idOrden: number,
  entrada: DatosLigarOrden,
  bd?: ContextoBd,
): Promise<LigaOrdenSalida> {
  verificarPermiso(sesion, 'desarrollo.administrar');
  const datos = validarEntrada(esquemaLigarOrdenCuerpo, entrada);
  const idEmpresa = sesion.idEmpresaActiva;

  await enTransaccion(async (tx) => {
    const orden = await tx.orden.findFirst({
      where: { id: idOrden, idEmpresa },
      select: {
        id: true,
        folio: true,
        estado: true,
        idModelo: true,
        idCliente: true,
        desarrolloOrden: { select: { id: true } },
      },
    });
    if (orden === null) {
      throw new ErrorNoEncontrado('Orden', idOrden);
    }
    if (orden.estado === 'cancelada') {
      throw new ErrorConflicto(
        `La orden ${Number(orden.folio)} está cancelada; no se puede ligar a un desarrollo.`,
      );
    }
    if (orden.desarrolloOrden !== null) {
      throw new ErrorConflicto(
        'La orden ya está ligada a un desarrollo; quita la liga actual antes de re-ligar.',
      );
    }

    const desarrollo = await tx.desarrollo.findFirst({
      where: { id: datos.idDesarrollo, proyecto: { idEmpresa } },
      select: {
        id: true,
        idModelo: true,
        apagado: true,
        modelo: { select: { codigo: true } },
        proyecto: { select: { idCliente: true } },
      },
    });
    if (desarrollo === null) {
      throw new ErrorNoEncontrado('Desarrollo', datos.idDesarrollo);
    }
    if (desarrollo.apagado) {
      throw new ErrorConflicto(
        `El desarrollo "${desarrollo.modelo.codigo}" está apagado; reactívalo para ligarlo.`,
      );
    }
    if (desarrollo.idModelo !== orden.idModelo) {
      throw new ErrorValidacion(
        'El desarrollo es de otro modelo; liga un desarrollo del mismo modelo de la orden.',
      );
    }
    if (desarrollo.proyecto.idCliente !== orden.idCliente) {
      throw new ErrorValidacion(
        'El desarrollo es de otro cliente; liga un desarrollo del mismo cliente de la orden.',
      );
    }

    try {
      await tx.desarrolloOrden.create({
        data: { idDesarrollo: datos.idDesarrollo, idOrden, ...datosCreacion(sesion) },
        select: { id: true },
      });
    } catch (error) {
      if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
        throw new ErrorConflicto('La orden ya está ligada a un desarrollo.', { causa: error });
      }
      throw error;
    }

    await registrarBitacora(tx, sesion, {
      entidad: 'Orden',
      idEntidad: idOrden,
      accion: 'OTRO',
      datos: {
        operacion: 'ligar-desarrollo',
        idDesarrollo: datos.idDesarrollo,
        folioOrden: Number(orden.folio),
      },
    });
  }, bd);

  return leerLigaSalida(clienteLectura(bd), idOrden, idEmpresa);
}

// ── Operación 2: QUITAR liga ─────────────────────────────────────────────────────────

/**
 * QUITA la liga de una orden (A2). Si la orden no está ligada → `ErrorNoEncontrado`. Borra la fila +
 * bitácora. El desarrollo vuelve a su estado derivado anterior (deja de contar esta orden). Requiere
 * `desarrollo.administrar`.
 */
export async function quitarLiga(
  sesion: SesionUsuario,
  idOrden: number,
  bd?: ContextoBd,
): Promise<LigaEstadoSalida> {
  verificarPermiso(sesion, 'desarrollo.administrar');
  const idEmpresa = sesion.idEmpresaActiva;

  await enTransaccion(async (tx) => {
    const liga = await tx.desarrolloOrden.findFirst({
      where: { idOrden, orden: { idEmpresa } },
      select: { id: true, idDesarrollo: true, orden: { select: { folio: true } } },
    });
    if (liga === null) {
      throw new ErrorNoEncontrado('Liga desarrollo-orden', idOrden);
    }
    await tx.desarrolloOrden.delete({ where: { id: liga.id } });
    await registrarBitacora(tx, sesion, {
      entidad: 'Orden',
      idEntidad: idOrden,
      accion: 'OTRO',
      datos: {
        operacion: 'quitar-liga-desarrollo',
        idDesarrollo: liga.idDesarrollo,
        folioOrden: Number(liga.orden.folio),
      },
    });
  }, bd);

  return { idOrden, ligado: false };
}

// ── Operación 3: SUGERENCIA de liga + precio propuesto ─────────────────────────────────

/**
 * SUGIERE el desarrollo candidato para ligar a una orden y el precio de pedido PROPUESTO (default
 * editable). Candidato = desarrollo del MISMO modelo+cliente+empresa (A9), no apagado, AÚN NO ligado; se
 * prefiere el que ya tiene renglón de lista (para proponer precio), luego el más reciente. El precio sale
 * del renglón de lista más reciente (`precioAprobado ?? precioCalculado`), null sin `consultas.ver-importes`.
 * NO escribe el pedido. Requiere `desarrollo.ver`.
 */
export async function sugerenciaLigaOrden(
  sesion: SesionUsuario,
  idOrden: number,
  bd?: ContextoBd,
): Promise<SugerenciaLigaSalida> {
  verificarPermiso(sesion, 'desarrollo.ver');
  const idEmpresa = sesion.idEmpresaActiva;
  const cliente = clienteLectura(bd);
  const verImportes = tienePermiso(sesion, 'consultas.ver-importes');

  const orden = await cliente.orden.findFirst({
    where: { id: idOrden, idEmpresa },
    select: {
      folio: true,
      idModelo: true,
      idCliente: true,
      desarrolloOrden: { select: { id: true } },
    },
  });
  if (orden === null) {
    throw new ErrorNoEncontrado('Orden', idOrden);
  }

  const candidatos = await cliente.desarrollo.findMany({
    where: {
      apagado: false,
      idModelo: orden.idModelo,
      proyecto: { idEmpresa, idCliente: orden.idCliente },
      ordenLigadas: { none: {} },
    },
    orderBy: { id: 'desc' },
    select: {
      id: true,
      apagado: true,
      numeroCliente: true,
      idProyecto: true,
      proyecto: { select: { folio: true, nombre: true } },
      modelo: { select: { codigo: true, descripcion: true } },
      precostos: { select: { estado: true } },
      ordenLigadas: { select: { id: true } },
      listaLineas: {
        // A9: el renglón de lista debe ser de la MISMA empresa (simetría con `expedienteOrden`; una
        // lista de otra empresa no debe filtrar su precio a esta sesión).
        where: { lista: { idEmpresa } },
        orderBy: { id: 'desc' },
        take: 1,
        select: {
          id: true,
          precioAprobado: true,
          precioCalculado: true,
          lista: { select: { folio: true } },
        },
      },
    },
  });

  // Prefiere el candidato con renglón de lista (para proponer precio); si ninguno, el más reciente.
  const elegido = candidatos.find((d) => d.listaLineas.length > 0) ?? candidatos[0] ?? null;

  let candidato: CandidatoLigaSalida | null = null;
  if (elegido !== null) {
    const linea = elegido.listaLineas[0] ?? null;
    const precio =
      linea === null ? null : (numOrNull(linea.precioAprobado) ?? num(linea.precioCalculado));
    candidato = {
      idDesarrollo: elegido.id,
      idProyecto: elegido.idProyecto,
      folioProyecto: Number(elegido.proyecto.folio),
      nombreProyecto: elegido.proyecto.nombre,
      codigoModelo: elegido.modelo.codigo,
      descripcionModelo: elegido.modelo.descripcion,
      numeroCliente: elegido.numeroCliente,
      estado: calcularEstadoDesarrollo(elegido),
      idListaLinea: linea?.id ?? null,
      folioLista: linea === null ? null : Number(linea.lista.folio),
      precioSugeridoPedido: verImportes ? precio : null,
    };
  }

  return {
    idOrden,
    folioOrden: Number(orden.folio),
    yaLigada: orden.desarrolloOrden !== null,
    candidato,
  };
}

// ── Operación 4: VISTA 360 (expediente) ───────────────────────────────────────────────

/**
 * EXPEDIENTE 360 de una orden LIGADA (A9): proyecto + desarrollo (estado derivado) + precosto vigente
 * (última versión CONGELADA + costo) + renglón de lista/precio + acuerdos de negociación (solo lectura).
 * Reusa los proyectores de negociación (`aEventoSalida`/`incluirEvento`) sin acoplarse a `listas.ver`.
 * Importes ocultos sin `consultas.ver-importes`. Requiere `desarrollo.ver`.
 */
export async function expedienteOrden(
  sesion: SesionUsuario,
  idOrden: number,
  bd?: ContextoBd,
): Promise<ExpedienteOrdenSalida> {
  verificarPermiso(sesion, 'desarrollo.ver');
  const idEmpresa = sesion.idEmpresaActiva;
  const cliente = clienteLectura(bd);
  const verImportes = tienePermiso(sesion, 'consultas.ver-importes');

  const liga = await cliente.desarrolloOrden.findFirst({
    where: { idOrden, orden: { idEmpresa } },
    select: {
      orden: {
        select: {
          id: true,
          folio: true,
          idModelo: true,
          modelo: { select: { codigo: true, descripcion: true } },
        },
      },
      desarrollo: {
        select: {
          id: true,
          apagado: true,
          numeroCliente: true,
          idProyecto: true,
          precostos: { select: { estado: true } },
          ordenLigadas: { select: { id: true } },
          proyecto: {
            select: {
              folio: true,
              nombre: true,
              idCliente: true,
              cliente: { select: { nombre: true } },
              idClienteDepartamento: true,
              clienteDepartamento: { select: { nombre: true } },
              temporada: { select: { nombre: true } },
            },
          },
        },
      },
    },
  });
  if (liga === null) {
    throw new ErrorNoEncontrado('Liga desarrollo-orden', idOrden);
  }
  const { orden, desarrollo } = liga;
  const proyecto = desarrollo.proyecto;

  // Precosto vigente = última versión CONGELADA del desarrollo (su costoTotal se persiste al congelar).
  const precosto = await cliente.precosto.findFirst({
    where: {
      idDesarrollo: desarrollo.id,
      estado: 'congelado',
      desarrollo: { proyecto: { idEmpresa } },
    },
    orderBy: { version: 'desc' },
    select: { id: true, version: true, costoTotal: true, congeladoEn: true },
  });

  // Renglón de lista/precio del desarrollo (a lo más UNO por E5). El precio = aprobado ?? calculado.
  const lineaLista = await cliente.listaPreciosLinea.findFirst({
    where: { idDesarrollo: desarrollo.id, lista: { idEmpresa } },
    orderBy: { id: 'desc' },
    select: {
      id: true,
      precioAprobado: true,
      precioCalculado: true,
      lista: {
        select: {
          id: true,
          folio: true,
          estadoLista: { select: { codigo: true, nombre: true } },
        },
      },
    },
  });

  // Acuerdos/rondas del renglón (solo lectura, cronológico) reutilizando el proyector de negociación.
  const acuerdos =
    lineaLista === null
      ? []
      : (
          await cliente.negociacionEvento.findMany({
            where: { idListaLinea: lineaLista.id },
            orderBy: { id: 'asc' },
            include: incluirEvento,
          })
        ).map((e) => aEventoSalida(e, verImportes));

  const estado = calcularEstadoDesarrollo({
    apagado: desarrollo.apagado,
    precostos: desarrollo.precostos,
    ordenLigadas: desarrollo.ordenLigadas,
    listaLineas: lineaLista === null ? [] : [{ id: lineaLista.id }],
  });

  return {
    idOrden: orden.id,
    folioOrden: Number(orden.folio),
    idModelo: orden.idModelo,
    codigoModelo: orden.modelo.codigo,
    descripcionModelo: orden.modelo.descripcion,
    idDesarrollo: desarrollo.id,
    numeroCliente: desarrollo.numeroCliente,
    estadoDesarrollo: estado,
    idProyecto: desarrollo.idProyecto,
    folioProyecto: Number(proyecto.folio),
    nombreProyecto: proyecto.nombre,
    idCliente: proyecto.idCliente,
    nombreCliente: proyecto.cliente.nombre,
    idClienteDepartamento: proyecto.idClienteDepartamento,
    nombreDepartamento: proyecto.clienteDepartamento.nombre,
    temporada: proyecto.temporada?.nombre ?? null,
    precostoVigente:
      precosto === null
        ? null
        : {
            idPrecosto: precosto.id,
            version: precosto.version,
            costoTotal: verImportes ? numOrNull(precosto.costoTotal) : null,
            congeladoEn: precosto.congeladoEn === null ? null : precosto.congeladoEn.toISOString(),
          },
    lista:
      lineaLista === null
        ? null
        : {
            idLista: lineaLista.lista.id,
            folioLista: Number(lineaLista.lista.folio),
            codigoEstadoLista: lineaLista.lista.estadoLista.codigo,
            nombreEstadoLista: lineaLista.lista.estadoLista.nombre,
            idListaLinea: lineaLista.id,
            precio: verImportes
              ? (numOrNull(lineaLista.precioAprobado) ?? num(lineaLista.precioCalculado))
              : null,
            aprobado: lineaLista.precioAprobado !== null,
          },
    acuerdos,
  };
}

// ── Operación 5: TABLERO de desarrollos por estado ─────────────────────────────────────

/**
 * TABLERO de conteos de desarrollos por ESTADO derivado, AGREGADO EN EL SERVIDOR (reusa
 * `conteosDesarrollos`; NUNCA devuelve filas para pivotar en el cliente, lección F5-E7). Filtrable por
 * cliente/departamento/temporada; empresa la toma la sesión (A9). Requiere `desarrollo.ver`.
 */
export async function tableroDesarrollos(
  sesion: SesionUsuario,
  filtros: TableroDesarrollosQuery,
  bd?: ContextoBd,
): Promise<TableroDesarrollosSalida> {
  verificarPermiso(sesion, 'desarrollo.ver');
  const datos = validarEntrada(esquemaTableroDesarrollosQuery, filtros);
  const idEmpresa = sesion.idEmpresaActiva;

  const desarrollos = await clienteLectura(bd).desarrollo.findMany({
    where: {
      proyecto: {
        idEmpresa,
        ...(datos.idCliente === undefined ? {} : { idCliente: datos.idCliente }),
        ...(datos.idClienteDepartamento === undefined
          ? {}
          : { idClienteDepartamento: datos.idClienteDepartamento }),
        ...(datos.idTemporada === undefined ? {} : { idTemporada: datos.idTemporada }),
      },
    },
    select: { apagado: true, ...incluirEstadoDesarrollo },
  });

  return conteosDesarrollos(desarrollos);
}
