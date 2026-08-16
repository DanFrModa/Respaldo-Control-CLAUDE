import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorPermiso } from '../../comun/errores.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import type { Avio, Color, Empresa, PrismaClient, Talla, Tela } from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { explosionarOrden } from '../compras/mrp.js';
import { crearOC } from '../compras/ordenes-compra.js';
import { obtenerCostoOrden } from '../costos/costo-orden.js';
import { enTransaccion } from '../../comun/transaccion.js';

import { habilitacionOrden } from './habilitacion-orden.js';
import {
  agregarRenglonReceta,
  copiarRecetaDelModelo,
  editarRenglonReceta,
  liberarReceta,
  marcarRecetaRevisada,
  obtenerRecetaOrden,
  quitarRenglonReceta,
  restaurarRenglonReceta,
} from './receta-orden.js';

/**
 * Integración de la RECETA CONGELADA DE LA ORDEN (V1-E3d pieza B, §Post-F9.43) contra Postgres.
 *
 * ⭐ **EL CRITERIO DE CIERRE DE LA ETAPA VIVE AQUÍ**: *"dos órdenes del mismo modelo, una con jareta
 * y otra sin, que compren cosas distintas y cuesten distinto — sin que ninguna altere a la otra ni a
 * las ya producidas"*. Lo prueba `describe('⭐ CRITERIO DE CIERRE …')` de punta a punta: MRP,
 * habilitación y costeo de las DOS órdenes a la vez.
 *
 * Lo demás cubre lo que solo la base valida: la copia al crear, la lápida del renglón excluido
 * (D3), el borrado real del agregado a mano con su copia íntegra en bitácora, restaurar, la puerta
 * de compra y el aislamiento entre órdenes.
 */

let cliente: PrismaClient;
let empresa: Empresa;
let idCliente: number;
let idModelo: number;
let colorRojo: Color;
let tallaCH: Talla;
let telaJersey: Tela;
let avioBoton: Avio;
let avioJareta: Avio;
let ordenA: number;
let ordenB: number;

/** Todos los permisos que este módulo toca (leer + administrar + los de los consumidores). */
const PERM: ClavePermiso[] = [
  'ordenes.ver',
  'desarrollo.administrar',
  'ordenes.habilitacion',
  'compras.ver',
  'costos.ver',
  'consultas.ver-importes',
];

function sesion(permisos: ClavePermiso[] = PERM, idEmpresaActiva = empresa.id): SesionUsuario {
  return sesionDePrueba({ idEmpresaActiva, permisos });
}

/** Sesión de COMPRAS (capturar una OC a mano exige `compras.administrar`). */
function sesionOc(): SesionUsuario {
  return sesionDePrueba({
    idEmpresaActiva: empresa.id,
    permisos: ['compras.administrar', 'compras.ver'],
  });
}

/** Cuerpo mínimo de una OC capturada A MANO, con o sin liga a la orden. */
async function cuerpoOc(nombreProveedor: string, idOrden?: number) {
  const proveedor = await cliente.proveedor.create({ data: { nombre: nombreProveedor } });
  const direccion =
    (await cliente.direccionEntrega.findFirst({ where: { nombre: 'Naucalpan' } })) ??
    (await cliente.direccionEntrega.create({
      data: { nombre: 'Naucalpan', direccion: 'Calle 1' },
    }));
  return {
    idProveedor: proveedor.id,
    idDireccionEntrega: direccion.id,
    fechaEntrega: '2026-09-30',
    lineas: [
      {
        idTela: telaJersey.id,
        cantidad: 10,
        precio: 50,
        unidad: 'kg',
        ...(idOrden === undefined ? {} : { idOrden }),
      },
    ],
  };
}

const bd = () => ({ cliente });

/** Crea una orden de 10 piezas del modelo base y le COPIA la receta (como hace el alta real). */
async function crearOrdenConReceta(folio: bigint): Promise<number> {
  const orden = await cliente.orden.create({
    data: {
      folio,
      idEmpresa: empresa.id,
      idModelo,
      idCliente,
      lineas: {
        create: [
          { idColor: colorRojo.id, tallas: { create: [{ idTalla: tallaCH.id, cantidad: 10 }] } },
        ],
      },
    },
  });
  await enTransaccion(
    (tx) =>
      copiarRecetaDelModelo(tx, sesion(), {
        id: orden.id,
        idEmpresa: empresa.id,
        idModelo,
      }),
    bd(),
  );
  return orden.id;
}

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  empresa = await crearEmpresaPrueba(cliente);
  idCliente = (await cliente.cliente.create({ data: { nombre: 'C&A' } })).id;
  colorRojo = await cliente.color.create({ data: { nombre: 'Rojo' } });
  tallaCH = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });
  telaJersey = await cliente.tela.create({ data: { nombre: 'Jersey', precioSugerido: 50 } });
  avioBoton = await cliente.avio.create({
    data: { clave: 'BOT-01', descripcion: 'Botón', unidad: 'pza', precioReferencia: 2 },
  });
  avioJareta = await cliente.avio.create({
    data: { clave: 'JAR-01', descripcion: 'Jareta', unidad: 'pza', precioReferencia: 8 },
  });

  const modelo = await cliente.modelo.create({
    data: { codigo: 'A-100', descripcion: 'Sudadera', llevaArte: false },
  });
  idModelo = modelo.id;
  await cliente.modeloTela.create({
    data: { idModelo, idTela: telaJersey.id, consumoPorPrenda: 1 },
  });
  await cliente.modeloAvio.createMany({
    data: [
      { idModelo, idAvio: avioBoton.id, consumoPorPrenda: 2 },
      { idModelo, idAvio: avioJareta.id, consumoPorPrenda: 1 },
    ],
  });

  ordenA = await crearOrdenConReceta(1n);
  ordenB = await crearOrdenConReceta(2n);
});

describe('copiarRecetaDelModelo — la receta nace con la orden', () => {
  it('copia telas, avíos y sus banderas, con el precio de la cascada del modelo', async () => {
    const r = await obtenerRecetaOrden(sesion(), ordenA, bd());
    expect(r.telas).toHaveLength(1);
    expect(r.avios).toHaveLength(2);
    expect(r.telas[0]).toMatchObject({
      nombre: 'Jersey',
      consumoPorPrenda: 1,
      // El precio se congela con la MISMA cascada que ve Desarrollo en la ficha del modelo.
      precio: 50,
      estado: 'sin_revisar',
      agregadoAMano: false,
      excluido: false,
      enElModelo: true,
    });
    expect(r.avios.map((a) => a.precio).sort()).toEqual([2, 8]);
  });

  it('la receta nace SIN LIBERAR y sin desalineación (acaba de copiarse)', async () => {
    const r = await obtenerRecetaOrden(sesion(), ordenA, bd());
    expect(r.puedeComprar).toBe(false);
    expect(r.liberadaEn).toBeNull();
    expect(r.desalineacion.hayCambios).toBe(false);
    expect(r.resumen).toMatchObject({ sinRevisar: 3, revisados: 0, ajustados: 0, total: 3 });
  });

  it('el proveedor amarrado del avío sale del amarre de LA ORDEN, no del modelo', async () => {
    // Se amarra el avío a un proveedor EN LA ORDEN, y en el modelo a OTRO. La receta tiene que
    // nombrar al de la orden: enseñar el del modelo sería decir una cosa y comprarle a otra.
    const suyo = await cliente.proveedor.create({ data: { nombre: 'Avíos de la Orden' } });
    const ajeno = await cliente.proveedor.create({ data: { nombre: 'Avíos del Modelo' } });
    await cliente.avioProveedor.createMany({
      data: [
        { idAvio: avioBoton.id, idProveedor: suyo.id, precio: 1 },
        { idAvio: avioBoton.id, idProveedor: ajeno.id, precio: 9 },
      ],
    });
    await cliente.modeloAvio.update({
      where: { idModelo_idAvio: { idModelo, idAvio: avioBoton.id } },
      data: { idAvioProveedor: ajeno.id },
    });
    await cliente.ordenAvio.update({
      where: { idOrden_idAvio: { idOrden: ordenA, idAvio: avioBoton.id } },
      data: { idAvioProveedor: suyo.id },
    });

    const r = await obtenerRecetaOrden(sesion(), ordenA, bd());
    const boton = r.avios.find((a) => a.idAvio === avioBoton.id);
    expect(boton?.idAvioProveedor).toBe(suyo.id);
    expect(boton?.proveedorAmarrado).toBe('Avíos de la Orden');
  });

  it('es IDEMPOTENTE: volver a copiar no duplica renglones', async () => {
    await enTransaccion(
      (tx) => copiarRecetaDelModelo(tx, sesion(), { id: ordenA, idEmpresa: empresa.id, idModelo }),
      bd(),
    );
    const r = await obtenerRecetaOrden(sesion(), ordenA, bd());
    expect(r.telas).toHaveLength(1);
    expect(r.avios).toHaveLength(2);
  });
});

describe('La PUERTA de compra (§Post-F9.43(c))', () => {
  it('sin liberar NO se puede explotar el MRP', async () => {
    await expect(explosionarOrden(sesion(), ordenA, bd())).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('liberar exige que no quede ningún renglón SIN REVISAR', async () => {
    await expect(liberarReceta(sesion(), ordenA, bd())).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('«marcar todo revisado» resuelve el 89 % de un clic, y entonces sí libera', async () => {
    const revisada = await marcarRecetaRevisada(sesion(), ordenA, bd());
    expect(revisada.resumen).toMatchObject({ sinRevisar: 0, revisados: 3 });

    const liberada = await liberarReceta(sesion(), ordenA, bd());
    expect(liberada.puedeComprar).toBe(true);
    expect(liberada.liberadaEn).not.toBeNull();

    const explosion = await explosionarOrden(sesion(), ordenA, bd());
    expect(explosion.grupos.flatMap((g) => g.renglones)).toHaveLength(3);
  });

  it('una receta VACÍA no se puede liberar (liberar "nada" sería mentir)', async () => {
    const orden = await cliente.orden.create({
      data: { folio: 99n, idEmpresa: empresa.id, idModelo, idCliente },
    });
    await expect(liberarReceta(sesion(), orden.id, bd())).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('⚠️ CORTAR Y PRODUCIR NO se bloquean: la habilitación funciona sin liberar', async () => {
    // La puerta va antes de COMPRAR, no antes de producir (Daniel). La habilitación —que es lo que
    // el piso mira para surtir— responde igual con la receta sin liberar.
    const h = await habilitacionOrden(sesion(), ordenA, bd());
    expect(h.avios).toHaveLength(2);
  });
});

describe('Quitar un renglón — la lápida (D3, regla 4)', () => {
  it('el renglón que vino del MODELO se EXCLUYE (no se borra) y deja de contar', async () => {
    const r = await quitarRenglonReceta(
      sesion(),
      ordenA,
      'avio',
      (await obtenerRecetaOrden(sesion(), ordenA, bd())).avios.find(
        (a) => a.idAvio === avioJareta.id,
      )!.id,
      { motivo: 'El cliente la negoció fuera' },
      bd(),
    );
    const jareta = r.avios.find((a) => a.idAvio === avioJareta.id);
    expect(jareta).toBeDefined();
    expect(jareta).toMatchObject({
      excluido: true,
      estado: 'ajustado',
      notas: 'El cliente la negoció fuera',
    });
    // Sigue existiendo en BD: la lápida es lo que permite distinguir "se la quité" de "el modelo la
    // agregó" cuando se compara con el BOM vivo.
    expect(await cliente.ordenAvio.count({ where: { idOrden: ordenA } })).toBe(2);
  });

  it('un renglón AGREGADO A MANO sí se borra, con su copia ÍNTEGRA en la bitácora (D3)', async () => {
    // Un avío que NO está en el modelo: ése sí nace agregado a mano.
    const avioExtra = await cliente.avio.create({
      data: { clave: 'EXT-01', descripcion: 'Etiqueta', unidad: 'pza' },
    });
    const conExtra = await agregarRenglonReceta(
      sesion(),
      ordenA,
      { tipo: 'avio', idAvio: avioExtra.id, consumoPorPrenda: 1, precio: 0.15 },
      bd(),
    );
    const extra = conExtra.avios.find((a) => a.idAvio === avioExtra.id)!;
    expect(extra).toMatchObject({ agregadoAMano: true, estado: 'ajustado', enElModelo: false });

    const sinExtra = await quitarRenglonReceta(sesion(), ordenA, 'avio', extra.id, {}, bd());
    expect(sinExtra.avios.find((a) => a.idAvio === avioExtra.id)).toBeUndefined();

    // D3: lo que desapareció quedó ÍNTEGRO en la bitácora, no como un conteo.
    const rastro = await cliente.bitacora.findFirst({
      where: { entidad: 'RecetaOrden', idEntidad: String(ordenA), accion: 'CANCELAR' },
      orderBy: { id: 'desc' },
    });
    expect(rastro?.datos).toMatchObject({
      tipo: 'avio',
      idAvio: avioExtra.id,
      consumoPorPrenda: 1,
      precio: 0.15,
      borrado: true,
    });
  });
});

describe('⭐ Re-agregar un renglón VIVO — el precio congelado NO se puede perder', () => {
  it('re-agregar un renglón VIVO se RECHAZA (409) y no toca precio, banderas ni amarre', async () => {
    // Escenario del reviewer: la tela está congelada a $50, marcada fuera de costo y amarrada a un
    // proveedor. Antes, "agregarla" otra vez la sobrescribía en silencio con los defaults del
    // esquema: precio null, paraCosto true, amarre borrado. Dos clics en la propia pantalla.
    const alsatex = await cliente.proveedor.create({ data: { nombre: 'Alsatex' } });
    const amarre = await cliente.telaProveedor.create({
      data: { idTela: telaJersey.id, idProveedor: alsatex.id, precio: 47 },
    });
    await cliente.ordenTela.update({
      where: { idOrden_idTela: { idOrden: ordenA, idTela: telaJersey.id } },
      data: { precio: 50, paraCosto: false, idTelaProveedor: amarre.id },
    });

    await expect(
      agregarRenglonReceta(
        sesion(),
        ordenA,
        { tipo: 'tela', idTela: telaJersey.id, consumoPorPrenda: 2 },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    const fila = await cliente.ordenTela.findFirstOrThrow({
      where: { idOrden: ordenA, idTela: telaJersey.id },
    });
    expect(fila.precio?.toNumber()).toBe(50); // el precio congelado SIGUE ahí
    expect(fila.paraCosto).toBe(false); // la bandera no se volteó
    expect(fila.idTelaProveedor).toBe(amarre.id); // el amarre no se borró
    expect(fila.consumoPorPrenda.toNumber()).toBe(1); // ni el consumo se movió
  });

  it('lo mismo para AVÍO y para ARTE (los tres caminos rechazan el renglón vivo)', async () => {
    await expect(
      agregarRenglonReceta(
        sesion(),
        ordenA,
        { tipo: 'avio', idAvio: avioBoton.id, consumoPorPrenda: 9 },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    await agregarRenglonReceta(
      sesion(),
      ordenA,
      { tipo: 'arte', nombre: 'Logo pecho', precio: 12 },
      bd(),
    );
    await expect(
      agregarRenglonReceta(sesion(), ordenA, { tipo: 'arte', nombre: 'Logo pecho' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('REVIVIR una lápida NO pisa lo que el cuerpo no trae, y deja el `antes` en la bitácora (D3)', async () => {
    const amarre = await cliente.telaProveedor.create({
      data: {
        idTela: telaJersey.id,
        idProveedor: (await cliente.proveedor.create({ data: { nombre: 'Bloom' } })).id,
        precio: 44,
      },
    });
    await cliente.ordenTela.update({
      where: { idOrden_idTela: { idOrden: ordenA, idTela: telaJersey.id } },
      data: { precio: 50, paraCosto: false, idTelaProveedor: amarre.id },
    });
    const r0 = await obtenerRecetaOrden(sesion(), ordenA, bd());
    const tela = r0.telas.find((t) => t.idTela === telaJersey.id)!;
    await quitarRenglonReceta(sesion(), ordenA, 'tela', tela.id, { motivo: 'ajuste' }, bd());

    // Se re-agrega mandando SOLO el consumo: lo demás tiene que sobrevivir.
    const r = await agregarRenglonReceta(
      sesion(),
      ordenA,
      { tipo: 'tela', idTela: telaJersey.id, consumoPorPrenda: 3 },
      bd(),
    );
    const revivida = r.telas.find((t) => t.idTela === telaJersey.id)!;
    expect(revivida.excluido).toBe(false);
    expect(revivida.consumoPorPrenda).toBe(3); // sí se aplica lo que vino
    expect(revivida.precio).toBe(50); // ⭐ el precio congelado sobrevive
    expect(revivida.paraCosto).toBe(false); // la bandera sobrevive
    expect(revivida.idTelaProveedor).toBe(amarre.id); // el amarre sobrevive
    expect(revivida.agregadoAMano).toBe(false); // vino del modelo: su origen no cambia

    // A7/D3: la bitácora del revivir lleva el estado ANTERIOR íntegro y dice la verdad.
    const rastro = await cliente.bitacora.findFirst({
      where: { entidad: 'RecetaOrden', idEntidad: String(ordenA), accion: 'CREAR' },
      orderBy: { id: 'desc' },
    });
    expect(rastro?.datos).toMatchObject({
      revivido: true,
      antes: { precio: 50, paraCosto: false, excluido: true, idTelaProveedor: amarre.id },
    });
  });

  it('un renglón NUEVO sí aplica los defaults (paraX true) y se marca `revivido: false`', async () => {
    const otra = await cliente.avio.create({
      data: { clave: 'ETI-01', descripcion: 'Etiqueta', unidad: 'pza' },
    });
    const r = await agregarRenglonReceta(
      sesion(),
      ordenA,
      { tipo: 'avio', idAvio: otra.id, consumoPorPrenda: 1 },
      bd(),
    );
    const nuevo = r.avios.find((a) => a.idAvio === otra.id)!;
    expect(nuevo).toMatchObject({
      paraPreCosto: true,
      paraProduccion: true,
      paraCosto: true,
      agregadoAMano: true,
      estado: 'ajustado',
    });
    const rastro = await cliente.bitacora.findFirst({
      where: { entidad: 'RecetaOrden', idEntidad: String(ordenA), accion: 'CREAR' },
      orderBy: { id: 'desc' },
    });
    expect(rastro?.datos).toMatchObject({ revivido: false });
  });
});

describe('Restaurar y desalineación (§Post-F9.43(f))', () => {
  it('editar deja el renglón AJUSTADO y su diferencia con el modelo deja de avisar', async () => {
    const r0 = await obtenerRecetaOrden(sesion(), ordenA, bd());
    const boton = r0.avios.find((a) => a.idAvio === avioBoton.id)!;
    const r = await editarRenglonReceta(
      sesion(),
      ordenA,
      'avio',
      boton.id,
      { consumoPorPrenda: 5 },
      bd(),
    );
    const ajustado = r.avios.find((a) => a.idAvio === avioBoton.id)!;
    expect(ajustado).toMatchObject({ estado: 'ajustado', consumoPorPrenda: 5, consumoModelo: 2 });
    // La diferencia la puso una persona: NO grita.
    expect(r.desalineacion.hayCambios).toBe(false);
  });

  it('si el MODELO cambia después, la receta congelada NO se mueve y el aviso lo dice', async () => {
    await cliente.modeloAvio.update({
      where: { idModelo_idAvio: { idModelo, idAvio: avioBoton.id } },
      data: { consumoPorPrenda: 9 },
    });
    const r = await obtenerRecetaOrden(sesion(), ordenA, bd());
    expect(r.avios.find((a) => a.idAvio === avioBoton.id)?.consumoPorPrenda).toBe(2);
    expect(r.desalineacion.hayCambios).toBe(true);
    expect(r.desalineacion.cambios[0]).toMatchObject({ que: 'consumo', tipo: 'avio' });
    expect(r.desalineacion.conOrdenCompra).toBe(false);
  });

  it('RESTAURAR trae el valor del modelo a mano y apaga el aviso', async () => {
    await cliente.modeloAvio.update({
      where: { idModelo_idAvio: { idModelo, idAvio: avioBoton.id } },
      data: { consumoPorPrenda: 9 },
    });
    const r0 = await obtenerRecetaOrden(sesion(), ordenA, bd());
    const boton = r0.avios.find((a) => a.idAvio === avioBoton.id)!;

    const r = await restaurarRenglonReceta(sesion(), ordenA, 'avio', boton.id, bd());
    const restaurado = r.avios.find((a) => a.idAvio === avioBoton.id)!;
    expect(restaurado).toMatchObject({ consumoPorPrenda: 9, estado: 'revisado', excluido: false });
    expect(r.desalineacion.hayCambios).toBe(false);
  });

  it('renombrar un arte a un nombre YA OCUPADO da 409 con mensaje, no un P2002 crudo', async () => {
    // El nombre es la identidad del arte dentro de la orden (@@unique). Sin pre-chequeo esto
    // reventaba con el error crudo de Prisma → 500 al usuario.
    const r0 = await agregarRenglonReceta(
      sesion(),
      ordenA,
      { tipo: 'arte', nombre: 'Logo pecho', precio: 12 },
      bd(),
    );
    await agregarRenglonReceta(sesion(), ordenA, { tipo: 'arte', nombre: 'Logo manga' }, bd());
    const pecho = r0.artes.find((a) => a.nombre === 'Logo pecho')!;

    await expect(
      editarRenglonReceta(sesion(), ordenA, 'arte', pecho.id, { nombre: 'Logo manga' }, bd()),
    ).rejects.toThrow(/ya tiene un arte llamado "Logo manga"/);

    // Y la LÁPIDA también ocupa el nombre (el índice único no distingue): el mensaje lo dice y
    // ofrece la salida buena, que es revivirla.
    await cliente.ordenArte.create({
      data: { idOrden: ordenA, nombre: 'Logo viejo', excluido: true },
    });
    await expect(
      editarRenglonReceta(sesion(), ordenA, 'arte', pecho.id, { nombre: 'Logo viejo' }, bd()),
    ).rejects.toThrow(/sigue en su historial/);
  });

  it('restaurar un renglón que YA NO está en el modelo se rechaza con un mensaje claro', async () => {
    const r0 = await obtenerRecetaOrden(sesion(), ordenA, bd());
    const boton = r0.avios.find((a) => a.idAvio === avioBoton.id)!;
    await cliente.modeloAvio.delete({
      where: { idModelo_idAvio: { idModelo, idAvio: avioBoton.id } },
    });
    await expect(
      restaurarRenglonReceta(sesion(), ordenA, 'avio', boton.id, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });
});

describe('⭐ La firma de Desarrollo se revoca al cambiar el contenido (hallazgo del reviewer)', () => {
  /** Deja la receta de A liberada (el punto de partida de estos casos). */
  async function liberarA(): Promise<void> {
    await marcarRecetaRevisada(sesion(), ordenA, bd());
    await liberarReceta(sesion(), ordenA, bd());
  }

  it('AGREGAR material a una receta ya liberada la RE-ABRE (no se compra sin re-revisar)', async () => {
    await liberarA();
    const otro = await cliente.avio.create({
      data: { clave: 'NEW-1', descripcion: 'Etiqueta', unidad: 'pza' },
    });

    const r = await agregarRenglonReceta(
      sesion(),
      ordenA,
      { tipo: 'avio', idAvio: otro.id, consumoPorPrenda: 1 },
      bd(),
    );

    expect(r.puedeComprar).toBe(false);
    expect(r.liberadaEn).toBeNull();
    // Y la puerta vuelve a estar cerrada de verdad.
    await expect(explosionarOrden(sesion(), ordenA, bd())).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('EDITAR, QUITAR y RESTAURAR también la re-abren', async () => {
    for (const accion of ['editar', 'quitar', 'restaurar'] as const) {
      await liberarA();
      const r0 = await obtenerRecetaOrden(sesion(), ordenA, bd());
      expect(r0.puedeComprar).toBe(true);
      const boton = r0.avios.find((a) => a.idAvio === avioBoton.id)!;

      const r =
        accion === 'editar'
          ? await editarRenglonReceta(
              sesion(),
              ordenA,
              'avio',
              boton.id,
              { consumoPorPrenda: 7 },
              bd(),
            )
          : accion === 'quitar'
            ? await quitarRenglonReceta(sesion(), ordenA, 'avio', boton.id, {}, bd())
            : await restaurarRenglonReceta(sesion(), ordenA, 'avio', boton.id, bd());

      expect(r.puedeComprar).toBe(false);
    }
  });

  it('«marcar todo revisado» NO la re-abre (no cambia QUÉ se compra)', async () => {
    await liberarA();
    const r = await marcarRecetaRevisada(sesion(), ordenA, bd());
    expect(r.puedeComprar).toBe(true);
  });

  it('la revocación queda en la bitácora, con su motivo (A7)', async () => {
    await liberarA();
    await editarRenglonReceta(
      sesion(),
      ordenA,
      'avio',
      (await obtenerRecetaOrden(sesion(), ordenA, bd())).avios[0]!.id,
      { precio: 3 },
      bd(),
    );
    const rastro = await cliente.bitacora.findFirst({
      where: { entidad: 'RecetaOrden', idEntidad: String(ordenA), accion: 'MODIFICAR' },
      orderBy: { id: 'desc' },
    });
    expect(rastro?.datos).toMatchObject({ accion: 'liberacion-revocada' });
  });
});

describe('⭐ La puerta cubre TAMBIÉN la OC capturada a mano (hallazgo del reviewer)', () => {
  it('crear una OC ligada a una orden SIN liberar se rechaza', async () => {
    await expect(
      crearOC(sesionOc(), await cuerpoOc('Telas del Norte', ordenA), bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('…y se permite en cuanto Desarrollo la libera', async () => {
    await marcarRecetaRevisada(sesion(), ordenA, bd());
    await liberarReceta(sesion(), ordenA, bd());

    const oc = await crearOC(sesionOc(), await cuerpoOc('Telas del Sur', ordenA), bd());
    expect(oc.id).toBeGreaterThan(0);
  });

  it('una OC LIBRE (sin orden ligada) no pasa por la puerta: se puede capturar siempre', async () => {
    const oc = await crearOC(sesionOc(), await cuerpoOc('Telas Libres'), bd());
    expect(oc.id).toBeGreaterThan(0);
  });
});

describe('RBAC y empresa (A4/A9)', () => {
  it('leer sin `ordenes.ver` → 403', async () => {
    await expect(obtenerRecetaOrden(sesion([]), ordenA, bd())).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('tocar sin `desarrollo.administrar` → 403', async () => {
    await expect(
      marcarRecetaRevisada(sesion(['ordenes.ver']), ordenA, bd()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('la orden de OTRA empresa no existe para esta sesión → 404 (A9)', async () => {
    const otra = await crearEmpresaPrueba(cliente, 'Otra empresa');
    await expect(obtenerRecetaOrden(sesion(PERM, otra.id), ordenA, bd())).rejects.toBeInstanceOf(
      ErrorNoEncontrado,
    );
  });

  it('⚠️ la PUERTA no filtra información: una orden ajena da 404, no "receta sin liberar"', async () => {
    // La orden A existe y NO tiene su receta liberada. Desde OTRA empresa la respuesta tiene que
    // ser 404 —no un 409 que confirme que existe y en qué estado está—, así que el gate corre
    // DESPUÉS del filtro por empresa (A9).
    const otra = await crearEmpresaPrueba(cliente, 'Empresa ajena');
    await expect(explosionarOrden(sesion(PERM, otra.id), ordenA, bd())).rejects.toBeInstanceOf(
      ErrorNoEncontrado,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// ⭐ EL CRITERIO DE CIERRE DE LA ETAPA
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('⭐ CRITERIO DE CIERRE — dos órdenes del mismo modelo, una con jareta y otra sin', () => {
  it('compran cosas distintas, cuestan distinto, y ninguna altera a la otra', async () => {
    // ── La orden B pierde la jareta (lo que Daniel describió literalmente) ──
    const rB0 = await obtenerRecetaOrden(sesion(), ordenB, bd());
    const jaretaB = rB0.avios.find((a) => a.idAvio === avioJareta.id)!;
    await quitarRenglonReceta(
      sesion(),
      ordenB,
      'avio',
      jaretaB.id,
      { motivo: 'Negociado con el cliente para abaratar' },
      bd(),
    );

    // Las dos se revisan y se liberan (la puerta de compra).
    for (const id of [ordenA, ordenB]) {
      await marcarRecetaRevisada(sesion(), id, bd());
      await liberarReceta(sesion(), id, bd());
    }

    // ── 1. COMPRAN COSAS DISTINTAS (MRP) ──
    const renglonesA = (await explosionarOrden(sesion(), ordenA, bd())).grupos.flatMap(
      (g) => g.renglones,
    );
    const renglonesB = (await explosionarOrden(sesion(), ordenB, bd())).grupos.flatMap(
      (g) => g.renglones,
    );
    expect(renglonesA.map((r) => r.idAvio)).toContain(avioJareta.id);
    expect(renglonesB.map((r) => r.idAvio)).not.toContain(avioJareta.id);
    expect(renglonesA).toHaveLength(3);
    expect(renglonesB).toHaveLength(2);

    // ── 2. SE SURTEN DISTINTO (habilitación) ──
    const habA = await habilitacionOrden(sesion(), ordenA, bd());
    const habB = await habilitacionOrden(sesion(), ordenB, bd());
    expect(habA.avios).toHaveLength(2);
    expect(habB.avios).toHaveLength(1);

    // ── 3. CUESTAN DISTINTO (costeo teórico por prenda) ──
    // A: tela 1×50 + avíos (2×2 + 1×8) = 50 + 12. B: tela 1×50 + avíos (2×2) = 50 + 4.
    const costoA = await obtenerCostoOrden(sesion(), ordenA, bd());
    const costoB = await obtenerCostoOrden(sesion(), ordenB, bd());
    expect(costoA.teorico.aviosPorPrenda).toBeCloseTo(12, 6);
    expect(costoB.teorico.aviosPorPrenda).toBeCloseTo(4, 6);
    expect(costoA.teorico.telaPorPrenda).toBeCloseTo(50, 6);

    // ── 4. NINGUNA ALTERÓ A LA OTRA (ni al modelo) ──
    const rA = await obtenerRecetaOrden(sesion(), ordenA, bd());
    expect(rA.avios.find((a) => a.idAvio === avioJareta.id)?.excluido).toBe(false);
    expect(await cliente.modeloAvio.count({ where: { idModelo, idAvio: avioJareta.id } })).toBe(1);
    // …y ninguna de las dos grita: las dos están alineadas con lo que decidieron.
    expect(rA.desalineacion.hayCambios).toBe(false);
    expect((await obtenerRecetaOrden(sesion(), ordenB, bd())).desalineacion.hayCambios).toBe(false);
  });

  it('y la orden YA PRODUCIDA tampoco se entera si mañana el modelo pierde la jareta', async () => {
    // La orden A se libera y se produce; después alguien quita la jareta DEL MODELO. Antes de esta
    // etapa eso apagaba la jareta en TODAS las órdenes, incluidas las ya producidas con jareta.
    await marcarRecetaRevisada(sesion(), ordenA, bd());
    await liberarReceta(sesion(), ordenA, bd());

    await cliente.modeloAvio.delete({
      where: { idModelo_idAvio: { idModelo, idAvio: avioJareta.id } },
    });

    const costo = await obtenerCostoOrden(sesion(), ordenA, bd());
    expect(costo.teorico.aviosPorPrenda).toBeCloseTo(12, 6);
    const hab = await habilitacionOrden(sesion(), ordenA, bd());
    expect(hab.avios.map((a) => a.idAvio)).toContain(avioJareta.id);
    // Eso sí: la orden AVISA de la diferencia (calculada al vuelo), sin haberse movido.
    const r = await obtenerRecetaOrden(sesion(), ordenA, bd());
    expect(r.desalineacion.cambios.some((c) => c.que === 'quitado')).toBe(true);
  });
});
