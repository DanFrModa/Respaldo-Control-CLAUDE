import type { ListaLinea } from '@/api/listas-precios';
import type { TonoEstado } from '@/components/dominio/ChipEstado';

/**
 * ⭐⭐ V1-E8x (§Post-F9.151 / §Post-F9.155) — LOS CUATRO ESTADOS DEL **MODELO** dentro de la lista,
 * del lado de la pantalla: cómo se rotulan, con qué tono se pintan, a dónde se puede mover cada uno
 * y qué renglones van en el papel.
 *
 * 🔴 **Nada de esto DECIDE**: el servidor manda (A1). Los rótulos que se muestran vienen del API
 * (`nombreEstado`, lo redacta el dominio); lo de aquí es **presentación** —tono del chip, opciones
 * del selector, botones que se apagan— y espeja las reglas del backend para no ofrecer un control
 * que va a fallar al pulsarlo. Si las dos divergen, gana el servidor y sale su mensaje.
 *
 * Vive en un módulo aparte porque las MISMAS reglas se necesitan en tres pantallas (la lista, el
 * diálogo de emitir cotización y el de negociación); tenerlas copiadas tres veces es justo cómo se
 * torció antes el criterio del papel.
 */

/** Estado de un renglón, tal como viaja en el contrato. */
export type EstadoRenglon = ListaLinea['estado'];

/**
 * Tono del chip por estado. **Deliberadamente distinto del de la LISTA** (`TONO_ESTADO_LISTA`), y
 * además el chip del renglón se pinta con CONTORNO en vez de relleno: «En negociación» es el MISMO
 * string en los dos ejes y los dos conviven en esta pantalla, así que la única defensa contra
 * confundirlos es que no se parezcan.
 */
export const TONO_ESTADO_RENGLON: Record<EstadoRenglon, TonoEstado> = {
  abierto: 'neutro',
  en_negociacion: 'warn',
  cerrado: 'ok',
  // Dropeado NO es una alarma (es un desenlace normal del negocio), pero sí es el marcador de «se
  // cayó del papel»: el rojo es lo que hace que se lea distinto de un modelo vivo.
  dropeado: 'crit',
};

/** Los cuatro estados en el orden en que ocurren (el del selector). */
export const ESTADOS_RENGLON: EstadoRenglon[] = [
  'abierto',
  'en_negociacion',
  'cerrado',
  'dropeado',
];

/**
 * Rótulo de cada estado para el SELECTOR (el chip usa el `nombreEstado` que manda el servidor).
 * 🔴 «Dropeado» es la palabra de Daniel: no se traduce ni se «mejora».
 */
export const ETIQUETA_ESTADO_RENGLON: Record<EstadoRenglon, string> = {
  abierto: 'Abierto',
  en_negociacion: 'En negociación',
  cerrado: 'Cerrado',
  dropeado: 'Dropeado',
};

/** Un modelo cerrado o dropeado ya no admite movimiento hasta que se reviva. */
export function esEstadoTerminal(estado: EstadoRenglon): boolean {
  return estado === 'cerrado' || estado === 'dropeado';
}

/**
 * A dónde puede moverse un renglón desde su estado actual (espejo del dominio): desde un estado
 * TERMINAL el único camino es REVIVIR (abierto / en negociación); desde uno vivo, a cualquier otro.
 */
export function destinosDesde(estado: EstadoRenglon): EstadoRenglon[] {
  const posibles: EstadoRenglon[] = esEstadoTerminal(estado)
    ? ['abierto', 'en_negociacion']
    : ESTADOS_RENGLON;
  return posibles.filter((e) => e !== estado);
}

/**
 * ⭐⭐ **LOS RENGLONES QUE VAN EN EL PAPEL: los NO dropeados** (§Post-F9.155). Espejo exacto de
 * `renglonesVigentesDelPapel` del dominio. Daniel: *«Después de la negociación solo hay que mandar
 * los que están vigentes. Quitar los dropeados»*.
 *
 * 🔴 Un modelo CERRADO sí sale (es uno vendido, no uno caído): confundirlos dejaría fuera del papel
 * justo los cinco que él cerró.
 */
export function vigentesDelPapel(lineas: readonly ListaLinea[]): ListaLinea[] {
  return lineas.filter((l) => l.estado !== 'dropeado');
}

/** Lo que la pantalla necesita saber para decidir si ofrece el PDF / el Excel / la cotización. */
export interface DiagnosticoPapel {
  /** Los renglones que de verdad irían en el papel. */
  vigentes: ListaLinea[];
  /** Los dropeados (se dicen aparte: no salen, y eso hay que explicarlo). */
  dropeados: ListaLinea[];
  /** Los VIGENTES que aún no tienen precio aprobado por el dueño. */
  sinAprobar: ListaLinea[];
  /** ¿Puede salir el papel? (hay al menos un vigente y todos están firmados). */
  puedeSalir: boolean;
  /** Por qué NO puede salir, en español y nombrando modelos. `null` si sí puede. */
  motivo: string | null;
}

/**
 * ESPEJO del guard del servidor (`exigirRenglonesAprobados`), con su mismo orden de rechazos: lista
 * vacía → todos dropeados → falta alguna firma. Se espeja para no ofrecer un botón que va a fallar
 * —y para poder decir POR QUÉ, que es lo que un botón gris no dice (§Post-F9.96)—; la puerta de
 * verdad sigue siendo el 409 del backend.
 */
export function diagnosticarPapel(lineas: readonly ListaLinea[]): DiagnosticoPapel {
  const vigentes = vigentesDelPapel(lineas);
  const dropeados = lineas.filter((l) => l.estado === 'dropeado');
  const sinAprobar = vigentes.filter((l) => !l.aprobado);
  const nombres = (ls: readonly ListaLinea[]): string => ls.map((l) => l.codigoModelo).join(', ');

  let motivo: string | null = null;
  if (lineas.length === 0) {
    motivo = 'la lista no tiene modelos';
  } else if (vigentes.length === 0) {
    motivo =
      'todos los modelos de la lista están dropeados: no queda ninguno vigente que mandar. ' +
      'Revive al menos uno (déjalo en Abierto o En negociación)';
  } else if (sinAprobar.length === 1) {
    motivo = `falta ${nombres(sinAprobar)}`;
  } else if (sinAprobar.length > 1) {
    motivo = `faltan ${nombres(sinAprobar)}`;
  }

  return { vigentes, dropeados, sinAprobar, puedeSalir: motivo === null, motivo };
}
