'use strict';

// Service worker de la extension.
//
// Al hacer clic en el icono:
//  1. Genera un "media stream id" de la pestaña activa con chrome.tabCapture.
//  2. Abre la ventana proyector (viewer.html), preferentemente en un segundo
//     monitor (el proyector) y en pantalla completa.
//  3. Le pasa el streamId por la URL; el viewer lo consume con getUserMedia.
//
// Si la pestaña activa no se puede capturar (p.ej. una pagina chrome://), el
// viewer se abre igual y ofrece capturar otra ventana/pantalla con
// chrome.desktopCapture.

chrome.action.onClicked.addListener(async (tab) => {
  let streamId = '';
  try {
    if (tab && tab.id != null) {
      streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    }
  } catch (err) {
    // No se pudo capturar la pestaña (chrome://, Web Store, etc.).
    // Se abre el viewer y el usuario podra elegir otra fuente.
    console.warn('[Trapecio] getMediaStreamId falló:', err && err.message);
  }

  const title = (tab && tab.title) ? tab.title : '';
  await openViewerWindow(streamId, title);
});

async function openViewerWindow(streamId, sourceTitle) {
  const url = chrome.runtime.getURL('viewer.html')
    + '?streamId=' + encodeURIComponent(streamId || '')
    + '&title=' + encodeURIComponent(sourceTitle || '');

  const target = await pickProjectorDisplay();

  const createOpts = { url, type: 'popup', focused: true };
  if (target) {
    // Colocamos la ventana sobre el monitor elegido antes de maximizar.
    createOpts.left = target.bounds.left;
    createOpts.top = target.bounds.top;
    createOpts.width = target.bounds.width;
    createOpts.height = target.bounds.height;
  }

  let win;
  try {
    win = await chrome.windows.create(createOpts);
  } catch (err) {
    // Como respaldo, abrir sin geometria explicita.
    win = await chrome.windows.create({ url, type: 'popup', focused: true });
  }

  // Poner la ventana en pantalla completa en el monitor donde quedo.
  if (win && win.id != null) {
    try {
      await chrome.windows.update(win.id, { state: 'fullscreen' });
    } catch (err) {
      /* algunos entornos no permiten fullscreen programatico; se ignora */
    }
  }
}

// Devuelve el display secundario (tipicamente el proyector) si existe,
// o null para usar la ubicacion por defecto.
async function pickProjectorDisplay() {
  try {
    const displays = await chrome.system.display.getInfo();
    if (!displays || displays.length === 0) return null;
    if (displays.length === 1) return null; // un solo monitor: no reubicar
    const secondary = displays.find((d) => !d.isPrimary);
    return secondary || displays[0];
  } catch (err) {
    return null;
  }
}
