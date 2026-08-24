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
import { explosionarOrden, previoCompraDesdeExplosion } from '../compras/mrp.js';
import {
  actualizarOC,
  autorizarOC,
  cancelarOC,
  crearOC,
  desautorizarOC,
} from '../compras/ordenes-compra.js';
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

/** Una referencia a un renglón de la receta, como la pide `liberarReceta`. */
type RefRenglon = { tipo: 'tela' | 'avio' | 'arte'; id: number };

/**
 * ⭐ V1-E3k (§Post-F9.80) — ENUMERA los renglones VIVOS para poder firmarlos.
 *
 * Existe porque `liberarReceta` **dejó de aceptar comodines**: ya no hay `alcance: 'todo'` ni
 * `'telas'`. Quien firma tiene que NOMBRAR lo que firma, y para nombrarlo tuvo que leer la receta —
 * que es exactamente la fricción que Daniel pidió (*"no tiene sentido liberar las cosas sin ver"*).
 * Las lápidas quedan fuera solas: no se compran, así que firmarlas no significaría nada.
 */
async function renglonesVivos(
  idOrden: number,
  seccion?: 'telas' | 'avios' | 'artes',
): Promise<RefRenglon[]> {
  const r = await obtenerRecetaOrden(sesion(), idOrden, bd());
  const de = (
    filas: readonly { id: number; excluido: boolean }[],
    tipo: RefRenglon['tipo'],
  ): RefRenglon[] => filas.filter((f) => !f.excluido).map((f) => ({ tipo, id: f.id }));
  return [
    ...(seccion === undefined || seccion === 'telas' ? de(r.telas, 'tela') : []),
    ...(seccion === undefined || seccion === 'avios' ? de(r.avios, 'avio') : []),
    ...(seccion === undefined || seccion === 'artes' ? de(r.artes, 'arte') : []),
  ];
}

/** Firma todos los renglones vivos (o los de UNA sección), nombrándolos uno por uno. */
async function liberarTodo(
  idOrden: number,
  seccion?: 'telas' | 'avios' | 'artes',
): Promise<Awaited<ReturnType<typeof liberarReceta>>> {
  return liberarReceta(
    sesion(),
    idOrden,
    { renglones: await renglonesVivos(idOrden, seccion) },
    bd(),
  );
}

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
    await expect(liberarTodo(ordenA)).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('«marcar todo revisado» resuelve el 89 % de un clic, y entonces sí libera', async () => {
    const revisada = await marcarRecetaRevisada(sesion(), ordenA, bd());
    expect(revisada.resumen).toMatchObject({ sinRevisar: 0, revisados: 3 });

    const liberada = await liberarTodo(ordenA);
    expect(liberada.puedeComprar).toBe(true);
    expect(liberada.liberadaEn).not.toBeNull();

    const explosion = await explosionarOrden(sesion(), ordenA, bd());
    expect(explosion.grupos.flatMap((g) => g.renglones)).toHaveLength(3);
  });

  it('una receta VACÍA no se puede liberar (liberar "nada" sería mentir)', async () => {
    const orden = await cliente.orden.create({
      data: { folio: 99n, idEmpresa: empresa.id, idModelo, idCliente },
    });
    // ⭐ V1-E3k: sin comodín, una receta vacía no tiene ni qué nombrar — y firmar una lista vacía se
    // rechaza con su motivo (D3), no se traga en silencio. Cambió el ERROR (antes era conflicto,
    // ahora es de validación), no la regla: sigue sin poderse firmar "nada".
    expect(await renglonesVivos(orden.id)).toEqual([]);
    const error = await liberarReceta(sesion(), orden.id, { renglones: [] }, bd()).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ErrorValidacion);
    expect((error as ErrorValidacion).message).toContain('renglón por renglón');
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
    await liberarTodo(ordenA);
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

describe('⭐ V1-E3h — LIBERAR POR PARTES (§Post-F9.72) · V1-E3k — UNO POR UNO (§Post-F9.80)', () => {
  beforeEach(async () => {
    // Todas estas pruebas parten de una receta revisada pero SIN FIRMAR.
    await marcarRecetaRevisada(sesion(), ordenA, bd());
  });

  it('⭐ EL CASO DE DANIEL: se liberan las telas, se compra la tela, y el avío sigue pendiente', async () => {
    const r = await liberarTodo(ordenA, 'telas');

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

  /**
   * ⭐ **V1-E4d — QUIÉN LE VENDE A QUIÉN.** El fixture de este archivo crea telas y avíos **sin
   * proveedor** (a Desarrollo no le hace falta), y sin proveedor el plan de compra no arma ninguna
   * OC: `planearCompra` los manda a `omitidos` con motivo `sin-proveedor` y `plan.proveedores`
   * llega **vacío**.
   *
   * 🔴 Ésa fue la lección que costó el CI en rojo de la primera vuelta de V1-E4d: las dos pruebas
   * de abajo *parecían* pasar por el aviso, pero el candado que heredaron de V1-E4c(B) —*el plan
   * tiene que traer renglones de verdad*— las cachó afirmando cosas sobre una compra **que no
   * existía**. Sin proveedor, `plan.avisos` puede salir "correcto" habiendo ejercitado cero.
   */
  async function conProveedorParaComprar(): Promise<void> {
    const prov = await cliente.proveedor.create({ data: { nombre: 'Insumos del Norte' } });
    // La tela resuelve proveedor por su DUEÑO; el avío, por su HABITUAL (§Post-F9.82).
    await cliente.tela.update({ where: { id: telaJersey.id }, data: { idProveedor: prov.id } });
    await cliente.avioProveedor.createMany({
      data: [
        { idAvio: avioBoton.id, idProveedor: prov.id, precio: 2, habitual: true },
        { idAvio: avioJareta.id, idProveedor: prov.id, precio: 8, habitual: true },
      ],
    });
  }

  /**
   * ⭐⭐ **V1-E4d (§Post-F9.96) — Y AL IR A GENERAR, LA CONSECUENCIA SE VUELVE A DECIR.**
   *
   * La explosión ofrece el lugar (lo que falta firmar, al final de la lista, con su camino a
   * liberarlo); **la revisión previa dice lo que eso cuesta**: esta OC no va a llevar el botón ni
   * la jareta. Es la misma forma que V1-E4c le dio al color.
   *
   * 🔴 **Esta prueba existe por la lección de V1-E4c(B):** la función pura ya está probada y la
   * pantalla también, pero **la unión no la sostenía nada** — cambiar el `avisos:` del plan por una
   * lista sin este aporte dejaba todo en verde. Aquí se ata al `previoCompraDesdeExplosion` real.
   *
   * ⚠️ **Y es el ÚNICO escenario en el que este aviso puede salir**: si un material sin firmar
   * tuviera requerimiento elegible, `exigirMaterialesLiberados` rechazaría la compra entera con un
   * 409 **antes** de llegar a los avisos. O sea que lo que se avisa es siempre *lo que se quedó
   * fuera del snapshot*, nunca *lo que se va a comprar mal*.
   */
  it('⭐⭐ V1-E4d: la REVISIÓN PREVIA avisa de lo que NO entra por no estar liberado', async () => {
    await conProveedorParaComprar();
    await liberarTodo(ordenA, 'telas');
    await explosionarOrden(sesion(), ordenA, bd());

    // ⚠️ La previa exige `compras.administrar` (es la primera mitad de comprar, §Post-F9.68): va
    // con la sesión de Compras, no con la de Desarrollo que libera.
    const plan = await previoCompraDesdeExplosion(
      sesionOc(),
      { idsOrden: [ordenA], idsRequerimiento: [] },
      bd(),
    );

    // Los DOS avíos sin firmar, cada uno con su nombre y su orden. (El valor que la pone roja:
    // `avisos` sin este aporte — o sea, el aviso desconectado del plan.)
    const sinLiberar = plan.avisos.filter((a) => a.includes('NO entra en esta compra'));
    expect(sinLiberar).toHaveLength(2);
    expect(sinLiberar.join(' ')).toContain('BOT-01 — Botón');
    expect(sinLiberar.join(' ')).toContain('JAR-01 — Jareta');
    // 🔴 Y NO bloquea (§Post-F9.64: avisar no es bloquear): la tela liberada sí se compra.
    expect(plan.proveedores.flatMap((p) => p.renglones)).not.toHaveLength(0);
    expect(plan.bloqueos.some((b) => b.includes('liber'))).toBe(false);
  });

  /**
   * 🔴 **EL CASO QUE OBLIGA A MIRAR EL PLAN Y NO SÓLO LA RECETA.** Si TODO está liberado al
   * explotar, el plan no tiene nada que advertir por este lado — ni siquiera cuando la firma se
   * re-cierra después: lo que ya entró en el snapshot **sí se va a comprar**, y decir "no entra"
   * sería mentirle a quien firma.
   */
  it('con TODO liberado, la previa no inventa avisos de material sin firmar (y el ARTE no cuenta)', async () => {
    // 🔴 Un ARTE sin firmar, a propósito: el arte NO se compra por MRP, así que nombrarlo aquí
    // sería ruido en una pantalla de materiales. Es el mismo filtro que ya aplica la explosión, y
    // sin él esta prueba se pone roja.
    await cliente.ordenArte.create({
      data: { idOrden: ordenA, descripcion: 'Águila bordada', idTipoArte },
    });
    await conProveedorParaComprar();
    await liberarTodo(ordenA, 'telas');
    await liberarTodo(ordenA, 'avios');
    await explosionarOrden(sesion(), ordenA, bd());

    // ⚠️ La previa exige `compras.administrar` (es la primera mitad de comprar, §Post-F9.68): va
    // con la sesión de Compras, no con la de Desarrollo que libera.
    const plan = await previoCompraDesdeExplosion(
      sesionOc(),
      { idsOrden: [ordenA], idsRequerimiento: [] },
      bd(),
    );
    expect(plan.proveedores.flatMap((p) => p.renglones)).not.toHaveLength(0);
    expect(plan.avisos.filter((a) => a.includes('NO entra en esta compra'))).toEqual([]);
  });

  it('firmar los DOS avíos deja las telas fuera: se firma lo que se nombra, nada más', async () => {
    const r = await liberarTodo(ordenA, 'avios');
    expect(r.avios.every((a) => a.liberadoEn !== null)).toBe(true);
    expect(r.telas.every((t) => t.liberadoEn === null)).toBe(true);
  });

  it('⭐ liberar UN renglón firma EXACTAMENTE ése y deja a su compañero de sección sin firma', async () => {
    const r0 = await obtenerRecetaOrden(sesion(), ordenA, bd());
    const boton = r0.avios.find((a) => a.idAvio === avioBoton.id)!;

    const r = await liberarReceta(
      sesion(),
      ordenA,
      { renglones: [{ tipo: 'avio', id: boton.id }] },
      bd(),
    );

    expect(r.avios.find((a) => a.id === boton.id)?.liberadoEn).not.toBeNull();
    // La jareta es del MISMO tipo y de la MISMA orden: si algo expandiera la firma, caería aquí.
    expect(r.avios.find((a) => a.idAvio === avioJareta.id)?.liberadoEn).toBeNull();
    expect(r.telas[0]?.liberadoEn).toBeNull();
    expect(r.resumen).toMatchObject({ liberados: 1, porLiberar: 2 });
  });

  it('una lista VACÍA se rechaza (liberar "nada" no es liberar)', async () => {
    await expect(liberarReceta(sesion(), ordenA, { renglones: [] }, bd())).rejects.toBeInstanceOf(
      ErrorValidacion,
    );
  });

  // ── ⭐ V1-E3k: LA PUERTA ESTÁ CERRADA EN EL SERVIDOR, no solo escondida en la pantalla ──────
  //
  // §Post-F9.68 pide las dos capas. Estas dos pruebas son las que se ponen ROJAS si alguien
  // reintroduce el bloque en el dominio: no comprueban que "algún botón desapareció" —eso no
  // probaría nada—, comprueban que un cliente que MANDA el cuerpo viejo no consigue lo que pedía.

  it('⭐ un cliente viejo que manda `alcance: "todo"` NO firma la receta entera: solo lo que nombró', async () => {
    const r0 = await obtenerRecetaOrden(sesion(), ordenA, bd());
    const jersey = r0.telas[0]!;

    // Exactamente el cuerpo que mandaba el botón «Liberar todo lo que falta» de V1-E3j, más un
    // renglón nombrado para que la petición sea válida. Si `alcance` siguiera vivo, los DOS avíos
    // quedarían firmados; el cast es el punto: ningún cliente tipado puede mandar esto ya.
    const r = await liberarReceta(
      sesion(),
      ordenA,
      { alcance: 'todo', renglones: [{ tipo: 'tela', id: jersey.id }] } as unknown as {
        renglones: RefRenglon[];
      },
      bd(),
    );

    expect(r.telas.find((t) => t.id === jersey.id)?.liberadoEn).not.toBeNull();
    expect(r.avios.find((a) => a.idAvio === avioBoton.id)?.liberadoEn).toBeNull();
    expect(r.avios.find((a) => a.idAvio === avioJareta.id)?.liberadoEn).toBeNull();
    expect(r.todoLiberado).toBe(false);
    expect(r.resumen).toMatchObject({ liberados: 1, porLiberar: 2 });
  });

  it('⭐ `revisarPendientes: true` YA NO firma lo que nadie revisó: rebota igual (§Post-F9.80)', async () => {
    // Se deshace el `marcarRecetaRevisada` del beforeEach: queda una orden como recién creada, que
    // es el caso para el que se había inventado la bandera (la bandeja firmaba sin ver la lista).
    await cliente.ordenAvio.updateMany({
      where: { idOrden: ordenA },
      data: { estado: 'sin_revisar' },
    });
    const r0 = await obtenerRecetaOrden(sesion(), ordenA, bd());
    const boton = r0.avios.find((a) => a.idAvio === avioBoton.id)!;

    const error = await liberarReceta(
      sesion(),
      ordenA,
      { revisarPendientes: true, renglones: [{ tipo: 'avio', id: boton.id }] } as unknown as {
        renglones: RefRenglon[];
      },
      bd(),
    ).catch((e: unknown) => e);

    // Si la bandera siguiera viva esto habría resuelto, no lanzado: ése es el valor que la pone roja.
    expect(error).toBeInstanceOf(ErrorConflicto);
    expect((error as ErrorConflicto).message).toContain('revisado');
    const despues = await obtenerRecetaOrden(sesion(), ordenA, bd());
    expect(despues.avios.find((a) => a.id === boton.id)?.estado).toBe('sin_revisar');
    expect(despues.avios.find((a) => a.id === boton.id)?.liberadoEn).toBeNull();
  });

  it('…y el camino que SÍ queda es «marcar todo revisado» (que no libera nada) y luego firmar', async () => {
    await cliente.ordenAvio.updateMany({
      where: { idOrden: ordenA },
      data: { estado: 'sin_revisar' },
    });
    const r0 = await obtenerRecetaOrden(sesion(), ordenA, bd());
    const boton = r0.avios.find((a) => a.idAvio === avioBoton.id)!;

    // «Marcar todo revisado» SE CONSERVA por decisión de Daniel: no compromete dinero.
    const revisada = await marcarRecetaRevisada(sesion(), ordenA, bd());
    expect(revisada.resumen.sinRevisar).toBe(0);
    // Y no firmó NADA: revisar y liberar son dos actos distintos.
    expect(revisada.resumen.liberados).toBe(0);

    const r = await liberarReceta(
      sesion(),
      ordenA,
      { renglones: [{ tipo: 'avio', id: boton.id }] },
      bd(),
    );
    expect(r.avios.find((a) => a.id === boton.id)?.liberadoEn).not.toBeNull();
  });

  it('el renglón AJUSTADO se firma sin perder su marca (es la que impide que el modelo lo pise)', async () => {
    const r0 = await obtenerRecetaOrden(sesion(), ordenA, bd());
    const boton = r0.avios.find((a) => a.idAvio === avioBoton.id)!;
    await editarRenglonReceta(sesion(), ordenA, 'avio', boton.id, { consumoPorPrenda: 9 }, bd());

    const r = await liberarTodo(ordenA);

    expect(r.avios.find((a) => a.id === boton.id)?.estado).toBe('ajustado');
    expect(r.todoLiberado).toBe(true);
  });

  it('⭐ H7 — un id de LÁPIDA en la lista se explica por su causa, no como "no encontrado"', async () => {
    const r0 = await obtenerRecetaOrden(sesion(), ordenA, bd());
    const jareta = r0.avios.find((a) => a.idAvio === avioJareta.id)!;
    await quitarRenglonReceta(sesion(), ordenA, 'avio', jareta.id, {}, bd());

    const error = await liberarReceta(
      sesion(),
      ordenA,
      { renglones: [{ tipo: 'avio', id: jareta.id }] },
      bd(),
    ).catch((e: unknown) => e);

    // El renglón EXISTE: lo que pasa es que esta orden decidió que no lo lleva.
    expect(error).toBeInstanceOf(ErrorConflicto);
    expect((error as ErrorConflicto).message).toContain('JAR-01');
    expect((error as ErrorConflicto).message).toContain('QUITADO');
  });

  it('un renglón de OTRA orden en la lista es 404, no un silencio (D3)', async () => {
    const rB = await obtenerRecetaOrden(sesion(), ordenB, bd());
    await expect(
      liberarReceta(sesion(), ordenA, { renglones: [{ tipo: 'avio', id: rB.avios[0]!.id }] }, bd()),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });

  it('una sección VACÍA no tiene ni qué nombrar: no hay forma de "firmar los artes" de esta orden', async () => {
    // El modelo de estas pruebas no lleva arte. Antes existía `alcance: 'artes'` y contestaba "esta
    // orden no tiene artes que liberar"; ahora el comodín no existe, así que la lista sale vacía y
    // el rechazo es el de siempre: no se firma "nada" (D3).
    expect(await renglonesVivos(ordenA, 'artes')).toEqual([]);
    await expect(liberarTodo(ordenA, 'artes')).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('⭐ un renglón SIN REVISAR de OTRA sección no estorba a la firma de la mía', async () => {
    // La tela se deja sin revisar a mano: firmar los AVÍOS no debe pedir cuentas de la tela.
    await cliente.ordenTela.updateMany({
      where: { idOrden: ordenA },
      data: { estado: 'sin_revisar' },
    });
    const r = await liberarTodo(ordenA, 'avios');
    expect(r.avios.every((a) => a.liberadoEn !== null)).toBe(true);
    // Y la tela sin revisar sigue frenando SU propia firma.
    await expect(liberarTodo(ordenA, 'telas')).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('firmar todo lo que faltaba deja la receta COMPLETA, con fecha y autor', async () => {
    await liberarTodo(ordenA, 'telas');
    const r = await liberarTodo(ordenA);
    expect(r.todoLiberado).toBe(true);
    expect(r.liberadaEn).not.toBeNull();
    expect(r.liberadaPor).not.toBeNull();
  });

  it('la LÁPIDA no cuenta para "todo liberado": firmar lo vivo basta, y a ella no la toca nadie', async () => {
    const r0 = await obtenerRecetaOrden(sesion(), ordenA, bd());
    const jareta = r0.avios.find((a) => a.idAvio === avioJareta.id)!;
    await quitarRenglonReceta(sesion(), ordenA, 'avio', jareta.id, {}, bd());

    const r = await liberarTodo(ordenA);

    expect(r.avios.find((a) => a.id === jareta.id)?.liberadoEn).toBeNull();
    expect(r.todoLiberado).toBe(true);
  });

  it('⭐ la OC A MANO se frena por MATERIAL: la tela sin firmar no se compra aunque el avío sí esté', async () => {
    await liberarTodo(ordenA, 'avios');
    // `cuerpoOc` compra JERSEY, que sigue sin firma.
    await expect(
      crearOC(sesionOc(), await cuerpoOc('Telas del Este', ordenA), bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    await liberarTodo(ordenA, 'telas');
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
    await liberarTodo(ordenA);

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
    await liberarTodo(ordenA);

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
    await liberarTodo(ordenA);
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

/**
 * ⭐ V1-E3j — EL ENCABEZADO DE LA ORDEN VIAJA CON LA RECETA.
 *
 * La receta tiene PANTALLA PROPIA, a la que se llega también desde la bandeja de Desarrollo: ahí no
 * hay una OP alrededor de la cual leerse, y Daniel pidió *"saber en qué OP estás sin volver atrás"*.
 * Pedirle el encabezado a `GET /ordenes/:id` ataría la pantalla a `ordenes.ver`, que es justo el
 * permiso que §Post-F9.72 sacó de en medio — por eso va aquí, en la misma lectura.
 */
describe('⭐ V1-E3j — el encabezado de la orden, dentro de la receta', () => {
  it('trae cliente, entrega, estado y la CANTIDAD derivada de la matriz', async () => {
    const orden = await cliente.orden.create({
      data: {
        folio: 9101n,
        idEmpresa: empresa.id,
        idModelo,
        idCliente,
        fechaEntrega: new Date('2026-09-30T00:00:00.000Z'),
        lineas: {
          create: [
            { idColor: colorRojo.id, tallas: { create: [{ idTalla: tallaCH.id, cantidad: 7 }] } },
          ],
        },
      },
    });

    const receta = await obtenerRecetaOrden(sesion(), orden.id, bd());

    expect(receta.folio).toBe(9101);
    expect(receta.codigoModelo).toBe('A-100');
    expect(receta.cliente).toBe('C&A');
    expect(receta.fechaEntrega).toBe('2026-09-30');
    expect(receta.estado).toBe('capturada');
    // La cantidad se DERIVA por suma de la matriz (nunca se guarda), igual que en `aOrdenSalida`.
    expect(receta.totalPiezas).toBe(7);
  });

  /**
   * ⚠️ HALLAZGO DEL REVIEWER: con UNA sola fila de matriz, `_sum` ≡ `_max` ≡ `_min` ≡ `_avg`, así
   * que cambiar el agregado del servidor **sobrevivía** a las pruebas. Y `totalPiezas` es el ÚNICO
   * número DERIVADO que V1-E3j agregó. Este caso lo distingue: 4 renglones cuyo total (26) no
   * coincide con ninguna fila (3/5/7/11), ni con su máximo, ni con su mínimo, ni con su promedio
   * (6.5), ni con el conteo (4).
   */
  it('⭐ la CANTIDAD es la SUMA de toda la matriz — no el máximo, ni una fila, ni el promedio', async () => {
    const colorAzul = await cliente.color.create({ data: { nombre: 'Azul' } });
    const tallaG = await cliente.talla.create({ data: { etiqueta: 'G', orden: 2 } });
    const orden = await cliente.orden.create({
      data: {
        folio: 9102n,
        idEmpresa: empresa.id,
        idModelo,
        idCliente,
        lineas: {
          create: [
            {
              idColor: colorRojo.id,
              tallas: {
                create: [
                  { idTalla: tallaCH.id, cantidad: 3 },
                  { idTalla: tallaG.id, cantidad: 5 },
                ],
              },
            },
            {
              idColor: colorAzul.id,
              tallas: {
                create: [
                  { idTalla: tallaCH.id, cantidad: 7 },
                  { idTalla: tallaG.id, cantidad: 11 },
                ],
              },
            },
          ],
        },
      },
    });

    const receta = await obtenerRecetaOrden(sesion(), orden.id, bd());

    expect(receta.totalPiezas).toBe(26);
    // Las gemelas negativas, explícitas: ninguno de los otros agregados da 26.
    expect(receta.totalPiezas).not.toBe(11); // _max
    expect(receta.totalPiezas).not.toBe(3); // _min
    expect(receta.totalPiezas).not.toBe(4); // _count
  });

  it('sin fecha de entrega el encabezado dice null (no una fecha inventada)', async () => {
    const receta = await obtenerRecetaOrden(sesion(), ordenA, bd());
    expect(receta.fechaEntrega).toBeNull();
    // `ordenA` la creó `crearOrdenConReceta`: 10 piezas de una talla.
    expect(receta.totalPiezas).toBe(10);
  });

  it('una orden CANCELADA lo dice en la receta (la pantalla apaga la edición con eso)', async () => {
    await cliente.orden.update({ where: { id: ordenA }, data: { estado: 'cancelada' } });
    const receta = await obtenerRecetaOrden(sesion(), ordenA, bd());
    expect(receta.estado).toBe('cancelada');
  });
});

describe('RBAC y empresa (A4/A9)', () => {
  it('leer sin NINGUNO de los dos permisos de lectura → 403', async () => {
    await expect(obtenerRecetaOrden(sesion([]), ordenA, bd())).rejects.toBeInstanceOf(ErrorPermiso);
  });

  /**
   * ⭐ V1-E3j — LA LECTURA ACEPTA `ordenes.ver` **O** `desarrollo.ver`.
   *
   * §Post-F9.72 bajó las SIETE mutaciones de la receta a `desarrollo.administrar` y puso la bandeja
   * en `desarrollo.ver` —*"nadie va a tener permiso de modificar la OP más que yo"*—, pero dejó
   * ESTA lectura en `ordenes.ver`: un usuario de Desarrollo puro podía FIRMAR una receta que no
   * podía LEER. Con la pantalla propia de V1-E3j deja de ser teórico (la ruta abre con
   * `desarrollo.ver` y su primera consulta reventaría con 403).
   */
  it('⭐ V1-E3j: se lee con SOLO `desarrollo.ver` (quien firma tiene que poder leer)', async () => {
    const receta = await obtenerRecetaOrden(sesion(['desarrollo.ver']), ordenA, bd());
    expect(receta.idOrden).toBe(ordenA);
  });

  it('⭐ V1-E3j: y se sigue leyendo con SOLO `ordenes.ver` (desde la OP, como siempre)', async () => {
    const receta = await obtenerRecetaOrden(sesion(['ordenes.ver']), ordenA, bd());
    expect(receta.idOrden).toBe(ordenA);
  });

  it('⭐ V1-E3j: `desarrollo.ver` NO abre las MUTACIONES (siguen en `.administrar`)', async () => {
    await expect(
      marcarRecetaRevisada(sesion(['desarrollo.ver']), ordenA, bd()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
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
      await liberarTodo(id);
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
    await liberarTodo(ordenA);

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

  /**
   * ⭐⭐ **§Post-F9.105 — CUALQUIER guardado del renglón normaliza, no sólo el de las tallas.**
   *
   * Daniel, 24-ago-2026: *"la compra de los cierres me está dando una cantidad muchísimo mayor de
   * la que necesito"*. La contradicción llevaba meses viva porque la puerta para cerrarla era
   * demasiado estrecha: el aviso PROMETÍA *"guarda el renglón para normalizarlo"* y el código sólo
   * lo hacía si el PATCH traía `tallas`. Guardar el precio o el proveedor —lo que de verdad hace la
   * gente— la dejaba intacta. El texto prometía lo que el código no cumplía.
   */
  it('⭐ §Post-F9.105: guardar SÓLO EL PRECIO también normaliza la contradicción', async () => {
    const previo = (await obtenerRecetaOrden(sesion(), ordenA, bd())).avios.find(
      (a) => a.idAvio === avioBoton.id,
    )!;
    // Estado congelado de una OP anterior al 18-ago-2026: el toggle encendido y la LONGITUD del
    // cierre (53) capturada en el campo de cantidad.
    await cliente.ordenAvio.update({ where: { id: previo.id }, data: { consumoPorTalla: true } });
    await cliente.ordenAvioTalla.create({
      data: { idOrdenAvio: previo.id, idTalla: tallaCH.id, consumo: 53 },
    });
    await botonPorMedida();

    const r = await editarRenglonReceta(sesion(), ordenA, 'avio', previo.id, { precio: 9 }, bd());

    const boton = r.avios.find((a) => a.idAvio === avioBoton.id)!;
    expect(boton.consumoPorTalla).toBe(false); // ⭐ lo que antes NO pasaba
    expect(boton.precio).toBe(9);
    expect(boton.avisoCaptura).toBeNull();
    // D3: la cantidad vieja NO se borra, sólo deja de mandar.
    expect(boton.tallas.find((t) => t.idTalla === tallaCH.id)?.consumo).toBe(53);

    // ⭐ Y queda ESCRITO que el sistema apagó la bandera por su cuenta: un cambio que nadie pidió
    // y que no se registra es indistinguible de uno que se calló (A7/D3).
    const bitacora = await cliente.bitacora.findFirst({
      where: { entidad: 'RecetaOrden', idEntidad: String(ordenA), accion: 'MODIFICAR' },
      orderBy: { id: 'desc' },
    });
    expect(JSON.stringify(bitacora?.datos)).toContain('"consumoPorTalla":false');
  });

  it('⭐ §Post-F9.105: el aviso dice CUÁNTO se está pidiendo de más, no sólo que hay un lío', async () => {
    const previo = (await obtenerRecetaOrden(sesion(), ordenA, bd())).avios.find(
      (a) => a.idAvio === avioBoton.id,
    )!;
    await cliente.ordenAvio.update({ where: { id: previo.id }, data: { consumoPorTalla: true } });
    await cliente.ordenAvioTalla.create({
      data: { idOrdenAvio: previo.id, idTalla: tallaCH.id, consumo: 53 },
    });
    await botonPorMedida();

    const leido = await obtenerRecetaOrden(sesion(), ordenA, bd());
    const aviso = leido.avios.find((a) => a.idAvio === avioBoton.id)?.avisoCaptura ?? '';
    // La orden lleva 10 piezas de CH: 53×10 = 530 pza contra las 2×10 = 20 que de verdad lleva.
    expect(aviso).toContain('530 pza');
    expect(aviso).toContain('en vez de 20 pza');
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
    await liberarTodo(ordenA);
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
    await liberarTodo(ordenA);

    const pagina = await consultarRecetasPorLiberar(sesion(), {}, bd());
    expect(pagina.datos.map((f) => f.idOrden)).toEqual([ordenB]);
  });

  it('liberar en PARTE la deja en la bandeja, con el conteo ya bajado', async () => {
    await marcarRecetaRevisada(sesion(), ordenA, bd());
    await liberarTodo(ordenA, 'telas');

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
    await liberarTodo(ordenA, 'telas');
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

// ── ⭐ V1-E3y — NO SE QUITA DE LA RECETA LO YA COMPRADO (§Post-F9.79) ───────────────────────────

describe('⭐ V1-E3y — lo ya COMPRADO no se saca de la receta (§Post-F9.79)', () => {
  /** Sesión con la llave de firmar Y la de desfirmar (el perfil de dirección). */
  function sesionCompras(extra: ClavePermiso[] = []): SesionUsuario {
    return sesionDePrueba({
      idEmpresaActiva: empresa.id,
      permisos: ['compras.ver', 'compras.administrar', 'compras.cancelar', ...extra],
    });
  }

  /** Una OC con UNA línea del material dado, ligada a la orden. Devuelve su id. */
  async function ocDe(
    idOrden: number,
    material: { idTela: number } | { idAvio: number },
    nombreProveedor = `Prov ${String(Math.random()).slice(2, 8)}`,
  ): Promise<number> {
    const proveedor = await cliente.proveedor.create({ data: { nombre: nombreProveedor } });
    const direccion =
      (await cliente.direccionEntrega.findFirst({ where: { nombre: 'Naucalpan' } })) ??
      (await cliente.direccionEntrega.create({
        data: { nombre: 'Naucalpan', direccion: 'Calle 1' },
      }));
    const oc = await crearOC(
      sesionCompras(),
      {
        idProveedor: proveedor.id,
        idDireccionEntrega: direccion.id,
        fechaEntrega: '2026-09-30',
        lineas: [{ ...material, cantidad: 10, precio: 5, idOrden }],
      },
      bd(),
    );
    return oc.id;
  }

  /** El renglón de avío de la jareta en la receta de la orden. */
  async function renglonJareta(idOrden: number): Promise<number> {
    const r = await obtenerRecetaOrden(sesion(), idOrden, bd());
    const fila = r.avios.find((a) => a.idAvio === avioJareta.id);
    if (fila === undefined) throw new Error('la jareta no está en la receta');
    return fila.id;
  }

  /** Deja la receta de la orden firmada y compra la jareta: el escenario de Daniel. */
  async function jaretaComprada(idOrden: number): Promise<{ idRenglon: number; idOc: number }> {
    await marcarRecetaRevisada(sesion(), idOrden, bd());
    await liberarTodo(idOrden);
    const idOc = await ocDe(idOrden, { idAvio: avioJareta.id });
    await autorizarOC(sesionCompras(['compras.autorizar']), idOc, bd());
    return { idRenglon: await renglonJareta(idOrden), idOc };
  }

  it('con la OC en BORRADOR todavía se puede quitar (no hay compromiso con el proveedor)', async () => {
    await marcarRecetaRevisada(sesion(), ordenA, bd());
    await liberarTodo(ordenA);
    await ocDe(ordenA, { idAvio: avioJareta.id }); // se queda en borrador: NO se autoriza
    const r = await quitarRenglonReceta(
      sesion(),
      ordenA,
      'avio',
      await renglonJareta(ordenA),
      { motivo: 'el cliente la negoció fuera' },
      bd(),
    );
    expect(r.avios.find((a) => a.idAvio === avioJareta.id)?.excluido).toBe(true);
  });

  it('⭐ con la OC AUTORIZADA ya no se puede quitar, y el error dice el folio y qué hacer', async () => {
    const { idRenglon, idOc } = await jaretaComprada(ordenA);
    const folio = Number(
      (await cliente.ordenCompra.findUniqueOrThrow({ where: { id: idOc } })).numCompra,
    );
    await expect(
      quitarRenglonReceta(sesion(), ordenA, 'avio', idRenglon, { motivo: 'ya no va' }, bd()),
    ).rejects.toThrow(
      // 🔴 SIN distinguir mayúsculas, a propósito. Lo que esta prueba fija es QUÉ dice el mensaje
      // —el material, el folio, y que hay que des-autorizar—, no CÓMO está escrito. La versión
      // anterior pedía «des-autoriza» en minúsculas y se puso ROJA EN CI cuando el remate del
      // propio mensaje lo pasó a «DES-AUTORIZAR»: el texto mejoró y la aserción se quedó vieja.
      // Una aserción que se rompe por el estilo del texto no protege nada y sí frena la entrega.
      new RegExp(`JAR-01[\\s\\S]*#${String(folio)}[\\s\\S]*des-autoriza`, 'i'),
    );
    // Y no se movió nada: la receta sigue igual (la transacción se deshizo entera, A2).
    const r = await obtenerRecetaOrden(sesion(), ordenA, bd());
    expect(r.avios.find((a) => a.idAvio === avioJareta.id)?.excluido).toBe(false);
  });

  it('⭐ tampoco por la PUERTA DE ATRÁS: ni `paraProduccion: false` ni consumo 0', async () => {
    const { idRenglon } = await jaretaComprada(ordenA);
    await expect(
      editarRenglonReceta(sesion(), ordenA, 'avio', idRenglon, { paraProduccion: false }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
    await expect(
      editarRenglonReceta(sesion(), ordenA, 'avio', idRenglon, { consumoPorPrenda: 0 }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('editar lo comprado SIGUE siendo legítimo mientras no lo saque de la compra', async () => {
    const { idRenglon } = await jaretaComprada(ordenA);
    // Cambiar el consumo (hacia arriba o hacia abajo) y el precio congelado no lo saca de nada.
    const r = await editarRenglonReceta(
      sesion(),
      ordenA,
      'avio',
      idRenglon,
      { consumoPorPrenda: 3, precio: 11 },
      bd(),
    );
    expect(r.avios.find((a) => a.idAvio === avioJareta.id)).toMatchObject({
      consumoPorPrenda: 3,
      precio: 11,
    });
  });

  it('⭐ RESTAURAR tampoco puede sacarlo: si el modelo lo apagó, se bloquea', async () => {
    const { idRenglon } = await jaretaComprada(ordenA);
    // El modelo apaga la jareta para producción. Restaurar copiaría ese `false` a la orden y la
    // sacaría de la explosión — misma puerta de atrás, entrada por el otro lado.
    await cliente.modeloAvio.update({
      where: { idModelo_idAvio: { idModelo, idAvio: avioJareta.id } },
      data: { paraProduccion: false },
    });
    await expect(
      restaurarRenglonReceta(sesion(), ordenA, 'avio', idRenglon, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    // Con el modelo encendido otra vez, restaurar vuelve a funcionar (no se bloquea de más).
    await cliente.modeloAvio.update({
      where: { idModelo_idAvio: { idModelo, idAvio: avioJareta.id } },
      data: { paraProduccion: true },
    });
    const r = await restaurarRenglonReceta(sesion(), ordenA, 'avio', idRenglon, bd());
    expect(r.avios.find((a) => a.idAvio === avioJareta.id)?.excluido).toBe(false);
  });

  it('⭐ la MARCHA ATRÁS funciona: des-autorizada la OC, el renglón se puede quitar', async () => {
    const { idRenglon, idOc } = await jaretaComprada(ordenA);
    await desautorizarOC(
      sesionCompras(['compras.desautorizar']),
      idOc,
      { motivo: 'la jareta se negoció fuera' },
      bd(),
    );
    const r = await quitarRenglonReceta(
      sesion(),
      ordenA,
      'avio',
      idRenglon,
      { motivo: 'el cliente la negoció fuera' },
      bd(),
    );
    expect(r.avios.find((a) => a.idAvio === avioJareta.id)?.excluido).toBe(true);
  });

  it('⭐ si la OC ya se RECIBIÓ, el error dice que ese camino NO existe (DANIEL, 20-ago)', async () => {
    const { idRenglon, idOc } = await jaretaComprada(ordenA);
    await cliente.ordenCompra.update({
      where: { id: idOc },
      data: { estatus: 'recibida_parcial' },
    });
    await expect(
      quitarRenglonReceta(sesion(), ordenA, 'avio', idRenglon, { motivo: 'ya no va' }, bd()),
    ).rejects.toThrow(/RECIBIÓ[\s\S]*devolución/);
  });

  it('CANCELAR la OC también libera el renglón (esa OC ya no dice nada)', async () => {
    const { idRenglon, idOc } = await jaretaComprada(ordenA);
    await cancelarOC(sesionCompras(), idOc, { motivo: 'error de captura' }, bd());
    const r = await quitarRenglonReceta(
      sesion(),
      ordenA,
      'avio',
      idRenglon,
      { motivo: 'ya no va' },
      bd(),
    );
    expect(r.avios.find((a) => a.idAvio === avioJareta.id)?.excluido).toBe(true);
  });

  it('el bloqueo va POR MATERIAL: comprar la jareta no congela el botón ni la tela', async () => {
    await jaretaComprada(ordenA);
    const r = await obtenerRecetaOrden(sesion(), ordenA, bd());
    const idBoton = r.avios.find((a) => a.idAvio === avioBoton.id)?.id ?? 0;
    const tras = await quitarRenglonReceta(
      sesion(),
      ordenA,
      'avio',
      idBoton,
      { motivo: 'sin botones' },
      bd(),
    );
    expect(tras.avios.find((a) => a.idAvio === avioBoton.id)?.excluido).toBe(true);
  });

  it('y va POR ORDEN: comprar la jareta de la orden A no bloquea la receta de la B', async () => {
    await jaretaComprada(ordenA);
    await marcarRecetaRevisada(sesion(), ordenB, bd());
    await liberarTodo(ordenB);
    const r = await quitarRenglonReceta(
      sesion(),
      ordenB,
      'avio',
      await renglonJareta(ordenB),
      { motivo: 'esta orden no la lleva' },
      bd(),
    );
    expect(r.avios.find((a) => a.idAvio === avioJareta.id)?.excluido).toBe(true);
  });

  it('también protege la TELA comprada (no solo los avíos)', async () => {
    await marcarRecetaRevisada(sesion(), ordenA, bd());
    await liberarTodo(ordenA);
    const idOc = await ocDe(ordenA, { idTela: telaJersey.id });
    await autorizarOC(sesionCompras(['compras.autorizar']), idOc, bd());
    const r = await obtenerRecetaOrden(sesion(), ordenA, bd());
    const idTelaRenglon = r.telas[0]?.id ?? 0;
    await expect(
      quitarRenglonReceta(sesion(), ordenA, 'tela', idTelaRenglon, { motivo: 'ya no' }, bd()),
    ).rejects.toThrow(/Jersey/);
  });

  // ── ⭐ La TERCERA puerta: el avío POR TALLA (R18) ────────────────────────────────────────────
  //
  // Hallazgo del reviewer que tumbó la primera versión de la guarda. En un avío `consumoPorTalla`
  // el requerido NO sale de `consumoPorPrenda` sino de las MEDIDAS: ponerlas todas en 0 vacía la
  // compra con los dos campos intactos. Y su espejo: con `consumoPorPrenda = 0` y medidas > 0 el
  // avío SÍ pide material, y el criterio viejo no lo protegía.

  /** Deja el botón de la orden como avío POR TALLA con medida 1 en la talla CH, y lo compra. */
  async function botonPorTallaComprado(
    idOrden: number,
    consumoPorPrenda = 2,
  ): Promise<{ idRenglon: number; idOc: number }> {
    const r0 = await obtenerRecetaOrden(sesion(), idOrden, bd());
    const idRenglon = r0.avios.find((a) => a.idAvio === avioBoton.id)?.id ?? 0;
    await editarRenglonReceta(
      sesion(),
      idOrden,
      'avio',
      idRenglon,
      {
        consumoPorPrenda,
        consumoPorTalla: true,
        tallas: [{ idTalla: tallaCH.id, consumo: 1 }],
      },
      bd(),
    );
    await marcarRecetaRevisada(sesion(), idOrden, bd());
    await liberarTodo(idOrden);
    const idOc = await ocDe(idOrden, { idAvio: avioBoton.id });
    await autorizarOC(sesionCompras(['compras.autorizar']), idOc, bd());
    return { idRenglon, idOc };
  }

  it('⭐ TERCERA PUERTA: poner en 0 las MEDIDAS POR TALLA de un avío comprado se bloquea', async () => {
    const { idRenglon } = await botonPorTallaComprado(ordenA);
    // `paraProduccion` sigue true y `consumoPorPrenda` sigue en 2: los dos campos que miraba el
    // criterio viejo están INTACTOS, y aun así el requerido se iría a cero.
    await expect(
      editarRenglonReceta(
        sesion(),
        ordenA,
        'avio',
        idRenglon,
        { tallas: [{ idTalla: tallaCH.id, consumo: 0 }] },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    // Y no se escribió nada: la medida sigue siendo la de antes (A2).
    const r = await obtenerRecetaOrden(sesion(), ordenA, bd());
    const boton = r.avios.find((a) => a.idAvio === avioBoton.id);
    expect(boton?.tallas.find((t) => t.idTalla === tallaCH.id)?.consumo).toBe(1);
  });

  it('bajar la medida SIN vaciarla sigue siendo legítimo sobre un avío comprado', async () => {
    const { idRenglon } = await botonPorTallaComprado(ordenA);
    const r = await editarRenglonReceta(
      sesion(),
      ordenA,
      'avio',
      idRenglon,
      { tallas: [{ idTalla: tallaCH.id, consumo: 0.25 }] },
      bd(),
    );
    expect(
      r.avios.find((a) => a.idAvio === avioBoton.id)?.tallas.find((t) => t.idTalla === tallaCH.id)
        ?.consumo,
    ).toBe(0.25);
  });

  it('⭐ EL ESPEJO: un avío con consumo 0 pero MEDIDAS > 0 sí queda protegido al quitarlo', async () => {
    // El criterio viejo (`consumoPorPrenda > 0`) lo daba por FUERA de la compra y lo dejaba quitar
    // aunque estuviera comprado. Con el requerido real, la orden sí pide 10 piezas de botón.
    const { idRenglon } = await botonPorTallaComprado(ordenA, 0);
    await expect(
      quitarRenglonReceta(sesion(), ordenA, 'avio', idRenglon, { motivo: 'ya no va' }, bd()),
    ).rejects.toThrow(/BOT-01/);
  });

  it('⭐ apagar el TOGGLE por talla también se bloquea si deja el requerido en cero', async () => {
    // Con consumo por prenda 0 y medidas > 0, apagar el toggle manda el requerido a 0×piezas = 0.
    const { idRenglon } = await botonPorTallaComprado(ordenA, 0);
    await expect(
      editarRenglonReceta(sesion(), ordenA, 'avio', idRenglon, { consumoPorTalla: false }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  /**
   * ⭐⭐ **§Post-F9.105 — EL CHOQUE ENTRE LA NORMALIZACIÓN Y ESTA GUARDA, DICHO CON LA VERDAD.**
   *
   * Desde §Post-F9.105 CUALQUIER guardado apaga el `consumoPorTalla` de un avío por medida, y eso
   * cambia el requerido. Si el `consumoPorPrenda` congelado fuera 0 y ese avío ya tuviera OC, el
   * guardado se topa con esta guarda… en un PATCH donde el usuario quizá sólo cambió el precio.
   *
   * 🔴 La guarda NO se relaja (sigue rechazando: hay dinero comprometido). Lo que cambia es el
   * MENSAJE: mandar a des-autorizar una OC que está perfectamente bien sería mandar a romper algo
   * para arreglar otra cosa. El error nombra la causa real y la salida —capturar el consumo por
   * prenda en el mismo guardado—, y esa salida FUNCIONA (se prueba abajo, no se promete).
   */
  it('⭐ §Post-F9.105: la normalización automática no se disfraza de "lo sacaste de la compra"', async () => {
    // Consumo por prenda 0 + medida por talla 1 en CH: hoy la orden pide 10 piezas.
    const { idRenglon } = await botonPorTallaComprado(ordenA, 0);
    // Y AHORA el avío pasa a comprarse POR MEDIDA — la historia real: la corrección de V1-E3g fue
    // prospectiva y nunca re-normalizó las OP ya nacidas.
    await cliente.avio.update({ where: { id: avioBoton.id }, data: { unidadMedida: 'cm' } });
    await cliente.avioMedida.create({
      data: { idAvio: avioBoton.id, medida: '53 cm', valor: 53, precio: 6 },
    });

    const error = await editarRenglonReceta(
      sesion(),
      ordenA,
      'avio',
      idRenglon,
      { precio: 9 },
      bd(),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorConflicto);
    // Dice la causa REAL y la salida; NO manda a des-autorizar la OC (que está bien).
    expect((error as Error).message).toMatch(/consumo por prenda/i);
    expect((error as Error).message).not.toMatch(/DES-AUTORIZAR/);

    // Y la salida que promete el mensaje de verdad funciona: en el MISMO guardado.
    const r = await editarRenglonReceta(
      sesion(),
      ordenA,
      'avio',
      idRenglon,
      { precio: 9, consumoPorPrenda: 1 },
      bd(),
    );
    const boton = r.avios.find((a) => a.idAvio === avioBoton.id)!;
    expect(boton.consumoPorTalla).toBe(false);
    expect(boton.consumoPorPrenda).toBe(1);
    expect(boton.precio).toBe(9);
  });

  it('⭐ §Post-F9.105: con consumo por prenda > 0 la normalización NO topa con la guarda', async () => {
    // El caso normal (el cierre lleva 1 pza por prenda): al normalizar el requerido baja de 10 a
    // 10… pero NUNCA a cero, así que no hay nada que bloquear. Guardar el precio simplemente
    // funciona y de paso arregla la orden.
    const { idRenglon } = await botonPorTallaComprado(ordenA, 1);
    await cliente.avio.update({ where: { id: avioBoton.id }, data: { unidadMedida: 'cm' } });
    await cliente.avioMedida.create({
      data: { idAvio: avioBoton.id, medida: '53 cm', valor: 53, precio: 6 },
    });

    const r = await editarRenglonReceta(sesion(), ordenA, 'avio', idRenglon, { precio: 4 }, bd());
    expect(r.avios.find((a) => a.idAvio === avioBoton.id)?.consumoPorTalla).toBe(false);
  });

  it('RESTAURAR un avío por talla se bloquea si el modelo lo dejaría sin requerido', async () => {
    const { idRenglon } = await botonPorTallaComprado(ordenA);
    // El modelo pasa a por-talla con la medida de CH en 0: restaurar copiaría eso y vaciaría la
    // compra — la tercera puerta, entrada desde el modelo.
    await cliente.modeloAvio.update({
      where: { idModelo_idAvio: { idModelo, idAvio: avioBoton.id } },
      data: { consumoPorTalla: true, consumoPorPrenda: 0 },
    });
    await cliente.modeloAvioTalla.create({
      data: { idModelo, idAvio: avioBoton.id, idTalla: tallaCH.id, consumo: 0 },
    });
    await expect(
      restaurarRenglonReceta(sesion(), ordenA, 'avio', idRenglon, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('un renglón que YA estaba fuera se puede seguir tocando (no se atrapa a nadie)', async () => {
    // El material se apagó ANTES de comprarse: no cuenta para la compra, así que la puerta no le
    // aplica. Si aplicara, un dato viejo quedaría congelado para siempre sin salida.
    await marcarRecetaRevisada(sesion(), ordenA, bd());
    await liberarTodo(ordenA);
    const idRenglon = await renglonJareta(ordenA);
    await editarRenglonReceta(sesion(), ordenA, 'avio', idRenglon, { paraProduccion: false }, bd());
    // Editar re-cierra el renglón (V1-E3h): hay que volver a firmarlo para poder ligarle una OC.
    await marcarRecetaRevisada(sesion(), ordenA, bd());
    await liberarTodo(ordenA);
    const idOc = await ocDe(ordenA, { idAvio: avioJareta.id });
    await autorizarOC(sesionCompras(['compras.autorizar']), idOc, bd());
    const r = await quitarRenglonReceta(
      sesion(),
      ordenA,
      'avio',
      idRenglon,
      { motivo: 'limpieza' },
      bd(),
    );
    expect(r.avios.find((a) => a.idAvio === avioJareta.id)?.excluido).toBe(true);
  });
});
