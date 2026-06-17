/**
 * Datos DEMO de Órdenes de producción (F2-E2) — script de DESARROLLO, NO de producción.
 *
 * Siembra un escenario completo y verificable para que Gabriel pruebe el módulo Órdenes en
 * `prueba` (Swagger UI). Crea (idempotente, re-ejecutable):
 *   1. La base mínima: corre el seed de fundación (`sembrar`) → empresa FR Moda + permisos/roles +
 *      admin (no resetea password). Luego catálogos demo: un cliente con su campo de referencia
 *      (D7), un modelo activo, dos colores y tres tallas.
 *   2. Un PEDIDO interno vivo con un renglón (origen de las órdenes) + un pedido CANCELADO con su
 *      renglón (para probar el rechazo de "orden desde pedido cancelado").
 *   3. Tres ÓRDENES de muestra, creadas VÍA los servicios de dominio (mismas validaciones, A1):
 *      • DEMO-A: con matriz capturada (Rojo[CH:120, M:240] + Azul[G:60]) → total 420.
 *      • DEMO-B: con una referencia D7 capturada (valor "MONARCH-DEMO-2026").
 *      • DEMO-C: cancelada (motivo "Demo de cancelación").
 *
 * IDEMPOTENTE: los catálogos demo se upsertan por su clave natural; las órdenes/pedidos demo se
 * borran y re-crean en cada corrida (las órdenes demo cuelgan del pedido demo, que se identifica
 * por un folio sentinela alto y reservado). Imprime al final los IDs sembrados + el total esperado.
 *
 * Se corre con `npm run demo:ordenes` (= `tsx scripts/datos-demo-ordenes.ts`). Necesita
 * `DATABASE_URL` apuntando a la base de `prueba` (o local). NO sube fotos ni toca producción.
 *
 * ⚠️ TRAMPA PARA F2-E5 (siembra de secuencias de folio): los pedidos demo usan folios CENTINELA
 * altos (9000001/9000002) insertados como LITERALES — NO avanzan la secuencia atómica `"pedido"`
 * (este script no llama `siguienteFolio`). Pero cuando F2-E5 inicialice las secuencias por empresa
 * a partir de `MAX(folio)+1`, esos centinelas CONTAMINARÍAN el máximo y la numeración arrancaría
 * en ~9000003. Antes de sembrar las secuencias en F2-E5: ELIMINAR de la base los pedidos demo
 * (folios 9000001/9000002) — o que la siembra IGNORE esos folios centinela al calcular el máximo.
 */
import { pathToFileURL } from 'node:url';

import { CLAVES_PERMISO, type ClavePermiso } from '../src/contrato/index.js';
import type { SesionUsuario } from '../src/comun/permisos.js';
import { crearClientePrisma, type PrismaClient } from '../src/datos/index.js';
import {
  cancelarOrden,
  crearOrden,
  guardarMatrizOrden,
  guardarReferenciasOrden,
} from '../src/dominio/produccion/ordenes.js';
import { sembrar } from '../prisma/seed.js';

/** Id sentinela del usuario que siembra la demo (queda en `creado_por_id`/bitácora). */
const ID_USUARIO_DEMO = 'demo-sistema';

/** Folios sentinela altos y reservados para los pedidos demo (no chocan con folios reales). */
const FOLIO_PEDIDO_DEMO = 9_000_001n;
const FOLIO_PEDIDO_DEMO_CANCELADO = 9_000_002n;

/** Etiqueta del campo de referencia demo (D7). */
const ETIQUETA_CAMPO_DEMO = 'No. de pedido del cliente (DEMO)';

/** Sesión de sistema con TODOS los permisos para crear las órdenes vía dominio (como el ETL). */
function sesionDemo(idEmpresaActiva: number): SesionUsuario {
  return {
    id: ID_USUARIO_DEMO,
    username: 'demo',
    nombre: 'Datos demo (F2-E2)',
    idEmpresaActiva,
    nombreEmpresaActiva: 'FR Moda',
    permisos: new Set<ClavePermiso>(CLAVES_PERMISO),
  };
}

/** Resultado con los IDs sembrados (para imprimir y para la guía de verificación). */
interface DatosDemo {
  idEmpresa: number;
  idCliente: number;
  idClienteCampo: number;
  idOtroCliente: number;
  idOtroClienteCampo: number;
  idModelo: number;
  idColorRojo: number;
  idColorAzul: number;
  idTallaCH: number;
  idTallaM: number;
  idTallaG: number;
  idPedido: number;
  idPedidoLinea: number;
  idPedidoCancelado: number;
  idPedidoLineaCancelado: number;
  idOrdenConMatriz: number;
  folioOrdenConMatriz: number;
  totalOrdenConMatriz: number;
  idOrdenConReferencia: number;
  valorReferenciaDemo: string;
  idOrdenCancelada: number;
}

async function sembrarDemo(prisma: PrismaClient): Promise<DatosDemo> {
  // 1) Base mínima (idempotente): empresa FR Moda + permisos/roles + admin.
  await sembrar(prisma);
  const empresa = await prisma.empresa.findUniqueOrThrow({ where: { nombre: 'FR Moda' } });

  // 2) Catálogos demo (upsert por clave natural — globales, ADR-0007).
  const cliente = await prisma.cliente.upsert({
    where: { nombre: 'Cliente Demo F2' },
    update: {},
    create: { nombre: 'Cliente Demo F2' },
  });
  const otroCliente = await prisma.cliente.upsert({
    where: { nombre: 'Otro Cliente Demo F2' },
    update: {},
    create: { nombre: 'Otro Cliente Demo F2' },
  });
  const clienteCampo = await prisma.clienteCampo.upsert({
    where: { idCliente_etiqueta: { idCliente: cliente.id, etiqueta: ETIQUETA_CAMPO_DEMO } },
    update: { activo: true },
    create: { idCliente: cliente.id, etiqueta: ETIQUETA_CAMPO_DEMO },
  });
  const otroClienteCampo = await prisma.clienteCampo.upsert({
    where: {
      idCliente_etiqueta: { idCliente: otroCliente.id, etiqueta: 'Referencia ajena (DEMO)' },
    },
    update: { activo: true },
    create: { idCliente: otroCliente.id, etiqueta: 'Referencia ajena (DEMO)' },
  });
  const modelo = await prisma.modelo.upsert({
    where: { codigo: 'DEMO-501' },
    update: { activo: true },
    create: { codigo: 'DEMO-501', descripcion: 'Playera demo F2-E2' },
  });
  const colorRojo = await prisma.color.upsert({
    where: { nombre: 'Rojo Demo' },
    update: { activo: true },
    create: { nombre: 'Rojo Demo' },
  });
  const colorAzul = await prisma.color.upsert({
    where: { nombre: 'Azul Demo' },
    update: { activo: true },
    create: { nombre: 'Azul Demo' },
  });
  const tallaCH = await prisma.talla.upsert({
    where: { etiqueta: 'CH-DEMO' },
    update: { activo: true },
    create: { etiqueta: 'CH-DEMO', orden: 1 },
  });
  const tallaM = await prisma.talla.upsert({
    where: { etiqueta: 'M-DEMO' },
    update: { activo: true },
    create: { etiqueta: 'M-DEMO', orden: 2 },
  });
  const tallaG = await prisma.talla.upsert({
    where: { etiqueta: 'G-DEMO' },
    update: { activo: true },
    create: { etiqueta: 'G-DEMO', orden: 3 },
  });

  // 3) Limpia las órdenes/pedidos demo previos (idempotencia): borra las órdenes colgadas de los
  //    renglones de los pedidos demo y luego los pedidos demo (por su folio sentinela).
  const pedidosDemo = await prisma.pedido.findMany({
    where: {
      idEmpresa: empresa.id,
      folio: { in: [FOLIO_PEDIDO_DEMO, FOLIO_PEDIDO_DEMO_CANCELADO] },
    },
    select: { id: true, lineas: { select: { id: true } } },
  });
  const idsLineaDemo = pedidosDemo.flatMap((p) => p.lineas.map((l) => l.id));
  if (idsLineaDemo.length > 0) {
    // Cascade borra matriz/referencias/comentarios de cada orden.
    await prisma.orden.deleteMany({ where: { idPedidoLinea: { in: idsLineaDemo } } });
  }
  if (pedidosDemo.length > 0) {
    await prisma.pedido.deleteMany({ where: { id: { in: pedidosDemo.map((p) => p.id) } } });
  }

  // 4) Pedido demo VIVO + su renglón (origen de las órdenes).
  const pedido = await prisma.pedido.create({
    data: {
      folio: FOLIO_PEDIDO_DEMO,
      idEmpresa: empresa.id,
      idCliente: cliente.id,
      creadoPorId: ID_USUARIO_DEMO,
      modificadoPorId: ID_USUARIO_DEMO,
      lineas: {
        create: {
          idModelo: modelo.id,
          cantidadPedida: 1000,
          precio: 80,
          creadoPorId: ID_USUARIO_DEMO,
          modificadoPorId: ID_USUARIO_DEMO,
        },
      },
    },
    include: { lineas: true },
  });
  const lineaPedido = pedido.lineas[0];
  if (lineaPedido === undefined) {
    throw new Error('El pedido demo quedó sin renglón (no debería pasar).');
  }

  // 5) Pedido demo CANCELADO + su renglón (para probar el rechazo de orden desde pedido cancelado).
  const pedidoCancelado = await prisma.pedido.create({
    data: {
      folio: FOLIO_PEDIDO_DEMO_CANCELADO,
      idEmpresa: empresa.id,
      idCliente: cliente.id,
      pedCancelado: true,
      creadoPorId: ID_USUARIO_DEMO,
      modificadoPorId: ID_USUARIO_DEMO,
      lineas: {
        create: {
          idModelo: modelo.id,
          cantidadPedida: 50,
          precio: 80,
          creadoPorId: ID_USUARIO_DEMO,
          modificadoPorId: ID_USUARIO_DEMO,
        },
      },
    },
    include: { lineas: true },
  });
  const lineaPedidoCancelado = pedidoCancelado.lineas[0];
  if (lineaPedidoCancelado === undefined) {
    throw new Error('El pedido demo cancelado quedó sin renglón (no debería pasar).');
  }

  // 6) Órdenes demo VÍA los servicios de dominio (mismas validaciones que la API real, A1).
  const sesion = sesionDemo(empresa.id);

  // DEMO-A: con matriz capturada → total 120 + 240 + 60 = 420.
  const ordenMatriz = await crearOrden(sesion, { idPedidoLinea: lineaPedido.id });
  const ordenMatrizConDetalle = await guardarMatrizOrden(sesion, ordenMatriz.id, {
    lineas: [
      {
        idColor: colorRojo.id,
        tallas: [
          { idTalla: tallaCH.id, cantidad: 120 },
          { idTalla: tallaM.id, cantidad: 240 },
        ],
      },
      { idColor: colorAzul.id, tallas: [{ idTalla: tallaG.id, cantidad: 60 }] },
    ],
  });

  // DEMO-B: con una referencia D7 capturada.
  const valorReferencia = 'MONARCH-DEMO-2026';
  const ordenRef = await crearOrden(sesion, { idPedidoLinea: lineaPedido.id });
  await guardarReferenciasOrden(sesion, ordenRef.id, {
    referencias: [{ idClienteCampo: clienteCampo.id, valor: valorReferencia }],
  });

  // DEMO-C: cancelada.
  const ordenCancelar = await crearOrden(sesion, { idPedidoLinea: lineaPedido.id });
  await cancelarOrden(sesion, ordenCancelar.id, { motivo: 'Demo de cancelación' });

  return {
    idEmpresa: empresa.id,
    idCliente: cliente.id,
    idClienteCampo: clienteCampo.id,
    idOtroCliente: otroCliente.id,
    idOtroClienteCampo: otroClienteCampo.id,
    idModelo: modelo.id,
    idColorRojo: colorRojo.id,
    idColorAzul: colorAzul.id,
    idTallaCH: tallaCH.id,
    idTallaM: tallaM.id,
    idTallaG: tallaG.id,
    idPedido: pedido.id,
    idPedidoLinea: lineaPedido.id,
    idPedidoCancelado: pedidoCancelado.id,
    idPedidoLineaCancelado: lineaPedidoCancelado.id,
    idOrdenConMatriz: ordenMatrizConDetalle.id,
    folioOrdenConMatriz: ordenMatrizConDetalle.folio,
    totalOrdenConMatriz: ordenMatrizConDetalle.totalPiezas,
    idOrdenConReferencia: ordenRef.id,
    valorReferenciaDemo: valorReferencia,
    idOrdenCancelada: ordenCancelar.id,
  };
}

/** Imprime un resumen legible de lo sembrado (para Gabriel y la guía de verificación). */
function imprimirResumen(d: DatosDemo): void {
  console.log('\n── Datos demo de Órdenes (F2-E2) sembrados ──────────────────────────');
  console.log(`Empresa FR Moda .................. id ${d.idEmpresa}`);
  console.log(
    `Cliente Demo F2 ................. id ${d.idCliente}  (campo D7 id ${d.idClienteCampo})`,
  );
  console.log(
    `Otro Cliente Demo F2 ............ id ${d.idOtroCliente}  (campo D7 id ${d.idOtroClienteCampo})`,
  );
  console.log(`Modelo DEMO-501 ................. id ${d.idModelo}`);
  console.log(`Colores ......................... Rojo ${d.idColorRojo} · Azul ${d.idColorAzul}`);
  console.log(
    `Tallas .......................... CH ${d.idTallaCH} · M ${d.idTallaM} · G ${d.idTallaG}`,
  );
  console.log(
    `Pedido demo VIVO ................ id ${d.idPedido}  → renglón id ${d.idPedidoLinea}  (úsalo para crear órdenes)`,
  );
  console.log(
    `Pedido demo CANCELADO ........... id ${d.idPedidoCancelado}  → renglón id ${d.idPedidoLineaCancelado}  (crear orden = debe FALLAR)`,
  );
  console.log('Órdenes:');
  console.log(
    `  • DEMO-A (con matriz) ......... id ${d.idOrdenConMatriz}  folio ${d.folioOrdenConMatriz}  TOTAL ESPERADO ${d.totalOrdenConMatriz}`,
  );
  console.log(
    `  • DEMO-B (con referencia D7) .. id ${d.idOrdenConReferencia}  valor "${d.valorReferenciaDemo}"`,
  );
  console.log(`  • DEMO-C (cancelada) .......... id ${d.idOrdenCancelada}`);
  console.log('─────────────────────────────────────────────────────────────────────\n');
}

// Punto de entrada (`tsx scripts/datos-demo-ordenes.ts`).
const ejecutadoComoScript =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (ejecutadoComoScript) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Falta DATABASE_URL (ver backend/.env.example)');
    process.exit(1);
  }
  const prisma = crearClientePrisma(url);
  try {
    const datos = await sembrarDemo(prisma);
    imprimirResumen(datos);
    console.log('Datos demo de Órdenes (F2-E2) sembrados.');
  } finally {
    await prisma.$disconnect();
  }
}

export { sembrarDemo, type DatosDemo };
