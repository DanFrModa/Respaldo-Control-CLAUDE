import type { ClavePermiso } from '@/api/tipos';

/**
 * ⭐ **QUIÉN CAPTURA LO QUE CUELGA DE UN CLIENTE** — fila 0.239 (§Post-F9.248(b)).
 *
 * Daniel, sobre Aurora: *«Administración o yo damos de alta al cliente. Ella puede meter información
 * de compradores, departamentos, datos de cada comprador»*. Por eso la ficha del cliente tiene DOS
 * rejas:
 *  • `clientes.administrar` → el cliente MISMO: «Nuevo cliente», «Editar», «Desactivar»/«Activar».
 *  • `clientes.modificar` (o `clientes.administrar`, que lo implica) → lo que cuelga de él: las
 *    personas, los departamentos y los campos de referencia.
 *  ⚠️ EXCEPTO «Juntar duplicados» (fusionar departamentos), que sigue en `clientes.administrar`:
 *    mueve o borra los factores de precio del absorbido, que son del dueño.
 *
 * Gemela de `exigirModificarCliente` del backend (`dominio/catalogos/acceso-clientes.ts`), que es la
 * que decide: la pantalla sólo esconde. Si el criterio cambia, cambia en los dos lados.
 */
export function puedeModificarCliente(tienePermiso: (clave: ClavePermiso) => boolean): boolean {
  return tienePermiso('clientes.administrar') || tienePermiso('clientes.modificar');
}
