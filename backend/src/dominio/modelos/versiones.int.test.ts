/**
 * ⭐ V1-E7b — La VERSIÓN de un modelo nace con SUFIJO (§Post-F9.110), contra Postgres real.
 *
 * Aquí vive lo que sólo la base puede demostrar (las reglas puras y el orden de las llamadas se
 * fijan sin base en `versiones.test.ts`):
 *
 *  (a) la numeración PLANA de verdad: versionar un `-01` produce un `-02` y el catálogo queda con
 *      tres modelos hermanos, no con uno anidado;
 *  (b) que la receta llega COPIADA al hijo —telas, avíos, medidas por talla y arte— y que tocar la
 *      del hijo NO mueve la del padre (copia congelada, no referencia);
 *  (c) que el PADRE queda idéntico, campo por campo, después de versionarlo;
 *  (d) que el advisory lock SERIALIZA dos versionados simultáneos del mismo padre: con él salen
 *      `-01` y `-02`; el escenario sin lock es el que producía dos `-01`;
 *  (e) que una colisión de MAYÚSCULAS se absorbe (se avanza de sufijo) en vez de reventar la
 *      transacción contra el `@unique`;
 *  (f) el rechazo del modelo sin código de desarrollo y el candado del permiso.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import type { ClavePermiso } from '../../contrato/index.js';
import type { Empresa, PrismaClient } from '../../datos/index.js';
import {
  clientePruebas,
  crearEmpresaPrueba,
  crearTipoArtePrueba,
  limpiarBaseDatos,
} from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

import { crearArte } from './arte-modelo.js';
import { aceptarAviosFavoritos } from './avios-favoritos.js';
import { copiarBom, reemplazarAviosBom, reemplazarTelasBom } from './bom-modelo.js';
import { guardarMedidasAvio } from './medidas-avio-talla.js';
import { pasarModeloAProduccion } from './modelos.js';
import { aprobarRevisionModelo, rechazarRevisionModelo } from './revision-modelo.js';
import { crearVersionDeModelo } from './versiones.js';

// El listado/ficha construye el servicio de archivos aunque no haya fotos.
process.env.R2_ACCOUNT_ID ??= 'cuenta-fake';
process.env.R2_ACCESS_KEY_ID ??= 'llave-fake';
process.env.R2_SECRET_ACCESS_KEY ??= 'secreto-fake';
process.env.R2_BUCKET ??= 'control-v2-prueba';

let cliente: PrismaClient;
let empresa: Empresa;

const PERM: ClavePermiso[] = ['modelos.ver', 'modelos.aprobar-receta'];

function sesion(permisos: ClavePermiso[] = PERM): SesionUsuario {
  return sesionDePrueba({ idEmpresaActiva: empresa.id, permisos });
}
const bd = () => ({ cliente });

let pantalon: { id: number };
let caballero: { id: number };

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  empresa = await crearEmpresaPrueba(cliente);
  // ⭐ V1-E8j·R4-H1 — los DOS DÍGITOS del padre. Un modelo de desarrollo REAL siempre los tiene (su
  // alta los exige desde §Post-F9.134), y la versión los HEREDA: sin ellos la hija nacería sin poder
  // recibir su número, y `mintearVersionDeModelo` lo rechaza. Se siembran con dígito de verdad
  // —Pantalón 7 + Caballero 1— en vez de aflojar la regla: el fixture tenía que parecerse al mundo.
  pantalon = await cliente.tipoProducto.create({
    data: { nombre: 'Pantalón', digitoConcepto: 7 },
  });
  caballero = await cliente.genero.create({
    data: { nombre: 'Caballero', digitoNomenclatura: 1 },
  });
});

/** Un modelo de DESARROLLO con su código armado (como lo deja el minteo de V1-E3n). */
async function crearDesarrollo(codigo: string, extra: Record<string, unknown> = {}) {
  return cliente.modelo.create({
    data: {
      codigo,
      codigoDesarrollo: codigo,
      origen: 'desarrollo',
      descripcion: 'Sudadera con cierre',
      composicion: '80% algodón 20% poliéster',
      maquilaBase: 35,
      corteBase: 4,
      numOperaciones: 21,
      llevaArte: true,
      idTipoProducto: pantalon.id,
      idGenero: caballero.id,
      ...extra,
    },
  });
}

/**
 * Le cuelga al modelo una receta completa: tela, avío con medida por talla y arte con foto.
 *
 * ⚠️ **Lleva `sufijo` porque NO es reentrante sin él, y eso costó una corrida de CI en rojo.** Casi
 * todo lo que siembra tiene índice ÚNICO GLOBAL —`Tela.nombre`, `Avio.clave`, `Talla.etiqueta`,
 * `TipoProceso.codigo`—, así que llamarla dos veces en la MISMA prueba (para sembrar un segundo
 * modelo del que copiar la receta) reventaba con `P2002` **dentro del fixture**, antes de llegar a
 * la aserción. La prueba moría sin llegar a probar nada, y el verde de las demás lo tapaba.
 */
async function sembrarReceta(
  idModelo: number,
  sufijo = '',
): Promise<{ idTela: number; idAvio: number }> {
  const tela = await cliente.tela.create({ data: { nombre: `Felpa${sufijo}` } });
  await cliente.modeloTela.create({
    data: { idModelo, idTela: tela.id, consumoPorPrenda: 1.5 },
  });

  const avio = await cliente.avio.create({
    data: { clave: `RES-1${sufijo}`, descripcion: 'Resorte', unidad: 'm' },
  });
  await cliente.modeloAvio.create({
    data: { idModelo, idAvio: avio.id, consumoPorPrenda: 2, consumoPorTalla: true },
  });
  const talla = await cliente.talla.create({ data: { etiqueta: `M${sufijo}` } });
  await cliente.modeloAvioTalla.create({
    data: { idModelo, idAvio: avio.id, idTalla: talla.id, consumo: 0.75 },
  });

  const tipoArte = await crearTipoArtePrueba(cliente, `bordado${sufijo}`);
  const archivo = await cliente.archivo.create({
    data: {
      bucket: 'control-v2-prueba',
      key: `artes/v1e7b${sufijo}.jpg`,
      nombreOriginal: 'logo.jpg',
      tipoMime: 'image/jpeg',
      tamanoBytes: 1024,
    },
  });
  await cliente.modeloArte.create({
    data: {
      idModelo,
      descripcion: 'Logo frente',
      idTipoArte: tipoArte,
      precio: 12.5,
      fotos: { create: [{ idArchivo: archivo.id, orden: 0 }] },
    },
  });

  return { idTela: tela.id, idAvio: avio.id };
}

describe('crearVersionDeModelo — el código', () => {
  it('la primera versión de `CYA-26-71-001` es `CYA-26-71-001-01`', async () => {
    const padre = await crearDesarrollo('CYA-26-71-001');

    const version = await crearVersionDeModelo(sesion(), padre.id, {}, bd());

    expect(version.codigo).toBe('CYA-26-71-001-01');
    expect(version.codigoDesarrollo).toBe('CYA-26-71-001-01');
    expect(version.versionDesarrollo).toBe(1);
    expect(version.idModeloPadre).toBe(padre.id);
    expect(version.origen).toBe('desarrollo');
    // Regla 4: el sufijo vive en desarrollo; el nº de producción se estrena al promoverse.
    expect(version.numeroProduccion).toBeNull();
  });

  it('⭐ PLANO, NUNCA ANIDADO: versionar el `-01` da `-02`, y quedan TRES hermanos', async () => {
    const padre = await crearDesarrollo('CYA-26-71-001');
    const v1 = await crearVersionDeModelo(sesion(), padre.id, {}, bd());
    const v2 = await crearVersionDeModelo(sesion(), v1.id, {}, bd());

    expect(v1.codigo).toBe('CYA-26-71-001-01');
    expect(v2.codigo).toBe('CYA-26-71-001-02');
    expect(v2.versionDesarrollo).toBe(2);
    // El linaje como DATO apunta al modelo que se versionó (de ahí salió la receta).
    expect(v2.idModeloPadre).toBe(v1.id);

    const familia = await cliente.modelo.findMany({
      where: { codigoDesarrollo: { startsWith: 'CYA-26-71-001' } },
      orderBy: { codigo: 'asc' },
      select: { codigo: true },
    });
    expect(familia.map((m) => m.codigo)).toEqual([
      'CYA-26-71-001',
      'CYA-26-71-001-01',
      'CYA-26-71-001-02',
    ]);
  });

  it('el sufijo NO quema un consecutivo nuevo de la serie de desarrollo', async () => {
    // Regla 3: la versión es sufijo del código que YA existe. Si mintiera un código nuevo, la
    // secuencia global del cliente+año+par avanzaría; aquí no se toca ninguna.
    const padre = await crearDesarrollo('CYA-26-71-001');
    await crearVersionDeModelo(sesion(), padre.id, {}, bd());

    expect(await cliente.secuenciaGlobal.count()).toBe(0);
  });

  it('⭐ absorbe una colisión de MAYÚSCULAS avanzando de sufijo, sin reventar la transacción', async () => {
    // Cicatriz de V1-E3n: comparar exacto mientras la base bloquea sin distinguir mayúsculas hacía
    // que la colisión llegara al `@unique` y abortara la transacción entera.
    const padre = await crearDesarrollo('CYA-26-71-001');
    // Un modelo ajeno se quedó con el código en minúsculas (captura a mano).
    await cliente.modelo.create({ data: { codigo: 'cya-26-71-001-01' } });

    const version = await crearVersionDeModelo(sesion(), padre.id, {}, bd());
    expect(version.codigo).toBe('CYA-26-71-001-02');
  });

  it('hereda la descripción del padre, o toma la que se le dé', async () => {
    const padre = await crearDesarrollo('CYA-26-71-001');

    const heredada = await crearVersionDeModelo(sesion(), padre.id, {}, bd());
    expect(heredada.descripcion).toBe('Sudadera con cierre');

    const propia = await crearVersionDeModelo(
      sesion(),
      padre.id,
      { descripcion: 'Sudadera SIN cierre' },
      bd(),
    );
    expect(propia.descripcion).toBe('Sudadera SIN cierre');
  });
});

describe('crearVersionDeModelo — la receta y el padre', () => {
  it('⭐ la receta llega COMPLETA al hijo: telas, avíos, medidas por talla y arte con su foto', async () => {
    const padre = await crearDesarrollo('CYA-26-71-001');
    const { idTela, idAvio } = await sembrarReceta(padre.id);

    const version = await crearVersionDeModelo(sesion(), padre.id, {}, bd());

    const telas = await cliente.modeloTela.findMany({ where: { idModelo: version.id } });
    expect(telas).toHaveLength(1);
    expect(telas[0]?.idTela).toBe(idTela);
    expect(telas[0]?.consumoPorPrenda.toNumber()).toBe(1.5);

    const avios = await cliente.modeloAvio.findMany({ where: { idModelo: version.id } });
    expect(avios).toHaveLength(1);
    expect(avios[0]?.idAvio).toBe(idAvio);
    expect(avios[0]?.consumoPorTalla).toBe(true);

    // Sin esto, la versión heredaría el toggle "por talla" con la matriz VACÍA.
    const medidas = await cliente.modeloAvioTalla.findMany({ where: { idModelo: version.id } });
    expect(medidas).toHaveLength(1);
    expect(medidas[0]?.consumo.toNumber()).toBe(0.75);

    const artes = await cliente.modeloArte.findMany({
      where: { idModelo: version.id },
      include: { fotos: true },
    });
    expect(artes).toHaveLength(1);
    expect(artes[0]?.precio?.toNumber()).toBe(12.5);
    // La foto se COMPARTE: el mismo `Archivo`, ningún objeto duplicado en R2.
    expect(artes[0]?.fotos).toHaveLength(1);
    const fotoPadre = await cliente.modeloArte.findFirstOrThrow({
      where: { idModelo: padre.id },
      include: { fotos: true },
    });
    expect(artes[0]?.fotos[0]?.idArchivo).toBe(fotoPadre.fotos[0]?.idArchivo);
  });

  it('⭐ es COPIA CONGELADA: cambiar la receta del hijo no mueve la del padre', async () => {
    const padre = await crearDesarrollo('CYA-26-71-001');
    await sembrarReceta(padre.id);
    const version = await crearVersionDeModelo(sesion(), padre.id, {}, bd());

    // "Se le quita el cierre a la sudadera" — el ejemplo textual de Daniel.
    await cliente.modeloAvio.deleteMany({ where: { idModelo: version.id } });

    expect(await cliente.modeloAvio.count({ where: { idModelo: padre.id } })).toBe(1);
    expect(await cliente.modeloAvio.count({ where: { idModelo: version.id } })).toBe(0);
  });

  it('⭐ el modelo original queda IGUAL, campo por campo', async () => {
    const padre = await crearDesarrollo('CYA-26-71-001');
    await sembrarReceta(padre.id);
    const antes = await cliente.modelo.findUniqueOrThrow({ where: { id: padre.id } });

    await crearVersionDeModelo(sesion(), padre.id, { descripcion: 'Otra cosa' }, bd());

    const despues = await cliente.modelo.findUniqueOrThrow({ where: { id: padre.id } });
    // `modificadoEn` incluido: si algo hubiera hecho un `update` al padre, @updatedAt lo delataría.
    expect(despues).toEqual(antes);
    // Y su receta sigue completa.
    expect(await cliente.modeloTela.count({ where: { idModelo: padre.id } })).toBe(1);
    expect(await cliente.modeloArte.count({ where: { idModelo: padre.id } })).toBe(1);
  });

  it('las FOTOS del modelo no se copian (viven en R2 y son de ESE modelo)', async () => {
    const padre = await crearDesarrollo('CYA-26-71-001');
    const archivo = await cliente.archivo.create({
      data: {
        bucket: 'control-v2-prueba',
        key: 'modelos/v1e7b.jpg',
        nombreOriginal: 'frente.jpg',
        tipoMime: 'image/jpeg',
        tamanoBytes: 1024,
      },
    });
    await cliente.modeloFoto.create({ data: { idModelo: padre.id, idArchivo: archivo.id } });

    const version = await crearVersionDeModelo(sesion(), padre.id, {}, bd());

    expect(await cliente.modeloFoto.count({ where: { idModelo: version.id } })).toBe(0);
    expect(await cliente.modeloFoto.count({ where: { idModelo: padre.id } })).toBe(1);
  });

  it('deja bitácora del acto con el padre del que salió (A7)', async () => {
    const padre = await crearDesarrollo('CYA-26-71-001');
    const version = await crearVersionDeModelo(sesion(), padre.id, {}, bd());

    const bitacora = await cliente.bitacora.findFirstOrThrow({
      where: { entidad: 'Modelo', idEntidad: String(version.id) },
    });
    expect(bitacora.accion).toBe('CREAR');
    expect(bitacora.datos).toMatchObject({
      operacion: 'crear-version',
      idModeloPadre: padre.id,
      raiz: 'CYA-26-71-001',
      version: 1,
    });
  });
});

describe('crearVersionDeModelo — concurrencia', () => {
  it('⭐ dos versionados SIMULTÁNEOS del mismo padre salen `-01` y `-02`, nunca dos `-01`', async () => {
    const padre = await crearDesarrollo('CYA-26-71-001');

    // `allSettled` a propósito: sin el lock las dos calculan `-01`, la que pierde choca contra el
    // `@unique` y REVIENTA — y con `Promise.all` el fallo se vería como un error suelto en vez de
    // como lo que es. Comparando los MENSAJES, el diff enseña qué pasó.
    const r = await Promise.allSettled([
      crearVersionDeModelo(sesion(), padre.id, {}, bd()),
      crearVersionDeModelo(sesion(), padre.id, {}, bd()),
    ]);
    expect(r.filter((x) => x.status === 'rejected').map((x) => String(x.reason))).toEqual([]);

    const codigos = r
      .filter(
        (x): x is PromiseFulfilledResult<Awaited<ReturnType<typeof crearVersionDeModelo>>> =>
          x.status === 'fulfilled',
      )
      .map((x) => x.value.codigo)
      .sort();
    // `new Set` de por medio: si las dos sacaran `-01`, un `toEqual` de dos elementos iguales
    // podría pasar desapercibido en la lectura; el tamaño del set no.
    expect(new Set(codigos).size).toBe(2);
    expect(codigos).toEqual(['CYA-26-71-001-01', 'CYA-26-71-001-02']);
  });

  it('⭐ versionar el PADRE y su `-01` a la vez tampoco choca (la llave del lock es la RAÍZ)', async () => {
    // Si la llave saliera del id del padre, estos dos NO se esperarían y sacarían el mismo sufijo.
    const padre = await crearDesarrollo('CYA-26-71-001');
    const v1 = await crearVersionDeModelo(sesion(), padre.id, {}, bd());

    const [a, b] = await Promise.all([
      crearVersionDeModelo(sesion(), padre.id, {}, bd()),
      crearVersionDeModelo(sesion(), v1.id, {}, bd()),
    ]);

    expect([a.codigo, b.codigo].sort()).toEqual(['CYA-26-71-001-02', 'CYA-26-71-001-03']);
  });
});

describe('crearVersionDeModelo — lo que rechaza', () => {
  it('⭐ un modelo SIN código de desarrollo (los migrados del Access) no se versiona', async () => {
    const migrado = await cliente.modelo.create({
      data: { codigo: '71001', numeroProduccion: 71_001 },
    });

    await expect(crearVersionDeModelo(sesion(), migrado.id, {}, bd())).rejects.toThrow(
      ErrorValidacion,
    );
    // Y no dejó nada a medias.
    expect(await cliente.modelo.count()).toBe(1);
  });

  it('⭐ sin `modelos.aprobar-receta` no se puede, aunque se tenga `modelos.administrar`', async () => {
    // La tensión de §Post-F9.110: aprobar la RECETA es un permiso aparte, ni el de administrar
    // catálogos ni el de aprobar PRECIOS (`listas.aprobar`, que es sólo del dueño).
    const padre = await crearDesarrollo('CYA-26-71-001');
    const sinPermiso = sesion(['modelos.ver', 'modelos.administrar', 'listas.aprobar']);

    await expect(crearVersionDeModelo(sinPermiso, padre.id, {}, bd())).rejects.toThrow(
      ErrorPermiso,
    );
    expect(await cliente.modelo.count()).toBe(1);
  });

  it('un modelo de PRODUCCIÓN que sí tuvo código de desarrollo SÍ se puede versionar', async () => {
    // Se promovió (conserva su `codigoDesarrollo`, D3): la versión nueva nace en desarrollo.
    // ⭐ V1-E8j·R4-H1 — con sus DOS DÍGITOS, y no por complacer al validador: **un modelo promovido
    // siempre los tuvo**, porque son justo lo que `promoverAProduccionNucleo` necesita para darle su
    // número. Un promovido sin ellos es un estado que la producción no puede alcanzar por sí sola —
    // sólo vaciándoselos DESPUÉS, que es el caso que cubre la prueba de al lado (y que ahora se
    // rechaza al versionar).
    const promovido = await cliente.modelo.create({
      data: {
        codigo: '71001',
        codigoDesarrollo: 'CYA-26-71-001',
        origen: 'produccion',
        numeroProduccion: 71_001,
        idTipoProducto: pantalon.id,
        idGenero: caballero.id,
      },
    });

    const version = await crearVersionDeModelo(sesion(), promovido.id, {}, bd());
    expect(version.codigo).toBe('CYA-26-71-001-01');
    expect(version.origen).toBe('desarrollo');
    expect(version.numeroProduccion).toBeNull();
  });

  /**
   * 🔴 V1-E8j · R4-H1 — …PERO NO SI LE VACIARON UN DÍGITO DESPUÉS DE PROMOVERLO.
   *
   * Es el hueco que se alcanzaba **componiendo dos escritores legales**: la edición deja vaciar el
   * par a un modelo de PRODUCCIÓN (laxitud deliberada, los ~4,987 migrados no traen género) y un
   * promovido conserva su `codigoDesarrollo`, así que pasa los candados de arriba. La hija nacería
   * `desarrollo` con el par en null — el mismo estado que el alta y la edición ya cierran.
   *
   * La versión HEREDA el par del padre, así que hereda su defecto: se valida al versionar.
   */
  it('🔴 …pero NO si al padre le vaciaron un dígito después de promoverlo (R4-H1)', async () => {
    const promovido = await cliente.modelo.create({
      data: {
        codigo: '71002',
        codigoDesarrollo: 'CYA-26-71-002',
        origen: 'produccion',
        numeroProduccion: 71_002,
        idTipoProducto: pantalon.id,
        // …y el género vaciado por la ficha, que en PRODUCCIÓN está permitido.
        idGenero: null,
      },
    });

    await expect(crearVersionDeModelo(sesion(), promovido.id, {}, bd())).rejects.toThrow(
      /número de producción/,
    );
    // Y no quedó ninguna hija a medias.
    expect(await cliente.modelo.count({ where: { idModeloPadre: promovido.id } })).toBe(0);
  });

  /**
   * ⚠️ La otra mitad de la regla, también aquí: un tipo de prenda que EXISTE pero **no tiene dígito
   * capturado** deja al padre igual de innumerable, y la hija lo heredaría.
   */
  it('🔴 …ni si el tipo de prenda del padre no tiene dígito capturado (R4-H1, mitad gemela)', async () => {
    const sinDigito = await cliente.tipoProducto.create({ data: { nombre: 'Ropa interior' } });
    const padre = await crearDesarrollo('CYA-26-71-003', { idTipoProducto: sinDigito.id });

    await expect(crearVersionDeModelo(sesion(), padre.id, {}, bd())).rejects.toThrow(
      /Ropa interior/,
    );
    expect(await cliente.modelo.count({ where: { idModeloPadre: padre.id } })).toBe(0);
  });
});

// ── ⭐ LA REVISIÓN DE UNA VERSIÓN (§Post-F9.110), hoy un REGISTRO (V1-E9c, §Post-F9.169) ────────

/**
 * El ciclo completo contra Postgres real, que es lo único que demuestra dos cosas que ningún doble
 * puede: que la MIGRACIÓN cuadra con el esquema (el tipo `estado_revision_modelo` y las cuatro
 * columnas existen de verdad) y que la llave foránea del firmante apunta a `usuarios`.
 *
 * ⚠️ El firmante tiene que EXISTIR: a diferencia de `creado_por_id` (texto suelto en todo el
 * esquema), `modelos.id_revisado_por` es FK con RESTRICT — quien firmó una revisión no se puede
 * borrar. Por eso aquí se crea el usuario antes de firmar.
 */
describe('La revisión de una versión (V1-E7d)', () => {
  const ID_REVISOR = 'usuario-revisor';

  /**
   * El padre con su TIPO y GÉNERO capturados. Hace falta para PROMOVER: los dígitos del número de
   * producción salen del catálogo, y la versión los HEREDA del padre.
   *
   * ⚠️ Y no es un adorno del fixture. El camino alterno —deducir los dígitos del código de
   * desarrollo— NO reconoce un código versionado: `digitosDeCodigoDesarrollo` exige la forma
   * `CYA-26-71-001` exacta y `CYA-26-71-001-01` no le encaja (defecto pre-existente de V1-E7b,
   * reportado aparte). Con tipo y género capturados, ese camino ni se usa.
   */
  async function padreClasificado(codigo = 'CYA-26-71-001') {
    // ⚠️ Los sembraba aquí, pero desde R4-H1 el `beforeEach` global ya los crea (todo padre los
    // necesita, no sólo el que se promueve) y `Genero.nombre`/`TipoProducto.nombre` son ÚNICOS:
    // volverlos a crear reventaría con P2002. `crearDesarrollo` ya los pone.
    return crearDesarrollo(codigo);
  }

  /** Crea el usuario que firma (la FK lo exige) y devuelve su sesión. */
  async function sesionDelRevisor(permisos: ClavePermiso[] = PERM): Promise<SesionUsuario> {
    await cliente.usuario.upsert({
      where: { id: ID_REVISOR },
      update: {},
      create: {
        id: ID_REVISOR,
        username: 'aurora',
        nombre: 'Aurora',
        email: 'aurora@control.local',
      },
    });
    return sesionDePrueba({ id: ID_REVISOR, idEmpresaActiva: empresa.id, permisos });
  }

  it('⭐ la versión NACE pendiente de revisión', async () => {
    const padre = await crearDesarrollo('CYA-26-71-001');
    const version = await crearVersionDeModelo(sesion(), padre.id, {}, bd());

    const fila = await cliente.modelo.findUniqueOrThrow({ where: { id: version.id } });
    expect(fila.revisionEstado).toBe('pendiente');
    expect(fila.idRevisadoPor).toBeNull();
    expect(fila.revisadoEn).toBeNull();

    // Y el PADRE sigue sin revisión: no es una versión, no le toca.
    expect(
      (await cliente.modelo.findUniqueOrThrow({ where: { id: padre.id } })).revisionEstado,
    ).toBeNull();
  });

  it('⭐⭐ V1-E9c — SIN revisar pasa a producción igual, y AHÍ todavía se puede firmar', async () => {
    // 🔴 LAS DOS DECISIONES DE §Post-F9.169 EN UNA SOLA CORRIDA, contra Postgres real. Antes, la
    // primera mitad era `rejects.toThrow(ErrorConflicto)` y la segunda era imposible.
    const padre = await padreClasificado();
    const version = await crearVersionDeModelo(sesion(), padre.id, {}, bd());
    const admin = sesion(['modelos.ver', 'modelos.administrar']);

    // (1) La versión nace `pendiente` y promueve igual: la revisión no detiene producir.
    expect(
      (await cliente.modelo.findUniqueOrThrow({ where: { id: version.id } })).revisionEstado,
    ).toBe('pendiente');
    const promovido = await pasarModeloAProduccion(admin, version.id, {}, bd());
    expect(promovido.numeroProduccion).toBe(71_001);

    const enProduccion = await cliente.modelo.findUniqueOrThrow({ where: { id: version.id } });
    expect(enProduccion.origen).toBe('produccion');
    // La revisión NO se tocó al promover: sigue pendiente, y sigue siendo verdad.
    expect(enProduccion.revisionEstado).toBe('pendiente');

    // (2) Y ahí SIGUE pudiéndose firmar. Sin esto quedaría un acto que nadie puede ejecutar nunca:
    // la promoción es justo lo que antes cerraba la puerta para siempre.
    const revisor = await sesionDelRevisor();
    const firma = await aprobarRevisionModelo(
      revisor,
      version.id,
      { nota: 'revisada con Daniel, con la OP ya generada' },
      bd(),
    );
    expect(firma.revisionEstado).toBe('aprobada');

    const firmado = await cliente.modelo.findUniqueOrThrow({ where: { id: version.id } });
    expect(firmado.revisionEstado).toBe('aprobada');
    expect(firmado.idRevisadoPor).toBe(ID_REVISOR);
  });

  it('⭐ la firma queda escrita con QUIÉN y CUÁNDO (A7), y el rechazo con su motivo', async () => {
    const padre = await crearDesarrollo('CYA-26-71-001');
    const version = await crearVersionDeModelo(sesion(), padre.id, {}, bd());
    const revisor = await sesionDelRevisor();

    await rechazarRevisionModelo(revisor, version.id, { motivo: 'el cierre sí costaba' }, bd());

    const fila = await cliente.modelo.findUniqueOrThrow({
      where: { id: version.id },
      include: { revisadoPor: { select: { nombre: true } } },
    });
    expect(fila.revisionEstado).toBe('rechazada');
    expect(fila.idRevisadoPor).toBe(ID_REVISOR);
    expect(fila.revisadoPor?.nombre).toBe('Aurora');
    expect(fila.revisadoEn).toBeInstanceOf(Date);
    expect(fila.revisionNota).toBe('el cierre sí costaba');

    // Y la SECUENCIA no se pierde (D3): la bitácora guarda el acto con su motivo.
    const renglones = await cliente.bitacora.findMany({
      where: { entidad: 'Modelo', idEntidad: String(version.id) },
      orderBy: { id: 'asc' },
    });
    // ⚠️ NO se serializa el renglón entero: la bitácora trae un `folio` BigInt y `JSON.stringify`
    // no sabe serializarlo —revienta con `Do not know how to serialize a BigInt`—. Lo cazó el CI,
    // que es el único que corre esto contra Postgres de verdad.
    //
    // Y de paso el arreglo es mejor que el parche: buscar una subcadena dentro del volcado entero
    // pasaba igual si el texto aparecía en OTRO campo. Ahora se afirma el campo que de verdad
    // guarda cada cosa.
    const rechazo = renglones.find(
      (r) => (r.datos as { operacion?: string } | null)?.operacion === 'rechazar-revision',
    );
    expect(rechazo, 'la bitácora tiene que traer el acto de rechazo').toBeDefined();
    expect((rechazo?.datos as { motivo?: string }).motivo).toBe('el cierre sí costaba');
  });

  it('⭐ un modelo que NO es versión pasa a producción sin firma, como siempre', async () => {
    // Los ~4,987 migrados del Access y todo desarrollo normal: esta etapa no les cambió nada.
    const normal = await padreClasificado('CYA-26-71-002');
    const admin = sesion(['modelos.ver', 'modelos.administrar']);

    const promovido = await pasarModeloAProduccion(admin, normal.id, {}, bd());
    expect(promovido.numeroProduccion).toBe(71_001);
  });

  it('sin `modelos.aprobar-receta` no se firma la revisión', async () => {
    const padre = await crearDesarrollo('CYA-26-71-001');
    const version = await crearVersionDeModelo(sesion(), padre.id, {}, bd());
    const sinPermiso = await sesionDelRevisor(['modelos.ver', 'modelos.administrar']);

    await expect(aprobarRevisionModelo(sinPermiso, version.id, {}, bd())).rejects.toThrow(
      ErrorPermiso,
    );
  });
});

// ── ⭐ V1-E7e: LA APROBACIÓN SE INVALIDA SI LA RECETA CAMBIA (§Post-F9.116) ──────

/**
 * **La prueba que decide V1-E7e, por CADA puerta, contra Postgres real.** Es el ciclo que Daniel
 * mandó cerrar: Aurora aprueba la versión → alguien le mueve la receta → **la firma se cae**. Sin
 * la invalidación, el último paso de cada una de estas pruebas PASA, y el sistema seguiría
 * presentando como *revisada* una receta que Aurora nunca vio.
 *
 * Va contra la base de verdad porque lo que hay que demostrar es que las PUERTAS REALES —el PUT
 * de telas, el de avíos, los favoritos, las medidas por talla, el arte y el copiado de receta—
 * pasan por el embudo. Un doble sólo probaría que el embudo funciona, que es otra cosa (eso se
 * prueba sin base en `revision-modelo.test.ts`).
 *
 * ⚠️ **V1-E9c cambió el cierre, no el ciclo.** Antes se cerraba comprobando que la promoción
 * volvía a rebotar; esa compuerta ya no existe (§Post-F9.169). Se cierra comprobando **lo que la
 * invalidación de verdad promete**: que la firma se soltó de la fila, con su motivo, y que el
 * modelo NO se movió de catálogo por el camino.
 */
describe('⭐ La aprobación se invalida si la receta cambia (V1-E7e)', () => {
  const ID_AURORA = 'usuario-aurora';

  /** Padre CLASIFICADO (tipo + género) para que la versión pueda promoverse de verdad. */
  async function padreParaProducir(codigo = 'CYA-26-71-001') {
    // Igual que `padreClasificado`: desde R4-H1 los dos catálogos los siembra el `beforeEach` y sus
    // nombres son ÚNICOS, así que re-crearlos daría P2002. `crearDesarrollo` ya los asigna.
    return crearDesarrollo(codigo);
  }

  /** La sesión de Aurora (la FK del firmante exige que el usuario exista). */
  async function sesionDeAurora(): Promise<SesionUsuario> {
    await cliente.usuario.upsert({
      where: { id: ID_AURORA },
      update: {},
      create: {
        id: ID_AURORA,
        username: 'aurora',
        nombre: 'Aurora',
        email: 'aurora@control.local',
      },
    });
    return sesionDePrueba({ id: ID_AURORA, idEmpresaActiva: empresa.id, permisos: PERM });
  }

  /** Quien mueve la receta NO es quien firmó: sólo administra modelos. */
  const admin = () => sesion(['modelos.ver', 'modelos.administrar']);

  /**
   * Deja lista una VERSIÓN con receta heredada y su revisión APROBADA, y comprueba de paso que en
   * ese punto SÍ podría mandarse a producir (si no, la prueba de abajo no demostraría nada:
   * pasaría por estar rota desde antes).
   */
  async function versionAprobadaConReceta(): Promise<{
    idVersion: number;
    idTela: number;
    idAvio: number;
  }> {
    const padre = await padreParaProducir();
    const { idTela, idAvio } = await sembrarReceta(padre.id);
    const version = await crearVersionDeModelo(sesion(), padre.id, {}, bd());

    const aurora = await sesionDeAurora();
    await aprobarRevisionModelo(aurora, version.id, { nota: 'la revisé con Daniel' }, bd());

    const fila = await cliente.modelo.findUniqueOrThrow({ where: { id: version.id } });
    expect(fila.revisionEstado).toBe('aprobada');
    expect(fila.idRevisadoPor).toBe(ID_AURORA);

    return { idVersion: version.id, idTela, idAvio };
  }

  /** El paso que decide: la firma de Aurora se cayó y la versión volvió a esperar revisión. */
  async function laFirmaSeCayo(idVersion: number): Promise<void> {
    const fila = await cliente.modelo.findUniqueOrThrow({ where: { id: idVersion } });
    expect(fila.revisionEstado).toBe('pendiente');
    // Nadie ha revisado la receta que hay AHORA: la firma de Aurora se soltó de la fila.
    expect(fila.idRevisadoPor).toBeNull();
    expect(fila.revisadoEn).toBeNull();
    expect(fila.revisionNota).toContain('INVALIDÓ');
    // Y cambiar la receta NO mueve el modelo de catálogo (el embudo sólo toca la firma y la marca
    // de agua): si algún día lo moviera, se vería aquí.
    expect(fila.origen).toBe('desarrollo');
    expect(fila.numeroProduccion).toBeNull();
  }

  it('⭐ TELAS — cambiarle el consumo de una tela le tumba la firma', async () => {
    const { idVersion, idTela } = await versionAprobadaConReceta();

    await reemplazarTelasBom(
      admin(),
      idVersion,
      [
        {
          idTela,
          // 1.5 → 1.9: exactamente el caso que contó Daniel ("le cambian el consumo de una tela").
          consumoPorPrenda: 1.9,
          paraPreCosto: true,
          paraProduccion: true,
          paraCosto: true,
          idTelaProveedor: null,
        },
      ],
      bd(),
    );

    await laFirmaSeCayo(idVersion);
  });

  it('⭐ AVÍOS — cambiar el set de avíos le tumba la firma', async () => {
    const { idVersion, idAvio } = await versionAprobadaConReceta();

    await reemplazarAviosBom(
      admin(),
      idVersion,
      [
        {
          idAvio,
          consumoPorPrenda: 3,
          paraPreCosto: true,
          paraProduccion: true,
          paraCosto: true,
          idAvioProveedor: null,
        },
      ],
      bd(),
    );

    await laFirmaSeCayo(idVersion);
  });

  it('⭐ AVÍOS FAVORITOS — aceptar la sugerencia del catálogo también le tumba la firma', async () => {
    // La puerta que es fácil olvidar: no es el PUT del BOM, es un botón que mete avíos derecho.
    const { idVersion } = await versionAprobadaConReceta();
    await cliente.avio.create({
      data: { clave: 'ETI-1', descripcion: 'Etiqueta', unidad: 'pza', favorito: true, cantFav: 1 },
    });

    const resultado = await aceptarAviosFavoritos(admin(), idVersion, bd());
    expect(resultado.agregados).toBe(1);

    await laFirmaSeCayo(idVersion);
  });

  it('⭐ MEDIDAS POR TALLA — mover una medida le tumba la firma', async () => {
    const { idVersion, idAvio } = await versionAprobadaConReceta();
    const talla = await cliente.talla.findFirstOrThrow();

    await guardarMedidasAvio(
      admin(),
      idVersion,
      idAvio,
      { consumoPorTalla: true, tallas: [{ idTalla: talla.id, consumo: 0.95, idAvioMedida: null }] },
      bd(),
    );

    await laFirmaSeCayo(idVersion);
  });

  it('⭐ ARTE — "le mueve el arte" (las palabras de Daniel) le tumba la firma', async () => {
    const { idVersion } = await versionAprobadaConReceta();
    // Código PROPIO: `sembrarReceta` ya dejó el «bordado» de la receta, y `TipoProceso.codigo` es
    // único global. Repetirlo reventaba el fixture con `P2002` y la prueba nunca corría.
    const idTipoArte = await crearTipoArtePrueba(cliente, 'bordado-2');

    await crearArte(admin(), idVersion, { descripcion: 'Logo espalda', idTipoArte }, bd());

    await laFirmaSeCayo(idVersion);
  });

  it('⭐ COPIAR RECETA — volcarle el BOM de otro modelo le tumba la firma', async () => {
    const { idVersion } = await versionAprobadaConReceta();
    const otro = await crearDesarrollo('CYA-26-71-009');
    await sembrarReceta(otro.id, '-2');

    await copiarBom(admin(), idVersion, { idOrigen: otro.id, reemplazar: true }, bd());

    await laFirmaSeCayo(idVersion);
  });

  it('⭐ (c) la BITÁCORA cuenta la secuencia entera: Aurora firmó, se movió la receta, se volvió a firmar', async () => {
    const { idVersion, idTela } = await versionAprobadaConReceta();

    await reemplazarTelasBom(
      admin(),
      idVersion,
      [
        {
          idTela,
          consumoPorPrenda: 2.25,
          paraPreCosto: true,
          paraProduccion: true,
          paraCosto: true,
          idTelaProveedor: null,
        },
      ],
      bd(),
    );

    // (d) No es un callejón sin salida: se vuelve a firmar con el MISMO permiso y vuelve a pasar.
    const aurora = await sesionDeAurora();
    await aprobarRevisionModelo(aurora, idVersion, { nota: 'revisada otra vez' }, bd());
    const promovido = await pasarModeloAProduccion(admin(), idVersion, {}, bd());
    expect(promovido.numeroProduccion).toBe(71_001);

    const renglones = await cliente.bitacora.findMany({
      where: { entidad: 'Modelo', idEntidad: String(idVersion) },
      orderBy: { id: 'asc' },
    });
    const operaciones = renglones
      .map((r) => (r.datos as { operacion?: string } | null)?.operacion)
      .filter((op): op is string => op !== undefined);
    // La secuencia de ACTOS de REVISIÓN, en orden y sin que ninguno pise al anterior (D3).
    //
    // ⚠️ Se afirma la SUBSECUENCIA, no la lista completa, y la razón importa: el modelo registra
    // en la misma bitácora otros actos de su vida —`crear-version` al nacer, `pasar-a-produccion`
    // al promoverse— que no tienen nada que ver con esta regla. Exigir la lista exacta ataba esta
    // prueba a que NADIE volviera a registrar nada del modelo, y por eso se puso roja en cuanto
    // V1-E7d añadió su acto: falló sin que la conducta que vigila hubiera cambiado.
    //
    // Una prueba que se rompe por algo que no vigila enseña a ignorarla.
    const revisiones = operaciones.filter((op) => op.endsWith('-revision'));
    expect(revisiones).toEqual(['aprobar-revision', 'invalidar-revision', 'aprobar-revision']);

    // Y el renglón de la invalidación conserva la firma que tumbó: quién y de cuándo era.
    const invalidacion = renglones.find(
      (r) => (r.datos as { operacion?: string } | null)?.operacion === 'invalidar-revision',
    );
    const datos = invalidacion?.datos as Record<string, unknown>;
    expect(datos.cambio).toBe('telas');
    expect(datos.estadoAnterior).toBe('aprobada');
    expect(datos.idAprobadorAnterior).toBe(ID_AURORA);
    expect(datos.aprobadaEn).toEqual(expect.any(String));
    expect(datos.notaAnterior).toBe('la revisé con Daniel');
    // Quien la invalidó es quien movió la receta, no quien había firmado.
    expect(invalidacion?.idUsuario).not.toBe(ID_AURORA);
  });

  it('⭐ un modelo MIGRADO no cambia de conducta: se le mueve la receta y sigue pasando a producción', async () => {
    // El alcance de §Post-F9.116: los ~4,987 del Access y los desarrollos normales nunca tuvieron
    // revisión que invalidar. Si esto se ensanchara, el catálogo entero quedaría infirmable.
    const normal = await padreParaProducir('CYA-26-71-002');
    const { idTela } = await sembrarReceta(normal.id);

    await reemplazarTelasBom(
      admin(),
      normal.id,
      [
        {
          idTela,
          consumoPorPrenda: 3.3,
          paraPreCosto: true,
          paraProduccion: true,
          paraCosto: true,
          idTelaProveedor: null,
        },
      ],
      bd(),
    );

    const fila = await cliente.modelo.findUniqueOrThrow({ where: { id: normal.id } });
    expect(fila.revisionEstado).toBeNull();
    expect(fila.revisionNota).toBeNull();

    const promovido = await pasarModeloAProduccion(admin(), normal.id, {}, bd());
    expect(promovido.numeroProduccion).toBe(71_001);
  });
});
