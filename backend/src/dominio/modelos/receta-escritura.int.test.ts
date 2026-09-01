/**
 * ⭐⭐ V1-E9b pieza B — **LA RECETA COMPARTIDA, LADO ESCRITURA**: pruebas de CONDUCTA contra
 * Postgres efímero.
 *
 * Su gemela de LECTURA (`receta-compartida.int.test.ts`) demuestra que el hijo VE la receta de su
 * padre. Ésta demuestra lo contrario y complementario: que **no la TOCA**.
 *
 * 🔴 **Qué se estaba entregando sin esto.** Trece puertas escribían `where: { idModelo }` con el id
 * del modelo que el usuario tuviera abierto. Sobre un hijo del linaje 1:N eso significaba dos cosas,
 * las dos malas y ninguna ruidosa:
 *
 *  • **Las que escriben igual** (guardar telas, guardar avíos, aceptar favoritos, agregar arte,
 *    copiar receta): dejaban filas en el HIJO que su propia ficha **no enseña** —ella lee la del
 *    padre—, así que el usuario ve *«guardado»* y la pantalla no cambia. Y `copiarBom` con
 *    `reemplazar: true` (el DEFAULT) primero **borraba** y luego copiaba de un origen vacío: la
 *    receta desaparecía con un HTTP 200.
 *  • **Las que daban 404** (editar/borrar/reordenar arte, sus fotos, las medidas por talla): un
 *    *"no se encontró"* sobre un renglón que la ficha **acababa de pintar**.
 *
 * ⚠️ **Por eso ninguna aserción de aquí se conforma con «lanza».** Casi todas lanzaban ya —con el
 * error equivocado—, así que exigir sólo `rejects.toThrow()` habría pasado en verde sobre el
 * defecto. Se exige `ErrorValidacion` **y** que el mensaje mande al modelo de desarrollo.
 *
 * ⚠️ Y cada puerta se prueba en las DOS direcciones: bloqueada sobre el hijo **y abierta sobre un
 * modelo normal**. Una guarda que bloquea a todo el mundo también pasaría la mitad de las pruebas.
 *
 * Corre en CI (NUNCA Docker local, regla §7 de CLAUDE.md).
 */
// Credenciales R2 FALSAS: `solicitarSubidaFotoArte` construye el servicio de archivos en su
// parámetro por defecto (al ser llamada), y en los casos BLOQUEADOS no se le inyecta el fake.
process.env.R2_ACCOUNT_ID ??= 'cuenta-fake';
process.env.R2_ACCESS_KEY_ID ??= 'llave-fake';
process.env.R2_SECRET_ACCESS_KEY ??= 'secreto-fake';
process.env.R2_BUCKET ??= 'control-v2-prueba';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ServicioArchivos } from '../../comun/archivos.js';
import { ErrorValidacion } from '../../comun/errores.js';
import { enTransaccion } from '../../comun/transaccion.js';
import type { ClavePermiso } from '../../contrato/index.js';
import type { Avio, Empresa, PrismaClient, Talla, Tela } from '../../datos/index.js';
import {
  clientePruebas,
  crearEmpresaPrueba,
  crearTipoArtePrueba,
  limpiarBaseDatos,
} from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

import {
  copiarArteDeOtroModelo,
  crearArte,
  actualizarArte,
  eliminarArte,
  marcarArtePrincipal,
  quitarFotoArte,
  solicitarSubidaFotoArte,
} from './arte-modelo.js';
import { aceptarAviosFavoritos } from './avios-favoritos.js';
import { copiarBom, leerBom, reemplazarAviosBom, reemplazarTelasBom } from './bom-modelo.js';
import { guardarMedidasAvio } from './medidas-avio-talla.js';
import { tocarModeloPorCambioDeReceta } from './revision-modelo.js';
import { copiarRecetaAModeloNuevo, crearVersionDeModelo } from './versiones.js';

let cliente: PrismaClient;
let empresa: Empresa;
let idTipoArte: number;
let telaFelpa: Tela;
let telaRib: Tela;
let avioEtiqueta: Avio;
let avioCierre: Avio;
let tallaCH: Talla;
let tallaG: Talla;

/** El modelo de DESARROLLO: el ÚNICO del trío que tiene receta. */
let idPadre: number;
/** El modelo de PRODUCCIÓN que la comparte (el "color café" de la frase de Daniel). */
let idHijo: number;
/** Un modelo de producción SIN padre, con receta propia: la no-regresión. */
let idSuelto: number;
/** El renglón de arte del padre (y por lo tanto el que la ficha del hijo enseña). */
let idArtePadre: number;

const PERM: ClavePermiso[] = [
  'modelos.ver',
  'modelos.administrar',
  'modelos.aprobar-receta',
  'consultas.ver-importes',
];
const sesion = () => sesionDePrueba({ idEmpresaActiva: empresa.id, permisos: PERM });
const bd = () => ({ cliente });

/** Fake del servicio de archivos (no toca R2, pero sí crea el `Archivo` en la transacción). */
function archivosFalsos(): ServicioArchivos {
  return {
    async solicitarSubida(tx, sesionSubida, solicitud) {
      const archivo = await tx.archivo.create({
        data: {
          bucket: 'control-v2-prueba',
          key: `fake/${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
          nombreOriginal: solicitud.nombreOriginal,
          tipoMime: solicitud.tipoMime,
          tamanoBytes: solicitud.tamanoBytes,
          subidoPorId: sesionSubida.id,
        },
        select: {
          id: true,
          bucket: true,
          key: true,
          nombreOriginal: true,
          tipoMime: true,
          tamanoBytes: true,
        },
      });
      return { archivo, urlSubida: 'https://r2.fake/put', expiraEnSegundos: 900 };
    },
    subirContenido() {
      throw new Error('Este flujo usa solicitarSubida (presigned).');
    },
    urlDescarga(key) {
      return Promise.resolve(`https://r2.fake/get/${key}`);
    },
    descargarContenido() {
      return Promise.resolve(Buffer.from('x', 'utf8'));
    },
    eliminarObjeto() {
      return Promise.resolve();
    },
  };
}

/**
 * ⭐ LA ASERCIÓN DE LA ETAPA, en un solo sitio. No basta con que la puerta LANCE: casi todas
 * lanzaban ya —un 404 sobre un renglón que la ficha acababa de enseñar— y una prueba que sólo
 * exigiera `toThrow()` habría certificado el defecto. Se exige el error de VALIDACIÓN y que el
 * mensaje mande al modelo de desarrollo, que es la salida que Daniel dio (§Post-F9.135 p.5).
 */
async function esperarBloqueoPorRecetaCompartida(accion: Promise<unknown>): Promise<void> {
  await expect(accion).rejects.toThrow(ErrorValidacion);
  await expect(accion).rejects.toThrow(/modelo de desarrollo/i);
  await expect(accion).rejects.toThrow(/CYA-26-71-001/);
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
  idTipoArte = await crearTipoArtePrueba(cliente);
  telaFelpa = await cliente.tela.create({ data: { nombre: 'Felpa', precioSugerido: 10 } });
  telaRib = await cliente.tela.create({ data: { nombre: 'Rib', precioSugerido: 4 } });
  avioEtiqueta = await cliente.avio.create({
    data: { clave: 'ETQ-01', descripcion: 'Etiqueta', unidad: 'pza', precioReferencia: 5 },
  });
  avioCierre = await cliente.avio.create({
    data: { clave: 'CIE-01', descripcion: 'Cierre', unidad: 'pza', precioReferencia: 12 },
  });
  tallaCH = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });
  tallaG = await cliente.talla.create({ data: { etiqueta: 'G', orden: 2 } });
  // Los dos dígitos de la nomenclatura: `mintearVersionDeModelo` los exige para poder darle a la
  // versión su número de producción (V1-E8j · R4-H1). Sin ellos, el caso POSITIVO de versionar
  // rebotaría por una razón que no tiene nada que ver con esta etapa.
  const pantalon = await cliente.tipoProducto.create({
    data: { nombre: 'Pantalón', digitoConcepto: 7 },
  });
  const caballero = await cliente.genero.create({
    data: { nombre: 'Caballero', digitoNomenclatura: 1 },
  });

  const padre = await cliente.modelo.create({
    data: {
      codigo: 'CYA-26-71-001',
      codigoDesarrollo: 'CYA-26-71-001',
      origen: 'desarrollo',
      maquilaBase: 20,
      idTipoProducto: pantalon.id,
      idGenero: caballero.id,
      telas: { create: [{ idTela: telaFelpa.id, consumoPorPrenda: 2 }] },
      avios: {
        create: [
          {
            idAvio: avioEtiqueta.id,
            consumoPorPrenda: 1,
            consumoPorTalla: true,
            tallas: { create: [{ idTalla: tallaCH.id, consumo: 2 }] },
          },
        ],
      },
      artes: { create: [{ descripcion: 'Bordado pecho', idTipoArte, precio: 7, orden: 0 }] },
    },
    select: { id: true },
  });
  idPadre = padre.id;
  idArtePadre = (
    await cliente.modeloArte.findFirstOrThrow({
      where: { idModelo: idPadre },
      select: { id: true },
    })
  ).id;

  idHijo = (
    await cliente.modelo.create({
      data: { codigo: '71001', origen: 'produccion', idModeloDesarrollo: idPadre, maquilaBase: 20 },
      select: { id: true },
    })
  ).id;

  idSuelto = (
    await cliente.modelo.create({
      data: {
        codigo: '71999',
        origen: 'produccion',
        maquilaBase: 3,
        telas: { create: [{ idTela: telaRib.id, consumoPorPrenda: 1 }] },
      },
      select: { id: true },
    })
  ).id;
});

// ── 1. LAS DOCE PUERTAS, BLOQUEADAS SOBRE EL HIJO ─────────────────────────────────────────────

describe('⭐⭐ las puertas de la receta se BLOQUEAN sobre un modelo hijo del linaje 1:N', () => {
  it('reemplazarTelasBom', async () => {
    await esperarBloqueoPorRecetaCompartida(
      reemplazarTelasBom(sesion(), idHijo, [{ idTela: telaRib.id, consumoPorPrenda: 9 }], bd()),
    );
  });

  it('reemplazarAviosBom', async () => {
    await esperarBloqueoPorRecetaCompartida(
      reemplazarAviosBom(sesion(), idHijo, [{ idAvio: avioCierre.id, consumoPorPrenda: 1 }], bd()),
    );
  });

  it('🔴 copiarBom con el HIJO de DESTINO — la más destructiva de las trece', async () => {
    await esperarBloqueoPorRecetaCompartida(
      copiarBom(sesion(), idHijo, { idOrigen: idSuelto, reemplazar: true }, bd()),
    );
  });

  it('aceptarAviosFavoritos', async () => {
    await cliente.avio.update({
      where: { id: avioCierre.id },
      data: { favorito: true, cantFav: 1 },
    });
    await esperarBloqueoPorRecetaCompartida(aceptarAviosFavoritos(sesion(), idHijo, bd()));
  });

  it('guardarMedidasAvio', async () => {
    await esperarBloqueoPorRecetaCompartida(
      guardarMedidasAvio(
        sesion(),
        idHijo,
        avioEtiqueta.id,
        { consumoPorTalla: true, tallas: [{ idTalla: tallaCH.id, consumo: 5 }] },
        bd(),
      ),
    );
  });

  it('crearArte', async () => {
    await esperarBloqueoPorRecetaCompartida(
      crearArte(sesion(), idHijo, { descripcion: 'Logo nuevo', idTipoArte }, bd()),
    );
  });

  it('actualizarArte (sobre el arte HEREDADO que su ficha le enseña)', async () => {
    await esperarBloqueoPorRecetaCompartida(
      actualizarArte(sesion(), idHijo, { id: idArtePadre, descripcion: 'Otro' }, bd()),
    );
  });

  it('eliminarArte', async () => {
    await esperarBloqueoPorRecetaCompartida(eliminarArte(sesion(), idHijo, idArtePadre, bd()));
  });

  it('marcarArtePrincipal', async () => {
    await esperarBloqueoPorRecetaCompartida(
      marcarArtePrincipal(sesion(), idHijo, idArtePadre, bd()),
    );
  });

  it('copiarArteDeOtroModelo', async () => {
    const arteSuelto = await crearArte(
      sesion(),
      idSuelto,
      { descripcion: 'Otro', idTipoArte },
      bd(),
    );
    await esperarBloqueoPorRecetaCompartida(
      copiarArteDeOtroModelo(sesion(), idHijo, { idArteOrigen: arteSuelto.id }, bd()),
    );
  });

  it('solicitarSubidaFotoArte', async () => {
    await esperarBloqueoPorRecetaCompartida(
      solicitarSubidaFotoArte(
        sesion(),
        idHijo,
        idArtePadre,
        { nombreOriginal: 'a.png', tipoMime: 'image/png', tamanoBytes: 10 },
        bd(),
        archivosFalsos(),
      ),
    );
  });

  it('quitarFotoArte', async () => {
    const subida = await solicitarSubidaFotoArte(
      sesion(),
      idPadre,
      idArtePadre,
      { nombreOriginal: 'a.png', tipoMime: 'image/png', tamanoBytes: 10 },
      bd(),
      archivosFalsos(),
    );
    await esperarBloqueoPorRecetaCompartida(
      quitarFotoArte(sesion(), idHijo, idArtePadre, subida.idFoto, bd()),
    );
  });

  /**
   * ⭐⭐ LAS DOCE, EN UNA SOLA TRANSACCIÓN DE PRUEBA — y la razón de que esto exista es una
   * CICATRIZ de esta misma etapa.
   *
   * 🔴 La primera versión ponía los dos conteos de abajo en `it`s SUELTOS, después de los doce de
   * arriba, con un comentario que decía *«la contraparte que las doce no pueden dar por sí solas»*.
   * **Era falso, y de la peor manera:** el `beforeEach` hace `limpiarBaseDatos` (`TRUNCATE …
   * CASCADE`) antes de CADA `it`, así que cuando esos dos corrían **las doce llamadas ya no
   * existían** — el hijo se acababa de crear vacío y la receta del padre, de sembrar. Las dos
   * aserciones eran verdaderas **por construcción del fixture** y pasaban con las doce guardas
   * borradas. Una prueba que pasa por lo que dice su comentario: exactamente la clase que esta
   * etapa vino a matar, dentro de las pruebas de esta etapa.
   *
   * Por eso los intentos y los conteos viven ahora en el MISMO `it`: se lanzan las doce contra el
   * hijo, se traga cada rechazo, y sólo después se cuenta. Devuelve los nombres de las que NO
   * rechazaron, para que el fallo diga cuál se abrió.
   */
  async function lasDocePuertasContraElHijo(): Promise<string[]> {
    await cliente.avio.update({
      where: { id: avioCierre.id },
      data: { favorito: true, cantFav: 1 },
    });
    const arteSuelto = await crearArte(
      sesion(),
      idSuelto,
      { descripcion: 'De otro modelo', idTipoArte },
      bd(),
    );
    const subida = await solicitarSubidaFotoArte(
      sesion(),
      idPadre,
      idArtePadre,
      { nombreOriginal: 'a.png', tipoMime: 'image/png', tamanoBytes: 10 },
      bd(),
      archivosFalsos(),
    );

    const puertas: { nombre: string; ejecutar: () => Promise<unknown> }[] = [
      {
        nombre: 'reemplazarTelasBom',
        ejecutar: () =>
          reemplazarTelasBom(sesion(), idHijo, [{ idTela: telaRib.id, consumoPorPrenda: 9 }], bd()),
      },
      {
        nombre: 'reemplazarAviosBom',
        ejecutar: () =>
          reemplazarAviosBom(
            sesion(),
            idHijo,
            [{ idAvio: avioCierre.id, consumoPorPrenda: 1 }],
            bd(),
          ),
      },
      {
        nombre: 'copiarBom',
        ejecutar: () => copiarBom(sesion(), idHijo, { idOrigen: idSuelto, reemplazar: true }, bd()),
      },
      {
        nombre: 'aceptarAviosFavoritos',
        ejecutar: () => aceptarAviosFavoritos(sesion(), idHijo, bd()),
      },
      {
        nombre: 'guardarMedidasAvio',
        ejecutar: () =>
          guardarMedidasAvio(
            sesion(),
            idHijo,
            avioEtiqueta.id,
            { consumoPorTalla: true, tallas: [{ idTalla: tallaCH.id, consumo: 5 }] },
            bd(),
          ),
      },
      {
        nombre: 'crearArte',
        ejecutar: () =>
          crearArte(sesion(), idHijo, { descripcion: 'Logo nuevo', idTipoArte }, bd()),
      },
      {
        nombre: 'actualizarArte',
        ejecutar: () =>
          actualizarArte(sesion(), idHijo, { id: idArtePadre, descripcion: 'Otro' }, bd()),
      },
      { nombre: 'eliminarArte', ejecutar: () => eliminarArte(sesion(), idHijo, idArtePadre, bd()) },
      {
        nombre: 'marcarArtePrincipal',
        ejecutar: () => marcarArtePrincipal(sesion(), idHijo, idArtePadre, bd()),
      },
      {
        nombre: 'copiarArteDeOtroModelo',
        ejecutar: () =>
          copiarArteDeOtroModelo(sesion(), idHijo, { idArteOrigen: arteSuelto.id }, bd()),
      },
      {
        nombre: 'solicitarSubidaFotoArte',
        ejecutar: () =>
          solicitarSubidaFotoArte(
            sesion(),
            idHijo,
            idArtePadre,
            { nombreOriginal: 'b.png', tipoMime: 'image/png', tamanoBytes: 10 },
            bd(),
            archivosFalsos(),
          ),
      },
      {
        nombre: 'quitarFotoArte',
        ejecutar: () => quitarFotoArte(sesion(), idHijo, idArtePadre, subida.idFoto, bd()),
      },
    ];

    // ⚠️ QUÉ CUBRE ESTE AGREGADO Y QUÉ NO, para que nadie lo lea de más. Sin las guardas, SEIS de
    // las doce escribirían de verdad (las de arriba: telas, avíos, copiar receta, favoritos, crear
    // arte y copiar arte) y son las que este `it` caza por conteo. Las otras seis rebotarían igual
    // con un **404** —el renglón no es del hijo—, así que no escriben y aquí no se distinguirían:
    // ésas las cazan los `it` de arriba, que exigen `ErrorValidacion` y NO un `ErrorNoEncontrado`.
    // Las dos mitades son necesarias; ninguna sustituye a la otra.
    //
    // EN SERIE, no en paralelo: `marcarArtePrincipal` toma un advisory lock y varias tocan las
    // mismas filas; en serie el resultado es determinista y el fallo, legible.
    const seAbrieron: string[] = [];
    for (const puerta of puertas) {
      const resultado = await puerta.ejecutar().then(
        () => 'pasó',
        () => 'rechazó',
      );
      if (resultado === 'pasó') seAbrieron.push(puerta.nombre);
    }
    return seAbrieron;
  }

  it('🔴 tras intentar LAS DOCE, el hijo no tiene ni una fila de receta', async () => {
    const seAbrieron = await lasDocePuertasContraElHijo();
    expect(seAbrieron, 'estas puertas NO rechazaron sobre un modelo hijo').toEqual([]);
    // Y el conteo, que es lo que ninguna de las doce aserciones de arriba puede dar: una guarda que
    // escribiera ANTES de lanzar (o en una transacción mal cerrada) las pasaría todas igual.
    expect(await cliente.modeloTela.count({ where: { idModelo: idHijo } })).toBe(0);
    expect(await cliente.modeloAvio.count({ where: { idModelo: idHijo } })).toBe(0);
    expect(await cliente.modeloArte.count({ where: { idModelo: idHijo } })).toBe(0);
    expect(await cliente.modeloAvioTalla.count({ where: { idModelo: idHijo } })).toBe(0);
  });

  it('🔴 tras intentar LAS DOCE, la receta del PADRE quedó intacta', async () => {
    // La otra mitad del defecto: si en vez de bloquear se hubiera RESUELTO, estas doce llamadas
    // habrían reescrito la receta del desarrollo — que es exactamente *«cambié un cierre sólo en la
    // café y se le cambió a los cuatro colores»*. Se cuenta DESPUÉS de intentarlas, no antes.
    //
    // ⭐⭐ Y ESTA MITAD SÍ ALCANZA A LAS DOCE, al revés que su hermana de arriba. El reparto
    // seis/seis de allá vale contra *«se quitó el bloqueo»*: las otras seis rebotarían con un 404
    // porque `exigirArte`, `exigirRenglonAvio`, `marcarArtePrincipal` y `quitarFotoArte` filtran
    // por el `idModelo` EN CRUDO. Pero contra el otro defecto —*«se resolvió en vez de bloquear»*—
    // esos mismos filtros pasarían a encontrar el renglón del PADRE, las seis escribirían **en él**,
    // los conteos del hijo seguirían clavados en 0 y sólo estas aserciones caerían. O sea: la red
    // contra la resolución indebida es ésta, y cubre LAS DOCE PUERTAS, no seis.
    const seAbrieron = await lasDocePuertasContraElHijo();
    expect(seAbrieron, 'estas puertas NO rechazaron sobre un modelo hijo').toEqual([]);

    const bom = await leerBom(cliente, idPadre, empresa.id);
    expect(bom.telas.map((t) => t.nombre)).toEqual(['Felpa']);
    expect(bom.avios.map((a) => a.clave)).toEqual(['ETQ-01']);
    expect(bom.artes.map((a) => a.descripcion)).toEqual(['Bordado pecho']);
    expect(await cliente.modeloAvioTalla.count({ where: { idModelo: idPadre } })).toBe(1);
    // La medida por talla sigue valiendo 2 (el intento del hijo la ponía en 5), y la foto que
    // `quitarFotoArte` intentó llevarse sigue colgando del arte del padre.
    const medida = await cliente.modeloAvioTalla.findFirstOrThrow({
      where: { idModelo: idPadre, idAvio: avioEtiqueta.id },
    });
    expect(medida.consumo.toNumber()).toBe(2);
    expect(await cliente.modeloArteFoto.count({ where: { idModeloArte: idArtePadre } })).toBe(1);
  });
});

// ── 2. LA OTRA DIRECCIÓN: sobre un modelo NORMAL las doce siguen abiertas ──────────────────────

describe('⭐ la guarda no bloquea a nadie más (no-regresión de las doce puertas)', () => {
  it('reemplazarTelasBom / reemplazarAviosBom sobre un modelo suelto siguen guardando', async () => {
    const telas = await reemplazarTelasBom(
      sesion(),
      idSuelto,
      [{ idTela: telaFelpa.id, consumoPorPrenda: 3 }],
      bd(),
    );
    expect(telas.map((t) => t.nombre)).toEqual(['Felpa']);
    const avios = await reemplazarAviosBom(
      sesion(),
      idSuelto,
      [{ idAvio: avioCierre.id, consumoPorPrenda: 2 }],
      bd(),
    );
    expect(avios.map((a) => a.clave)).toEqual(['CIE-01']);
  });

  it('el PADRE de desarrollo puede editar SU receta (es donde la etapa manda a editarla)', async () => {
    const telas = await reemplazarTelasBom(
      sesion(),
      idPadre,
      [
        { idTela: telaFelpa.id, consumoPorPrenda: 2 },
        { idTela: telaRib.id, consumoPorPrenda: 0.5 },
      ],
      bd(),
    );
    expect(telas.map((t) => t.nombre)).toEqual(['Felpa', 'Rib']);
    // Y el hijo lo ve al instante, sin copiar nada: la igualdad es ESTRUCTURAL.
    const bomHijo = await leerBom(cliente, idHijo, empresa.id);
    expect(bomHijo.telas.map((t) => t.nombre)).toEqual(['Felpa', 'Rib']);
  });

  it('el arte, las fotos, las medidas y los favoritos siguen funcionando en el padre', async () => {
    const arte = await crearArte(sesion(), idPadre, { descripcion: 'Segundo', idTipoArte }, bd());
    await actualizarArte(sesion(), idPadre, { id: arte.id, descripcion: 'Segundo bis' }, bd());
    await marcarArtePrincipal(sesion(), idPadre, arte.id, bd());
    const subida = await solicitarSubidaFotoArte(
      sesion(),
      idPadre,
      arte.id,
      { nombreOriginal: 'a.png', tipoMime: 'image/png', tamanoBytes: 10 },
      bd(),
      archivosFalsos(),
    );
    await quitarFotoArte(sesion(), idPadre, arte.id, subida.idFoto, bd());
    await eliminarArte(sesion(), idPadre, arte.id, bd());

    const medidas = await guardarMedidasAvio(
      sesion(),
      idPadre,
      avioEtiqueta.id,
      {
        consumoPorTalla: true,
        tallas: [
          { idTalla: tallaCH.id, consumo: 2 },
          { idTalla: tallaG.id, consumo: 4 },
        ],
      },
      bd(),
    );
    expect(medidas.tallas.map((t) => t.consumo)).toEqual([2, 4]);

    await cliente.avio.update({
      where: { id: avioCierre.id },
      data: { favorito: true, cantFav: 3 },
    });
    const aceptados = await aceptarAviosFavoritos(sesion(), idPadre, bd());
    expect(aceptados.agregados).toBe(1);
    expect(aceptados.clavesAgregadas).toEqual(['CIE-01']);
  });
});

// ── 3. 🔴 `copiarBom`: el DESTINO se bloquea, pero el ORIGEN se RESUELVE ──────────────────────

describe('🔴 copiarBom — copiar DESDE un hijo trae la receta de su padre, no vacío', () => {
  it('⭐ el destino recibe telas, avíos, MEDIDAS y arte (no una lista vacía)', async () => {
    // Sin resolver el origen, las cuatro lecturas traían 0 filas y —con `reemplazar: true`, que es
    // el DEFAULT del diálogo— la receta del destino se BORRABA y no entraba nada. HTTP 200.
    const bom = await copiarBom(sesion(), idSuelto, { idOrigen: idHijo, reemplazar: true }, bd());
    expect(bom.telas.map((t) => t.nombre)).toEqual(['Felpa']);
    expect(bom.avios.map((a) => a.clave)).toEqual(['ETQ-01']);
    expect(bom.artes.map((a) => a.descripcion)).toEqual(['Bordado pecho']);
    // Las medidas por talla (R18) viajan con el avío: sin ellas el destino queda con el toggle
    // encendido y la matriz vacía, y el requerido del MRP se mueve en silencio.
    const medidas = await cliente.modeloAvioTalla.findMany({ where: { idModelo: idSuelto } });
    expect(medidas.map((m) => m.consumo.toNumber())).toEqual([2]);
  });

  it('🔴 NO deja el destino vacío: la aserción escrita al revés', async () => {
    const bom = await copiarBom(sesion(), idSuelto, { idOrigen: idHijo, reemplazar: true }, bd());
    expect(bom.telas).not.toHaveLength(0);
    expect(bom.avios).not.toHaveLength(0);
    expect(bom.artes).not.toHaveLength(0);
  });

  it('deja rastro en la bitácora de que la receta salió de OTRO modelo (A7/D3)', async () => {
    await copiarBom(sesion(), idSuelto, { idOrigen: idHijo, reemplazar: true }, bd());
    const renglon = await cliente.bitacora.findFirstOrThrow({
      where: { entidad: 'Modelo', idEntidad: String(idSuelto) },
      orderBy: { id: 'desc' },
    });
    expect(renglon.datos).toMatchObject({
      idOrigen: idHijo,
      idModeloDeLaRecetaOrigen: idPadre,
    });
  });

  it('⭐ rechaza copiar entre dos modelos que COMPARTEN la receta (padre ← hijo)', async () => {
    // Los ids son distintos, así que la guarda literal no lo ve; la receta es la MISMA, así que
    // copiarla con reemplazo la borraría y la volvería a poner sobre sí misma.
    await expect(
      copiarBom(sesion(), idPadre, { idOrigen: idHijo, reemplazar: true }, bd()),
    ).rejects.toThrow(/COMPARTEN la misma receta/);
    // Y la receta del padre sigue ahí, entera.
    expect(await cliente.modeloTela.count({ where: { idModelo: idPadre } })).toBe(1);
    expect(await cliente.modeloArte.count({ where: { idModelo: idPadre } })).toBe(1);
  });

  it('el mismo id de los dos lados sigue dando su mensaje de siempre (no-regresión)', async () => {
    await expect(
      copiarBom(sesion(), idSuelto, { idOrigen: idSuelto, reemplazar: true }, bd()),
    ).rejects.toThrow(/no pueden ser el mismo/);
  });

  it('copiar entre dos modelos SIN linaje sigue funcionando igual (no-regresión)', async () => {
    const otro = await cliente.modelo.create({ data: { codigo: '71888' }, select: { id: true } });
    const bom = await copiarBom(sesion(), otro.id, { idOrigen: idSuelto, reemplazar: true }, bd());
    expect(bom.telas.map((t) => t.nombre)).toEqual(['Rib']);
  });
});

// ── 4. ⭐ LA MARCA DE AGUA: la única escritura que SÍ resuelve ────────────────────────────────

describe('⭐ tocarModeloPorCambioDeReceta — la marca de agua se sella en el DUEÑO de la receta', () => {
  /** Sella la marca "desde" el modelo dado, como haría una puerta futura. */
  async function tocarDesde(idModelo: number): Promise<void> {
    await enTransaccion(
      (tx) => tocarModeloPorCambioDeReceta(tx, sesion(), idModelo, 'telas'),
      bd(),
    );
  }

  it('🔴 tocando desde el HIJO, la marca cae en el PADRE (si cayera en el hijo, el aviso no sale)', async () => {
    // El único lector de la marca es `avisoDeCostoViejo`, y llega por el PADRE (el renglón de la
    // lista cuelga de un `Desarrollo`). Sellada en el hijo, el aviso «la receta cambió después de
    // congelarse el costo» NUNCA sale y la cotización sigue con el precio viejo, sin alarma.
    await tocarDesde(idHijo);
    const padre = await cliente.modelo.findUniqueOrThrow({ where: { id: idPadre } });
    const hijo = await cliente.modelo.findUniqueOrThrow({ where: { id: idHijo } });
    expect(padre.recetaTocadaEn).not.toBeNull();
    expect(padre.recetaTocadaCambio).toBe('telas');
    expect(hijo.recetaTocadaEn).toBeNull();
    expect(hijo.recetaTocadaCambio).toBeNull();
  });

  it('🔴 y la FIRMA que se tumba es la del padre — la RAMA GEMELA de la de arriba', async () => {
    // `tocarModeloPorCambioDeReceta` hace DOS cosas con el mismo id: invalida la revisión y sella
    // la marca. Son ramas gemelas: resolver una y no la otra deja la mitad del defecto en pie, y
    // la prueba de arriba pasaría igual. Por eso ésta va aparte.
    await cliente.modelo.update({
      where: { id: idPadre },
      data: { revisionEstado: 'aprobada', revisadoEn: new Date(), revisionNota: 'ok' },
    });
    await tocarDesde(idHijo);
    const padre = await cliente.modelo.findUniqueOrThrow({ where: { id: idPadre } });
    expect(padre.revisionEstado).toBe('pendiente');
    expect(padre.revisadoEn).toBeNull();
    expect(padre.revisionNota).toMatch(/INVALIDÓ/);
  });

  it('un modelo SIN padre sigue sellándose a sí mismo (no-regresión)', async () => {
    await tocarDesde(idSuelto);
    const suelto = await cliente.modelo.findUniqueOrThrow({ where: { id: idSuelto } });
    expect(suelto.recetaTocadaCambio).toBe('telas');
  });
});

// ── 5. 🔴🔴 LA PUERTA QUE NO ESTABA EN NINGUNA LISTA ─────────────────────────────────────────

describe('🔴🔴 copiarRecetaAModeloNuevo — copiar un HIJO no puede dar un modelo con receta vacía', () => {
  /** Un modelo recién nacido y vacío, como el que crean los dos llamadores. */
  async function modeloVacio(codigo: string): Promise<number> {
    return (await cliente.modelo.create({ data: { codigo }, select: { id: true } })).id;
  }

  it('⭐⭐ desde un hijo copia la receta de su DESARROLLO, entera', async () => {
    // Ésta es la puerta que ninguna lista del plan nombraba: `desarrollo/modelo-en-la-mesa.ts`
    // llama aquí DIRECTO con el modelo que el usuario eligió en la cita, y `leerModeloOrigen`
    // acepta cualquier modelo activo. Sin resolver, el modelo nuevo nacía con la receta VACÍA y
    // precosteaba sólo con maquila y corte: el precio que se le dice al cliente en la cara.
    const idNuevo = await modeloVacio('NUEVO-1');
    const resumen = await enTransaccion(
      (tx) => copiarRecetaAModeloNuevo(tx, sesion(), idHijo, idNuevo),
      bd(),
    );
    expect(resumen).toEqual({ telas: 1, avios: 1, medidas: 1, artes: 1 });
    const bom = await leerBom(cliente, idNuevo, empresa.id);
    expect(bom.telas.map((t) => t.nombre)).toEqual(['Felpa']);
    expect(bom.artes.map((a) => a.descripcion)).toEqual(['Bordado pecho']);
  });

  it('🔴 la aserción escrita al revés: NO nace vacío', async () => {
    const idNuevo = await modeloVacio('NUEVO-2');
    const resumen = await enTransaccion(
      (tx) => copiarRecetaAModeloNuevo(tx, sesion(), idHijo, idNuevo),
      bd(),
    );
    expect(resumen.telas).not.toBe(0);
    expect(resumen.avios).not.toBe(0);
    expect(resumen.artes).not.toBe(0);
    expect(resumen.medidas).not.toBe(0);
  });

  it('el DESTINO se queda con la copia y el origen no se toca (la copia es de verdad)', async () => {
    const idNuevo = await modeloVacio('NUEVO-3');
    await enTransaccion((tx) => copiarRecetaAModeloNuevo(tx, sesion(), idHijo, idNuevo), bd());
    // Filas PROPIAS del nuevo: si "heredara" apuntando, el 1:N se habría colado donde no toca.
    expect(await cliente.modeloTela.count({ where: { idModelo: idNuevo } })).toBe(1);
    expect(await cliente.modeloTela.count({ where: { idModelo: idPadre } })).toBe(1);
    expect(await cliente.modeloTela.count({ where: { idModelo: idHijo } })).toBe(0);
  });

  it('desde un modelo normal copia LO SUYO (no-regresión)', async () => {
    const idNuevo = await modeloVacio('NUEVO-4');
    const resumen = await enTransaccion(
      (tx) => copiarRecetaAModeloNuevo(tx, sesion(), idSuelto, idNuevo),
      bd(),
    );
    expect(resumen.telas).toBe(1);
    const bom = await leerBom(cliente, idNuevo, empresa.id);
    expect(bom.telas.map((t) => t.nombre)).toEqual(['Rib']);
  });
});

// ── 6. VERSIONAR: la invariante que colgaba de una guarda ajena ───────────────────────────────

describe('crearVersionDeModelo — un hijo del 1:N no se versiona, y lo dice por su nombre', () => {
  it('⭐ rechaza con SU PROPIO mensaje, no con el del "modelo sin nº de desarrollo"', async () => {
    // Hasta esta pieza lo cerraba de refilón la guarda de `codigoDesarrollo === null`, que existe
    // por otra razón y cuyo propio comentario dice que puede aflojarse el día que Daniel decida
    // versionar modelos de producción. Dos invariantes en el mismo `if` es como se pierde una.
    const error = await crearVersionDeModelo(sesion(), idHijo, {}, bd()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorValidacion);
    expect((error as Error).message).toContain('COMPARTE su receta');
    // 🔑 Y la mitad que de verdad demuestra el arreglo: NO es el mensaje de la otra guarda. Sin
    // esta línea, borrar la guarda nueva dejaría la prueba en verde por el rebote de la vieja.
    expect((error as Error).message).not.toContain('número de DESARROLLO');
  });

  it('un modelo migrado (sin nº de desarrollo) sigue dando SU mensaje (no-regresión)', async () => {
    await expect(crearVersionDeModelo(sesion(), idSuelto, {}, bd())).rejects.toThrow(
      /número de DESARROLLO/,
    );
  });

  it('el modelo de desarrollo se sigue versionando igual (no-regresión)', async () => {
    const version = await crearVersionDeModelo(sesion(), idPadre, {}, bd());
    expect(version.codigo).toBe('CYA-26-71-001-01');
    // Y su receta llegó COPIADA (la versión se lleva una copia congelada, no comparte).
    expect(await cliente.modeloTela.count({ where: { idModelo: version.id } })).toBe(1);
  });
});
