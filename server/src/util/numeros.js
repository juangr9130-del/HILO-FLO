/** Utilidades numericas compartidas. Sin dependencias: se inlinea en el demo. */

/** Redondea a N decimales sin el ruido de punto flotante del toFixed. */
export function redondear(valor, decimales) {
  const f = 10 ** decimales;
  return Math.round(valor * f) / f;
}
