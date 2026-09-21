/** Utilidades compartidas por los dos lectores de Excel. */

/**
 * Valor plano de una celda de exceljs.
 * Las celdas pueden venir como numero, texto, texto enriquecido, formula con
 * resultado, o error (#REF!). Aqui se aplanan todas a numero, texto o null.
 */
export function valorCelda(celda) {
  const v = celda?.value;
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('error' in v) return null; // #REF!, #VALUE!, ...
    if ('result' in v) return v.result ?? null; // formula evaluada
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return v.text;
  }
  return null;
}

export function numero(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  const texto = String(valor).trim().replace(/,/g, '');
  const n = Number(texto);
  return Number.isFinite(n) ? n : null;
}

export function texto(valor) {
  if (valor === null || valor === undefined) return '';
  const t = String(valor).trim();
  return t.toLowerCase() === 'nan' ? '' : t;
}
