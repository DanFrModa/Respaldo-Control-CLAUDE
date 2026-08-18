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
    await liberarReceta(sesion(), ordenA, bd());

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
    await liberarReceta(sesion(), ordenA, bd());
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
