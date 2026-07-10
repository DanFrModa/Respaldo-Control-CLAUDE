/**
 * Helpers COMPARTIDOS de la importación de CFDI (F9-E3 proveedores / F9-E4 ventas). Viven aquí en UN
 * solo lugar para que la conciliación de CxP y la de CxC no dupliquen el chequeo del RFC de la empresa
 * activa ni el anti-duplicado por UUID (regla del lead: SIN copiar-pegar). El PARSER (`parser-cfdi.ts`)
 * ya es compartido; esto agrega los dos accesos a BD que ambos flujos necesitan.
 */
import type { clienteLectura } from '../../../comun/transaccion.js';

/**
 * RFC de la EMPRESA ACTIVA (A9). En CxP es el RECEPTOR esperado del CFDI del proveedor; en CxC es el
 * EMISOR esperado del CFDI de venta. Es un dato por empresa (columna `Empresa.rfc`, F9-E3), NO un
 * global: un env no distingue empresas. NULL si la empresa aún no capturó su RFC (→ solo se AVISA).
 */
export async function rfcEmpresaActiva(
  cliente: ReturnType<typeof clienteLectura>,
  idEmpresa: number,
): Promise<string | null> {
  const empresa = await cliente.empresa.findUnique({
    where: { id: idEmpresa },
    select: { rfc: true },
  });
  const rfc = empresa?.rfc ?? null;
  return rfc !== null && rfc.trim() !== '' ? rfc : null;
}

/**
 * ¿Ya se importó ese UUID? (chequeo previo para un error limpio; la unique GLOBAL de `MovimientoTercero`
 * de F9-E1 es el backstop ante carreras). El UUID es único a través de TODO el libro (CxC y CxP), así
 * que un mismo comprobante no se puede colar dos veces por ningún flujo.
 */
export async function uuidYaImportado(
  cliente: ReturnType<typeof clienteLectura>,
  uuid: string,
): Promise<boolean> {
  const existente = await cliente.movimientoTercero.findFirst({
    where: { uuidCfdi: uuid },
    select: { id: true },
  });
  return existente !== null;
}
