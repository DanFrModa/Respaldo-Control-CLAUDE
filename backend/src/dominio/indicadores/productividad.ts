/**
 * MOTOR DE PRODUCTIVIDAD unificado IP/Almacén (Módulo Indicadores, F7-E4; doc `05-Indicadores.md`
 * §A.1 "Productividad de IP" / §B.1 "Productividad del Almacén"; MEJORAS 05 §1 "motor de KPIs/
 * productividad configurable por área"; A6). Toda la lógica vive AQUÍ (A1); las rutas solo validan
 * permiso + Zod y delegan.
 *
 * Se DESPIVOTA el patrón repetido del viejo (tablas gemelas IP_* y Alm_Prd_*) a tres entidades
 * distinguidas por `area` (ip/almacen): personas (`PersonalArea`), actividades con sus estándares
 * (`ActividadProductividad`) y registros diarios (`RegistroProductividad`). D4/A6: una fila por dato,
 * no una tabla por módulo.
 *
 * Innegociables:
 *  • A1 — la lógica (fórmulas de índice, agregación) vive aquí; las rutas son delgadas.
 *  • A2 — las escrituras van en transacción con su bitácora (A7).
 *  • A4 — la CAPTURA de cada área exige su permiso (`indicadores.ip-productividad` /
 *    `indicadores.almacen-productividad`); la LECTURA exige cualquiera de los dos. La `fecha` fuera
 *    de los últimos 7 días (atajos Hoy/Ayer/Sábado) exige `indicadores.fecha-libre`.
 *  • A9 — los registros se filtran por la empresa ACTIVA de la sesión.
 *
 * ── Fórmulas de índice (transcritas 1:1 del viejo; ver `indiceProductividadIp` /
 *    `indiceProductividadAlmacen`) ─────────────────────────────────────────────────────────────────
 *  • IP (viejo `Ind_IP_Productividad.RealDiario`):
 *        RealDiario = (horasBase / horasTrabajadas) × porcentajeD × cantidad
 *  • Almacén (viejo `Ind_Alm_Productividad.Porcen`, con J = jornada base del almacén, ex `HorasBaseAlm = 9`,
 *    hoy `ConfiguracionEmpresa.jornadaBaseAlmacen`):
 *        Índice = ((((J / pzPersDia) / J) × piezas) / personas) × (J / horasTrabajadas)
 *
 * ── Tablero semanal/mensual — DECISIÓN DE DISEÑO (a confirmar con Daniel) ─────────────────────────
 *  El viejo derivaba las vistas agregadas con HEURÍSTICAS: `RealSemanal = RealDiario/5`,
 *  `RealMensual = RealDiario/30` y `PorcentajeTrabajado = horasTrabajadas/horasBase`. En v2 se
 *  implementa la VARIANTE LIMPIA (default propuesto por el lead): se AGREGAN los registros diarios
 *  reales por semana ISO / por mes (Σ y promedio de los índices diarios), NO las divisiones /5 y /30.
 *  Se expone `porcentajeTrabajado` como columna (Σ horas trabajadas ÷ Σ jornada base). La agregación
 *  ocurre en el SERVIDOR (SQL), nunca pivoteando en el cliente (pecado del viejo).
 */
import { z } from 'zod';

import {
  esquemaActividadCrear,
  esquemaActividadEditar,
  esquemaActividadQuery,
  esquemaPersonalCrear,
  esquemaPersonalEditar,
  esquemaPersonalQuery,
  esquemaRegistroProductividadCancelar,
  esquemaRegistroProductividadCrear,
  esquemaRegistroProductividadQuery,
  esquemaTableroProductividadQuery,
  type ActividadPagina,
  type ActividadQuery,
  type ActividadSalida,
  type DatosActividadCrear,
  type DatosActividadEditar,
  type DatosPersonalCrear,
  type DatosPersonalEditar,
  type DatosRegistroProductividadCancelar,
  type DatosRegistroProductividadCrear,
  type PersonalPagina,
  type PersonalQuery,
  type PersonalSalida,
  type RegistroProductividadPagina,
  type RegistroProductividadQuery,
  type RegistroProductividadSalida,
  type TableroProductividad,
  type TableroProductividadQuery,
} from '../../contrato/index.js';
import type {
  ActividadProductividad,
  AreaProductividad,
  PersonalArea,
  Prisma,
} from '../../datos/index.js';
import { Prisma as PrismaNS } from '../../datos/index.js';

import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import {
  ErrorConflicto,
  ErrorNoEncontrado,
  ErrorPermiso,
  ErrorValidacion,
} from '../../comun/errores.js';
import { armarPagina, rangoPrisma, type Pagina } from '../../comun/paginacion.js';
import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

import { fechaAUtc, verificarFechaCapturable } from './fechas.js';

// ── Fórmulas de índice (PURAS, sin BD — la fuente de verdad de las dos fórmulas; unit-testeadas) ──

/**
 * Índice de productividad de IP (viejo `RealDiario`): `(horasBase / horasTrabajadas) × porcentajeD ×
 * cantidad`. Representa las "unidades logradas vs estándar" del día; es ADITIVO entre días (por eso
 * el tablero las SUMA por semana/mes). Lanza `ErrorValidacion` si `horasTrabajadas ≤ 0` (división).
 */
export function indiceProductividadIp(p: {
  horasBase: number;
  horasTrabajadas: number;
  porcentajeD: number;
  cantidad: number;
}): number {
  if (p.horasTrabajadas <= 0) {
    throw new ErrorValidacion('Las horas trabajadas deben ser mayores a cero.');
  }
  return (p.horasBase / p.horasTrabajadas) * p.porcentajeD * p.cantidad;
}

/**
 * Índice de productividad de Almacén (viejo `Porcen`): `((((J / pzPersDia) / J) × piezas) / personas)
 * × (J / horasTrabajadas)`, con J = jornada base del almacén. Es una razón de EFICIENCIA (~1.0); por
 * eso el tablero también expone su PROMEDIO. Lanza `ErrorValidacion` si `pzPersDia`, `personas` o
 * `horasTrabajadas` ≤ 0 (divisiones).
 */
export function indiceProductividadAlmacen(p: {
  jornadaBase: number;
  pzPersDia: number;
  piezas: number;
  personas: number;
  horasTrabajadas: number;
}): number {
  if (p.pzPersDia <= 0) {
    throw new ErrorValidacion('El estándar de piezas por persona por día debe ser mayor a cero.');
  }
  if (p.personas <= 0) {
    throw new ErrorValidacion('Las personas deben ser mayores a cero.');
  }
  if (p.horasTrabajadas <= 0) {
    throw new ErrorValidacion('Las horas trabajadas deben ser mayores a cero.');
  }
  const { jornadaBase: j } = p;
  return (((j / p.pzPersDia / j) * p.piezas) / p.personas) * (j / p.horasTrabajadas);
}

/**
 * Agregación de los índices diarios de un grupo (periodo × actividad × persona) — la VARIANTE LIMPIA
 * del tablero semanal/mensual (a confirmar con Daniel): en vez de las heurísticas `RealDiario/5` y
 * `RealDiario/30` del viejo, se AGREGAN los índices reales. `indiceTotal` = Σ (unidades logradas,
 * aditivo en IP); `indicePromedio` = media (más significativo para la razón de eficiencia del
 * almacén). El tablero replica esta regla en SQL (`SUM` + `SUM/COUNT`); este helper puro la
 * documenta y la deja unit-testeable sin BD.
 */
export function agregarIndicesDiarios(indices: readonly number[]): {
  indiceTotal: number;
  indicePromedio: number;
} {
  const indiceTotal = indices.reduce((suma, i) => suma + i, 0);
  return {
    indiceTotal,
    indicePromedio: indices.length > 0 ? indiceTotal / indices.length : 0,
  };
}

// ── Utilidades comunes ────────────────────────────────────────────────────────────────────────────

/** Permiso de CAPTURA por área. */
const PERMISO_CAPTURA_POR_AREA = {
  ip: 'indicadores.ip-productividad',
  almacen: 'indicadores.almacen-productividad',
} as const;

/** Exige el permiso de captura del área. */
function verificarCaptura(sesion: SesionUsuario, area: AreaProductividad): void {
  verificarPermiso(sesion, PERMISO_CAPTURA_POR_AREA[area]);
}

/** Exige poder LEER productividad (cualquiera de los dos permisos de captura). */
function verificarLectura(sesion: SesionUsuario): void {
  if (
    !tienePermiso(sesion, 'indicadores.ip-productividad') &&
    !tienePermiso(sesion, 'indicadores.almacen-productividad')
  ) {
    throw new ErrorPermiso(undefined, 'indicadores.ip-productividad');
  }
}

/** Redondeo de decimales a 4 posiciones (evita ruido de coma flotante). */
function redondear4(valor: number): number {
  return Math.round(valor * 10000) / 10000;
}

/** Convierte un `Decimal` de Prisma (o null) a number (o null). */
function decNum(valor: Prisma.Decimal | null): number | null {
  return valor === null ? null : valor.toNumber();
}

// Esquemas de listado en versión DOMINIO: iguales a los del contrato pero con la bandera booleana
// NATIVA (`z.boolean`) en vez de `stringbool` — la ruta ya coacciona la URL y pasa el valor tipado;
// el dominio re-valida sobre tipos nativos (defensa en profundidad, como `kpis.ts`).
const esquemaPersonalQueryDominio = esquemaPersonalQuery.extend({
  incluirInactivos: z.boolean().default(false),
});
const esquemaActividadQueryDominio = esquemaActividadQuery.extend({
  incluirInactivos: z.boolean().default(false),
});
const esquemaRegistroQueryDominio = esquemaRegistroProductividadQuery.extend({
  incluirCancelados: z.boolean().default(false),
});

// ── CRUD de PERSONAL del área (← IP_Personal) ─────────────────────────────────────────────────────

/** Parámetros del listado de personal (los reutiliza la ruta). */
export type ParametrosPersonalQuery = z.input<typeof esquemaPersonalQueryDominio>;

/** Proyecta `PersonalArea` a la salida del contrato. */
function aPersonalSalida(p: PersonalArea): PersonalSalida {
  return {
    id: p.id,
    nombre: p.nombre,
    area: p.area,
    horasBase: decNum(p.horasBase),
    puesto: p.puesto,
    activo: p.activo,
    creadoEn: p.creadoEn.toISOString(),
    creadoPorId: p.creadoPorId,
    modificadoEn: p.modificadoEn.toISOString(),
    modificadoPorId: p.modificadoPorId,
  };
}

/** Unicidad de nombre por área (insensible a mayúsculas). La carrera la cubre el unique de BD. */
async function exigirPersonalLibre(
  tx: Tx,
  area: AreaProductividad,
  nombre: string,
  idActual?: number,
): Promise<void> {
  const existente = await tx.personalArea.findFirst({
    where: {
      area,
      nombre: { equals: nombre, mode: 'insensitive' },
      ...(idActual === undefined ? {} : { id: { not: idActual } }),
    },
    select: { id: true },
  });
  if (existente !== null) {
    throw new ErrorConflicto(`Ya existe una persona "${nombre}" en esta área.`);
  }
}

/** Crea una persona del área. IP puede llevar `horasBase` (para su índice). */
export async function crearPersonal(
  sesion: SesionUsuario,
  entrada: DatosPersonalCrear,
  bd?: ContextoBd,
): Promise<PersonalSalida> {
  const datos = validarEntrada(esquemaPersonalCrear, entrada);
  verificarCaptura(sesion, datos.area);
  return enTransaccion(async (tx) => {
    await exigirPersonalLibre(tx, datos.area, datos.nombre);
    const creado = await tx.personalArea.create({
      data: {
        nombre: datos.nombre,
        area: datos.area,
        horasBase: datos.horasBase ?? null,
        puesto: datos.puesto ?? null,
        ...datosCreacion(sesion),
      },
    });
    await registrarBitacora(tx, sesion, {
      entidad: 'PersonalArea',
      idEntidad: creado.id,
      accion: 'CREAR',
      datos: { nombre: creado.nombre, area: creado.area },
    });
    return aPersonalSalida(creado);
  }, bd);
}

/** Busca una persona por id o lanza. */
async function exigirPersonal(tx: Tx, id: number): Promise<PersonalArea> {
  const p = await tx.personalArea.findUnique({ where: { id } });
  if (p === null) throw new ErrorNoEncontrado('PersonalArea', id);
  return p;
}

/** Actualiza una persona (nombre/horasBase/puesto/activo). El área NO cambia. */
export async function actualizarPersonal(
  sesion: SesionUsuario,
  entrada: DatosPersonalEditar,
  bd?: ContextoBd,
): Promise<PersonalSalida> {
  const datos = validarEntrada(esquemaPersonalEditar, entrada);
  return enTransaccion(async (tx) => {
    const actual = await exigirPersonal(tx, datos.id);
    verificarCaptura(sesion, actual.area);

    const cambios: Prisma.PersonalAreaUpdateInput = { ...datosModificacion(sesion) };
    if (datos.nombre !== undefined && datos.nombre !== actual.nombre) {
      await exigirPersonalLibre(tx, actual.area, datos.nombre, actual.id);
      cambios.nombre = datos.nombre;
    }
    if (datos.horasBase !== undefined) cambios.horasBase = datos.horasBase;
    if (datos.puesto !== undefined) cambios.puesto = datos.puesto;
    if (datos.activo !== undefined) cambios.activo = datos.activo;

    const actualizado = await tx.personalArea.update({ where: { id: datos.id }, data: cambios });
    await registrarBitacora(tx, sesion, {
      entidad: 'PersonalArea',
      idEntidad: actualizado.id,
      accion: datos.activo === false ? 'DESACTIVAR' : 'MODIFICAR',
      datos: { nombre: actualizado.nombre },
    });
    return aPersonalSalida(actualizado);
  }, bd);
}

/** Lista personal con búsqueda/orden/paginación en servidor. Lectura (cualquier área). */
export async function listarPersonal(
  sesion: SesionUsuario,
  parametros: ParametrosPersonalQuery = {},
  bd?: ContextoBd,
): Promise<PersonalPagina> {
  verificarLectura(sesion);
  const filtros: PersonalQuery = validarEntrada(esquemaPersonalQueryDominio, parametros);
  const where: Prisma.PersonalAreaWhereInput = {
    ...(filtros.incluirInactivos ? {} : { activo: true }),
    ...(filtros.area === undefined ? {} : { area: filtros.area }),
    ...(filtros.busqueda === undefined || filtros.busqueda === ''
      ? {}
      : { nombre: { contains: filtros.busqueda, mode: 'insensitive' } }),
  };
  const cliente = clienteLectura(bd);
  const [total, datos] = await Promise.all([
    cliente.personalArea.count({ where }),
    cliente.personalArea.findMany({
      where,
      orderBy: { [filtros.ordenarPor]: filtros.direccion },
      ...rangoPrisma(filtros),
    }),
  ]);
  const pagina: Pagina<PersonalArea> = armarPagina(datos, total, filtros);
  return { ...pagina, datos: pagina.datos.map(aPersonalSalida) };
}

// ── CRUD de ACTIVIDADES (← IP_Actividades + Alm_Prd_Act) ──────────────────────────────────────────

/** Parámetros del listado de actividades. */
export type ParametrosActividadQuery = z.input<typeof esquemaActividadQueryDominio>;

/** Proyecta `ActividadProductividad` a la salida del contrato. */
function aActividadSalida(a: ActividadProductividad): ActividadSalida {
  return {
    id: a.id,
    nombre: a.nombre,
    area: a.area,
    porcentajeD: decNum(a.porcentajeD),
    pzPersDia: decNum(a.pzPersDia),
    porcenPzas: decNum(a.porcenPzas),
    activo: a.activo,
    creadoEn: a.creadoEn.toISOString(),
    creadoPorId: a.creadoPorId,
    modificadoEn: a.modificadoEn.toISOString(),
    modificadoPorId: a.modificadoPorId,
  };
}

/** Unicidad de nombre por área. */
async function exigirActividadLibre(
  tx: Tx,
  area: AreaProductividad,
  nombre: string,
  idActual?: number,
): Promise<void> {
  const existente = await tx.actividadProductividad.findFirst({
    where: {
      area,
      nombre: { equals: nombre, mode: 'insensitive' },
      ...(idActual === undefined ? {} : { id: { not: idActual } }),
    },
    select: { id: true },
  });
  if (existente !== null) {
    throw new ErrorConflicto(`Ya existe una actividad "${nombre}" en esta área.`);
  }
}

/**
 * Los estándares que aplican al área (el dominio ignora los del otro área). Almacén EXIGE
 * `pzPersDia > 0` (divisor del índice); IP usa `porcentajeD` (0 si no viene).
 */
function estandaresPorArea(
  area: AreaProductividad,
  datos: {
    porcentajeD?: number | undefined;
    pzPersDia?: number | undefined;
    porcenPzas?: number | undefined;
  },
): { porcentajeD: number | null; pzPersDia: number | null; porcenPzas: number | null } {
  if (area === 'ip') {
    return { porcentajeD: datos.porcentajeD ?? null, pzPersDia: null, porcenPzas: null };
  }
  if (datos.pzPersDia === undefined || datos.pzPersDia <= 0) {
    throw new ErrorValidacion(
      'Una actividad de almacén necesita un estándar de piezas/persona/día mayor a cero.',
    );
  }
  return {
    porcentajeD: null,
    pzPersDia: datos.pzPersDia,
    porcenPzas: datos.porcenPzas ?? null,
  };
}

/** Crea una actividad productiva. */
export async function crearActividad(
  sesion: SesionUsuario,
  entrada: DatosActividadCrear,
  bd?: ContextoBd,
): Promise<ActividadSalida> {
  const datos = validarEntrada(esquemaActividadCrear, entrada);
  verificarCaptura(sesion, datos.area);
  const estandares = estandaresPorArea(datos.area, datos);
  return enTransaccion(async (tx) => {
    await exigirActividadLibre(tx, datos.area, datos.nombre);
    const creada = await tx.actividadProductividad.create({
      data: { nombre: datos.nombre, area: datos.area, ...estandares, ...datosCreacion(sesion) },
    });
    await registrarBitacora(tx, sesion, {
      entidad: 'ActividadProductividad',
      idEntidad: creada.id,
      accion: 'CREAR',
      datos: { nombre: creada.nombre, area: creada.area },
    });
    return aActividadSalida(creada);
  }, bd);
}

/** Busca una actividad por id o lanza. */
async function exigirActividad(tx: Tx, id: number): Promise<ActividadProductividad> {
  const a = await tx.actividadProductividad.findUnique({ where: { id } });
  if (a === null) throw new ErrorNoEncontrado('ActividadProductividad', id);
  return a;
}

/** Actualiza una actividad (nombre/estándares/activo). El área NO cambia. */
export async function actualizarActividad(
  sesion: SesionUsuario,
  entrada: DatosActividadEditar,
  bd?: ContextoBd,
): Promise<ActividadSalida> {
  const datos = validarEntrada(esquemaActividadEditar, entrada);
  return enTransaccion(async (tx) => {
    const actual = await exigirActividad(tx, datos.id);
    verificarCaptura(sesion, actual.area);

    const cambios: Prisma.ActividadProductividadUpdateInput = { ...datosModificacion(sesion) };
    if (datos.nombre !== undefined && datos.nombre !== actual.nombre) {
      await exigirActividadLibre(tx, actual.area, datos.nombre, actual.id);
      cambios.nombre = datos.nombre;
    }
    if (actual.area === 'ip') {
      if (datos.porcentajeD !== undefined) cambios.porcentajeD = datos.porcentajeD;
    } else {
      if (datos.pzPersDia !== undefined) {
        if (datos.pzPersDia <= 0) {
          throw new ErrorValidacion('El estándar de piezas/persona/día debe ser mayor a cero.');
        }
        cambios.pzPersDia = datos.pzPersDia;
      }
      if (datos.porcenPzas !== undefined) cambios.porcenPzas = datos.porcenPzas;
    }
    if (datos.activo !== undefined) cambios.activo = datos.activo;

    const actualizada = await tx.actividadProductividad.update({
      where: { id: datos.id },
      data: cambios,
    });
    await registrarBitacora(tx, sesion, {
      entidad: 'ActividadProductividad',
      idEntidad: actualizada.id,
      accion: datos.activo === false ? 'DESACTIVAR' : 'MODIFICAR',
      datos: { nombre: actualizada.nombre },
    });
    return aActividadSalida(actualizada);
  }, bd);
}

/** Lista actividades con búsqueda/orden/paginación. Lectura. */
export async function listarActividades(
  sesion: SesionUsuario,
  parametros: ParametrosActividadQuery = {},
  bd?: ContextoBd,
): Promise<ActividadPagina> {
  verificarLectura(sesion);
  const filtros: ActividadQuery = validarEntrada(esquemaActividadQueryDominio, parametros);
  const where: Prisma.ActividadProductividadWhereInput = {
    ...(filtros.incluirInactivos ? {} : { activo: true }),
    ...(filtros.area === undefined ? {} : { area: filtros.area }),
    ...(filtros.busqueda === undefined || filtros.busqueda === ''
      ? {}
      : { nombre: { contains: filtros.busqueda, mode: 'insensitive' } }),
  };
  const cliente = clienteLectura(bd);
  const [total, datos] = await Promise.all([
    cliente.actividadProductividad.count({ where }),
    cliente.actividadProductividad.findMany({
      where,
      orderBy: { [filtros.ordenarPor]: filtros.direccion },
      ...rangoPrisma(filtros),
    }),
  ]);
  const pagina: Pagina<ActividadProductividad> = armarPagina(datos, total, filtros);
  return { ...pagina, datos: pagina.datos.map(aActividadSalida) };
}

// ── REGISTROS diarios de productividad ────────────────────────────────────────────────────────────

/** Un registro con su actividad y persona incluidas (para calcular el índice al proyectar). */
type RegistroConRelaciones = Prisma.RegistroProductividadGetPayload<{
  include: { actividad: true; persona: true; cliente: { select: { nombre: true } } };
}>;

/** Jornada base del almacén de la empresa activa (default 9 si no hay configuración). */
async function jornadaAlmacen(
  cliente: Tx | ReturnType<typeof clienteLectura>,
  idEmpresa: number,
): Promise<number> {
  const config = await cliente.configuracionEmpresa.findUnique({
    where: { idEmpresa },
    select: { jornadaBaseAlmacen: true },
  });
  return config?.jornadaBaseAlmacen ?? 9;
}

/** Índice y % trabajado de un registro (reusa las fórmulas puras). */
function indiceDeRegistro(
  registro: RegistroConRelaciones,
  jornada: number,
): { indice: number | null; porcentajeTrabajado: number | null } {
  const horasTrabajadas = registro.horasTrabajadas.toNumber();
  const cantidad = registro.cantidad.toNumber();
  if (registro.area === 'ip') {
    const horasBase = registro.persona?.horasBase?.toNumber() ?? null;
    const porcentajeD = registro.actividad.porcentajeD?.toNumber() ?? null;
    if (horasBase === null || porcentajeD === null || horasTrabajadas <= 0) {
      return { indice: null, porcentajeTrabajado: null };
    }
    return {
      indice: redondear4(
        indiceProductividadIp({ horasBase, horasTrabajadas, porcentajeD, cantidad }),
      ),
      porcentajeTrabajado: horasBase > 0 ? redondear4(horasTrabajadas / horasBase) : null,
    };
  }
  const pzPersDia = registro.actividad.pzPersDia?.toNumber() ?? null;
  if (pzPersDia === null || pzPersDia <= 0 || registro.personas <= 0 || horasTrabajadas <= 0) {
    return { indice: null, porcentajeTrabajado: null };
  }
  return {
    indice: redondear4(
      indiceProductividadAlmacen({
        jornadaBase: jornada,
        pzPersDia,
        piezas: cantidad,
        personas: registro.personas,
        horasTrabajadas,
      }),
    ),
    porcentajeTrabajado: jornada > 0 ? redondear4(horasTrabajadas / jornada) : null,
  };
}

/** Proyecta un registro a la salida del contrato (con índice calculado). */
function aRegistroSalida(
  registro: RegistroConRelaciones,
  jornada: number,
): RegistroProductividadSalida {
  const { indice, porcentajeTrabajado } = indiceDeRegistro(registro, jornada);
  return {
    id: registro.id,
    idEmpresa: registro.idEmpresa,
    fecha: registro.fecha.toISOString().slice(0, 10),
    area: registro.area,
    idActividad: registro.idActividad,
    actividad: registro.actividad.nombre,
    idPersona: registro.idPersona,
    persona: registro.persona?.nombre ?? null,
    cantidad: registro.cantidad.toNumber(),
    horasTrabajadas: registro.horasTrabajadas.toNumber(),
    personas: registro.personas,
    idCliente: registro.idCliente,
    cliente: registro.cliente?.nombre ?? null,
    indice,
    porcentajeTrabajado,
    cancelado: registro.cancelado,
    motivoCancelacion: registro.motivoCancelacion,
    creadoEn: registro.creadoEn.toISOString(),
    creadoPorId: registro.creadoPorId,
  };
}

/**
 * Registra productividad de un día. El `area` la determina la ACTIVIDAD (se sella). IP exige
 * `idPersona` (de área IP); almacén usa `personas` (y opcional `idCliente`). Valida divisores
 * (pzPersDia del almacén) y el gate de fecha libre. Permiso de captura por área (A4). A9.
 */
export async function registrarProductividad(
  sesion: SesionUsuario,
  entrada: DatosRegistroProductividadCrear,
  bd?: ContextoBd,
): Promise<RegistroProductividadSalida> {
  const datos = validarEntrada(esquemaRegistroProductividadCrear, entrada);
  const idEmpresa = sesion.idEmpresaActiva;
  const fecha = fechaAUtc(datos.fecha);
  verificarFechaCapturable(sesion, fecha);

  return enTransaccion(async (tx) => {
    const actividad = await tx.actividadProductividad.findUnique({
      where: { id: datos.idActividad },
    });
    if (actividad === null)
      throw new ErrorNoEncontrado('ActividadProductividad', datos.idActividad);
    if (!actividad.activo) {
      throw new ErrorConflicto(`La actividad "${actividad.nombre}" está desactivada.`);
    }
    const area = actividad.area;
    verificarCaptura(sesion, area);

    let idPersona: number | null = null;
    if (area === 'ip') {
      if (datos.idPersona === undefined) {
        throw new ErrorValidacion('La productividad de IP requiere una persona.');
      }
      const persona = await tx.personalArea.findUnique({ where: { id: datos.idPersona } });
      if (persona === null) throw new ErrorNoEncontrado('PersonalArea', datos.idPersona);
      if (persona.area !== 'ip') {
        throw new ErrorValidacion(
          'La persona seleccionada no es del área de Ingeniería del Producto.',
        );
      }
      if (!persona.activo)
        throw new ErrorConflicto(`La persona "${persona.nombre}" está desactivada.`);
      idPersona = persona.id;
    } else {
      // Almacén: divisor pzPersDia debe existir (>0); personas > 0 lo garantiza Zod.
      if (actividad.pzPersDia === null || actividad.pzPersDia.toNumber() <= 0) {
        throw new ErrorConflicto(
          `La actividad "${actividad.nombre}" no tiene estándar de piezas/persona/día; corrígela antes de capturar.`,
        );
      }
    }

    let idCliente: number | null = null;
    if (area === 'almacen' && datos.idCliente !== undefined) {
      const cliente = await tx.cliente.findUnique({ where: { id: datos.idCliente } });
      if (cliente === null) throw new ErrorNoEncontrado('Cliente', datos.idCliente);
      idCliente = cliente.id;
    }

    const creado = await tx.registroProductividad.create({
      data: {
        idEmpresa,
        fecha,
        area,
        idActividad: actividad.id,
        idPersona,
        cantidad: new PrismaNS.Decimal(datos.cantidad),
        horasTrabajadas: new PrismaNS.Decimal(datos.horasTrabajadas),
        personas: area === 'ip' ? 1 : datos.personas,
        idCliente,
        ...datosCreacion(sesion),
      },
      include: { actividad: true, persona: true, cliente: { select: { nombre: true } } },
    });
    await registrarBitacora(tx, sesion, {
      entidad: 'RegistroProductividad',
      idEntidad: creado.id,
      accion: 'CREAR',
      datos: { area, idActividad: actividad.id, fecha: datos.fecha },
    });
    const jornada = area === 'almacen' ? await jornadaAlmacen(tx, idEmpresa) : 0;
    return aRegistroSalida(creado, jornada);
  }, bd);
}

/** Cancela (suave, con motivo) un registro. NUNCA se edita/borra. Permiso de captura por área. */
export async function cancelarRegistroProductividad(
  sesion: SesionUsuario,
  id: number,
  entrada: DatosRegistroProductividadCancelar,
  bd?: ContextoBd,
): Promise<RegistroProductividadSalida> {
  const datos = validarEntrada(esquemaRegistroProductividadCancelar, entrada);
  return enTransaccion(async (tx) => {
    const actual = await tx.registroProductividad.findUnique({ where: { id } });
    if (actual === null) throw new ErrorNoEncontrado('RegistroProductividad', id);
    if (actual.idEmpresa !== sesion.idEmpresaActiva) {
      throw new ErrorNoEncontrado('RegistroProductividad', id); // A9: de otra empresa = no existe
    }
    verificarCaptura(sesion, actual.area);
    if (actual.cancelado) throw new ErrorConflicto('El registro ya está cancelado.');

    const actualizado = await tx.registroProductividad.update({
      where: { id },
      data: {
        cancelado: true,
        canceladoEn: new Date(),
        canceladoPorId: sesion.id,
        motivoCancelacion: datos.motivo,
        ...datosModificacion(sesion),
      },
      include: { actividad: true, persona: true, cliente: { select: { nombre: true } } },
    });
    await registrarBitacora(tx, sesion, {
      entidad: 'RegistroProductividad',
      idEntidad: id,
      accion: 'CANCELAR',
      datos: { motivo: datos.motivo },
    });
    const jornada = actual.area === 'almacen' ? await jornadaAlmacen(tx, actual.idEmpresa) : 0;
    return aRegistroSalida(actualizado, jornada);
  }, bd);
}

/** Parámetros del listado de registros. */
export type ParametrosRegistroQuery = z.input<typeof esquemaRegistroQueryDominio>;

/** Lista registros de productividad (con índice) de la empresa activa. Lectura. A9. */
export async function listarRegistrosProductividad(
  sesion: SesionUsuario,
  parametros: ParametrosRegistroQuery = {},
  bd?: ContextoBd,
): Promise<RegistroProductividadPagina> {
  verificarLectura(sesion);
  const filtros: RegistroProductividadQuery = validarEntrada(
    esquemaRegistroQueryDominio,
    parametros,
  );
  const idEmpresa = sesion.idEmpresaActiva;
  const where: Prisma.RegistroProductividadWhereInput = {
    idEmpresa,
    ...(filtros.incluirCancelados ? {} : { cancelado: false }),
    ...(filtros.area === undefined ? {} : { area: filtros.area }),
    ...(filtros.idActividad === undefined ? {} : { idActividad: filtros.idActividad }),
    ...(filtros.idPersona === undefined ? {} : { idPersona: filtros.idPersona }),
    ...(filtros.idCliente === undefined ? {} : { idCliente: filtros.idCliente }),
    ...(filtros.desde === undefined && filtros.hasta === undefined
      ? {}
      : {
          fecha: {
            ...(filtros.desde === undefined ? {} : { gte: fechaAUtc(filtros.desde) }),
            ...(filtros.hasta === undefined ? {} : { lte: fechaAUtc(filtros.hasta) }),
          },
        }),
  };
  const cliente = clienteLectura(bd);
  const [total, datos, jornada] = await Promise.all([
    cliente.registroProductividad.count({ where }),
    cliente.registroProductividad.findMany({
      where,
      orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
      include: { actividad: true, persona: true, cliente: { select: { nombre: true } } },
      ...rangoPrisma(filtros),
    }),
    jornadaAlmacen(cliente, idEmpresa),
  ]);
  const pagina = armarPagina(datos, total, filtros);
  return { ...pagina, datos: pagina.datos.map((r) => aRegistroSalida(r, jornada)) };
}

// ── TABLERO de productividad vs estándar (agregación en SERVIDOR/SQL) ──────────────────────────────

/** Parámetros del tablero. */
export type ParametrosTablero = z.input<typeof esquemaTableroProductividadQuery>;

/** Fila cruda del tablero (nombres alias del SQL). */
interface FilaTableroCruda {
  periodo: string;
  anio: number;
  periodoNum: number;
  idActividad: number;
  actividad: string;
  idPersona: number | null;
  persona: string | null;
  numRegistros: number;
  cantidad: number;
  horasTrabajadas: number;
  indiceTotal: number;
  sumaBase: number;
  estandar: number | null;
}

/**
 * Tablero de productividad vs estándar de la empresa activa (A9). AGREGA en SQL los registros
 * diarios reales por (periodo × actividad × persona) — NO las heurísticas /5, /30 del viejo. El
 * índice por registro usa la MISMA fórmula que {@link indiceProductividadIp} /
 * {@link indiceProductividadAlmacen} (documentado y cubierto por un test de integración que las
 * cruza). Permiso de captura del área (A4).
 */
export async function tableroProductividad(
  sesion: SesionUsuario,
  parametros: ParametrosTablero,
  bd?: ContextoBd,
): Promise<TableroProductividad> {
  const filtros: TableroProductividadQuery = validarEntrada(
    esquemaTableroProductividadQuery,
    parametros,
  );
  verificarCaptura(sesion, filtros.area);
  const idEmpresa = sesion.idEmpresaActiva;
  const cliente = clienteLectura(bd);
  const jornada = await jornadaAlmacen(cliente, idEmpresa);

  // Expresiones de periodo según la agrupación.
  const periodo =
    filtros.agrupacion === 'dia'
      ? {
          etiqueta: PrismaNS.sql`to_char(r."fecha", 'YYYY-MM-DD')`,
          anio: PrismaNS.sql`EXTRACT(YEAR FROM r."fecha")::int`,
          num: PrismaNS.sql`EXTRACT(DOY FROM r."fecha")::int`,
        }
      : filtros.agrupacion === 'mes'
        ? {
            etiqueta: PrismaNS.sql`to_char(r."fecha", 'YYYY-MM')`,
            anio: PrismaNS.sql`EXTRACT(YEAR FROM r."fecha")::int`,
            num: PrismaNS.sql`EXTRACT(MONTH FROM r."fecha")::int`,
          }
        : {
            etiqueta: PrismaNS.sql`to_char(r."fecha", 'IYYY') || '-W' || to_char(r."fecha", 'IW')`,
            anio: PrismaNS.sql`EXTRACT(ISOYEAR FROM r."fecha")::int`,
            num: PrismaNS.sql`EXTRACT(WEEK FROM r."fecha")::int`,
          };

  // Índice, base (para % trabajado) y estándar por ÁREA (el filtro fija un solo área).
  const j = PrismaNS.sql`${jornada}::numeric`;
  const indiceExpr =
    filtros.area === 'ip'
      ? PrismaNS.sql`(COALESCE(per."horas_base", 0) / r."horas_trabajadas") * COALESCE(act."porcentaje_d", 0) * r."cantidad"`
      : PrismaNS.sql`((((${j} / act."pz_pers_dia") / ${j}) * r."cantidad") / r."personas") * (${j} / r."horas_trabajadas")`;
  const baseExpr = filtros.area === 'ip' ? PrismaNS.sql`COALESCE(per."horas_base", 0)` : j;
  const estandarExpr =
    filtros.area === 'ip'
      ? PrismaNS.sql`MAX(act."porcentaje_d")::float8`
      : PrismaNS.sql`MAX(act."pz_pers_dia")::float8`;

  const condiciones: Prisma.Sql[] = [
    PrismaNS.sql`r."id_empresa" = ${idEmpresa}`,
    PrismaNS.sql`r."area" = ${filtros.area}::"area_productividad"`,
    PrismaNS.sql`r."cancelado" = FALSE`,
    PrismaNS.sql`r."horas_trabajadas" > 0`,
  ];
  if (filtros.area === 'almacen') condiciones.push(PrismaNS.sql`act."pz_pers_dia" > 0`);
  if (filtros.idActividad !== undefined)
    condiciones.push(PrismaNS.sql`r."id_actividad" = ${filtros.idActividad}`);
  if (filtros.idPersona !== undefined)
    condiciones.push(PrismaNS.sql`r."id_persona" = ${filtros.idPersona}`);
  if (filtros.idCliente !== undefined)
    condiciones.push(PrismaNS.sql`r."id_cliente" = ${filtros.idCliente}`);
  if (filtros.desde !== undefined)
    condiciones.push(PrismaNS.sql`r."fecha" >= ${fechaAUtc(filtros.desde)}`);
  if (filtros.hasta !== undefined)
    condiciones.push(PrismaNS.sql`r."fecha" <= ${fechaAUtc(filtros.hasta)}`);
  const where = PrismaNS.join(condiciones, ' AND ');

  const filas = await cliente.$queryRaw<FilaTableroCruda[]>(PrismaNS.sql`
    SELECT
      ${periodo.etiqueta}                       AS "periodo",
      ${periodo.anio}                           AS "anio",
      ${periodo.num}                            AS "periodoNum",
      r."id_actividad"                          AS "idActividad",
      act."nombre"                              AS "actividad",
      r."id_persona"                            AS "idPersona",
      per."nombre"                              AS "persona",
      COUNT(*)::int                             AS "numRegistros",
      SUM(r."cantidad")::float8                 AS "cantidad",
      SUM(r."horas_trabajadas")::float8         AS "horasTrabajadas",
      SUM(${indiceExpr})::float8                AS "indiceTotal",
      SUM(${baseExpr})::float8                  AS "sumaBase",
      ${estandarExpr}                           AS "estandar"
    FROM "registro_productividad" r
    JOIN "actividad_productividad" act ON act."id" = r."id_actividad"
    LEFT JOIN "personal_area" per ON per."id" = r."id_persona"
    WHERE ${where}
    GROUP BY "periodo", "anio", "periodoNum", r."id_actividad", act."nombre", r."id_persona", per."nombre"
    ORDER BY "anio" ASC, "periodoNum" ASC, act."nombre" ASC, per."nombre" ASC NULLS FIRST
  `);

  return {
    area: filtros.area,
    agrupacion: filtros.agrupacion,
    filas: filas.map((f) => ({
      periodo: f.periodo,
      anio: f.anio,
      periodoNum: f.periodoNum,
      area: filtros.area,
      idActividad: f.idActividad,
      actividad: f.actividad,
      idPersona: f.idPersona,
      persona: f.persona,
      numRegistros: f.numRegistros,
      cantidad: redondear4(f.cantidad),
      horasTrabajadas: redondear4(f.horasTrabajadas),
      indiceTotal: redondear4(f.indiceTotal),
      indicePromedio: f.numRegistros > 0 ? redondear4(f.indiceTotal / f.numRegistros) : 0,
      porcentajeTrabajado: f.sumaBase > 0 ? redondear4(f.horasTrabajadas / f.sumaBase) : null,
      estandar: f.estandar,
    })),
  };
}
