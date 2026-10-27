/* Desplazamiento suave con Lenis 1.3.27 (MIT). Se mantiene el scroll nativo
   si no hay conexión al CDN o si el navegador no soporta la biblioteca. */
(() => {
  'use strict';
  if (typeof window.Lenis !== 'function') return;
  try {
    window.shinydexLenis = new window.Lenis({
      autoRaf: true,
      anchors: true,
      duration: 1.08,
      smoothWheel: true,
      touchMultiplier: 1,
      // Los diálogos se desplazan de forma nativa e independiente.
      prevent: (node) => Boolean(node.closest('dialog[open]')),
    });
  } catch (error) {
    console.warn('Lenis no se ha podido iniciar; se utilizará el scroll nativo.', error);
  }
})();
