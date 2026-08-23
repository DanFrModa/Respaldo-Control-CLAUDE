import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../datos/index.js';
import { ErrorNoEncontrado, ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import { clientePruebas, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

import { listarMedidasDeAvio, reemplazarMedidasAvio } from './avio-medidas.js';

/**
 * MEDIDAS del avío tras V1-E3g (§Post-F9.66): la medida es un NÚMERO, la unidad vive una vez en el
 * avío y la etiqueta la DERIVA el dominio. Lo que se prueba es lo que sostiene la decisión —que el
 * texto libre ya no puede partir la compra en tres— y lo que protege D3: las medidas heredadas que
 * la migración no pudo convertir NO se tiran, se marcan, y al corregirlas la etiqueta vieja queda
 * en la bitácora.
 */
let cliente: PrismaClient;

const bd = () => ({ cliente });
const sesion = () => sesionDePrueba({ permisos: ['avios.ver', 'avios.administrar'] });

let idAvio: number;

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  const avio = await cliente.avio.create({
    data: { clave: 'CIE-01', descripcion: 'Cierre', unidad: 'pza' },
  });
  idAvio = avio.id;
});

describe('Medidas del avío (V1-E3g — número + unidad del avío)', () => {
  it('exige permiso y avío existente', async () => {
    await expect(listarMedidasDeAvio(sesionDePrueba(), idAvio, bd())).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
    await expect(listarMedidasDeAvio(sesion(), 999_999, bd())).rejects.toBeInstanceOf(
      ErrorNoEncontrado,
    );
  });

  it('captura NUMÉRICA: la etiqueta se DERIVA y la unidad se guarda en el avío', async () => {
    const r = await reemplazarMedidasAvio(
      sesion(),
      idAvio,
      {
        unidadMedida: 'cm',
        medidas: [
          { valor: 53, precio: 5.8 },
          { valor: 55, precio: 6.2 },
        ],
      },
      bd(),
    );
    expect(r.unidadMedida).toBe('cm');
    expect(r.datos.map((d) => d.medida)).toEqual(['53 cm', '55 cm']);
    expect(r.datos.map((d) => d.valor)).toEqual([53, 55]);
    expect(r.datos.every((d) => !d.requiereRevision)).toBe(true);
    expect(r.promedioPreCosto).toBe(6);

    const avio = await cliente.avio.findUniqueOrThrow({ where: { id: idAvio } });
    expect(avio.unidadMedida).toBe('cm');
  });

  it('"53 cm", "53cm" y "53" ya NO pueden coexistir: se captura el mismo número una sola vez', async () => {
    await expect(
      reemplazarMedidasAvio(
        sesion(),
        idAvio,
        {
          unidadMedida: 'cm',
          medidas: [
            { valor: 53, precio: 1 },
            { valor: 53, precio: 2 },
          ],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('sin unidad no se aceptan medidas: el número solo no dice nada', async () => {
    await expect(
      reemplazarMedidasAvio(
        sesion(),
        idAvio,
        { unidadMedida: null, medidas: [{ valor: 53, precio: 1 }] },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('AVISA (no bloquea) cuando el número es absurdo para la unidad', async () => {
    // Un cierre de 1 cm: casi seguro quiso ser 100. Se GUARDA igual y se avisa.
    const r = await reemplazarMedidasAvio(
      sesion(),
      idAvio,
      { unidadMedida: 'cm', medidas: [{ valor: 1, precio: 5 }] },
      bd(),
    );
    expect(r.datos).toHaveLength(1);
    expect(r.avisos.some((a) => a.includes('1 cm'))).toBe(true);
  });

  describe('medidas HEREDADAS marcadas para revisión (D3)', () => {
    beforeEach(async () => {
      // Lo que deja la migración cuando la etiqueta no se pudo convertir: valor NULL + la marca.
      await cliente.avioMedida.create({
        data: { idAvio, medida: 'S', precio: 4, requiereRevision: true, orden: 0 },
      });
    });

    it('se listan vivas, promedian y salen con AVISO — nunca se tiran ni se adivinan', async () => {
      const r = await listarMedidasDeAvio(sesion(), idAvio, bd());
      expect(r.datos).toHaveLength(1);
      expect(r.datos[0]?.valor).toBeNull();
      expect(r.datos[0]?.requiereRevision).toBe(true);
      expect(r.promedioPreCosto).toBe(4); // sigue costeando
      expect(r.avisos.some((a) => a.includes('revisión manual'))).toBe(true);
    });

    it('corregirla POR ID la normaliza EN SU LUGAR, apaga la marca y deja la etiqueta vieja en la bitácora', async () => {
      const previa = await cliente.avioMedida.findFirstOrThrow({ where: { idAvio } });
      const r = await reemplazarMedidasAvio(
        sesion(),
        idAvio,
        { unidadMedida: 'cm', medidas: [{ id: previa.id, valor: 20, precio: 4 }] },
        bd(),
      );
      expect(r.datos).toHaveLength(1); // la MISMA fila, no una nueva
      expect(r.datos[0]?.id).toBe(previa.id);
      expect(r.datos[0]?.medida).toBe('20 cm');
      expect(r.datos[0]?.requiereRevision).toBe(false);

      const bitacora = await cliente.bitacora.findFirst({
        where: { entidad: 'Avio', idEntidad: String(idAvio) },
        orderBy: { id: 'desc' },
      });
      expect(JSON.stringify(bitacora?.datos)).toContain('"antes":"S"');
    });

    it('⭐ H4: una heredada SIN número no congela el avío — viaja para conservarse', async () => {
      const heredada = await cliente.avioMedida.findFirstOrThrow({ where: { idAvio } });
      // El usuario todavía no sabe a qué medida corresponde la "S", pero sí quiere corregir el
      // precio de otra y dar de alta una nueva. Antes esto era imposible: el panel abortaba.
      const r = await reemplazarMedidasAvio(
        sesion(),
        idAvio,
        {
          unidadMedida: 'cm',
          medidas: [
            { id: heredada.id, valor: null, precio: 7 },
            { valor: 53, precio: 6 },
          ],
        },
        bd(),
      );
      const conservada = r.datos.find((d) => d.id === heredada.id);
      expect(conservada?.activo).toBe(true); // ⭐ NO se dio de baja
      expect(conservada?.medida).toBe('S'); // conserva su etiqueta original
      expect(conservada?.valor).toBeNull(); // nadie le inventó un número
      expect(conservada?.requiereRevision).toBe(true); // y sigue pidiendo revisión
      expect(conservada?.precio).toBe(7); // lo que sí se pudo ajustar
      expect(r.datos.some((d) => d.medida === '53 cm' && d.activo)).toBe(true);
    });

    it('F2: a una heredada SÍ se le puede mover el precio (el caso de uso que motivó H4)', async () => {
      // Sola en el set y sin nada más que cambie: si la rama "conservar" no mirara el precio, el
      // renglón no contaría como cambio, no se escribiría y el usuario perdería su edición sin que
      // nada se lo dijera. Es la razón de ser de H4, así que va con su propia aserción.
      const heredada = await cliente.avioMedida.findFirstOrThrow({ where: { idAvio } });
      expect(heredada.precio.toNumber()).toBe(4);
      const r = await reemplazarMedidasAvio(
        sesion(),
        idAvio,
        { unidadMedida: null, medidas: [{ id: heredada.id, valor: null, precio: 11.5 }] },
        bd(),
      );
      expect(r.datos.find((d) => d.id === heredada.id)?.precio).toBe(11.5);
      // Y lo hizo SIN normalizarla: sigue siendo la misma medida por revisar.
      const enBd = await cliente.avioMedida.findUniqueOrThrow({ where: { id: heredada.id } });
      expect(enBd.precio.toNumber()).toBe(11.5);
      expect(enBd.valor).toBeNull();
      expect(enBd.medida).toBe('S');
      expect(enBd.requiereRevision).toBe(true);
    });

    it('F2: una medida SIN número y SIN id se rechaza (no puede ser un alta encubierta)', async () => {
      // `valor: null` significa "conserva la que ya existe". Sin `id` no hay ninguna que conservar:
      // aceptarlo daría de alta una medida sin número, que es justo lo que la etapa vino a impedir.
      await expect(
        reemplazarMedidasAvio(
          sesion(),
          idAvio,
          { unidadMedida: 'cm', medidas: [{ valor: null, precio: 5 }] },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('H4: NO se le puede quitar el número a una medida ya normalizada', async () => {
      const buena = await cliente.avioMedida.create({
        data: { idAvio, medida: '53 cm', valor: 53, precio: 6 },
      });
      await expect(
        reemplazarMedidasAvio(
          sesion(),
          idAvio,
          { unidadMedida: 'cm', medidas: [{ id: buena.id, valor: null, precio: 6 }] },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('H4: un set de PURAS heredadas sin número no exige unidad (si no, no se podría guardar)', async () => {
      const heredada = await cliente.avioMedida.findFirstOrThrow({ where: { idAvio } });
      const r = await reemplazarMedidasAvio(
        sesion(),
        idAvio,
        { unidadMedida: null, medidas: [{ id: heredada.id, valor: null, precio: 9 }] },
        bd(),
      );
      expect(r.datos.find((d) => d.id === heredada.id)?.precio).toBe(9);
    });

    it('un id de OTRO avío no se acepta (no se corrige la medida ajena)', async () => {
      const otro = await cliente.avio.create({ data: { clave: 'X-1', descripcion: 'Otro' } });
      const ajena = await cliente.avioMedida.create({
        data: { idAvio: otro.id, medida: '9 cm', valor: 9, precio: 1 },
      });
      await expect(
        reemplazarMedidasAvio(
          sesion(),
          idAvio,
          { unidadMedida: 'cm', medidas: [{ id: ajena.id, valor: 9, precio: 1 }] },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });
  });

  it('normalizar una heredada hacia una etiqueta YA OCUPADA se rechaza con mensaje, no con un 500', async () => {
    // "15 cm" ya existe en OTRA fila que el payload ni menciona. Al corregir la heredada "15cm" a
    // 15 su etiqueta caería encima: sin la guarda esto revienta contra el `@@unique` a mitad de la
    // transacción, con un error ilegible. Ojo: el payload trae UN SOLO renglón, así que el choque
    // NO lo puede cazar la validación de repetidos dentro del cuerpo.
    await cliente.avioMedida.create({
      data: { idAvio, medida: '15 cm', valor: 15, precio: 5, orden: 0 },
    });
    const vieja = await cliente.avioMedida.create({
      data: { idAvio, medida: '15cm', precio: 5, requiereRevision: true, orden: 1 },
    });
    await expect(
      reemplazarMedidasAvio(
        sesion(),
        idAvio,
        { unidadMedida: 'cm', medidas: [{ id: vieja.id, valor: 15, precio: 5 }] },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('dos renglones que derivan a la MISMA etiqueta se rechazan dentro del cuerpo', async () => {
    await expect(
      reemplazarMedidasAvio(
        sesion(),
        idAvio,
        {
          unidadMedida: 'cm',
          // 53 y 53.0 son el mismo número: derivan a la misma etiqueta "53 cm".
          medidas: [
            { valor: 53, precio: 5 },
            { valor: 53.0, precio: 6 },
          ],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('⭐ H2: "53 cm", "53cm" y "53" se DICEN como lo que son (la misma medida), no como "revisar"', async () => {
    // Estado que deja la migración para el caso textual de §Post-F9.66: tres filas activas con el
    // MISMO valor, las tres marcadas. Sin este aviso el usuario abría, guardaba y recibía un
    // ErrorValidacion sin saber cuál sobra — exactamente lo que Daniel dijo que no quería.
    await cliente.avioMedida.createMany({
      data: [
        { idAvio, medida: '53 cm', valor: 53, precio: 6, requiereRevision: true, orden: 0 },
        { idAvio, medida: '53cm', valor: 53, precio: 6, requiereRevision: true, orden: 1 },
        { idAvio, medida: '53', valor: 53, precio: 6, requiereRevision: true, orden: 2 },
      ],
    });
    await cliente.avio.update({ where: { id: idAvio }, data: { unidadMedida: 'cm' } });

    const r = await listarMedidasDeAvio(sesion(), idAvio, bd());
    const aviso = r.avisos.find((a) => a.includes('LA MISMA medida'));
    expect(aviso).toBeDefined();
    expect(aviso).toContain('"53 cm"');
    expect(aviso).toContain('"53cm"');
    expect(aviso).toContain('"53"');
    // Y NO se las acusa además de "no convertibles": esa no es su razón.
    expect(r.avisos.some((a) => a.includes('revisión manual'))).toBe(false);
  });

  it('H2: una duplicada DESACTIVADA no genera ruido (ya no se compra)', async () => {
    await cliente.avioMedida.createMany({
      data: [
        { idAvio, medida: '53 cm', valor: 53, precio: 6, orden: 0 },
        { idAvio, medida: '53cm', valor: 53, precio: 6, activo: false, orden: 1 },
      ],
    });
    await cliente.avio.update({ where: { id: idAvio }, data: { unidadMedida: 'cm' } });
    const r = await listarMedidasDeAvio(sesion(), idAvio, bd());
    expect(r.avisos.some((a) => a.includes('LA MISMA medida'))).toBe(false);
  });

  it('la unidad ANTERIOR del avío queda en la bitácora al cambiarla (D3)', async () => {
    await reemplazarMedidasAvio(
      sesion(),
      idAvio,
      { unidadMedida: 'cm', medidas: [{ valor: 53, precio: 6 }] },
      bd(),
    );
    // Se borra la unidad: sin el "antes" en la bitácora, este cambio no se podría deshacer.
    await reemplazarMedidasAvio(sesion(), idAvio, { unidadMedida: null, medidas: [] }, bd());

    const bitacora = await cliente.bitacora.findFirst({
      where: { entidad: 'Avio', idEntidad: String(idAvio) },
      orderBy: { id: 'desc' },
    });
    expect(JSON.stringify(bitacora?.datos)).toContain('"unidadMedidaAnterior":"cm"');
  });

  it('si la unidad NO cambia, la bitácora no se ensucia con el "antes"', async () => {
    await reemplazarMedidasAvio(
      sesion(),
      idAvio,
      { unidadMedida: 'cm', medidas: [{ valor: 53, precio: 6 }] },
      bd(),
    );
    await reemplazarMedidasAvio(
      sesion(),
      idAvio,
      { unidadMedida: 'cm', medidas: [{ valor: 53, precio: 9 }] },
      bd(),
    );
    const bitacora = await cliente.bitacora.findFirst({
      where: { entidad: 'Avio', idEntidad: String(idAvio) },
      orderBy: { id: 'desc' },
    });
    expect(JSON.stringify(bitacora?.datos)).not.toContain('unidadMedidaAnterior');
  });

  it('dos renglones que apuntan a la MISMA fila se rechazan (uno pisaría al otro)', async () => {
    const previa = await cliente.avioMedida.create({
      data: { idAvio, medida: '53 cm', valor: 53, precio: 5 },
    });
    await expect(
      reemplazarMedidasAvio(
        sesion(),
        idAvio,
        {
          unidadMedida: 'cm',
          // Un renglón por id y otro sin id que casa por etiqueta: los dos caen en la misma fila.
          medidas: [
            { id: previa.id, valor: 60, precio: 5 },
            { valor: 53, precio: 9 },
          ],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('el valor se REDONDEA a 2 decimales y la etiqueta dice EXACTAMENTE lo guardado', async () => {
    const r = await reemplazarMedidasAvio(
      sesion(),
      idAvio,
      { unidadMedida: 'cm', medidas: [{ valor: 53.456, precio: 5 }] },
      bd(),
    );
    expect(r.datos[0]?.valor).toBe(53.46);
    expect(r.datos[0]?.medida).toBe('53.46 cm'); // no "53.456 cm"
  });

  it('lo que ya no viene se DESACTIVA (borrado suave) y queda íntegro en la bitácora', async () => {
    await reemplazarMedidasAvio(
      sesion(),
      idAvio,
      {
        unidadMedida: 'cm',
        medidas: [
          { valor: 53, precio: 5 },
          { valor: 55, precio: 6 },
        ],
      },
      bd(),
    );
    const r = await reemplazarMedidasAvio(
      sesion(),
      idAvio,
      { unidadMedida: 'cm', medidas: [{ valor: 53, precio: 5 }] },
      bd(),
    );
    const desactivada = r.datos.find((d) => d.medida === '55 cm');
    expect(desactivada?.activo).toBe(false);
    expect(r.promedioPreCosto).toBe(5); // la desactivada NO promedia

    const bitacora = await cliente.bitacora.findFirst({
      where: { entidad: 'Avio', idEntidad: String(idAvio) },
      orderBy: { id: 'desc' },
    });
    expect(JSON.stringify(bitacora?.datos)).toContain('"medida":"55 cm"');
  });

  it('re-capturar una medida desactivada la REACTIVA (no duplica)', async () => {
    await reemplazarMedidasAvio(
      sesion(),
      idAvio,
      { unidadMedida: 'cm', medidas: [{ valor: 53, precio: 5 }] },
      bd(),
    );
    await reemplazarMedidasAvio(sesion(), idAvio, { unidadMedida: 'cm', medidas: [] }, bd());
    const r = await reemplazarMedidasAvio(
      sesion(),
      idAvio,
      { unidadMedida: 'cm', medidas: [{ valor: 53, precio: 7 }] },
      bd(),
    );
    expect(r.datos).toHaveLength(1);
    expect(r.datos[0]?.activo).toBe(true);
    expect(r.datos[0]?.precio).toBe(7);
  });
});
