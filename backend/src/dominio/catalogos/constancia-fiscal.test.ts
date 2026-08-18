/**
 * Pruebas del lector de la Constancia de Situación Fiscal (§Post-F9.55).
 *
 * ⚠️ SOBRE LOS FIXTURES: los dos PDF reales que mandó Daniel NO están en el repo (son documentos
 * personales y no se comitean). Lo que se prueba aquí es el TEXTO tal como sale del PDF, reconstruido
 * a partir de la estructura verificada sobre esos documentos y **anonimizado** (RFC, CURP y nombres
 * inventados; la calle "TAINE" se conserva porque es justo el dato del caso pegado). El caso
 * patológico —`Tipo de Vialidad: Nombre de Vialidad: TAINE`— se reproduce LITERAL: es el que hace
 * fallar en silencio a un lector que corte por fin de línea.
 */
import { describe, expect, it } from 'vitest';

import {
  parsearRegimenes,
  parsearTextoConstancia,
  valorEntreEtiquetas,
} from './constancia-fiscal.js';

/**
 * Persona FÍSICA. Reproduce las cuatro trampas a la vez:
 *  • `Tipo de Vialidad`, `Nombre de la Localidad` y `Entre Calle` vienen VACÍOS y dejan el texto
 *    pegado a la etiqueta siguiente.
 *  • La razón social NO viene: se compone de nombre + apellidos.
 *  • Trae DOS regímenes.
 *  • `Entre Calle:` cierra la página 1 y `Y Calle:` abre la 2.
 */
const FISICA_PAGINAS = [
  [
    'CÉDULA DE IDENTIFICACIÓN FISCAL',
    'RFC: MASD850101H29',
    'Datos de identificación del contribuyente:',
    'CURP: MASD850101HDFRRN04',
    'Nombre (s): DANIELA',
    'Primer Apellido: MARTINEZ',
    'Segundo Apellido: SOLIS',
    'Fecha inicio de operaciones: 01/03/2010',
    'Estatus en el padrón: ACTIVO',
    'Fecha de último cambio de estado: 15/06/2022',
    'Datos del domicilio registrado:',
    'Código Postal: 06600',
    'Tipo de Vialidad: Nombre de Vialidad: TAINE',
    'Número Exterior: 412',
    'Número Interior:',
    'Nombre de la Colonia: POLANCO',
    'Nombre de la Localidad: Municipio o Delegación: MIGUEL HIDALGO',
    'Nombre de la Entidad Federativa: CIUDAD DE MEXICO',
    'Entre Calle:',
  ].join('\n'),
  [
    'Y Calle: HOMERO',
    'Características fiscales:',
    'Regímenes:',
    'Régimen Fecha Inicio Fecha Fin',
    'Régimen de Actividades Empresariales y Profesionales 01/03/2010',
    'Régimen Simplificado de Confianza 01/01/2022',
    'Obligaciones:',
    'Declaración anual de ISR 30/04',
  ].join('\n'),
];

/** Persona MORAL. Trae denominación, régimen capital, `Nombre Comercial` VACÍO y UN solo régimen. */
const MORAL_PAGINAS = [
  [
    'CÉDULA DE IDENTIFICACIÓN FISCAL',
    'RFC: TEX010203AB1',
    'Datos de identificación del contribuyente:',
    'Denominación/Razón Social: TEXTILES DEL VALLE',
    'Régimen Capital: SOCIEDAD ANONIMA DE CAPITAL VARIABLE',
    'Nombre Comercial: Fecha de inicio de operaciones: 03/02/2001',
    'Estatus en el padrón: ACTIVO',
    'Datos del domicilio registrado:',
    'Código Postal: 54080',
    'Tipo de Vialidad: CALLE',
    'Nombre de Vialidad: LERDO DE TEJADA',
    'Número Exterior: 27',
    'Número Interior: B',
    'Nombre de la Colonia: CENTRO INDUSTRIAL',
    'Nombre de la Localidad: TLALNEPANTLA',
    'Municipio o Delegación: TLALNEPANTLA DE BAZ',
    'Nombre de la Entidad Federativa: MEXICO',
    'Características fiscales:',
    'Regímenes:',
    'Régimen Fecha Inicio Fecha Fin',
    'Régimen General de Ley Personas Morales 03/02/2001',
    'Obligaciones:',
  ].join('\n'),
];

describe('valorEntreEtiquetas — el corte va en la SIGUIENTE etiqueta, no en el fin de línea', () => {
  const texto = FISICA_PAGINAS.join('\n');

  it('⭐ un campo etiquetado VACÍO devuelve vacío, NO el texto de la etiqueta de al lado', () => {
    // Éste es EL defecto invisible: cortar por fin de línea daría 'Nombre de Vialidad: TAINE'.
    expect(valorEntreEtiquetas(texto, 'Tipo de Vialidad')).toBe('');
    expect(valorEntreEtiquetas(texto, 'Nombre de Vialidad')).toBe('TAINE');
  });

  it('lo mismo con la localidad vacía pegada al municipio', () => {
    expect(valorEntreEtiquetas(texto, 'Nombre de la Localidad')).toBe('');
    expect(valorEntreEtiquetas(texto, 'Municipio o Delegaci[oó]n')).toBe('MIGUEL HIDALGO');
  });

  it('lo mismo en la moral: `Nombre Comercial` vacío no se come la fecha de inicio', () => {
    const moral = MORAL_PAGINAS.join('\n');
    expect(valorEntreEtiquetas(moral, 'Nombre Comercial')).toBe('');
    expect(valorEntreEtiquetas(moral, 'Régimen Capital')).toBe(
      'SOCIEDAD ANONIMA DE CAPITAL VARIABLE',
    );
  });

  it('⭐ un campo PARTIDO entre páginas se lee (todo el documento se concatena antes de recortar)', () => {
    // `Entre Calle:` cierra la página 1 (vacío) y `Y Calle: HOMERO` abre la 2. Parsear página por
    // página perdería el segundo; cortar por fin de línea metería 'Y Calle: HOMERO' en el primero.
    expect(valorEntreEtiquetas(texto, 'Entre Calle')).toBe('');
    expect(valorEntreEtiquetas(texto, 'Y Calle')).toBe('HOMERO');
  });

  it('una etiqueta que no está devuelve vacío (no truena)', () => {
    expect(valorEntreEtiquetas(texto, 'Nombre Comercial')).toBe('');
  });
});

describe('parsearTextoConstancia — persona FÍSICA', () => {
  const r = parsearTextoConstancia(FISICA_PAGINAS);

  it('la reconoce como física por el CURP', () => {
    expect(r.tipoPersona).toBe('fisica');
    expect(r.curp).toBe('MASD850101HDFRRN04');
  });

  it('lee el RFC', () => {
    expect(r.rfc).toBe('MASD850101H29');
  });

  it('COMPONE la razón social con nombre y apellidos (el SAT no la imprime)', () => {
    expect(r.razonSocial).toBe('DANIELA MARTINEZ SOLIS');
  });

  it('arma el domicilio SIN la basura del campo vacío y sin huecos', () => {
    expect(r.direccion).toBe(
      'TAINE No. 412, Col. POLANCO, MIGUEL HIDALGO, CIUDAD DE MEXICO, C.P. 06600',
    );
    expect(r.direccion).not.toContain('Nombre de Vialidad');
    expect(r.direccion).not.toContain('Municipio');
  });

  it('lee el código postal de expedición', () => {
    expect(r.codigoPostalExpedicion).toBe('06600');
  });

  it('⭐ propone LOS DOS regímenes (no toma el primero en silencio) y avisa', () => {
    expect(r.regimenes).toEqual([
      {
        clave: '612',
        descripcion: 'Personas Físicas con Actividades Empresariales y Profesionales',
      },
      { clave: '626', descripcion: 'Régimen Simplificado de Confianza' },
    ]);
    expect(r.advertencias.some((a) => a.includes('2 regímenes'))).toBe(true);
  });
});

describe('parsearTextoConstancia — persona MORAL', () => {
  const r = parsearTextoConstancia(MORAL_PAGINAS);

  it('la reconoce como moral (sin CURP) y lee la denominación tal cual', () => {
    expect(r.tipoPersona).toBe('moral');
    expect(r.curp).toBe('');
    expect(r.razonSocial).toBe('TEXTILES DEL VALLE');
  });

  it('lee RFC, CP y domicilio completo con interior', () => {
    expect(r.rfc).toBe('TEX010203AB1');
    expect(r.codigoPostalExpedicion).toBe('54080');
    expect(r.direccion).toBe(
      'CALLE LERDO DE TEJADA No. 27 Int. B, Col. CENTRO INDUSTRIAL, TLALNEPANTLA, ' +
        'TLALNEPANTLA DE BAZ, MEXICO, C.P. 54080',
    );
  });

  it('mapea el régimen 601 y NO avisa de nada', () => {
    expect(r.regimenes).toEqual([{ clave: '601', descripcion: 'General de Ley Personas Morales' }]);
    expect(r.advertencias).toEqual([]);
  });
});

describe('degradar con gracia (nunca bloquear el alta)', () => {
  it('un documento sin regímenes reconocibles devuelve el texto crudo y avisa', () => {
    const raro = [
      'RFC: XAXX010101000',
      'Denominación/Razón Social: LO QUE SEA SA',
      'Código Postal: 11000',
      'Nombre de Vialidad: REFORMA',
      'Regímenes:',
      'Régimen Fecha Inicio Fecha Fin',
      'Régimen Marciano de Nueva Creación 01/01/2030',
      'Obligaciones:',
    ].join('\n');
    const r = parsearTextoConstancia([raro]);
    expect(r.regimenes).toHaveLength(1);
    expect(r.regimenes[0]?.clave).toBe('');
    expect(r.regimenes[0]?.descripcion).toContain('Marciano');
    expect(r.advertencias.some((a) => a.includes('catálogo del SAT'))).toBe(true);
  });

  it('un texto sin nada de constancia devuelve vacíos y advertencias, no una excepción', () => {
    const r = parsearTextoConstancia(['Esto es una factura cualquiera. Total: $1,234.00']);
    expect(r.rfc).toBe('');
    expect(r.razonSocial).toBe('');
    expect(r.advertencias.length).toBeGreaterThanOrEqual(3);
  });

  it('sin bloque de regímenes devuelve lista vacía', () => {
    expect(parsearRegimenes('RFC: XAXX010101000')).toEqual([]);
  });
});

describe('el catálogo del SAT no se confunde entre regímenes parecidos', () => {
  it('«Plataformas Tecnológicas» es 625, no 612', () => {
    const t =
      'Regímenes: Régimen de las Actividades Empresariales con ingresos a través de ' +
      'Plataformas Tecnológicas 01/01/2020 Obligaciones:';
    expect(parsearRegimenes(t)).toEqual([
      {
        clave: '625',
        descripcion: 'Actividades Empresariales con ingresos a través de Plataformas Tecnológicas',
      },
    ]);
  });

  it('reconoce el régimen aunque el papel venga sin acentos', () => {
    const t = 'Regimenes: Regimen Simplificado de Confianza 01/01/2022 Obligaciones:';
    expect(parsearRegimenes(t)).toEqual([
      { clave: '626', descripcion: 'Régimen Simplificado de Confianza' },
    ]);
  });
});
