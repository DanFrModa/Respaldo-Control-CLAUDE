import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import type { ContextoBd, Tx } from '../../comun/transaccion.js';
import { ErrorPermiso } from '../../comun/errores.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

import * as moduloComentarios from './comentarios-negociacion.js';
import {
  comentarNegociacion,
  exigirComentarNegociacion,
  listarComentariosNegociacion,
} from './comentarios-negociacion.js';
import { cancelarCotizacion, emitirCotizacion } from './cotizaciones.js';
import {
  cambiarEstadoLista,
  cambiarEstadoRenglon,
  guardarMesa,
  registrarAcuerdo,
  registrarRonda,
  simularMesa,
  simularNegociacion,
} from './negociacion.js';

/**
 * ⭐⭐ Fila 0.238 (§Post-F9.248(b)) — LA REJA DEL DOMINIO entre `listas.comentar` y
 * `listas.negociar`, probada SIN base de datos.
 *
 * Daniel, sobre Aurora: *«las listas negociar **solo de lectura y poder agregar comentarios**, pero
 * no modificar lo que yo hice»*. Lo que se fija aquí:
 *  • con SÓLO `listas.comentar` se comenta, y se NIEGAN las NUEVE operaciones de `listas.negociar`
 *    (rondas, acuerdos, estado de la lista y del renglón, calculadora, mesa —simular y guardar—, y
 *    emitir/cancelar cotizaciones);
 *  • con `listas.negociar` se comenta (lo implica) y las nueve siguen abiertas;
 *  • sin ninguna de las dos, comentar se niega nombrando `listas.comentar`;
 *  • con SÓLO `listas.ver` se leen los comentarios.
 *
 * 🔑 **Cómo se sabe que la reja DEJÓ PASAR sin una base:** la «base» es una transacción-trampa que,
 * al primer acceso, lanza {@link PasoLaReja}. Todas exigen el permiso en su primera línea, antes de
 * validar o tocar datos; una negación es `ErrorPermiso` y nunca llega a la trampa. Las entradas son
 * VÁLIDAS a propósito, para que lo que se vea sea la trampa y no un `ErrorValidacion`.
 *
 * 🔑 **El inventario de las nueve se CUENTA CON LA MÁQUINA**, no con la propia matriz: se leen los
 * fuentes de `src/dominio` y se extrae cada `verificarPermiso(…, 'listas.negociar')` con la función
 * exportada que lo contiene. Una operación nueva que exija `negociar` y nadie clasifique —o una de
 * las nueve que pase a aceptar `comentar`— rompe la igualdad.
 */

/** Lo que lanza la transacción-trampa: la operación cruzó la reja y fue a buscar datos. */
class PasoLaReja extends Error {
  constructor() {
    super('cruzó la reja de permisos y tocó la base');
  }
}

/** Una transacción en la que CUALQUIER acceso lanza. */
function bdTrampa(): ContextoBd {
  const tx = new Proxy(
    {},
    {
      get() {
        throw new PasoLaReja();
      },
    },
  ) as Tx;
  return { tx };
}

type Sesion = ReturnType<typeof sesionDePrueba>;
type Operacion = (sesion: Sesion, bd: ContextoBd) => Promise<unknown>;

const RENGLON_MESA = {
  conceptoCodigo: 'tela',
  conceptoNombre: 'Tela',
  etiqueta: 'Felpa',
  consumo: 1.2,
  precioUnit: 20,
};

/** Las NUEVE operaciones de `listas.negociar`, con entradas válidas. */
const DE_NEGOCIAR: readonly (readonly [string, Operacion])[] = [
  [
    'registrarRonda',
    (s, bd) => registrarRonda(s, 1, { idPrecostoNuevo: 2, acuerdo: 'Bajamos la tela' }, bd),
  ],
  ['registrarAcuerdo', (s, bd) => registrarAcuerdo(s, 1, { acuerdo: 'Precio pactado' }, bd)],
  ['cambiarEstadoLista', (s, bd) => cambiarEstadoLista(s, 1, { idEstadoLista: 2 }, bd)],
  ['cambiarEstadoRenglon', (s, bd) => cambiarEstadoRenglon(s, 1, { estado: 'cerrado' }, bd)],
  ['simularNegociacion', (s, bd) => simularNegociacion(s, 1, { precioObjetivo: 100 }, bd)],
  [
    'simularMesa',
    (s, bd) => simularMesa(s, 1, { renglones: [RENGLON_MESA], precioObjetivo: 100 }, bd),
  ],
  [
    'guardarMesa',
    (s, bd) =>
      guardarMesa(
        s,
        1,
        { acuerdo: 'Cerramos así', renglones: [RENGLON_MESA], precioObjetivo: 100 },
        bd,
      ),
  ],
  ['emitirCotizacion', (s, bd) => emitirCotizacion(s, { idLista: 1 }, bd)],
  [
    'cancelarCotizacion',
    (s, bd) => cancelarCotizacion(s, 1, { motivo: 'Se mandó a otro cliente' }, bd),
  ],
];

const COMENTAR: Operacion = (s, bd) =>
  comentarNegociacion(s, 1, { texto: 'El cliente pidió muestra', idLinea: 3 }, bd);

// ── El inventario MECÁNICO ─────────────────────────────────────────────────────────

const RAIZ_DOMINIO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function fuentesDeDominio(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = path.join(dir, nombre);
    if (statSync(ruta).isDirectory()) return fuentesDeDominio(ruta);
    return nombre.endsWith('.ts') && !nombre.endsWith('.test.ts') ? [ruta] : [];
  });
}

/** La función exportada que contiene el índice `i` del texto (la última declarada antes). */
function funcionQueContiene(texto: string, i: number): string {
  const re = /export (?:async )?function (\w+)/g;
  let nombre = '(fuera de una función exportada)';
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto)) !== null && m.index < i) {
    nombre = m[1] ?? nombre;
  }
  return nombre;
}

/**
 * Lee los fuentes de `src/dominio` y devuelve, para cada aparición de la cadena `'listas.negociar'`,
 * la función exportada que la contiene y si es un `verificarPermiso` (reja dura) u otra cosa.
 */
function usosDeNegociar(): { funcion: string; archivo: string; esReja: boolean }[] {
  const usos: { funcion: string; archivo: string; esReja: boolean }[] = [];
  for (const archivo of fuentesDeDominio(RAIZ_DOMINIO)) {
    const texto = readFileSync(archivo, 'utf8');
    const re = /'listas\.negociar'/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(texto)) !== null) {
      const antes = texto.slice(Math.max(0, m.index - 60), m.index);
      usos.push({
        funcion: funcionQueContiene(texto, m.index),
        archivo: path.relative(RAIZ_DOMINIO, archivo),
        esReja: /verificarPermiso\(\s*\w+\s*,\s*$/.test(antes),
      });
    }
  }
  return usos;
}

function con(...permisos: ClavePermiso[]): Sesion {
  return sesionDePrueba({
    permisos: ['listas.ver', 'consultas.ver-importes', ...permisos],
    idEmpresaActiva: 1,
  });
}

describe('0.238 — `listas.comentar` comenta; las nueve de `listas.negociar` siguen siendo suyas', () => {
  it('el inventario se CUENTA en los fuentes: exactamente nueve rejas `verificarPermiso(…, negociar)`', () => {
    const usos = usosDeNegociar();
    const rejas = usos
      .filter((u) => u.esReja)
      .map((u) => u.funcion)
      .sort();
    expect(rejas).toEqual(DE_NEGOCIAR.map(([nombre]) => nombre).sort());
    expect(rejas).toHaveLength(9);
    // Y la ÚNICA otra mención de la llave en el dominio es la implicación de comentar: nadie la
    // consulta por la puerta de atrás (un `tienePermiso` suelto que abra o cierre algo).
    const otras = usos.filter((u) => !u.esReja).map((u) => `${u.archivo}::${u.funcion}`);
    expect(otras).toEqual(['desarrollo/comentarios-negociacion.ts::exigirComentarNegociacion']);
  });

  it.each(DE_NEGOCIAR)('⛔ %s NO pasa con SÓLO `listas.comentar`', async (_nombre, operacion) => {
    await expect(operacion(con('listas.comentar'), bdTrampa())).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });

  it.each(DE_NEGOCIAR)('✅ %s sigue pasando con `listas.negociar`', async (_nombre, operacion) => {
    await expect(operacion(con('listas.negociar'), bdTrampa())).rejects.toBeInstanceOf(PasoLaReja);
  });

  it('⭐ comentar pasa con SÓLO `listas.comentar`', async () => {
    await expect(COMENTAR(con('listas.comentar'), bdTrampa())).rejects.toBeInstanceOf(PasoLaReja);
  });

  it('✅ comentar pasa con SÓLO `listas.negociar` (lo implica)', async () => {
    await expect(COMENTAR(con('listas.negociar'), bdTrampa())).rejects.toBeInstanceOf(PasoLaReja);
  });

  it('⛔ comentar se niega sin ninguna de las dos, nombrando `listas.comentar`', async () => {
    const error: unknown = await COMENTAR(con(), bdTrampa()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorPermiso);
    expect((error as ErrorPermiso).permiso).toBe('listas.comentar');
    expect(() => {
      exigirComentarNegociacion(con());
    }).toThrow(ErrorPermiso);
  });

  it('🔒 un comentario es INMUTABLE (D3): el módulo no exporta nada que lo edite ni lo borre', () => {
    // Se lee del módulo real: una función nueva (editar, borrar, «corregir») rompe la igualdad y
    // obliga a decidir en voz alta si un comentario deja de ser inmutable.
    const funciones = Object.entries(moduloComentarios)
      .filter(([, valor]) => typeof valor === 'function')
      .map(([nombre]) => nombre)
      .sort();
    expect(funciones).toEqual([
      'comentarNegociacion',
      'exigirComentarNegociacion',
      'listarComentariosNegociacion',
    ]);
  });

  it('⛔ comentar sin `listas.ver` se niega aunque traiga `listas.comentar` o `listas.negociar` (mutar implica leer)', async () => {
    for (const llave of ['listas.comentar', 'listas.negociar'] as const) {
      const sinVer = sesionDePrueba({ permisos: [llave], idEmpresaActiva: 1 });
      const error: unknown = await COMENTAR(sinVer, bdTrampa()).catch((e: unknown) => e);
      expect(error, llave).toBeInstanceOf(ErrorPermiso);
      expect((error as ErrorPermiso).permiso, llave).toBe('listas.ver');
    }
  });

  it('📖 con SÓLO `listas.ver` se LEEN los comentarios (y sin él, no)', async () => {
    const soloVer = sesionDePrueba({ permisos: ['listas.ver'], idEmpresaActiva: 1 });
    await expect(listarComentariosNegociacion(soloVer, 1, bdTrampa())).rejects.toBeInstanceOf(
      PasoLaReja,
    );
    const sinVer = sesionDePrueba({ permisos: ['listas.comentar'], idEmpresaActiva: 1 });
    await expect(listarComentariosNegociacion(sinVer, 1, bdTrampa())).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });
});
