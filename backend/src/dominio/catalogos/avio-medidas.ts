/**
 * MEDIDAS de un avío "por medida" (rediseño R5, B11) — cierres, elástico… El avío se COSTEA con un
 * solo precio en el precosto (el PROMEDIO SIMPLE de los precios de las medidas ACTIVAS) pero se COMPRA
 * por medida, cada una con su precio real. Las medidas viven agrupadas DENTRO del avío padre (decisión
 * Daniel): NO son avíos independientes del catálogo.
 *
 * ⭐ **V1-E3g (§Post-F9.66) — la medida es un NÚMERO y la unidad vive en el avío.** Antes se capturaba
 * la etiqueta a mano y `"53 cm"`, `"53cm"` y `"53"` eran tres medidas distintas: la orden de compra
 * salía partida en tres. Ahora se captura `valor` (solo el número) + `Avio.unidadMedida` una sola vez,
 * y la ETIQUETA (`medida`) la DERIVA este dominio (`etiquetaMedida`). La etiqueta se conserva porque
 * sigue siendo lo que se muestra y la clave del `@@unique([idAvio, medida])`.
 *
 * Se administran como un SET completo desde la pantalla de Avíos (sección expandible "Medidas del
 * avío"), como los proveedores del avío: `reemplazarMedidasAvio` sincroniza (agrega/actualiza/desactiva)
 * en UNA transacción (A2). El borrado es SUAVE (`activo=false`): preserva el amarre medida×talla
 * (`ModeloAvioTalla.idAvioMedida`, SetNull) y el historial; re-agregar una medida la reactiva.
 *
 * El diff casa por **id** cuando el renglón lo trae (así se CORRIGE en su lugar una medida heredada,
 * que es justo lo que cambia de etiqueta al normalizarse) y, si no, por la etiqueta derivada.
 *
 * ⚠️ Los `avisos` que devuelve **NO bloquean** (decisión de Daniel: *avisa, no bloquea*): medidas
 * pendientes de revisión manual (D3 — la migración no adivinó), unidad faltante, o números absurdos
 * para la unidad del avío. Toda la lógica AQUÍ (A1).
 */
import { esquemaAvioMedidasCuerpo, type DatosAvioMedidas } from '../../contrato/index.js';
import type { Prisma } from '../../datos/index.js';

import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';
import { num, redondear2 } from '../costos/decimales.js';

import { avisoValorFueraDeRango, etiquetaMedida, normalizarUnidad } from './unidades-avio.js';

/** Una medida del avío tal como la devuelve la API. */
export interface MedidaAvioSalida {
  id: number;
  medida: string;
  valor: number | null;
  requiereRevision: boolean;
  precio: number;
  orden: number;
  activo: boolean;
}

/** Las medidas de un avío + el promedio (activas) que usa el precosto + los avisos que no bloquean. */
export interface MedidasDeAvio {
  datos: MedidaAvioSalida[];
  unidadMedida: string | null;
  promedioPreCosto: number | null;
  avisos: string[];
}

/** Forma mínima de una fila de `AvioMedida` para proyectarla (evita atarse al `select`). */
interface FilaMedida {
  id: number;
  medida: string;
  valor: { toNumber(): number } | null;
  requiereRevision: boolean;
  precio: { toNumber(): number };
  orden: number;
  activo: boolean;
}

/** Exige que el avío exista y devuelve su unidad de medidas (o lanza `ErrorNoEncontrado`). */
async function exigirAvio(tx: Tx, idAvio: number): Promise<{ unidadMedida: string | null }> {
  const avio = await tx.avio.findUnique({
    where: { id: idAvio },
    select: { id: true, unidadMedida: true },
  });
  if (avio === null) {
    throw new ErrorNoEncontrado('Avio', idAvio);
  }
  return { unidadMedida: avio.unidadMedida };
}

/**
 * Proyecta las medidas (ordenadas) + el promedio de las ACTIVAS (el que usa el precosto) + los
 * AVISOS que no bloquean. Los avisos sólo miran las medidas ACTIVAS: una desactivada ya no se
 * compra ni se costea, y gritar por ella sería ruido.
 */
function proyectarMedidas(filas: FilaMedida[], unidadMedida: string | null): MedidasDeAvio {
  const datos: MedidaAvioSalida[] = filas.map((f) => ({
    id: f.id,
    medida: f.medida,
    valor: f.valor === null ? null : f.valor.toNumber(),
    requiereRevision: f.requiereRevision,
    precio: f.precio.toNumber(),
    orden: f.orden,
    activo: f.activo,
  }));
  const activas = datos.filter((d) => d.activo);
  const promedioPreCosto =
    activas.length === 0
      ? null
      : redondear2(activas.reduce((s, d) => s + d.precio, 0) / activas.length);

  const avisos: string[] = [];
  // ⭐ El caso que justifica la etapa (§Post-F9.66, H2 del review): "53 cm", "53cm" y "53" son la
  // MISMA medida escrita de tres formas. La migración las marca; aquí se DICE qué son, porque
  // "necesita revisión" a secas dejaba al usuario adivinando cuál sobra. Se agrupan por valor para
  // nombrar el conjunto completo, no una fila suelta.
  const porValor = new Map<number, MedidaAvioSalida[]>();
  for (const d of activas) {
    if (d.valor === null) continue;
    const grupo = porValor.get(d.valor);
    if (grupo === undefined) porValor.set(d.valor, [d]);
    else grupo.push(d);
  }
  const duplicadas = [...porValor.values()].filter((g) => g.length > 1);
  const idsDuplicadas = new Set(duplicadas.flat().map((d) => d.id));
  for (const grupo of duplicadas) {
    avisos.push(
      `${grupo.map((d) => `"${d.medida}"`).join(', ')} son LA MISMA medida ` +
        `(${String(grupo[0]?.valor ?? '')}) escrita de formas distintas: por eso la compra salía ` +
        'partida. Deja una sola y retira las demás.',
    );
  }

  // Las que necesitan revisión por OTRA razón (etiqueta no convertible). Las duplicadas ya se
  // explicaron arriba con su motivo real; repetirlas aquí sería decir dos veces lo mismo y encima
  // con la razón equivocada.
  const porRevisar = activas.filter((d) => d.requiereRevision && !idsDuplicadas.has(d.id));
  if (porRevisar.length > 0) {
    avisos.push(
      `${String(porRevisar.length)} medida(s) de este avío necesitan revisión manual ` +
        `(${porRevisar.map((d) => `"${d.medida}"`).join(', ')}): su etiqueta vieja no se pudo ` +
        `convertir a número + unidad y NO se adivinó. Corrígelas capturando su medida.`,
    );
  }
  if (activas.length > 0 && normalizarUnidad(unidadMedida) === null) {
    avisos.push(
      'Este avío no tiene capturada la unidad de sus medidas (cm, mm…): sin ella el número no ' +
        'dice nada y la compra no sabe qué pedir.',
    );
  }
  for (const d of activas) {
    if (d.valor === null) continue;
    const aviso = avisoValorFueraDeRango(`La medida "${d.medida}"`, d.valor, unidadMedida);
    if (aviso !== null) avisos.push(aviso);
  }

  return { datos, unidadMedida: normalizarUnidad(unidadMedida), promedioPreCosto, avisos };
}

/** `select` de las medidas (una sola definición para la lectura y para la respuesta del PUT). */
const SELECT_MEDIDA = {
  id: true,
  medida: true,
  valor: true,
  requiereRevision: true,
  precio: true,
  orden: true,
  activo: true,
} as const;

/**
 * Lista las medidas de un avío (ordenadas por `orden`, luego `medida`) + el promedio de precios de las
 * ACTIVAS (`promedioPreCosto`, el valor que usa el precosto) + la unidad y los avisos. Requiere
 * `avios.ver`. Exige que el avío exista.
 */
export async function listarMedidasDeAvio(
  sesion: SesionUsuario,
  idAvio: number,
  bd?: ContextoBd,
): Promise<MedidasDeAvio> {
  verificarPermiso(sesion, 'avios.ver');
  const cliente = clienteLectura(bd);
  const { unidadMedida } = await exigirAvio(cliente, idAvio);
  const filas = await cliente.avioMedida.findMany({
    where: { idAvio },
    select: SELECT_MEDIDA,
    orderBy: [{ orden: 'asc' }, { medida: 'asc' }],
  });
  return proyectarMedidas(filas, unidadMedida);
}

/**
 * Una medida DESACTIVADA por el set-completo, con lo que tenía (para la bitácora, D3). Se tipa como
 * `Prisma.InputJsonObject` porque viaja TAL CUAL al campo JSON de la bitácora.
 */
type MedidaDesactivada = Prisma.InputJsonObject & {
  id: number;
  medida: string;
  valor: number | null;
  precio: number;
};

/** Una medida cuya ETIQUETA cambió al normalizarse (para la bitácora, D3). */
type MedidaRenombrada = Prisma.InputJsonObject & {
  id: number;
  antes: string;
  ahora: string;
};

/**
 * Reemplaza el SET de medidas de un avío en UNA transacción (A2): las que siguen se ACTUALIZAN
 * (medida/precio/orden/reactivar), las nuevas se CREAN y las que ya no vienen se DESACTIVAN (borrado
 * suave, no físico — preserva el amarre medida×talla y el historial). Requiere `avios.administrar`.
 *
 * ⭐ V1-E3g: el cuerpo trae `unidadMedida` (la unidad del AVÍO, una sola vez) y cada renglón trae su
 * `valor` NUMÉRICO; la etiqueta se DERIVA. Guardar con un número **apaga** `requiereRevision`: la
 * medida quedó normalizada, que es exactamente lo que la marca pedía. La etiqueta anterior de una
 * medida corregida queda en la BITÁCORA (D3: no se pierde lo que había).
 *
 * Devuelve las medidas resultantes + el promedio del precosto + los avisos (que NO bloquean).
 */
export async function reemplazarMedidasAvio(
  sesion: SesionUsuario,
  idAvio: number,
  entrada: DatosAvioMedidas,
  bd?: ContextoBd,
): Promise<MedidasDeAvio> {
  verificarPermiso(sesion, 'avios.administrar');
  const datos: DatosAvioMedidas = validarEntrada(esquemaAvioMedidasCuerpo, entrada);
  const unidadMedida = normalizarUnidad(datos.unidadMedida);

  return enTransaccion(async (tx) => {
    await exigirAvio(tx, idAvio);

    const actuales = await tx.avioMedida.findMany({ where: { idAvio }, select: SELECT_MEDIDA });
    const actualPorId = new Map(actuales.map((m) => [m.id, m]));
    const actualPorEtiqueta = new Map(actuales.map((m) => [m.medida, m]));

    // La ETIQUETA sale del número + la unidad del avío. Se calcula ANTES de tocar nada para poder
    // rechazar de una vez dos renglones que colisionarían en el `@@unique` (p. ej. 53 y 53.0).
    // ⚠️ El `valor` se REDONDEA a 2 decimales ANTES de derivar la etiqueta. La columna es
    // `Decimal(12,2)`: sin esto, capturar 53.456 guardaría 53.46 con una etiqueta "53.456 cm" que
    // ya no corresponde al número — el mismo divorcio texto/dato que esta etapa vino a cerrar.
    // Un `id` que no es de ESTE avío no se acepta: sería corregir la medida de otro (A9 en chico).
    for (const d of datos.medidas) {
      if (d.id !== undefined && !actualPorId.has(d.id)) {
        throw new ErrorValidacion('Una de las medidas a corregir no existe o no es de este avío.');
      }
    }

    // ⭐ H4 del review — Una medida HEREDADA sin normalizar (`valor: null`) viaja para CONSERVARSE:
    // mantiene su etiqueta original y su marca de revisión, y sólo se le puede mover precio/orden.
    // Sin esto, una sola fila marcada congelaba el avío entero (no se podía guardar ningún otro
    // cambio) o —peor— había que dejarla fuera del set-completo, que la habría dado de baja.
    // ⚠️ Lo que NO se permite es des-normalizar: quitarle el número a una medida que YA lo tiene
    // sería perder justo el dato que esta etapa vino a ganar.
    const derivados = datos.medidas.map((m) => {
      if (m.valor === null) {
        const actual = m.id === undefined ? undefined : actualPorId.get(m.id);
        if (actual === undefined) {
          throw new ErrorValidacion('Una medida sin número tiene que ser una ya existente.');
        }
        if (actual.valor !== null) {
          throw new ErrorValidacion(
            `La medida "${actual.medida}" ya tiene número: no se le puede quitar. ` +
              'Corrígelo si está mal, pero no lo dejes en blanco.',
          );
        }
        return { ...m, valor: null, etiqueta: actual.medida, conservar: true };
      }
      const valor = redondear2(m.valor);
      return { ...m, valor, etiqueta: etiquetaMedida(valor, unidadMedida), conservar: false };
    });
    if (new Set(derivados.map((d) => d.etiqueta)).size !== derivados.length) {
      throw new ErrorValidacion('Hay medidas repetidas en el avío.');
    }

    // A qué fila EXISTENTE le toca cada renglón: por `id` si lo trae (corrección en su lugar) y,
    // si no, por la etiqueta derivada. Se resuelve UNA sola vez y se reusa más abajo: si se
    // recalculara, la lista de choques y la de escrituras podrían dejar de hablar de lo mismo.
    const resueltos = derivados.map((d) => ({
      deseado: d,
      actual: d.id === undefined ? actualPorEtiqueta.get(d.etiqueta) : actualPorId.get(d.id),
    }));

    const destinoPorId = new Map<number, string>();
    for (const { deseado, actual } of resueltos) {
      if (actual === undefined) continue;
      // Dos renglones del cuerpo apuntando a la MISMA fila (id repetido, o un id + otro sin id que
      // casa por etiqueta): uno pisaría al otro en silencio y el usuario vería desaparecer una
      // medida que sí capturó.
      if (destinoPorId.has(actual.id)) {
        throw new ErrorValidacion(
          `Dos renglones apuntan a la misma medida ("${actual.medida}") del avío.`,
        );
      }
      destinoPorId.set(actual.id, deseado.etiqueta);
    }
    // ⚠️ Choque de etiquetas: normalizar una medida heredada puede llevarla al nombre que YA tiene
    // OTRA fila ("15cm" corregida a 15 cuando ya existe "15 cm"). El `@@unique([idAvio, medida])`
    // lo reventaría con un 500 ilegible a media transacción — y también un intercambio de nombres
    // entre dos filas, que aunque "cuadre" al final choca a mitad del camino. Se rechaza ANTES,
    // con un mensaje que dice qué pasó.
    for (const d of derivados) {
      const ocupada = actuales.find(
        (a) => a.medida === d.etiqueta && destinoPorId.get(a.id) !== d.etiqueta,
      );
      if (ocupada !== undefined) {
        throw new ErrorValidacion(
          `Ya existe otra medida "${ocupada.medida}" en este avío: no puede haber dos con el ` +
            'mismo valor. Corrige o retira la anterior antes de repetir esta.',
        );
      }
    }

    const tocados = new Set<number>();
    const renombradas: MedidaRenombrada[] = [];
    let i = 0;
    for (const { deseado, actual } of resueltos) {
      const orden = deseado.orden ?? i;

      if (actual === undefined) {
        const creada = await tx.avioMedida.create({
          data: {
            idAvio,
            medida: deseado.etiqueta,
            // Un alta SIEMPRE trae número (una entrada sin él exige `id` y por tanto fila previa).
            valor: deseado.valor,
            requiereRevision: false,
            precio: deseado.precio,
            orden,
            ...datosCreacion(sesion),
          },
          select: { id: true },
        });
        tocados.add(creada.id);
      } else {
        tocados.add(actual.id);
        const valorActual = actual.valor === null ? null : actual.valor.toNumber();
        // Una medida CONSERVADA (sin número) no se normaliza: sigue marcada y con su etiqueta. Sólo
        // cuenta como cambio lo que sí se puede ajustar en ella (precio, orden, reactivación).
        const cambia = deseado.conservar
          ? num(actual.precio) !== deseado.precio || actual.orden !== orden || !actual.activo
          : actual.medida !== deseado.etiqueta ||
            valorActual !== deseado.valor ||
            num(actual.precio) !== deseado.precio ||
            actual.orden !== orden ||
            !actual.activo ||
            actual.requiereRevision;
        if (cambia) {
          if (actual.medida !== deseado.etiqueta) {
            renombradas.push({ id: actual.id, antes: actual.medida, ahora: deseado.etiqueta });
          }
          await tx.avioMedida.update({
            where: { id: actual.id },
            data: {
              ...(deseado.conservar
                ? {}
                : {
                    medida: deseado.etiqueta,
                    valor: deseado.valor,
                    // Capturarla con un número ES la revisión que la marca pedía: se apaga sola.
                    requiereRevision: false,
                  }),
              precio: deseado.precio,
              orden,
              activo: true,
              ...datosModificacion(sesion),
            },
          });
        }
      }
      i += 1;
    }

    // Desactiva (borrado suave) las que ya no vienen y siguen activas. Lo que se va queda ÍNTEGRO
    // en la bitácora: es la única forma de reconstruir una medida retirada por descuido (D3).
    const desactivadas: MedidaDesactivada[] = [];
    for (const actual of actuales) {
      if (!tocados.has(actual.id) && actual.activo) {
        desactivadas.push({
          id: actual.id,
          medida: actual.medida,
          valor: actual.valor === null ? null : actual.valor.toNumber(),
          precio: num(actual.precio),
        });
        await tx.avioMedida.update({
          where: { id: actual.id },
          data: { activo: false, ...datosModificacion(sesion) },
        });
      }
    }

    await tx.avio.update({
      where: { id: idAvio },
      data: { unidadMedida, ...datosModificacion(sesion) },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'Avio',
      idEntidad: idAvio,
      accion: 'MODIFICAR',
      datos: {
        operacion: 'medidas',
        total: datos.medidas.length,
        unidadMedida,
        ...(renombradas.length === 0 ? {} : { renombradas }),
        ...(desactivadas.length === 0 ? {} : { desactivadas }),
      },
    });

    const filas = await tx.avioMedida.findMany({
      where: { idAvio },
      select: SELECT_MEDIDA,
      orderBy: [{ orden: 'asc' }, { medida: 'asc' }],
    });
    return proyectarMedidas(filas, unidadMedida);
  }, bd);
}
