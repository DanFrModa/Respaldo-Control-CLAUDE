/**
 * Administración de empresas y su configuración (doc funcional 10 §5;
 * MEJORAS A9: multi-empresa explícito).
 *
 * `Empresa` equivale a la tabla `Empresas` del viejo (multi-empresa para
 * facturación/IPT/EDR); `ConfiguracionEmpresa` absorbe la tabla
 * `Propiedades` (un solo registro GLOBAL en el viejo) convertida en
 * parámetros POR EMPRESA (doc 10 §6.4): utilidad sugerida, regalías,
 * colchón de costura de la RC, fechas de inventario físico y almacén PT por
 * defecto.
 *
 * Regla heredada: la empresa FAVORITA (viejo: `Importancia = 1`) es la
 * propuesta al iniciar sesión; aquí se garantiza que sea ÚNICA: marcar una
 * desmarca la anterior en la misma transacción.
 */
import type { ConfiguracionEmpresa, Empresa } from '../../datos/index.js';
import { z } from 'zod';

import {
  eliminarObjetosBestEffort,
  servicioArchivos,
  type ServicioArchivos,
} from '../../comun/archivos.js';
import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import {
  invalidarLogoEmpresa,
  MIME_LOGO_PERMITIDOS,
  obtenerLogoEmpresa,
  TAMANO_MAXIMO_LOGO_BYTES,
  type LogoResuelto,
} from '../../comun/logo-empresa.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { problemaPngParaPdf } from '../../comun/png.js';
import { CODIGO_PRISMA, codigoErrorPrisma } from '../../comun/prisma-errores.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';
import { esRfcValido } from '../../contrato/esquemas/fiscal.js';

const esquemaCrearEmpresa = z.object({
  nombre: z.string().trim().min(1, 'El nombre es obligatorio.').max(100),
  razonSocial: z.string().trim().max(200).optional(),
  /** RFC fiscal (F9-E3): valida la forma del RFC mexicano si viene; '' = no capturado. */
  rfc: z
    .string()
    .trim()
    .toUpperCase()
    .max(13)
    .refine((v) => v === '' || esRfcValido(v), 'El RFC no tiene una forma válida.')
    .optional(),
  /**
   * ⭐ Régimen fiscal del SAT de esta empresa como RECEPTOR (fila 0.118). Validación SUAVE (largo),
   * igual que la del proveedor: el catálogo del SAT no vive aquí. '' = no capturado.
   */
  regimenFiscalSat: z.string().trim().max(10).optional(),
  /** ⭐ CP del DOMICILIO FISCAL del receptor (fila 0.118). '' = no capturado; si viene, 5 dígitos. */
  codigoPostalFiscal: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d{5}$/.test(v), 'El código postal debe tener 5 dígitos.')
    .optional(),
  /** Identificador corto para folios e impresos (viejo: `Identificador`). */
  identificador: z.string().trim().max(20).optional(),
  favorita: z.boolean().default(false),
  paraIpt: z.boolean().default(false),
  paraEdr: z.boolean().default(false),
});

export type EntradaCrearEmpresa = z.input<typeof esquemaCrearEmpresa>;

// Las banderas con `.default(false)` en el alta se sobrescriben aquí como `.optional()`
// SIN default: en una edición parcial, omitir una bandera NO debe resetearla (Zod
// `.partial()` NO quita los defaults, así que la omitida se rellenaría con `false` y
// pisaría el valor real en la BD —p. ej. editar el `identificador` borraría la marca de favorita).
// El `.extend` va ANTES del `.refine` (el refine devuelve un schema sin `.extend`).
const esquemaActualizarEmpresa = esquemaCrearEmpresa
  .partial()
  .extend({
    favorita: z.boolean().optional(),
    paraIpt: z.boolean().optional(),
    paraEdr: z.boolean().optional(),
  })
  .refine((cambios) => Object.values(cambios).some((valor) => valor !== undefined), {
    message: 'No hay ningún cambio que guardar.',
  });

export type EntradaActualizarEmpresa = z.input<typeof esquemaActualizarEmpresa>;

/** Parámetros por empresa (ex-`Propiedades`, doc 10 §5). Todos opcionales. */
const esquemaConfiguracion = z
  .object({
    /** Utilidad sugerida para costeo, como porcentaje (viejo: `UtilidadSujerida`). */
    utilidadSugerida: z.number().min(0).max(1000).nullable().optional(),
    /** Porcentaje base de regalías (viejo: `Regalias`). */
    regaliasBase: z.number().min(0).max(1000).nullable().optional(),
    /** Días de colchón que la Ruta Crítica suma a la costura (viejo: `ColchonCostura`). */
    colchonCostura: z.number().int().min(0).max(365).nullable().optional(),
    /** Fin de la 1ª cubeta de aging (días de atraso, F9-E5/D15d). NO nullable: siempre hay valor. */
    agingLimite1: z.number().int().min(1).max(3650).optional(),
    /** Fin de la 2ª cubeta de aging (días de atraso, F9-E5/D15d). NO nullable: siempre hay valor. */
    agingLimite2: z.number().int().min(1).max(3650).optional(),
    /**
     * ⭐⭐ V1-E3u (§Post-F9.89(a)) — umbral de DESVÍO de compra, en % entero. Daniel: *"arranca con
     * un default y se ajusta con el uso"*, así que tiene que poderse ajustar **sin deploy** — y una
     * columna sin puerta es justo el arreglo que necesita que alguien haga algo (§Post-F9.17).
     * NO nullable: siempre hay valor (default 10).
     */
    pctDesvioCompra: z.number().int().min(1).max(1000).optional(),
    /**
     * ⭐ V1-E8w (§Post-F9.153) — COSTO DE EMPAQUE por prenda. Daniel: *"Ponle 2.20 pesos por
     * default, y ya si cambia, que se pueda modificar"* — o sea, tiene que poderse mover **sin
     * deploy**, igual que el umbral de desvío. NO nullable: siempre hay valor (default 2.20).
     * 🔴 Moverlo NO reescribe ninguna receta ya hecha: sólo alimenta los precostos NUEVOS.
     */
    costoEmpaqueBase: z.number().nonnegative().max(100000).optional(),
    /** Fecha del último inventario físico de telas (viejo: `InvFisico`). */
    fechaInventarioTelas: z.date().nullable().optional(),
    /** Fecha del último inventario físico de PT (viejo: `InvFisicoPT`). */
    fechaInventarioPt: z.date().nullable().optional(),
    /** Almacén PT por defecto (viejo: `IPT_Almacen_Default`); debe ser tipo PT. */
    idAlmacenPtDefault: z.number().int().positive().nullable().optional(),
  })
  .refine((cambios) => Object.values(cambios).some((valor) => valor !== undefined), {
    message: 'No hay ningún cambio que guardar.',
  });

export type EntradaConfiguracionEmpresa = z.input<typeof esquemaConfiguracion>;

/**
 * Texto opcional del formulario → columna: `undefined` o `''` se guardan como NULL. Vaciar el campo
 * en la pantalla es la forma de BORRARLO, y guardar `''` dejaría una empresa «con régimen fiscal»
 * cuyo régimen es la cadena vacía — que a la hora de emitir el documento no se distingue de tenerlo.
 */
function vacioEsNulo(valor: string | undefined): string | null {
  return valor === undefined || valor === '' ? null : valor;
}

/** Busca la empresa o lanza `ErrorNoEncontrado`. */
async function exigirEmpresa(tx: Tx, id: number): Promise<Empresa> {
  const empresa = await tx.empresa.findUnique({ where: { id } });
  if (empresa === null) {
    throw new ErrorNoEncontrado('Empresa', id);
  }
  return empresa;
}

/** La favorita es ÚNICA: desmarcar cualquier otra dentro de la misma transacción. */
async function desmarcarOtrasFavoritas(tx: Tx, idExcepto: number): Promise<void> {
  await tx.empresa.updateMany({
    where: { favorita: true, id: { not: idExcepto } },
    data: { favorita: false },
  });
}

/**
 * Crea una empresa CON su registro de configuración vacío (1:1, en la misma
 * transacción): así `obtenerConfiguracion` siempre encuentra registro.
 *
 * Reglas: permiso `empresas.administrar`; nombre único → `ErrorConflicto`;
 * si nace favorita, desmarca la anterior (favorita única).
 */
export async function crearEmpresa(
  sesion: SesionUsuario,
  entrada: EntradaCrearEmpresa,
  bd?: ContextoBd,
): Promise<Empresa> {
  verificarPermiso(sesion, 'empresas.administrar');
  const datos = validarEntrada(esquemaCrearEmpresa, entrada);

  try {
    return await enTransaccion(async (tx) => {
      const existente = await tx.empresa.findFirst({
        where: { nombre: { equals: datos.nombre, mode: 'insensitive' } },
        select: { id: true },
      });
      if (existente !== null) {
        throw new ErrorConflicto(`Ya existe una empresa llamada "${datos.nombre}".`);
      }

      const empresa = await tx.empresa.create({
        data: {
          nombre: datos.nombre,
          razonSocial: datos.razonSocial ?? null,
          rfc: datos.rfc === undefined || datos.rfc === '' ? null : datos.rfc,
          regimenFiscalSat: vacioEsNulo(datos.regimenFiscalSat),
          codigoPostalFiscal: vacioEsNulo(datos.codigoPostalFiscal),
          identificador: datos.identificador ?? null,
          favorita: datos.favorita,
          paraIpt: datos.paraIpt,
          paraEdr: datos.paraEdr,
          configuracion: { create: { ...datosCreacion(sesion) } },
          ...datosCreacion(sesion),
        },
      });

      if (empresa.favorita) {
        await desmarcarOtrasFavoritas(tx, empresa.id);
      }

      await registrarBitacora(tx, sesion, {
        entidad: 'Empresa',
        idEntidad: empresa.id,
        accion: 'CREAR',
        datos: { nombre: empresa.nombre, favorita: empresa.favorita },
      });

      return empresa;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto(`Ya existe una empresa llamada "${datos.nombre}".`, {
        causa: error,
      });
    }
    throw error;
  }
}

/**
 * Actualiza los datos generales de una empresa. Marcar `favorita: true`
 * desmarca a la anterior (única); quitar la bandera deja al sistema sin
 * favorita (permitido: el login cae a elegir empresa).
 */
export async function actualizarEmpresa(
  sesion: SesionUsuario,
  id: number,
  cambios: EntradaActualizarEmpresa,
  bd?: ContextoBd,
): Promise<Empresa> {
  verificarPermiso(sesion, 'empresas.administrar');
  const datos = validarEntrada(esquemaActualizarEmpresa, cambios);

  try {
    return await enTransaccion(async (tx) => {
      const actual = await exigirEmpresa(tx, id);

      if (datos.nombre !== undefined && datos.nombre !== actual.nombre) {
        const repetido = await tx.empresa.findFirst({
          where: { nombre: { equals: datos.nombre, mode: 'insensitive' }, id: { not: id } },
          select: { id: true },
        });
        if (repetido !== null) {
          throw new ErrorConflicto(`Ya existe una empresa llamada "${datos.nombre}".`);
        }
      }

      const empresa = await tx.empresa.update({
        where: { id },
        data: {
          ...(datos.nombre === undefined ? {} : { nombre: datos.nombre }),
          ...(datos.razonSocial === undefined ? {} : { razonSocial: datos.razonSocial }),
          ...(datos.rfc === undefined ? {} : { rfc: datos.rfc === '' ? null : datos.rfc }),
          ...(datos.regimenFiscalSat === undefined
            ? {}
            : { regimenFiscalSat: vacioEsNulo(datos.regimenFiscalSat) }),
          ...(datos.codigoPostalFiscal === undefined
            ? {}
            : { codigoPostalFiscal: vacioEsNulo(datos.codigoPostalFiscal) }),
          ...(datos.identificador === undefined ? {} : { identificador: datos.identificador }),
          ...(datos.favorita === undefined ? {} : { favorita: datos.favorita }),
          ...(datos.paraIpt === undefined ? {} : { paraIpt: datos.paraIpt }),
          ...(datos.paraEdr === undefined ? {} : { paraEdr: datos.paraEdr }),
          ...datosModificacion(sesion),
        },
      });

      if (datos.favorita === true) {
        await desmarcarOtrasFavoritas(tx, id);
      }

      await registrarBitacora(tx, sesion, {
        entidad: 'Empresa',
        idEntidad: id,
        accion: 'MODIFICAR',
        datos: Object.fromEntries(Object.entries(datos).filter(([, valor]) => valor !== undefined)),
      });

      return empresa;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto('Ya existe una empresa con ese nombre.', { causa: error });
    }
    throw error;
  }
}

/**
 * Desactiva una empresa (borrado suave). No se puede desactivar la FAVORITA
 * (primero marca otra como favorita) ni la empresa activa de tu propia
 * sesión.
 */
export async function desactivarEmpresa(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<Empresa> {
  verificarPermiso(sesion, 'empresas.administrar');

  return enTransaccion(async (tx) => {
    const actual = await exigirEmpresa(tx, id);
    if (!actual.activa) {
      throw new ErrorConflicto(`La empresa "${actual.nombre}" ya está desactivada.`);
    }
    if (actual.favorita) {
      throw new ErrorValidacion(
        `"${actual.nombre}" es la empresa favorita; marca otra como favorita antes de desactivarla.`,
      );
    }
    if (id === sesion.idEmpresaActiva) {
      throw new ErrorValidacion('No puedes desactivar la empresa activa de tu sesión.');
    }

    const empresa = await tx.empresa.update({
      where: { id },
      data: { activa: false, ...datosModificacion(sesion) },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'Empresa',
      idEntidad: id,
      accion: 'DESACTIVAR',
      datos: { nombre: empresa.nombre },
    });

    return empresa;
  }, bd);
}

/** Reactiva una empresa desactivada. */
export async function reactivarEmpresa(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<Empresa> {
  verificarPermiso(sesion, 'empresas.administrar');

  return enTransaccion(async (tx) => {
    const actual = await exigirEmpresa(tx, id);
    if (actual.activa) {
      throw new ErrorConflicto(`La empresa "${actual.nombre}" ya está activa.`);
    }

    const empresa = await tx.empresa.update({
      where: { id },
      data: { activa: true, ...datosModificacion(sesion) },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'Empresa',
      idEntidad: id,
      accion: 'MODIFICAR',
      datos: { operacion: 'reactivar', nombre: empresa.nombre },
    });

    return empresa;
  }, bd);
}

/** Obtiene una empresa o lanza `ErrorNoEncontrado`. */
export async function obtenerEmpresa(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<Empresa> {
  verificarPermiso(sesion, 'empresas.administrar');
  const empresa = await clienteLectura(bd).empresa.findUnique({ where: { id } });
  if (empresa === null) {
    throw new ErrorNoEncontrado('Empresa', id);
  }
  return empresa;
}

/**
 * Lista TODAS las empresas (son pocas) ordenadas con la favorita primero.
 * Requiere `empresas.administrar`: es la vista de administración. (El
 * selector de empresa del header usa `listarEmpresasActivas`.)
 */
export async function listarEmpresas(sesion: SesionUsuario, bd?: ContextoBd): Promise<Empresa[]> {
  verificarPermiso(sesion, 'empresas.administrar');
  return clienteLectura(bd).empresa.findMany({
    orderBy: [{ favorita: 'desc' }, { nombre: 'asc' }],
  });
}

/**
 * Empresas ACTIVAS para el selector de empresa de la sesión (header del
 * frontend, A9). No exige permiso de administración: cualquier usuario
 * autenticado necesita ver los nombres de empresa para elegir la activa;
 * no expone configuración.
 */
export async function listarEmpresasActivas(
  bd?: ContextoBd,
): Promise<Pick<Empresa, 'id' | 'nombre' | 'favorita'>[]> {
  return clienteLectura(bd).empresa.findMany({
    where: { activa: true },
    select: { id: true, nombre: true, favorita: true },
    orderBy: [{ favorita: 'desc' }, { nombre: 'asc' }],
  });
}

/** Obtiene la configuración de una empresa (existe desde `crearEmpresa`/seed). */
export async function obtenerConfiguracion(
  sesion: SesionUsuario,
  idEmpresa: number,
  bd?: ContextoBd,
): Promise<ConfiguracionEmpresa> {
  verificarPermiso(sesion, 'empresas.administrar');
  const configuracion = await clienteLectura(bd).configuracionEmpresa.findUnique({
    where: { idEmpresa },
  });
  if (configuracion === null) {
    throw new ErrorNoEncontrado('ConfiguracionEmpresa', idEmpresa);
  }
  return configuracion;
}

/**
 * Actualiza la configuración de la empresa (upsert: si la empresa viene del
 * seed sin configuración, se crea). El almacén PT por defecto debe existir,
 * ser de la empresa (o global) y de tipo PT — `ErrorValidacion` si no.
 */
export async function actualizarConfiguracion(
  sesion: SesionUsuario,
  idEmpresa: number,
  cambios: EntradaConfiguracionEmpresa,
  bd?: ContextoBd,
): Promise<ConfiguracionEmpresa> {
  verificarPermiso(sesion, 'empresas.administrar');
  const datos = validarEntrada(esquemaConfiguracion, cambios);

  return enTransaccion(async (tx) => {
    await exigirEmpresa(tx, idEmpresa);

    // Aging (D15d): el 1er límite debe ser MENOR que el 2º. Como la edición es parcial, se valida el
    // par EFECTIVO (lo que llega ∪ lo ya guardado), no solo lo del cuerpo. Si el registro aún no
    // existe (empresa del seed sin configuración), los ausentes caen al default 30/60.
    if (datos.agingLimite1 !== undefined || datos.agingLimite2 !== undefined) {
      const actualCfg = await tx.configuracionEmpresa.findUnique({
        where: { idEmpresa },
        select: { agingLimite1: true, agingLimite2: true },
      });
      const l1 = datos.agingLimite1 ?? actualCfg?.agingLimite1 ?? 30;
      const l2 = datos.agingLimite2 ?? actualCfg?.agingLimite2 ?? 60;
      if (l1 >= l2) {
        throw new ErrorValidacion(
          'El primer límite de antigüedad debe ser menor que el segundo (p. ej. 30 y 60).',
        );
      }
    }

    if (datos.idAlmacenPtDefault !== undefined && datos.idAlmacenPtDefault !== null) {
      const almacen = await tx.almacen.findFirst({
        where: {
          id: datos.idAlmacenPtDefault,
          tipo: 'PT',
          activo: true,
          OR: [{ idEmpresa }, { idEmpresa: null }],
        },
        select: { id: true },
      });
      if (almacen === null) {
        throw new ErrorValidacion(
          'El almacén PT por defecto debe ser un almacén ACTIVO de tipo PT de esta empresa.',
        );
      }
    }

    const cambiosPrisma = {
      ...(datos.utilidadSugerida === undefined ? {} : { utilidadSugerida: datos.utilidadSugerida }),
      ...(datos.regaliasBase === undefined ? {} : { regaliasBase: datos.regaliasBase }),
      ...(datos.colchonCostura === undefined ? {} : { colchonCostura: datos.colchonCostura }),
      ...(datos.agingLimite1 === undefined ? {} : { agingLimite1: datos.agingLimite1 }),
      ...(datos.agingLimite2 === undefined ? {} : { agingLimite2: datos.agingLimite2 }),
      ...(datos.pctDesvioCompra === undefined ? {} : { pctDesvioCompra: datos.pctDesvioCompra }),
      ...(datos.costoEmpaqueBase === undefined ? {} : { costoEmpaqueBase: datos.costoEmpaqueBase }),
      ...(datos.fechaInventarioTelas === undefined
        ? {}
        : { fechaInventarioTelas: datos.fechaInventarioTelas }),
      ...(datos.fechaInventarioPt === undefined
        ? {}
        : { fechaInventarioPt: datos.fechaInventarioPt }),
      ...(datos.idAlmacenPtDefault === undefined
        ? {}
        : { idAlmacenPtDefault: datos.idAlmacenPtDefault }),
    };

    const configuracion = await tx.configuracionEmpresa.upsert({
      where: { idEmpresa },
      create: { idEmpresa, ...cambiosPrisma, ...datosCreacion(sesion) },
      update: { ...cambiosPrisma, ...datosModificacion(sesion) },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'ConfiguracionEmpresa',
      idEntidad: idEmpresa,
      accion: 'MODIFICAR',
      datos: Object.fromEntries(
        Object.entries(datos)
          .filter(([, valor]) => valor !== undefined)
          .map(([campo, valor]) => [campo, valor instanceof Date ? valor.toISOString() : valor]),
      ),
    });

    return configuracion;
  }, bd);
}

// ─────────────────────────────────────────────────────────────────────────────
// LOGO de la empresa (post-F9, petición de Daniel del 25-jul-2026)
//
// "Hay que brandear todos los formatos de impresión con el logo de la empresa así
// como el sistema… ponerlo en algún lado donde podamos actualizar el logo y que se
// actualice de manera automática": ese "algún lado" es ESTO. Un solo archivo en R2
// por empresa (`Empresa.idArchivoLogo`) que alimenta los 23 impresos PDF (vía
// `comun/impresos-estilos.ts` → `EncabezadoDocumento`) y la app (riel + login).
// Cambiarlo aquí actualiza TODO sin desplegar; si no hay, se usa el empaquetado.
//
// Calca el flujo presigned de la foto de bordado (F1-E3): POST de metadatos → el
// backend crea el `Archivo` y liga la FK → el navegador hace PUT directo a R2.
// Cada operación tira la caché en memoria del logo para que el cambio se vea ya.
// ─────────────────────────────────────────────────────────────────────────────

/** Carpeta lógica de los logos dentro del bucket. */
const CARPETA_LOGOS = 'empresas/logos';

/** Resultado de preparar la subida del logo (registro + URL PUT prefirmada). */
export interface SubidaLogoEmpresa {
  idArchivo: string;
  nombreOriginal: string;
  urlSubida: string;
  expiraEnSegundos: number;
}

/** Logo de una empresa con su URL de descarga prefirmada (todo `null` si no tiene). */
export interface LogoEmpresaConUrl {
  idArchivo: string | null;
  nombreOriginal: string | null;
  tipoMime: string | null;
  tamanoBytes: number | null;
  urlDescarga: string | null;
}

/** Datos que manda el navegador para preparar la subida del logo. */
export interface EntradaSubidaLogo {
  nombreOriginal: string;
  tipoMime: string;
  tamanoBytes: number;
}

/**
 * Validación del logo. Más ESTRECHA que la de una foto cualquiera, y a propósito:
 *  • Solo PNG/JPEG — `@react-pdf/renderer` no sabe incrustar SVG ni WEBP por `<Image src>`, y un
 *    logo que no se puede imprimir no sirve para lo que Daniel pidió.
 *  • Tope de 5 MB — es un membrete: los bytes viajan dentro de CADA PDF (data-URL) y se cachean en
 *    memoria del servidor; un archivo enorme inflaría todos los impresos.
 * El servidor es la autoridad: el navegador valida lo mismo, pero solo por UX.
 */
const esquemaSubidaLogo = z.object({
  nombreOriginal: z
    .string({ error: 'El nombre del archivo es obligatorio' })
    .trim()
    .min(1, 'El nombre del archivo es obligatorio.')
    .max(255),
  tipoMime: z
    .string({ error: 'El tipo de archivo es obligatorio' })
    .trim()
    .toLowerCase()
    .refine(
      (valor) => (MIME_LOGO_PERMITIDOS as readonly string[]).includes(valor),
      'El logo debe ser una imagen PNG o JPG (son los formatos que se pueden imprimir en los PDF).',
    ),
  tamanoBytes: z
    .number({ error: 'El tamaño es obligatorio' })
    .int('El tamaño debe ser un entero de bytes.')
    .positive('El archivo está vacío.')
    .max(TAMANO_MAXIMO_LOGO_BYTES, 'El logo no puede pesar más de 5 MB.'),
});

/**
 * PASO 1 de la subida del LOGO: crea el registro `Archivo` (carpeta `empresas/logos/<id>`, key
 * ordenada por id — A5) y devuelve la URL PUT prefirmada para que el navegador suba DIRECTO a R2.
 * Exige `empresas.administrar`.
 *
 * **NO toca el logo vigente**: ni lo desliga ni lo borra. Eso pasa en {@link confirmarLogo}, cuando
 * el PUT ya salió bien. Es a propósito y se apartó del patrón de la foto de bordado (que sí
 * reemplaza en la solicitud) porque el logo NO es un adjunto más: si el PUT falla o el usuario
 * cierra la pestaña a media subida, con el patrón viejo el logo bueno ya estaba borrado y la
 * empresa quedaba apuntando a un objeto inexistente — es decir, la marca del sistema entero rota,
 * y encima con un viaje fallido a R2 en CADA impreso (los fallos no se cachean, a propósito).
 * Con el orden nuevo, una subida a medias no cambia nada: el logo anterior sigue en su lugar.
 *
 * El precio es un `Archivo` (y su objeto en R2) huérfano si nadie confirma — el mismo trade-off ya
 * aceptado en el repo para las subidas presigned, y muchísimo más barato que perder la marca.
 */
export async function solicitarSubidaLogo(
  sesion: SesionUsuario,
  idEmpresa: number,
  entrada: EntradaSubidaLogo,
  bd?: ContextoBd,
  archivos: ServicioArchivos = servicioArchivos(),
): Promise<SubidaLogoEmpresa> {
  verificarPermiso(sesion, 'empresas.administrar');
  const datos = validarEntrada(esquemaSubidaLogo, entrada);

  return enTransaccion(async (tx) => {
    await exigirEmpresa(tx, idEmpresa);

    const preparada = await archivos.solicitarSubida(tx, sesion, {
      nombreOriginal: datos.nombreOriginal,
      tipoMime: datos.tipoMime,
      tamanoBytes: datos.tamanoBytes,
      carpeta: `${CARPETA_LOGOS}/${String(idEmpresa)}`,
    });

    return {
      idArchivo: preparada.archivo.id,
      nombreOriginal: datos.nombreOriginal,
      urlSubida: preparada.urlSubida,
      expiraEnSegundos: preparada.expiraEnSegundos,
    };
  }, bd);
}

/**
 * Rechaza los PNG que el generador de PDFs pinta MAL (16 bits por canal, o paleta con
 * transparencia). Es la ÚNICA oportunidad de mirar los bytes: la subida va DIRECTA del navegador a
 * R2 con una URL prefirmada, así que el servidor no los ve hasta que le confirman la key.
 *
 * ⚠️ Se ejecuta **FUERA de la transacción** (ver {@link confirmarLogo}): baja hasta 5 MB de R2, y
 * una transacción interactiva de Prisma tiene timeout (un round-trip lento la reventaría con
 * `P2028` → 500 opaco) además de retener una conexión del pool durante toda la espera.
 *
 * Se aplica solo a los PNG (los JPG no tienen el problema). Si R2 no responde NO se bloquea la
 * confirmación: el logo se acepta —perder la marca por un bache de red sería peor que un logo con
 * el color corrido— y queda el aviso en el log. El veredicto lo da la función pura
 * `problemaPngParaPdf` (`comun/png.ts`), probada aparte.
 */
async function exigirPngImprimible(
  archivo: { key: string; tipoMime: string | null },
  archivos: ServicioArchivos | undefined,
): Promise<void> {
  if (archivo.tipoMime?.toLowerCase() !== 'image/png') return;

  let bytes: Buffer;
  try {
    // El servicio se resuelve AQUÍ (no como default del parámetro): construirlo exige la config de
    // R2 y no tiene por qué pedirse cuando el logo es un JPG.
    bytes = await (archivos ?? servicioArchivos()).descargarContenido(
      archivo.key,
      TAMANO_MAXIMO_LOGO_BYTES,
    );
  } catch (error) {
    console.warn(
      `No se pudo leer el logo recién subido (${archivo.key}) para validar su PNG; se acepta sin revisar.`,
      error,
    );
    return;
  }

  const problema = problemaPngParaPdf(bytes);
  if (problema !== null) {
    throw new ErrorValidacion(problema);
  }
}

/**
 * Lectura previa (SIN transacción) para inspeccionar el PNG antes de confirmarlo. Se salta en los
 * casos que la transacción va a resolver igual (ya vigente = idempotente; archivo inexistente;
 * archivo de otra entidad): no tiene caso bajar bytes para eso.
 */
async function inspeccionarLogoAntesDeConfirmar(
  cliente: ReturnType<typeof clienteLectura>,
  idEmpresa: number,
  idArchivo: string,
  archivos: ServicioArchivos | undefined,
): Promise<void> {
  const empresa = await cliente.empresa.findUnique({
    where: { id: idEmpresa },
    select: { idArchivoLogo: true },
  });
  if (empresa === null || empresa.idArchivoLogo === idArchivo) return;

  const archivo = await cliente.archivo.findUnique({
    where: { id: idArchivo },
    select: { key: true, tipoMime: true },
  });
  if (archivo === null) return;
  if (!archivo.key.startsWith(`${CARPETA_LOGOS}/${String(idEmpresa)}/`)) return;

  await exigirPngImprimible(archivo, archivos);
}

/**
 * PASO 2 de la subida del LOGO: con el objeto YA en R2, liga el `Archivo` a la empresa y borra el
 * logo anterior, todo en UNA transacción (A2). Solo aquí cambia la marca del sistema, así que una
 * subida que no llegó a terminar NUNCA deja a la empresa sin logo. Exige `empresas.administrar`.
 *
 * Es IDEMPOTENTE: confirmar dos veces el mismo archivo no hace nada la segunda. El archivo debe
 * existir y haber nacido de {@link solicitarSubidaLogo} para ESTA empresa (se comprueba por el
 * prefijo de su key), para que no se pueda apropiar el adjunto de otra entidad.
 *
 * Al terminar invalida la caché en memoria del logo: el siguiente impreso y la siguiente carga de
 * la app ya salen con el logo nuevo.
 *
 * La INSPECCIÓN del PNG va ANTES de abrir la transacción (baja el objeto de R2; ver
 * {@link exigirPngImprimible}). Lo que valida afuera se vuelve a validar adentro —existencia del
 * archivo y pertenencia por prefijo de key—, así que la comprobación previa nunca es la autoridad:
 * solo evita bajar bytes de un archivo que la transacción va a rechazar igual.
 */
export async function confirmarLogo(
  sesion: SesionUsuario,
  idEmpresa: number,
  idArchivo: string,
  bd?: ContextoBd,
  archivos?: ServicioArchivos,
): Promise<void> {
  verificarPermiso(sesion, 'empresas.administrar');

  await inspeccionarLogoAntesDeConfirmar(clienteLectura(bd), idEmpresa, idArchivo, archivos);

  // Key del logo ANTERIOR, si la transacción llegó a borrarlo (0.081a): su objeto se borra de R2
  // tras el commit. `null` cuando no había logo previo o cuando la confirmación fue idempotente.
  const keyR2Anterior = await enTransaccion(async (tx) => {
    const actual = await exigirEmpresa(tx, idEmpresa);
    if (actual.idArchivoLogo === idArchivo) {
      return null; // ya confirmado: idempotente
    }

    const archivo = await tx.archivo.findUnique({
      where: { id: idArchivo },
      select: { id: true, key: true, nombreOriginal: true, tipoMime: true },
    });
    if (archivo === null) {
      throw new ErrorNoEncontrado('Archivo del logo', idArchivo);
    }
    if (!archivo.key.startsWith(`${CARPETA_LOGOS}/${String(idEmpresa)}/`)) {
      throw new ErrorValidacion('Ese archivo no es un logo de esta empresa.');
    }

    await tx.empresa.update({
      where: { id: idEmpresa },
      data: { idArchivoLogo: idArchivo, ...datosModificacion(sesion) },
    });

    // El logo anterior queda huérfano: se borra en la MISMA transacción (la FK ya apunta al nuevo,
    // así que el SetNull del borrado no toca al nuevo). Su OBJETO de R2 se borra tras el commit.
    let keyAnterior: string | null = null;
    if (actual.idArchivoLogo !== null) {
      const previo = await tx.archivo.findUnique({
        where: { id: actual.idArchivoLogo },
        select: { key: true },
      });
      const borrados = await tx.archivo.deleteMany({ where: { id: actual.idArchivoLogo } });
      // Solo si ESTA transacción lo borró de verdad: si otra confirmación en paralelo se le
      // adelantó, `count` es 0 y el objeto es del logo que el otro camino ya está manejando.
      if (borrados.count > 0) {
        keyAnterior = previo?.key ?? null;
      }
    }

    await registrarBitacora(tx, sesion, {
      entidad: 'Empresa',
      idEntidad: idEmpresa,
      accion: 'MODIFICAR',
      datos: {
        logo: actual.idArchivoLogo === null ? 'agregar' : 'reemplazar',
        archivo: archivo.nombreOriginal,
      },
    });

    return keyAnterior;
  }, bd);

  await eliminarObjetosBestEffort(
    archivos,
    keyR2Anterior === null ? [] : [keyR2Anterior],
    `el logo anterior de la empresa ${String(idEmpresa)}`,
  );

  invalidarLogoEmpresa(idEmpresa);
}

/**
 * Quita el LOGO de la empresa en UNA transacción (A2): borra el `Archivo` (el `onDelete SetNull` de
 * la FK deja `idArchivoLogo` en null, sin huérfanos) y deja constancia en la bitácora. TRAS el
 * commit borra el OBJETO físico de R2 en modo BEST-EFFORT (0.081a). A partir de ahí, impresos y app
 * vuelven al logo EMPAQUETADO del repo. Requiere `empresas.administrar`; si la empresa no tiene
 * logo → `ErrorConflicto` (la pantalla estaba desactualizada).
 *
 * ⚠️ Llamar SIEMPRE a NIVEL SUPERIOR (sin pasar un `bd.tx` ya abierto): el borrado físico corre
 * DESPUÉS del commit — ver {@link eliminarObjetosBestEffort}.
 */
export async function quitarLogo(
  sesion: SesionUsuario,
  idEmpresa: number,
  bd?: ContextoBd,
  archivos?: ServicioArchivos,
): Promise<void> {
  verificarPermiso(sesion, 'empresas.administrar');

  const keyR2 = await enTransaccion(async (tx) => {
    const actual = await exigirEmpresa(tx, idEmpresa);
    if (actual.idArchivoLogo === null) {
      throw new ErrorConflicto(`La empresa "${actual.nombre}" no tiene logo.`);
    }

    // La key del objeto R2 se lee ANTES del borrado: después la fila ya no está.
    const previo = await tx.archivo.findUnique({
      where: { id: actual.idArchivoLogo },
      select: { key: true },
    });

    // `deleteMany` (no `delete`): con dos peticiones de "quitar" en paralelo, ambas leen el mismo
    // `idArchivoLogo` y la segunda encontraría la fila ya borrada. `delete` lanzaría P2025 → 500;
    // `deleteMany` devuelve 0 y aquí se traduce al 409 que corresponde ("ya no tenía logo").
    const borrados = await tx.archivo.deleteMany({ where: { id: actual.idArchivoLogo } });
    if (borrados.count === 0) {
      throw new ErrorConflicto(`La empresa "${actual.nombre}" no tiene logo.`);
    }
    await tx.empresa.update({ where: { id: idEmpresa }, data: { ...datosModificacion(sesion) } });

    await registrarBitacora(tx, sesion, {
      entidad: 'Empresa',
      idEntidad: idEmpresa,
      accion: 'MODIFICAR',
      datos: { logo: 'quitar' },
    });

    return previo?.key ?? null;
  }, bd);

  await eliminarObjetosBestEffort(
    archivos,
    keyR2 === null ? [] : [keyR2],
    `el logo de la empresa ${String(idEmpresa)}`,
  );

  invalidarLogoEmpresa(idEmpresa);
}

/**
 * Devuelve el LOGO de la empresa con su URL GET prefirmada (o todo en `null` si no tiene). Lo usa
 * la pantalla de Administración › Empresas para la vista previa.
 *
 * Su ruta exige `empresas.administrar`: entrega una URL PREFIRMADA de R2 de CUALQUIER empresa por
 * id, y eso es acceso al almacenamiento, no marca. La marca que necesita toda la app (el riel, el
 * login) se sirve aparte por `imagenLogoEmpresa` / `GET /api/empresas/logo`, que solo devuelve los
 * bytes de la imagen de la empresa de la sesión, así que restringir esto no deja a nadie sin logo.
 *
 * La `sesion` no se usa aquí (el guard de la ruta ya autorizó); se recibe para mantener la firma
 * uniforme del resto del módulo.
 */
export async function logoEmpresa(
  _sesion: SesionUsuario,
  idEmpresa: number,
  bd?: ContextoBd,
  archivos: ServicioArchivos = servicioArchivos(),
): Promise<LogoEmpresaConUrl> {
  const empresa = await clienteLectura(bd).empresa.findUnique({
    where: { id: idEmpresa },
    select: {
      id: true,
      archivoLogo: {
        select: { id: true, key: true, nombreOriginal: true, tipoMime: true, tamanoBytes: true },
      },
    },
  });
  if (empresa === null) {
    throw new ErrorNoEncontrado('Empresa', idEmpresa);
  }

  const logo = empresa.archivoLogo;
  if (logo === null) {
    return {
      idArchivo: null,
      nombreOriginal: null,
      tipoMime: null,
      tamanoBytes: null,
      urlDescarga: null,
    };
  }

  return {
    idArchivo: logo.id,
    nombreOriginal: logo.nombreOriginal,
    tipoMime: logo.tipoMime,
    tamanoBytes: logo.tamanoBytes,
    urlDescarga: await archivos.urlDescarga(logo.key),
  };
}

/**
 * IMAGEN del logo, lista para servirla por HTTP: los bytes del logo subido o, si no hay (o R2
 * falla), los del PNG empaquetado. **Nunca falla** — es el mismo resolutor que usan los impresos
 * (`comun/logo-empresa.ts`), con su caché en memoria.
 *
 * `sesion === null` (petición SIN autenticar, que es el caso de la pantalla de login) devuelve el
 * logo de la empresa PREDETERMINADA. Es deliberado: un logo es marca PÚBLICA —va impreso en los
 * documentos que se mandan a clientes y proveedores— y sin esto el login sería el único rincón del
 * sistema que no se actualizaría al cambiar el logo, justo lo contrario de lo que se pidió. No se
 * expone nada más: solo los bytes de una imagen (ni nombre de empresa, ni ids, ni URLs de R2).
 *
 * Con sesión, el logo es el de la EMPRESA ACTIVA (A9): quien opera la empresa B ve la marca de B.
 */
export async function imagenLogoEmpresa(sesion: SesionUsuario | null): Promise<LogoResuelto> {
  return obtenerLogoEmpresa(sesion?.idEmpresaActiva);
}
