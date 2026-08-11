/**
 * Loader del ARCHIVO HISTÓRICO DE ÓRDENES del sistema viejo (§Post-F9.26).
 *
 * Daniel (10-ago-2026): *"me gustaría tenerlas también como archivo histórico de órdenes. Normalmente
 * cuando queremos consultar algo de información, lo hacemos más desde las órdenes de producción que
 * del catálogo de modelos. Para poder buscar por cliente, número de modelo, tipo de prenda, fecha de
 * producción, maquilero, etc."*
 *
 * QUÉ CARGA: las órdenes del viejo **sin ventana de años**, su matriz color×talla y sus movimientos
 * de producción (corte, envío/recibo de costura y de estampado). Es lo ÚNICO del ETL que ignora a
 * propósito la ventana de 2025-2026 (§Post-F9.24) — precisamente porque su razón de existir es
 * guardar lo que la ventana deja fuera.
 *
 * SON LAS 5,451 DEL DUMP, TODAS (§Post-F9.29, 11-ago-2026). Antes eran 3,923: las órdenes cuya
 * `IdEmpresas` no mapea se saltaban, y **las 6 empresas viejas inactivas NO migran** (decisión de
 * Gabriel del 17-jun-2026, `docs/hoja-de-ruta/F2-etapas.md`), así que se caían **1,528 órdenes** con
 * sus 10,497 celdas y 9,204 movimientos — y **1,523 de ellas son de 2005-2012**, justo la historia
 * más vieja, que es la razón de ser del archivo. Daniel: *"sí, está bien, rescata todas y solo pon en
 * algún lugar la empresa a la que correspondía."* Ahora esas órdenes **se cuelgan de la empresa
 * principal** (`idEmpresa` es FK real y el listado filtra por la empresa activa, A9) y conservan en
 * `empresaV1` el nombre de la empresa a la que pertenecían — el mismo criterio que los talleres de
 * §Post-F9.27: el dato viejo se guarda en TEXTO, ligado a nada. Medido sobre el dump: 5,451 órdenes ·
 * 39,853 celdas · 35,296 movimientos = 80,600 renglones.
 *
 * `empresaV1` se llena en TODAS las órdenes, no solo en las rescatadas: si solo lo trajeran esas, un
 * valor vacío sería ambiguo (¿es de la empresa activa, o el CSV no traía nombre?).
 *
 * LAS DOS REGLAS QUE LO MANTIENEN INOCUO (ver el encabezado del modelo en `schema.prisma`):
 *  1. **Los terceros se resuelven a TEXTO aquí**, leyendo los CSV del viejo — NO se tocan los
 *     catálogos de v2. Un taller que no sobrevivió a la depuración (§Post-F9.23) aparece con su
 *     nombre escrito, y no revive como `Proveedor`.
 *  2. **Solo el MODELO se liga de verdad** (`idModelo`), porque los modelos migran completos: es lo
 *     que permite filtrar el archivo por tipo de prenda y género sin copiar esos campos.
 *
 * ESCRITURA DIRECTA CON PRISMA, no vía dominio (excepción consciente a A1): este archivo no tiene
 * reglas de negocio que proteger — no hay folios, ni kardex, ni existencias, ni estados. El dominio
 * solo lo LEE. Meterle una capa de dominio de escritura sería ceremonia sobre un `INSERT`.
 *
 * POR LOTES (regla de Gabriel, 19-jun): son 80,600 renglones entre los tres modelos; se escriben con
 * `createMany` en tandas, nunca uno por uno.
 *
 * IDEMPOTENTE, y en los dos sentidos: la llave es `(idEmpresa, idOrdenV1)`, así que re-correrlo no
 * duplica; y re-correrlo además **COMPLETA lo que falte**. Cabecera e hijos de cada tanda de órdenes
 * viajan en la MISMA transacción, y al arrancar se detectan las órdenes que quedaron sin detalle por
 * una corrida interrumpida (antes: si la carga se caía después de las cabeceras, esas órdenes se
 * quedaban sin una sola celda ni proceso para siempre, porque la re-corrida las daba por cargadas).
 */
import type { Prisma, PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import { cargarMapaNumerico, ENTIDAD_MAPEO, type ClienteMapeo } from '../comun/mapeo.js';
import type { Reporte } from '../comun/reporte.js';
import { despivotarRenglon, mapaColumnasTalla } from '../comun/tallas-orden.js';
import { parsearBandera, parsearEntero, parsearFecha, parsearTexto } from '../comun/valores.js';

/** Tamaño de tanda de `createMany`. Alto a propósito: son filas planas, sin FKs que resolver. */
const LOTE = 2000;

/** Resultado del loader, para el resumen del ETL. */
export interface ResultadoHistoricoOrdenes {
  /** Órdenes históricas insertadas en esta corrida. */
  ordenes: number;
  /** Órdenes que ya existían (re-corrida idempotente). */
  existentes: number;
  /**
   * Órdenes de las 6 empresas muertas del viejo RESCATADAS en esta corrida (§Post-F9.29): se
   * cargaron colgadas de la empresa principal, conservando su empresa original en `empresaV1`.
   * Antes este contador era `sinEmpresa` y contaba las que se OMITÍAN; ya no se omite ninguna.
   */
  rescatadas: number;
  /** Celdas color×talla insertadas. */
  celdas: number;
  /** Movimientos de producción insertados. */
  procesos: number;
  /** Órdenes cuyo modelo no se pudo mapear (quedan con el código en texto). */
  sinModelo: number;
  /** Órdenes que ya estaban SIN su detalle (corrida anterior interrumpida) y se completaron. */
  reparadas: number;
}

/** Lee un CSV de catálogo y devuelve `id viejo → nombre`, saltando ids vacíos. */
function mapaNombres(archivo: string, campoId: string, campoNombre: string): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const fila of leerCsv(archivo)) {
    const id = (fila[campoId] ?? '').trim();
    const nombre = (fila[campoNombre] ?? '').trim();
    if (id !== '' && nombre !== '') mapa.set(id, nombre);
  }
  return mapa;
}

/** Nombre completo de un maquilero (`Nombre` + `Apellidos`), que en el viejo van separados. */
function mapaMaquileros(): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const fila of leerCsv('Maquileros.csv')) {
    const id = (fila.IdMaquileros ?? '').trim();
    const nombre = `${(fila.Nombre ?? '').trim()} ${(fila.Apellidos ?? '').trim()}`.trim();
    // Si no tiene nombre se cae al código corto: peor es dejar el renglón mudo.
    const texto = nombre !== '' ? nombre : (fila.Corto ?? '').trim();
    if (id !== '' && texto !== '') mapa.set(id, texto);
  }
  return mapa;
}

/** Las 8 cantidades `T1..T8` de un renglón de `OrdenesDet`, como números. */
function cantidadesDeRenglon(fila: Record<string, string>): (number | null)[] {
  return Array.from({ length: 8 }, (_, i) => parsearEntero(fila[`T${String(i + 1)}`]));
}

/** Un movimiento de producción leído de su CSV, ya listo para insertar. */
export interface ProcesoCrudo {
  idOrdenV1: string;
  tipo: Prisma.HistoricoOrdenV1ProcesoCreateManyInput['tipo'];
  fecha: Date | null;
  tercero: string | null;
  cantidad: number;
  observaciones: string | null;
}

/**
 * Lee un CSV de producción (corte/entregas/recibos) y lo normaliza a `ProcesoCrudo`, resolviendo el
 * nombre del tercero contra el mapa que le corresponda.
 */
function leerProcesos(
  archivo: string,
  tipo: ProcesoCrudo['tipo'],
  campoTercero: string,
  nombres: Map<string, string>,
): ProcesoCrudo[] {
  const salida: ProcesoCrudo[] = [];
  for (const fila of leerCsv(archivo)) {
    const idOrdenV1 = (fila.IdOrdenes ?? '').trim();
    if (idOrdenV1 === '') continue;
    const idTercero = (fila[campoTercero] ?? '').trim();
    salida.push({
      idOrdenV1,
      tipo,
      fecha: parsearFecha(fila.Fecha),
      tercero: nombres.get(idTercero) ?? null,
      cantidad: parsearEntero(fila.Cantidad) ?? 0,
      observaciones: parsearTexto(fila.Observaciones),
    });
  }
  return salida;
}

/**
 * Nombres DISTINTOS de los terceros de ciertos tipos de proceso, unidos por " · " (§Post-F9.27).
 *
 * Daniel: *"es importante que vayan todos. Y no solo el primero."* Una orden pasa por varios
 * talleres —se cosen partidas en dos o tres, se estampa en otro—, y la cabecera solo guarda al
 * primero. Esto arma el campo abierto donde se ven y se buscan TODOS.
 *
 * Se ordenan alfabéticamente para que dos corridas den exactamente el mismo texto (el orden en que
 * vienen los CSV no es estable, y un archivo que cambia de texto entre corridas es un archivo que
 * no se puede diffear).
 */
export function nombresDistintos(
  procesos: readonly ProcesoCrudo[],
  tipos: readonly ProcesoCrudo['tipo'][],
): string | null {
  const nombres = new Set<string>();
  for (const p of procesos) {
    if (p.tercero !== null && p.tercero !== '' && tipos.includes(p.tipo)) nombres.add(p.tercero);
  }
  if (nombres.size === 0) return null;
  return [...nombres].sort((a, b) => a.localeCompare(b, 'es')).join(' · ');
}

/** Celda color×talla ya despivotada, antes de conocer el id nuevo de su orden. */
interface CeldaCruda {
  color: string;
  talla: string;
  cantidad: number;
}

/** Una orden con TODO su detalle, lista para escribirse (cabecera + hijos van juntos). */
interface TrabajoOrden {
  idOrdenV1: string;
  cabecera: Prisma.HistoricoOrdenV1CreateManyInput;
  celdas: CeldaCruda[];
  procesos: ProcesoCrudo[];
}

/** Lo que le falta a una orden YA cargada (re-corrida después de una caída a media carga). */
interface Reparacion {
  idOrden: number;
  celdas: CeldaCruda[];
  procesos: ProcesoCrudo[];
}

/**
 * Cuántas órdenes (con sus hijos) van por TRANSACCIÓN. Cada tanda entra COMPLETA o no entra:
 * cabeceras, celdas y procesos de esas órdenes se escriben en la misma transacción, para que una
 * caída a media carga (son 80,600 renglones, y Railway rota contraseñas) no pueda dejar órdenes sin
 * detalle. Bajo a propósito frente al `LOTE` de filas: una tanda son ~250 cabeceras + sus ~2,000
 * celdas + sus ~1,500 procesos.
 */
const ORDENES_POR_TX = 250;

/**
 * Opciones de cada transacción de carga. Explícitas porque la BD está del otro lado de la red
 * (Railway) y los defaults de Prisma (maxWait 2 s / timeout 5 s) dan `P2028` con tandas de miles de
 * filas. Es el mismo criterio con el que el script del ETL crea su cliente.
 */
const OPCIONES_TX = { maxWait: 20_000, timeout: 120_000 } as const;

/** Inserta en tandas (nunca fila por fila — regla de Gabriel). Devuelve cuántas filas ENTRARON. */
async function insertarEnTandas<T>(
  filas: T[],
  escribir: (tanda: T[]) => Promise<{ count: number }>,
): Promise<number> {
  let escritas = 0;
  for (let i = 0; i < filas.length; i += LOTE) {
    escritas += (await escribir(filas.slice(i, i + LOTE))).count;
  }
  return escritas;
}

/** La empresa de la que cuelgan las órdenes rescatadas, y por qué se eligió (para el reporte). */
interface EmpresaPrincipal {
  id: number;
  /** Cómo se resolvió, para que el reporte lo diga en vez de dejarlo a la adivinanza. */
  criterio: string;
}

/**
 * Resuelve la empresa PRINCIPAL: de ella cuelgan las órdenes de las 6 empresas que no migran
 * (§Post-F9.29). No es una empresa "histórica" nueva —crear una sería reabrir justo lo que la
 * decisión de Gabriel del 17-jun cerró—, sino la empresa VIVA del grupo.
 *
 * Es **FR Moda**: es la del seed F0, la favorita, la que el resto del ETL usa para los almacenes
 * (`loaders/empresas.ts` la busca igual: por nombre y, si no, la favorita) y la que la gente tiene
 * activa al entrar — y como el listado del archivo filtra por la empresa activa (A9), colgarlas de
 * cualquier otra sería rescatarlas para que nadie las vea. Marilyn Fitness es la MISMA empresa
 * renombrada (CLAUDE.md §8), así que la elección no separa dos negocios: solo elige el nombre vivo.
 *
 * El tercer escalón (la primera empresa del mapeo, por id) es para los ambientes de prueba, donde la
 * empresa no se llama "FR Moda" ni hay favorita. Va ordenado para ser DETERMINISTA.
 */
async function resolverEmpresaPrincipal(
  cli: PrismaClient,
  mapaEmpresa: Map<string, number>,
): Promise<EmpresaPrincipal | null> {
  const frModa = await cli.empresa.findFirst({
    where: { nombre: { equals: 'FR Moda', mode: 'insensitive' } },
    select: { id: true },
  });
  if (frModa !== null) return { id: frModa.id, criterio: 'FR Moda (por nombre)' };

  const favorita = await cli.empresa.findFirst({ where: { favorita: true }, select: { id: true } });
  if (favorita !== null) return { id: favorita.id, criterio: 'la empresa favorita' };

  const [primera] = [...mapaEmpresa.values()].sort((a, b) => a - b);
  if (primera !== undefined) {
    return { id: primera, criterio: 'la primera empresa del mapeo (no hay FR Moda ni favorita)' };
  }
  return null;
}

/** Proyecta los procesos de una orden a las filas de `HistoricoOrdenV1Proceso`. */
function aFilasProceso(
  idOrden: number,
  procesos: readonly ProcesoCrudo[],
): Prisma.HistoricoOrdenV1ProcesoCreateManyInput[] {
  return procesos.map((p) => ({
    idOrden,
    tipo: p.tipo,
    fecha: p.fecha,
    tercero: p.tercero,
    cantidad: p.cantidad,
    observaciones: p.observaciones,
  }));
}

export async function cargarHistoricoOrdenes(
  cliente: ClienteMapeo,
  reporte: Reporte,
): Promise<ResultadoHistoricoOrdenes> {
  const cli = cliente as PrismaClient;

  const mapaEmpresa = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.empresa);
  const mapaModelo = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.modelo);

  // Catálogos del VIEJO resueltos a texto (regla 1): jamás se consultan los catálogos de v2.
  const clientes = mapaNombres('Clientes.csv', 'IdClientes', 'Cliente');
  // §Post-F9.29 — las 8 empresas del viejo por su nombre, incluidas las 6 que no migran: es lo que
  // conserva de quién era cada orden rescatada.
  const empresasV1 = mapaNombres('Empresas.csv', 'IdEmpresas', 'Empresa');
  const etiquetas = mapaNombres('EtiquetasM.csv', 'IdEtiquetasM', 'EtiquetaM');
  const telas = mapaNombres('TelasDis.csv', 'IdTelasDis', 'TelaDis');
  const modelosV1 = mapaNombres('Modelos.csv', 'IdModelos', 'Modelo');
  const maquileros = mapaMaquileros();
  const cortadores = mapaNombres('Cortadores.csv', 'IdCortadores', 'Cortador');

  const resultado: ResultadoHistoricoOrdenes = {
    ordenes: 0,
    existentes: 0,
    rescatadas: 0,
    celdas: 0,
    procesos: 0,
    sinModelo: 0,
    reparadas: 0,
  };

  // ⚠️ EL ORDEN IMPORTA, Y DESDE §Post-F9.29 IMPORTA MÁS: este ETL va DESPUÉS de `etl-catalogos`.
  //
  // Sin mapeos de empresa, `mapaEmpresa` queda VACÍO (`cargarMapaNumerico` no falla: devuelve un Map
  // vacío), y como el rescate ya no salta nada, las 5,451 órdenes se cargarían como "rescatadas"
  // colgadas de la principal —incluidas las que tenían su propia empresa— y todas con `idModelo`
  // nulo. Y **re-correrlo NO lo repara**: la idempotencia da por cargada toda orden que ya existe y
  // solo le completa celdas y procesos; la cabecera no se vuelve a escribir nunca. Habría que
  // vaciar las tres tablas a mano.
  //
  // Antes del rescate este error era inocuo (se saltaban todas y no se escribía nada): la protección
  // era un accidente del filtro que se quitó, así que aquí va explícita.
  if (mapaEmpresa.size === 0) {
    throw new Error(
      'No hay mapeos de empresa: corre `etl-catalogos` antes que el archivo histórico. Si no, ' +
        'TODAS las órdenes se cargarían como rescatadas (colgadas de una sola empresa) y sin ' +
        'modelo ligado — y re-correr el ETL no lo repara: habría que vaciar las tablas del archivo.',
    );
  }
  // De aquí cuelgan las órdenes de las empresas que no migran (§Post-F9.29). Sin ella no hay dónde
  // colgar NADA (el archivo entero necesita una empresa viva), así que se aborta con un mensaje
  // claro en vez de perder 1,528 órdenes en silencio.
  const principal = await resolverEmpresaPrincipal(cli, mapaEmpresa);
  if (principal === null) {
    throw new Error(
      'No hay ninguna empresa en la base de datos: corre `etl-catalogos` antes que el archivo ' +
        'histórico (necesita al menos una empresa viva de la que colgar las órdenes).',
    );
  }
  /** Cuántas órdenes se rescataron de cada empresa vieja (para reportarlo, plan §7). */
  const rescatadasPorEmpresa = new Map<string, number>();

  // Lo que YA está cargado (idempotencia): `idOrdenV1` → id nuevo.
  const yaCargadas = new Map(
    (await cli.historicoOrdenV1.findMany({ select: { id: true, idOrdenV1: true } })).map((o) => [
      o.idOrdenV1,
      o.id,
    ]),
  );
  // …y cuáles de esas ya tienen ESCRITOS sus hijos. Sin esto, la idempotencia solo valía si la
  // corrida terminaba completa: una caída después de las cabeceras (son 80,600 renglones y la BD
  // está del otro lado de la red) dejaba miles de órdenes sin una sola celda ni proceso PARA
  // SIEMPRE, porque re-correr las daba por cargadas e insertaba 0. Ahora re-correr COMPLETA lo que
  // falte. La granularidad es la orden entera, y es exacta porque cabecera e hijos se escriben en la
  // MISMA transacción (ver `ORDENES_POR_TX`): nunca queda una orden a medias.
  const conLineas = new Set(
    (await cli.historicoOrdenV1Linea.groupBy({ by: ['idOrden'] })).map((g) => g.idOrden),
  );
  const conProcesos = new Set(
    (await cli.historicoOrdenV1Proceso.groupBy({ by: ['idOrden'] })).map((g) => g.idOrden),
  );

  // Detalle color×talla agrupado por orden (se lee una vez).
  const detPorOrden = new Map<string, Record<string, string>[]>();
  for (const fila of leerCsv('OrdenesDet.csv')) {
    const idOrd = (fila.IdOrdenes ?? '').trim();
    if (idOrd === '') continue;
    const lista = detPorOrden.get(idOrd) ?? [];
    lista.push(fila);
    detPorOrden.set(idOrd, lista);
  }

  // Movimientos de producción agrupados por orden (los cinco documentos del viejo).
  const procesosPorOrden = new Map<string, ProcesoCrudo[]>();
  for (const p of [
    ...leerProcesos('Corte.csv', 'corte', 'IdCortadores', cortadores),
    ...leerProcesos('Entregas.csv', 'envio_maquila', 'IdMaquileros', maquileros),
    ...leerProcesos('Recibos.csv', 'recibo_maquila', 'IdMaquileros', maquileros),
    // OJO: `EntregasEst`/`RecibosEst` traen la columna `IdMaquileros` pero apuntan al catálogo de
    // MAQUILEROS, no al de Estampadores (verificado en §Post-F9.23). Por eso se resuelven contra
    // el mapa de maquileros.
    ...leerProcesos('EntregasEst.csv', 'envio_estampado', 'IdMaquileros', maquileros),
    ...leerProcesos('RecibosEst.csv', 'recibo_estampado', 'IdMaquileros', maquileros),
  ]) {
    const lista = procesosPorOrden.get(p.idOrdenV1) ?? [];
    lista.push(p);
    procesosPorOrden.set(p.idOrdenV1, lista);
  }

  /** Despivota la matriz color×talla de una orden (reporta la cadena ambigua una sola vez). */
  function celdasDe(f: Record<string, string>, idOrdenV1: string): CeldaCruda[] {
    // Matriz color×talla: se despivota con el MISMO lector posicional de F2 (`Ordenes.Tallas` viene
    // en ventanas fijas de 2 chars). Si la cadena es ambigua se reporta, pero la cantidad NO se
    // pierde: lo dudoso es la etiqueta, no el número.
    const tallas = mapaColumnasTalla(f.Tallas ?? '');
    if (tallas.ambigua) {
      reporte.agregar(
        'Histórico: cadena de tallas ambigua (se despivota igual; revisar etiquetas)',
        `Orden ${(f.Numero ?? '?').trim()} · "${tallas.original}"`,
      );
    }
    const celdas: CeldaCruda[] = [];
    for (const det of detPorOrden.get(idOrdenV1) ?? []) {
      const color = (det.Color ?? '').trim();
      for (const c of despivotarRenglon(cantidadesDeRenglon(det), tallas.porColumna)) {
        celdas.push({
          color: color === '' ? '(sin color)' : color,
          // Sin etiqueta se guarda la columna: "T3" dice más que un vacío.
          talla: c.etiqueta ?? `T${String(c.columna)}`,
          cantidad: c.cantidad,
        });
      }
    }
    return celdas;
  }

  // ── Qué hay que escribir: órdenes NUEVAS y órdenes ya cargadas a las que les FALTA el detalle ──
  const nuevas: TrabajoOrden[] = [];
  const reparaciones: Reparacion[] = [];

  for (const f of leerCsv('Ordenes.csv')) {
    const idOrdenV1 = (f.IdOrdenes ?? '').trim();
    if (idOrdenV1 === '') continue;

    const procesosDeEsta = procesosPorOrden.get(idOrdenV1) ?? [];
    const idYaCargada = yaCargadas.get(idOrdenV1);
    if (idYaCargada !== undefined) {
      resultado.existentes += 1;
      // ¿Le faltan hijos de una corrida anterior interrumpida? Se completa; no se re-inserta lo que
      // ya está (por eso la comprobación es por orden, no por fila).
      //
      // OJO con la condición de las celdas: NO es *"tiene filas en `OrdenesDet`"* sino *"despivotar
      // emite al menos una celda"*. Una orden cuyo detalle está TODO en ceros tiene filas pero no
      // produce ninguna celda (`despivotarRenglon` solo emite cantidades > 0), así que con la
      // condición vieja se contaba como "reparada" en CADA corrida —inflando la nota del reporte—
      // sin insertar una sola fila. Se calculan las celdas de verdad (solo si hace falta: si la
      // orden ya tiene líneas escritas, ni se despivota).
      const tieneDetalle = (detPorOrden.get(idOrdenV1) ?? []).length > 0;
      const celdasFaltantes =
        tieneDetalle && !conLineas.has(idYaCargada) ? celdasDe(f, idOrdenV1) : [];
      const faltanProcesos = procesosDeEsta.length > 0 && !conProcesos.has(idYaCargada);
      if (celdasFaltantes.length > 0 || faltanProcesos) {
        reparaciones.push({
          idOrden: idYaCargada,
          celdas: celdasFaltantes,
          procesos: faltanProcesos ? procesosDeEsta : [],
        });
      }
      continue;
    }

    // §Post-F9.29 — la empresa. Si mapea, se RESPETA la suya (no se reasigna nada que ya esté bien);
    // si no —las 6 empresas muertas del viejo, que no migraron—, la orden se rescata colgándola de la
    // principal. Ninguna se salta: el nombre real viaja en `empresaV1`, que se llena siempre.
    const idEmpresaV1 = (f.IdEmpresas ?? '').trim();
    const empresaV1 = empresasV1.get(idEmpresaV1) ?? null;
    const idEmpresaPropia = mapaEmpresa.get(idEmpresaV1);
    const idEmpresa = idEmpresaPropia ?? principal.id;
    if (idEmpresaPropia === undefined) {
      resultado.rescatadas += 1;
      const clave = `${empresaV1 ?? '(sin nombre en Empresas.csv)'} · Id=${idEmpresaV1 === '' ? '(vacío)' : idEmpresaV1}`;
      rescatadasPorEmpresa.set(clave, (rescatadasPorEmpresa.get(clave) ?? 0) + 1);
    }

    const idModeloV1 = (f.IdModelos ?? '').trim();
    const idModelo = mapaModelo.get(idModeloV1) ?? null;
    if (idModelo === null) resultado.sinModelo += 1;

    const celdas = celdasDe(f, idOrdenV1);
    nuevas.push({
      idOrdenV1,
      celdas,
      procesos: procesosDeEsta,
      cabecera: {
        idEmpresa,
        idOrdenV1,
        numero: (f.Numero ?? '').trim() || idOrdenV1,
        empresaV1,
        fecha: parsearFecha(f.Fecha),
        fechaEntrega: parsearFecha(f.FechaEntrega),
        idModelo,
        codigoModeloV1: modelosV1.get(idModeloV1) ?? null,
        cliente: clientes.get((f.IdClientes ?? '').trim()) ?? null,
        maquilero: maquileros.get((f.IdMaquileros ?? '').trim()) ?? null,
        // §Post-F9.27 — TODOS los que la trabajaron, no solo el de la cabecera.
        cortadores: nombresDistintos(procesosDeEsta, ['corte']),
        maquileros: nombresDistintos(procesosDeEsta, ['envio_maquila', 'recibo_maquila']),
        estampadores: nombresDistintos(procesosDeEsta, ['envio_estampado', 'recibo_estampado']),
        etiquetaMarca: etiquetas.get((f.IdEtiquetasM ?? '').trim()) ?? null,
        tela: telas.get((f.IdTelasDis ?? '').trim()) ?? null,
        composicion: parsearTexto(f.Composicion),
        observaciones: parsearTexto(f.Observaciones),
        cancelada: parsearBandera(f.OrdCancelada),
        motivoCancelada: parsearTexto(f.MotivoCancelada),
        totalPiezas: celdas.reduce((s, c) => s + c.cantidad, 0),
      },
    });
  }

  // ── Escritura: cabecera + hijos JUNTOS, por tandas, cada tanda en UNA transacción ────────────
  for (let i = 0; i < nuevas.length; i += ORDENES_POR_TX) {
    const tanda = nuevas.slice(i, i + ORDENES_POR_TX);
    await cli.$transaction(async (tx) => {
      const creadas = await tx.historicoOrdenV1.createMany({
        data: tanda.map((t) => t.cabecera),
        skipDuplicates: true,
      });
      // Se cuenta lo REALMENTE insertado, no lo intentado: con `skipDuplicates` no es lo mismo.
      resultado.ordenes += creadas.count;

      // Los ids nuevos se leen DENTRO de la transacción, acotados a esta tanda.
      const ids = new Map(
        (
          await tx.historicoOrdenV1.findMany({
            where: { idOrdenV1: { in: tanda.map((t) => t.idOrdenV1) } },
            select: { id: true, idOrdenV1: true },
          })
        ).map((o) => [o.idOrdenV1, o.id]),
      );

      const lineas: Prisma.HistoricoOrdenV1LineaCreateManyInput[] = [];
      const procesos: Prisma.HistoricoOrdenV1ProcesoCreateManyInput[] = [];
      for (const t of tanda) {
        const idOrden = ids.get(t.idOrdenV1);
        if (idOrden === undefined) continue; // inalcanzable: se acaba de insertar.
        for (const c of t.celdas) lineas.push({ idOrden, ...c });
        procesos.push(...aFilasProceso(idOrden, t.procesos));
      }
      resultado.celdas += await insertarEnTandas(lineas, (lote) =>
        tx.historicoOrdenV1Linea.createMany({ data: lote }),
      );
      resultado.procesos += await insertarEnTandas(procesos, (lote) =>
        tx.historicoOrdenV1Proceso.createMany({ data: lote }),
      );
    }, OPCIONES_TX);
  }

  // ── Reparación de corridas anteriores interrumpidas ─────────────────────────
  for (let i = 0; i < reparaciones.length; i += ORDENES_POR_TX) {
    const tanda = reparaciones.slice(i, i + ORDENES_POR_TX);
    await cli.$transaction(async (tx) => {
      const lineas: Prisma.HistoricoOrdenV1LineaCreateManyInput[] = [];
      const procesos: Prisma.HistoricoOrdenV1ProcesoCreateManyInput[] = [];
      for (const r of tanda) {
        for (const c of r.celdas) lineas.push({ idOrden: r.idOrden, ...c });
        procesos.push(...aFilasProceso(r.idOrden, r.procesos));
      }
      resultado.celdas += await insertarEnTandas(lineas, (lote) =>
        tx.historicoOrdenV1Linea.createMany({ data: lote }),
      );
      resultado.procesos += await insertarEnTandas(procesos, (lote) =>
        tx.historicoOrdenV1Proceso.createMany({ data: lote }),
      );
    }, OPCIONES_TX);
  }
  if (reparaciones.length > 0) {
    resultado.reparadas = reparaciones.length;
    reporte.nota(
      `Histórico: ${String(reparaciones.length)} órdenes que ya estaban cargadas SIN su detalle ` +
        `(corrida anterior interrumpida) se completaron en esta corrida.`,
    );
  }

  if (resultado.rescatadas > 0) {
    // Se listan POR EMPRESA VIEJA (no una línea por orden): dice exactamente de quién era cada
    // rescatada sin llenar el reporte con 1,528 renglones.
    for (const [empresa, cuantas] of [...rescatadasPorEmpresa].sort((a, b) =>
      a[0].localeCompare(b[0], 'es'),
    )) {
      reporte.agregar(
        `Histórico: órdenes de empresas que NO migran, rescatadas en la empresa principal (${principal.criterio}) — §Post-F9.29`,
        `${empresa}: ${String(cuantas)} órdenes`,
      );
    }
    reporte.nota(
      `Histórico: ${String(resultado.rescatadas)} órdenes de las empresas viejas que no migran se ` +
        `RESCATARON colgándolas de la empresa principal (${principal.criterio}); conservan su empresa ` +
        `original en el campo "empresaV1" y se pueden buscar por ella (§Post-F9.29). ` +
        // Una empresa que SÍ vive en v2 no debería aparecer en esa lista: si sale, lo que falló es
        // el mapeo de `etl-catalogos` (parcial), no el archivo — y sus órdenes quedaron colgadas de
        // la principal en vez de la suya. Se dice aquí porque el reporte es lo único que lo delata.
        `REVISA LA LISTA: si en ella aparece una empresa que SÍ existe en v2 (Marilyn Fitness o ` +
        `FR Moda), su mapeo quedó incompleto en "etl-catalogos" — esas órdenes debieron quedarse en ` +
        `su propia empresa. Se corrige re-corriendo etl-catalogos y vaciando las tablas del archivo.`,
    );
  }
  if (resultado.sinModelo > 0) {
    reporte.nota(
      `Histórico: ${String(resultado.sinModelo)} órdenes cuyo modelo no se pudo ligar; conservan el código del viejo en texto y se pueden buscar por él.`,
    );
  }
  return resultado;
}
