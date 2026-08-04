/**
 * Loader de PROVEEDORES + FUSIÓN DE TERCEROS (F1-E6, D12/R15). Cuatro fuentes se consolidan
 * en el ÚNICO catálogo `Proveedor` (los antiguos Maquilero/Cortador/Estampador se absorben,
 * marcando sus servicios con roles de `RolProveedor`):
 *
 *  • `Proveedores.csv` (443): IdProveedor, Proveedor, Telefono, Condiciones, Contacto,
 *    RazonSocialProv, TipoProv(H/T/S) → `Proveedor` con `tipo` mapeado y SIN roles de
 *    servicio (son comerciales: se les pone el rol `otros-servicios` para cumplir el ≥1 que
 *    exige el dominio — el `tipo` ya clasifica telas/avíos/servicios).
 *  • `Cortadores.csv` (69): → rol **corte**. `Precio`/precioReferencia NO se porta (el costo
 *    del corte va en la orden, F2/F3).
 *  • `Maquileros.csv` (496): Costura=true → rol **maquila-costura**; Proceso=true → se le
 *    asigna **maquila-costura** igualmente y se REPORTA (criterio conservador: "Proceso" en
 *    el viejo no distingue el sub-servicio; no se inventa un rol). Porta corto/asegurado/
 *    obsPago/observaciones(→notas)/telefonos(→telefono)/direccion + Nombre+Apellidos→nombre.
 *  • `Estampadores.csv` (44): → rol **estampado**. Un estampador puede ser el MISMO que un
 *    maquilero (por corto/nombre) → se FUSIONA en UN proveedor con ambos roles.
 *
 * DEDUP: por **nombre normalizado** (`normalizarParaDedup`) contra los proveedores ya
 * existentes y los recién creados en esta corrida. Si coincide, se FUSIONAN los roles (vía
 * `actualizarProveedor`) y se reportan los homónimos ambiguos. Carga VÍA el dominio (A1):
 * `crearProveedor` + `actualizarProveedor`. Persiste un mapeo por cada fuente
 * (`Proveedor:IdProveedor`, `:IdMaquileros`, `:IdEstampadores`, `:IdCortadores`).
 */
import {
  actualizarProveedor,
  crearProveedor,
  listarRolesProveedor,
} from '../../src/dominio/catalogos/proveedores.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';
import { ErrorConflicto, ErrorDominio } from '../../src/comun/errores.js';
import type { ContextoBd } from '../../src/comun/transaccion.js';
import type { PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import {
  mapearRolProveedorComercial,
  mapearTipoProveedor,
  rolesDeMaquilero,
} from '../comun/mapeos-enum.js';
import {
  ENTIDAD_MAPEO,
  guardarMapeo,
  type ClienteMapeo,
  type DatosMapeo,
  type EntidadMapeo,
} from '../comun/mapeo.js';
import {
  escribirConstanciaTercerosConSaldo,
  listarTercerosExcluidosConSaldo,
} from '../comun/constancia-terceros.js';
import { prescanUso, type PrescanUso } from '../comun/prescan-uso.js';
import type { Reporte } from '../comun/reporte.js';
import { LIMITES, truncarYReportar } from '../comun/saneo.js';
import { normalizarParaDedup, parsearBandera, parsearTexto } from '../comun/valores.js';
import { resolverVentana } from '../comun/ventana.js';
import type { ResultadoLoader } from './clientes.js';

/** Códigos de rol de `RolProveedor` que usa la fusión (sembrados en seed F0/E1B). */
const COD_ROL = {
  corte: 'corte',
  maquilaCostura: 'maquila-costura',
  estampado: 'estampado',
  // Roles comerciales (se asignan según `TipoProv`, ver `mapearRolProveedorComercial`).
  vendeTelas: 'vende-telas',
  vendeAvios: 'vende-avios',
  otros: 'otros-servicios',
} as const;

/** Carga el mapa codigo→id de los roles de proveedor (deben existir por el seed). */
async function cargarRoles(sesion: SesionUsuario, bd: ContextoBd): Promise<Map<string, number>> {
  const roles = await listarRolesProveedor(sesion, { incluirInactivos: true }, bd);
  return new Map(roles.map((r) => [r.codigo, r.id]));
}

/** Índice en memoria nombreNormalizado → idProveedor para el dedup intra-corrida. */
type IndiceNombres = Map<string, number>;

/** Construye el índice con los proveedores YA existentes en la BD (idempotencia + dedup). */
async function indiceExistentes(cliente: ClienteMapeo): Promise<IndiceNombres> {
  const filas = await cliente.proveedor.findMany({ select: { id: true, nombre: true } });
  const idx: IndiceNombres = new Map();
  for (const f of filas) {
    idx.set(normalizarParaDedup(f.nombre), f.id);
  }
  return idx;
}

/** Roles actuales (ids) de un proveedor, para fusionar sin perder los que ya tenía. */
async function rolesActuales(cliente: ClienteMapeo, idProveedor: number): Promise<number[]> {
  const filas = await cliente.proveedorRol.findMany({
    where: { idProveedor },
    select: { idRolProveedor: true },
  });
  return filas.map((f) => f.idRolProveedor);
}

/**
 * Asegura que `idProveedor` tenga TODOS los `idsRol` (fusión de roles). Si faltan, los suma
 * vía `actualizarProveedor` (reemplaza el set con la unión). Devuelve true si cambió algo.
 */
async function fusionarRoles(
  sesion: SesionUsuario,
  bd: ContextoBd,
  cliente: ClienteMapeo,
  idProveedor: number,
  idsRol: number[],
): Promise<boolean> {
  const actuales = new Set(await rolesActuales(cliente, idProveedor));
  const union = new Set(actuales);
  for (const id of idsRol) {
    union.add(id);
  }
  if (union.size === actuales.size) {
    return false; // ya los tenía todos
  }
  await actualizarProveedor(sesion, { id: idProveedor, roles: [...union] }, bd);
  return true;
}

/** Resultado de la fusión de terceros: el resumen + cuántas fusiones de roles ocurrieron. */
export interface ResultadoProveedores extends ResultadoLoader {
  fusiones: number;
}

export async function cargarProveedores(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
  prescan?: PrescanUso | null,
): Promise<ResultadoProveedores> {
  const bd: ContextoBd = { cliente: cliente as PrismaClient };
  const rolPorCodigo = await cargarRoles(sesion, bd);
  const idx = await indiceExistentes(cliente);
  // Prescan de USO: con ventana activa solo migran los terceros usados (OC/órdenes/EsMa/
  // notas/auditorías por su espacio de id, o proveedor TEXTO de telas/avíos usados por nombre).
  const pre = prescan === undefined ? prescanUso(resolverVentana()) : prescan;

  let creados = 0;
  let existentes = 0;
  let omitidos = 0;
  let omitidosValidacion = 0;
  let fusiones = 0;
  let fueraVentana = 0;

  /** ¿El tercero está USADO (por id en su espacio, o por nombre de tela/avío usado)? */
  function terceroUsado(
    idsUsados: Set<string> | null,
    idViejo: string | undefined,
    nombre: string,
  ): boolean {
    if (pre === null) return true;
    if (idsUsados !== null && idViejo !== undefined && idsUsados.has(idViejo.trim())) return true;
    return pre.provNombres.has(normalizarParaDedup(nombre));
  }

  /** Cuenta y reporta un tercero excluido por la ventana (conteo agregado + muestra). */
  function excluirTercero(origen: string, idViejo: string | undefined, nombre: string): void {
    fueraVentana += 1;
    reporte.agregarMuestra(
      'Terceros FUERA de ventana (sin uso — NO migrados)',
      `"${nombre}" (${origen}, id=${idViejo ?? '?'})`,
    );
  }

  function rolId(codigo: string): number {
    const id = rolPorCodigo.get(codigo);
    if (id === undefined) {
      throw new Error(
        `Falta el rol de proveedor "${codigo}" en la BD (¿corrió el seed con SEED_ON_START?).`,
      );
    }
    return id;
  }

  /**
   * Crea o fusiona un tercero. Si el nombre normalizado ya existe → fusiona roles + datos
   * faltantes (NO pisa lo capturado) y reporta el homónimo; si no → crea nuevo. Devuelve el
   * idProveedor resultante.
   */
  async function crearOFusionar(
    nombreCrudo: string,
    idsRol: number[],
    datosCrudos: Partial<{
      tipo: ReturnType<typeof mapearTipoProveedor>;
      telefono: string | null;
      contacto: string | null;
      condiciones: string | null;
      razonSocial: string | null;
      direccion: string | null;
      notas: string | null;
      corto: string | null;
      asegurado: boolean;
      obsPago: string | null;
    }>,
    origen: string,
    idViejo: string | undefined,
  ): Promise<number | null> {
    // Trunca TODOS los textos a su `max` del esquema antes de tocar el dominio (la data del
    // viejo rebasa varios topes; un teléfono de 137 chars no debe abortar la fila).
    const lim = LIMITES.proveedor;
    const tr = (campo: keyof typeof lim, valor: string | null | undefined): string | null =>
      truncarYReportar(reporte, 'Proveedor', idViejo, campo, valor ?? null, lim[campo]);
    const nombre = tr('nombre', nombreCrudo) ?? nombreCrudo;
    const datosExtra = {
      ...datosCrudos,
      telefono: tr('telefono', datosCrudos.telefono),
      contacto: tr('contacto', datosCrudos.contacto),
      condiciones: tr('condiciones', datosCrudos.condiciones),
      razonSocial: tr('razonSocial', datosCrudos.razonSocial),
      direccion: tr('direccion', datosCrudos.direccion),
      notas: tr('notas', datosCrudos.notas),
      corto: tr('corto', datosCrudos.corto),
      obsPago: tr('obsPago', datosCrudos.obsPago),
    };

    const norm = normalizarParaDedup(nombre);
    if (norm === '') {
      return null;
    }
    const existenteId = idx.get(norm);
    if (existenteId !== undefined) {
      // Fusión: sumar roles. Reporta el homónimo entre fuentes distintas.
      const cambio = await fusionarRoles(sesion, bd, cliente, existenteId, idsRol);
      if (cambio) {
        fusiones += 1;
      }
      reporte.agregar(
        'Terceros homónimos fusionados (mismo nombre, distinta fuente)',
        `"${nombre}" (${origen}) → proveedor #${String(existenteId)}`,
      );
      existentes += 1;
      return existenteId;
    }

    // Nuevo proveedor. `corto` es @unique global y nullable: si choca, se omite el corto y
    // se reporta (no se pierde el tercero).
    try {
      const creado = await crearProveedor(
        sesion,
        {
          nombre,
          roles: idsRol,
          ...(datosExtra.tipo === undefined ? {} : { tipo: datosExtra.tipo }),
          ...(datosExtra.telefono ? { telefono: datosExtra.telefono } : {}),
          ...(datosExtra.contacto ? { contacto: datosExtra.contacto } : {}),
          ...(datosExtra.condiciones ? { condiciones: datosExtra.condiciones } : {}),
          ...(datosExtra.razonSocial ? { razonSocial: datosExtra.razonSocial } : {}),
          ...(datosExtra.direccion ? { direccion: datosExtra.direccion } : {}),
          ...(datosExtra.notas ? { notas: datosExtra.notas } : {}),
          ...(datosExtra.corto ? { corto: datosExtra.corto } : {}),
          ...(datosExtra.asegurado === undefined ? {} : { asegurado: datosExtra.asegurado }),
          ...(datosExtra.obsPago ? { obsPago: datosExtra.obsPago } : {}),
        },
        bd,
      );
      idx.set(norm, creado.id);
      creados += 1;
      return creado.id;
    } catch (error) {
      if (error instanceof ErrorConflicto && datosExtra.corto) {
        // Probable choque de `corto` único: reintentar sin corto y reportar.
        reporte.agregar(
          'Terceros con código corto duplicado (creados SIN corto)',
          `"${nombre}" (${origen}) corto="${datosExtra.corto}"`,
        );
        const sinCorto = { ...datosExtra, corto: null };
        return crearOFusionar(nombre, idsRol, sinCorto, origen, idViejo);
      }
      if (error instanceof ErrorConflicto) {
        // Choque de nombre case-insensitive no captado por el dedup normalizado: fusionar.
        const fila = await cliente.proveedor.findFirst({
          where: { nombre: { equals: nombre, mode: 'insensitive' } },
          select: { id: true },
        });
        if (fila !== null) {
          idx.set(norm, fila.id);
          const cambio = await fusionarRoles(sesion, bd, cliente, fila.id, idsRol);
          if (cambio) {
            fusiones += 1;
          }
          existentes += 1;
          return fila.id;
        }
      }
      // Cualquier otro error de fila (p. ej. ErrorValidacion por data sucia que sobrevivió al
      // truncado): se reporta y la fila se OMITE — el ETL NUNCA aborta por un tercero malo.
      const detalle =
        error instanceof ErrorDominio ? `${error.codigo}: ${error.message}` : String(error);
      reporte.agregar(
        'Proveedor: fila OMITIDA por error (data sucia)',
        `"${nombre}" (${origen}) · ${detalle}`,
      );
      omitidosValidacion += 1;
      return null;
    }
  }

  async function mapear(
    entidad: EntidadMapeo,
    idViejo: string | undefined,
    idNuevo: number | null,
    datos: DatosMapeo,
  ): Promise<void> {
    if (idViejo !== undefined && idNuevo !== null) {
      await guardarMapeo(cliente, entidad, idViejo, idNuevo, datos);
    }
  }

  // ── 1) Proveedores (comerciales) ─────────────────────────────────────────────
  for (const fila of leerCsv('Proveedores.csv')) {
    const nombre = parsearTexto(fila.Proveedor);
    if (nombre === null) {
      omitidos += 1;
      continue;
    }
    if (!terceroUsado(pre?.provIdProveedor ?? null, fila.IdProveedor, nombre)) {
      excluirTercero('Proveedores', fila.IdProveedor, nombre);
      continue;
    }
    // Rol según TipoProv: T→vende-telas, H→vende-avios, S/vacío→otros-servicios (F4/MRP
    // filtra proveedores por rol). El `tipo` enum se conserva como clasificador rápido.
    const codRolComercial = mapearRolProveedorComercial(fila.TipoProv);
    const idNuevo = await crearOFusionar(
      nombre,
      [rolId(codRolComercial)],
      {
        tipo: mapearTipoProveedor(fila.TipoProv),
        telefono: parsearTexto(fila.Telefono),
        contacto: parsearTexto(fila.Contacto),
        condiciones: parsearTexto(fila.Condiciones),
        razonSocial: parsearTexto(fila.RazonSocialProv),
      },
      'Proveedores',
      fila.IdProveedor,
    );
    await mapear(ENTIDAD_MAPEO.proveedorPorIdProveedor, fila.IdProveedor, idNuevo, { nombre });
  }

  // ── 2) Cortadores → rol corte (sin precio) ───────────────────────────────────
  for (const fila of leerCsv('Cortadores.csv')) {
    const nombre = parsearTexto(fila.Cortador);
    if (nombre === null) {
      omitidos += 1;
      continue;
    }
    if (!terceroUsado(pre?.provIdCortadores ?? null, fila.IdCortadores, nombre)) {
      excluirTercero('Cortadores', fila.IdCortadores, nombre);
      continue;
    }
    const idNuevo = await crearOFusionar(
      nombre,
      [rolId(COD_ROL.corte)],
      { telefono: parsearTexto(fila.Telefonos) },
      'Cortadores',
      fila.IdCortadores,
    );
    await mapear(ENTIDAD_MAPEO.proveedorPorIdCortadores, fila.IdCortadores, idNuevo, { nombre });
  }

  // ── 3) Maquileros → costura y/o decoración (estampado) según sus banderas ────
  for (const fila of leerCsv('Maquileros.csv')) {
    const nombre = parsearTexto(`${fila.Nombre ?? ''} ${fila.Apellidos ?? ''}`);
    if (nombre === null) {
      omitidos += 1;
      continue;
    }
    if (!terceroUsado(pre?.provIdMaquileros ?? null, fila.IdMaquileros, nombre)) {
      excluirTercero('Maquileros', fila.IdMaquileros, nombre);
      continue;
    }
    const costura = parsearBandera(fila.Costura);
    const proceso = parsearBandera(fila.Proceso);
    // Aclaración de Daniel: Costura→maquila-costura; Proceso(=decorado)→estampado; ambas→ambos
    // (ver `rolesDeMaquilero`). Sub-servicio fino de la decoración lo afina Gabriel después.
    const idsRol = rolesDeMaquilero(costura, proceso).map((codigo) => rolId(codigo));
    if (proceso) {
      reporte.agregar(
        'Maquileros con Proceso=1 (asignado estampado por Proceso — afinar sub-servicio)',
        `"${nombre}" (IdMaquileros=${fila.IdMaquileros ?? '?'})`,
      );
    }

    const idNuevo = await crearOFusionar(
      nombre,
      idsRol,
      {
        telefono: parsearTexto(fila.Telefonos),
        direccion: parsearTexto(fila.Direccion),
        notas: parsearTexto(fila.Observaciones),
        corto: parsearTexto(fila.Corto),
        asegurado: parsearBandera(fila.Asegurado),
        obsPago: parsearTexto(fila.ObsPago),
      },
      'Maquileros',
      fila.IdMaquileros,
    );
    await mapear(ENTIDAD_MAPEO.proveedorPorIdMaquileros, fila.IdMaquileros, idNuevo, { nombre });
  }

  // ── 4) Estampadores → rol estampado (fusiona con maquileros homónimos) ───────
  for (const fila of leerCsv('Estampadores.csv')) {
    const nombre = parsearTexto(`${fila.Nombre ?? ''} ${fila.Apellidos ?? ''}`);
    if (nombre === null) {
      omitidos += 1;
      continue;
    }
    if (!terceroUsado(pre?.provIdEstampadores ?? null, fila.IdEstampadores, nombre)) {
      excluirTercero('Estampadores', fila.IdEstampadores, nombre);
      continue;
    }
    const idNuevo = await crearOFusionar(
      nombre,
      [rolId(COD_ROL.estampado)],
      {
        telefono: parsearTexto(fila.Telefonos),
        direccion: parsearTexto(fila.Direccion),
        notas: parsearTexto(fila.Observaciones),
        corto: parsearTexto(fila.Corto),
      },
      'Estampadores',
      fila.IdEstampadores,
    );
    await mapear(ENTIDAD_MAPEO.proveedorPorIdEstampadores, fila.IdEstampadores, idNuevo, {
      nombre,
    });
  }

  if (fueraVentana > 0) {
    reporte.nota(
      `Terceros fuera de ventana (sin OC/órdenes/EsMa/notas/auditorías en la ventana ni ` +
        `telas/avíos usados): ${String(fueraVentana)} NO migrados.`,
    );
  }
  // CONSTANCIA (§7): de esos excluidos, los que traían SALDO EsMa ≠ 0 se dejan por escrito en un
  // archivo propio (mismo patrón que `excluidos-sin-actividad-*.txt` del inventario). El criterio NO
  // cambia: solo se documenta lo que la decisión del dueño deja fuera.
  if (pre !== null) {
    escribirConstanciaTercerosConSaldo(
      listarTercerosExcluidosConSaldo((idViejo) => pre.provIdMaquileros.has(idViejo)),
      reporte,
    );
  }
  return { creados, existentes, omitidos, omitidosValidacion, fusiones, fueraVentana };
}
