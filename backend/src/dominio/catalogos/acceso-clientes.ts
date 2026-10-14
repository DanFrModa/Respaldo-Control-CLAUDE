/**
 * QUIÉN PUEDE TOCAR LO QUE CUELGA DE UN CLIENTE: la reja de `clientes.modificar` (fila 0.239).
 *
 * Daniel, sobre Aurora (§Post-F9.248(b) de `DECISIONES.md`): *«Administración o yo damos de alta al
 * cliente. **Ella puede meter información de compradores, departamentos, datos de cada comprador**»*.
 * Hasta la 0.239 esa línea no se podía trazar: todas las mutaciones del cliente —el alta y la baja,
 * pero también sus personas, sus departamentos y sus campos de referencia— exigían
 * `clientes.administrar`, y `clientes.modificar` no lo exigía NADIE (era una llave muerta).
 *
 * Desde la 0.239 el reparto queda así:
 *  • **`clientes.modificar`** → lo que CUELGA del cliente: personas (compradoras), departamentos
 *    (agregar, editar, desactivar y reactivar) y campos de referencia (D7).
 *  • **`clientes.administrar`** → el cliente MISMO: darlo de alta, editar su ficha, desactivarlo y
 *    reactivarlo. **Y la FUSIÓN de departamentos (con su previa)**, aunque sea de departamentos:
 *    mueve o borra los factores de precio del absorbido, que son del dueño (§Post-F9.125), y abrirla
 *    a `modificar` dejaría borrarlos sin `listas.aprobar` (hallazgo del reviewer de la 0.239).
 *
 * Vive aparte —y no dentro de `clientes.ts`— porque la exigen tres módulos (`clientes.ts`,
 * `cliente-departamentos.ts`, `cliente-contactos.ts`) y `clientes.ts` ya importa a
 * `cliente-departamentos.ts`: ponerla en cualquiera de ellos crearía un ciclo o una segunda copia de
 * la regla. Mismo molde que `pagos/acceso-corrida.ts` (`exigirVerCorrida`) y que la llave de Ventas
 * (`edr/ventas.ts::exigirVerVentas`, fila 0.251).
 *
 * Aquí no hay negocio: sólo el permiso.
 */
import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';

/**
 * Exige poder MODIFICAR lo que cuelga de un cliente (personas, departamentos, campos de referencia).
 * Pasa con `clientes.modificar` **o** con `clientes.administrar`: quien da de alta y edita el cliente
 * entero obviamente puede tocar lo que cuelga de él, y nadie que ya lo hacía lo pierde. Sigue siendo
 * deny-by-default (A4): sin ninguna de las dos, 403 nombrando `clientes.modificar`, que es la llave
 * que hay que dar.
 *
 * ⚠️ La inversa NO vale y es la razón de la fila: `clientes.modificar` no da de alta, no edita la
 * ficha ni desactiva/reactiva un cliente (`crearCliente`, `actualizarCliente`, `desactivarCliente`,
 * `reactivarCliente` siguen exigiendo `clientes.administrar` a secas), y tampoco fusiona
 * departamentos (`fusionarDepartamentosCliente`, `previsualizarFusionDepartamentos`).
 */
export function exigirModificarCliente(sesion: SesionUsuario): void {
  if (tienePermiso(sesion, 'clientes.administrar')) {
    return;
  }
  verificarPermiso(sesion, 'clientes.modificar');
}
