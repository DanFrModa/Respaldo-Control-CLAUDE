/**
 * DIAGNÓSTICO DE INFRAESTRUCTURA (transversal): almacenamiento de archivos + respaldo mensual.
 *
 * Por qué es un servicio y no una ruta con dos `if`: porque responde preguntas que hoy sólo sabía
 * responder quien tuviera acceso a Railway Y a Cloudflare Y ganas de leer logs — «¿por qué no se
 * suben las fotos?» y «¿de verdad se está respaldando la base?». Ese conocimiento estaba repartido
 * entre la guía de despliegue, la ficha de una etapa de junio y la cabeza de dos personas.
 *
 * Lo que hace, en orden:
 *   1. `comun/diagnostico-r2.ts` prueba el almacenamiento DE VERDAD (escribe, lee, borra y dispara
 *      el preflight CORS que haría el navegador). No simula: si esto pasa, subir una foto pasa.
 *   2. Lee la decisión de arranque del respaldo (`comun/respaldo/config.ts`, la MISMA función que usa
 *      el servidor al levantar — no una copia que se pueda desincronizar) y la contrasta con las
 *      últimas corridas reales de `RespaldoCorrida`.
 *
 * A1: aquí está el criterio (qué significa cada resultado, qué veredicto se emite); la ruta sólo
 * autoriza y entrega. Solo LECTURA, salvo `pedirRespaldoAhora`, que encola una corrida.
 */
import { COLAS_JOBS, encolarJob, motorJobs } from '../../comun/jobs/index.js';
import { registrarBitacora } from '../../comun/auditoria.js';
import { diagnosticarR2 } from '../../comun/diagnostico-r2.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { enTransaccion } from '../../comun/transaccion.js';
import { decidirArranqueRespaldo } from '../../comun/respaldo/config.js';
import { prisma } from '../../datos/index.js';
import type { Diagnostico, RespaldoEncolado } from '../../contrato/index.js';

/** Cuántas corridas del respaldo se muestran (un año de corridas mensuales cabe de sobra). */
const CORRIDAS_MOSTRADAS = 12;

/**
 * Traduce el cron a una frase. Sólo cubre la forma que usamos (`m h dom * *` y `m h * * *`); para
 * cualquier otra devuelve el cron tal cual, que es más honesto que inventar una traducción.
 *
 * La hora se da TAMBIÉN en hora del centro de México (UTC-6 todo el año desde que el país suprimió
 * el horario de verano en 2022) porque «08:00 UTC» no le dice nada a quien opera el sistema.
 */
export function describirCron(cron: string): string {
  const partes = cron.trim().split(/\s+/);
  if (partes.length !== 5) {
    return cron;
  }
  const [minuto, hora, diaMes, mes, diaSemana] = partes;
  const horaNum = Number(hora);
  const minutoNum = Number(minuto);
  if (!Number.isInteger(horaNum) || !Number.isInteger(minutoNum)) {
    return cron;
  }
  const dosDigitos = (n: number): string => String(n).padStart(2, '0');
  const horaLocal = (horaNum + 24 - 6) % 24;
  const reloj = `${dosDigitos(horaNum)}:${dosDigitos(minutoNum)} UTC (${dosDigitos(horaLocal)}:${dosDigitos(minutoNum)} del centro de México)`;

  if (mes === '*' && diaSemana === '*' && diaMes === '*') {
    return `Todos los días a las ${reloj}`;
  }
  if (mes === '*' && diaSemana === '*' && /^\d+$/.test(diaMes ?? '')) {
    return `El día ${String(Number(diaMes))} de cada mes a las ${reloj}`;
  }
  return cron;
}

/**
 * Corre el diagnóstico completo.
 *
 * @param origenes Orígenes públicos del frontend a validar contra la política CORS del bucket. El
 *                 PRIMERO es el que se prueba con el preflight: la ruta pone ahí el origen desde el
 *                 que el usuario está entrando AHORA, que es el único que importa para su problema.
 */
export async function diagnosticarSistema(origenes: string[]): Promise<Diagnostico> {
  const almacenamiento = await diagnosticarR2(origenes);
  const decision = decidirArranqueRespaldo();

  const corridas = await prisma.respaldoCorrida.findMany({
    orderBy: { id: 'desc' },
    take: CORRIDAS_MOSTRADAS,
    select: {
      id: true,
      iniciadoEn: true,
      terminadoEn: true,
      estado: true,
      paso: true,
      key: true,
      tamanoSubidoBytes: true,
      sha256: true,
      error: true,
    },
  });

  const estado =
    decision.accion === 'programar'
      ? ('programado' as const)
      : decision.accion === 'apagado'
        ? ('apagado' as const)
        : ('sin-configurar' as const);

  const ultima = corridas[0];
  const huboExito = corridas.some((c) => c.estado === 'EXITO');

  let veredicto: string;
  if (estado === 'sin-configurar') {
    veredicto =
      'NO hay segundo respaldo: falta configuración en el servidor. Mientras tanto, lo único que ' +
      'protege la base son los respaldos de Railway — que no sirven de nada si el problema ES ' +
      'Railway (cuenta suspendida, servicio borrado, mudanza).';
  } else if (estado === 'apagado') {
    veredicto =
      'El respaldo propio está APAGADO a propósito (RESPALDO_ACTIVO=false). Este ambiente sólo ' +
      'tiene los respaldos de Railway.';
  } else if (!almacenamiento.pruebas.some((p) => p.clave === 'escritura' && p.estado === 'ok')) {
    veredicto =
      'El respaldo está programado, pero el servidor NO puede escribir en el bucket: la próxima ' +
      'corrida va a fallar. Arregla primero el almacenamiento (arriba).';
  } else if (ultima?.estado === 'FALLO') {
    veredicto = `El respaldo está programado, pero la última corrida FALLÓ en el paso ${ultima.paso}. Revisa el detalle abajo.`;
  } else if (!huboExito) {
    veredicto =
      'El respaldo quedó programado y bien configurado, pero todavía no ha corrido ninguna vez. ' +
      'Usa «Respaldar ahora» para comprobarlo hoy en vez de esperar a la próxima corrida.';
  } else {
    veredicto = 'El respaldo mensual está funcionando: hay corridas exitosas registradas.';
  }

  return {
    hora: new Date().toISOString(),
    almacenamiento,
    respaldo: {
      estado,
      mensaje: decision.mensaje ?? 'Configuración completa: el respaldo quedó programado.',
      cron: decision.config?.cron ?? '(sin programar)',
      cuando:
        decision.config === undefined ? '(sin programar)' : describirCron(decision.config.cron),
      retencion: decision.config?.retencion ?? 0,
      ultimasCorridas: corridas.map((c) => ({
        id: String(c.id),
        iniciadoEn: c.iniciadoEn.toISOString(),
        terminadoEn: c.terminadoEn?.toISOString() ?? null,
        estado: c.estado,
        paso: c.paso,
        key: c.key,
        tamanoSubidoBytes: c.tamanoSubidoBytes === null ? null : String(c.tamanoSubidoBytes),
        sha256: c.sha256,
        error: c.error,
      })),
      veredicto,
    },
  };
}

/**
 * Pide una corrida del respaldo AHORA, sin esperar al cron.
 *
 * Existe por la aritmética del respaldo mensual: quien acaba de poner `RESPALDO_LLAVE` no puede
 * quedarse esperando semanas para saber si sirvió, y «esperar a ver» es exactamente cómo un respaldo
 * roto pasa medio año sin que nadie lo note. No corre el volcado dentro de la petición HTTP (un
 * `pg_dump` de la base entera tarda minutos): lo ENCOLA en el mismo worker del respaldo programado,
 * así que lo que se prueba es EL camino real, no un ensayo parecido.
 */
export async function pedirRespaldoAhora(sesion: SesionUsuario): Promise<RespaldoEncolado> {
  const decision = decidirArranqueRespaldo();
  if (decision.accion !== 'programar') {
    return {
      encolado: false,
      mensaje: `No se puede respaldar: ${decision.mensaje ?? 'el respaldo no está configurado.'}`,
    };
  }
  if (motorJobs() === null) {
    return {
      encolado: false,
      mensaje:
        'No se puede respaldar: el motor de tareas en segundo plano no está disponible en este ' +
        'servidor (no levantó al arrancar, o JOBS_ACTIVOS=false). Reinicia el backend con la base ' +
        'alcanzable.',
    };
  }

  // El worker de esta cola sólo existe si el respaldo quedó programado al arrancar; encolar sin él
  // dejaría el job esperando para siempre. La comprobación de arriba lo cubre: la MISMA condición
  // que programa el worker es la que deja pasar esta petición.
  const idJob = await encolarJob(COLAS_JOBS.respaldoBd, 0, { origen: 'manual' });

  await enTransaccion(async (tx) => {
    await registrarBitacora(tx, sesion, {
      entidad: 'RespaldoBd',
      idEntidad: idJob ?? 'manual',
      accion: 'OTRO',
      datos: { motivo: 'Respaldo pedido a mano desde el diagnóstico del sistema.' },
    });
  });

  return {
    encolado: true,
    mensaje:
      'Respaldo encolado. Tarda lo que tarde el volcado de la base (minutos, según su tamaño): ' +
      'vuelve a correr el diagnóstico en un rato y búscalo en las últimas corridas.',
  };
}
