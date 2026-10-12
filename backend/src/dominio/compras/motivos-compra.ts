/**
 * ⭐ Fila 0.231 (§Post-F9.245(b)) — **MOTIVOS DE UNA COMPRA EXTRA**: por qué existe una OC que es
 * sobrecosto (reposición, merma, sobre-corte…).
 *
 * Daniel, 30-sep-2026: una compra de más va en una OC NUEVA *«justo para saber que fue un sobre
 * precio»*, y *«reposición y merma podrían ser las primeras dos del catálogo»*. El tercero
 * (sobre-corte) salió de su pregunta siguiente: qué pasa si se cortan 20 % más prendas.
 *
 * Catálogo GLOBAL (A9 / ADR-0007, mismo patrón que `ConceptoCosto`): no tiene `idEmpresa`, así que
 * no hay «motivo de otra empresa» que rechazar — lo que se rechaza es el motivo que no existe o que
 * está desactivado. La lista base la siembra el seed (idempotente, por `codigo`) desde
 * {@link MOTIVOS_COMPRA_BASE}: una sola fuente para el seed y para las pruebas.
 *
 * 🔑 **El motivo COMPLEMENTA a `correspondeA`, no lo sustituye.** Medido en el volcado de Access
 * (7,978 OC): `CorrespondeA` contesta *«¿para qué / para quién es?»* («Ords. 123 a 130», «para
 * entregas Soriana»); el motivo contesta *«¿por qué es de más?»*. Vacío (NULL) = compra normal.
 *
 * Sin pantalla de alta en esta fila (default del lead: los motivos nuevos se piden); aquí sólo vive
 * la LECTURA para los selectores y las guardas que usan las OC y la explosión.
 */
import type { MotivoCompraSalida } from '../../contrato/esquemas/compra.js';
import { ErrorNoEncontrado, ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import { tienePermiso, type SesionUsuario } from '../../comun/permisos.js';
import { clienteLectura, type ClienteLectura, type ContextoBd } from '../../comun/transaccion.js';

/**
 * Código del motivo que el SISTEMA usa por su nombre: la OC que nace de la segunda pasada de la
 * explosión después de cortar de más lo trae propuesto (fila 0.232). Por eso es `fijo`.
 */
export const CODIGO_MOTIVO_SOBRE_CORTE = 'sobre-corte';

/**
 * Los motivos base (los siembra `prisma/seed.ts`, idempotente por `codigo`; el `update` del seed NO
 * pisa nombre/orden/activo si ya existe). Las definiciones de negocio de merma vs. reposición son
 * del lead, no de Daniel (van en sus preguntas): merma = se echó a perder o se desperdició en
 * nuestro proceso; reposición = se perdió o hay que volver a mandarlo.
 */
export const MOTIVOS_COMPRA_BASE: readonly {
  codigo: string;
  nombre: string;
  orden: number;
  fijo: boolean;
}[] = [
  { codigo: 'reposicion', nombre: 'Reposición', orden: 1, fijo: false },
  { codigo: 'merma', nombre: 'Merma', orden: 2, fijo: false },
  { codigo: CODIGO_MOTIVO_SOBRE_CORTE, nombre: 'Sobre-corte', orden: 3, fijo: true },
];

/**
 * Lista los motivos ACTIVOS, en su orden de despliegue (para los selectores de la OC y de la previa
 * de compra). La pide quien VE compras o quien las CAPTURA (la previa de la explosión es de
 * `compras.administrar`, y quien captura tiene que poder elegir aunque no tenga la consulta).
 */
export async function listarMotivosCompra(
  sesion: SesionUsuario,
  bd?: ContextoBd,
): Promise<MotivoCompraSalida[]> {
  if (!tienePermiso(sesion, 'compras.ver') && !tienePermiso(sesion, 'compras.administrar')) {
    throw new ErrorPermiso(undefined, 'compras.ver');
  }
  const motivos = await clienteLectura(bd).motivoCompra.findMany({
    where: { activo: true },
    orderBy: [{ orden: 'asc' }, { id: 'asc' }],
    select: { id: true, codigo: true, nombre: true, orden: true, fijo: true },
  });
  return motivos;
}

/**
 * Exige que el motivo exista y esté ACTIVO, o lanza. Se valida aquí (A1) y no sólo con la FK: un
 * motivo desactivado existe en la base pero ya no se debe poder elegir (mismo criterio que la
 * dirección de entrega).
 *
 * ⚠️ Sólo se llama cuando el motivo CAMBIA: una OC que ya trae un motivo que después se desactivó
 * conserva el suyo al editar otros campos (es historia, no una elección nueva).
 */
export async function exigirMotivoCompraValido(
  cliente: ClienteLectura,
  idMotivoCompra: number,
): Promise<{ id: number; codigo: string; nombre: string }> {
  const motivo = await cliente.motivoCompra.findUnique({
    where: { id: idMotivoCompra },
    select: { id: true, codigo: true, nombre: true, activo: true },
  });
  if (motivo === null) {
    throw new ErrorNoEncontrado('Motivo de compra', idMotivoCompra);
  }
  if (!motivo.activo) {
    throw new ErrorValidacion(
      `El motivo de compra "${motivo.nombre}" está desactivado: elige otro, o déjala como compra normal.`,
    );
  }
  return { id: motivo.id, codigo: motivo.codigo, nombre: motivo.nombre };
}

/** Busca un motivo ACTIVO por su código (el que el sistema usa por nombre); `null` si no está. */
export async function motivoActivoPorCodigo(
  cliente: ClienteLectura,
  codigo: string,
): Promise<{ id: number; codigo: string; nombre: string } | null> {
  return cliente.motivoCompra.findFirst({
    where: { codigo, activo: true },
    select: { id: true, codigo: true, nombre: true },
  });
}
