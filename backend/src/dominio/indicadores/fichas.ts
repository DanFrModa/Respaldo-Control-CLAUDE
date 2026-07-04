/**
 * FICHAS CONFIABLES (Módulo Indicadores, F7-E4; doc `05-Indicadores.md` §A.2; ex `IP_InfConf` +
 * consulta `Ind_IP_InfConfiable`). Checklist de confiabilidad de la ficha técnica POR ORDEN,
 * modelado por FILAS (reactivo × orden) en vez de las 8 columnas booleanas fijas del viejo (A6).
 * Toda la lógica vive aquí (A1); las rutas validan permiso + Zod y delegan.
 *
 * Innegociables: A2 (escrituras en transacción con bitácora A7), A4 (`indicadores.ip-confiabilidad`
 * gobierna leer/capturar; la fecha libre exige `indicadores.fecha-libre`), A9 (por empresa activa vía
 * la orden). El indicador "% de fichas confiables" = Σ reactivos OK ÷ Σ reactivos considerados.
 *
 * Hook a futuro (documentado): si se construye la FICHA ESTRUCTURADA (R5, módulo 12), los reactivos
 * de este checklist podrán DERIVARSE de sus secciones (¿tiene tela?, ¿tiene medidas?, …) en vez de
 * capturarse a mano — el catálogo `ChecklistFichaDef` ya es configurable (A6) para ese empalme; NO se
 * duplica funcionalidad: `verificarFichaOrden` seguiría siendo el punto de escritura.
 */
import { z } from 'zod';

import {
  esquemaFichasConfiablesQuery,
  esquemaReactivoFichaCrear,
  esquemaReactivoFichaEditar,
  esquemaReactivosFichaQuery,
  esquemaVerificarFichaOrden,
  type DatosReactivoFichaCrear,
  type DatosReactivoFichaEditar,
  type DatosVerificarFichaOrden,
  type FichaOrdenSalida,
  type FichasConfiables,
  type FichasConfiablesQuery,
  type ReactivoFichaSalida,
  type ReactivosFichaLista,
  type ReactivosFichaQuery,
} from '../../contrato/index.js';
import type { ChecklistFichaDef, Prisma } from '../../datos/index.js';
import { Prisma as PrismaNS } from '../../datos/index.js';

import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado } from '../../comun/errores.js';
import { armarPagina } from '../../comun/paginacion.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { CODIGO_PRISMA, codigoErrorPrisma } from '../../comun/prisma-errores.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

import { fechaAUtc, hoyUtc, verificarFechaCapturable } from './fechas.js';

/** Frac. redondeada a 4 decimales, o null si el denominador es 0. */
function frac(numerador: number, denominador: number): number | null {
  if (denominador <= 0) return null;
  return Math.round((numerador / denominador) * 10000) / 10000;
}

// Esquema de listado de reactivos en versión DOMINIO (bandera NATIVA en vez de `stringbool`).
const esquemaReactivosFichaQueryDominio = esquemaReactivosFichaQuery.extend({
  incluirInactivos: z.boolean().default(false),
});

// ── Catálogo de reactivos (configurable, A6) ─────────────────────────────────────────────────────

/** Proyecta un reactivo a la salida del contrato. */
function aReactivoSalida(r: ChecklistFichaDef): ReactivoFichaSalida {
  return {
    id: r.id,
    clave: r.clave,
    etiqueta: r.etiqueta,
    orden: r.orden,
    activo: r.activo,
    creadoEn: r.creadoEn.toISOString(),
    creadoPorId: r.creadoPorId,
    modificadoEn: r.modificadoEn.toISOString(),
    modificadoPorId: r.modificadoPorId,
  };
}

/** Lista los reactivos del checklist (pocos; sin paginación), ordenados. `indicadores.ip-confiabilidad`. */
export async function listarReactivosFicha(
  sesion: SesionUsuario,
  parametros: z.input<typeof esquemaReactivosFichaQueryDominio> = {},
  bd?: ContextoBd,
): Promise<ReactivosFichaLista> {
  verificarPermiso(sesion, 'indicadores.ip-confiabilidad');
  const filtros: ReactivosFichaQuery = validarEntrada(
    esquemaReactivosFichaQueryDominio,
    parametros,
  );
  const datos = await clienteLectura(bd).checklistFichaDef.findMany({
    where: filtros.incluirInactivos ? {} : { activo: true },
    orderBy: [{ orden: 'asc' }, { id: 'asc' }],
  });
  return { datos: datos.map(aReactivoSalida) };
}

/** Crea un reactivo del checklist. `indicadores.ip-confiabilidad`. */
export async function crearReactivoFicha(
  sesion: SesionUsuario,
  entrada: DatosReactivoFichaCrear,
  bd?: ContextoBd,
): Promise<ReactivoFichaSalida> {
  verificarPermiso(sesion, 'indicadores.ip-confiabilidad');
  const datos = validarEntrada(esquemaReactivoFichaCrear, entrada);
  try {
    return await enTransaccion(async (tx) => {
      const creado = await tx.checklistFichaDef.create({
        data: {
          clave: datos.clave,
          etiqueta: datos.etiqueta,
          orden: datos.orden,
          ...datosCreacion(sesion),
        },
      });
      await registrarBitacora(tx, sesion, {
        entidad: 'ChecklistFichaDef',
        idEntidad: creado.id,
        accion: 'CREAR',
        datos: { clave: creado.clave },
      });
      return aReactivoSalida(creado);
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto(`Ya existe un reactivo con la clave "${datos.clave}".`, {
        causa: error,
      });
    }
    throw error;
  }
}

/** Actualiza un reactivo (etiqueta/orden/clave/activo). `indicadores.ip-confiabilidad`. */
export async function actualizarReactivoFicha(
  sesion: SesionUsuario,
  entrada: DatosReactivoFichaEditar,
  bd?: ContextoBd,
): Promise<ReactivoFichaSalida> {
  verificarPermiso(sesion, 'indicadores.ip-confiabilidad');
  const datos = validarEntrada(esquemaReactivoFichaEditar, entrada);
  try {
    return await enTransaccion(async (tx) => {
      const actual = await tx.checklistFichaDef.findUnique({ where: { id: datos.id } });
      if (actual === null) throw new ErrorNoEncontrado('ChecklistFichaDef', datos.id);
      const cambios: Prisma.ChecklistFichaDefUpdateInput = { ...datosModificacion(sesion) };
      if (datos.clave !== undefined) cambios.clave = datos.clave;
      if (datos.etiqueta !== undefined) cambios.etiqueta = datos.etiqueta;
      if (datos.orden !== undefined) cambios.orden = datos.orden;
      if (datos.activo !== undefined) cambios.activo = datos.activo;
      const actualizado = await tx.checklistFichaDef.update({
        where: { id: datos.id },
        data: cambios,
      });
      await registrarBitacora(tx, sesion, {
        entidad: 'ChecklistFichaDef',
        idEntidad: actualizado.id,
        accion: datos.activo === false ? 'DESACTIVAR' : 'MODIFICAR',
        datos: { clave: actualizado.clave },
      });
      return aReactivoSalida(actualizado);
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto('Ya existe un reactivo con esa clave.', { causa: error });
    }
    throw error;
  }
}

// ── Checklist por orden ────────────────────────────────────────────────────────────────────────────

/** Carga la orden (de la empresa activa, A9) o lanza. */
async function exigirOrdenDeEmpresa(
  cliente: Tx | ReturnType<typeof clienteLectura>,
  idOrden: number,
  idEmpresa: number,
): Promise<{ id: number; folio: bigint; idModelo: number; codigoModelo: string | null }> {
  const orden = await cliente.orden.findUnique({
    where: { id: idOrden },
    select: {
      id: true,
      folio: true,
      idEmpresa: true,
      idModelo: true,
      modelo: { select: { codigo: true } },
    },
  });
  if (orden === null || orden.idEmpresa !== idEmpresa) {
    throw new ErrorNoEncontrado('Orden', idOrden);
  }
  return {
    id: orden.id,
    folio: orden.folio,
    idModelo: orden.idModelo,
    codigoModelo: orden.modelo?.codigo ?? null,
  };
}

/** Arma el checklist de una orden (reactivos activos + estado de sus verificaciones). */
async function armarFichaOrden(
  cliente: Tx | ReturnType<typeof clienteLectura>,
  idOrden: number,
  idEmpresa: number,
): Promise<FichaOrdenSalida> {
  const orden = await exigirOrdenDeEmpresa(cliente, idOrden, idEmpresa);
  const [reactivos, verificaciones] = await Promise.all([
    cliente.checklistFichaDef.findMany({
      where: { activo: true },
      orderBy: [{ orden: 'asc' }, { id: 'asc' }],
    }),
    cliente.fichaVerificacion.findMany({ where: { idOrden } }),
  ]);
  const porReactivo = new Map(verificaciones.map((v) => [v.idReactivo, v]));

  const items = reactivos.map((r) => {
    const v = porReactivo.get(r.id);
    return {
      idReactivo: r.id,
      clave: r.clave,
      etiqueta: r.etiqueta,
      orden: r.orden,
      hecho: v?.hecho ?? false,
      revisorId: v?.revisorId ?? null,
      fecha: v?.fecha ? v.fecha.toISOString().slice(0, 10) : null,
    };
  });
  const hechos = items.filter((i) => i.hecho).length;

  // Revisor + fecha de la última verificación (para el encabezado).
  const ultima = verificaciones
    .filter((v) => v.fecha !== null)
    .sort((a, b) => (b.fecha as Date).getTime() - (a.fecha as Date).getTime())[0];
  let revisor: string | null = null;
  if (ultima?.revisorId != null) {
    const usuario = await cliente.usuario.findUnique({
      where: { id: ultima.revisorId },
      select: { nombre: true },
    });
    revisor = usuario?.nombre ?? ultima.revisorId;
  }

  return {
    idOrden: orden.id,
    folio: Number(orden.folio),
    idModelo: orden.idModelo,
    codigoModelo: orden.codigoModelo,
    items,
    totalReactivos: reactivos.length,
    hechos,
    porcentaje: frac(hechos, reactivos.length),
    revisorId: ultima?.revisorId ?? null,
    revisor,
    fecha: ultima?.fecha ? ultima.fecha.toISOString().slice(0, 10) : null,
  };
}

/** Obtiene el checklist de confiabilidad de una orden. `indicadores.ip-confiabilidad`. A9. */
export async function obtenerFichaOrden(
  sesion: SesionUsuario,
  idOrden: number,
  bd?: ContextoBd,
): Promise<FichaOrdenSalida> {
  verificarPermiso(sesion, 'indicadores.ip-confiabilidad');
  return armarFichaOrden(clienteLectura(bd), idOrden, sesion.idEmpresaActiva);
}

/**
 * Guarda (upsert) el checklist de confiabilidad de una orden. Revisor = usuario de la sesión; fecha
 * = hoy (o la enviada con `indicadores.fecha-libre`). Reemplaza el estado de los reactivos enviados;
 * los demás quedan como estaban. `indicadores.ip-confiabilidad`. A2/A7. A9.
 */
export async function verificarFichaOrden(
  sesion: SesionUsuario,
  idOrden: number,
  entrada: DatosVerificarFichaOrden,
  bd?: ContextoBd,
): Promise<FichaOrdenSalida> {
  verificarPermiso(sesion, 'indicadores.ip-confiabilidad');
  const datos = validarEntrada(esquemaVerificarFichaOrden, entrada);
  const idEmpresa = sesion.idEmpresaActiva;
  const fecha = datos.fecha === undefined ? hoyUtc() : fechaAUtc(datos.fecha);
  verificarFechaCapturable(sesion, fecha);

  // Un reactivo no puede repetirse en la misma captura.
  const idsUnicos = new Set(datos.items.map((i) => i.idReactivo));
  if (idsUnicos.size !== datos.items.length) {
    throw new ErrorConflicto('Un reactivo aparece más de una vez en la captura.');
  }

  return enTransaccion(async (tx) => {
    await exigirOrdenDeEmpresa(tx, idOrden, idEmpresa);
    const reactivos = await tx.checklistFichaDef.findMany({
      where: { id: { in: [...idsUnicos] } },
      select: { id: true, activo: true },
    });
    const validos = new Map(reactivos.map((r) => [r.id, r]));
    for (const item of datos.items) {
      const r = validos.get(item.idReactivo);
      if (r === undefined) throw new ErrorNoEncontrado('ChecklistFichaDef', item.idReactivo);
      if (!r.activo) throw new ErrorConflicto('Uno de los reactivos está desactivado.');
    }

    for (const item of datos.items) {
      await tx.fichaVerificacion.upsert({
        where: { idOrden_idReactivo: { idOrden, idReactivo: item.idReactivo } },
        create: {
          idEmpresa,
          idOrden,
          idReactivo: item.idReactivo,
          hecho: item.hecho,
          revisorId: sesion.id,
          fecha,
          ...datosCreacion(sesion),
        },
        update: {
          hecho: item.hecho,
          revisorId: sesion.id,
          fecha,
          ...datosModificacion(sesion),
        },
      });
    }
    await registrarBitacora(tx, sesion, {
      entidad: 'FichaVerificacion',
      idEntidad: idOrden,
      accion: 'MODIFICAR',
      datos: { idOrden, reactivos: datos.items.length },
    });
    return armarFichaOrden(tx, idOrden, idEmpresa);
  }, bd);
}

// ── Indicador de % de fichas confiables (agregado en SERVIDOR/SQL) ────────────────────────────────

/** Fila cruda del indicador por orden. */
interface FilaConfiableCruda {
  idOrden: number;
  folio: bigint;
  idCliente: number;
  cliente: string;
  idModelo: number;
  codigoModelo: string;
  totalReactivos: number;
  hechos: number;
  fecha: Date | null;
}

/**
 * Indicador de % de fichas confiables (ex `Ind_IP_InfConfiable`): por cada orden EVALUADA (con ≥1
 * verificación) mide reactivos OK ÷ reactivos activos; el global es Σ OK ÷ Σ considerados. Una orden
 * es "confiable" si TODOS sus reactivos activos están OK (el "OK" del viejo). Todo agregado en SQL
 * (no pivote en cliente). `indicadores.ip-confiabilidad`. A9.
 */
export async function fichasConfiables(
  sesion: SesionUsuario,
  parametros: z.input<typeof esquemaFichasConfiablesQuery> = {},
  bd?: ContextoBd,
): Promise<FichasConfiables> {
  verificarPermiso(sesion, 'indicadores.ip-confiabilidad');
  const filtros: FichasConfiablesQuery = validarEntrada(esquemaFichasConfiablesQuery, parametros);
  const idEmpresa = sesion.idEmpresaActiva;
  const cliente = clienteLectura(bd);

  const cond: Prisma.Sql[] = [
    PrismaNS.sql`o."id_empresa" = ${idEmpresa}`,
    PrismaNS.sql`rd."activo" = TRUE`,
  ];
  if (filtros.idCliente !== undefined)
    cond.push(PrismaNS.sql`o."id_cliente" = ${filtros.idCliente}`);
  if (filtros.desde !== undefined)
    cond.push(PrismaNS.sql`fv."fecha" >= ${fechaAUtc(filtros.desde)}`);
  if (filtros.hasta !== undefined)
    cond.push(PrismaNS.sql`fv."fecha" <= ${fechaAUtc(filtros.hasta)}`);
  const where = PrismaNS.join(cond, ' AND ');

  // Sub-consulta por orden: hechos (reactivos activos OK) y total (reactivos activos globales).
  const porOrden = PrismaNS.sql`
    SELECT
      o."id"        AS "idOrden",
      o."folio"     AS "folio",
      o."id_cliente" AS "idCliente",
      c."nombre"    AS "cliente",
      o."id_modelo" AS "idModelo",
      m."codigo"    AS "codigoModelo",
      (SELECT COUNT(*) FROM "checklist_ficha_def" WHERE "activo" = TRUE)::int AS "totalReactivos",
      COUNT(*) FILTER (WHERE fv."hecho")::int AS "hechos",
      MAX(fv."fecha") AS "fecha"
    FROM "ordenes" o
    JOIN "ficha_verificacion" fv ON fv."id_orden" = o."id"
    JOIN "checklist_ficha_def" rd ON rd."id" = fv."id_reactivo"
    JOIN "clientes" c ON c."id" = o."id_cliente"
    JOIN "modelos" m ON m."id" = o."id_modelo"
    WHERE ${where}
    GROUP BY o."id", o."folio", o."id_cliente", c."nombre", o."id_modelo", m."codigo"
  `;

  const [resumen] = await cliente.$queryRaw<
    {
      ordenesEvaluadas: number;
      ordenesConfiables: number;
      reactivosOk: number;
      reactivosTotales: number;
    }[]
  >(PrismaNS.sql`
    WITH e AS (${porOrden})
    SELECT
      COUNT(*)::int AS "ordenesEvaluadas",
      COUNT(*) FILTER (WHERE e."hechos" = e."totalReactivos" AND e."totalReactivos" > 0)::int AS "ordenesConfiables",
      COALESCE(SUM(e."hechos"), 0)::int AS "reactivosOk",
      COALESCE(SUM(e."totalReactivos"), 0)::int AS "reactivosTotales"
    FROM e
  `);
  const ordenesEvaluadas = resumen?.ordenesEvaluadas ?? 0;

  const offset = (filtros.pagina - 1) * filtros.porPagina;
  const filas = await cliente.$queryRaw<FilaConfiableCruda[]>(PrismaNS.sql`
    WITH e AS (${porOrden})
    SELECT * FROM e
    ORDER BY e."folio" DESC
    LIMIT ${filtros.porPagina} OFFSET ${offset}
  `);

  const datos = filas.map((f) => ({
    idOrden: f.idOrden,
    folio: Number(f.folio),
    idCliente: f.idCliente,
    cliente: f.cliente,
    idModelo: f.idModelo,
    codigoModelo: f.codigoModelo,
    totalReactivos: f.totalReactivos,
    hechos: f.hechos,
    porcentaje: frac(f.hechos, f.totalReactivos),
    confiable: f.totalReactivos > 0 && f.hechos === f.totalReactivos,
    fecha: f.fecha ? f.fecha.toISOString().slice(0, 10) : null,
  }));

  const pagina = armarPagina(datos, ordenesEvaluadas, filtros);
  return {
    global: {
      ordenesEvaluadas,
      ordenesConfiables: resumen?.ordenesConfiables ?? 0,
      reactivosTotales: resumen?.reactivosTotales ?? 0,
      reactivosOk: resumen?.reactivosOk ?? 0,
      porcentaje: frac(resumen?.reactivosOk ?? 0, resumen?.reactivosTotales ?? 0),
    },
    datos: pagina.datos,
    total: pagina.total,
    pagina: pagina.pagina,
    porPagina: pagina.porPagina,
    totalPaginas: pagina.totalPaginas,
  };
}
