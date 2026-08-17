/**
 * Mapeos de códigos del sistema viejo a los enums de v2 (F1-E6, ETL). Funciones puras,
 * cubiertas por tests unitarios.
 */
import type { TipoComponenteTelaClave } from '../../src/contrato/esquemas/tela.js';
import type { TipoProveedorClave } from '../../src/contrato/esquemas/proveedor.js';

import { parsearBandera } from './valores.js';

/**
 * `Proveedores.TipoProv` (H/T/S, doc 03-Producción §Órdenes de Compra) → enum `TipoProveedor`.
 *  • H → AVIOS (habilitación)
 *  • T → TELAS
 *  • S → SERVICIOS
 *  • vacío / desconocido → SIN_CLASIFICAR
 */
export function mapearTipoProveedor(tipoProv: string | undefined | null): TipoProveedorClave {
  switch ((tipoProv ?? '').trim().toUpperCase()) {
    case 'H':
      return 'AVIOS';
    case 'T':
      return 'TELAS';
    case 'S':
      return 'SERVICIOS';
    default:
      return 'SIN_CLASIFICAR';
  }
}

/**
 * `Proveedores.TipoProv` (H/T/S) → CÓDIGO de rol de `RolProveedor` (kebab-case sembrado en
 * `prisma/seed.ts`, `ROLES_PROVEEDOR_BASE`). A diferencia de `mapearTipoProveedor` (que da el
 * enum `tipo`, clasificador rápido), este da el ROL de servicio que el proveedor presta —
 * lo que F4-Compras/MRP filtra:
 *  • T → `vende-telas`
 *  • H → `vende-avios` (habilitación)
 *  • S / vacío / desconocido → `otros-servicios`
 *
 * Los tres códigos existen en el catálogo base (seed); el dominio exige ≥1 rol y este SIEMPRE
 * devuelve uno (nunca cadena vacía), así que cumple la regla.
 */
export function mapearRolProveedorComercial(tipoProv: string | undefined | null): string {
  switch ((tipoProv ?? '').trim().toUpperCase()) {
    case 'T':
      return 'vende-telas';
    case 'H':
      return 'vende-avios';
    default:
      // S, vacío o cualquier otro código no reconocido.
      return 'otros-servicios';
  }
}

/**
 * `Maquileros.Costura`/`Proceso` → CÓDIGOS de rol de `RolProveedor` (fusión de terceros).
 * Aclaración de Daniel: "Proceso" = cualquier DECORADO de la prenda (estampado/bordado/
 * lavado, que usan indistintamente) → rol `estampado` (decoración canónica del seed):
 *  • `costura` → `maquila-costura`
 *  • `proceso` → `estampado`
 *  • ambas → ambos roles
 *  • ninguna → `maquila-costura` (un taller sin banderas se asume de costura, lo más común;
 *    el dominio exige ≥1 rol y este SIEMPRE devuelve al menos uno).
 *
 * Devuelve los códigos SIN repetir. El sub-servicio fino de la decoración (estampado vs
 * bordado vs lavado) lo afina Gabriel después; el viejo no lo distingue.
 */
export function rolesDeMaquilero(costura: boolean, proceso: boolean): string[] {
  const roles: string[] = [];
  if (costura) {
    roles.push('maquila-costura');
  }
  if (proceso) {
    roles.push('estampado');
  }
  if (roles.length === 0) {
    roles.push('maquila-costura');
  }
  return roles;
}

/**
 * `Bordados.BorEst` → **código del tipo de arte** en el catálogo único (`TipoProceso.codigo`). En
 * el viejo `BorEst` distingue bordado real de estampado/aplicación: `0`/vacío = bordado, distinto
 * de 0 = estampado.
 *
 * ⚠️ V1-E3f: antes devolvía el enum `TipoArte` (`BORDADO`/`ESTAMPADO`), que ya no existe — el tipo
 * es una FK al catálogo administrable (§Post-F9.58). Devuelve el `codigo`, que es la clave estable
 * con la que el loader resuelve el id (los mismos dos valores que tradujo la migración SQL).
 */
export function mapearTipoArte(borEst: string | undefined | null): 'bordado' | 'estampado' {
  const t = (borEst ?? '').trim();
  if (t === '' || t === '0') {
    return 'bordado';
  }
  const n = Number(t);
  if (Number.isFinite(n)) {
    return n === 0 ? 'bordado' : 'estampado';
  }
  // Texto no numérico distinto de vacío: lo tratamos como estampado (señal de no-bordado).
  return 'estampado';
}

/**
 * `Telas.Medida` del Access → unidad de la tela (KG/M). El mapeo NO se adivinó: el formulario viejo
 * `AgregarTelas` lo declara literal en su combo — `RowSource = "-1;\"Kilos\";0;\"Metros\""` — y el
 * form `ExisTela` lo confirma en su barra de estado ("Si=Kilos, No=Metros"). En el volcado son 735
 * telas en kilos y 142 en metros.
 */
export function mapearUnidadTela(medida: string | undefined): 'KG' | 'M' {
  return parsearBandera(medida) ? 'KG' : 'M';
}

/**
 * `Telas.Texto1`/`Texto2` (etiquetas de componente, p. ej. "Felpa"/"Cardigan", doc
 * 04-Inventarios §B.1) → enum `TipoComponenteTela`. Heurística: si el texto del componente
 * principal menciona "cardigan", es CARDIGAN; si menciona cuerpo/felpa/terry (telas de
 * cuerpo típicas), CUERPO; en otro caso OTRO. Es una clasificación informativa (D5); la
 * decisión fina la podrá ajustar Gabriel en la UI.
 */
export function mapearTipoComponente(
  texto1: string | undefined | null,
  texto2: string | undefined | null,
): TipoComponenteTelaClave {
  const t = `${texto1 ?? ''} ${texto2 ?? ''}`.toLowerCase();
  if (t.includes('cardigan')) {
    return 'CARDIGAN';
  }
  if (t.includes('cuerpo') || t.includes('felpa') || t.includes('terry') || t.includes('jersey')) {
    return 'CUERPO';
  }
  return 'OTRO';
}
