import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import {
  ErrorConflicto,
  ErrorNoEncontrado,
  ErrorPermiso,
  ErrorValidacion,
} from '../../comun/errores.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import type { Avio, Color, Empresa, PrismaClient, Talla, Tela } from '../../datos/index.js';
import {
  clientePruebas,
  crearEmpresaPrueba,
  crearTipoArtePrueba,
  limpiarBaseDatos,
} from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { explosionarOrden } from '../compras/mrp.js';
import { actualizarOC, crearOC } from '../compras/ordenes-compra.js';
import { obtenerCostoOrden } from '../costos/costo-orden.js';
import { enTransaccion } from '../../comun/transaccion.js';

import { habilitacionOrden } from './habilitacion-orden.js';
import { consultarRecetasPorLiberar } from './recetas-por-liberar.js';
import {
  agregarRenglonReceta,
  copiarRecetaDelModelo,
  editarRenglonReceta,
  leerRecetaParaImpreso,
  liberarReceta,
  marcarRecetaRevisada,
  obtenerRecetaOrden,
  quitarRenglonReceta,
  restaurarRenglonReceta,
  traerDelModelo,
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
/** Id del tipo de arte «bordado» del catálogo único (V1-E3f): el arte no existe sin él. */
let idTipoArte: number;
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
  'desarrollo.ver',
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
  idTipoArte = await crearTipoArtePrueba(cliente);
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

  it('⭐ CONGELA el ARTE del modelo completo: descripción, posición, TIPO, puntadas y precio', async () => {
    // El productor principal de `OrdenArte` es esta copia, y lo que copia MAL no se nota hasta que
    // alguien lee la orden meses después. V1-E3f le agregó campos (`posicion`, `idTipoArte`) y la
    // `descripcion` pasó a ser lo único que identifica el arte de cara al usuario: si alguno se
    // quedara fuera de la copia, la orden nacería con historia incompleta y en silencio.
    const proveedor = await cliente.proveedor.create({ data: { nombre: 'Bordados SA' } });
    const idTipoEstampado = await crearTipoArtePrueba(cliente, 'estampado', {
      nombre: 'Estampado',
    });
    const arteModelo = await cliente.modeloArte.create({
      data: {
        idModelo,
        descripcion: 'Águila a tres hilos',
        posicion: 'manga izquierda',
        idTipoArte: idTipoEstampado,
        puntadas: 8000,
        precio: 33.5,
        idProveedor: proveedor.id,
        orden: 0,
      },
    });
    // Un SEGUNDO arte de OTRO tipo: cada renglón congelado tiene que llevar EL SUYO. Con uno solo
    // no se distinguiría "copia el tipo de cada arte" de "copia el tipo del primero".
    const arteBordado = await cliente.modeloArte.create({
      data: { idModelo, descripcion: 'Etiqueta bordada', idTipoArte, orden: 1 },
    });

    const orden = await crearOrdenConReceta(3n);
    const r = await obtenerRecetaOrden(sesion(), orden, bd());

    expect(r.artes).toHaveLength(2);
    expect(r.artes.find((a) => a.idModeloArte === arteBordado.id)).toMatchObject({
      descripcion: 'Etiqueta bordada',
      posicion: null,
      idTipoArte,
      codigoTipoArte: 'bordado',
      usaPuntadas: true,
    });
    expect(r.artes.find((a) => a.idModeloArte === arteModelo.id)).toMatchObject({
      idModeloArte: arteModelo.id,
      descripcion: 'Águila a tres hilos',
      posicion: 'manga izquierda',
      idTipoArte: idTipoEstampado,
      tipoArte: 'Estampado',
      codigoTipoArte: 'estampado',
      usaPuntadas: false,
      puntadas: 8000,
      precio: 33.5,
      idProveedor: proveedor.id,
      agregadoAMano: false,
      excluido: false,
      enElModelo: true,
    });

    // Y en la FILA congelada, no solo en la proyección que la pantalla arma al vuelo.
    const fila = await cliente.ordenArte.findFirstOrThrow({
      where: { idOrden: orden, idModeloArte: arteModelo.id },
    });
    expect(fila).toMatchObject({
      idModeloArte: arteModelo.id,
      descripcion: 'Águila a tres hilos',
      posicion: 'manga izquierda',
      idTipoArte: idTipoEstampado,
      puntadas: 8000,
    });
    expect(fila.precio?.toNumber()).toBe(33.5);
  });

  it('lo copiado queda CONGELADO: cambiar el arte del modelo después no lo mueve', async () => {
    const arteModelo = await cliente.modeloArte.create({
      data: { idModelo, descripcion: 'Escudo', posicion: 'frente', idTipoArte, precio: 20 },
    });
    const orden = await crearOrdenConReceta(4n);

    // El modelo cambia DESPUÉS de que la orden nació: la orden conserva lo suyo (§Post-F9.43).
    await cliente.modeloArte.update({
      where: { id: arteModelo.id },
      data: { descripcion: 'Escudo v2', posicion: 'espalda', precio: 99 },
    });

    const fila = await cliente.ordenArte.findFirstOrThrow({ where: { idOrden: orden } });
    expect(fila.descripcion).toBe('Escudo');
    expect(fila.posicion).toBe('frente');
    expect(fila.precio?.toNumber()).toBe(20);

    // Y la diferencia SE AVISA (para eso está el comparador), no se tapa.
    const r = await obtenerRecetaOrden(sesion(), orden, bd());
    expect(r.desalineacion.hayCambios).toBe(true);
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
    await expect(liberarReceta(sesion(), ordenA, {}, bd())).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('«marcar todo revisado» resuelve el 89 % de un clic, y entonces sí libera', async () => {
    const revisada = await marcarRecetaRevisada(sesion(), ordenA, bd());
    expect(revisada.resumen).toMatchObject({ sinRevisar: 0, revisados: 3 });

    const liberada = await liberarReceta(sesion(), ordenA, {}, bd());
    expect(liberada.puedeComprar).toBe(true);
    expect(liberada.liberadaEn).not.toBeNull();

    const explosion = await explosionarOrden(sesion(), ordenA, bd());
    expect(explosion.grupos.flatMap((g) => g.renglones)).toHaveLength(3);
  });

  it('una receta VACÍA no se puede liberar (liberar "nada" sería mentir)', async () => {
    const orden = await cliente.orden.create({
      data: { folio: 99n, idEmpresa: empresa.id, idModelo, idCliente },
    });
    await expect(liberarReceta(sesion(), orden.id, {}, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );
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

    // V1-E3f: el arte se identifica por su TRAZA al arte del modelo (`idModeloArte`), no por
    // nombre. Re-agregar el MISMO arte del modelo cuando ya está vivo sigue siendo un 409.
    const arteModelo = await cliente.modeloArte.create({
      data: { idModelo, descripcion: 'Logo pecho', idTipoArte, precio: 12 },
    });
    await agregarRenglonReceta(
      sesion(),
      ordenA,
      { tipo: 'arte', idModeloArte: arteModelo.id, precio: 12 },
      bd(),
    );
    await expect(
      agregarRenglonReceta(sesion(), ordenA, { tipo: 'arte', idModeloArte: arteModelo.id }, bd()),
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

  it('V1-E3f: la identidad del arte es su TRAZA, no el texto — dos artes a mano pueden llamarse igual', async () => {
    // Antes el `nombre` era `@@unique([idOrden, nombre])` y renombrar a uno ocupado daba 409. Al
    // retirarse el nombre (§Post-F9.52 punto 1) esa restricción se fue A PROPÓSITO: lo único único
    // es `(idOrden, idModeloArte)`, y los agregados a mano llevan `idModeloArte` NULL (Postgres
    // trata los NULL como distintos), así que caben varios.
    await agregarRenglonReceta(
      sesion(),
      ordenA,
      { tipo: 'arte', descripcion: 'Logo pecho', idTipoArte, precio: 12 },
      bd(),
    );
    const r1 = await agregarRenglonReceta(
      sesion(),
      ordenA,
      { tipo: 'arte', descripcion: 'Logo pecho', idTipoArte, precio: 20 },
      bd(),
    );
    const homonimos = r1.artes.filter((a) => a.descripcion === 'Logo pecho');
    expect(homonimos).toHaveLength(2);
    expect(homonimos.every((a) => a.agregadoAMano && a.idModeloArte === null)).toBe(true);

    // Y editar la descripción de uno a la del otro tampoco choca.
    const primero = homonimos[0];
    expect(primero).toBeDefined();
    const r2 = await editarRenglonReceta(
      sesion(),
      ordenA,
      'arte',
      primero?.id ?? 0,
      { descripcion: 'Logo manga' },
      bd(),
    );
    expect(r2.artes.find((a) => a.id === primero?.id)?.descripcion).toBe('Logo manga');
  });

  it('un arte AGREGADO A MANO sin descripción o sin tipo se rechaza (no hay de dónde heredarlos)', async () => {
    await expect(
      agregarRenglonReceta(sesion(), ordenA, { tipo: 'arte', descripcion: 'Sin tipo' }, bd()),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    await expect(
      agregarRenglonReceta(sesion(), ordenA, { tipo: 'arte', idTipoArte }, bd()),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('agregar por TRAZA hereda del arte del modelo y revive su lápida sin pisar lo congelado', async () => {
    const arteModelo = await cliente.modeloArte.create({
      data: {
        idModelo,
        descripcion: 'Escudo',
        posicion: 'espalda',
        idTipoArte,
        puntadas: 800,
        precio: 30,
      },
    });

    // Nace heredando TODO del modelo (y `revisado`, porque es copia fiel).
    const r1 = await agregarRenglonReceta(
      sesion(),
      ordenA,
      { tipo: 'arte', idModeloArte: arteModelo.id },
      bd(),
    );
    const congelado = r1.artes.find((a) => a.idModeloArte === arteModelo.id);
    expect(congelado).toMatchObject({
      descripcion: 'Escudo',
      posicion: 'espalda',
      puntadas: 800,
      precio: 30,
      agregadoAMano: false,
      estado: 'revisado',
      enElModelo: true,
    });

    // Se le ajusta el precio EN ESTA ORDEN y se quita (queda lápida, no se borra).
    await editarRenglonReceta(sesion(), ordenA, 'arte', congelado?.id ?? 0, { precio: 44 }, bd());
    await quitarRenglonReceta(sesion(), ordenA, 'arte', congelado?.id ?? 0, {}, bd());

    // Re-agregarlo REVIVE la misma fila y NO pisa su precio ajustado (el cuerpo no lo trae).
    const r3 = await agregarRenglonReceta(
      sesion(),
      ordenA,
      { tipo: 'arte', idModeloArte: arteModelo.id },
      bd(),
    );
    const revivido = r3.artes.find((a) => a.idModeloArte === arteModelo.id);
    expect(revivido?.id).toBe(congelado?.id);
    expect(revivido?.excluido).toBe(false);
    expect(revivido?.precio).toBe(44);
  });

  it('el arte de la orden se casa con el del modelo por la TRAZA, no "por el que haya"', async () => {
    // El modelo tiene UN arte y la orden lleva otro AGREGADO A MANO (sin traza). Son cosas
    // distintas y la receta tiene que decirlo: el de la orden NO está en el modelo, y el del
    // modelo aparece como FALTANTE. Si el casamiento ignorara la traza —p. ej. tomando "el primer
    // arte del modelo"— los dos saldrían alineados y el aviso de desalineación se quedaría mudo,
    // que es justo lo que la etapa vino a evitar (§Post-F9.52 punto 1: sin nombre, la traza ES la
    // identidad).
    const delModelo = await cliente.modeloArte.create({
      data: { idModelo, descripcion: 'Escudo del modelo', idTipoArte, precio: 30 },
    });
    const receta = await agregarRenglonReceta(
      sesion(),
      ordenA,
      { tipo: 'arte', descripcion: 'Parche solo de esta orden', idTipoArte, precio: 5 },
      bd(),
    );

    const aMano = receta.artes.find((a) => a.descripcion === 'Parche solo de esta orden');
    expect(aMano?.idModeloArte).toBeNull();
    expect(aMano?.enElModelo).toBe(false);
    expect(aMano?.precioModelo).toBeNull();

    // Y el arte del MODELO, que esta orden no lleva, se reporta como agregado por el modelo.
    expect(
      receta.desalineacion.cambios.some(
        (c) => c.tipo === 'arte' && c.material === 'Escudo del modelo' && c.que === 'agregado',
      ),
    ).toBe(true);
    expect(delModelo.id).toBeGreaterThan(0);
  });

  it('agregar por una traza que NO es del modelo de la orden → ErrorNoEncontrado', async () => {
    const otro = await cliente.modelo.create({ data: { codigo: 'AJENO' } });
    const ajeno = await cliente.modeloArte.create({
      data: { idModelo: otro.id, descripcion: 'De otro modelo', idTipoArte },
    });
    await expect(
      agregarRenglonReceta(sesion(), ordenA, { tipo: 'arte', idModeloArte: ajeno.id }, bd()),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });

  it('⭐ restaurar un ARTE trae los datos de SU arte del modelo, no los de otro', async () => {
    // Restaurar SOBRESCRIBE el renglón congelado: si resolviera el arte del modelo por algo que no
    // sea su TRAZA —p. ej. "el primero del modelo"— escribiría encima de la historia de la orden
    // los datos de OTRO arte (descripción, precio, proveedor y tipo). Eso es destruir historia sin
    // decirlo (D3), y el usuario creería que "restauró" cuando en realidad re-tipificó.
    const bordador = await cliente.proveedor.create({ data: { nombre: 'Bordados SA' } });
    const idTipoEstampado = await crearTipoArtePrueba(cliente, 'estampado', {
      nombre: 'Estampado',
    });
    // DOS artes en el modelo. El de la orden es el SEGUNDO: si la resolución tomara el primero,
    // la restauración lo pisaría con «Logo del primero».
    await cliente.modeloArte.create({
      data: { idModelo, descripcion: 'Logo del primero', posicion: 'frente', idTipoArte, orden: 0 },
    });
    const suyo = await cliente.modeloArte.create({
      data: {
        idModelo,
        descripcion: 'Escudo de la espalda',
        posicion: 'espalda',
        idTipoArte: idTipoEstampado,
        puntadas: 4200,
        precio: 30,
        idProveedor: bordador.id,
        orden: 1,
      },
    });

    // La orden congela SOLO el segundo y alguien lo AJUSTA a mano.
    const rAlta = await agregarRenglonReceta(
      sesion(),
      ordenA,
      { tipo: 'arte', idModeloArte: suyo.id },
      bd(),
    );
    const congelado = rAlta.artes.find((a) => a.idModeloArte === suyo.id);
    expect(congelado).toBeDefined();
    await editarRenglonReceta(
      sesion(),
      ordenA,
      'arte',
      congelado?.id ?? 0,
      { descripcion: 'Escudo ajustado a mano', precio: 5, idProveedor: null },
      bd(),
    );

    const r = await restaurarRenglonReceta(sesion(), ordenA, 'arte', congelado?.id ?? 0, bd());

    const restaurado = r.artes.find((a) => a.id === congelado?.id);
    expect(restaurado).toMatchObject({
      idModeloArte: suyo.id,
      descripcion: 'Escudo de la espalda',
      posicion: 'espalda',
      idTipoArte: idTipoEstampado,
      puntadas: 4200,
      precio: 30,
      idProveedor: bordador.id,
      agregadoAMano: false,
      enElModelo: true,
    });
    // Y NADA del otro arte del modelo se coló en el renglón.
    expect(restaurado?.descripcion).not.toBe('Logo del primero');

    // D3: el `antes` ÍNTEGRO queda en la bitácora (lo que la restauración sobrescribió).
    const bitacora = await cliente.bitacora.findFirstOrThrow({
      where: { entidad: 'RecetaOrden', idEntidad: String(ordenA), accion: 'MODIFICAR' },
      orderBy: { id: 'desc' },
    });
    expect(bitacora.datos).toMatchObject({
      tipo: 'arte',
      restaurado: true,
      antes: { descripcion: 'Escudo ajustado a mano', precio: 5 },
    });
  });

  it('restaurar un ARTE que ya no está en el modelo (o agregado a mano) se rechaza', async () => {
    // Un renglón AGREGADO A MANO nunca tuvo traza: no hay a qué volver.
    const rMano = await agregarRenglonReceta(
      sesion(),
      ordenA,
      { tipo: 'arte', descripcion: 'Parche de esta orden', idTipoArte },
      bd(),
    );
    const aMano = rMano.artes.find((a) => a.descripcion === 'Parche de esta orden');
    await expect(
      restaurarRenglonReceta(sesion(), ordenA, 'arte', aMano?.id ?? 0, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    // Y uno cuyo arte del modelo se BORRÓ (la traza cayó a NULL por SetNull) tampoco.
    const arte = await cliente.modeloArte.create({
      data: { idModelo, descripcion: 'Se va a borrar', idTipoArte },
    });
    const rTraza = await agregarRenglonReceta(
      sesion(),
      ordenA,
      { tipo: 'arte', idModeloArte: arte.id },
      bd(),
    );
    const conTraza = rTraza.artes.find((a) => a.idModeloArte === arte.id);
    await cliente.modeloArte.delete({ where: { id: arte.id } });
    await expect(
      restaurarRenglonReceta(sesion(), ordenA, 'arte', conTraza?.id ?? 0, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
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

describe('⭐ La firma se re-cierra al cambiar el contenido — AHORA POR RENGLÓN (V1-E3h)', () => {
  /** Deja la receta de A liberada ENTERA (el punto de partida de estos casos). */
  async function liberarA(): Promise<void> {
    await marcarRecetaRevisada(sesion(), ordenA, bd());
    await liberarReceta(sesion(), ordenA, {}, bd());
  }

  it('AGREGAR material a una receta ya liberada mete un renglón SIN FIRMAR (y no la cierra entera)', async () => {
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

    // Lo NUEVO no está firmado, así que la receta deja de estar completa…
    expect(r.todoLiberado).toBe(false);
    expect(r.liberadaEn).toBeNull();
    expect(r.avios.find((a) => a.idAvio === otro.id)?.liberadoEn).toBeNull();
    // …pero lo que YA estaba firmado se sigue comprando (§Post-F9.72: se compra lo liberado).
    expect(r.puedeComprar).toBe(true);
    expect(r.resumen.porLiberar).toBe(1);
    const explosion = await explosionarOrden(sesion(), ordenA, bd());
    expect(explosion.grupos.flatMap((g) => g.renglones)).toHaveLength(3);
    expect(explosion.pendientesLiberar).toHaveLength(1);
    expect(explosion.pendientesLiberar[0]).toMatchObject({ material: 'NEW-1 — Etiqueta' });
  });

  it('⭐ EDITAR re-cierra SOLO el renglón tocado; los demás conservan su firma', async () => {
    await liberarA();
    const r0 = await obtenerRecetaOrden(sesion(), ordenA, bd());
    const boton = r0.avios.find((a) => a.idAvio === avioBoton.id)!;

    const r = await editarRenglonReceta(
      sesion(),
      ordenA,
      'avio',
      boton.id,
      { consumoPorPrenda: 7 },
      bd(),
    );

    expect(r.avios.find((a) => a.id === boton.id)?.liberadoEn).toBeNull();
    expect(r.avios.find((a) => a.idAvio === avioJareta.id)?.liberadoEn).not.toBeNull();
    expect(r.telas[0]?.liberadoEn).not.toBeNull();
    expect(r.todoLiberado).toBe(false);
    expect(r.puedeComprar).toBe(true);
  });

  it('RESTAURAR también re-cierra su renglón (pisa consumo, precio y amarre)', async () => {
    await liberarA();
    const r0 = await obtenerRecetaOrden(sesion(), ordenA, bd());
    const boton = r0.avios.find((a) => a.idAvio === avioBoton.id)!;

    const r = await restaurarRenglonReceta(sesion(), ordenA, 'avio', boton.id, bd());

    expect(r.avios.find((a) => a.id === boton.id)?.liberadoEn).toBeNull();
    expect(r.telas[0]?.liberadoEn).not.toBeNull();
  });

  it('⚠️ QUITAR NO revoca ninguna firma: excluir le quita algo a la compra, no le agrega nada', async () => {
    await liberarA();
    const r0 = await obtenerRecetaOrden(sesion(), ordenA, bd());
    const boton = r0.avios.find((a) => a.idAvio === avioBoton.id)!;

    const r = await quitarRenglonReceta(sesion(), ordenA, 'avio', boton.id, {}, bd());

    // La lápida ya no cuenta, y lo que queda vivo sigue firmado → la receta sigue COMPLETA.
    expect(r.todoLiberado).toBe(true);
    expect(r.resumen.porLiberar).toBe(0);
  });

  it('⭐ excluir el ÚNICO renglón pendiente deja la receta COMPLETA (la bandera es derivada)', async () => {
    await liberarA();
    const otro = await cliente.avio.create({
      data: { clave: 'NEW-2', descripcion: 'Etiqueta 2', unidad: 'pza' },
    });
    const conNuevo = await agregarRenglonReceta(
      sesion(),
      ordenA,
      { tipo: 'avio', idAvio: otro.id, consumoPorPrenda: 1 },
      bd(),
    );
    expect(conNuevo.todoLiberado).toBe(false);
    const nuevo = conNuevo.avios.find((a) => a.idAvio === otro.id)!;

    const r = await quitarRenglonReceta(sesion(), ordenA, 'avio', nuevo.id, {}, bd());

    expect(r.todoLiberado).toBe(true);
  });

  it('REVIVIR una lápida la trae SIN FIRMA (aunque la tuviera del backfill)', async () => {
    await liberarA();
    const r0 = await obtenerRecetaOrden(sesion(), ordenA, bd());
    const jareta = r0.avios.find((a) => a.idAvio === avioJareta.id)!;
    await quitarRenglonReceta(sesion(), ordenA, 'avio', jareta.id, {}, bd());

    const r = await agregarRenglonReceta(
      sesion(),
      ordenA,
      { tipo: 'avio', idAvio: avioJareta.id, consumoPorPrenda: 1 },
      bd(),
    );

    const revivida = r.avios.find((a) => a.idAvio === avioJareta.id)!;
    expect(revivida.excluido).toBe(false);
    expect(revivida.liberadoEn).toBeNull();
  });

  it('«marcar todo revisado» NO re-cierra nada (no cambia QUÉ se compra)', async () => {
    await liberarA();
    const r = await marcarRecetaRevisada(sesion(), ordenA, bd());
    expect(r.todoLiberado).toBe(true);
  });

  it('el re-cierre queda en la bitácora, con su motivo y el renglón (A7)', async () => {
    await liberarA();
    await editarRenglonReceta(
      sesion(),
      ordenA,
      'avio',
      (await obtenerRecetaOrden(sesion(), ordenA, bd())).avios[0]!.id,
      { precio: 3 },
      bd(),
    );
    const rastro = await cliente.bitacora.findMany({
      where: { entidad: 'RecetaOrden', idEntidad: String(ordenA), accion: 'MODIFICAR' },
      orderBy: { id: 'desc' },
      take: 5,
    });
    expect(
      rastro.some((b) => (b.datos as { accion?: string }).accion === 'liberacion-renglon-revocada'),
    ).toBe(true);
  });
});

describe('⭐ V1-E3h — LIBERAR POR PARTES (§Post-F9.72)', () => {
  beforeEach(async () => {
    // Todas estas pruebas parten de una receta revisada pero SIN FIRMAR.
    await marcarRecetaRevisada(sesion(), ordenA, bd());
  });

  it('⭐ EL CASO DE DANIEL: se liberan las telas, se compra la tela, y el avío sigue pendiente', async () => {
    const r = await liberarReceta(sesion(), ordenA, { alcance: 'telas' }, bd());

    expect(r.puedeComprar).toBe(true);
    expect(r.todoLiberado).toBe(false);
    expect(r.resumen).toMatchObject({ liberados: 1, porLiberar: 2 });

    // La explosión trae SOLO la tela, y DICE qué quedó fuera (con nombre y cantidad).
    const explosion = await explosionarOrden(sesion(), ordenA, bd());
    const renglones = explosion.grupos.flatMap((g) => g.renglones);
    expect(renglones).toHaveLength(1);
    expect(renglones[0]).toMatchObject({ tipo: 'tela' });
    expect(explosion.pendientesLiberar.map((p) => p.material).sort()).toEqual([
      'BOT-01 — Botón',
      'JAR-01 — Jareta',
    ]);
  });

  it('liberar POR SECCIÓN: avíos deja las telas fuera', async () => {
    const r = await liberarReceta(sesion(), ordenA, { alcance: 'avios' }, bd());
    expect(r.avios.every((a) => a.liberadoEn !== null)).toBe(true);
    expect(r.telas.every((t) => t.liberadoEn === null)).toBe(true);
  });

  it('liberar una SELECCIÓN firma exactamente esos renglones', async () => {
    const r0 = await obtenerRecetaOrden(sesion(), ordenA, bd());
    const boton = r0.avios.find((a) => a.idAvio === avioBoton.id)!;

    const r = await liberarReceta(
      sesion(),
      ordenA,
      { alcance: 'seleccion', renglones: [{ tipo: 'avio', id: boton.id }] },
      bd(),
    );

    expect(r.avios.find((a) => a.id === boton.id)?.liberadoEn).not.toBeNull();
    expect(r.avios.find((a) => a.idAvio === avioJareta.id)?.liberadoEn).toBeNull();
    expect(r.resumen).toMatchObject({ liberados: 1, porLiberar: 2 });
  });

  it('una SELECCIÓN vacía se rechaza (liberar "nada" no es liberar)', async () => {
    await expect(
      liberarReceta(sesion(), ordenA, { alcance: 'seleccion', renglones: [] }, bd()),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('⭐ B2 — `revisarPendientes` firma una receta que nadie ha revisado (el caso de la BANDEJA)', async () => {
    // Se deshace el `marcarRecetaRevisada` del beforeEach: así queda EXACTAMENTE una orden recién
    // creada (la receta se copió del modelo y sus renglones nacen `sin_revisar`), que es el 100 %
    // de lo que puebla la bandeja.
    await cliente.ordenTela.updateMany({
      where: { idOrden: ordenA },
      data: { estado: 'sin_revisar' },
    });
    await cliente.ordenAvio.updateMany({
      where: { idOrden: ordenA },
      data: { estado: 'sin_revisar' },
    });

    // Sin la bandera rebota, que es el defecto que reportó el reviewer.
    await expect(liberarReceta(sesion(), ordenA, { alcance: 'todo' }, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );

    const r = await liberarReceta(
      sesion(),
      ordenA,
      { alcance: 'todo', revisarPendientes: true },
      bd(),
    );

    expect(r.todoLiberado).toBe(true);
    expect(r.resumen).toMatchObject({ sinRevisar: 0, porLiberar: 0 });
    // Y se puede comprar de verdad, sin dar la vuelta por el Centro de Órdenes.
    await expect(explosionarOrden(sesion(), ordenA, bd())).resolves.toMatchObject({
      pendientesLiberar: [],
    });
  });

  it('`revisarPendientes` NO pisa los AJUSTADOS (su marca es la que impide que el modelo los pise)', async () => {
    const r0 = await obtenerRecetaOrden(sesion(), ordenA, bd());
    const boton = r0.avios.find((a) => a.idAvio === avioBoton.id)!;
    await editarRenglonReceta(sesion(), ordenA, 'avio', boton.id, { consumoPorPrenda: 9 }, bd());

    const r = await liberarReceta(
      sesion(),
      ordenA,
      { alcance: 'todo', revisarPendientes: true },
      bd(),
    );

    expect(r.avios.find((a) => a.id === boton.id)?.estado).toBe('ajustado');
    expect(r.todoLiberado).toBe(true);
  });

  it('`revisarPendientes` respeta el ALCANCE: no marca lo de otra sección', async () => {
    await cliente.ordenTela.updateMany({
      where: { idOrden: ordenA },
      data: { estado: 'sin_revisar' },
    });
    await cliente.ordenAvio.updateMany({
      where: { idOrden: ordenA },
      data: { estado: 'sin_revisar' },
    });

    await liberarReceta(sesion(), ordenA, { alcance: 'avios', revisarPendientes: true }, bd());

    const r = await obtenerRecetaOrden(sesion(), ordenA, bd());
    expect(r.avios.every((a) => a.estado === 'revisado' && a.liberadoEn !== null)).toBe(true);
    // La tela sigue SIN revisar y SIN firmar: el alcance era «avíos».
    expect(r.telas[0]?.estado).toBe('sin_revisar');
    expect(r.telas[0]?.liberadoEn).toBeNull();
  });

  it('⭐ H7 — un id de LÁPIDA en la selección se explica por su causa, no como "no encontrado"', async () => {
    const r0 = await obtenerRecetaOrden(sesion(), ordenA, bd());
    const jareta = r0.avios.find((a) => a.idAvio === avioJareta.id)!;
    await quitarRenglonReceta(sesion(), ordenA, 'avio', jareta.id, {}, bd());

    const error = await liberarReceta(
      sesion(),
      ordenA,
      { alcance: 'seleccion', renglones: [{ tipo: 'avio', id: jareta.id }] },
      bd(),
    ).catch((e: unknown) => e);

    // El renglón EXISTE: lo que pasa es que esta orden decidió que no lo lleva.
    expect(error).toBeInstanceOf(ErrorConflicto);
    expect((error as ErrorConflicto).message).toContain('JAR-01');
    expect((error as ErrorConflicto).message).toContain('QUITADO');
  });

  it('un renglón de OTRA orden en la selección es 404, no un silencio (D3)', async () => {
    const rB = await obtenerRecetaOrden(sesion(), ordenB, bd());
    await expect(
      liberarReceta(
        sesion(),
        ordenA,
        { alcance: 'seleccion', renglones: [{ tipo: 'avio', id: rB.avios[0]!.id }] },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });

  it('una sección VACÍA se rechaza diciendo que ahí no hay nada', async () => {
    // El modelo de estas pruebas no lleva arte: la sección existe pero está vacía.
    await expect(
      liberarReceta(sesion(), ordenA, { alcance: 'artes' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('⭐ un renglón SIN REVISAR de OTRA sección no estorba a la firma de la mía', async () => {
    // Se agrega un avío nuevo (queda `ajustado`, no `sin_revisar`) y se deja una tela sin revisar
    // a mano: firmar los AVÍOS no debe pedir cuentas de la tela.
    await cliente.ordenTela.updateMany({
      where: { idOrden: ordenA },
      data: { estado: 'sin_revisar' },
    });
    const r = await liberarReceta(sesion(), ordenA, { alcance: 'avios' }, bd());
    expect(r.avios.every((a) => a.liberadoEn !== null)).toBe(true);
    // Y la tela sin revisar sigue frenando SU propia firma.
    await expect(
      liberarReceta(sesion(), ordenA, { alcance: 'telas' }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('firmar todo lo que faltaba deja la receta COMPLETA, con fecha y autor', async () => {
    await liberarReceta(sesion(), ordenA, { alcance: 'telas' }, bd());
    const r = await liberarReceta(sesion(), ordenA, { alcance: 'todo' }, bd());
    expect(r.todoLiberado).toBe(true);
    expect(r.liberadaEn).not.toBeNull();
    expect(r.liberadaPor).not.toBeNull();
  });

  it('la LÁPIDA queda fuera del alcance: firmar no la toca', async () => {
    const r0 = await obtenerRecetaOrden(sesion(), ordenA, bd());
    const jareta = r0.avios.find((a) => a.idAvio === avioJareta.id)!;
    await quitarRenglonReceta(sesion(), ordenA, 'avio', jareta.id, {}, bd());

    const r = await liberarReceta(sesion(), ordenA, { alcance: 'todo' }, bd());

    expect(r.avios.find((a) => a.id === jareta.id)?.liberadoEn).toBeNull();
    expect(r.todoLiberado).toBe(true);
  });

  it('⭐ la OC A MANO se frena por MATERIAL: la tela sin firmar no se compra aunque el avío sí esté', async () => {
    await liberarReceta(sesion(), ordenA, { alcance: 'avios' }, bd());
    // `cuerpoOc` compra JERSEY, que sigue sin firma.
    await expect(
      crearOC(sesionOc(), await cuerpoOc('Telas del Este', ordenA), bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    await liberarReceta(sesion(), ordenA, { alcance: 'telas' }, bd());
    const oc = await crearOC(sesionOc(), await cuerpoOc('Telas del Oeste', ordenA), bd());
    expect(oc.id).toBeGreaterThan(0);
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
    await liberarReceta(sesion(), ordenA, {}, bd());

    const oc = await crearOC(sesionOc(), await cuerpoOc('Telas del Sur', ordenA), bd());
    expect(oc.id).toBeGreaterThan(0);
  });

  it('una OC LIBRE (sin orden ligada) no pasa por la puerta: se puede capturar siempre', async () => {
    const oc = await crearOC(sesionOc(), await cuerpoOc('Telas Libres'), bd());
    expect(oc.id).toBeGreaterThan(0);
  });
});

describe('⭐ D3 — lo que una mutación PISA queda escrito íntegro (hallazgo del reviewer)', () => {
  /** Última bitácora de la receta de A (la más reciente). */
  async function ultimaBitacora(): Promise<Record<string, unknown>> {
    const fila = await cliente.bitacora.findFirstOrThrow({
      where: { entidad: 'RecetaOrden', idEntidad: String(ordenA) },
      orderBy: { id: 'desc' },
    });
    return fila.datos as Record<string, unknown>;
  }

  it('RESTAURAR deja el precio congelado y el amarre en la bitácora antes de pisarlos', async () => {
    const amarre = await cliente.telaProveedor.create({
      data: {
        idTela: telaJersey.id,
        idProveedor: (await cliente.proveedor.create({ data: { nombre: 'Alsatex' } })).id,
        precio: 50,
      },
    });
    const r0 = await obtenerRecetaOrden(sesion(), ordenA, bd());
    const jersey = r0.telas.find((t) => t.idTela === telaJersey.id)!;
    // Desarrollo negocia: precio 9.99, consumo 4, amarrado a Alsatex, fuera del costo.
    await editarRenglonReceta(
      sesion(),
      ordenA,
      'tela',
      jersey.id,
      { precio: 9.99, consumoPorPrenda: 4, paraCosto: false, idTelaProveedor: amarre.id },
      bd(),
    );

    await restaurarRenglonReceta(sesion(), ordenA, 'tela', jersey.id, bd());

    const datos = await ultimaBitacora();
    expect(datos.restaurado).toBe(true);
    // ⭐ Lo que desapareció está ÍNTEGRO (no un resumen ni un conteo).
    expect(datos.antes).toMatchObject({
      idTela: telaJersey.id,
      precio: 9.99,
      consumoPorPrenda: 4,
      paraCosto: false,
      idTelaProveedor: amarre.id,
      estado: 'ajustado',
    });
  });

  it('RESTAURAR un avío deja sus MEDIDAS POR TALLA viejas escritas (se borran en bloque)', async () => {
    const r0 = await obtenerRecetaOrden(sesion(), ordenA, bd());
    const boton = r0.avios.find((a) => a.idAvio === avioBoton.id)!;
    await editarRenglonReceta(
      sesion(),
      ordenA,
      'avio',
      boton.id,
      { precio: 7.5, tallas: [{ idTalla: tallaCH.id, consumo: 0.7 }] },
      bd(),
    );

    await restaurarRenglonReceta(sesion(), ordenA, 'avio', boton.id, bd());

    const datos = await ultimaBitacora();
    const antes = datos.antes as Record<string, unknown>;
    expect(antes.precio).toBe(7.5);
    expect(antes.tallas).toEqual([{ idTalla: tallaCH.id, consumo: 0.7, idAvioMedida: null }]);
  });

  it('EDITAR guarda la foto ÍNTEGRA del antes, no dos campos', async () => {
    const r0 = await obtenerRecetaOrden(sesion(), ordenA, bd());
    const boton = r0.avios.find((a) => a.idAvio === avioBoton.id)!;
    await editarRenglonReceta(
      sesion(),
      ordenA,
      'avio',
      boton.id,
      { tallas: [{ idTalla: tallaCH.id, consumo: 0.9 }] },
      bd(),
    );
    // Segunda edición: el `antes` tiene que traer la medida 0.9 que esta edición borra.
    await editarRenglonReceta(
      sesion(),
      ordenA,
      'avio',
      boton.id,
      { tallas: [{ idTalla: tallaCH.id, consumo: 0.3 }], paraProduccion: false },
      bd(),
    );

    const antes = (await ultimaBitacora()).antes as Record<string, unknown>;
    expect(antes.tallas).toEqual([{ idTalla: tallaCH.id, consumo: 0.9, idAvioMedida: null }]);
    expect(antes.paraProduccion).toBe(true);
    expect(antes).toHaveProperty('idAvioProveedor');
    expect(antes).toHaveProperty('estado');
  });

  it('editar una LÁPIDA no revoca la firma de Desarrollo (no cambia qué se compra)', async () => {
    const r0 = await obtenerRecetaOrden(sesion(), ordenA, bd());
    const jareta = r0.avios.find((a) => a.idAvio === avioJareta.id)!;
    await quitarRenglonReceta(
      sesion(),
      ordenA,
      'avio',
      jareta.id,
      { motivo: 'este pedido va sin jareta' },
      bd(),
    );
    await marcarRecetaRevisada(sesion(), ordenA, bd());
    await liberarReceta(sesion(), ordenA, {}, bd());

    const r1 = await editarRenglonReceta(
      sesion(),
      ordenA,
      'avio',
      jareta.id,
      { notas: 'nota sobre el renglón muerto' },
      bd(),
    );
    expect(r1.liberadaEn).not.toBeNull();
  });
});

describe('⭐ La MATRIZ de medidas por talla la arma el SERVIDOR desde el universo de la ORDEN', () => {
  it('una fila por talla de la orden (en orden), `null` en lo no capturado, y la talla ajena no se pierde', async () => {
    // La orden produce CH/M/G. El modelo trae medida para CH y para XL — una talla que esta orden
    // NO lleva. (Extiende a la OP lo de V1-E3c: la matriz nace del universo, no de las filas.)
    const tallaM = await cliente.talla.create({ data: { etiqueta: 'M', orden: 2 } });
    const tallaG = await cliente.talla.create({ data: { etiqueta: 'G', orden: 3 } });
    const tallaXL = await cliente.talla.create({ data: { etiqueta: 'XL', orden: 4 } });
    const cierre = await cliente.avio.create({
      data: { clave: 'CIE-09', descripcion: 'Cierre', unidad: 'pza' },
    });
    await cliente.modeloAvio.create({
      data: { idModelo, idAvio: cierre.id, consumoPorPrenda: 1, consumoPorTalla: true },
    });
    await cliente.modeloAvioTalla.createMany({
      data: [
        { idModelo, idAvio: cierre.id, idTalla: tallaCH.id, consumo: 0.5 },
        { idModelo, idAvio: cierre.id, idTalla: tallaXL.id, consumo: 0.9 },
      ],
    });

    // Orden nueva con matriz CH/M/G (el universo de tallas de ESTA orden).
    const orden = await cliente.orden.create({
      data: {
        folio: 77n,
        idEmpresa: empresa.id,
        idModelo,
        idCliente,
        lineas: {
          create: [
            {
              idColor: colorRojo.id,
              tallas: {
                create: [
                  { idTalla: tallaCH.id, cantidad: 10 },
                  { idTalla: tallaM.id, cantidad: 10 },
                  { idTalla: tallaG.id, cantidad: 10 },
                ],
              },
            },
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

    const receta = await obtenerRecetaOrden(sesion(), orden.id, bd());
    const avio = receta.avios.find((a) => a.idAvio === cierre.id)!;
    expect(avio.tieneTallas).toBe(true);

    // ⭐ Una fila por talla de la ORDEN, en el orden del catálogo, y la ajena AL FINAL.
    expect(avio.tallas.map((t) => t.etiqueta)).toEqual(['CH', 'M', 'G', 'XL']);
    expect(avio.tallas.map((t) => t.enLaOrden)).toEqual([true, true, true, false]);
    // CH capturada; M y G existen pero SIN capturar → `null`, que NO es 0 (un 0 sería un cero
    // puesto a propósito y el MRP lo respetaría).
    expect(avio.tallas.map((t) => t.consumo)).toEqual([0.5, null, null, 0.9]);
    for (const t of avio.tallas) {
      expect(t.consumo).not.toBe(0);
    }
  });

  it('sin matriz capturada, la orden lo DICE (`tieneTallas: false`) en vez de fingir filas', async () => {
    const orden = await cliente.orden.create({
      data: { folio: 78n, idEmpresa: empresa.id, idModelo, idCliente },
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
    const receta = await obtenerRecetaOrden(sesion(), orden.id, bd());
    const avio = receta.avios.find((a) => a.idAvio === avioBoton.id)!;
    expect(avio.tieneTallas).toBe(false);
    expect(avio.tallas).toEqual([]);
  });
});

describe('⭐ El QUINTO consumidor: el impreso de la OP lee la receta de la ORDEN', () => {
  it('la jareta EXCLUIDA no sale en el papel, y el renglón sin `paraProduccion` tampoco', async () => {
    const r0 = await obtenerRecetaOrden(sesion(), ordenA, bd());
    const jareta = r0.avios.find((a) => a.idAvio === avioJareta.id)!;
    const jersey = r0.telas.find((t) => t.idTela === telaJersey.id)!;
    await quitarRenglonReceta(sesion(), ordenA, 'avio', jareta.id, { motivo: 'sin jareta' }, bd());
    await editarRenglonReceta(sesion(), ordenA, 'tela', jersey.id, { paraProduccion: false }, bd());

    const receta = await enTransaccion((tx) => leerRecetaParaImpreso(tx, ordenA), bd());
    expect(receta.avios.map((a) => a.clave)).toEqual(['BOT-01']);
    expect(receta.telas).toEqual([]);

    // Y la orden HERMANA, que no se tocó, sigue llevando las dos cosas en su papel.
    const hermana = await enTransaccion((tx) => leerRecetaParaImpreso(tx, ordenB), bd());
    expect(hermana.avios.map((a) => a.clave).sort()).toEqual(['BOT-01', 'JAR-01']);
    expect(hermana.telas.map((t) => t.nombre)).toEqual(['Jersey']);
  });
});

describe('⭐ Traer al pedido un insumo que el MODELO agregó (hallazgo del reviewer)', () => {
  it('nace con el amarre, las medidas por talla y las banderas del modelo, y NO se marca "a mano"', async () => {
    // El modelo agrega un avío DESPUÉS de que las órdenes congelaron su receta, con todo lo suyo.
    const cierre = await cliente.avio.create({
      data: { clave: 'CIE-01', descripcion: 'Cierre', unidad: 'pza', precioReferencia: 12 },
    });
    const proveedor = await cliente.proveedor.create({ data: { nombre: 'Avíos del Centro' } });
    // OJO: `idAvioProveedor` guarda el **idProveedor** del par `(idAvio, idAvioProveedor)`.
    await cliente.avioProveedor.create({
      data: { idAvio: cierre.id, idProveedor: proveedor.id, precio: 12 },
    });
    await cliente.modeloAvio.create({
      data: {
        idModelo,
        idAvio: cierre.id,
        consumoPorPrenda: 1,
        consumoPorTalla: true,
        paraCosto: false,
        idAvioProveedor: proveedor.id,
      },
    });
    await cliente.modeloAvioTalla.create({
      data: { idModelo, idAvio: cierre.id, idTalla: tallaCH.id, consumo: 0.55 },
    });

    // El aviso lo dice; la acción es "Agregar" con el mismo material.
    const antes = await obtenerRecetaOrden(sesion(), ordenA, bd());
    expect(antes.desalineacion.cambios.some((c) => c.que === 'agregado')).toBe(true);

    const r = await agregarRenglonReceta(
      sesion(),
      ordenA,
      { tipo: 'avio', idAvio: cierre.id, consumoPorPrenda: 1 },
      bd(),
    );
    const nuevo = r.avios.find((a) => a.idAvio === cierre.id)!;
    expect(nuevo).toMatchObject({
      agregadoAMano: false, // ← viene del modelo: su desviación se sigue vigilando
      paraCosto: false,
      consumoPorTalla: true,
      proveedorAmarrado: 'Avíos del Centro',
    });
    expect(nuevo.tallas).toEqual([expect.objectContaining({ idTalla: tallaCH.id, consumo: 0.55 })]);
    // Y el aviso de "el modelo lleva algo que esta orden no tiene" se apaga.
    expect(r.desalineacion.cambios.some((c) => c.que === 'agregado')).toBe(false);
  });

  it('un material que NO está en el modelo sí se marca "a mano" (y por eso no avisa)', async () => {
    const extra = await cliente.tela.create({ data: { nombre: 'Rib', precioSugerido: 30 } });
    const r = await agregarRenglonReceta(
      sesion(),
      ordenA,
      { tipo: 'tela', idTela: extra.id, consumoPorPrenda: 0.2 },
      bd(),
    );
    expect(r.telas.find((t) => t.idTela === extra.id)).toMatchObject({ agregadoAMano: true });
    expect(r.desalineacion.hayCambios).toBe(false);
  });
});

describe('⭐ La puerta también cubre AGREGAR LÍNEAS a una OC ya hecha (2º hallazgo del reviewer)', () => {
  /** Deja la receta liberada, crea una OC ligada, y luego REVOCA la firma tocando la receta. */
  async function ocLigadaYFirmaRevocada(): Promise<number> {
    await marcarRecetaRevisada(sesion(), ordenA, bd());
    await liberarReceta(sesion(), ordenA, {}, bd());
    const oc = await crearOC(sesionOc(), await cuerpoOc('Proveedor A', ordenA), bd());

    // Desarrollo toca el contenido → la firma se revoca (regla de la ronda anterior).
    const r = await obtenerRecetaOrden(sesion(), ordenA, bd());
    const jersey = r.telas.find((t) => t.idTela === telaJersey.id)!;
    await editarRenglonReceta(sesion(), ordenA, 'tela', jersey.id, { consumoPorPrenda: 3 }, bd());
    const revocada = await obtenerRecetaOrden(sesion(), ordenA, bd());
    expect(revocada.liberadaEn).toBeNull();
    return oc.id;
  }

  it('con la firma REVOCADA, meterle una LÍNEA NUEVA a la OC ligada se rechaza', async () => {
    const idOc = await ocLigadaYFirmaRevocada();
    const otraTela = await cliente.tela.create({ data: { nombre: 'Rib', precioSugerido: 30 } });
    const proveedor = await cliente.proveedor.findFirstOrThrow();
    const direccion = await cliente.direccionEntrega.findFirstOrThrow();

    // El escenario exacto del reviewer: 5,000 kg de otra tela contra la misma orden.
    await expect(
      actualizarOC(
        sesionOc(),
        idOc,
        {
          idProveedor: proveedor.id,
          idDireccionEntrega: direccion.id,
          lineas: [
            { idTela: telaJersey.id, cantidad: 10, precio: 50, unidad: 'kg', idOrden: ordenA },
            { idTela: otraTela.id, cantidad: 5000, precio: 30, unidad: 'kg', idOrden: ordenA },
          ],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('…y una LÍNEA DE MÁS del mismo material tampoco pasa (el conteo también cuenta)', async () => {
    const idOc = await ocLigadaYFirmaRevocada();
    const proveedor = await cliente.proveedor.findFirstOrThrow();
    const direccion = await cliente.direccionEntrega.findFirstOrThrow();
    await expect(
      actualizarOC(
        sesionOc(),
        idOc,
        {
          idProveedor: proveedor.id,
          idDireccionEntrega: direccion.id,
          lineas: [
            { idTela: telaJersey.id, cantidad: 10, precio: 50, unidad: 'kg', idOrden: ordenA },
            { idTela: telaJersey.id, cantidad: 900, precio: 50, unidad: 'kg', idOrden: ordenA },
          ],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('CORREGIR la cantidad de una línea que ya existía SÍ se permite, SIN TOPE (deliberado)', async () => {
    // La puerta es sobre QUÉ se compra, no sobre CUÁNTO: subir la cantidad de una línea que ya
    // existía se permite aunque la firma esté revocada (aquí 10 → 12; nada impide 10 → 100,000).
    // Es el reverso de haber abierto el lockout de Compras. Topar el monto sería un control de
    // COMPRAS (autorización por importe), no de esta puerta.
    const idOc = await ocLigadaYFirmaRevocada();
    const proveedor = await cliente.proveedor.findFirstOrThrow();
    const direccion = await cliente.direccionEntrega.findFirstOrThrow();
    const oc = await actualizarOC(
      sesionOc(),
      idOc,
      {
        idProveedor: proveedor.id,
        idDireccionEntrega: direccion.id,
        lineas: [
          { idTela: telaJersey.id, cantidad: 12, precio: 55, unidad: 'kg', idOrden: ordenA },
        ],
      },
      bd(),
    );
    expect(oc.lineas).toHaveLength(1);
    expect(oc.lineas[0]?.cantidad).toBe(12);
  });

  it('QUITAR una línea también se permite (quitarla no compra nada nuevo)', async () => {
    const idOc = await ocLigadaYFirmaRevocada();
    const proveedor = await cliente.proveedor.findFirstOrThrow();
    const direccion = await cliente.direccionEntrega.findFirstOrThrow();
    const oc = await actualizarOC(
      sesionOc(),
      idOc,
      { idProveedor: proveedor.id, idDireccionEntrega: direccion.id, lineas: [] },
      bd(),
    );
    expect(oc.lineas).toHaveLength(0);
  });
});

describe('⭐ El renglón traído del modelo SÍ vuelve a avisar (2º hallazgo del reviewer)', () => {
  it('copiado tal cual nace REVISADO, y si el modelo cambia después, AVISA', async () => {
    const cierre = await cliente.avio.create({
      data: { clave: 'CIE-01', descripcion: 'Cierre', unidad: 'pza', precioReferencia: 12 },
    });
    await cliente.modeloAvio.create({
      data: { idModelo, idAvio: cierre.id, consumoPorPrenda: 1 },
    });

    const r = await agregarRenglonReceta(
      sesion(),
      ordenA,
      { tipo: 'avio', idAvio: cierre.id, consumoPorPrenda: 1 },
      bd(),
    );
    const nuevo = r.avios.find((a) => a.idAvio === cierre.id)!;
    // Copia FIEL del modelo: ni "a mano" ni "ajustado" → nadie lo desvió a propósito.
    expect(nuevo).toMatchObject({ agregadoAMano: false, estado: 'revisado' });

    // El escenario del reviewer: el modelo lo mueve de 1 a 9 DESPUÉS.
    await cliente.modeloAvio.update({
      where: { idModelo_idAvio: { idModelo, idAvio: cierre.id } },
      data: { consumoPorPrenda: 9 },
    });
    const despues = await obtenerRecetaOrden(sesion(), ordenA, bd());
    expect(despues.desalineacion.hayCambios).toBe(true);
    expect(despues.desalineacion.cambios).toContainEqual(
      expect.objectContaining({ tipo: 'avio', que: 'consumo' }),
    );
    // Y la receta congelada NO se movió: sigue en 1.
    expect(despues.avios.find((a) => a.idAvio === cierre.id)?.consumoPorPrenda).toBe(1);
  });

  it('si al traerlo la persona TECLEA otro consumo, es un ajuste y se calla', async () => {
    const cierre = await cliente.avio.create({
      data: { clave: 'CIE-02', descripcion: 'Cierre corto', unidad: 'pza' },
    });
    await cliente.modeloAvio.create({
      data: { idModelo, idAvio: cierre.id, consumoPorPrenda: 1 },
    });
    const r = await agregarRenglonReceta(
      sesion(),
      ordenA,
      { tipo: 'avio', idAvio: cierre.id, consumoPorPrenda: 4 },
      bd(),
    );
    expect(r.avios.find((a) => a.idAvio === cierre.id)).toMatchObject({
      agregadoAMano: false,
      estado: 'ajustado',
    });
    expect(r.desalineacion.hayCambios).toBe(false);
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
      await liberarReceta(sesion(), id, {}, bd());
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
    await liberarReceta(sesion(), ordenA, {}, bd());

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

/**
 * ⭐ V1-E3g (§Post-F9.66) — **medida vs. consumo en la receta de la ORDEN.** El renglón publica su
 * `modoCaptura` (derivado de si el avío tiene medidas activas) y el toggle `consumoPorTalla` no
 * puede quedar encendido en un avío "por medida": si quedara, unas cantidades por talla que la
 * pantalla ya no muestra seguirían moviendo el requerido en la sombra.
 */
describe('modo de captura por talla en la receta de la orden (V1-E3g)', () => {
  /** Le pone al botón un catálogo de medidas → pasa a modo `medida`. */
  async function botonPorMedida(): Promise<number> {
    await cliente.avio.update({ where: { id: avioBoton.id }, data: { unidadMedida: 'cm' } });
    const m = await cliente.avioMedida.create({
      data: { idAvio: avioBoton.id, medida: '53 cm', valor: 53, precio: 6 },
    });
    return m.id;
  }

  it('sin medidas en el catálogo el renglón sale en modo `consumo`', async () => {
    const r = await obtenerRecetaOrden(sesion(), ordenA, bd());
    const boton = r.avios.find((a) => a.idAvio === avioBoton.id)!;
    expect(boton.modoCaptura).toBe('consumo');
    expect(boton.unidadMedida).toBeNull();
    expect(boton.avisoCaptura).toBeNull();
  });

  it('con medidas activas sale en modo `medida` y con la unidad de la especificación', async () => {
    await botonPorMedida();
    const r = await obtenerRecetaOrden(sesion(), ordenA, bd());
    const boton = r.avios.find((a) => a.idAvio === avioBoton.id)!;
    expect(boton.modoCaptura).toBe('medida');
    expect(boton.unidadMedida).toBe('cm');
    // La unidad de CONSUMO sigue siendo la suya (pza): son dos datos distintos.
    expect(boton.unidad).toBe('pza');
  });

  it('el toggle NO se puede encender en un avío por medida (se normaliza al guardar)', async () => {
    await botonPorMedida();
    const previo = (await obtenerRecetaOrden(sesion(), ordenA, bd())).avios.find(
      (a) => a.idAvio === avioBoton.id,
    )!;
    const r = await editarRenglonReceta(
      sesion(),
      ordenA,
      'avio',
      previo.id,
      { consumoPorTalla: true },
      bd(),
    );
    expect(r.avios.find((a) => a.idAvio === avioBoton.id)?.consumoPorTalla).toBe(false);
  });

  it('en modo `medida` se captura la MEDIDA por talla sin mandar cantidad (la siembra el dominio)', async () => {
    const idMedida = await botonPorMedida();
    const previo = (await obtenerRecetaOrden(sesion(), ordenA, bd())).avios.find(
      (a) => a.idAvio === avioBoton.id,
    )!;
    const r = await editarRenglonReceta(
      sesion(),
      ordenA,
      'avio',
      previo.id,
      { tallas: [{ idTalla: tallaCH.id, idAvioMedida: idMedida }] },
      bd(),
    );
    const boton = r.avios.find((a) => a.idAvio === avioBoton.id)!;
    const ch = boton.tallas.find((t) => t.idTalla === tallaCH.id)!;
    // El consumo por prenda congelado del botón es 2: NO se inventa un cero.
    expect(ch.consumo).toBe(2);
    expect(ch.medidaAmarrada).toBe('53 cm');
  });

  it('⭐ H1: la receta NACE normalizada — el camino por el que pasa toda orden nueva', async () => {
    // El BOM del modelo trae la combinación heredada: avío por medida + toggle encendido + 2
    // cantidades por talla. Antes se copiaban tal cual y CADA orden nueva volvía a fabricar el
    // "MRP en la sombra": el requerido salía por talla en vez de por prenda.
    await botonPorMedida();
    await cliente.modeloAvio.update({
      where: { idModelo_idAvio: { idModelo, idAvio: avioBoton.id } },
      data: { consumoPorTalla: true },
    });
    const tallaG = await cliente.talla.create({ data: { etiqueta: 'G', orden: 2 } });
    await cliente.modeloAvioTalla.createMany({
      data: [
        { idModelo, idAvio: avioBoton.id, idTalla: tallaCH.id, consumo: 7 },
        { idModelo, idAvio: avioBoton.id, idTalla: tallaG.id, consumo: 9 },
      ],
    });

    const idOrdenNueva = await crearOrdenConReceta(77n);
    const r = await obtenerRecetaOrden(sesion(), idOrdenNueva, bd());
    const boton = r.avios.find((a) => a.idAvio === avioBoton.id)!;

    expect(boton.modoCaptura).toBe('medida');
    expect(boton.consumoPorTalla).toBe(false); // ⭐ nace apagado, no heredado
    expect(boton.avisoCaptura).toBeNull(); // y por lo tanto sin contradicción que avisar

    // D3: las CANTIDADES no se pierden, sólo dejan de mandar.
    const filaCh = boton.tallas.find((t) => t.idTalla === tallaCH.id);
    expect(filaCh?.consumo).toBe(7);

    // Lo que importa de verdad: el REQUERIDO sale por prenda (2 × 10 piezas), no por talla.
    const hab = await habilitacionOrden(
      sesionDePrueba({ idEmpresaActiva: empresa.id, permisos: ['ordenes.habilitacion'] }),
      idOrdenNueva,
      bd(),
    );
    expect(hab.avios.find((a) => a.idAvio === avioBoton.id)?.requerido).toBe(20);
  });

  /**
   * ⚠️ **F2 del segundo review — la otra dirección, que es la que cuesta dinero.** La prueba de H1
   * sólo miraba que el avío POR MEDIDA naciera apagado; cambiar la línea por `consumoPorTalla:
   * false` a secas —apagárselo a TODOS, incluido el elástico legítimo— dejaba las 191 pruebas en
   * verde. Un desliz de una línea ahí mata en silencio el consumo por talla de CADA elástico de
   * CADA orden nueva, y lo mata justo en el código escrito para impedirlo.
   */
  it('⭐ F2: un avío SIN medidas CONSERVA su consumo por talla al nacer la orden', async () => {
    // La jareta es de consumo (no tiene medidas en catálogo) y en el BOM va por talla: 0.75 en CH.
    await cliente.modeloAvio.update({
      where: { idModelo_idAvio: { idModelo, idAvio: avioJareta.id } },
      data: { consumoPorTalla: true },
    });
    await cliente.modeloAvioTalla.create({
      data: { idModelo, idAvio: avioJareta.id, idTalla: tallaCH.id, consumo: 0.75 },
    });
    // Y en la MISMA orden, un avío por medida: los dos caminos conviven en la misma corrida.
    await botonPorMedida();
    await cliente.modeloAvio.update({
      where: { idModelo_idAvio: { idModelo, idAvio: avioBoton.id } },
      data: { consumoPorTalla: true },
    });

    const idOrdenNueva = await crearOrdenConReceta(78n);
    const r = await obtenerRecetaOrden(sesion(), idOrdenNueva, bd());

    const jareta = r.avios.find((a) => a.idAvio === avioJareta.id)!;
    expect(jareta.modoCaptura).toBe('consumo');
    expect(jareta.consumoPorTalla).toBe(true); // ⭐ NO se le apaga: su consumo SÍ varía por talla
    expect(jareta.tallas.find((t) => t.idTalla === tallaCH.id)?.consumo).toBe(0.75);

    // El por-medida sí nace apagado: la normalización distingue, no arrasa.
    expect(r.avios.find((a) => a.idAvio === avioBoton.id)?.consumoPorTalla).toBe(false);

    // Y el requerido de la jareta sale POR TALLA (0.75 × 10 piezas), no por prenda (1 × 10).
    const hab = await habilitacionOrden(
      sesionDePrueba({ idEmpresaActiva: empresa.id, permisos: ['ordenes.habilitacion'] }),
      idOrdenNueva,
      bd(),
    );
    expect(hab.avios.find((a) => a.idAvio === avioJareta.id)?.requerido).toBe(7.5);
  });

  it('F2: sólo las medidas ACTIVAS vuelven "por medida" a un avío al nacer la orden', async () => {
    // Un avío cuyas únicas medidas están DESACTIVADAS ya no se compra por medida: su consumo por
    // talla tiene que sobrevivir. Sin el `activo: true` del lote, se le apagaría.
    await cliente.avio.update({ where: { id: avioJareta.id }, data: { unidadMedida: 'cm' } });
    await cliente.avioMedida.create({
      data: { idAvio: avioJareta.id, medida: '20 cm', valor: 20, precio: 3, activo: false },
    });
    await cliente.modeloAvio.update({
      where: { idModelo_idAvio: { idModelo, idAvio: avioJareta.id } },
      data: { consumoPorTalla: true },
    });
    await cliente.modeloAvioTalla.create({
      data: { idModelo, idAvio: avioJareta.id, idTalla: tallaCH.id, consumo: 0.75 },
    });

    const idOrdenNueva = await crearOrdenConReceta(79n);
    const jareta = (await obtenerRecetaOrden(sesion(), idOrdenNueva, bd())).avios.find(
      (a) => a.idAvio === avioJareta.id,
    )!;
    expect(jareta.modoCaptura).toBe('consumo');
    expect(jareta.consumoPorTalla).toBe(true);
  });

  it('AGREGAR un renglón por medida tampoco puede encender el toggle', async () => {
    await botonPorMedida();
    // Se quita el botón (lápida) y se vuelve a agregar pidiendo el toggle encendido.
    const previo = (await obtenerRecetaOrden(sesion(), ordenA, bd())).avios.find(
      (a) => a.idAvio === avioBoton.id,
    )!;
    await quitarRenglonReceta(sesion(), ordenA, 'avio', previo.id, { motivo: 'prueba' }, bd());
    const r = await agregarRenglonReceta(
      sesion(),
      ordenA,
      { tipo: 'avio', idAvio: avioBoton.id, consumoPorPrenda: 2, consumoPorTalla: true },
      bd(),
    );
    expect(r.avios.find((a) => a.idAvio === avioBoton.id)?.consumoPorTalla).toBe(false);
  });

  it('RESTAURAR desde el modelo no es la rendija por la que el toggle vuelve a encenderse', async () => {
    await botonPorMedida();
    // El BOM del modelo trae el toggle encendido (dato anterior a V1-E3g).
    await cliente.modeloAvio.update({
      where: { idModelo_idAvio: { idModelo, idAvio: avioBoton.id } },
      data: { consumoPorTalla: true },
    });
    const previo = (await obtenerRecetaOrden(sesion(), ordenA, bd())).avios.find(
      (a) => a.idAvio === avioBoton.id,
    )!;
    await editarRenglonReceta(sesion(), ordenA, 'avio', previo.id, { consumoPorPrenda: 9 }, bd());
    const r = await restaurarRenglonReceta(sesion(), ordenA, 'avio', previo.id, bd());
    const boton = r.avios.find((a) => a.idAvio === avioBoton.id)!;
    expect(boton.consumoPorPrenda).toBe(2); // sí se restauró del modelo
    expect(boton.consumoPorTalla).toBe(false); // pero el toggle NO revivió
  });

  it('la CONTRADICCIÓN heredada se AVISA en la lectura y se apaga al guardar (nunca en silencio)', async () => {
    // Estado de antes de V1-E3g: el renglón trae el toggle encendido y el avío es "por medida".
    const previo = (await obtenerRecetaOrden(sesion(), ordenA, bd())).avios.find(
      (a) => a.idAvio === avioBoton.id,
    )!;
    await cliente.ordenAvio.update({
      where: { id: previo.id },
      data: { consumoPorTalla: true },
    });
    const idMedida = await botonPorMedida();

    // La LECTURA avisa pero NO cambia el dato (una consulta jamás voltea el cálculo de una orden).
    const leido = await obtenerRecetaOrden(sesion(), ordenA, bd());
    const conAviso = leido.avios.find((a) => a.idAvio === avioBoton.id)!;
    expect(conAviso.consumoPorTalla).toBe(true);
    expect(conAviso.avisoCaptura).toContain('POR MEDIDA');
    expect(
      (await cliente.ordenAvio.findUniqueOrThrow({ where: { id: previo.id } })).consumoPorTalla,
    ).toBe(true);

    // Al GUARDAR la captura por talla —que sí es una acción del usuario— se normaliza.
    const r = await editarRenglonReceta(
      sesion(),
      ordenA,
      'avio',
      previo.id,
      { tallas: [{ idTalla: tallaCH.id, idAvioMedida: idMedida }] },
      bd(),
    );
    const boton = r.avios.find((a) => a.idAvio === avioBoton.id)!;
    expect(boton.consumoPorTalla).toBe(false);
    expect(boton.avisoCaptura).toBeNull();
  });
});

describe('⭐ V1-E3h — TRAER DEL MODELO lo que le falta a la receta (§Post-F9.73)', () => {
  /** Agrega un avío NUEVO al BOM del modelo (el caso: el desarrollo siguió después de la OP). */
  async function elModeloAgrega(clave: string): Promise<number> {
    const nuevo = await cliente.avio.create({
      data: { clave, descripcion: 'Etiqueta de lavado', unidad: 'pza', precioReferencia: 0.5 },
    });
    await cliente.modeloAvio.create({
      data: { idModelo, idAvio: nuevo.id, consumoPorPrenda: 1 },
    });
    return nuevo.id;
  }

  it('trae el faltante que el modelo agregó, y lo trae SIN LIBERAR', async () => {
    const idAvio = await elModeloAgrega('ETQ-01');
    const antes = await obtenerRecetaOrden(sesion(), ordenA, bd());
    expect(antes.desalineacion.cambios.some((c) => c.que === 'agregado')).toBe(true);

    const r = await traerDelModelo(sesion(), ordenA, {}, bd());

    expect(r.traidos).toEqual([{ tipo: 'avio', material: 'ETQ-01 — Etiqueta de lavado' }]);
    const traido = r.receta.avios.find((a) => a.idAvio === idAvio)!;
    expect(traido.liberadoEn).toBeNull();
    expect(traido.agregadoAMano).toBe(false);
    // Y el aviso se apaga: ya no falta.
    expect(r.receta.desalineacion.cambios.some((c) => c.que === 'agregado')).toBe(false);
  });

  it('se puede traer UN material señalado, sin arrastrar los demás', async () => {
    const idUno = await elModeloAgrega('ETQ-01');
    await elModeloAgrega('ETQ-02');

    const r = await traerDelModelo(
      sesion(),
      ordenA,
      { materiales: [{ tipo: 'avio', idAvio: idUno }] },
      bd(),
    );

    expect(r.traidos).toHaveLength(1);
    expect(r.receta.avios.some((a) => a.clave === 'ETQ-02')).toBe(false);
  });

  it('🔴 NO pisa un renglón AJUSTADO: lo respeta y AVISA del choque (nunca en silencio)', async () => {
    const r0 = await obtenerRecetaOrden(sesion(), ordenA, bd());
    const boton = r0.avios.find((a) => a.idAvio === avioBoton.id)!;
    await editarRenglonReceta(sesion(), ordenA, 'avio', boton.id, { consumoPorPrenda: 9 }, bd());

    const r = await traerDelModelo(sesion(), ordenA, {}, bd());

    expect(r.traidos).toHaveLength(0);
    const choque = r.respetados.find((c) => c.material === 'BOT-01 — Botón')!;
    expect(choque.motivo).toContain('ajuste propio');
    // El ajuste sigue intacto: el modelo propone, la orden manda (D3).
    expect(r.receta.avios.find((a) => a.id === boton.id)?.consumoPorPrenda).toBe(9);
  });

  it('🔴 NO resucita una LÁPIDA: la jareta quitada a mano se queda quitada, y lo dice', async () => {
    const r0 = await obtenerRecetaOrden(sesion(), ordenA, bd());
    const jareta = r0.avios.find((a) => a.idAvio === avioJareta.id)!;
    await quitarRenglonReceta(
      sesion(),
      ordenA,
      'avio',
      jareta.id,
      { motivo: 'la negoció fuera' },
      bd(),
    );

    const r = await traerDelModelo(sesion(), ordenA, {}, bd());

    expect(r.traidos).toHaveLength(0);
    const choque = r.respetados.find((c) => c.material === 'JAR-01 — Jareta')!;
    expect(choque.motivo).toContain('NO lo lleva');
    expect(r.receta.avios.find((a) => a.id === jareta.id)?.excluido).toBe(true);
  });

  it('lo traído entra como un pendiente más: el comprador lo ve en la explosión', async () => {
    await marcarRecetaRevisada(sesion(), ordenA, bd());
    await liberarReceta(sesion(), ordenA, {}, bd());
    await elModeloAgrega('ETQ-01');

    await traerDelModelo(sesion(), ordenA, {}, bd());
    const explosion = await explosionarOrden(sesion(), ordenA, bd());

    expect(explosion.pendientesLiberar.map((p) => p.material)).toEqual([
      'ETQ-01 — Etiqueta de lavado',
    ]);
    // Lo ya firmado se sigue comprando.
    expect(explosion.grupos.flatMap((g) => g.renglones)).toHaveLength(3);
  });

  it('⭐ H1 — lo que ya está IDÉNTICO al modelo NO se reporta como choque', async () => {
    // La orden lleva la receta del modelo tal cual (tela + 2 avíos) y el modelo agrega UNO. Traer
    // todo tiene que dar 1 éxito y CERO avisos: ningún renglón alineado decidió nada distinto.
    // Antes daba 1 éxito y 3 "choques" falsos, y los 3 se escribían en la bitácora.
    await elModeloAgrega('ETQ-01');

    const r = await traerDelModelo(sesion(), ordenA, {}, bd());

    expect(r.traidos).toHaveLength(1);
    expect(r.respetados).toEqual([]);
  });

  it('…pero si lo PIDIERON por su nombre, sí se le contesta aunque ya estuviera alineado', async () => {
    // Preguntar por un material merece respuesta: el silencio dejaría al usuario sin saber qué pasó.
    const r = await traerDelModelo(
      sesion(),
      ordenA,
      { materiales: [{ tipo: 'avio', idAvio: avioBoton.id }] },
      bd(),
    );

    expect(r.traidos).toHaveLength(0);
    expect(r.respetados.map((c) => c.material)).toEqual(['BOT-01 — Botón']);
  });

  it('⭐ H6 — pedir algo que el modelo YA NO LLEVA se dice con nombre, no se traga (D3)', async () => {
    // El aviso que traía ese id pudo quedarse viejo en una pantalla abierta hace rato. Sin esto las
    // dos listas volvían vacías y el panel decía "esta orden ya lo tiene todo" — falso.
    const suelto = await cliente.avio.create({
      data: { clave: 'FUE-01', descripcion: 'Fuera del BOM', unidad: 'pza' },
    });

    const r = await traerDelModelo(
      sesion(),
      ordenA,
      { materiales: [{ tipo: 'avio', idAvio: suelto.id }] },
      bd(),
    );

    expect(r.traidos).toHaveLength(0);
    expect(r.respetados).toHaveLength(1);
    expect(r.respetados[0]?.material).toBe('FUE-01 — Fuera del BOM');
    expect(r.respetados[0]?.motivo).toContain('YA NO lo lleva');
  });

  it('lo traído y lo respetado quedan en la BITÁCORA (A7/D3)', async () => {
    await elModeloAgrega('ETQ-01');
    await traerDelModelo(sesion(), ordenA, {}, bd());

    const rastro = await cliente.bitacora.findFirst({
      where: { entidad: 'RecetaOrden', idEntidad: String(ordenA), accion: 'CREAR' },
      orderBy: { id: 'desc' },
    });
    expect(rastro?.datos).toMatchObject({ accion: 'traer-del-modelo' });
  });

  it('traer del modelo exige `desarrollo.administrar` (compras EXPLOTA, no captura)', async () => {
    await expect(
      traerDelModelo(sesion(['ordenes.ver', 'compras.ver']), ordenA, {}, bd()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });
});

describe('⭐ V1-E3h — LA BANDEJA «Recetas por liberar» (§Post-F9.72)', () => {
  it('una fila por ORDEN, con el conteo por tipo agregado en el servidor', async () => {
    const pagina = await consultarRecetasPorLiberar(sesion(), {}, bd());

    expect(pagina.total).toBe(2);
    const fila = pagina.datos.find((f) => f.idOrden === ordenA)!;
    expect(fila).toMatchObject({ telas: 1, avios: 2, artes: 0, porLiberar: 3 });
    expect(fila.modelo).toBe('A-100');
    expect(fila.cliente).toBe('C&A');
  });

  it('la orden que ya no tiene nada pendiente DESAPARECE de la bandeja', async () => {
    await marcarRecetaRevisada(sesion(), ordenA, bd());
    await liberarReceta(sesion(), ordenA, {}, bd());

    const pagina = await consultarRecetasPorLiberar(sesion(), {}, bd());
    expect(pagina.datos.map((f) => f.idOrden)).toEqual([ordenB]);
  });

  it('liberar en PARTE la deja en la bandeja, con el conteo ya bajado', async () => {
    await marcarRecetaRevisada(sesion(), ordenA, bd());
    await liberarReceta(sesion(), ordenA, { alcance: 'telas' }, bd());

    const pagina = await consultarRecetasPorLiberar(sesion(), {}, bd());
    expect(pagina.datos.find((f) => f.idOrden === ordenA)).toMatchObject({
      telas: 0,
      avios: 2,
      porLiberar: 2,
    });
  });

  it('la LÁPIDA no cuenta como pendiente (nadie tiene que firmar lo que no se compra)', async () => {
    const r0 = await obtenerRecetaOrden(sesion(), ordenA, bd());
    const jareta = r0.avios.find((a) => a.idAvio === avioJareta.id)!;
    await quitarRenglonReceta(sesion(), ordenA, 'avio', jareta.id, {}, bd());

    const pagina = await consultarRecetasPorLiberar(sesion(), {}, bd());
    expect(pagina.datos.find((f) => f.idOrden === ordenA)).toMatchObject({
      avios: 1,
      porLiberar: 2,
    });
  });

  it('⭐ ordena por FECHA DE ENTREGA (lo que estorba primero, arriba) y las sin fecha al final', async () => {
    await cliente.orden.update({
      where: { id: ordenB },
      data: { fechaEntrega: new Date('2026-09-01T00:00:00Z') },
    });
    // `ordenA` se queda SIN fecha de entrega.
    const pagina = await consultarRecetasPorLiberar(sesion(), {}, bd());
    expect(pagina.datos.map((f) => f.idOrden)).toEqual([ordenB, ordenA]);
  });

  it('la orden CANCELADA no aparece (su receta ya no se compra)', async () => {
    await cliente.orden.update({ where: { id: ordenB }, data: { estado: 'cancelada' } });
    const pagina = await consultarRecetasPorLiberar(sesion(), {}, bd());
    expect(pagina.datos.map((f) => f.idOrden)).toEqual([ordenA]);
  });

  it('⭐ marca la que YA FRENA DINERO (tiene OC por otra parte de su receta)', async () => {
    await marcarRecetaRevisada(sesion(), ordenA, bd());
    await liberarReceta(sesion(), ordenA, { alcance: 'telas' }, bd());
    await crearOC(sesionOc(), await cuerpoOc('Telas del Centro', ordenA), bd());

    const pagina = await consultarRecetasPorLiberar(sesion(), {}, bd());
    expect(pagina.datos.find((f) => f.idOrden === ordenA)?.conOrdenCompra).toBe(true);
    expect(pagina.datos.find((f) => f.idOrden === ordenB)?.conOrdenCompra).toBe(false);

    const soloConOc = await consultarRecetasPorLiberar(
      sesion(),
      { soloConOrdenCompra: true },
      bd(),
    );
    expect(soloConOc.datos.map((f) => f.idOrden)).toEqual([ordenA]);
  });

  it('busca por folio, modelo o cliente', async () => {
    expect((await consultarRecetasPorLiberar(sesion(), { busqueda: 'A-100' }, bd())).total).toBe(2);
    expect((await consultarRecetasPorLiberar(sesion(), { busqueda: 'C&A' }, bd())).total).toBe(2);
    expect(
      (await consultarRecetasPorLiberar(sesion(), { busqueda: 'ZZZ' }, bd())).datos,
    ).toHaveLength(0);
  });

  it('solo ve la EMPRESA ACTIVA (A9) y exige `desarrollo.ver`', async () => {
    const otra = await crearEmpresaPrueba(cliente, 'Otra empresa');
    const pagina = await consultarRecetasPorLiberar(sesion(PERM, otra.id), {}, bd());
    expect(pagina.datos).toHaveLength(0);

    await expect(
      consultarRecetasPorLiberar(sesion(['ordenes.ver']), {}, bd()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });
});
