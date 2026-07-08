'use strict';

/*
 * Viewer / proyector.
 *
 * Toma el MediaStream de la pestaña capturada (o de otra ventana/pantalla
 * elegida con desktopCapture), lo sube como textura de video a WebGL y lo
 * dibuja sobre un cuadrilatero cuyas 4 esquinas se pueden mover. El mapeo de
 * textura es "perspective-correct" (usando la coordenada homogenea q derivada
 * de la interseccion de las diagonales), de modo que un trapecio muestra la
 * imagen como si fuera un rectangulo proyectado: exactamente lo que se necesita
 * para corregir el keystone de un proyector por software.
 *
 * Las coordenadas de las esquinas viven en NDC (-1..1). La parte inferior por
 * defecto queda pegada a los bordes de la pantalla; las esquinas superiores se
 * juntan/separan con los botones Acercar/Alejar.
 */

// ------------------------------------------------------------------ estado ---

const STORAGE_KEY = 'trapecioKeystone.corners.v1';
const STEP_KEY = 'trapecioKeystone.step.v1';
const FLIP_KEY = 'trapecioKeystone.flip.v1';

function defaultCorners() {
  return {
    tl: { x: -1, y: 1 },   // superior izquierda
    tr: { x: 1, y: 1 },    // superior derecha
    br: { x: 1, y: -1 },   // inferior derecha
    bl: { x: -1, y: -1 },  // inferior izquierda
  };
}

let corners = loadCorners();
let step = loadStep();          // magnitud del ajuste en unidades NDC
let selectedCorner = null;      // 'tl' | 'tr' | 'br' | 'bl' | null
let gridOn = false;
const flip = loadFlip();        // { h: bool, v: bool }

let stream = null;
let video = null;

// WebGL
let gl = null;
let program = null;
let positionBuffer = null;
let texcoordBuffer = null;
let indexBuffer = null;
let texture = null;
let aPosition = -1;
let aTexcoord = -1;
let uTexture = null;
let uGrid = null;

// DOM
const canvas = document.getElementById('gl');
const overlay = document.getElementById('overlay');
const overlayMsg = document.getElementById('overlayMsg');
const panel = document.getElementById('panel');
const readout = document.getElementById('readout');

// -------------------------------------------------------------- utilidades ---

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function loadCorners() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const c = JSON.parse(raw);
      if (c && c.tl && c.tr && c.br && c.bl) return c;
    }
  } catch (e) { /* ignora */ }
  return defaultCorners();
}

function saveCorners() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(corners)); } catch (e) { /* ignora */ }
}

function loadStep() {
  const v = parseFloat(localStorage.getItem(STEP_KEY));
  return (isFinite(v) && v > 0) ? v : 0.01;
}

function saveStep() {
  try { localStorage.setItem(STEP_KEY, String(step)); } catch (e) { /* ignora */ }
}

function loadFlip() {
  try {
    const c = JSON.parse(localStorage.getItem(FLIP_KEY));
    if (c && typeof c.h === 'boolean' && typeof c.v === 'boolean') return c;
  } catch (e) { /* ignora */ }
  return { h: false, v: false };
}

function saveFlip() {
  try { localStorage.setItem(FLIP_KEY, JSON.stringify(flip)); } catch (e) { /* ignora */ }
}

// --------------------------------------------------------- geometria/trapecio ---

// A partir de las 4 esquinas calcula posiciones (NDC) y coordenadas de textura
// homogeneas (u*q, v*q, q) para un mapeo perspective-correct.
function computeGeometry() {
  const p0 = corners.tl, p1 = corners.tr, p2 = corners.br, p3 = corners.bl;

  const positions = new Float32Array([
    p0.x, p0.y,
    p1.x, p1.y,
    p2.x, p2.y,
    p3.x, p3.y,
  ]);

  // Interseccion de las diagonales p0-p2 y p1-p3.
  //   p0 + s*(p2-p0) = p1 + t*(p3-p1)
  const rX = p2.x - p0.x, rY = p2.y - p0.y; // direccion diagonal A
  const eX = p3.x - p1.x, eY = p3.y - p1.y; // direccion diagonal B
  const qX = p1.x - p0.x, qY = p1.y - p0.y;
  const det = rX * (-eY) - (-eX) * rY;      // = -rX*eY + eX*rY

  let s = 0.5, t = 0.5;
  if (Math.abs(det) > 1e-9) {
    s = (qX * (-eY) - (-eX) * qY) / det;
    t = (rX * qY - qX * rY) / det;
  }
  const eps = 1e-3;
  s = clamp(s, eps, 1 - eps);
  t = clamp(t, eps, 1 - eps);

  // Pesos homogeneos por vertice (ver Heckbert, mapeo de quads).
  const w0 = 1 / (1 - s); // TL
  const w2 = 1 / s;       // BR
  const w1 = 1 / (1 - t); // TR
  const w3 = 1 / t;       // BL

  // UV base con orientación correcta (usamos UNPACK_FLIP_Y_WEBGL = false).
  // TL(0,0) TR(1,0) BR(1,1) BL(0,1). Los volteos intercambian los bordes:
  //  - flip.h intercambia u izquierda/derecha
  //  - flip.v intercambia v arriba/abajo
  const ul = flip.h ? 1 : 0; // u del lado izquierdo
  const ur = flip.h ? 0 : 1; // u del lado derecho
  const vt = flip.v ? 1 : 0; // v del borde superior
  const vb = flip.v ? 0 : 1; // v del borde inferior
  const texcoords = new Float32Array([
    ul * w0, vt * w0, w0, // TL
    ur * w1, vt * w1, w1, // TR
    ur * w2, vb * w2, w2, // BR
    ul * w3, vb * w3, w3, // BL
  ]);

  return { positions, texcoords };
}

function rebuildGeometry() {
  if (!gl) return;
  const { positions, texcoords } = computeGeometry();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, texcoordBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, texcoords, gl.DYNAMIC_DRAW);
  updateReadout();
}

// ------------------------------------------------------------------ WebGL ---

const VERT_SRC = `
attribute vec2 a_position;
attribute vec3 a_texcoord;
varying vec3 v_texcoord;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texcoord = a_texcoord;
}
`;

const FRAG_SRC = `
precision mediump float;
uniform sampler2D u_texture;
uniform float u_grid;
varying vec3 v_texcoord;
void main() {
  vec2 uv = v_texcoord.xy / v_texcoord.z;
  vec4 col = texture2D(u_texture, uv);
  if (u_grid > 0.5) {
    vec2 f = fract(uv * 10.0);
    float lw = 0.02;
    if (f.x < lw || f.x > 1.0 - lw || f.y < lw || f.y > 1.0 - lw) {
      col.rgb = mix(col.rgb, vec3(0.1, 1.0, 0.45), 0.7);
    }
    // borde exterior mas marcado
    float b = 0.006;
    if (uv.x < b || uv.x > 1.0 - b || uv.y < b || uv.y > 1.0 - b) {
      col.rgb = vec3(1.0, 0.3, 0.3);
    }
  }
  gl_FragColor = col;
}
`;

function compileShader(type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error('Error de shader: ' + gl.getShaderInfoLog(sh));
  }
  return sh;
}

function initGL() {
  gl = canvas.getContext('webgl', { antialias: true, preserveDrawingBuffer: false })
    || canvas.getContext('experimental-webgl');
  if (!gl) throw new Error('WebGL no está disponible en este navegador.');

  const vs = compileShader(gl.VERTEX_SHADER, VERT_SRC);
  const fs = compileShader(gl.FRAGMENT_SHADER, FRAG_SRC);
  program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error('Error al enlazar el programa: ' + gl.getProgramInfoLog(program));
  }
  gl.useProgram(program);

  aPosition = gl.getAttribLocation(program, 'a_position');
  aTexcoord = gl.getAttribLocation(program, 'a_texcoord');
  uTexture = gl.getUniformLocation(program, 'u_texture');
  uGrid = gl.getUniformLocation(program, 'u_grid');

  positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.enableVertexAttribArray(aPosition);
  gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

  texcoordBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, texcoordBuffer);
  gl.enableVertexAttribArray(aTexcoord);
  gl.vertexAttribPointer(aTexcoord, 3, gl.FLOAT, false, 0, 0);

  indexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);

  texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.activeTexture(gl.TEXTURE0);
  gl.uniform1i(uTexture, 0);

  rebuildGeometry();
  requestAnimationFrame(render);
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
  }
}

function render() {
  requestAnimationFrame(render);
  if (!gl) return;
  resizeCanvas();
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  if (video && video.readyState >= 2 && video.videoWidth > 0) {
    gl.useProgram(program);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    } catch (e) {
      return; // frame no listo aun
    }
    gl.uniform1f(uGrid, gridOn ? 1.0 : 0.0);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  }
}

// ------------------------------------------------------------- captura ---

function getTabStream(streamId) {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
        maxWidth: 3840,
        maxHeight: 2160,
        maxFrameRate: 60,
      },
    },
  });
}

function chooseDesktopStream() {
  return new Promise((resolve, reject) => {
    chrome.desktopCapture.chooseDesktopMedia(['screen', 'window', 'tab'], (id) => {
      if (!id) {
        reject(new Error('Selección cancelada.'));
        return;
      }
      navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: id,
            maxWidth: 3840,
            maxHeight: 2160,
            maxFrameRate: 60,
          },
        },
      }).then(resolve, reject);
    });
  });
}

function getWebcamStream(deviceId) {
  const videoConstraints = deviceId
    ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
    : { width: { ideal: 1920 }, height: { ideal: 1080 } };
  return navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints });
}

let currentMode = null; // 'tab' | 'desktop' | 'webcam'

function setSource(mode) {
  currentMode = mode;
  const map = { tab: 'srcTab', desktop: 'srcDesktop', webcam: 'srcWebcam' };
  for (const m in map) {
    const el = document.getElementById(map[m]);
    if (el) el.classList.toggle('active', m === mode);
  }
  const cr = document.getElementById('cameraRow');
  if (cr) cr.hidden = (mode !== 'webcam');
}

async function populateCameraList() {
  const sel = document.getElementById('cameraSelect');
  if (!sel) return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter((d) => d.kind === 'videoinput');
    sel.innerHTML = '';
    cams.forEach((d, i) => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || ('Cámara ' + (i + 1));
      sel.appendChild(opt);
    });
    const track = stream && stream.getVideoTracks()[0];
    const settings = track && track.getSettings ? track.getSettings() : null;
    if (settings && settings.deviceId) sel.value = settings.deviceId;
  } catch (e) { /* ignora */ }
}

// Envoltorios que inician cada fuente y actualizan la UI.
async function startTab(streamId) {
  if (!streamId) {
    throw new Error('No hay una pestaña capturada. Vuelve a hacer clic en el icono de la extensión desde la pestaña que quieras proyectar.');
  }
  await useStream(await getTabStream(streamId));
  setSource('tab');
}

async function startDesktop() {
  await useStream(await chooseDesktopStream());
  setSource('desktop');
}

async function startWebcam(deviceId) {
  await useStream(await getWebcamStream(deviceId));
  setSource('webcam');
  await populateCameraList();
}

async function useStream(newStream) {
  // Cierra el stream anterior si lo hubiera.
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
  }
  stream = newStream;

  if (!video) {
    video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
  }
  video.srcObject = stream;
  await video.play().catch(() => { /* algunos navegadores reproducen igual */ });

  const track = stream.getVideoTracks()[0];
  if (track) {
    track.addEventListener('ended', () => {
      showOverlay('La captura terminó. Elige una fuente para volver a proyectar.', true);
    });
  }
  hideOverlay();
}

// --------------------------------------------------------------- overlay ---

function showOverlay(msg, showButtons) {
  overlayMsg.textContent = msg;
  overlay.classList.remove('hidden');
  const show = !!showButtons;
  document.getElementById('btnPickOther').hidden = !show;
  document.getElementById('btnUseWebcam').hidden = !show;
  document.getElementById('btnUseTab').hidden = true;
}

function hideOverlay() {
  overlay.classList.add('hidden');
}

// ------------------------------------------------------------- controles ---

function nudgeTop(dir) {
  // dir = +1 => Acercar (juntar);  dir = -1 => Alejar (separar)
  const nl = clamp(corners.tl.x + dir * step, -1, 1);
  const nr = clamp(corners.tr.x - dir * step, -1, 1);
  if (nr - nl >= 0.1) { // evita que las esquinas se crucen
    corners.tl.x = nl;
    corners.tr.x = nr;
    saveCorners();
    rebuildGeometry();
  }
}

function nudgeCorner(name, axis, dir) {
  const c = corners[name];
  if (axis === 'x') c.x = clamp(c.x + dir * step, -1, 1);
  else c.y = clamp(c.y + dir * step, -1, 1);
  saveCorners();
  rebuildGeometry();
}

function setStep(newStep) {
  step = clamp(newStep, 0.002, 0.1);
  saveStep();
  document.getElementById('stepValue').textContent = (step * 100).toFixed(1) + '%';
}

function resetCorners() {
  corners = defaultCorners();
  saveCorners();
  rebuildGeometry();
}

function selectCorner(name) {
  selectedCorner = name;
  document.querySelectorAll('.corner').forEach((el) => {
    el.classList.toggle('selected', el.dataset.corner === name);
  });
}

function setPanelHidden(hidden) {
  panel.classList.toggle('hidden', hidden);
  const showBtn = document.getElementById('showPanel');
  if (showBtn) showBtn.hidden = !hidden;
}

function togglePanel() {
  setPanelHidden(!panel.classList.contains('hidden'));
}

function applyFlipButtons() {
  const bv = document.getElementById('btnFlipV');
  const bh = document.getElementById('btnFlipH');
  if (bv) bv.classList.toggle('active', flip.v);
  if (bh) bh.classList.toggle('active', flip.h);
}

function toggleFlipV() {
  flip.v = !flip.v;
  saveFlip();
  applyFlipButtons();
  rebuildGeometry();
}

function toggleFlipH() {
  flip.h = !flip.h;
  saveFlip();
  applyFlipButtons();
  rebuildGeometry();
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  } else {
    document.documentElement.requestFullscreen().catch(() => {});
  }
}

function updateReadout() {
  const f = (v) => v.toFixed(3);
  readout.textContent =
    `SI(${f(corners.tl.x)},${f(corners.tl.y)})  ` +
    `SD(${f(corners.tr.x)},${f(corners.tr.y)})  ` +
    `II(${f(corners.bl.x)},${f(corners.bl.y)})  ` +
    `ID(${f(corners.br.x)},${f(corners.br.y)})`;
}

// ------------------------------------------------------- cableado de UI ---

function wireControls() {
  document.getElementById('btnAcercar').addEventListener('click', () => nudgeTop(+1));
  document.getElementById('btnAlejar').addEventListener('click', () => nudgeTop(-1));

  document.getElementById('btnStepDown').addEventListener('click', () => setStep(step - 0.002));
  document.getElementById('btnStepUp').addEventListener('click', () => setStep(step + 0.002));

  document.getElementById('btnReset').addEventListener('click', resetCorners);
  document.getElementById('btnFullscreen').addEventListener('click', toggleFullscreen);
  document.getElementById('btnFlipV').addEventListener('click', toggleFlipV);
  document.getElementById('btnFlipH').addEventListener('click', toggleFlipH);
  document.getElementById('btnHide').addEventListener('click', () => setPanelHidden(true));
  document.getElementById('showPanel').addEventListener('click', () => setPanelHidden(false));

  const advanced = document.getElementById('advanced');
  document.getElementById('btnAdvanced').addEventListener('click', () => {
    advanced.hidden = !advanced.hidden;
  });

  document.querySelectorAll('.corner').forEach((el) => {
    const name = el.dataset.corner;
    el.addEventListener('click', () => selectCorner(name));
    el.querySelectorAll('button[data-axis]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        selectCorner(name);
        nudgeCorner(name, btn.dataset.axis, parseInt(btn.dataset.dir, 10));
      });
    });
  });

  document.getElementById('gridToggle').addEventListener('change', (ev) => {
    gridOn = ev.target.checked;
  });

  // Selección de fuente (botones del overlay y del panel).
  const streamIdParam = () => new URLSearchParams(location.search).get('streamId');
  function runSource(fn, loadingMsg) {
    return async () => {
      try {
        if (loadingMsg) showOverlayLoading(loadingMsg);
        await fn();
      } catch (err) {
        showOverlay('No se pudo iniciar la fuente: ' + (err && err.message || err), true);
      }
    };
  }

  const useTabHandler = runSource(() => startTab(streamIdParam()), 'Iniciando la captura de la pestaña…');
  const useDesktopHandler = runSource(() => startDesktop(), 'Selecciona la ventana o pantalla a proyectar…');
  const useWebcamHandler = runSource(() => startWebcam(), 'Solicitando acceso a la cámara…');

  document.getElementById('btnUseTab').addEventListener('click', useTabHandler);
  document.getElementById('btnPickOther').addEventListener('click', useDesktopHandler);
  document.getElementById('btnUseWebcam').addEventListener('click', useWebcamHandler);

  document.getElementById('srcTab').addEventListener('click', useTabHandler);
  document.getElementById('srcDesktop').addEventListener('click', useDesktopHandler);
  document.getElementById('srcWebcam').addEventListener('click', useWebcamHandler);

  document.getElementById('cameraSelect').addEventListener('change', async (ev) => {
    try {
      await startWebcam(ev.target.value);
    } catch (err) {
      showOverlay('No se pudo cambiar de cámara: ' + (err && err.message || err), true);
    }
  });

  // Atajos de teclado.
  window.addEventListener('keydown', onKeyDown);

  setStep(step);
  applyFlipButtons();
  updateReadout();
}

function showOverlayLoading(msg) {
  overlayMsg.textContent = msg;
  overlay.classList.remove('hidden');
  document.getElementById('btnPickOther').hidden = true;
  document.getElementById('btnUseWebcam').hidden = true;
  document.getElementById('btnUseTab').hidden = true;
}

function onKeyDown(ev) {
  const k = ev.key;
  // Selección de esquina con 1-4.
  if (k === '1') { selectCorner('tl'); return; }
  if (k === '2') { selectCorner('tr'); return; }
  if (k === '3') { selectCorner('bl'); return; }
  if (k === '4') { selectCorner('br'); return; }

  if (k === 'h' || k === 'H') { togglePanel(); return; }
  if (k === 'f' || k === 'F') { ev.preventDefault(); toggleFullscreen(); return; }
  if (k === 'r' || k === 'R') { resetCorners(); return; }
  if (k === 'g' || k === 'G') {
    gridOn = !gridOn;
    document.getElementById('gridToggle').checked = gridOn;
    return;
  }
  if (k === 'v' || k === 'V') { toggleFlipV(); return; }
  if (k === 'b' || k === 'B') { toggleFlipH(); return; }
  if (k === '+' || k === '=') { setStep(step + 0.002); return; }
  if (k === '-' || k === '_') { setStep(step - 0.002); return; }

  if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown') {
    ev.preventDefault();
    if (selectedCorner) {
      if (k === 'ArrowLeft') nudgeCorner(selectedCorner, 'x', -1);
      else if (k === 'ArrowRight') nudgeCorner(selectedCorner, 'x', +1);
      else if (k === 'ArrowUp') nudgeCorner(selectedCorner, 'y', +1);
      else if (k === 'ArrowDown') nudgeCorner(selectedCorner, 'y', -1);
    } else {
      // Sin esquina seleccionada: las flechas laterales acercan/alejan el borde superior.
      if (k === 'ArrowLeft') nudgeTop(+1);
      else if (k === 'ArrowRight') nudgeTop(-1);
    }
  }
}

// ------------------------------------------------------------------ init ---

async function main() {
  try {
    initGL();
  } catch (err) {
    showOverlay('Error de WebGL: ' + (err && err.message || err), false);
    return;
  }
  wireControls();

  const params = new URLSearchParams(location.search);
  const streamId = params.get('streamId');

  if (streamId) {
    showOverlayLoading('Iniciando la captura de la pestaña…');
    try {
      await startTab(streamId);
    } catch (err) {
      // El streamId pudo expirar o requerir gesto del usuario: ofrecer botones.
      console.warn('[Trapecio] auto-inicio falló:', err);
      overlayMsg.textContent = 'Elige la fuente que quieres proyectar.';
      overlay.classList.remove('hidden');
      document.getElementById('btnUseTab').hidden = false;
      document.getElementById('btnPickOther').hidden = false;
      document.getElementById('btnUseWebcam').hidden = false;
    }
  } else {
    showOverlay('Elige la fuente que quieres proyectar.', true);
  }
}

main();
