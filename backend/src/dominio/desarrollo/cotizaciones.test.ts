/**
 * Tests UNIT de la COTIZACIÓN (V1-E7c, §Post-F9.109) — el documento que se le manda al cliente.
 * SIN Postgres: se inyecta un doble de `Tx` que se comporta como Prisma para las llamadas que el
 * dominio hace (guarda lo que se creó, respeta el scope de empresa en los `findFirst` y registra el
 * SQL crudo). El flujo real contra base va en `cotizaciones.int.test.ts`.
 *
 * Lo que se blinda aquí, y por qué cada cosa importa:
 *  • 🔴 **El CONGELADO** — emitir copia VALORES, no punteros. Si el papel apuntara a la lista,
 *    reimprimir la cotización de marzo enseñaría los precios de mayo. Es LA prueba de la etapa.
 *  • 🔴 **No se emite con un precio sin aprobar**, y se dice CUÁLES faltan.
 *  • **Los CINCO modelos completos**: la cotización lleva TODOS los renglones de la lista, siempre.
 *  • **Folio por secuencia atómica** (A3): jamás `Max()+1`, y no se quema si el guard rechaza.
 *  • **Inmutabilidad**: no existe forma de editar; cancelar sólo pone un sello y no toca el contenido.
 *  • **Permisos** (A4, deny-by-default) y **empresa activa** (A9).
 */
import { describe, expect, it } from 'vitest';

import { Prisma } from '../../datos/index.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorPermiso } from '../../comun/errores.js';
import type { Tx } from '../../comun/transaccion.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

import { armarDatosImpresoCotizacion } from './impresos/impreso-cotizacion.js';

import {
  aCotizacionSalida,
  cancelarCotizacion,
  congelarRenglones,
  emitirCotizacion,
  exigirRenglonesAprobados,
  listarCotizaciones,
  obtenerCotizacion,
  type RenglonListaParaCongelar,
} from './cotizaciones.js';

// ── Sesiones ────────────────────────────────────────────────────────────────────────

const sinNada = () => sesionDePrueba({ permisos: [] });
const soloVer = () => sesionDePrueba({ permisos: ['listas.ver'] });
/** Quien está en la mesa: emite y cancela (decisión: SIN permiso nuevo, reusa `listas.negociar`). */
const negociador = () =>
  sesionDePrueba({ permisos: ['listas.negociar', 'listas.ver', 'consultas.ver-importes'] });

// ── Doble de Prisma ─────────────────────────────────────────────────────────────────

/**
 * Los importes de Prisma llegan como `Prisma.Decimal`, NUNCA como `number`: el doble los usa de
 * verdad. Un fake con números planos habría probado una suposición y no el sistema (el dominio los
 * pasa por `num()`, que llama `.toNumber()`).
 */
const D = (n: number): Prisma.Decimal => new Prisma.Decimal(n);

/** Un renglón de la LISTA tal como lo lee `emitirCotizacion` (con sus joins). */
interface FilaLineaLista {
  id: number;
  idLista: number;
  idPrecosto: number;
  precioAprobado: Prisma.Decimal | null;
  precosto: { version: number };
  desarrollo: {
    numeroCliente: string | null;
    modelo: { codigo: string; descripcion: string | null };
  };
}

/** Estado del doble: lo que "hay en la base" y lo que el dominio fue escribiendo. */
interface EstadoFake {
  idEmpresaLista: number;
  /** Encabezado de la LISTA que la emisión lee UNA vez para copiarlo al documento. */
  encabezadoLista: {
    folio: bigint;
    idCliente: number;
    idClienteDepartamento: number;
    cliente: { nombre: string };
    clienteDepartamento: { nombre: string };
  };
  /**
   * H1: simula que la lista (o el renglón) YA SE BORRÓ — `SetNull` dejó los punteros en null. El
   * documento tiene que seguir imprimiéndose idéntico.
   */
  listaBorrada: boolean;
  lineasLista: FilaLineaLista[];
  /** Renglones que `createMany` recibió (la FOTO congelada que quedó escrita). */
  lineasCreadas: Record<string, unknown>[];
  /** Encabezado que `cotizacion.create` recibió. */
  cabecera: Record<string, unknown> | null;
  /** `data` de cada `cotizacion.update` (para vigilar que cancelar NO toque el contenido). */
  updates: Record<string, unknown>[];
  /** SQL crudo que pasó por `$queryRaw` (folio) — para probar que NO es `Max()+1`. */
  sqlConsultas: string[];
  /** Entradas de bitácora. */
  bitacora: Record<string, unknown>[];
  /** Estado de la cotización "ya guardada" (para cancelar/obtener). */
  estadoCotizacion: string;
  folio: bigint;
}

function estadoInicial(): EstadoFake {
  return {
    idEmpresaLista: 1,
    encabezadoLista: {
      folio: 7n,
      idCliente: 3,
      idClienteDepartamento: 4,
      cliente: { nombre: 'C&A' },
      clienteDepartamento: { nombre: 'NIÑOS' },
    },
    listaBorrada: false,
    lineasLista: [
      linea(10, 'MOD-A', 'Jogger', 'CA-001', 1, 137),
      linea(11, 'MOD-B', 'Sudadera', 'CA-002', 2, 210),
      linea(12, 'MOD-C', null, null, 1, 95.5),
      linea(13, 'MOD-D', 'Playera', 'CA-004', 3, 60),
      linea(14, 'MOD-E', 'Pants', 'CA-005', 1, 180),
    ],
    lineasCreadas: [],
    cabecera: null,
    updates: [],
    sqlConsultas: [],
    bitacora: [],
    estadoCotizacion: 'emitida',
    folio: 41n,
  };
}

function linea(
  id: number,
  codigo: string,
  descripcion: string | null,
  numeroCliente: string | null,
  version: number,
  precioAprobado: number | null,
): FilaLineaLista {
  return {
    id,
    idLista: 7,
    idPrecosto: 1000 + id,
    precioAprobado: precioAprobado === null ? null : D(precioAprobado),
    precosto: { version },
    desarrollo: { numeroCliente, modelo: { codigo, descripcion } },
  };
}

/**
 * 🔴 MOTOR GENÉRICO de `where` del doble — evalúa el filtro COMPLETO que le pasa el dominio, sea el
 * que sea, en vez de mirar los dos campos que el test de hoy espera.
 *
 * Por qué existe: un doble complaciente con `where` deja vivas mutaciones REALES. Medido en esta
 * misma etapa — colar `precioAprobado: { not: null }` en el `findMany` de los renglones sobrevivía
 * 21/21 pruebas, y contra Postgres de verdad eso tira EN SILENCIO del documento los modelos sin
 * aprobar **y** deja el guard de "no se emite sin aprobar" inalcanzable: las dos reglas estrella de
 * Daniel rotas de un plumazo, en verde. Es la cuarta vez en este track que un doble permisivo tapa
 * una mutación, así que el filtro se implementa DE VERDAD y no con una aserción parchada.
 *
 * Soporta lo que Prisma usa aquí: igualdad escalar, `null`, los operadores `equals`/`not`/`in`/
 * `gte`/`lte`, y objetos ANIDADOS de relación (se recurre). Un operador que no conozca revienta, en
 * vez de devolver `true` por omisión — silenciar lo desconocido es justo el defecto que se corrige.
 */
function coincideWhere(fila: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([campo, condicion]) => {
    const valor = fila[campo];
    if (condicion === null || typeof condicion !== 'object') {
      return valor === condicion;
    }
    const operadores = condicion as Record<string, unknown>;
    const claves = Object.keys(operadores);
    const esOperador = claves.some((k) => ['equals', 'not', 'in', 'gte', 'lte'].includes(k));
    if (!esOperador) {
      // Objeto de RELACIÓN anidada (`{ lista: { idCliente: 3 } }`): se recurre en el sub-objeto.
      if (valor === null || typeof valor !== 'object') {
        return false;
      }
      return coincideWhere(valor as Record<string, unknown>, operadores);
    }
    return claves.every((operador) => {
      const esperado = operadores[operador];
      switch (operador) {
        case 'equals':
          return valor === esperado;
        case 'not':
          return valor !== esperado;
        case 'in':
          return Array.isArray(esperado) && esperado.includes(valor);
        case 'gte':
          return Number(valor) >= Number(esperado);
        case 'lte':
          return Number(valor) <= Number(esperado);
        default:
          throw new Error(`El doble no sabe evaluar el operador de where "${operador}".`);
      }
    });
  });
}

/**
 * Aplica el `select` como Prisma: devuelve SÓLO los campos pedidos (y recurre en los anidados). Si el
 * dominio olvidara seleccionar un campo que después lee, aquí llega `undefined` — igual que en
 * producción — en vez de que el doble se lo regale.
 */
function aplicarSelect(
  fila: Record<string, unknown>,
  select: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (select === undefined) {
    return fila;
  }
  const salida: Record<string, unknown> = {};
  for (const [campo, pedido] of Object.entries(select)) {
    if (pedido === true) {
      salida[campo] = fila[campo];
    } else if (pedido !== null && typeof pedido === 'object') {
      const anidado = (pedido as { select?: Record<string, unknown> }).select;
      const valor = fila[campo];
      salida[campo] =
        valor === null || typeof valor !== 'object'
          ? valor
          : aplicarSelect(valor as Record<string, unknown>, anidado);
    }
  }
  return salida;
}

/** Junta el SQL de un template literal tal como llega a `$queryRaw`/`$executeRaw`. */
function sqlDe(partes: unknown): string {
  return Array.isArray(partes) ? partes.join(' ? ') : String(partes);
}

/**
 * Doble de `Tx` que se comporta como Prisma en lo que el dominio usa: los `findFirst` respetan de
 * verdad `where.id`/`where.idEmpresa` (si no coinciden devuelven `null`, como Prisma), `createMany`
 * guarda lo recibido y `$queryRaw` de la secuencia devuelve el folio con la forma real
 * (`[{ valor: bigint }]`). No colapsa ramas ni ignora filtros: un doble que sólo dijera "sí" probaría
 * la suposición del test, no el sistema.
 */
function txFake(estado: EstadoFake): Tx {
  const fake = {
    $executeRaw: (partes: unknown) => {
      estado.sqlConsultas.push(sqlDe(partes));
      return Promise.resolve(1);
    },
    $queryRaw: (partes: unknown) => {
      estado.sqlConsultas.push(sqlDe(partes));
      return Promise.resolve([{ valor: estado.folio }]);
    },
    listaPrecios: {
      findFirst: ({
        where,
        select,
      }: {
        where: { id: number; idEmpresa: number };
        select?: Record<string, unknown>;
      }) => {
        if (where.idEmpresa !== estado.idEmpresaLista) {
          return Promise.resolve(null);
        }
        // El encabezado que la emisión copia al documento (y que después nadie vuelve a leer).
        return Promise.resolve(aplicarSelect({ id: where.id, ...estado.encabezadoLista }, select));
      },
    },
    listaPreciosLinea: {
      // Honra `where` (motor genérico) y `take` DE VERDAD, como Prisma.
      findMany: ({ where, take }: { where: Record<string, unknown>; take?: number }) => {
        const filas = estado.lineasLista
          .filter((l) => coincideWhere(l as unknown as Record<string, unknown>, where))
          .map((l) => ({ ...l }));
        return Promise.resolve(take === undefined ? filas : filas.slice(0, take));
      },
    },
    cotizacion: {
      create: ({ data }: { data: Record<string, unknown> }) => {
        estado.cabecera = data;
        return Promise.resolve({ id: 500 });
      },
      update: ({ data }: { data: Record<string, unknown> }) => {
        estado.updates.push(data);
        if (typeof data.estado === 'string') {
          estado.estadoCotizacion = data.estado;
        }
        return Promise.resolve({ id: 500 });
      },
      // El LISTADO es una proyección DISTINTA de la del detalle (`aResumen`), así que se ejercita
      // aparte: sin esto, romper el encabezado congelado del listado pasaba en verde.
      findMany: ({ where }: { where: Record<string, unknown> }) => {
        const fila = cotizacionGuardada(estado);
        return Promise.resolve(coincideWhere(fila, where) ? [fila] : []);
      },
      findFirst: ({ where }: { where: { id: number; idEmpresa: number } }) => {
        // A9 de verdad: una cotización de otra empresa NO EXISTE para esta sesión.
        if (where.idEmpresa !== estado.idEmpresaLista || where.id !== 500) {
          return Promise.resolve(null);
        }
        return Promise.resolve(cotizacionGuardada(estado));
      },
    },
    cotizacionLinea: {
      createMany: ({ data }: { data: Record<string, unknown>[] }) => {
        estado.lineasCreadas.push(...data);
        return Promise.resolve({ count: data.length });
      },
    },
    bitacora: {
      create: ({ data }: { data: Record<string, unknown> }) => {
        estado.bitacora.push(data);
        return Promise.resolve({ id: 1n });
      },
    },
  };
  return fake as unknown as Tx;
}

/** La cotización "ya guardada" que devuelve el doble, armada desde lo que se escribió. */
function cotizacionGuardada(estado: EstadoFake): Record<string, unknown> {
  // Si la lista se borró, `SetNull` dejó los punteros en null. Nada más cambia: las columnas
  // congeladas son las mismas, porque el documento no depende de la lista para NADA.
  const cabecera = estado.cabecera ?? {};
  return {
    id: 500,
    folio: estado.folio,
    // El `where` del listado filtra por empresa (A9): la fila la trae de verdad, como en la base.
    idEmpresa: estado.idEmpresaLista,
    idLista: estado.listaBorrada ? null : 7,
    fecha: new Date('2026-03-12T00:00:00.000Z'),
    estado: estado.estadoCotizacion,
    notas: cabecera.notas ?? null,
    // ── Encabezado CONGELADO, tal como la emisión lo escribió (H1) ──
    idCliente: cabecera.idCliente,
    idClienteDepartamento: cabecera.idClienteDepartamento,
    nombreCliente: cabecera.nombreCliente,
    nombreDepartamento: cabecera.nombreDepartamento,
    folioLista: cabecera.folioLista,
    motivoCancelacion: estado.updates.at(-1)?.motivoCancelacion ?? null,
    canceladaPorId: estado.updates.at(-1)?.canceladaPorId ?? null,
    canceladaEn: estado.updates.at(-1)?.canceladaEn ?? null,
    creadoEn: new Date('2026-03-12T10:00:00.000Z'),
    creadoPorId: 'usuario-prueba',
    lineas: estado.lineasCreadas.map((l, i) => ({
      id: 900 + i,
      // Con la lista borrada, la PROCEDENCIA se va a null y los valores congelados se quedan.
      idListaLinea: estado.listaBorrada ? null : l.idListaLinea,
      idPrecosto: estado.listaBorrada ? null : l.idPrecosto,
      versionPrecosto: l.versionPrecosto,
      codigoModelo: l.codigoModelo,
      descripcionModelo: l.descripcionModelo,
      numeroCliente: l.numeroCliente,
      precioUnit: D(Number(l.precioUnit)),
    })),
  };
}

/** Emite con el doble ya listo y devuelve el estado para inspeccionarlo. */
async function emitirConFake(
  estado: EstadoFake,
  sesion = negociador(),
): Promise<Awaited<ReturnType<typeof emitirCotizacion>>> {
  return emitirCotizacion(sesion, { idLista: 7 }, { tx: txFake(estado) });
}

// ── 🔴 EL CONGELADO ─────────────────────────────────────────────────────────────────

describe('🔴 Congelado — la cotización guarda VALORES, no punteros a la lista', () => {
  it('lo que se escribe son los precios y textos COPIADOS (no las FK solas)', async () => {
    const estado = estadoInicial();
    await emitirConFake(estado);

    expect(estado.lineasCreadas).toHaveLength(5);
    expect(estado.lineasCreadas[0]).toMatchObject({
      idListaLinea: 10,
      idPrecosto: 1010,
      versionPrecosto: 1,
      codigoModelo: 'MOD-A',
      descripcionModelo: 'Jogger',
      numeroCliente: 'CA-001',
      precioUnit: 137,
    });
    // La descripción/número nulos se copian como nulos (no se "resuelven" desde ningún lado).
    expect(estado.lineasCreadas[2]).toMatchObject({
      codigoModelo: 'MOD-C',
      descripcionModelo: null,
      numeroCliente: null,
      precioUnit: 95.5,
    });
  });

  it('⭐ mover el precio de la LISTA después de emitir NO cambia lo que dice el documento', async () => {
    const estado = estadoInicial();
    const cotizacion = await emitirConFake(estado);
    expect(cotizacion.lineas[0]?.precioUnit).toBe(137);
    expect(cotizacion.total).toBe(682.5);

    // La mesa sigue negociando: el renglón de la lista cambia de precio, de modelo y de descripción.
    const fuente = estado.lineasLista[0];
    if (fuente === undefined) {
      throw new Error('El estado de prueba perdió su primer renglón.');
    }
    fuente.precioAprobado = D(999);
    fuente.desarrollo.modelo.codigo = 'MOD-A-RENOMBRADO';
    fuente.desarrollo.modelo.descripcion = 'Jogger v2';

    // El documento EMITIDO se relee tal cual: sigue diciendo lo de marzo.
    const releida = await obtenerCotizacion(negociador(), 500, { tx: txFake(estado) });
    expect(releida.lineas[0]?.precioUnit).toBe(137);
    expect(releida.lineas[0]?.codigoModelo).toBe('MOD-A');
    expect(releida.lineas[0]?.descripcionModelo).toBe('Jogger');
    expect(releida.total).toBe(682.5);
  });

  it('`congelarRenglones` copia TODOS los campos del papel (no sólo el precio)', () => {
    const renglones: RenglonListaParaCongelar[] = [
      {
        id: 10,
        idPrecosto: 77,
        versionPrecosto: 3,
        codigoModelo: 'MOD-Z',
        descripcionModelo: 'Chamarra',
        numeroCliente: 'CA-Z',
        precioAprobado: 412.75,
      },
    ];
    expect(congelarRenglones(renglones, 5, { creadoPorId: 'u', modificadoPorId: 'u' })).toEqual([
      {
        idCotizacion: 5,
        idListaLinea: 10,
        idPrecosto: 77,
        versionPrecosto: 3,
        codigoModelo: 'MOD-Z',
        descripcionModelo: 'Chamarra',
        numeroCliente: 'CA-Z',
        precioUnit: 412.75,
        creadoPorId: 'u',
        modificadoPorId: 'u',
      },
    ]);
  });

  it('la proyección lee las columnas del DOCUMENTO (importes ocultos sin ver-importes)', () => {
    const estado = estadoInicial();
    estado.lineasCreadas = [
      {
        idListaLinea: 10,
        idPrecosto: 1010,
        versionPrecosto: 1,
        codigoModelo: 'MOD-A',
        descripcionModelo: 'Jogger',
        numeroCliente: 'CA-001',
        precioUnit: 137,
      },
    ];
    const fila = cotizacionGuardada(estado) as never;
    expect(aCotizacionSalida(fila, true).lineas[0]?.precioUnit).toBe(137);
    expect(aCotizacionSalida(fila, true).total).toBe(137);
    // Sin `consultas.ver-importes` el precio se oculta, pero el modelo se sigue viendo.
    const sinImportes = aCotizacionSalida(fila, false);
    expect(sinImportes.lineas[0]?.precioUnit).toBeNull();
    expect(sinImportes.lineas[0]?.codigoModelo).toBe('MOD-A');
    expect(sinImportes.total).toBeNull();
  });
});

// ── 🔴 H1: el documento es AUTOSUFICIENTE ───────────────────────────────────────────

describe('🔴 H1 — el papel se imprime igual aunque su lista deje de existir', () => {
  it('la emisión CONGELA el encabezado (cliente, departamento y folio de lista) como valores', async () => {
    const estado = estadoInicial();
    await emitirConFake(estado);
    expect(estado.cabecera).toMatchObject({
      idCliente: 3,
      idClienteDepartamento: 4,
      nombreCliente: 'C&A',
      nombreDepartamento: 'NIÑOS',
      folioLista: 7n,
    });
  });

  it('⭐ quitar el renglón de la lista (o borrarla) NO cambia una letra del documento', async () => {
    const estado = estadoInicial();
    const antes = await emitirConFake(estado);

    // Alguien quita los renglones y borra la lista: `SetNull` deja los punteros en null. Antes esto
    // era IMPOSIBLE — el `Restrict` atrapaba la lista y, con `@@unique([idDesarrollo])`, dejaba a
    // esos desarrollos sin poder entrar NUNCA a otra lista. Ahora se puede, y el papel no se entera.
    estado.listaBorrada = true;
    const despues = await obtenerCotizacion(negociador(), 500, { tx: txFake(estado) });

    // Mismo cliente, mismo departamento, misma lista de origen, mismos renglones, mismos precios.
    expect(despues.nombreCliente).toBe(antes.nombreCliente);
    expect(despues.nombreDepartamento).toBe(antes.nombreDepartamento);
    expect(despues.folioLista).toBe(antes.folioLista);
    expect(despues.idCliente).toBe(antes.idCliente);
    expect(despues.lineas.map((l) => [l.codigoModelo, l.precioUnit, l.versionPrecosto])).toEqual(
      antes.lineas.map((l) => [l.codigoModelo, l.precioUnit, l.versionPrecosto]),
    );
    expect(despues.total).toBe(antes.total);

    // Lo ÚNICO que cambia son los punteros de procedencia, que para eso son nullable.
    expect(despues.idLista).toBeNull();
    expect(despues.lineas.every((l) => l.idListaLinea === null)).toBe(true);
  });

  it('el LISTADO también se sostiene solo (es otra proyección, con su propio encabezado)', async () => {
    const estado = estadoInicial();
    await emitirConFake(estado);
    estado.listaBorrada = true;

    const listado = await listarCotizaciones(negociador(), {}, { tx: txFake(estado) });
    expect(listado).toHaveLength(1);
    expect(listado[0]?.nombreCliente).toBe('C&A');
    expect(listado[0]?.nombreDepartamento).toBe('NIÑOS');
    expect(listado[0]?.folioLista).toBe(7);
    expect(listado[0]?.idLista).toBeNull();
    expect(listado[0]?.totalRenglones).toBe(5);
    expect(listado[0]?.total).toBe(682.5);
  });

  it('el filtro por CLIENTE va contra la columna propia, no contra la lista (que puede no estar)', async () => {
    const estado = estadoInicial();
    await emitirConFake(estado);
    estado.listaBorrada = true;

    // El cliente del documento es el 3 (congelado en la emisión).
    expect(
      await listarCotizaciones(negociador(), { idCliente: 3 }, { tx: txFake(estado) }),
    ).toHaveLength(1);
    expect(
      await listarCotizaciones(negociador(), { idCliente: 99 }, { tx: txFake(estado) }),
    ).toHaveLength(0);
  });

  it('y el IMPRESO sale idéntico con la lista borrada (es lo único que ve el cliente)', async () => {
    const estado = estadoInicial();
    await emitirConFake(estado);
    const conLista = await armarDatosImpresoCotizacion(negociador(), 500, { tx: txFake(estado) });

    estado.listaBorrada = true;
    const sinLista = await armarDatosImpresoCotizacion(negociador(), 500, { tx: txFake(estado) });

    expect(sinLista.cliente).toBe(conLista.cliente);
    expect(sinLista.departamento).toBe(conLista.departamento);
    expect(sinLista.folioLista).toBe(conLista.folioLista);
    expect(sinLista.renglones).toEqual(conLista.renglones);
    expect(sinLista.total).toBe(conLista.total);
  });
});

// ── 🔴 Los CINCO modelos completos ──────────────────────────────────────────────────

describe('🔴 La cotización lleva TODOS los modelos de la lista (regla de Daniel)', () => {
  it('emite los 5 renglones aunque en esta vuelta sólo hayan cambiado algunos', async () => {
    const estado = estadoInicial();
    const cotizacion = await emitirConFake(estado);
    expect(cotizacion.lineas.map((l) => l.codigoModelo)).toEqual([
      'MOD-A',
      'MOD-B',
      'MOD-C',
      'MOD-D',
      'MOD-E',
    ]);
    // No hay parámetro para pedir "sólo estos 3": la entrada es la lista entera, a propósito.
    expect(estado.lineasCreadas).toHaveLength(5);
  });

  it('una lista SIN renglones no produce una hoja en blanco: se rechaza', async () => {
    const estado = estadoInicial();
    estado.lineasLista = [];
    await expect(emitirConFake(estado)).rejects.toBeInstanceOf(ErrorConflicto);
  });
});

// ── 🔴 No se emite un precio sin aprobar ────────────────────────────────────────────

describe('🔴 No se emite una cotización con un precio SIN APROBAR', () => {
  it('rechaza y NOMBRA los modelos que faltan (no un conteo)', async () => {
    const estado = estadoInicial();
    estado.lineasLista[1]!.precioAprobado = null;
    estado.lineasLista[3]!.precioAprobado = null;

    await expect(emitirConFake(estado)).rejects.toBeInstanceOf(ErrorConflicto);
    let mensaje = '';
    try {
      await emitirConFake(estadoConFaltantes());
    } catch (error) {
      mensaje = error instanceof Error ? error.message : '';
    }
    expect(mensaje).toContain('MOD-B');
    expect(mensaje).toContain('MOD-D');
    expect(mensaje).not.toContain('MOD-A');
  });

  it('NO escribe nada cuando rechaza (ni encabezado ni renglones)', async () => {
    const estado = estadoConFaltantes();
    await expect(emitirConFake(estado)).rejects.toBeInstanceOf(ErrorConflicto);
    expect(estado.cabecera).toBeNull();
    expect(estado.lineasCreadas).toHaveLength(0);
  });

  it('`exigirRenglonesAprobados` deja pasar sólo cuando TODOS tienen precio', () => {
    const ok: RenglonListaParaCongelar[] = [
      {
        id: 1,
        idPrecosto: 1,
        versionPrecosto: 1,
        codigoModelo: 'A',
        descripcionModelo: null,
        numeroCliente: null,
        precioAprobado: 1,
      },
    ];
    expect(() => exigirRenglonesAprobados(ok)).not.toThrow();
    expect(() => exigirRenglonesAprobados([])).toThrow(ErrorConflicto);
    expect(() => exigirRenglonesAprobados([{ ...ok[0]!, precioAprobado: null }])).toThrow(
      ErrorConflicto,
    );
  });
});

/** Estado con MOD-B y MOD-D sin aprobar (para los mensajes del guard). */
function estadoConFaltantes(): EstadoFake {
  const estado = estadoInicial();
  estado.lineasLista[1]!.precioAprobado = null;
  estado.lineasLista[3]!.precioAprobado = null;
  return estado;
}

// ── 🔴 Folio por secuencia atómica (A3) ─────────────────────────────────────────────

describe('🔴 Folio por secuencia atómica (A3) — nunca Max()+1', () => {
  it('el folio sale de la tabla `secuencias` con INSERT … ON CONFLICT, no de un MAX', async () => {
    const estado = estadoInicial();
    const cotizacion = await emitirConFake(estado);
    expect(cotizacion.folio).toBe(41);

    const sql = estado.sqlConsultas.join('\n');
    expect(sql).toContain('secuencias');
    expect(sql).toContain('ON CONFLICT');
    expect(sql.toUpperCase()).not.toContain('MAX(');
    // Y la emisión se serializa con el MISMO advisory lock de la lista (foto coherente).
    expect(sql).toContain('pg_advisory_xact_lock');
  });

  it('un rechazo por precio sin aprobar NO quema un folio (el guard va antes)', async () => {
    const estado = estadoConFaltantes();
    await expect(emitirConFake(estado)).rejects.toBeInstanceOf(ErrorConflicto);
    expect(estado.sqlConsultas.join('\n')).not.toContain('secuencias');
  });
});

// ── 🔴 Inmutabilidad + cancelación ──────────────────────────────────────────────────

describe('🔴 Inmutabilidad: el documento no se edita ni se borra', () => {
  it('el módulo NO expone ninguna forma de editar o borrar una cotización', async () => {
    const modulo = await import('./cotizaciones.js');
    const mutaciones = Object.keys(modulo).filter((k) =>
      /^(editar|actualizar|modificar|eliminar|borrar)/i.test(k),
    );
    expect(mutaciones).toEqual([]);
  });

  it('cancelar sólo pone el SELLO: no toca los renglones ni los datos del papel', async () => {
    const estado = estadoInicial();
    await emitirConFake(estado);
    const antes = JSON.stringify(estado.lineasCreadas);

    const cancelada = await cancelarCotizacion(
      negociador(),
      500,
      { motivo: 'El cliente cambió la curva de tallas' },
      { tx: txFake(estado) },
    );

    expect(cancelada.estado).toBe('cancelada');
    expect(cancelada.motivoCancelacion).toBe('El cliente cambió la curva de tallas');
    // Los renglones congelados siguen intactos: cancelar dice "ya no está vigente", no "no pasó".
    expect(JSON.stringify(estado.lineasCreadas)).toBe(antes);
    expect(cancelada.lineas).toHaveLength(5);
    expect(cancelada.lineas[0]?.precioUnit).toBe(137);
    // El UPDATE escribe SÓLO las columnas del sello (+ auditoría), nunca contenido del documento.
    const update = estado.updates.at(-1) ?? {};
    expect(Object.keys(update).sort()).toEqual([
      'canceladaEn',
      'canceladaPorId',
      'estado',
      'modificadoPorId',
      'motivoCancelacion',
    ]);
  });

  it('la cancelación queda AUDITADA con su motivo (A7)', async () => {
    const estado = estadoInicial();
    await emitirConFake(estado);
    await cancelarCotizacion(negociador(), 500, { motivo: 'Se duplicó' }, { tx: txFake(estado) });
    const ultima = estado.bitacora.at(-1);
    expect(ultima?.entidad).toBe('Cotizacion');
    expect(ultima?.accion).toBe('CANCELAR');
    expect(JSON.stringify(ultima?.datos)).toContain('Se duplicó');
  });

  it('re-cancelar se rechaza: el motivo original es el bueno', async () => {
    const estado = estadoInicial();
    await emitirConFake(estado);
    await cancelarCotizacion(
      negociador(),
      500,
      { motivo: 'Primer motivo' },
      { tx: txFake(estado) },
    );
    await expect(
      cancelarCotizacion(negociador(), 500, { motivo: 'Otro motivo' }, { tx: txFake(estado) }),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('cancelar exige motivo (no se cancela "porque sí")', async () => {
    const estado = estadoInicial();
    await emitirConFake(estado);
    await expect(
      cancelarCotizacion(negociador(), 500, { motivo: '  ' }, { tx: txFake(estado) }),
    ).rejects.toThrow();
  });
});

// ── A9: empresa activa ──────────────────────────────────────────────────────────────

describe('A9 — la cotización de otra empresa NO EXISTE para esta sesión', () => {
  it('emitir contra una lista de otra empresa da 404 (no 409: un 409 confirmaría que existe)', async () => {
    const estado = estadoInicial();
    estado.idEmpresaLista = 99;
    await expect(emitirConFake(estado)).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });

  it('obtener una cotización de otra empresa da 404', async () => {
    const estado = estadoInicial();
    await emitirConFake(estado);
    const otraEmpresa = sesionDePrueba({
      idEmpresaActiva: 99,
      permisos: ['listas.ver', 'listas.negociar'],
    });
    await expect(
      obtenerCotizacion(otraEmpresa, 500, { tx: txFake(estado) }),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });
});

// ── A4: permisos (deny-by-default) ──────────────────────────────────────────────────

describe('Permisos (A4) — sin permiso nuevo: emitir/cancelar = listas.negociar, ver = listas.ver', () => {
  it('emitir sin `listas.negociar` lanza ErrorPermiso ANTES de tocar la base', async () => {
    const estado = estadoInicial();
    await expect(
      emitirCotizacion(sinNada(), { idLista: 7 }, { tx: txFake(estado) }),
    ).rejects.toBeInstanceOf(ErrorPermiso);
    // `listas.ver` (consulta) NO alcanza para mandarle un papel al cliente.
    await expect(
      emitirCotizacion(soloVer(), { idLista: 7 }, { tx: txFake(estado) }),
    ).rejects.toBeInstanceOf(ErrorPermiso);
    expect(estado.sqlConsultas).toHaveLength(0);
    expect(estado.cabecera).toBeNull();
  });

  it('cancelar sin `listas.negociar` lanza ErrorPermiso', async () => {
    const estado = estadoInicial();
    await expect(
      cancelarCotizacion(soloVer(), 500, { motivo: 'no' }, { tx: txFake(estado) }),
    ).rejects.toBeInstanceOf(ErrorPermiso);
    expect(estado.updates).toHaveLength(0);
  });

  it('ver (obtener/listar) sin `listas.ver` lanza ErrorPermiso', async () => {
    const estado = estadoInicial();
    await expect(obtenerCotizacion(sinNada(), 500, { tx: txFake(estado) })).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
    await expect(listarCotizaciones(sinNada(), {}, { tx: txFake(estado) })).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });
});
