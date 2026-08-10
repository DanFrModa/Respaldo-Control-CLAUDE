/**
 * Loader del ARCHIVO HISTÓRICO DE ÓRDENES del sistema viejo (§Post-F9.26).
 *
 * Daniel (10-ago-2026): *"me gustaría tenerlas también como archivo histórico de órdenes. Normalmente
 * cuando queremos consultar algo de información, lo hacemos más desde las órdenes de producción que
 * del catálogo de modelos. Para poder buscar por cliente, número de modelo, tipo de prenda, fecha de
 * producción, maquilero, etc."*
 *
 * QUÉ CARGA: **TODAS** las órdenes del viejo (5,451), su matriz color×talla (39,866 celdas) y sus
 * movimientos de producción (corte, envío/recibo de costura y de estampado). Es lo ÚNICO del ETL que
 * ignora a propósito la ventana de 2025-2026 (§Post-F9.24) — precisamente porque su razón de existir
 * es guardar lo que la ventana deja fuera.
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
 * POR LOTES (regla de Gabriel, 19-jun): son ~78,000 renglones entre los tres modelos; se escriben con
 * `createMany` en tandas, nunca uno por uno.
 *
 * IDEMPOTENTE: la llave es `(idEmpresa, idOrdenV1)`. Re-correrlo NO duplica — las órdenes que ya
 * están se saltan (con su detalle), y solo se insertan las que falten.
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
  /** Órdenes salteadas por no poder ubicar su empresa (las 6 empresas muertas del viejo). */
  sinEmpresa: number;
  /** Celdas color×talla insertadas. */
  celdas: number;
  /** Movimientos de producción insertados. */
  procesos: number;
  /** Órdenes cuyo modelo no se pudo mapear (quedan con el código en texto). */
  sinModelo: number;
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

/** Inserta en tandas (nunca fila por fila — regla de Gabriel). Devuelve cuántas escribió. */
async function insertarPorLotes<T>(
  filas: T[],
  escribir: (tanda: T[]) => Promise<unknown>,
): Promise<number> {
  for (let i = 0; i < filas.length; i += LOTE) {
    await escribir(filas.slice(i, i + LOTE));
  }
  return filas.length;
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
  const etiquetas = mapaNombres('EtiquetasM.csv', 'IdEtiquetasM', 'EtiquetaM');
  const telas = mapaNombres('TelasDis.csv', 'IdTelasDis', 'TelaDis');
  const modelosV1 = mapaNombres('Modelos.csv', 'IdModelos', 'Modelo');
  const maquileros = mapaMaquileros();
  const cortadores = mapaNombres('Cortadores.csv', 'IdCortadores', 'Cortador');

  const resultado: ResultadoHistoricoOrdenes = {
    ordenes: 0,
    existentes: 0,
    sinEmpresa: 0,
    celdas: 0,
    procesos: 0,
    sinModelo: 0,
  };

  // Lo que YA está cargado (idempotencia): se salta sin volver a tocarlo.
  const yaCargadas = new Set(
    (await cli.historicoOrdenV1.findMany({ select: { idOrdenV1: true } })).map((o) => o.idOrdenV1),
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

  // ── Cabeceras ────────────────────────────────────────────────────────────────
  const cabeceras: Prisma.HistoricoOrdenV1CreateManyInput[] = [];
  /** idOrdenV1 → celdas/procesos, para escribirlos cuando ya se conozcan los ids nuevos. */
  const pendientes = new Map<
    string,
    { celdas: { color: string; talla: string; cantidad: number }[] }
  >();

  for (const f of leerCsv('Ordenes.csv')) {
    const idOrdenV1 = (f.IdOrdenes ?? '').trim();
    if (idOrdenV1 === '' || yaCargadas.has(idOrdenV1)) {
      if (idOrdenV1 !== '') resultado.existentes += 1;
      continue;
    }
    const idEmpresa = mapaEmpresa.get((f.IdEmpresas ?? '').trim());
    if (idEmpresa === undefined) {
      // Las 6 empresas muertas del viejo no migraron: sus órdenes no tienen dónde colgar.
      resultado.sinEmpresa += 1;
      continue;
    }

    const idModeloV1 = (f.IdModelos ?? '').trim();
    const idModelo = mapaModelo.get(idModeloV1) ?? null;
    if (idModelo === null) resultado.sinModelo += 1;

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
    const celdas: { color: string; talla: string; cantidad: number }[] = [];
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

    const procesosDeEsta = procesosPorOrden.get(idOrdenV1) ?? [];
    cabeceras.push({
      idEmpresa,
      idOrdenV1,
      numero: (f.Numero ?? '').trim() || idOrdenV1,
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
    });
    pendientes.set(idOrdenV1, { celdas });
  }

  resultado.ordenes = await insertarPorLotes(cabeceras, (tanda) =>
    cli.historicoOrdenV1.createMany({ data: tanda, skipDuplicates: true }),
  );

  // ── Hijos: se resuelven los ids nuevos de una sola lectura ───────────────────
  const idsNuevos = new Map(
    (await cli.historicoOrdenV1.findMany({ select: { id: true, idOrdenV1: true } })).map((o) => [
      o.idOrdenV1,
      o.id,
    ]),
  );

  const lineas: Prisma.HistoricoOrdenV1LineaCreateManyInput[] = [];
  const procesos: Prisma.HistoricoOrdenV1ProcesoCreateManyInput[] = [];
  for (const [idOrdenV1, datos] of pendientes) {
    const idOrden = idsNuevos.get(idOrdenV1);
    if (idOrden === undefined) continue;
    for (const c of datos.celdas) lineas.push({ idOrden, ...c });
    for (const p of procesosPorOrden.get(idOrdenV1) ?? []) {
      procesos.push({
        idOrden,
        tipo: p.tipo,
        fecha: p.fecha,
        tercero: p.tercero,
        cantidad: p.cantidad,
        observaciones: p.observaciones,
      });
    }
  }

  resultado.celdas = await insertarPorLotes(lineas, (tanda) =>
    cli.historicoOrdenV1Linea.createMany({ data: tanda }),
  );
  resultado.procesos = await insertarPorLotes(procesos, (tanda) =>
    cli.historicoOrdenV1Proceso.createMany({ data: tanda }),
  );

  if (resultado.sinEmpresa > 0) {
    reporte.nota(
      `Histórico: ${String(resultado.sinEmpresa)} órdenes sin empresa mapeada (las 6 empresas viejas que no migran).`,
    );
  }
  if (resultado.sinModelo > 0) {
    reporte.nota(
      `Histórico: ${String(resultado.sinModelo)} órdenes cuyo modelo no se pudo ligar; conservan el código del viejo en texto y se pueden buscar por él.`,
    );
  }
  return resultado;
}
