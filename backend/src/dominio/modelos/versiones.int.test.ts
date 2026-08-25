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

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  empresa = await crearEmpresaPrueba(cliente);
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
      ...extra,
    },
  });
}

/** Le cuelga al modelo una receta completa: tela, avío con medida por talla y arte con foto. */
async function sembrarReceta(idModelo: number): Promise<{ idTela: number; idAvio: number }> {
  const tela = await cliente.tela.create({ data: { nombre: 'Felpa' } });
  await cliente.modeloTela.create({
    data: { idModelo, idTela: tela.id, consumoPorPrenda: 1.5 },
  });

  const avio = await cliente.avio.create({
    data: { clave: 'RES-1', descripcion: 'Resorte', unidad: 'm' },
  });
  await cliente.modeloAvio.create({
    data: { idModelo, idAvio: avio.id, consumoPorPrenda: 2, consumoPorTalla: true },
  });
  const talla = await cliente.talla.create({ data: { etiqueta: 'M' } });
  await cliente.modeloAvioTalla.create({
    data: { idModelo, idAvio: avio.id, idTalla: talla.id, consumo: 0.75 },
  });

  const tipoArte = await crearTipoArtePrueba(cliente);
  const archivo = await cliente.archivo.create({
    data: {
      bucket: 'control-v2-prueba',
      key: 'artes/v1e7b.jpg',
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
    const promovido = await cliente.modelo.create({
      data: {
        codigo: '71001',
        codigoDesarrollo: 'CYA-26-71-001',
        origen: 'produccion',
        numeroProduccion: 71_001,
      },
    });

    const version = await crearVersionDeModelo(sesion(), promovido.id, {}, bd());
    expect(version.codigo).toBe('CYA-26-71-001-01');
    expect(version.origen).toBe('desarrollo');
    expect(version.numeroProduccion).toBeNull();
  });
});
