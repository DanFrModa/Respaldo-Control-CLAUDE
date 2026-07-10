/**
 * FUENTE de los límites de antigüedad de saldos (aging, F9-E5; D15d). Cierra la promesa de E2/E4: los
 * límites de las cubetas dejaron de ser la constante `30/60` y pasaron a CONFIGURACIÓN por empresa
 * (`ConfiguracionEmpresa.agingLimite1/2`). La MECÁNICA del aging sigue viviendo, pura, en
 * `aging-comun.ts` (recibe los límites como parámetro); esto solo resuelve QUÉ límites usar para una
 * empresa. CxP y CxC leen de aquí antes de agregar sus bandejas.
 */
import { LIMITES_AGING_DEFECTO, type LimitesAging } from './aging-comun.js';
import type { clienteLectura } from '../../comun/transaccion.js';

/**
 * Lee los límites de aging de la empresa (A9). Cae al default 30/60 si la empresa aún no tiene
 * configuración (seed) o si —por datos manipulados fuera del dominio— quedaran incoherentes
 * (`limite1 >= limite2`); el alta/edición ya impone `limite1 < limite2`, así que en operación normal
 * se devuelven tal cual los valores guardados.
 */
export async function leerLimitesAging(
  cliente: ReturnType<typeof clienteLectura>,
  idEmpresa: number,
): Promise<LimitesAging> {
  const cfg = await cliente.configuracionEmpresa.findUnique({
    where: { idEmpresa },
    select: { agingLimite1: true, agingLimite2: true },
  });
  if (cfg === null || cfg.agingLimite1 >= cfg.agingLimite2) {
    return LIMITES_AGING_DEFECTO;
  }
  return { d30: cfg.agingLimite1, d60: cfg.agingLimite2 };
}
