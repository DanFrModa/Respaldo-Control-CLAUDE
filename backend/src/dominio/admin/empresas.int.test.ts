import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../datos/index.js';
import { ErrorConflicto, ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import { clientePruebas, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { crearAlmacen } from './almacenes.js';
import {
  actualizarConfiguracion,
  actualizarEmpresa,
  crearEmpresa,
  desactivarEmpresa,
  listarEmpresas,
  listarEmpresasActivas,
  obtenerConfiguracion,
} from './empresas.js';

let cliente: PrismaClient;

const sesionAdmin = (idEmpresaActiva = 1) =>
  sesionDePrueba({
    idEmpresaActiva,
    permisos: ['empresas.administrar', 'almacenes.administrar'],
  });

const bd = () => ({ cliente });

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
});

describe('administración de empresas (doc 10 §5, A9)', () => {
  it('crea la empresa CON su configuración 1:1 y bitácora', async () => {
    const sesion = sesionAdmin();
    const empresa = await crearEmpresa(
      sesion,
      { nombre: 'FR Moda SA de CV', razonSocial: 'FR Moda SA de CV', favorita: true },
      bd(),
    );

    expect(empresa.favorita).toBe(true);
    const configuracion = await obtenerConfiguracion(sesion, empresa.id, bd());
    expect(configuracion.idEmpresa).toBe(empresa.id);

    await expect(
      cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Empresa', idEntidad: String(empresa.id), accion: 'CREAR' },
      }),
    ).resolves.toBeTruthy();
  });

  it('nombre duplicado → ErrorConflicto; sin permiso → ErrorPermiso', async () => {
    await crearEmpresa(sesionAdmin(), { nombre: 'FR Moda' }, bd());
    await expect(crearEmpresa(sesionAdmin(), { nombre: 'fr moda' }, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );
    await expect(crearEmpresa(sesionDePrueba(), { nombre: 'Otra' }, bd())).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });

  it('la FAVORITA es única: marcar una desmarca la anterior (viejo: Importancia=1)', async () => {
    const sesion = sesionAdmin();
    const primera = await crearEmpresa(sesion, { nombre: 'Primera', favorita: true }, bd());
    const segunda = await crearEmpresa(sesion, { nombre: 'Segunda', favorita: true }, bd());

    const todas = await listarEmpresas(sesion, bd());
    const favoritas = todas.filter((empresa) => empresa.favorita);
    expect(favoritas.map((empresa) => empresa.id)).toEqual([segunda.id]);

    // También al actualizar.
    await actualizarEmpresa(sesion, primera.id, { favorita: true }, bd());
    const refrescadas = await listarEmpresas(sesion, bd());
    expect(refrescadas.filter((e) => e.favorita).map((e) => e.id)).toEqual([primera.id]);
  });

  it('REGRESIÓN: editar otro campo NO resetea las banderas (Zod .partial() no quita el default)', async () => {
    const sesion = sesionAdmin();
    const empresa = await crearEmpresa(
      sesion,
      { nombre: 'FR Moda', favorita: true, paraIpt: true, paraEdr: true },
      bd(),
    );

    // Editar solo `identificador`: el esquema de edición NO debe rellenar las banderas con su
    // default (false) ni el dominio pisar los valores reales.
    const actualizada = await actualizarEmpresa(
      sesion,
      empresa.id,
      { identificador: 'FRM-01' },
      bd(),
    );
    expect(actualizada.identificador).toBe('FRM-01');
    expect(actualizada.favorita).toBe(true);
    expect(actualizada.paraIpt).toBe(true);
    expect(actualizada.paraEdr).toBe(true);

    const enBd = await cliente.empresa.findUniqueOrThrow({ where: { id: empresa.id } });
    expect(enBd.favorita).toBe(true);
    expect(enBd.paraIpt).toBe(true);
    expect(enBd.paraEdr).toBe(true);
  });

  it('no se desactiva la favorita ni la empresa activa de la sesión', async () => {
    const sesion = sesionAdmin();
    const favorita = await crearEmpresa(sesion, { nombre: 'Favorita', favorita: true }, bd());
    const operativa = await crearEmpresa(sesion, { nombre: 'Operativa' }, bd());

    await expect(desactivarEmpresa(sesion, favorita.id, bd())).rejects.toBeInstanceOf(
      ErrorValidacion,
    );

    const sesionEnOperativa = sesionAdmin(operativa.id);
    await expect(desactivarEmpresa(sesionEnOperativa, operativa.id, bd())).rejects.toBeInstanceOf(
      ErrorValidacion,
    );

    // Una empresa normal sí se desactiva, y deja de salir en las activas.
    const desactivada = await desactivarEmpresa(sesion, operativa.id, bd());
    expect(desactivada.activa).toBe(false);
    const activas = await listarEmpresasActivas(bd());
    expect(activas.map((empresa) => empresa.id)).toEqual([favorita.id]);
  });

  it('listarEmpresasActivas no exige permiso (selector del header) y no expone configuración', async () => {
    await crearEmpresa(sesionAdmin(), { nombre: 'Única', favorita: true }, bd());
    const activas = await listarEmpresasActivas(bd());
    expect(activas).toEqual([
      { id: expect.any(Number) as number, nombre: 'Única', favorita: true },
    ]);
  });

  describe('configuración por empresa (ex-Propiedades, doc 10 §5)', () => {
    it('actualiza parámetros y los registra en bitácora', async () => {
      const sesion = sesionAdmin();
      const empresa = await crearEmpresa(sesion, { nombre: 'FR Moda' }, bd());

      const configuracion = await actualizarConfiguracion(
        sesion,
        empresa.id,
        { utilidadSugerida: 35.5, regaliasBase: 4, colchonCostura: 3 },
        bd(),
      );

      expect(Number(configuracion.utilidadSugerida)).toBe(35.5);
      expect(Number(configuracion.regaliasBase)).toBe(4);
      expect(configuracion.colchonCostura).toBe(3);

      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'ConfiguracionEmpresa', idEntidad: String(empresa.id) },
      });
      expect(bitacora.datos).toMatchObject({ colchonCostura: 3 });
    });

    it('el almacén PT por defecto debe ser ACTIVO, de tipo PT y de la empresa', async () => {
      const sesion = sesionAdmin();
      const empresa = await crearEmpresa(sesion, { nombre: 'FR Moda' }, bd());
      const sesionEmpresa = sesionAdmin(empresa.id);

      const almacenTela = await crearAlmacen(
        sesionEmpresa,
        { nombre: 'Telas', tipo: 'TELA' },
        bd(),
      );
      await expect(
        actualizarConfiguracion(
          sesionEmpresa,
          empresa.id,
          { idAlmacenPtDefault: almacenTela.id },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);

      const almacenPt = await crearAlmacen(sesionEmpresa, { nombre: 'PT', tipo: 'PT' }, bd());
      const configuracion = await actualizarConfiguracion(
        sesionEmpresa,
        empresa.id,
        { idAlmacenPtDefault: almacenPt.id },
        bd(),
      );
      expect(configuracion.idAlmacenPtDefault).toBe(almacenPt.id);
    });

    it('borrar un parámetro (null) lo deja vacío', async () => {
      const sesion = sesionAdmin();
      const empresa = await crearEmpresa(sesion, { nombre: 'FR Moda' }, bd());
      await actualizarConfiguracion(sesion, empresa.id, { colchonCostura: 5 }, bd());

      const configuracion = await actualizarConfiguracion(
        sesion,
        empresa.id,
        { colchonCostura: null },
        bd(),
      );
      expect(configuracion.colchonCostura).toBeNull();
    });
  });
});
