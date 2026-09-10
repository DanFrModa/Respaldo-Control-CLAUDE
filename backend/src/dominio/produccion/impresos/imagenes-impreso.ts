/**
 * ⭐ LAS IMÁGENES DE LOS PAPELES DE UNA ORDEN: **qué fotos de arte manda la OP** y **cómo se bajan
 * sus bytes**.
 *
 * ── Qué fotos manda la OP ──────────────────────────────────────────────────────────────────────
 * Este módulo es la **única** definición de la regla —heredadas del arte del modelo − las que ESTA
 * OP apagó + las que ESTA OP subió, más los artes agregados a mano—, la que cerró la 0.083
 * (§Post-F9.177). Nació de `impreso-orden.ts`, que era su único dueño, cuando la 0.094 pidió la
 * FOTO en la FICHA DE ARTE: dos papeles de la misma orden que resuelven "cuál foto manda" por su
 * cuenta se separan en silencio a la primera corrección, que es justo el defecto que §Post-F9.177
 * vino a cerrar entre la pantalla y el papel. Aquí vive la regla; **cada impreso decide cuántas
 * caben, de qué tamaño y qué hace cuando una no llega**.
 *
 * Lo que este módulo **no** hace: no verifica permisos (lo hace el llamador, que ya está
 * autorizado a imprimir) y no presigna. Devuelve KEYS de R2 y el rótulo del arte.
 *
 * ── Cómo se bajan los bytes ────────────────────────────────────────────────────────────────────
 * {@link descargarImagenComoDataUrl} baja una imagen por su URL GET prefirmada y la devuelve como
 * data-URL, o `null` si algo falla. Vive aquí —y no en un impreso— porque la comparten todos.
 *
 * ── Cuántas caben y cómo se presignan (0.106) ───────────────────────────────────────────────────
 * {@link recortarAlTope} (el tope + el conteo de lo que quedó fuera) y {@link presignarKeys} (el
 * presign best-effort por imagen) también se comparten: nacieron en la ficha de arte (0.094) y la
 * 0.106 los subió aquí al aplicar su misma cura al impreso de la orden. **El tope se aplica sobre
 * lo que la orden PIDE, antes de presignar y de bajar** — si se aplicara después, el conteo
 * hablaría de lo que se pudo traer y una imagen caída desaparecería del papel sin decirlo.
 */
import { leerBom } from '../../modelos/bom-modelo.js';
import type { ServicioArchivos } from '../../../comun/archivos.js';
import type { clienteLectura } from '../../../comun/transaccion.js';
import { leerArteOrdenParaImpreso, type ArteOrdenFotosImpreso } from '../fotos-arte-orden.js';
import { leerRecetaParaImpreso } from '../receta-orden.js';

/** Cliente de lectura (transacción o cliente suelto), tal como lo devuelve `clienteLectura`. */
type ClienteLectura = ReturnType<typeof clienteLectura>;

/** Una foto de arte que ESTA orden manda imprimir: su key de R2 y el rótulo del arte. */
export interface FotoArteDeLaOrden {
  /** Rótulo que va debajo de la imagen: la descripción del arte. */
  titulo: string;
  /** Key del objeto en R2 (el impreso presigna y baja los bytes por su cuenta). */
  key: string;
  /**
   * La primerísima foto del PRIMER arte. Es una GARANTÍA para quien recorta: se antepone antes de
   * cortar, así que el tope jamás la deja fuera. No se hereda: si esta OP apagó esa foto, este
   * papel sale SIN principal (la siguiente NO hereda la estrella).
   */
  principal: boolean;
}

/** Un arte del MODELO con lo poco que hace falta para decidir qué fotos suyas se imprimen. */
export interface ArteModeloParaImpreso {
  id: number;
  descripcion: string;
  fotos: readonly { idFoto: number; key: string }[];
}

/**
 * Descarga de una imagen a data-URL, inyectable en los tests (sin R2 ni red).
 *
 * `maxBytes` es un tope DURO opcional: sin él baja lo que venga (el comportamiento histórico del
 * impreso de la orden); con él, una imagen más pesada se trata como "no se pudo traer" (`null`).
 */
export type DescargarImagen = (url: string, maxBytes?: number) => Promise<string | null>;

/**
 * Descarga real (Node 22 trae `fetch`/`Blob` globales). Cualquier fallo → `null` (best-effort: una
 * foto que no llega JAMÁS trunca un impreso; qué hace el papel con ese `null` lo decide el papel).
 *
 * El tope se comprueba DOS veces, igual que `servicioArchivos().descargarContenido`: primero por
 * `content-length` —para no bufferear siquiera un objeto enorme— y, por si la respuesta viniera sin
 * esa cabecera, otra vez sobre los bytes ya leídos.
 */
export const descargarImagenComoDataUrl: DescargarImagen = async (url, maxBytes) => {
  try {
    const respuesta = await fetch(url);
    if (!respuesta.ok) {
      return null;
    }
    if (maxBytes !== undefined) {
      const declarado = Number(respuesta.headers.get('content-length'));
      if (Number.isFinite(declarado) && declarado > maxBytes) {
        console.warn(
          `Una imagen del impreso pesa ${String(declarado)} bytes y el tope son ${String(maxBytes)}: no se incrusta.`,
        );
        return null;
      }
    }
    const tipo = respuesta.headers.get('content-type') ?? 'image/jpeg';
    const buffer = Buffer.from(await respuesta.arrayBuffer());
    if (buffer.length === 0) {
      return null;
    }
    if (maxBytes !== undefined && buffer.length > maxBytes) {
      console.warn(
        `Una imagen del impreso pesa ${String(buffer.length)} bytes y el tope son ${String(maxBytes)}: no se incrusta.`,
      );
      return null;
    }
    return `data:${tipo};base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
};

/**
 * Pone al frente la imagen marcada como `principal` (si la hay), conservando el orden relativo de
 * las demás. Junto con el `slice` del tope de cada papel es lo que garantiza que la imagen
 * principal SIEMPRE se imprima y salga PRIMERO, aunque el bloque se recorte (Daniel, jul-2026).
 * Pura y estable: sin principal (o si ya va al frente) devuelve el arreglo tal cual.
 *
 * ⚠️ En el pipeline REAL nunca mueve nada: el orden lo fija la BD y quien arma los datos solo la
 * MARCA. Esto es CINTURÓN (defensa en profundidad) por si mañana se reordena la entrada.
 */
export function anteponerPrincipal<T extends { principal?: boolean }>(imagenes: readonly T[]): T[] {
  const indice = imagenes.findIndex((imagen) => imagen.principal === true);
  const principal = indice <= 0 ? undefined : imagenes[indice];
  if (principal === undefined) {
    return [...imagenes];
  }
  return [principal, ...imagenes.slice(0, indice), ...imagenes.slice(indice + 1)];
}

/**
 * ⭐ Reparte las fotos de VARIOS artes **por rondas**: primero la 1ª foto de cada arte, luego la 2ª
 * de cada uno, y así. Pura y estable (conserva el orden de los artes dentro de cada ronda).
 *
 * **Por qué existe** (V1-E3f, §Post-F9.52 punto 5): al pasar las fotos del arte a PLURAL, un arte
 * con 5 fotos se comía la rejilla entera —el tope del papel— y **sacaba del impreso a todos los
 * demás artes**. Antes no podía pasar: cada arte aportaba exactamente una imagen.
 *
 * **La decisión, dicha completa:** el papel del piso tiene que enseñar *qué artes lleva la prenda*,
 * no cinco ángulos de uno. Con las rondas, mientras quepan artes distintos NINGUNO se queda sin su
 * primera foto, y las fotos extra solo entran con el espacio que sobra. El arte PRINCIPAL sigue
 * garantizado: su primera foto va en la ronda 1, posición 0, y el recorte la antepone.
 */
export function porRondas<T>(porArte: readonly (readonly T[])[]): T[] {
  const maximo = porArte.reduce((max, fotos) => Math.max(max, fotos.length), 0);
  const salida: T[] = [];
  for (let ronda = 0; ronda < maximo; ronda += 1) {
    for (const fotos of porArte) {
      const foto = fotos[ronda];
      if (foto !== undefined) {
        salida.push(foto);
      }
    }
  }
  return salida;
}

/**
 * ⭐⭐ 0.106 — EL TOPE DE UN PAPEL, APLICADO SIEMPRE IGUAL: la imagen PRINCIPAL al frente
 * ({@link anteponerPrincipal}) y las primeras `tope`; devuelve además **cuántas quedaron fuera**,
 * que es lo que cada impreso pinta en su título. Como el tope es ≥ 1 y la principal quedó en la
 * posición 0, la principal NUNCA se recorta. Pura y estable.
 *
 * ⚠️ **Se aplica sobre lo que la orden PIDE, ANTES de presignar y de bajar bytes.** Ésa es la mitad
 * de la cura de la 0.106: recortar DESPUÉS de bajar hace que el conteo hable de lo que se pudo
 * traer —no de lo que la prenda lleva— y que una imagen caída desaparezca dejando entrar a otra en
 * su lugar. En un papel de PISO eso se produce mal: dice «3 artes» y la prenda lleva 5.
 *
 * Nació en la ficha de arte (0.094, `recortarFotosArte`) y la 0.106 lo subió aquí al necesitarlo
 * también el impreso de la orden (`recortarFotos`/`recortarArtes`): un solo criterio de tope para
 * los papeles de la misma orden.
 */
export function recortarAlTope<T extends { principal?: boolean }>(
  imagenes: readonly T[],
  tope: number,
): { mostradas: T[]; ocultas: number } {
  const mostradas = anteponerPrincipal(imagenes).slice(0, tope);
  return { mostradas, ocultas: imagenes.length - mostradas.length };
}

/** Lo que devuelve {@link presignarKeys}: una URL por posición (o `null`) y el rastro del fallo. */
export interface PresignadoLote {
  /** URL GET prefirmada por posición; `null` = R2 rechazó ESA key → el papel pinta su hueco. */
  urls: (string | null)[];
  /** Cuántas keys se quedaron sin URL (el llamador lo LOGUEA con el contexto de su papel). */
  fallos: number;
  /** Motivo del primer fallo, para loguearlo; `undefined` si no hubo ninguno. */
  primerMotivo: unknown;
}

/**
 * Presigna un lote de keys de R2 **best-effort POR IMAGEN** (`allSettled`, nunca `all`): una key
 * que R2 rechaza se queda en `null` y las demás siguen saliendo. Conserva la POSICIÓN de cada key,
 * que es lo que permite casar cada URL con su rótulo sin corrimientos.
 *
 * No loguea: el mensaje lo pone quien llama, que es el único que sabe de qué papel se trata.
 */
export async function presignarKeys(
  keys: readonly string[],
  archivos: Pick<ServicioArchivos, 'urlDescarga'>,
): Promise<PresignadoLote> {
  const resultados = await Promise.allSettled(keys.map((key) => archivos.urlDescarga(key)));
  const primerFallo = resultados.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  return {
    urls: resultados.map((r) => (r.status === 'fulfilled' ? r.value : null)),
    fallos: resultados.filter((r) => r.status === 'rejected').length,
    primerMotivo: primerFallo?.reason,
  };
}

/**
 * ⭐⭐ §Post-F9.177 — LO QUE **ESTA OP** DECIDIÓ SOBRE LAS FOTOS DEL ARTE, resuelto una sola vez.
 *
 * Daniel: *"la OP es de donde cuelgan las fotos directamente, no del desarrollo… y aplica para
 * fotos de la prenda pero también del arte"*. Si la pantalla deja de enseñar una foto y el papel la
 * sigue imprimiendo, es *"añadí lo nuevo y dejé lo viejo debajo"*.
 *
 * Tres cosas, y ninguna toca el arte del modelo (D3):
 *  1. de los artes del MODELO solo se consideran los que ESTA orden lleva (traza `idModeloArte` de
 *     su receta; el nombre del arte se retiró en §Post-F9.52);
 *  2. las heredadas que el renglón APAGÓ no se imprimen (otra orden del mismo modelo las sigue
 *     imprimiendo), y las que ESTA OP subió van detrás de las heredadas de su mismo arte;
 *  3. el arte AGREGADO A MANO (`idModeloArte` null) no está en el BOM, así que sus fotos —las
 *     únicas que puede tener— van al final, para no desplazar al principal de su sitio.
 *
 * El recorrido va sobre los artes del MODELO, que llegan ORDENADOS por el `orden` del modelo, y NO
 * sobre la receta: así el arte PRINCIPAL sigue siendo el primero del modelo. La salida sale ya
 * repartida {@link porRondas}, para que el tope de cada papel se lleve primero las fotos EXTRA de
 * un arte y no la única foto de otro.
 *
 * Función PURA: no toca BD ni R2 (el envoltorio que sí las toca es {@link leerFotosArteDeLaOrden}).
 */
export function fotosArteDeLaOrden(
  artesDelModelo: readonly ArteModeloParaImpreso[],
  artesDeLaOrden: readonly { idModeloArte: number | null }[],
  decisiones: readonly ArteOrdenFotosImpreso[],
): FotoArteDeLaOrden[] {
  const idsArteOrden = new Set(
    artesDeLaOrden.flatMap((a) => (a.idModeloArte === null ? [] : [a.idModeloArte])),
  );
  const decisionPorArteModelo = new Map(
    decisiones.flatMap((d) => (d.idModeloArte === null ? [] : [[d.idModeloArte, d] as const])),
  );
  return porRondas([
    ...artesDelModelo
      .filter((a) => idsArteOrden.has(a.id))
      .map((a, i) => {
        const decision = decisionPorArteModelo.get(a.id);
        const apagadas = new Set(decision?.ocultas ?? []);
        return [
          // ⚠️ La marca de PRINCIPAL se pone ANTES de descartar las apagadas, y por eso una foto
          // apagada se lleva la estrella consigo: ser principal es una decisión sobre una foto
          // concreta, no un puesto que la siguiente herede. Si esta OP apagó la primera foto del
          // primer arte, el papel sale SIN principal — y el tope se comporta como siempre.
          ...a.fotos
            .map((foto, j) => ({
              titulo: a.descripcion,
              key: foto.key,
              // Solo la PRIMERA foto del PRIMER arte es la principal (la que nunca se recorta).
              principal: i === 0 && j === 0,
              apagada: apagadas.has(foto.idFoto),
            }))
            .filter((foto) => !foto.apagada)
            .map(({ titulo, key, principal }) => ({ titulo, key, principal })),
          // Las que subió ESTA OP van detrás de las heredadas de su mismo arte, y NUNCA son la
          // principal (esa la elige el dueño del modelo en su ficha, no la orden).
          ...(decision?.propias ?? []).map((foto) => ({
            titulo: a.descripcion,
            key: foto.key,
            principal: false,
          })),
        ];
      }),
    ...decisiones
      .filter((d) => d.idModeloArte === null)
      .map((d) =>
        d.propias.map((foto) => ({ titulo: d.descripcion, key: foto.key, principal: false })),
      ),
  ]);
}

/** Lecturas inyectables (los tests las sustituyen para no tocar BD ni R2). */
export interface DepsFotosArteOrden {
  leerBom?: typeof leerBom;
  leerRecetaParaImpreso?: typeof leerRecetaParaImpreso;
  leerArteOrdenFotos?: typeof leerArteOrdenParaImpreso;
}

/**
 * LEE de BD lo que hace falta y devuelve las fotos de arte que esta OP manda imprimir, ya en orden
 * y repartidas por rondas. Lectura de BAJO NIVEL, **sin verificar permiso**: la usan los impresos,
 * que ya están autorizados, para que dos papeles de la misma orden no puedan divergir.
 *
 * Las DECISIONES de la OP se leen best-effort (mismo criterio que el impreso de la orden): si esa
 * lectura truena, el papel sale con el arte del MODELO tal cual —el comportamiento de antes de
 * §Post-F9.177—, nunca truncado. Las lecturas del BOM y de la receta NO se atrapan aquí: quien
 * llama decide (el impreso de la ficha las envuelve, porque su papel tiene que salir igual).
 */
export async function leerFotosArteDeLaOrden(
  cliente: ClienteLectura,
  idOrden: number,
  idModelo: number,
  idEmpresa: number,
  deps: DepsFotosArteOrden = {},
): Promise<FotoArteDeLaOrden[]> {
  const leerBomModelo = deps.leerBom ?? leerBom;
  const leerReceta = deps.leerRecetaParaImpreso ?? leerRecetaParaImpreso;
  const leerDecisiones = deps.leerArteOrdenFotos ?? leerArteOrdenParaImpreso;

  const [bom, receta] = await Promise.all([
    leerBomModelo(cliente, idModelo, idEmpresa),
    leerReceta(cliente, idOrden),
  ]);

  let decisiones: ArteOrdenFotosImpreso[] = [];
  try {
    decisiones = await leerDecisiones(cliente, idOrden);
  } catch (error) {
    console.warn(
      `No se pudieron leer las decisiones de foto del arte de la orden ${String(idOrden)} para su impreso.`,
      error,
    );
  }
  return fotosArteDeLaOrden(bom.artes, receta.artes, decisiones);
}

/**
 * Igual que {@link leerFotosArteDeLaOrden} pero resolviendo el MODELO desde la propia orden, para
 * los papeles que no lo tienen a mano (la ficha de arte nace de una ETAPA, no de la orden). A9: la
 * orden se busca dentro de la empresa activa; si no es de esa empresa, no hay fotos que imprimir.
 */
export async function leerFotosArteDeLaOrdenPorId(
  cliente: ClienteLectura,
  idOrden: number,
  idEmpresa: number,
  deps: DepsFotosArteOrden = {},
): Promise<FotoArteDeLaOrden[]> {
  const orden = await cliente.orden.findFirst({
    where: { id: idOrden, idEmpresa },
    select: { idModelo: true },
  });
  if (orden === null) {
    // Inalcanzable por el camino normal (quien llama ya resolvió la etapa por la empresa activa),
    // pero se DICE en vez de devolver un vacío mudo: un papel sin arte por una orden que no
    // apareció no puede parecerse a un papel sin arte porque la OP no lo tiene.
    console.warn(
      `La orden ${String(idOrden)} no es de la empresa ${String(idEmpresa)}: su impreso sale sin fotos de arte.`,
    );
    return [];
  }
  return leerFotosArteDeLaOrden(cliente, idOrden, orden.idModelo, idEmpresa, deps);
}
