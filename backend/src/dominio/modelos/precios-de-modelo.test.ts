/**
 * ⭐ La regla de QUIÉN VE EL DINERO DEL MODELO Y DE LA ORDEN (fila 0.249 parte C), en pruebas puras.
 *
 * Tres cosas se fijan aquí:
 *  1. La regla: las llaves de VOCABULARIO (`modelos.ver`, `ordenes.ver`, `desarrollo.ver`) solas NO
 *     dejan ver un precio; cada llave de la lista, sola, sí.
 *  2. 🔑 **La invariante que impide que un formulario PISE un precio**: toda llave que ESCRIBE uno de
 *     estos precios DESDE UN FORMULARIO está en su lista de lectura. Se comprueba contra el CÓDIGO
 *     (se lee el `verificarPermiso` de cada escritor), no contra una lista copiada a mano.
 *  3. Los redactores: qué se tapa, qué NO, y que el aviso de cambio de precio pierde las CIFRAS.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { ClavePermiso, RecetaOrden } from '../../contrato/index.js';
import { Prisma } from '../../datos/index.js';
import { definirRoles, PERFILES_EDITABLES } from '../../../prisma/seed.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { LLAVES_PRECIO_AVIO, LLAVES_PRECIO_TELA } from '../catalogos/precios-de-catalogo.js';
import { ocultarPreciosDeTelaSiNoPuede, type TelaConColores } from '../catalogos/telas.js';
import {
  detalleCambioDePrecio,
  ocultarPreciosDeRecetaSiNoPuede,
} from '../produccion/receta-orden.js';
import { ocultarPrecioDeArteSiNoPuede } from './arte-modelo.js';
import {
  ocultarPreciosDeAvioBomSiNoPuede,
  ocultarPreciosDeTelaBomSiNoPuede,
  type ModeloAvioDetalle,
  type ModeloTelaDetalle,
} from './bom-modelo.js';
import { ocultarPreciosDeMedidasSiNoPuede, type MedidasAvio } from './medidas-avio-talla.js';
import {
  LLAVES_MAQUILA_DE_REFERENCIA,
  LLAVES_PRECIO_DE_ORDEN,
  LLAVES_PRECIO_MODELO,
  ocultarPreciosDeModeloSiNoPuede,
  puedeVerMaquilaDeReferencia,
  puedeVerMetaConseguida,
  puedeVerMetaPrometida,
  puedeVerPreciosDeModelo,
  puedeVerPreciosDeOrden,
} from './precios-de-modelo.js';

const sesion = (permisos: ClavePermiso[]) => sesionDePrueba({ permisos });

// ── Lectura del código de los escritores ───────────────────────────────────────

/** Lee un archivo del dominio relativo a `src/dominio/`. */
function fuente(ruta: string): string {
  return readFileSync(fileURLToPath(new URL(`../${ruta}`, import.meta.url)), 'utf8');
}

/**
 * El CUERPO de `async function <nombre>` (exportada o no, genérica o no) dentro de `texto`: desde
 * su firma hasta la primera `}` en la columna 0 (prettier sangra todo lo de adentro). Mismo criterio
 * que la prueba de la parte B: buscar hasta el final del archivo leería la llave de la función de
 * ABAJO y dejaría pasar a un escritor que dejó de verificar.
 */
function cuerpoDe(texto: string, nombre: string): string | null {
  const firma = new RegExp(`(?:export )?async function ${nombre}[(<]`).exec(texto);
  if (firma === null) return null;
  const resto = texto.slice(firma.index);
  const cierre = resto.search(/\n\}/);
  return cierre < 0 ? resto : resto.slice(0, cierre + 2);
}

/** La llave de la PRIMERA `verificarPermiso` dentro del cuerpo. Falla en voz alta si no hay. */
function llaveEnTexto(texto: string, nombre: string, donde: string): string {
  const cuerpo = cuerpoDe(texto, nombre);
  expect(cuerpo, `${donde}: no existe la función ${nombre}`).not.toBeNull();
  const coincidencia = /verificarPermiso\(sesion, '([a-z0-9.-]+)'\)/.exec(cuerpo ?? '');
  expect(
    coincidencia,
    `${donde}: ${nombre} no llama a verificarPermiso en SU cuerpo`,
  ).not.toBeNull();
  return coincidencia?.[1] ?? '';
}

function llaveDe(ruta: string, nombre: string): ClavePermiso {
  return llaveEnTexto(fuente(ruta), nombre, ruta) as ClavePermiso;
}

/** Escritores del DINERO PROPIO del modelo desde un formulario (maquila/corte base, arte). */
const ESCRITORES_MODELO: readonly (readonly [string, string])[] = [
  ['modelos/modelos.ts', 'crearModelo'],
  ['modelos/modelos.ts', 'actualizarModelo'],
  ['modelos/arte-modelo.ts', 'crearArte'],
  ['modelos/arte-modelo.ts', 'actualizarArte'],
  ['modelos/arte-modelo.ts', 'copiarArteDeOtroModelo'],
];

/**
 * Los AMARRES del BOM no llevan precio, pero DECIDEN cuál costea (el editor elige el proveedor por
 * su precio): quien los escribe tiene que ver los precios de catálogo con los que elige.
 */
const ESCRITORES_BOM_TELA: readonly (readonly [string, string])[] = [
  ['modelos/bom-modelo.ts', 'reemplazarTelasBom'],
];
const ESCRITORES_BOM_AVIO: readonly (readonly [string, string])[] = [
  ['modelos/bom-modelo.ts', 'reemplazarAviosBom'],
  ['modelos/medidas-avio-talla.ts', 'guardarMedidasAvio'],
];

/** Las mutaciones de la receta de la ORDEN que aceptan `precio` en el renglón. */
const ESCRITORES_RECETA_ORDEN = ['agregarRenglonReceta', 'editarRenglonReceta'] as const;

describe('quién ve el dinero propio del MODELO (corte base, arte)', () => {
  it('con sólo modelos.ver (ni con ordenes.ver ni desarrollo.ver) NO lo ve', () => {
    expect(puedeVerPreciosDeModelo(sesion(['modelos.ver', 'ordenes.ver', 'desarrollo.ver']))).toBe(
      false,
    );
  });

  it.each(LLAVES_PRECIO_MODELO)('con %s (sola) lo ve', (llave) => {
    expect(puedeVerPreciosDeModelo(sesion([llave]))).toBe(true);
  });

  it('ordenes.precio-maquila NO abre el corte ni el arte (sólo la maquila de referencia)', () => {
    const s = sesion(['modelos.ver', 'ordenes.precio-maquila']);
    expect(puedeVerPreciosDeModelo(s)).toBe(false);
    expect(puedeVerMaquilaDeReferencia(s)).toBe(true);
  });

  it.each(ESCRITORES_MODELO)('%s · %s escribe con una llave que también LEE', (r, f) => {
    const llave = llaveDe(r, f);
    expect(LLAVES_PRECIO_MODELO).toContain(llave);
    expect(LLAVES_MAQUILA_DE_REFERENCIA).toContain(llave);
  });
});

describe('quién ve la MAQUILA DE REFERENCIA (Modelo.maquilaBase = maquilaReferencia de la orden)', () => {
  it('con sólo modelos.ver u ordenes.ver NO la ve', () => {
    expect(puedeVerMaquilaDeReferencia(sesion(['modelos.ver', 'ordenes.ver']))).toBe(false);
  });

  // Escrita a mano a propósito: la excepción que pidió el lead para Producción.
  it.each([
    'consultas.ver-importes',
    'modelos.administrar',
    'ordenes.precio-maquila',
    'ordenes.ver-precio-real-maquila',
  ] as const)('con %s (sola) la ve', (llave) => {
    expect(puedeVerMaquilaDeReferencia(sesion([llave]))).toBe(true);
  });

  it('quien CAPTURA el precio real de maquila ve la referencia (actualizarPreciosOrden)', () => {
    expect(LLAVES_MAQUILA_DE_REFERENCIA).toContain(
      llaveDe('produccion/precios-orden.ts', 'actualizarPreciosOrden'),
    );
  });
});

describe('quién ve los precios CONGELADOS de la ORDEN (receta e histórico)', () => {
  it('con sólo ordenes.ver y desarrollo.ver NO los ve', () => {
    expect(puedeVerPreciosDeOrden(sesion(['ordenes.ver', 'desarrollo.ver', 'modelos.ver']))).toBe(
      false,
    );
  });

  it.each(LLAVES_PRECIO_DE_ORDEN)('con %s (sola) los ve', (llave) => {
    expect(puedeVerPreciosDeOrden(sesion([llave]))).toBe(true);
  });

  it('la llave de las mutaciones de la receta (enRecetaEditable) LEE los precios', () => {
    expect(LLAVES_PRECIO_DE_ORDEN).toContain(
      llaveDe('produccion/receta-orden.ts', 'enRecetaEditable'),
    );
  });

  it.each(ESCRITORES_RECETA_ORDEN)(
    '%s escribe SÓLO a través de enRecetaEditable (no con una llave propia)',
    (nombre) => {
      const cuerpo = cuerpoDe(fuente('produccion/receta-orden.ts'), nombre);
      expect(cuerpo, `no existe ${nombre}`).not.toBeNull();
      expect(cuerpo).toContain('enRecetaEditable(');
      expect(cuerpo).not.toMatch(/verificarPermiso\(sesion, '/);
    },
  );
});

describe('el BOM usa la regla de CATÁLOGO de la parte B, y sus escritores la cumplen', () => {
  it.each(ESCRITORES_BOM_TELA)('%s · %s escribe con una llave que LEE precios de tela', (r, f) => {
    expect(LLAVES_PRECIO_TELA).toContain(llaveDe(r, f));
  });

  it.each(ESCRITORES_BOM_AVIO)('%s · %s escribe con una llave que LEE precios de avío', (r, f) => {
    expect(LLAVES_PRECIO_AVIO).toContain(llaveDe(r, f));
  });

  it('las reglas del catálogo CONTIENEN a la del modelo: nadie ve la maquila sin ver su BOM', () => {
    for (const llave of LLAVES_PRECIO_MODELO) {
      expect(LLAVES_PRECIO_TELA).toContain(llave);
      expect(LLAVES_PRECIO_AVIO).toContain(llave);
    }
  });
});

describe('ninguna llave de VOCABULARIO se coló en las reglas', () => {
  it('ni modelos.ver, ni ordenes.ver, ni desarrollo.ver abren dinero del modelo o de la orden', () => {
    const vocabulario: ClavePermiso[] = ['modelos.ver', 'ordenes.ver', 'desarrollo.ver'];
    for (const llave of vocabulario) {
      expect(LLAVES_PRECIO_MODELO).not.toContain(llave);
      expect(LLAVES_MAQUILA_DE_REFERENCIA).not.toContain(llave);
      expect(LLAVES_PRECIO_DE_ORDEN).not.toContain(llave);
    }
  });
});

describe('la prueba del invariante NO es un adorno (controles de `llaveEnTexto`)', () => {
  const MUESTRA = [
    'export async function escritorSinReja(sesion: SesionUsuario): Promise<void> {',
    "  if (!tienePermiso(sesion, 'modelos.administrar')) return;",
    '}',
    '',
    'async function vecinaGenerica<T>(sesion: SesionUsuario): Promise<T> {',
    "  verificarPermiso(sesion, 'modelos.administrar');",
    '}',
    '',
  ].join('\n');

  it('una función que NO verifica en su cuerpo se pone ROJA aunque la de abajo sí verifique', () => {
    expect(() => llaveEnTexto(MUESTRA, 'escritorSinReja', 'muestra')).toThrow(
      /no llama a verificarPermiso en SU cuerpo/,
    );
  });

  it('y la que sí verifica (no exportada y genérica) se lee bien', () => {
    expect(llaveEnTexto(MUESTRA, 'vecinaGenerica', 'muestra')).toBe('modelos.administrar');
  });
});

// ── Los redactores ─────────────────────────────────────────────────────────────

describe('ocultarPreciosDeModeloSiNoPuede', () => {
  const modelo = {
    id: 1,
    codigo: 'M-1',
    descripcion: 'Sudadera',
    maquilaBase: new Prisma.Decimal('23.5'),
    corteBase: new Prisma.Decimal('4.25'),
    metaCostoPrometido: new Prisma.Decimal('81.5'),
    metaCostoConseguido: new Prisma.Decimal('79.25'),
  };

  it('con sólo modelos.ver: maquila y corte en null, con sus dos marcas; la ficha intacta', () => {
    const r = ocultarPreciosDeModeloSiNoPuede(sesion(['modelos.ver']), modelo);
    expect(r.maquilaBase).toBeNull();
    expect(r.corteBase).toBeNull();
    expect(r.maquilaOculta).toBe(true);
    expect(r.preciosOcultos).toBe(true);
    expect(r.descripcion).toBe('Sudadera');
  });

  it('con ordenes.precio-maquila: la maquila SÍ, el corte NO', () => {
    const r = ocultarPreciosDeModeloSiNoPuede(sesion(['ordenes.precio-maquila']), modelo);
    expect(r.maquilaBase?.toString()).toBe('23.5');
    expect(r.maquilaOculta).toBe(false);
    expect(r.corteBase).toBeNull();
    expect(r.preciosOcultos).toBe(true);
  });

  it('con modelos.administrar: maquila y corte completos; la META de costo NO (no es su llave)', () => {
    const r = ocultarPreciosDeModeloSiNoPuede(sesion(['modelos.administrar']), modelo);
    expect(r.maquilaBase?.toString()).toBe('23.5');
    expect(r.corteBase?.toString()).toBe('4.25');
    expect(r.maquilaOculta).toBe(false);
    expect(r.preciosOcultos).toBe(false);
    expect(r.metaCostoPrometido).toBeNull();
    expect(r.metaCostoConseguido).toBeNull();
  });

  // ⭐ 0.249 parte D: la meta de costo, partida (ver `puedeVerMetaPrometida`).
  it('meta: con sólo modelos.ver, las dos en null', () => {
    const r = ocultarPreciosDeModeloSiNoPuede(sesion(['modelos.ver']), modelo);
    expect(r.metaCostoPrometido).toBeNull();
    expect(r.metaCostoConseguido).toBeNull();
  });

  it('meta: quien FIRMA sin ver importes ve lo conseguido (lo teclea) y NO lo prometido', () => {
    const r = ocultarPreciosDeModeloSiNoPuede(sesion(['modelos.aprobar-receta']), modelo);
    expect(r.metaCostoConseguido?.toString()).toBe('79.25');
    expect(r.metaCostoPrometido).toBeNull();
  });

  it('meta: con consultas.ver-importes, las dos completas', () => {
    const r = ocultarPreciosDeModeloSiNoPuede(sesion(['consultas.ver-importes']), modelo);
    expect(r.metaCostoPrometido?.toString()).toBe('81.5');
    expect(r.metaCostoConseguido?.toString()).toBe('79.25');
  });

  it('las reglas de la meta: prometida = ver-importes; conseguida = ver-importes ∨ aprobar-receta', () => {
    expect(puedeVerMetaPrometida(sesion(['consultas.ver-importes']))).toBe(true);
    expect(puedeVerMetaPrometida(sesion(['modelos.aprobar-receta']))).toBe(false);
    expect(puedeVerMetaConseguida(sesion(['consultas.ver-importes']))).toBe(true);
    expect(puedeVerMetaConseguida(sesion(['modelos.aprobar-receta']))).toBe(true);
    expect(puedeVerMetaConseguida(sesion(['modelos.ver', 'modelos.administrar']))).toBe(false);
  });
});

describe('los renglones del BOM, el arte y las medidas', () => {
  const tela: ModeloTelaDetalle = {
    idTela: 1,
    nombre: 'Felpa',
    consumoPorPrenda: 1,
    nombreComplemento: null,
    consumoComplementoPorPrenda: null,
    paraPreCosto: true,
    paraProduccion: true,
    paraCosto: true,
    idTelaProveedor: 7,
    proveedorAmarrado: 'Textiles',
    precioPorColor: false,
    precioCosteo: 98.76,
    origenPrecio: 'amarre',
    proveedorPrecio: 'Textiles',
    amarreIgnorado: false,
    precioReferencia: 87.65,
  };
  const avio: ModeloAvioDetalle = {
    idAvio: 2,
    clave: 'CIE',
    descripcion: 'Cierre',
    consumoPorPrenda: 1,
    paraPreCosto: true,
    paraProduccion: true,
    paraCosto: true,
    consumoPorTalla: false,
    idAvioProveedor: 3,
    proveedorAmarrado: 'Avíos SA',
    precioCosteo: 5.5,
    origenPrecio: 'mas-barato',
    proveedorPrecio: 'Avíos SA',
    amarreIgnorado: true,
    precioReferencia: 6.5,
  };

  it('tela con sólo modelos.ver: precios y proveedor del precio en null; el AMARRE se queda', () => {
    const r = ocultarPreciosDeTelaBomSiNoPuede(sesion(['modelos.ver']), tela);
    expect(r).toMatchObject({
      precioCosteo: null,
      proveedorPrecio: null,
      precioReferencia: null,
      preciosOcultos: true,
      idTelaProveedor: 7,
      proveedorAmarrado: 'Textiles',
    });
  });

  it('tela con compras.administrar (ve precios de tela en el catálogo): completa', () => {
    const r = ocultarPreciosDeTelaBomSiNoPuede(sesion(['compras.administrar']), tela);
    expect(r).toMatchObject({
      precioCosteo: 98.76,
      precioReferencia: 87.65,
      preciosOcultos: false,
    });
  });

  it('avío con sólo modelos.ver: tapado; con avios.administrar: completo', () => {
    expect(ocultarPreciosDeAvioBomSiNoPuede(sesion(['modelos.ver']), avio)).toMatchObject({
      precioCosteo: null,
      proveedorPrecio: null,
      precioReferencia: null,
      preciosOcultos: true,
      amarreIgnorado: true,
    });
    expect(ocultarPreciosDeAvioBomSiNoPuede(sesion(['avios.administrar']), avio)).toMatchObject({
      precioCosteo: 5.5,
      preciosOcultos: false,
    });
  });

  it('arte: tapado con sólo modelos.ver, completo con consultas.ver-importes', () => {
    const arte = { id: 1, descripcion: 'Logo', precio: 12.5 };
    expect(ocultarPrecioDeArteSiNoPuede(sesion(['modelos.ver']), arte)).toEqual({
      id: 1,
      descripcion: 'Logo',
      precio: null,
      preciosOcultos: true,
    });
    expect(ocultarPrecioDeArteSiNoPuede(sesion(['consultas.ver-importes']), arte).precio).toBe(
      12.5,
    );
  });

  it('medidas por talla: el precio de la medida se tapa con la regla de AVÍO', () => {
    const medidas: MedidasAvio = {
      idModelo: 1,
      idAvio: 2,
      consumoPorTalla: false,
      tieneCurva: true,
      modoCaptura: 'medida',
      unidadConsumo: 'pza',
      unidadMedida: 'cm',
      avisos: [],
      tallas: [
        {
          idTalla: 1,
          etiquetaTalla: 'CH',
          consumo: 1,
          enCurva: true,
          idAvioMedida: 9,
          medidaAmarrada: '53 cm',
          precioMedida: 10.98,
        },
      ],
    };
    const tapadas = ocultarPreciosDeMedidasSiNoPuede(sesion(['modelos.ver']), medidas);
    expect(tapadas.preciosOcultos).toBe(true);
    expect(tapadas.tallas[0]).toMatchObject({ precioMedida: null, medidaAmarrada: '53 cm' });
    const completas = ocultarPreciosDeMedidasSiNoPuede(sesion(['avios.administrar']), medidas);
    expect(completas.tallas[0]?.precioMedida).toBe(10.98);
    expect(completas.preciosOcultos).toBe(false);
  });
});

/** Una receta mínima con un precio en cada sitio y un aviso de cambio de precio por tipo. */
function receta(): RecetaOrden {
  return {
    telas: [
      {
        id: 1,
        nombre: 'Felpa',
        precio: 111.11,
        precioModelo: 122.22,
        precioComplemento: 133.33,
        precioModeloOculto: false,
      },
    ],
    avios: [
      {
        id: 2,
        clave: 'CIE',
        precio: 144.44,
        precioModelo: 155.55,
        tallas: [{ idTalla: 1, etiqueta: 'CH', precioMedida: 166.66 }],
        precioModeloOculto: false,
      },
    ],
    artes: [
      {
        id: 3,
        descripcion: 'Logo',
        precio: 177.77,
        precioModelo: 188.88,
        precioModeloOculto: false,
      },
    ],
    desalineacion: {
      hayCambios: true,
      conOrdenCompra: false,
      critico: false,
      cambios: [
        {
          tipo: 'tela',
          idRenglon: 1,
          material: 'Felpa',
          idMaterialModelo: null,
          que: 'precio',
          detalle: detalleCambioDePrecio('precio', 'Felpa', { orden: 111.11, modelo: 122.22 }),
        },
        {
          tipo: 'avio',
          idRenglon: 2,
          material: 'CIE',
          idMaterialModelo: null,
          que: 'precio-mercado',
          detalle: detalleCambioDePrecio('precio-mercado', 'CIE', {
            orden: 144.44,
            modelo: 155.55,
          }),
        },
        {
          tipo: 'arte',
          idRenglon: 3,
          material: 'Logo',
          idMaterialModelo: null,
          que: 'precio',
          detalle: detalleCambioDePrecio('precio', 'Logo', { orden: 177.77, modelo: 188.88 }),
        },
        {
          tipo: 'tela',
          idRenglon: 1,
          material: 'Felpa',
          idMaterialModelo: null,
          que: 'consumo',
          detalle: 'La cantidad de "Felpa" pasó de 1 a 2 en el modelo.',
        },
      ],
    },
    preciosOcultos: false,
  } as unknown as RecetaOrden;
}
const CIFRAS = ['111.11', '122.22', '133.33', '144.44', '155.55', '166.66', '177.77', '188.88'];

describe('ocultarPreciosDeRecetaSiNoPuede — la receta de la orden y sus AVISOS', () => {
  it('el aviso CON cifras sí las trae (control: si no, la prueba de abajo no mediría nada)', () => {
    const texto = JSON.stringify(receta());
    expect(texto).toContain('$111.11');
    expect(texto).toContain('$155.55');
    expect(texto).toContain('$188.88');
  });

  it('con sólo ordenes.ver: NI UNA cifra en todo el objeto, avisos incluidos; las marcas dicen tapado', () => {
    const r = ocultarPreciosDeRecetaSiNoPuede(sesion(['ordenes.ver', 'desarrollo.ver']), receta());
    const texto = JSON.stringify(r);
    for (const cifra of CIFRAS) expect(texto, `filtró ${cifra}`).not.toContain(cifra);
    expect(r.preciosOcultos).toBe(true);
    expect(r.telas[0]?.precioModeloOculto).toBe(true);
    expect(r.avios[0]?.precioModeloOculto).toBe(true);
    expect(r.artes[0]?.precioModeloOculto).toBe(true);
    // El HECHO de que el precio se movió sigue diciéndose (sin cuánto).
    expect(r.desalineacion.cambios[0]?.que).toBe('precio');
    expect(r.desalineacion.cambios[0]?.detalle).toBe('El precio de "Felpa" cambió en el modelo.');
    expect(r.desalineacion.cambios[1]?.detalle).toContain('cambió el precio de compra');
    // Lo que no es precio no se toca.
    expect(r.desalineacion.cambios[3]?.detalle).toBe(
      'La cantidad de "Felpa" pasó de 1 a 2 en el modelo.',
    );
  });

  it.each(['consultas.ver-importes', 'modelos.administrar'] as const)(
    'con %s: la receta llega COMPLETA (cifras en los avisos incluidas)',
    (llave) => {
      const r = ocultarPreciosDeRecetaSiNoPuede(sesion(['ordenes.ver', llave]), receta());
      const texto = JSON.stringify(r);
      for (const cifra of CIFRAS) expect(texto).toContain(cifra);
      expect(r.preciosOcultos).toBe(false);
      expect(r.artes[0]?.precioModeloOculto).toBe(false);
    },
  );

  it('con desarrollo.administrar A SOLAS: ve lo que ESCRIBE (el congelado), no lo que repite del origen', () => {
    const r = ocultarPreciosDeRecetaSiNoPuede(
      sesion(['ordenes.ver', 'desarrollo.administrar']),
      receta(),
    );
    expect(r.preciosOcultos).toBe(false);
    expect(r.telas[0]).toMatchObject({
      precio: 111.11,
      precioModelo: null,
      precioComplemento: null,
    });
    expect(r.avios[0]).toMatchObject({ precio: 144.44, precioModelo: null });
    expect(r.avios[0]?.tallas[0]?.precioMedida).toBeNull();
    expect(r.artes[0]).toMatchObject({ precio: 177.77, precioModelo: null });
    // Sin el origen, NINGÚN aviso lleva cifras.
    const avisos = JSON.stringify(r.desalineacion);
    for (const cifra of CIFRAS) expect(avisos, `aviso con ${cifra}`).not.toContain(cifra);
  });

  /**
   * 🔴 H1 del reviewer — el perfil EXACTO de Ventas (sembrado): `desarrollo.administrar` +
   * `compras.administrar`, sin `consultas.ver-importes` ni `modelos.administrar`. Ve los precios de
   * catálogo de tela y avío (por compras), pero NO el precio del arte del modelo: en la receta ese
   * dato tampoco, y el aviso del arte sale sin cifras.
   */
  it('perfil de Ventas: tela y avío con su origen; el ARTE del modelo tapado, y su aviso sin cifras', () => {
    const ventas = definirRoles().find((rol) => rol.nombre === 'Ventas');
    expect(ventas, 'el rol Ventas existe en el seed').toBeDefined();
    const r = ocultarPreciosDeRecetaSiNoPuede(
      sesion([...(ventas?.permisos ?? [])] as ClavePermiso[]),
      receta(),
    );
    expect(r.telas[0]).toMatchObject({ precio: 111.11, precioModelo: 122.22 });
    expect(r.avios[0]).toMatchObject({ precio: 144.44, precioModelo: 155.55 });
    expect(r.artes[0]).toMatchObject({
      precio: 177.77,
      precioModelo: null,
      precioModeloOculto: true,
    });
    expect(r.desalineacion.cambios[0]?.detalle).toContain('$122.22');
    expect(r.desalineacion.cambios[2]?.detalle).toBe('El precio de "Logo" cambió en el modelo.');
    expect(JSON.stringify(r)).not.toContain('188.88');
  });
});

/**
 * 🔒🔒 PRUEBA DE CONTENCIÓN (H1 del reviewer): para CADA campo que la receta REPITE de su origen,
 * quien lo ve en la receta también lo ve en el origen — medido contra los REDACTORES REALES de cada
 * origen (BOM de tela y avío, medidas, arte del modelo, catálogo de telas), no contra la regla
 * copiada. Se recorre TODO el universo de llaves de dinero relevantes (2^n combinaciones) más los
 * roles del seed, así que una llave nueva en una regla que abra la receta sin abrir el origen se
 * pone roja aquí. Y un aviso con cifras exige ver LAS DOS puntas (lo congelado y el origen).
 */
describe('🔒 contención: lo que la receta repite nunca se ve más que en su origen', () => {
  const universo = [
    ...new Set<ClavePermiso>([
      ...LLAVES_PRECIO_DE_ORDEN,
      ...LLAVES_MAQUILA_DE_REFERENCIA,
      ...LLAVES_PRECIO_MODELO,
      ...LLAVES_PRECIO_TELA,
      ...LLAVES_PRECIO_AVIO,
    ]),
  ];
  const combinaciones: { nombre: string; permisos: ClavePermiso[] }[] = [];
  for (let mascara = 0; mascara < 1 << universo.length; mascara++) {
    const permisos = universo.filter((_, i) => (mascara & (1 << i)) !== 0);
    combinaciones.push({ nombre: permisos.join('+') || '(ninguna)', permisos });
  }
  for (const rol of [
    ...definirRoles().map((r) => ({ nombre: r.nombre, permisos: r.permisos })),
    ...PERFILES_EDITABLES.map((p) => ({ nombre: p.nombre, permisos: p.permisos })),
  ]) {
    combinaciones.push({
      nombre: `rol ${rol.nombre}`,
      permisos: [...rol.permisos] as ClavePermiso[],
    });
  }

  const telaBom = {
    precioCosteo: 1,
    proveedorPrecio: 'P',
    precioReferencia: 1,
  } as unknown as ModeloTelaDetalle;
  const avioBom = {
    precioCosteo: 1,
    proveedorPrecio: 'P',
    precioReferencia: 1,
  } as unknown as ModeloAvioDetalle;
  const medidas = {
    tallas: [{ idTalla: 1, precioMedida: 1 }],
  } as unknown as MedidasAvio;
  const telaCatalogo = {
    precioSugerido: new Prisma.Decimal(1),
    precioSugeridoComplemento: new Prisma.Decimal(1),
    colores: [],
  } as unknown as TelaConColores;

  it('el universo no está vacío (si no, la prueba no recorrería nada)', () => {
    expect(universo.length).toBeGreaterThanOrEqual(8);
    expect(combinaciones.length).toBeGreaterThan(1 << 8);
  });

  it('ninguna combinación ve en la receta un dato repetido que su origen le tapa', () => {
    const violaciones: string[] = [];
    for (const { nombre, permisos } of combinaciones) {
      const s = sesion([...permisos, 'ordenes.ver']);
      const r = ocultarPreciosDeRecetaSiNoPuede(s, receta());
      const t = r.telas[0];
      const a = r.avios[0];
      const ar = r.artes[0];
      const origenTela = ocultarPreciosDeTelaBomSiNoPuede(s, telaBom).precioCosteo !== null;
      const origenComplemento =
        ocultarPreciosDeTelaSiNoPuede(s, telaCatalogo).precioSugeridoComplemento !== null;
      const origenAvio = ocultarPreciosDeAvioBomSiNoPuede(s, avioBom).precioCosteo !== null;
      const origenMedida =
        ocultarPreciosDeMedidasSiNoPuede(s, medidas).tallas[0]?.precioMedida !== null;
      const origenArte = ocultarPrecioDeArteSiNoPuede(s, { precio: 1 }).precio !== null;
      if (t?.precioModelo !== null && !origenTela) violaciones.push(`${nombre}: tela.precioModelo`);
      if (t?.precioComplemento !== null && !origenComplemento)
        violaciones.push(`${nombre}: tela.precioComplemento`);
      if (a?.precioModelo !== null && !origenAvio) violaciones.push(`${nombre}: avio.precioModelo`);
      if (a?.tallas[0]?.precioMedida !== null && !origenMedida)
        violaciones.push(`${nombre}: avio.precioMedida`);
      if (ar?.precioModelo !== null && !origenArte)
        violaciones.push(`${nombre}: arte.precioModelo`);
      // Un aviso CON cifras exige ver las dos puntas del renglón de su tipo.
      for (const c of r.desalineacion.cambios) {
        if (!c.detalle.includes('$')) continue;
        const renglon = c.tipo === 'tela' ? t : c.tipo === 'avio' ? a : ar;
        if (renglon?.precio === null || renglon?.precioModelo === null) {
          violaciones.push(`${nombre}: aviso de ${c.tipo} con cifras`);
        }
      }
      // Y la marca dice la verdad.
      if (t?.precioModeloOculto !== !origenTela) violaciones.push(`${nombre}: marca de tela`);
      if (a?.precioModeloOculto !== !origenAvio) violaciones.push(`${nombre}: marca de avío`);
      if (ar?.precioModeloOculto !== !origenArte) violaciones.push(`${nombre}: marca de arte`);
    }
    expect(violaciones).toEqual([]);
  });

  it('control: con TODO el universo, la receta sí lo trae todo (la contención no tapa de más)', () => {
    const r = ocultarPreciosDeRecetaSiNoPuede(sesion([...universo, 'ordenes.ver']), receta());
    const texto = JSON.stringify(r);
    for (const cifra of CIFRAS) expect(texto).toContain(cifra);
  });
});
