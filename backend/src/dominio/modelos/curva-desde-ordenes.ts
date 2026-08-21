/**
 * ⭐ **JALAR LA CURVA DE LA OP CUANDO EL MODELO NO TIENE** (V1-E3r, §Post-F9.81, punto 3 de
 * Daniel): *"Si el modelo **no tiene curva** y ya tiene una OP, **que jale la curva de la OP**.
 * Está perfecto."*
 *
 * El hueco se llena con el dato que YA existe, en vez de mandar a capturar a mano algo que el
 * sistema puede deducir. Pero **se PROPONE y la persona confirma — nunca se aplica sola**, y eso no
 * es timidez:
 *
 *  • Asignar la curva **ESCRIBE EN EL CATÁLOGO** (`Modelo.idCurvaTalla`, y a veces una `CurvaTalla`
 *    nueva) y lo hereda todo lo posterior — el precosteo (D13), las medidas por talla del BOM (R18),
 *    la propuesta de matriz de la siguiente OP. Un dato que se escribe solo y del que cuelga todo lo
 *    demás es exactamente lo que D3 prohíbe hacer en silencio.
 *  • Es el patrón que Daniel ya aprobó para el número de producción: se propone, se ve, se confirma.
 *
 * ⚠️ **Si varias OP usan curvas distintas se enseñan TODAS**, con cuántas OP usa cada una y sus
 * folios, y la persona elige. Una regla de desempate inventada ("la más reciente", "la más usada")
 * fallaría en silencio justo en el caso en que importa — que es, literalmente, el caso que Daniel
 * describió: un modelo dado de alta desde una OC de bebés y una receta capturada con tallas de
 * caballero.
 *
 * 🔴 **La puerta SÓLO LLENA HUECOS.** Rechaza si el modelo YA tiene curva (para eso está la edición
 * de la ficha, que deja constancia de que alguien la cambió a propósito), y el conjunto confirmado
 * tiene que ser **uno de los propuestos**: aceptar ids arbitrarios convertiría esta puerta en un
 * "asígnale al modelo las tallas que yo diga" sin más control que el nombre del endpoint.
 */
import { datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorValidacion } from '../../comun/errores.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { enTransaccion, clienteLectura, type ContextoBd } from '../../comun/transaccion.js';

import {
  avisoCurvaDistinta,
  curvaQueCubreExactamente,
  curvasDeLasOrdenesDelModelo,
  ladoDelModelo,
  ladoDeVariasOrdenes,
  nombreDeterministaCurva,
  type CurvaDeLasOrdenes,
} from '../catalogos/curvas-de-la-orden.js';
import { crearCurva } from '../catalogos/tallas-curvas.js';

import { exigirModelo } from './modelos.js';

/** Lo que la pantalla necesita para ofrecer (o no ofrecer) el jalón de la curva. */
export interface CurvasSugeridas {
  idModelo: number;
  /** `true` si el modelo YA tiene curva: entonces no hay hueco que llenar y no se propone nada. */
  yaTieneCurva: boolean;
  /** Las curvas distintas que usan sus órdenes, de la más usada a la menos. Vacío = no hay de dónde. */
  sugerencias: CurvaDeLasOrdenes[];
}

/** Lo que devuelve la asignación: lo justo para que la pantalla se refresque y diga qué pasó. */
export interface CurvaAsignada {
  idModelo: number;
  idCurvaTalla: number;
  nombreCurva: string;
  etiquetas: string[];
  /** `true` si la curva se CREÓ en el catálogo; `false` si se reusó una que ya existía. */
  curvaCreada: boolean;
}

/**
 * Las curvas que las órdenes del modelo sugieren. Requiere `modelos.ver`.
 *
 * 🔴 `idEmpresaActiva` viaja al lector de órdenes (A9): el catálogo de tallas es global (ADR-0007),
 * pero las ÓRDENES no lo son y contarlas de otra empresa sería una fuga.
 */
export async function curvasSugeridasDelModelo(
  sesion: SesionUsuario,
  idModelo: number,
  bd?: ContextoBd,
): Promise<CurvasSugeridas> {
  verificarPermiso(sesion, 'modelos.ver');
  const cliente = clienteLectura(bd);
  const modelo = await exigirModelo(cliente, idModelo);
  if (modelo.idCurvaTalla !== null) {
    return { idModelo, yaTieneCurva: true, sugerencias: [] };
  }
  return {
    idModelo,
    yaTieneCurva: false,
    sugerencias: await curvasDeLasOrdenesDelModelo(cliente, idModelo, sesion.idEmpresaActiva),
  };
}

/**
 * Un nombre de curva LIBRE a partir del determinista. `crearCurva` exige nombre único global y
 * rechaza con `ErrorConflicto` si choca; como aquí el nombre lo propone el sistema (la persona sólo
 * confirmó un conjunto de tallas), un choque no es culpa suya y no debe salirle en la cara: se
 * desambigua. El tope evita un bucle si algo va muy mal.
 */
async function nombreLibreDeCurva(
  tx: Parameters<typeof curvaQueCubreExactamente>[0],
  base: string,
): Promise<string> {
  for (let intento = 1; intento <= 20; intento += 1) {
    const candidato = intento === 1 ? base : `${base} (${String(intento)})`;
    const chocado = await tx.curvaTalla.findFirst({
      where: { nombre: { equals: candidato, mode: 'insensitive' } },
      select: { id: true },
    });
    if (chocado === null) {
      return candidato;
    }
  }
  throw new ErrorConflicto(
    `Ya existe una curva llamada "${base}" (y sus variantes). Dale un nombre desde Catálogos › Curvas.`,
  );
}

/**
 * Asigna al modelo la curva que usan sus órdenes, DESPUÉS de que una persona la confirmó. Requiere
 * `modelos.administrar` (y `tallas.administrar` si hay que crear la curva: lo verifica `crearCurva`,
 * su módulo dueño). Todo en UNA transacción (A2), con auditoría y bitácora (A7).
 *
 * 🔴 **El catálogo NO se escribe en crudo desde aquí.** La curva la crea `crearCurva`, que es su
 * módulo dueño y el único lugar donde viven sus cinco reglas —tallas activas, nombre único, las
 * `posicion` 0-based por el orden del arreglo, el `creadoPorId` de cada item y el permiso—.
 * Reimplementarlas con un `curvaTalla.create` suelto es cómo se pierden las cinco a la vez.
 *
 * @throws {ErrorConflicto} si el modelo YA tiene curva (esta puerta sólo llena huecos).
 * @throws {ErrorValidacion} si el conjunto confirmado no es uno de los propuestos.
 */
export async function asignarCurvaDesdeOrdenes(
  sesion: SesionUsuario,
  idModelo: number,
  idsTallaConfirmados: number[],
  bd?: ContextoBd,
): Promise<CurvaAsignada> {
  verificarPermiso(sesion, 'modelos.administrar');

  return enTransaccion(async (tx) => {
    const modelo = await exigirModelo(tx, idModelo);
    if (modelo.idCurvaTalla !== null) {
      throw new ErrorConflicto(
        'Este modelo ya tiene curva de tallas asignada. Para cambiarla, edítala en su ficha ' +
          '(así queda constancia de que alguien la cambió a propósito).',
      );
    }

    // Se RE-CALCULA aquí dentro, con la empresa de la sesión (A9): entre que la pantalla propuso y
    // la persona confirmó pudo entrar otra OP, y sobre todo, la propuesta que llega del cliente no
    // es una autorización — sólo una elección entre las que el servidor ofrece.
    const sugerencias = await curvasDeLasOrdenesDelModelo(tx, idModelo, sesion.idEmpresaActiva);
    const confirmados = new Set(idsTallaConfirmados);
    const elegida = sugerencias.find(
      (s) =>
        s.idsTalla.length === confirmados.size &&
        s.idsTalla.every((idTalla) => confirmados.has(idTalla)),
    );
    if (elegida === undefined) {
      throw new ErrorValidacion(
        'Las tallas confirmadas no son ninguna de las que usan las órdenes de este modelo. ' +
          'Vuelve a abrir la propuesta: puede que las órdenes hayan cambiado.',
      );
    }

    // ¿Ya existe la curva en el catálogo? Se reusa: crear una gemela con otro nombre ensucia el
    // catálogo y parte en dos la misma idea.
    const existente = await curvaQueCubreExactamente(tx, elegida.idsTalla);
    let idCurvaTalla: number;
    let nombreCurva: string;
    if (existente !== null) {
      idCurvaTalla = existente.id;
      nombreCurva = existente.nombre;
    } else {
      const nombre = await nombreLibreDeCurva(tx, nombreDeterministaCurva(elegida.etiquetas));
      const creada = await crearCurva(sesion, { nombre, items: elegida.idsTalla }, { tx });
      idCurvaTalla = creada.id;
      nombreCurva = creada.nombre;
    }

    await tx.modelo.update({
      where: { id: idModelo },
      data: { idCurvaTalla, ...datosModificacion(sesion) },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'Modelo',
      idEntidad: idModelo,
      accion: 'MODIFICAR',
      datos: {
        operacion: 'curva-jalada-de-las-ordenes',
        idCurvaTalla: { de: null, a: idCurvaTalla },
        nombreCurva,
        etiquetas: elegida.etiquetas,
        ordenesQueLaUsan: elegida.ordenes,
        curvaCreada: existente === null,
      },
    });

    return {
      idModelo,
      idCurvaTalla,
      nombreCurva,
      etiquetas: elegida.etiquetas,
      curvaCreada: existente === null,
    };
  }, bd);
}

/**
 * ⭐ **EL AVISO DE CURVA DISTINTA, VISTO DESDE EL MODELO** (V1-E3r, §Post-F9.81 punto 2).
 *
 * Desde la receta de una OP la comparación es una contra una; desde el modelo hay que mirar TODAS
 * sus órdenes, porque el desajuste que Daniel encontró vive precisamente ahí: el modelo se dio de
 * alta desde una OC de bebés y la curva se capturó de caballero. Se devuelve **un aviso por cada
 * conjunto distinto** que usen sus órdenes y que no coincida con la curva — no uno solo con la
 * unión, que escondería cuál OP es cuál.
 *
 * 🔴 `idEmpresa` OBLIGATORIO y sin default (A9): las órdenes son por empresa aunque el catálogo de
 * tallas sea global (ADR-0007).
 *
 * Devuelve `[]` cuando el modelo no tiene curva: ahí no hay dos curvas que se contradigan, hay un
 * hueco — y el hueco lo atiende {@link curvasSugeridasDelModelo}, no un aviso.
 */
export async function avisosDeCurvaDelModelo(
  tx: Parameters<typeof curvasDeLasOrdenesDelModelo>[0],
  idModelo: number,
  idEmpresa: number,
): Promise<string[]> {
  const modelo = await tx.modelo.findUnique({
    where: { id: idModelo },
    select: {
      curvaTalla: {
        select: {
          nombre: true,
          items: {
            select: { talla: { select: { etiqueta: true } } },
            orderBy: [{ posicion: 'asc' }, { idTalla: 'asc' }],
          },
        },
      },
    },
  });
  const curva = modelo?.curvaTalla ?? null;
  if (curva === null) {
    return [];
  }

  const lado = ladoDelModelo(
    curva.nombre,
    curva.items.map((i) => i.talla.etiqueta),
  );
  const deLasOrdenes = await curvasDeLasOrdenesDelModelo(tx, idModelo, idEmpresa);
  return deLasOrdenes.flatMap((s) => {
    const aviso = avisoCurvaDistinta(lado, ladoDeVariasOrdenes(s.nombre, s.ordenes, s.etiquetas));
    return aviso === null ? [] : [aviso.texto];
  });
}
