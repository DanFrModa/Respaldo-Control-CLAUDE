import { describe, expect, it, beforeEach, vi } from 'vitest';

import { ErrorArchivoDemasiadoGrande, type ServicioArchivos } from './archivos.js';
import { LOGO_EMPAQUETADO_DATA_URL, bytesLogoEmpaquetado } from './logo-empaquetado.js';
import { invalidarLogoEmpresa, obtenerLogoEmpresa } from './logo-empresa.js';
import type { ContextoBd } from './transaccion.js';

/**
 * Resolución del LOGO de la empresa (post-F9, branding de Daniel).
 *
 * Lo que importa aquí es la promesa del módulo: **nunca lanza** y **siempre devuelve algo
 * imprimible**. Un impreso no puede romperse porque falte el membrete, y la app tampoco puede
 * quedarse sin marca. Se ejercen las cinco rutas: logo real, sin logo, R2 caído, archivo corrupto
 * (que reventaría a react-pdf) y la caché con su invalidación.
 */

/** PNG mínimo válido (firma + IHDR): basta para que el sniffing por magic bytes lo acepte. */
const PNG_VALIDO = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('IHDR-falso-pero-con-firma-de-png', 'utf8'),
]);

/** JPEG mínimo válido (firma FF D8 FF). */
const JPEG_VALIDO = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff]),
  Buffer.from('cuerpo-jpeg', 'utf8'),
]);

/** Fila de `Empresa` que devuelve el `findFirst` del módulo (solo la relación del logo). */
type FilaEmpresa = {
  archivoLogo: { id: string; key: string; tipoMime: string } | null;
} | null;

/** Contexto de BD falso: un `empresa.findFirst` que devuelve lo que le digamos. */
function bdCon(fila: FilaEmpresa, alConsultar?: () => void): ContextoBd {
  return {
    cliente: {
      empresa: {
        findFirst: () => {
          alConsultar?.();
          return Promise.resolve(fila);
        },
      },
    },
  } as unknown as ContextoBd;
}

/** Servicio de archivos falso: devuelve bytes fijos o revienta, según se pida. */
function archivosCon(
  resultado: Buffer | Error,
  espia?: (maxBytes?: number) => void,
): ServicioArchivos {
  return {
    descargarContenido: (_key: string, maxBytes?: number) => {
      espia?.(maxBytes);
      return resultado instanceof Error ? Promise.reject(resultado) : Promise.resolve(resultado);
    },
  } as unknown as ServicioArchivos;
}

describe('obtenerLogoEmpresa', () => {
  beforeEach(() => {
    invalidarLogoEmpresa();
  });

  it('devuelve el logo de la empresa cuando lo tiene subido', async () => {
    const logo = await obtenerLogoEmpresa(
      1,
      bdCon({ archivoLogo: { id: 'arch1', key: 'empresas/logos/1/x.png', tipoMime: 'image/png' } }),
      archivosCon(PNG_VALIDO),
    );

    expect(logo.origen).toBe('empresa');
    expect(logo.idArchivo).toBe('arch1');
    expect(logo.bytes.equals(PNG_VALIDO)).toBe(true);
    expect(logo.dataUrl).toBe(`data:image/png;base64,${PNG_VALIDO.toString('base64')}`);
  });

  it('deduce el MIME por la FIRMA, no por el que quedó guardado al subir', async () => {
    // El registro dice PNG pero los bytes son JPEG: manda la firma (react-pdf necesita el real).
    const logo = await obtenerLogoEmpresa(
      1,
      bdCon({ archivoLogo: { id: 'arch1', key: 'k', tipoMime: 'image/png' } }),
      archivosCon(JPEG_VALIDO),
    );

    expect(logo.tipoMime).toBe('image/jpeg');
    expect(logo.dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  it('cae al logo EMPAQUETADO cuando la empresa todavía no tiene logo', async () => {
    const logo = await obtenerLogoEmpresa(1, bdCon({ archivoLogo: null }), archivosCon(PNG_VALIDO));

    expect(logo.origen).toBe('empaquetado');
    expect(logo.idArchivo).toBeNull();
    expect(logo.dataUrl).toBe(LOGO_EMPAQUETADO_DATA_URL);
    expect(logo.bytes.equals(bytesLogoEmpaquetado())).toBe(true);
  });

  it('cae al empaquetado (sin lanzar) si R2 falla al descargar', async () => {
    const logo = await obtenerLogoEmpresa(
      1,
      bdCon({ archivoLogo: { id: 'arch1', key: 'k', tipoMime: 'image/png' } }),
      archivosCon(new Error('R2 caído')),
    );

    expect(logo.origen).toBe('empaquetado');
  });

  it('cae al empaquetado (sin lanzar) si la base de datos falla', async () => {
    const bdRota = {
      cliente: { empresa: { findFirst: () => Promise.reject(new Error('P1001')) } },
    } as unknown as ContextoBd;

    const logo = await obtenerLogoEmpresa(1, bdRota, archivosCon(PNG_VALIDO));

    expect(logo.origen).toBe('empaquetado');
  });

  it('cae al empaquetado si el archivo guardado NO es una imagen soportada (evitaría reventar el PDF)', async () => {
    const basura = Buffer.from('%PDF-1.7 esto no es una imagen', 'utf8');

    const logo = await obtenerLogoEmpresa(
      1,
      bdCon({ archivoLogo: { id: 'arch1', key: 'k', tipoMime: 'image/png' } }),
      archivosCon(basura),
    );

    expect(logo.origen).toBe('empaquetado');
  });

  it('cachea el logo resuelto y lo suelta al invalidarlo', async () => {
    const consultar = vi.fn();
    const bd = bdCon({ archivoLogo: { id: 'arch1', key: 'k', tipoMime: 'image/png' } }, () => {
      consultar();
    });

    await obtenerLogoEmpresa(7, bd, archivosCon(PNG_VALIDO));
    await obtenerLogoEmpresa(7, bd, archivosCon(PNG_VALIDO));
    expect(consultar).toHaveBeenCalledTimes(1);

    invalidarLogoEmpresa(7);
    await obtenerLogoEmpresa(7, bd, archivosCon(PNG_VALIDO));
    expect(consultar).toHaveBeenCalledTimes(2);
  });

  it('recuerda un fallo MUY poco: no repite el viaje fallido en cada impreso…', async () => {
    const intentos = vi.fn<(maxBytes?: number) => void>();
    const bd = bdCon({ archivoLogo: { id: 'arch1', key: 'k', tipoMime: 'image/png' } });
    const archivos = archivosCon(new Error('R2 caído'), intentos);

    expect((await obtenerLogoEmpresa(9, bd, archivos)).origen).toBe('empaquetado');
    expect((await obtenerLogoEmpresa(9, bd, archivos)).origen).toBe('empaquetado');

    // Un bache de R2 no puede costar un viaje fallido por cada PDF que se imprima.
    expect(intentos).toHaveBeenCalledTimes(1);
  });

  it('…pero a los pocos segundos reintenta, y el logo real vuelve solo', async () => {
    vi.useFakeTimers();
    try {
      const bd = bdCon({ archivoLogo: { id: 'arch1', key: 'k', tipoMime: 'image/png' } });

      expect((await obtenerLogoEmpresa(9, bd, archivosCon(new Error('R2 caído')))).origen).toBe(
        'empaquetado',
      );

      // Pasada la ventana corta del fallo (10 s), se vuelve a intentar sin que nadie invalide nada.
      vi.advanceTimersByTime(11_000);

      expect((await obtenerLogoEmpresa(9, bd, archivosCon(PNG_VALIDO))).origen).toBe('empresa');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('obtenerLogoEmpresa — tope de tamaño', () => {
  beforeEach(() => {
    invalidarLogoEmpresa();
  });

  it('pide la descarga CON tope (5 MB): el objeto en R2 puede ser mayor que lo declarado al subir', async () => {
    const tope = vi.fn<(maxBytes?: number) => void>();

    await obtenerLogoEmpresa(
      1,
      bdCon({ archivoLogo: { id: 'arch1', key: 'k', tipoMime: 'image/png' } }),
      archivosCon(PNG_VALIDO, tope),
    );

    expect(tope).toHaveBeenCalledWith(5 * 1024 * 1024);
  });

  it('si el objeto excede el tope cae al empaquetado y CACHEA la decisión (no reintenta en cada PDF)', async () => {
    const descargas = vi.fn<(maxBytes?: number) => void>();
    const bd = bdCon({ archivoLogo: { id: 'arch1', key: 'k', tipoMime: 'image/png' } });
    const archivos = archivosCon(new ErrorArchivoDemasiadoGrande('pesa de más'), descargas);

    const primero = await obtenerLogoEmpresa(4, bd, archivos);
    const segundo = await obtenerLogoEmpresa(4, bd, archivos);

    expect(primero.origen).toBe('empaquetado');
    expect(segundo.origen).toBe('empaquetado');
    // "Pesa de más" es un estado ESTABLE del archivo: se resuelve una vez y se cachea, a
    // diferencia de un fallo de R2 (transitorio), que sí se reintenta.
    expect(descargas).toHaveBeenCalledTimes(1);
  });
});
