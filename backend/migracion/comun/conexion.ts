/**
 * Robustez de CONEXIÓN para los scripts de `migracion/` que se corren **a mano, desde un portátil,
 * por internet, contra la base de `prueba` en Railway** (§Post-F9, sembrador de inventarios).
 *
 * El escenario no es el del CI ni el de la app: la base está al otro lado de un proxy público,
 * cada conexión nueva cuesta cientos de milisegundos de TCP+TLS, y el cupo de conexiones del
 * servidor NO es todo nuestro — lo comparten el backend desplegado y su cola de eventos. Un script
 * que abre un puñado de conexiones a la vez puede quedarse sin cupo y morir a mitad de una corrida
 * de minutos, tirando todo el trabajo hecho.
 *
 * Aquí viven las tres piezas que lo evitan, y que NO son lógica de negocio (esto es tooling; la
 * regla A1 sigue intacta: quien decide reglas es `src/dominio`):
 *
 *  1. {@link esErrorDeConexion} — distinguir un tropiezo de RED de un error de datos. Reintentar lo
 *     primero es correcto; reintentar lo segundo esconde bugs.
 *  2. {@link conReintentoConexion} — reintento ACOTADO con espera creciente, **sólo para unidades
 *     de trabajo idempotentes** (lee su aviso: ningún código de error prueba que no se escribió).
 *  3. {@link diagnosticoConexiones} + {@link textoAyudaConexion} — decirle al usuario QUÉ pasó y
 *     QUÉ hacer, en su idioma. Quien corre estos scripts no es un programador de Prisma: un volcado
 *     de quince líneas de `PrismaClientKnownRequestError` no le sirve de nada.
 *
 * ## Por qué `P2028` es el síntoma típico (y por qué NO significa "la base está caída")
 *
 * `P2028` = *"Unable to start a transaction in the given time"*. Prisma lo lanza cuando `$transaction`
 * no consigue una conexión del pool dentro de `maxWait`. O sea: **no es que la base rechace nada, es
 * que no hubo conexión libre a tiempo**. Sus tres causas reales, por frecuencia:
 *
 *  • el cupo del servidor está ocupado (otras sesiones, o sesiones colgadas de una corrida anterior);
 *  • se pidieron más transacciones simultáneas de las que el pool puede sostener;
 *  • el enlace es lento y abrir la conexión tarda más que `maxWait` (el default de Prisma son 2 s,
 *    que por internet se agotan con facilidad — por eso estos scripts lo suben a 20 s).
 *
 * ⚠️ **Y la trampa que costó una tarde:** subir `maxWait` en el cliente NO sirve de nada si los
 * servicios de dominio no reciben ese cliente. `enTransaccion` (ver `src/comun/transaccion.ts`) abre
 * la transacción contra `bd.cliente` **o, si no se lo pasan, contra el singleton de `src/datos`**,
 * que nace SIN opciones (maxWait 2 s, pool por omisión). Un script que llama al dominio sin su
 * `ContextoBd` escribe por un pool que él nunca configuró — y además abre un SEGUNDO pool contra la
 * misma base. Si tocas un script de migración: pásale `{ cliente }` a cada llamada de dominio.
 */
import type { PrismaClient } from '../../src/datos/index.js';

import { esErrorTransitorioConexion } from './reintentos.js';

/**
 * Códigos de Prisma que delatan un problema de CONEXIÓN (no de datos):
 *
 *  • `P2028` — no hubo conexión libre dentro de `maxWait` (el caso típico, ver la cabecera).
 *  • `P2037` — el servidor rechazó la conexión por cupo (*"too many clients already"*).
 *  • `P1001` — no se alcanzó el servidor.
 *  • `P1002` — el servidor se alcanzó pero expiró el tiempo de conexión.
 *  • `P1017` — el servidor cerró la conexión.
 */
const CODIGOS_CONEXION = ['P2028', 'P2037', 'P1001', 'P1002', 'P1017'] as const;

/** Lee el `code` de un error de Prisma (o `null` si no lo trae). */
function codigoPrisma(error: unknown): string | null {
  if (error === null || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

/**
 * `true` si el error es de CONEXIÓN: uno de {@link CODIGOS_CONEXION}, o un corte transitorio del
 * enlace a media operación (`ECONNRESET`, *socket hang up*…, ver `comun/reintentos.ts`).
 *
 * ## ⛔ LO QUE ESTE PREDICADO **NO** SIGNIFICA (y aquí está la trampa)
 *
 * NO significa «no se escribió nada, puedes reintentar tranquilo». **Ninguno de estos códigos lo
 * garantiza**, ni siquiera los que suenan a "no se pudo ni empezar":
 *
 * > `crearOC` (`src/dominio/compras/ordenes-compra.ts`) abre su transacción, la **commitea**, y
 * > DESPUÉS lee la orden recién creada para devolverla. Si el cupo se agota en ESA lectura, el
 * > error es `P2037` — con la orden ya guardada. Se midió: reintentar ahí dejó **cuatro órdenes de
 * > compra duplicadas**, con cuatro folios quemados (ver la nota larga en `migracion/demo/sembrar.ts`).
 *
 * ⇒ Usa {@link conReintentoConexion} **sólo sobre unidades de trabajo IDEMPOTENTES**: las que
 * vuelven a comprobar por mapeo (o por índice único) si lo suyo ya existe, ANTES de crearlo. Para
 * lo que no es idempotente no hay predicado que valga: se deja caer y se vuelve a correr el script.
 */
export function esErrorDeConexion(error: unknown): boolean {
  const codigo = codigoPrisma(error);
  if (codigo !== null && (CODIGOS_CONEXION as readonly string[]).includes(codigo)) return true;
  return esErrorTransitorioConexion(error);
}

/** Pausa `ms` milisegundos. */
function dormir(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Opciones de {@link conReintentoConexion}. */
export interface OpcionesReintentoConexion {
  /** Número TOTAL de intentos (el primero incluido). Default 4. */
  maxIntentos?: number;
  /** Base de la espera creciente, en ms: se espera `baseMs × intento`. Default 2000. */
  baseMs?: number;
  /** Se llama antes de cada espera, para avisar por consola. */
  alReintentar?: (info: { intento: number; maxIntentos: number; esperaMs: number }) => void;
}

/**
 * Ejecuta `accion` reintentando ante tropiezos de CONEXIÓN, con espera creciente y un tope de
 * intentos. Cualquier otro error (validación, conflicto de negocio, dato malo) se relanza de
 * inmediato: reintentarlo sólo escondería el problema.
 *
 * 🔴 `accion` DEBE SER IDEMPOTENTE: se puede ejecutar dos veces sin duplicar nada. Ver el aviso de
 * {@link esErrorDeConexion} — un error de conexión NO prueba que la escritura no haya ocurrido.
 *
 * ## Por qué esto no es `conReintentoTransitorio` (`comun/reintentos.ts`)
 *
 * Aquel **sí se reusa**: es el que aporta los patrones de texto (`ECONNRESET`, *socket hang up*…) a
 * {@link esErrorDeConexion}. Lo que no sirve es su función de reintento, por tres motivos:
 *  • **No reconoce los códigos de Prisma.** Casa por TEXTO del mensaje, y `P2028` —el error de esta
 *    fila— no dice nada parecido a «connection reset»: su mensaje es *«Unable to start a transaction
 *    in the given time»*. Se le escaparía justo el caso que hay que atrapar.
 *  • **Su espera es demasiado corta** para esto: 3 intentos con 500 ms × intento (1.5 s en total),
 *    pensados para un corte de socket en una corrida larga. Un pico de ocupación del cupo de
 *    conexiones tarda más en pasar; aquí son 4 intentos con 2 s × intento (12 s).
 *  • **No avisa.** No tiene gancho para decirle al usuario que se está reintentando, y sin eso una
 *    corrida lenta parece colgada.
 *
 * Con los valores por omisión son 4 intentos con esperas de 2 s, 4 s y 6 s (12 s de margen en
 * total), que es justo lo que hace falta para sobrevivir a un pico de ocupación del cupo sin dejar
 * al usuario mirando una pantalla quieta durante minutos.
 */
export async function conReintentoConexion<T>(
  accion: () => Promise<T>,
  opciones?: OpcionesReintentoConexion,
): Promise<T> {
  const maxIntentos = opciones?.maxIntentos ?? 4;
  const baseMs = opciones?.baseMs ?? 2000;
  let ultimoError: unknown;
  for (let intento = 1; intento <= maxIntentos; intento += 1) {
    try {
      return await accion();
    } catch (error) {
      ultimoError = error;
      if (intento === maxIntentos || !esErrorDeConexion(error)) throw error;
      const esperaMs = baseMs * intento;
      opciones?.alReintentar?.({ intento, maxIntentos, esperaMs });
      await dormir(esperaMs);
    }
  }
  // Inalcanzable (el bucle siempre retorna o relanza), pero satisface el tipo.
  throw ultimoError;
}

// ── Diagnóstico del cupo de conexiones ───────────────────────────────────────────────────────────

/** Cuántas conexiones hay y de qué tipo, contra el tope del servidor. */
export interface DiagnosticoConexiones {
  /** `max_connections` del servidor (tope TOTAL, compartido con el backend desplegado). */
  maximo: number;
  /** Conexiones abiertas ahora mismo contra ESTA base. */
  total: number;
  /** Desglose por estado (`active`, `idle`, `idle in transaction`…). */
  porEstado: { estado: string; cuantas: number }[];
}

/**
 * Lee el cupo de conexiones del servidor y cuántas hay ocupadas contra esta base. Es SÓLO lectura
 * y nunca tumba la corrida: si algo falla (permisos, vista no disponible), devuelve `null`.
 *
 * Se llama al ARRANCAR el script para que el usuario vea la causa ANTES del fallo, y otra vez al
 * fallar, para que el mensaje de ayuda pueda decir con números por qué no hubo conexión.
 */
export async function diagnosticoConexiones(
  cliente: PrismaClient,
): Promise<DiagnosticoConexiones | null> {
  try {
    const [cupo] = await cliente.$queryRaw<{ maximo: number }[]>`
      select current_setting('max_connections')::int as maximo
    `;
    const filas = await cliente.$queryRaw<{ estado: string; cuantas: number }[]>`
      select coalesce(state, 'sin estado') as estado, count(*)::int as cuantas
      from pg_stat_activity
      where datname = current_database()
      group by 1
      order by 2 desc
    `;
    if (cupo === undefined) return null;
    return {
      maximo: cupo.maximo,
      total: filas.reduce((a, f) => a + f.cuantas, 0),
      porEstado: filas,
    };
  } catch {
    // El diagnóstico es un EXTRA: si no se puede leer, la corrida sigue igual.
    return null;
  }
}

/** Una línea legible con el estado del cupo (la imprime el script al arrancar). */
export function textoDiagnostico(d: DiagnosticoConexiones): string {
  const desglose = d.porEstado.map((e) => `${String(e.cuantas)} ${e.estado}`).join(', ');
  return `Conexiones a la base: ${String(d.total)} ocupadas de ${String(d.maximo)} (${desglose || 'ninguna'}).`;
}

/**
 * ¿Hay sesiones `idle in transaction`? Son las que deja una corrida que murió a media transacción:
 * Postgres NO las recicla solo, y se quedan comiendo cupo hasta que alguien las corta.
 */
export function hayColgadas(d: DiagnosticoConexiones): number {
  return d.porEstado
    .filter((e) => e.estado.startsWith('idle in transaction'))
    .reduce((a, e) => a + e.cuantas, 0);
}

/**
 * El mensaje que ve el usuario cuando se agotaron los reintentos: **qué pasó, por qué, y qué hacer**.
 * En español y sin jerga de Prisma — quien corre este script no es programador. El volcado técnico
 * NO desaparece: el script lo imprime aparte, para que sirva si hay que reportarlo.
 */
export function textoAyudaConexion(opciones: {
  /** Cómo se llama el script, para poder repetir el comando tal cual. */
  comando: string;
  /** Con qué concurrencia se corrió (para sugerir bajarla). */
  concurrencia: number;
  /** El diagnóstico leído al fallar, si se pudo leer. */
  diagnostico: DiagnosticoConexiones | null;
}): string {
  const l: string[] = [];
  l.push('');
  l.push('🔴 NO SE PUDO CONECTAR A LA BASE PARA SEGUIR ESCRIBIENDO.');
  l.push('');
  l.push('   Qué pasó: la base no dio una conexión libre a tiempo, ni siquiera tras varios');
  l.push('   reintentos. NO es que tus datos estén mal: es un problema de CUPO o de RED.');
  l.push('   Lo que ya se había sembrado quedó guardado; nada se dejó a medias (cada paso');
  l.push('   va en su propia transacción, y volver a correr el script retoma donde se quedó).');
  l.push('');

  const d = opciones.diagnostico;
  if (d !== null) {
    l.push(`   Estado del cupo ahora: ${textoDiagnostico(d)}`);
    const colgadas = hayColgadas(d);
    if (colgadas > 0) {
      l.push('');
      l.push(
        `   ⚠️  Hay ${String(colgadas)} conexión(es) en "idle in transaction". Suelen ser restos`,
      );
      l.push('      de una corrida anterior que murió a media escritura. Postgres NO las cierra');
      l.push('      solo: siguen ocupando cupo hasta que alguien las corta.');
    } else if (d.total >= d.maximo - 2) {
      l.push('');
      l.push('   ⚠️  El cupo del servidor está prácticamente lleno. Recuerda que lo comparten');
      l.push('      el backend desplegado y su cola de eventos, no sólo este script.');
    }
  } else {
    l.push('   (No se pudo leer el estado del cupo: la base no respondió ni a eso.)');
  }

  l.push('');
  l.push('   QUÉ HACER, en este orden:');
  l.push('');
  l.push('   1) Vuelve a correrlo tal cual. Es idempotente: no duplica lo ya sembrado y');
  l.push('      continúa donde se quedó. Muchas veces el pico de ocupación ya pasó.');
  l.push('');
  l.push(
    `   2) Si vuelve a fallar, bájale la concurrencia (ahora iba en ${String(opciones.concurrencia)}):`,
  );
  l.push('');
  l.push(`         ${opciones.comando} -- --concurrencia=1`);
  l.push('');
  l.push('      Con 1 va de uno en uno: tarda más, pero usa una sola conexión y es lo más');
  l.push('      resistente que hay. Es la opción a usar cuando la base va apretada.');
  l.push('');
  l.push('   3) Si ves conexiones colgadas ("idle in transaction") y siguen ahí tras unos');
  l.push('      minutos, hay que cortarlas desde la consola de la base, o reiniciar el');
  l.push('      servicio de Postgres para que suelte todo. Después vuelve al paso 1.');
  l.push('');
  return l.join('\n');
}
