/**
 * Seed de DESARROLLO de las PLANTILLAS, REGLAS DE DURACIÓN y CALENDARIO de la Ruta Crítica (F5-E2)
 * — IDEMPOTENTE. Siembra:
 *  1. Familias (`CP_Familia`) y artículos RC (`CP_Articulos`).
 *  2. Factores por cantidad (`CP_Cant`, 11 rangos).
 *  3. Duraciones por tipo de tela (`RC_TipoTelas`, 7, con factorTela).
 *  4. Duraciones por aplicación (`RC_Aplicaciones`, 9).
 *  5. Dos plantillas de ruta reales (artículos 1/6 y 6/6) con sus 26 procesos, tiempo estándar y
 *     ENCADENAMIENTO PROPIO (de `CP_Tiempos`). Se enganchan a los procesos sembrados por F5-E1.
 *  6. El calendario L–V de la empresa favorita + los festivos OFICIALES de México (las fechas
 *     propias de FR Moda se cargan luego por el CRUD).
 *
 * **Datos BAKEADOS** (no lee el CSV en runtime): mismo criterio que `seed-ruta-critica.ts` (los CSV
 * no viajan en la imagen de Railway). Extraídos en CP850 (CLAUDE.md §4) y transcritos 1:1.
 *
 * Idempotencia: familias/telas/aplicaciones por `nombre`; artículos por (nombre+familia);
 * factores/festivos por una sonda; plantillas por `nombre` (si ya existe NO se re-siembra: el
 * usuario pudo editarlas). El calendario por empresa por upsert. NO borra lo agregado a mano.
 */
import type { PrismaClient } from '../src/datos/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Familias y artículos (CP_Familia / CP_Articulos)
// ─────────────────────────────────────────────────────────────────────────────

/** Familias reales (`CP_Familia`). */
const FAMILIAS: string[] = ['Todos'];

/** Artículos reales (`CP_Articulos`): descripción + familia. */
const ARTICULOS: { nombre: string; familia: string }[] = [
  { nombre: 'SENCILLO 1/6', familia: 'Todos' },
  { nombre: 'SENCILO + 2/6', familia: 'Todos' },
  { nombre: 'MEDIO 3/6', familia: 'Todos' },
  { nombre: 'MEDIO + 4/6', familia: 'Todos' },
  { nombre: 'DIFICIL 5/6', familia: 'Todos' },
  { nombre: 'DIFICIL + 6/6', familia: 'Todos' },
];

// ─────────────────────────────────────────────────────────────────────────────
// 2. Factores por cantidad (CP_Cant, 11 rangos)
// ─────────────────────────────────────────────────────────────────────────────

const FACTORES_CANTIDAD: { deCant: number; aCant: number; factor: number }[] = [
  { deCant: 1, aCant: 500, factor: 0.6 },
  { deCant: 501, aCant: 999, factor: 0.8 },
  { deCant: 1000, aCant: 1500, factor: 1.0 },
  { deCant: 1501, aCant: 2000, factor: 1.2 },
  { deCant: 2001, aCant: 3000, factor: 1.5 },
  { deCant: 3001, aCant: 4000, factor: 1.8 },
  { deCant: 4001, aCant: 5000, factor: 2.0 },
  { deCant: 5001, aCant: 6000, factor: 2.2 },
  { deCant: 6001, aCant: 8000, factor: 2.5 },
  { deCant: 8001, aCant: 10000, factor: 2.8 },
  { deCant: 10001, aCant: 20000, factor: 3.0 },
];

// ─────────────────────────────────────────────────────────────────────────────
// 3. Duraciones por tipo de tela (RC_TipoTelas, 7, con FactorTela)
// ─────────────────────────────────────────────────────────────────────────────

const DURACIONES_TELA: { nombre: string; dias: number; factorTela: number }[] = [
  { nombre: 'Existencia', dias: 2, factorTela: 0.07 },
  { nombre: 'Compra de Existencia', dias: 8, factorTela: 0.26 },
  { nombre: 'Crudo en Existencia', dias: 20, factorTela: 0.67 },
  { nombre: 'Programar Tela Basica', dias: 30, factorTela: 1.0 },
  { nombre: 'Programar Tela Especializada', dias: 35, factorTela: 1.17 },
  { nombre: 'Programar Tela Estampada', dias: 35, factorTela: 1.17 },
  { nombre: 'Importacion Tela Oriente', dias: 40, factorTela: 2.3 },
];

// ─────────────────────────────────────────────────────────────────────────────
// 4. Duraciones por aplicación (RC_Aplicaciones, 9)
// ─────────────────────────────────────────────────────────────────────────────

const DURACIONES_APLICACION: { nombre: string; clave: string; dias: number }[] = [
  { nombre: 'Sin Aplicación', clave: 'A0', dias: 0 },
  { nombre: 'Estampado Sencillo', clave: 'A1', dias: 3 },
  { nombre: 'Estampado Complicado', clave: 'A2', dias: 5 },
  { nombre: '2 Estampados', clave: 'A3', dias: 5 },
  { nombre: '1 Bordado', clave: 'A4', dias: 4 },
  { nombre: '2 Bordados', clave: 'A5', dias: 6 },
  { nombre: '1 Estampado, 1 Bordado', clave: 'A6', dias: 7 },
  { nombre: '2 Estampados, 1 Bordado', clave: 'A7', dias: 8 },
  { nombre: 'Lavado y Estampado', clave: 'A8', dias: 10 },
];

// ─────────────────────────────────────────────────────────────────────────────
// 5. Plantillas de ruta (CP_Tiempos) — 2 reales, con encadenamiento propio
// ─────────────────────────────────────────────────────────────────────────────

interface RenglonPlantilla {
  /** Código del proceso (ProcesoDef) sembrado por F5-E1. */
  codigo: string;
  /** Tiempo estándar en días (`CP_Tiempos.Tiempo`). */
  tiempo: number;
  /** Códigos de los procesos antecesores DENTRO de la plantilla (`CP_Tiempos.Antecesor`). */
  antecesores: string[];
}

/** Encadenamiento del artículo 1/6 (el más sencillo). Transcrito de `CP_Tiempos` (IdCP_Articulos=1). */
const PLANTILLA_1_6: RenglonPlantilla[] = [
  { codigo: 'revision-orden', tiempo: 1, antecesores: [] },
  { codigo: 'ficha-desarrollo', tiempo: 3, antecesores: ['revision-orden'] },
  { codigo: 'programacion', tiempo: 1, antecesores: ['ficha-desarrollo'] },
  { codigo: 'autorizacion-fit', tiempo: 15, antecesores: ['revision-orden'] },
  { codigo: 'autorizacion-arte', tiempo: 12, antecesores: ['revision-orden'] },
  { codigo: 'orden-compra-tela', tiempo: 2, antecesores: ['ficha-desarrollo'] },
  { codigo: 'autorizacion-tono-tela', tiempo: 15, antecesores: ['ficha-desarrollo'] },
  { codigo: 'autorizacion-avios', tiempo: 12, antecesores: ['ficha-desarrollo'] },
  { codigo: 'ficha-tecnica', tiempo: 12, antecesores: ['revision-orden'] },
  { codigo: 'contramuestra-maquila', tiempo: 8, antecesores: ['autorizacion-fit'] },
  { codigo: 'orden-compra-habilitaciones', tiempo: 1, antecesores: ['autorizacion-avios'] },
  { codigo: 'surtido-avios', tiempo: 12, antecesores: ['orden-compra-habilitaciones'] },
  { codigo: 'recepcion-tela', tiempo: 20, antecesores: ['orden-compra-tela'] },
  { codigo: 'autorizacion-muestras-laboratorio', tiempo: 7, antecesores: ['recepcion-tela'] },
  { codigo: 'entrega-moldes-corte', tiempo: 3, antecesores: ['recepcion-tela'] },
  { codigo: 'auditoria-corte', tiempo: 3, antecesores: ['entrega-moldes-corte'] },
  { codigo: 'corte', tiempo: 3, antecesores: ['auditoria-corte'] },
  { codigo: 'envio-procesos', tiempo: 1, antecesores: ['corte'] },
  { codigo: 'recepcion-procesos', tiempo: 5, antecesores: ['envio-procesos'] },
  { codigo: 'auditoria-calidad-proceso', tiempo: 1, antecesores: ['envio-procesos'] },
  { codigo: 'envio-confeccion', tiempo: 1, antecesores: ['corte'] },
  { codigo: 'recepcion-confeccion', tiempo: 5, antecesores: ['envio-confeccion'] },
  { codigo: 'auditoria-calidad-interna', tiempo: 2, antecesores: ['recepcion-confeccion'] },
  { codigo: 'empaque', tiempo: 2, antecesores: ['auditoria-calidad-interna'] },
  { codigo: 'entrega-cdis', tiempo: 5, antecesores: ['empaque'] },
  { codigo: 'aceptacion-cliente', tiempo: 3, antecesores: ['entrega-cdis'] },
];

/**
 * Encadenamiento del artículo 6/6 (el más difícil). Igual al 1/6 salvo el tiempo de recepción de
 * confección (10 días en vez de 5): el costo de costura crece con la dificultad del artículo.
 */
const PLANTILLA_6_6: RenglonPlantilla[] = PLANTILLA_1_6.map((r) =>
  r.codigo === 'recepcion-confeccion' ? { ...r, tiempo: 10 } : r,
);

const PLANTILLAS: { nombre: string; articulo: string; renglones: RenglonPlantilla[] }[] = [
  { nombre: 'Ruta estándar SENCILLO 1/6', articulo: 'SENCILLO 1/6', renglones: PLANTILLA_1_6 },
  { nombre: 'Ruta estándar DIFICIL + 6/6', articulo: 'DIFICIL + 6/6', renglones: PLANTILLA_6_6 },
];

// ─────────────────────────────────────────────────────────────────────────────
// 6. Calendario laboral (L–V) + festivos oficiales de México
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Festivos OFICIALES de México del año en curso (Ley Federal del Trabajo art. 74). Las fechas
 * móviles (1er lunes de feb, 3er lunes de mar/nov) se transcriben para 2026; las propias de FR
 * Moda (puentes internos, vacaciones) se cargan después por el CRUD. Se siembran para la empresa
 * favorita; idempotentes por (empresa+fecha).
 */
const FESTIVOS_MX_2026: { fecha: string; descripcion: string }[] = [
  { fecha: '2026-01-01', descripcion: 'Año Nuevo' },
  { fecha: '2026-02-02', descripcion: 'Día de la Constitución (1er lunes de febrero)' },
  { fecha: '2026-03-16', descripcion: 'Natalicio de Benito Juárez (3er lunes de marzo)' },
  { fecha: '2026-05-01', descripcion: 'Día del Trabajo' },
  { fecha: '2026-09-16', descripcion: 'Día de la Independencia' },
  { fecha: '2026-11-16', descripcion: 'Revolución Mexicana (3er lunes de noviembre)' },
  { fecha: '2026-12-25', descripcion: 'Navidad' },
];

/** Convierte `YYYY-MM-DD` a `Date` a medianoche UTC. */
function fechaUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/**
 * Siembra plantillas/reglas/calendario de la RC (F5-E2). Idempotente; se invoca desde el seed
 * principal DESPUÉS de `sembrarRutaCritica` (necesita los procesos de F5-E1) y de `sembrarEmpresa`
 * (necesita la empresa favorita para el calendario).
 */
export async function sembrarRutaCriticaPlantillas(prisma: PrismaClient): Promise<void> {
  // 1) Familias (idempotente por nombre).
  for (const nombre of FAMILIAS) {
    await prisma.familiaArticulo.upsert({ where: { nombre }, update: {}, create: { nombre } });
  }
  const familias = await prisma.familiaArticulo.findMany({ select: { id: true, nombre: true } });
  const idFamiliaPorNombre = new Map(familias.map((f) => [f.nombre, f.id]));

  // Artículos (idempotente por nombre+familia: como no hay unique compuesto, se busca antes).
  const idArticuloPorNombre = new Map<string, number>();
  for (const art of ARTICULOS) {
    const idFamilia = idFamiliaPorNombre.get(art.familia);
    if (idFamilia === undefined) continue;
    const existente = await prisma.articuloRC.findFirst({
      where: { nombre: art.nombre, idFamiliaArticulo: idFamilia },
      select: { id: true },
    });
    const fila =
      existente ??
      (await prisma.articuloRC.create({
        data: { nombre: art.nombre, idFamiliaArticulo: idFamilia },
        select: { id: true },
      }));
    idArticuloPorNombre.set(art.nombre, fila.id);
  }

  // 2) Factores por cantidad (idempotente por el rango deCant+aCant).
  for (const f of FACTORES_CANTIDAD) {
    const existe = await prisma.factorCantidad.findFirst({
      where: { deCant: f.deCant, aCant: f.aCant },
      select: { id: true },
    });
    if (existe === null) {
      await prisma.factorCantidad.create({ data: f });
    }
  }

  // 3) Duraciones por tipo de tela (idempotente por nombre).
  for (const t of DURACIONES_TELA) {
    await prisma.duracionPorTipoTela.upsert({
      where: { nombre: t.nombre },
      update: {},
      create: t,
    });
  }

  // 4) Duraciones por aplicación (idempotente por nombre).
  for (const a of DURACIONES_APLICACION) {
    await prisma.duracionPorAplicacion.upsert({
      where: { nombre: a.nombre },
      update: {},
      create: { nombre: a.nombre, clave: a.clave, dias: a.dias },
    });
  }

  // 5) Plantillas de ruta. Idempotente por nombre: si ya existe NO se re-siembra (el usuario pudo
  //    editarla); solo se crean las que falten, con sus renglones y encadenamiento propio.
  const procesos = await prisma.procesoDef.findMany({ select: { id: true, codigo: true } });
  const idProcesoPorCodigo = new Map(procesos.map((p) => [p.codigo, p.id]));

  for (const plantilla of PLANTILLAS) {
    const existe = await prisma.plantillaRuta.findFirst({
      where: { nombre: plantilla.nombre },
      select: { id: true },
    });
    if (existe !== null) continue;

    const idArticulo = idArticuloPorNombre.get(plantilla.articulo) ?? null;
    const cabecera = await prisma.plantillaRuta.create({
      data: { nombre: plantilla.nombre, idArticuloRC: idArticulo },
      select: { id: true },
    });

    // Renglones (en orden) → conocemos su id para las aristas.
    const idRenglonPorCodigo = new Map<string, number>();
    for (const [indice, renglon] of plantilla.renglones.entries()) {
      const idProceso = idProcesoPorCodigo.get(renglon.codigo);
      if (idProceso === undefined) continue;
      const creado = await prisma.plantillaRutaProceso.create({
        data: {
          idPlantillaRuta: cabecera.id,
          idProcesoDef: idProceso,
          tiempoEstandar: renglon.tiempo,
          orden: indice,
        },
        select: { id: true },
      });
      idRenglonPorCodigo.set(renglon.codigo, creado.id);
    }

    // Aristas del encadenamiento propio.
    const aristas: { idPlantillaRutaProceso: number; idAntecesor: number }[] = [];
    for (const renglon of plantilla.renglones) {
      const idRenglon = idRenglonPorCodigo.get(renglon.codigo);
      if (idRenglon === undefined) continue;
      for (const codAntecesor of renglon.antecesores) {
        const idAntecesor = idRenglonPorCodigo.get(codAntecesor);
        if (idAntecesor !== undefined) {
          aristas.push({ idPlantillaRutaProceso: idRenglon, idAntecesor });
        }
      }
    }
    if (aristas.length > 0) {
      await prisma.plantillaRutaDep.createMany({ data: aristas, skipDuplicates: true });
    }
  }

  // 6) Calendario L–V + festivos para la empresa favorita (si existe).
  const empresa = await prisma.empresa.findFirst({
    where: { favorita: true },
    select: { id: true },
  });
  if (empresa !== null) {
    await prisma.calendarioEmpresa.upsert({
      where: { idEmpresa: empresa.id },
      update: {},
      create: { idEmpresa: empresa.id }, // defaults L–V hábiles, sáb/dom no.
    });
    for (const festivo of FESTIVOS_MX_2026) {
      await prisma.diaFestivo.upsert({
        where: { idEmpresa_fecha: { idEmpresa: empresa.id, fecha: fechaUtc(festivo.fecha) } },
        update: {},
        create: {
          idEmpresa: empresa.id,
          fecha: fechaUtc(festivo.fecha),
          descripcion: festivo.descripcion,
        },
      });
    }
  }
}
