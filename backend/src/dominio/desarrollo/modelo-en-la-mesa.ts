/**
 * ⭐⭐ V1-E8y (§Post-F9.152) — **COTIZAR EN LA CITA UN MODELO QUE NO EXISTE.**
 *
 * Daniel, textual:
 *
 * > *«a veces estando en la cita, me piden cotizar algún modelo que no tengamos en muestrario que
 * > llevamos. Y tengo que darles ahí un precio. Necesito armarlo desde cero estimando cosas. O bien
 * > podría copiar algún modelo de los que ya tenemos desarrollados y cambiarle cosas. Me puedes
 * > dejar espacio para meter nuevos modelos y hacerlos ahí con datos estimados.»*
 *
 * Éste es **el puente**: desde la mesa de negociación, en UNA transacción (A2), nacen —según haga
 * falta— el PROYECTO, el MODELO (desde cero o copiando otro), el DESARROLLO y su PRECOSTO BORRADOR,
 * listo para teclearle los estimados. Si algo falla, no queda nada a medias.
 *
 * ── LAS TRES COSAS QUE ESTA ETAPA MIDIÓ Y CORRIGEN AL PLAN ────────────────────────────────────
 *
 * 🔴 **1. `copiarBom` NO trae los costos, y por eso no se usa solo.** `maquilaBase`, `corteBase`,
 * `numOperaciones`, `composicion` y `idCurvaTalla` son columnas de **`Modelo`**, no del BOM — y
 * `generarPrecosto` toma la maquila y el corte **de ahí** (`precostos.ts`). Un modelo copiado sólo
 * con el BOM precostearía con **maquila $0 y corte $0, en silencio**, y de ese precosto sale el
 * precio que se le dice al cliente en la cara. Por eso la copia arrastra **la FICHA además de la
 * receta** ({@link fichaHeredadaDeModelo}, probada aparte con su mutación).
 *
 * 🔴 **2. Copiar NO es versionar.** `crearVersionDeModelo` (`modelos/versiones.ts`) sí arrastra los
 * costos —es el molde del que salió esta idea—, pero cuelga al hijo de la FAMILIA del padre:
 * `CYA-26-71-001` → `CYA-26-71-001-01`. Y ese código lleva dentro **la abreviatura del cliente del
 * padre**. Copiar un modelo de C&A para cotizárselo a Liverpool le pondría un código que dice
 * «C&A», y además lo dejaría `revisionEstado: 'pendiente'` (la firma de receta que aquella decisión
 * pide) y exigiría `modelos.aprobar-receta`, que es OTRO permiso. Aquí se **mintea un código nuevo
 * del cliente de la mesa** y se reusa sólo la pieza que sí aplica: `copiarRecetaAModeloNuevo`.
 *
 * 🔴 **3. «Copiar los trae todos, cero fricción» sólo es cierto si el ORIGEN los tiene.** Los ~4,987
 * modelos migrados de Access **no traen género** (`Modelos.csv` ni siquiera tiene la columna), así
 * que copiar uno de ésos no puede heredar los dos dígitos. No se inventa nada: se rechaza diciendo
 * exactamente qué falta y que se puede mandar a mano. Es la aplicación literal de la REGLA 0-B —
 * **tolerar el dato ausente sin rellenarlo**.
 *
 * ── QUÉ **NO** HACE, Y POR QUÉ ────────────────────────────────────────────────────────────────
 *
 * ⚠️ **No agrega el renglón a la lista.** Un renglón necesita un precosto **CONGELADO**
 * (`ListaPreciosLinea.idPrecosto` no es nullable) y congelar exige que algo que no sea el empaque
 * aporte importe (el candado de la 0.063). Un modelo recién nacido desde cero **todavía no cumple**:
 * primero se le teclean los estimados. Así que la mesa hace **dos actos visibles** —«créalo» y
 * «agrégalo» ({@link agregarLineasLista})— en vez de uno que a veces funciona y a veces no dice por
 * qué. Cuando se copia un modelo que sí trae costos, los dos actos son dos clics seguidos.
 *
 * ⚠️ **No toma el advisory lock de la lista.** Esta función NO escribe en `lista_precios` ni en sus
 * renglones: sólo LEE la lista para saber de qué cliente+departamento es la mesa. Si alguien la
 * cierra en el mismo instante, lo peor que pasa es que quede un modelo nuevo en su proyecto **sin
 * renglón**, que es un estado válido y visible (el desarrollo aparece en su proyecto), no una
 * incoherencia. Tomar el lock aquí sólo agregaría orden de bloqueo que defender.
 */
import {
  esquemaModeloNuevoEnLista,
  type DatosModeloNuevoEnLista,
  type ModeloNuevoEnListaSalida,
} from '../../contrato/esquemas/lista-precios.js';
import type { SecuenciaEstampado } from '../../datos/index.js';

import { aJsonBitacora, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { CODIGO_PRISMA, codigoErrorPrisma } from '../../comun/prisma-errores.js';
import { enTransaccion, type ContextoBd, type Tx } from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';
import { crearModelo, type EntradaCrearModelo } from '../modelos/modelos.js';
import { digitosDeNomenclatura, mintearCodigoDesarrollo } from '../modelos/nomenclatura.js';
import { copiarRecetaAModeloNuevo, type RecetaCopiada } from '../modelos/versiones.js';
import { generarPrecosto } from './precostos.js';
import { crearProyecto } from './proyectos.js';

/** Entrada tipada (forma del esquema compartido). */
export type EntradaModeloNuevoEnLista = DatosModeloNuevoEnLista;

/**
 * La FICHA de un modelo, tal como se lee del catálogo para copiarla. Números planos (no `Decimal`)
 * a propósito: así {@link fichaHeredadaDeModelo} es **pura** y se prueba sin base de datos.
 */
export interface FichaModeloOrigen {
  descripcion: string | null;
  composicion: string | null;
  maquilaBase: number | null;
  corteBase: number | null;
  numOperaciones: number | null;
  idTemporada: number | null;
  idCurvaTalla: number | null;
  idMaquileroCotizado: number | null;
  secuenciaEstampado: SecuenciaEstampado;
  llevaArte: boolean;
}

/**
 * ⭐⭐ **LOS CAMPOS DE FICHA QUE VIAJAN AL COPIAR UN MODELO** — y el motivo por el que esta función
 * existe en vez de un `copiarBom` a secas.
 *
 * 🔴 **`maquilaBase` y `corteBase` son la razón de ser de todo esto.** No están en el BOM: son
 * columnas de `Modelo`, y `generarPrecosto` las lee **de ahí** para armar los renglones ancla de
 * maquila y de corte. Copiar sólo la receta produce un modelo que precostea con **$0 de maquila y
 * $0 de corte sin decir nada** — y de ese precosto sale el precio que se le da al cliente. Si
 * alguna vez alguien quita una de esas dos líneas «porque el BOM ya lo trae», está reintroduciendo
 * ese defecto: no lo trae.
 *
 * Los demás viajan por la misma lógica de "el modelo copiado tiene que costear igual que el
 * original": `numOperaciones` alimenta la dificultad (y con ella el CPM), `composicion` es la
 * etiqueta de la prenda, `idCurvaTalla` decide las tallas que se costean por talla, la temporada y
 * el maquilero cotizado son la ficha comercial, y `secuenciaEstampado`/`llevaArte` describen cómo
 * se produce.
 *
 * ⚠️ **Los NULL se OMITEN, no se mandan como `null`.** `esquemaModeloCrear` declara estos campos
 * `.optional()` y **no** `.nullable()`: mandar `null` sería un 400 por contrato. Omitirlos deja que
 * el modelo nuevo tome el default de la columna, que es exactamente lo que significa "el original
 * tampoco lo tenía".
 *
 * PURA a propósito: la regresión de los costos se cementa sin base de datos.
 */
export function fichaHeredadaDeModelo(
  origen: FichaModeloOrigen,
): Omit<EntradaCrearModelo, 'codigo' | 'idGenero' | 'idTipoProducto'> {
  const ficha: Omit<EntradaCrearModelo, 'codigo' | 'idGenero' | 'idTipoProducto'> = {
    // Los dos NO opcionales de la ficha (tienen default en la columna, nunca son null).
    secuenciaEstampado: origen.secuenciaEstampado,
    llevaArte: origen.llevaArte,
  };
  if (origen.descripcion !== null) ficha.descripcion = origen.descripcion;
  if (origen.composicion !== null) ficha.composicion = origen.composicion;
  // 🔴 Los DOS que el BOM no trae y sin los que el precosto sale en cero. No quitar.
  if (origen.maquilaBase !== null) ficha.maquilaBase = origen.maquilaBase;
  if (origen.corteBase !== null) ficha.corteBase = origen.corteBase;
  if (origen.numOperaciones !== null) ficha.numOperaciones = origen.numOperaciones;
  if (origen.idTemporada !== null) ficha.idTemporada = origen.idTemporada;
  if (origen.idCurvaTalla !== null) ficha.idCurvaTalla = origen.idCurvaTalla;
  if (origen.idMaquileroCotizado !== null) {
    ficha.idMaquileroCotizado = origen.idMaquileroCotizado;
  }
  return ficha;
}

/** Lo que la mesa necesita saber de la lista para dar de alta un modelo dentro de ella. */
interface MesaAbierta {
  idCliente: number;
  idClienteDepartamento: number;
}

/**
 * La lista existe, es de la empresa activa (A9) y NO está cerrada. Se lee su cliente+departamento:
 * de ahí sale el proyecto donde va a vivir el desarrollo y el cliente cuya abreviatura arma el
 * código.
 *
 * Una lista CERRADA no admite modelos nuevos por la misma razón que no admite renglones: es un
 * compromiso con el cliente. Reabrirla es un acto auditado, y entonces se ve que alguien la reabrió
 * PARA meterle un modelo.
 */
async function exigirMesaAbierta(tx: Tx, idLista: number, idEmpresa: number): Promise<MesaAbierta> {
  const lista = await tx.listaPrecios.findFirst({
    where: { id: idLista, idEmpresa },
    select: {
      idCliente: true,
      idClienteDepartamento: true,
      estadoLista: { select: { esCierre: true } },
    },
  });
  if (lista === null) {
    throw new ErrorNoEncontrado('Lista de precios', idLista);
  }
  if (lista.estadoLista.esCierre) {
    throw new ErrorConflicto(
      'La lista está cerrada; reábrela (cambia su estado) para meterle modelos nuevos.',
    );
  }
  return {
    idCliente: lista.idCliente,
    idClienteDepartamento: lista.idClienteDepartamento,
  };
}

/** El proyecto donde queda el desarrollo (uno existente, o el que se acaba de crear). */
interface ProyectoDeLaMesa {
  id: number;
  folio: number;
  nombre: string;
  creado: boolean;
}

/**
 * Resuelve el PROYECTO: el que se eligió, o uno NUEVO creado en la misma transacción.
 *
 * ⚠️ El proyecto elegido tiene que ser del **mismo cliente+departamento de la lista**: si no, el
 * desarrollo nacería colgado de otro cliente y jamás podría entrar a esta lista (el candado de
 * `agregarLineasLista` lo rechazaría después, con el modelo ya creado). Se comprueba ANTES.
 *
 * ⚠️ Y el proyecto NUEVO se crea **aquí dentro**, no con una segunda llamada desde la pantalla: es
 * la lección de §Post-F9.34 —el frontend orquestaba dos altas sueltas y, si la segunda fallaba, la
 * primera quedaba—. `crearProyecto` valida cliente y departamento activos por su cuenta.
 */
async function resolverProyecto(
  tx: Tx,
  sesion: SesionUsuario,
  mesa: MesaAbierta,
  datos: DatosModeloNuevoEnLista,
): Promise<ProyectoDeLaMesa> {
  if (datos.idProyecto !== undefined) {
    const proyecto = await tx.proyecto.findFirst({
      where: {
        id: datos.idProyecto,
        idEmpresa: sesion.idEmpresaActiva,
        idCliente: mesa.idCliente,
        idClienteDepartamento: mesa.idClienteDepartamento,
      },
      select: { id: true, folio: true, nombre: true, archivado: true },
    });
    if (proyecto === null) {
      throw new ErrorValidacion(
        'El proyecto elegido no es del cliente y el departamento de esta lista (o no existe).',
      );
    }
    if (proyecto.archivado) {
      throw new ErrorConflicto(
        `El proyecto ${String(Number(proyecto.folio))} está archivado; desarchívalo o elige otro.`,
      );
    }
    return {
      id: proyecto.id,
      folio: Number(proyecto.folio),
      nombre: proyecto.nombre,
      creado: false,
    };
  }

  // El esquema garantiza que, sin `idProyecto`, viene el nombre del nuevo.
  const nombre = datos.nombreProyectoNuevo as string;
  const creado = await crearProyecto(
    sesion,
    {
      idCliente: mesa.idCliente,
      idClienteDepartamento: mesa.idClienteDepartamento,
      nombre,
    },
    { tx },
  );
  return { id: creado.id, folio: creado.folio, nombre: creado.nombre, creado: true };
}

/** El modelo que se copia, con su ficha y lo mínimo para nombrarlo en los errores. */
interface ModeloOrigen extends FichaModeloOrigen {
  id: number;
  codigo: string;
  idGenero: number | null;
  idTipoProducto: number | null;
}

/**
 * Lee el modelo que se va a COPIAR y hace cumplir sus dos condiciones.
 *
 * ⚠️ **Descontinuado no se copia**, igual que no se versiona (§Post-F9.119): reactivarlo tiene que
 * ser un acto que alguien decide, no el efecto lateral de copiarlo. Y cuesta un clic.
 */
async function leerModeloOrigen(tx: Tx, idModelo: number): Promise<ModeloOrigen> {
  const modelo = await tx.modelo.findUnique({
    where: { id: idModelo },
    select: {
      id: true,
      codigo: true,
      activo: true,
      descripcion: true,
      composicion: true,
      maquilaBase: true,
      corteBase: true,
      numOperaciones: true,
      idTemporada: true,
      idCurvaTalla: true,
      idGenero: true,
      idTipoProducto: true,
      idMaquileroCotizado: true,
      secuenciaEstampado: true,
      llevaArte: true,
    },
  });
  if (modelo === null) {
    throw new ErrorNoEncontrado('Modelo', idModelo);
  }
  if (!modelo.activo) {
    throw new ErrorConflicto(
      `El modelo "${modelo.codigo}" está descontinuado; reactívalo si lo vas a usar de base, o ` +
        `arma el modelo nuevo desde cero.`,
    );
  }
  return {
    id: modelo.id,
    codigo: modelo.codigo,
    descripcion: modelo.descripcion,
    composicion: modelo.composicion,
    // `Decimal` → número plano: la ficha heredada es pura y no conoce Prisma.
    maquilaBase: modelo.maquilaBase === null ? null : modelo.maquilaBase.toNumber(),
    corteBase: modelo.corteBase === null ? null : modelo.corteBase.toNumber(),
    numOperaciones: modelo.numOperaciones,
    idTemporada: modelo.idTemporada,
    idCurvaTalla: modelo.idCurvaTalla,
    idGenero: modelo.idGenero,
    idTipoProducto: modelo.idTipoProducto,
    idMaquileroCotizado: modelo.idMaquileroCotizado,
    secuenciaEstampado: modelo.secuenciaEstampado,
    llevaArte: modelo.llevaArte,
  };
}

/**
 * Los DOS DÍGITOS del modelo nuevo: lo que se mandó gana; si no se mandó, se hereda del copiado.
 *
 * ⚠️ Si no hay ni lo uno ni lo otro, se **rechaza nombrando el modelo** en vez de inventar un valor.
 * Es el caso REAL de los ~4,987 modelos migrados de Access, que no traen género: la REGLA 0-B dice
 * que el código tolere el dato ausente **sin rellenarlo**, y esto es exactamente eso.
 */
function resolverDosDigitos(
  datos: DatosModeloNuevoEnLista,
  origen: ModeloOrigen | null,
): { idTipoProducto: number; idGenero: number } {
  const idTipoProducto = datos.idTipoProducto ?? origen?.idTipoProducto ?? null;
  const idGenero = datos.idGenero ?? origen?.idGenero ?? null;
  if (idTipoProducto === null || idGenero === null) {
    const falta = idTipoProducto === null ? 'tipo de prenda' : 'género';
    throw new ErrorValidacion(
      origen === null
        ? `Falta el ${falta} del modelo nuevo.`
        : `El modelo "${origen.codigo}" no tiene ${falta} capturado, así que no se puede heredar. ` +
            `Elígelo aquí (o captúraselo a él en su ficha).`,
    );
  }
  return { idTipoProducto, idGenero };
}

/**
 * ⭐⭐ **DA DE ALTA UN MODELO DESDE LA MESA** — desde cero o copiando otro — con su desarrollo y su
 * precosto BORRADOR, todo en UNA transacción (A2).
 *
 * Exige los cinco permisos por adelantado (mutar implica leer; nada de 403 a mitad de camino): la mesa
 * (`listas.administrar`), el desarrollo (`desarrollo.administrar` + `desarrollo.ver`), el catálogo de
 * modelos (`modelos.administrar`) y el precosteo (`desarrollo.precostear`). Los cinco los tiene
 * Gerencial desde §Post-F9.123 — es decir, **Aurora también puede**, que es lo que Daniel pidió.
 */
export async function crearModeloEnLista(
  sesion: SesionUsuario,
  idLista: number,
  entrada: unknown,
  bd?: ContextoBd,
): Promise<ModeloNuevoEnListaSalida> {
  verificarPermiso(sesion, 'listas.administrar');
  verificarPermiso(sesion, 'desarrollo.administrar');
  verificarPermiso(sesion, 'modelos.administrar');
  verificarPermiso(sesion, 'desarrollo.precostear');
  // ⚠️ `desarrollo.ver` NO es un adorno: `crearProyecto` y `generarPrecosto` terminan proyectando su
  // salida con `obtenerProyecto`/`obtenerPrecosto`, que lo exigen. Sin comprobarlo aquí, a quien le
  // faltara le reventaría A MITAD de la transacción con un 403 que no explica nada (la escritura se
  // revierte, pero el mensaje llega tarde y en el lugar equivocado). Todo rol que administra
  // desarrollos lo tiene; se verifica igual, por delante, como manda «mutar implica leer».
  verificarPermiso(sesion, 'desarrollo.ver');
  const datos: DatosModeloNuevoEnLista = validarEntrada(esquemaModeloNuevoEnLista, entrada);

  return enTransaccion(async (tx) => {
    const mesa = await exigirMesaAbierta(tx, idLista, sesion.idEmpresaActiva);
    const proyecto = await resolverProyecto(tx, sesion, mesa, datos);

    const origen =
      datos.idModeloOrigen === undefined ? null : await leerModeloOrigen(tx, datos.idModeloOrigen);
    const { idTipoProducto, idGenero } = resolverDosDigitos(datos, origen);

    const digitos = await digitosDeNomenclatura(tx, idTipoProducto, idGenero);
    const { codigo } = await mintearCodigoDesarrollo(tx, {
      idCliente: mesa.idCliente,
      anioEntrega: datos.anioEntrega,
      ...digitos,
    });

    // La FICHA copiada primero, y ENCIMA lo que se mandó a mano: *"copiar un modelo y cambiarle
    // cosas"* es literalmente esto.
    const heredada = origen === null ? {} : fichaHeredadaDeModelo(origen);
    const modelo = await crearModeloCopiando(sesion, tx, origen, {
      ...heredada,
      codigo,
      idTipoProducto,
      idGenero,
      ...(datos.descripcion === undefined || datos.descripcion === ''
        ? {}
        : { descripcion: datos.descripcion }),
      ...(datos.idCurvaTalla === undefined ? {} : { idCurvaTalla: datos.idCurvaTalla }),
    });

    const receta: RecetaCopiada =
      origen === null
        ? { telas: 0, avios: 0, medidas: 0, artes: 0 }
        : await copiarRecetaAModeloNuevo(tx, sesion, origen.id, modelo.id);

    let idDesarrollo: number;
    try {
      const creado = await tx.desarrollo.create({
        data: {
          idProyecto: proyecto.id,
          idModelo: modelo.id,
          ...(datos.numeroCliente === undefined || datos.numeroCliente === ''
            ? {}
            : { numeroCliente: datos.numeroCliente }),
          creadoPorId: sesion.id,
          modificadoPorId: sesion.id,
        },
        select: { id: true },
      });
      idDesarrollo = creado.id;
    } catch (error) {
      if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
        // El modelo acaba de nacer, así que este choque es imposible salvo carrera exótica; se
        // traduce igual para no devolver un 500 opaco.
        throw new ErrorConflicto('Este proyecto ya tiene un desarrollo para ese modelo.', {
          causa: error,
        });
      }
      throw error;
    }

    await registrarBitacora(tx, sesion, {
      entidad: 'Desarrollo',
      idEntidad: idDesarrollo,
      accion: 'CREAR',
      datos: {
        operacion: 'modelo-nuevo-en-la-mesa',
        idLista,
        idProyecto: proyecto.id,
        proyectoCreado: proyecto.creado,
        idModelo: modelo.id,
        codigoDesarrollo: codigo,
        anioEntrega: datos.anioEntrega,
        copiadoDeIdModelo: origen?.id ?? null,
        copiadoDeCodigo: origen?.codigo ?? null,
        receta: aJsonBitacora(receta),
      },
    });

    // El precosto BORRADOR, en la misma transacción: el modelo nace listo para estimarle costos.
    // Si se copió, ya llega con la receta valuada + maquila + corte del original.
    const precosto = await generarPrecosto(sesion, idDesarrollo, { tx });

    return {
      idDesarrollo,
      idModelo: modelo.id,
      codigoModelo: modelo.codigo,
      descripcionModelo: modelo.descripcion,
      idProyecto: proyecto.id,
      folioProyecto: proyecto.folio,
      nombreProyecto: proyecto.nombre,
      proyectoCreado: proyecto.creado,
      idPrecosto: precosto.id,
      versionPrecosto: precosto.version,
      copiadoDeIdModelo: origen?.id ?? null,
      copiadoDeCodigo: origen?.codigo ?? null,
      receta,
    };
  }, bd);
}

/**
 * Llama a `crearModelo` y, cuando se está COPIANDO, le pone contexto al rechazo.
 *
 * ⚠️ Sin esto, copiar un modelo cuya temporada está desactivada devuelve *«La temporada "Otoño 25"
 * está desactivada y no se puede asignar»* — un mensaje correcto que, **en plena cita**, no dice de
 * dónde salió esa temporada (se heredó del modelo copiado) ni qué hacer. Se conserva el texto
 * original y se le añade el de dónde y el cómo seguir; el tipo de error no cambia.
 */
async function crearModeloCopiando(
  sesion: SesionUsuario,
  tx: Tx,
  origen: ModeloOrigen | null,
  datos: EntradaCrearModelo,
): Promise<{ id: number; codigo: string; descripcion: string | null }> {
  try {
    return await crearModelo(sesion, datos, { tx });
  } catch (error) {
    if (origen !== null && error instanceof ErrorValidacion) {
      throw new ErrorValidacion(
        `No se pudo copiar el modelo "${origen.codigo}": ${error.message} (ese dato se hereda de ` +
          `él). Reactívalo en su catálogo, o arma el modelo desde cero.`,
        { causa: error },
      );
    }
    throw error;
  }
}
