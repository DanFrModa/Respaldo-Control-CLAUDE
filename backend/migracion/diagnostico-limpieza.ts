/**
 * DIAGNÓSTICO + LIMPIEZA de residuos de la migración (mantenimiento puntual, agosto-2026).
 *
 * Tras la recarga con ventana quedaron dos cosas que Gabriel **no puede resolver desde la UI**:
 *
 *  1. **Almacenes duplicados por nombre equivalente**: el seed de F3-E1 siembra los 3 almacenes
 *     PT como GLOBALES (`idEmpresa = null`) y, antes del fix del loader (31-jul-2026), el ETL
 *     alcanzó a crear uno por-empresa con el mismo nombre sin acento — el `@@unique(idEmpresa,
 *     nombre)` no lo impide porque `NULL` cuenta como distinto. Caso conocido: `id=4 "Transito"
 *     (idEmpresa=1)` sobrante frente al global `id=3 "Tránsito"`.
 *  2. **Clientes que la ventana NO debía migrar**: quedaron de una corrida SIN ventana que se
 *     abortó a media carga. El criterio para hallarlos es determinista: los que NO están en el
 *     set del prescan (`comun/ventana-f2.ts`) con `ETL_DESDE` puesto.
 *
 * USO (desde `backend/`, como todos los scripts de migración):
 *
 *   npx tsx --env-file=.env migracion/diagnostico-limpieza.ts              ← solo REPORTA
 *   npx tsx --env-file=.env migracion/diagnostico-limpieza.ts --confirmar  ← BORRA lo seguro
 *
 * Para el chequeo de clientes hay que pasar la MISMA ventana de la recarga:
 *   ETL_DESDE=2025-01-01 npx tsx --env-file=.env migracion/diagnostico-limpieza.ts
 *   (PowerShell: `$env:ETL_DESDE='2025-01-01'` antes del comando.)
 * Sin `ETL_DESDE` el script AVISA y se salta esa parte: no borra clientes a ciegas.
 *
 * REGLA DE SEGURIDAD (innegociable): solo se borra lo que tiene **cero dependientes reales**.
 * "Dependiente real" = cualquier fila que el schema protege con `onDelete: Restrict`
 * (movimientos, pedidos, órdenes, notas, recepciones, inventarios cíclicos, listas, proyectos…).
 * Se consideran TRIVIALES —y por tanto se dejan caer en cascada— únicamente las filas que el
 * propio schema marca `onDelete: Cascade` y que no cuelgan nada protegido:
 * `ClienteCampo` (siempre que ninguno tenga `OrdenReferencia`, que es Restrict),
 * `ClienteDepartamento` (siempre que no tenga `Proyecto`, que es Restrict), `ClienteFactores`
 * y `ClienteModeloLiga`. Si algo tiene dependientes reales NO se borra: se reporta qué lo
 * retiene y se dice que requiere decisión humana.
 *
 * IDEMPOTENTE: correrlo dos veces no falla (la segunda no encuentra nada que borrar). Cada
 * borrado va en SU transacción.
 */
import { pathToFileURL } from 'node:url';

import { crearClientePrisma, type PrismaClient } from '../src/datos/index.js';

import { opcionesClienteEtl } from './comun/cliente-etl.js';
import { normalizarParaDedup } from './comun/valores.js';
import { prescanVentanaF2 } from './comun/ventana-f2.js';
import { describirVentana, resolverVentana } from './comun/ventana.js';

/** Un dependiente encontrado: qué tabla lo retiene y cuántas filas. */
interface Dependiente {
  tabla: string;
  filas: number;
}

/** Resultado del análisis de un candidato a borrar. */
interface Candidato {
  id: number;
  descripcion: string;
  /** Dependientes REALES (protegidos por Restrict): si hay ≥1, NO se borra. */
  retenido: Dependiente[];
  /** Dependientes TRIVIALES (Cascade del schema): se van con el padre. */
  triviales: Dependiente[];
}

/** Suma solo los dependientes con filas > 0. */
function conFilas(deps: Dependiente[]): Dependiente[] {
  return deps.filter((d) => d.filas > 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Almacenes duplicados por nombre equivalente (global vs por-empresa)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Busca almacenes cuyo nombre NORMALIZADO (sin acentos, minúsculas) coincide y donde uno es
 * GLOBAL. El sobrante a borrar es SIEMPRE el por-empresa: el global es el canónico del seed y
 * es al que el loader corregido apunta el mapeo `Almacen:IPT`.
 */
async function analizarAlmacenesDuplicados(cliente: PrismaClient): Promise<Candidato[]> {
  const todos = await cliente.almacen.findMany({
    select: { id: true, nombre: true, idEmpresa: true, tipo: true },
    orderBy: { id: 'asc' },
  });
  const porNombre = new Map<string, typeof todos>();
  for (const a of todos) {
    const clave = normalizarParaDedup(a.nombre);
    porNombre.set(clave, [...(porNombre.get(clave) ?? []), a]);
  }

  const candidatos: Candidato[] = [];
  for (const grupo of porNombre.values()) {
    if (grupo.length < 2) continue;
    const global = grupo.find((a) => a.idEmpresa === null);
    if (global === undefined) continue; // duplicado entre empresas: no es este caso, no se toca
    for (const sobrante of grupo.filter((a) => a.idEmpresa !== null)) {
      // TODAS las FK a Almacen del schema son `onDelete: Restrict` → cualquiera lo retiene.
      const [movimientos, recepciones, notas, ciclicos, recibosPrimeras, recibosSegundas, config] =
        await Promise.all([
          cliente.movimiento.count({ where: { idAlmacen: sobrante.id } }),
          cliente.recepcionCompra.count({ where: { idAlmacen: sobrante.id } }),
          cliente.notaSalida.count({ where: { idAlmacen: sobrante.id } }),
          cliente.inventarioCiclico.count({ where: { idAlmacen: sobrante.id } }),
          cliente.etapaMovimiento.count({ where: { idAlmacenPrimeras: sobrante.id } }),
          cliente.etapaMovimiento.count({ where: { idAlmacenSegundas: sobrante.id } }),
          cliente.configuracionEmpresa.count({ where: { idAlmacenPtDefault: sobrante.id } }),
        ]);
      candidatos.push({
        id: sobrante.id,
        descripcion:
          `Almacén "${sobrante.nombre}" (${sobrante.tipo}, idEmpresa=${String(sobrante.idEmpresa)}) ` +
          `— duplica al GLOBAL id=${String(global.id)} "${global.nombre}"`,
        retenido: conFilas([
          { tabla: 'Movimiento (kardex)', filas: movimientos },
          { tabla: 'RecepcionCompra', filas: recepciones },
          { tabla: 'NotaSalida', filas: notas },
          { tabla: 'InventarioCiclico', filas: ciclicos },
          { tabla: 'EtapaMovimiento.almacenPrimeras', filas: recibosPrimeras },
          { tabla: 'EtapaMovimiento.almacenSegundas', filas: recibosSegundas },
          { tabla: 'ConfiguracionEmpresa.almacenPtDefault', filas: config },
        ]),
        triviales: [],
      });
    }
  }
  return candidatos;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Clientes fuera de la ventana (residuo de una corrida sin ventana)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lista los `Cliente` de la BD que NO están en el set del prescan de la ventana. Devuelve
 * `null` si la ventana no está activa (sin `ETL_DESDE` no hay criterio: no se toca nada).
 */
async function analizarClientesFueraVentana(cliente: PrismaClient): Promise<Candidato[] | null> {
  const ventana = resolverVentana();
  const prescan = prescanVentanaF2(ventana);
  if (prescan === null) return null;

  // Nombre → idCliente de los que SÍ debían migrar: el mapeo guarda `IdClientes` viejo, así que
  // se cruza por el mapeo persistido (clave vieja) y, como respaldo, por el nombre del CSV.
  const mapeos = await cliente.mapeoMigracion.findMany({
    where: { entidad: 'Cliente' },
    select: { claveVieja: true, idNuevo: true },
  });
  const idsEnVentana = new Set<number>();
  for (const m of mapeos) {
    if (prescan.clientesEnVentana.has(m.claveVieja.trim())) {
      const id = Number(m.idNuevo);
      if (Number.isFinite(id)) idsEnVentana.add(id);
    }
  }

  const todos = await cliente.cliente.findMany({
    select: { id: true, nombre: true, creadoEn: true },
    orderBy: { id: 'asc' },
  });
  const candidatos: Candidato[] = [];
  for (const c of todos) {
    if (idsEnVentana.has(c.id)) continue;
    const [
      pedidos,
      ordenes,
      edrLineas,
      productividad,
      muestrarios,
      proyectos,
      listas,
      plantillas,
      movTerceros,
      campos,
      departamentos,
      factores,
      ligas,
    ] = await Promise.all([
      cliente.pedido.count({ where: { idCliente: c.id } }),
      cliente.orden.count({ where: { idCliente: c.id } }),
      cliente.edrLinea.count({ where: { idCliente: c.id } }),
      cliente.registroProductividad.count({ where: { idCliente: c.id } }),
      cliente.muestrario.count({ where: { idCliente: c.id } }),
      cliente.proyecto.count({ where: { idCliente: c.id } }),
      cliente.listaPrecios.count({ where: { idCliente: c.id } }),
      cliente.plantillaImportacion.count({ where: { idCliente: c.id } }),
      cliente.movimientoTercero.count({ where: { idCliente: c.id } }),
      cliente.clienteCampo.count({ where: { idCliente: c.id } }),
      cliente.clienteDepartamento.count({ where: { idCliente: c.id } }),
      cliente.clienteFactores.count({ where: { idCliente: c.id } }),
      cliente.clienteModeloLiga.count({ where: { idCliente: c.id } }),
    ]);
    // Nietos PROTEGIDOS que colgarían de una cascada "trivial": si existen, la cascada fallaría
    // y el cliente NO es seguro de borrar (OrdenReferencia y Proyecto son Restrict).
    const referenciasDeCampos = await cliente.ordenReferencia.count({
      where: { clienteCampo: { idCliente: c.id } },
    });
    candidatos.push({
      id: c.id,
      descripcion: `Cliente "${c.nombre}" (creado ${c.creadoEn.toISOString().slice(0, 10)})`,
      retenido: conFilas([
        { tabla: 'Pedido', filas: pedidos },
        { tabla: 'Orden', filas: ordenes },
        { tabla: 'EdrLinea', filas: edrLineas },
        { tabla: 'RegistroProductividad', filas: productividad },
        { tabla: 'Muestrario', filas: muestrarios },
        { tabla: 'Proyecto', filas: proyectos },
        { tabla: 'ListaPrecios', filas: listas },
        { tabla: 'PlantillaImportacion', filas: plantillas },
        { tabla: 'MovimientoTercero', filas: movTerceros },
        { tabla: 'OrdenReferencia (via ClienteCampo)', filas: referenciasDeCampos },
      ]),
      triviales: conFilas([
        { tabla: 'ClienteCampo (cascade)', filas: campos },
        { tabla: 'ClienteDepartamento (cascade)', filas: departamentos },
        { tabla: 'ClienteFactores (cascade)', filas: factores },
        { tabla: 'ClienteModeloLiga (cascade)', filas: ligas },
      ]),
    });
  }
  return candidatos;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reporte + borrado
// ─────────────────────────────────────────────────────────────────────────────

/** Imprime un bloque de candidatos con su veredicto. */
function imprimirBloque(titulo: string, candidatos: Candidato[]): void {
  console.log(`\n── ${titulo} (${String(candidatos.length)}) ──`);
  if (candidatos.length === 0) {
    console.log('  (nada que reportar)');
    return;
  }
  for (const c of candidatos) {
    const seguro = c.retenido.length === 0;
    console.log(`  [id=${String(c.id)}] ${c.descripcion}`);
    console.log(
      `      → ${seguro ? '✅ SEGURO de borrar (cero dependientes reales)' : '⛔ NO se borra'}`,
    );
    for (const d of c.retenido) {
      console.log(`         retenido por ${d.tabla}: ${String(d.filas)}`);
    }
    for (const d of c.triviales) {
      console.log(`         (cascada trivial) ${d.tabla}: ${String(d.filas)}`);
    }
  }
}

/** Borra un candidato en SU transacción. Devuelve true si borró. */
async function borrar(
  cliente: PrismaClient,
  tipo: 'almacen' | 'cliente',
  id: number,
): Promise<boolean> {
  await cliente.$transaction(async (tx) => {
    if (tipo === 'almacen') {
      // El mapeo de migración apunta al id por TEXTO (no es FK): se limpia a mano para que una
      // re-corrida del ETL no reapunte a un id inexistente.
      await tx.mapeoMigracion.deleteMany({
        where: { entidad: { in: ['Almacen:IPT', 'Almacen:Tela'] }, idNuevo: String(id) },
      });
      await tx.almacen.delete({ where: { id } });
    } else {
      await tx.mapeoMigracion.deleteMany({ where: { entidad: 'Cliente', idNuevo: String(id) } });
      await tx.cliente.delete({ where: { id } }); // ClienteCampo/Departamento/Factores/Liga: cascade
    }
  });
  return true;
}

/** Punto de entrada. */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Falta DATABASE_URL (ver backend/.env.example)');
    process.exit(1);
  }
  const confirmar = process.argv.includes('--confirmar');

  const cliente = crearClientePrisma(url, opcionesClienteEtl());
  try {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(' DIAGNÓSTICO DE RESIDUOS DE LA MIGRACIÓN');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(
      confirmar ? ' Modo: --confirmar (BORRA lo seguro)' : ' Modo: SOLO REPORTE (nada se escribe)',
    );

    const almacenes = await analizarAlmacenesDuplicados(cliente);
    imprimirBloque('Almacenes duplicados (global vs por-empresa)', almacenes);

    const ventana = resolverVentana();
    const clientes = await analizarClientesFueraVentana(cliente);
    console.log(`\n── Clientes fuera de la ventana ──`);
    if (clientes === null) {
      console.log(
        '  ⚠️ OMITIDO: `ETL_DESDE` no está puesto, así que NO se puede determinar qué clientes\n' +
          '     debían migrar. Vuelve a correr con la misma ventana de la recarga, p. ej.:\n' +
          '       ETL_DESDE=2025-01-01 npx tsx --env-file=.env migracion/diagnostico-limpieza.ts\n' +
          "     (PowerShell: $env:ETL_DESDE='2025-01-01' antes del comando). No se borra nada de clientes.",
      );
    } else {
      console.log(`  ${describirVentana(ventana)}`);
      imprimirBloque('Clientes que la ventana NO debía migrar', clientes);
    }

    // ── Borrado (solo lo seguro) ───────────────────────────────────────────────
    const seguros = [
      ...almacenes
        .filter((c) => c.retenido.length === 0)
        .map((c) => ({ tipo: 'almacen' as const, c })),
      ...(clientes ?? [])
        .filter((c) => c.retenido.length === 0)
        .map((c) => ({ tipo: 'cliente' as const, c })),
    ];
    const retenidos = [...almacenes, ...(clientes ?? [])].filter((c) => c.retenido.length > 0);

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log(' RESUMEN');
    console.log('═══════════════════════════════════════════════════════════════');
    if (!confirmar) {
      console.log(
        ` Se BORRARÍAN ${String(seguros.length)} registro(s) seguros; ${String(retenidos.length)} quedan por tener dependientes.`,
      );
      if (seguros.length > 0) {
        console.log(' Para borrarlos de verdad, repite el comando con --confirmar.');
      }
      return;
    }
    let borrados = 0;
    for (const { tipo, c } of seguros) {
      await borrar(cliente, tipo, c.id);
      borrados += 1;
      console.log(` ✅ BORRADO ${tipo} id=${String(c.id)} — ${c.descripcion}`);
    }
    console.log(`\n Borrados: ${String(borrados)}.`);
    if (retenidos.length > 0) {
      console.log(
        ` NO borrados (requieren DECISIÓN HUMANA, tienen datos colgando): ${String(retenidos.length)}`,
      );
      for (const c of retenidos) {
        console.log(
          `   • id=${String(c.id)} ${c.descripcion} — retenido por ` +
            c.retenido.map((d) => `${d.tabla}(${String(d.filas)})`).join(', '),
        );
      }
      console.log(
        '   Estos NO se pueden borrar sin decidir qué pasa con esos datos (reasignarlos al\n' +
          '   registro bueno o conservarlos). Súbelo con Gabriel/Daniel antes de tocar nada.',
      );
    }
  } finally {
    await cliente.$disconnect();
  }
}

const ejecutadoComoScript =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (ejecutadoComoScript) {
  await main();
}
