/**
 * ⭐ Fila 0.231 — el contrato del motivo de la OC: alta/edición (opcional, nullable), filtros del
 * listado y del resumen (coaccionados desde la URL) y el cuerpo de la generación desde la explosión.
 */
import { describe, expect, it } from 'vitest';

import {
  esquemaCompraCrear,
  esquemaCompraEditarCuerpo,
  esquemaListarCompras,
  esquemaResumenComprasQuery,
} from './compra.js';
import { esquemaGenerarOcCuerpo } from './mrp.js';

const alta = { idProveedor: 1, fechaEntrega: '2026-09-30', idDireccionEntrega: 1 };

describe('motivo de la OC en alta y edición', () => {
  it('es opcional: ausente, null o un id positivo', () => {
    expect(esquemaCompraCrear.parse(alta).idMotivoCompra).toBeUndefined();
    expect(esquemaCompraCrear.parse({ ...alta, idMotivoCompra: null }).idMotivoCompra).toBeNull();
    expect(esquemaCompraCrear.parse({ ...alta, idMotivoCompra: 3 }).idMotivoCompra).toBe(3);
  });

  it('rechaza un id que no es entero positivo', () => {
    expect(esquemaCompraCrear.safeParse({ ...alta, idMotivoCompra: 0 }).success).toBe(false);
    expect(esquemaCompraCrear.safeParse({ ...alta, idMotivoCompra: 1.5 }).success).toBe(false);
    expect(esquemaCompraCrear.safeParse({ ...alta, idMotivoCompra: '2' }).success).toBe(false);
  });

  it('en la edición, ausente = no se toca y null = vuelve a compra normal', () => {
    expect(esquemaCompraEditarCuerpo.parse({})).not.toHaveProperty('idMotivoCompra');
    expect(esquemaCompraEditarCuerpo.parse({ idMotivoCompra: null }).idMotivoCompra).toBeNull();
  });
});

describe('filtro por motivo en la URL', () => {
  it('el listado coacciona el id y la bandera desde texto', () => {
    const q = esquemaListarCompras.parse({ idMotivoCompra: '4', conMotivo: 'false' });
    expect(q.idMotivoCompra).toBe(4);
    expect(q.conMotivo).toBe(false);
    expect(esquemaListarCompras.parse({ conMotivo: 'true' }).conMotivo).toBe(true);
    expect(esquemaListarCompras.parse({}).conMotivo).toBeUndefined();
  });

  it('el resumen acepta el mismo filtro', () => {
    const q = esquemaResumenComprasQuery.parse({ idMotivoCompra: '2', conMotivo: 'true' });
    expect(q).toMatchObject({ idMotivoCompra: 2, conMotivo: true });
  });
});

describe('motivo por proveedor al generar desde la explosión', () => {
  it('acepta un motivo o null por proveedor; es opcional', () => {
    const base = { idsOrden: [1] };
    expect(esquemaGenerarOcCuerpo.parse(base).motivosPorProveedor).toBeUndefined();
    const conMotivos = esquemaGenerarOcCuerpo.parse({
      ...base,
      motivosPorProveedor: [
        { idProveedor: 5, idMotivoCompra: 3 },
        { idProveedor: 6, idMotivoCompra: null },
      ],
    });
    expect(conMotivos.motivosPorProveedor).toEqual([
      { idProveedor: 5, idMotivoCompra: 3 },
      { idProveedor: 6, idMotivoCompra: null },
    ]);
    // El null tiene que venir DICHO: omitirlo no es «compra normal», es un cuerpo incompleto.
    expect(
      esquemaGenerarOcCuerpo.safeParse({ ...base, motivosPorProveedor: [{ idProveedor: 5 }] })
        .success,
    ).toBe(false);
  });
});
