# Trapecio Keystone – Proyector

Extensión de Google Chrome que **captura una pestaña (o ventana/pantalla) y la
proyecta a pantalla completa en un lienzo WebGL con forma de trapecio**, para
**corregir el keystone por software** en proyectores que no traen ajuste de
keystone propio. Así puedes usar cualquier página web y que se vea recta.

La captura se dibuja en un canvas WebGL con un mapeo de textura
*perspective-correct*: al mover las esquinas superiores, la imagen se deforma
como un rectángulo proyectado (no una simple deformación lineal), que es
justamente lo que compensa la inclinación del proyector.

## Características

- **Tres fuentes de video** seleccionables (en la pantalla inicial o en el
  control «Fuente» del panel):
  1. **Pestaña** de Chrome con un solo clic (`chrome.tabCapture`).
  2. **Otra ventana o pantalla** (`chrome.desktopCapture`).
  3. **Webcam / entrada de video** (`getUserMedia`), con selector de cámara si
     tienes varias.
- Abre la proyección en el **segundo monitor** (el proyector) y en **pantalla
  completa** automáticamente cuando hay dos pantallas.
- **Voltear vertical / horizontal** (útil para montaje en techo o
  retroproyección).
- **Dos botones grandes: Acercar / Alejar** para juntar o separar las esquinas
  superiores del trapecio de forma muy simple.
- Ajuste avanzado de las **4 esquinas** (X e Y) para corrección de keystone de 4
  puntos.
- Rejilla de alineación opcional.
- La calibración se **guarda** y se recuerda entre sesiones.

## Instalación (modo desarrollador)

1. Descarga o clona esta carpeta.
2. Abre `chrome://extensions` en Chrome.
3. Activa el **Modo de desarrollador** (arriba a la derecha).
4. Haz clic en **Cargar descomprimida** y selecciona la carpeta del proyecto
   (la que contiene `manifest.json`).
5. Aparecerá el icono del trapecio en la barra de extensiones.

## Uso

1. Abre la pestaña con la web que quieres proyectar.
2. Haz clic en el icono de la extensión.
   - Se genera la captura de esa pestaña y se abre la **ventana proyector**.
   - Si tienes un segundo monitor, la ventana se coloca allí en pantalla
     completa. Si no, arrastra la ventana al proyector y pulsa **F**.
3. Usa los botones para ajustar el trapecio hasta que la imagen se vea recta en
   la pantalla del proyector:
   - **Acercar**: junta las esquinas superiores (imagen más angosta arriba).
   - **Alejar**: separa las esquinas superiores.
4. Si necesitas corregir también las esquinas inferiores o un lado concreto,
   abre **«Ajuste por esquina»** y mueve cada esquina de forma independiente.

Para **cambiar de fuente** en cualquier momento, usa la fila **«Fuente»** del
panel: *Pestaña*, *Ventana / Pantalla* o *Webcam*. Con webcam aparece un
desplegable **«Cámara»** para elegir el dispositivo (la primera vez Chrome pide
permiso de cámara).

> Nota: si la pestaña es una página interna de Chrome (`chrome://`, la Web
> Store, etc.) no se puede capturar. En ese caso usa **«Ventana / Pantalla»** o
> **«Webcam»**.

## Atajos de teclado (en la ventana proyector)

| Tecla        | Acción                                                        |
|--------------|---------------------------------------------------------------|
| `←` / `→`    | Sin esquina seleccionada: Acercar / Alejar el borde superior  |
| `1` `2` `3` `4` | Seleccionar esquina (SupIzq, SupDer, InfIzq, InfDer)       |
| `←` `→` `↑` `↓` | Mover la esquina seleccionada                              |
| `+` / `-`    | Aumentar / reducir el tamaño del paso                         |
| `V`          | Voltear verticalmente                                         |
| `B`          | Voltear horizontalmente                                       |
| `F`          | Pantalla completa                                             |
| `G`          | Mostrar / ocultar rejilla de alineación                       |
| `H`          | Mostrar / ocultar el panel de control                         |
| `R`          | Reiniciar la calibración                                      |

## Cómo funciona la corrección

Las 4 esquinas del cuadrilátero viven en coordenadas NDC (`-1..1`). El borde
inferior queda por defecto pegado a los bordes de la pantalla y el borde
superior se estrecha o ensancha con los botones.

Para que la textura no se deforme de manera afín (incorrecta), se calcula la
coordenada homogénea `q` de cada vértice a partir de la intersección de las
diagonales del cuadrilátero. La textura se pasa como `(u·q, v·q, q)` y el
fragment shader hace `texture2D(tex, uv.xy / uv.z)`, logrando un mapeo
*perspective-correct*. Un trapecio muestra entonces la imagen como el
rectángulo proyectado que compensa el keystone del proyector.

## Estructura

```
manifest.json        Manifest V3 de la extensión
background.js         Service worker: captura la pestaña y abre el proyector
viewer.html/css/js    Ventana proyector: WebGL + controles del trapecio
icons/                Iconos generados
tools/generate_icons.py  Generador de iconos (solo stdlib de Python)
```

## Permisos

- `tabCapture` — capturar la pestaña activa.
- `desktopCapture` — capturar otra ventana/pantalla (opcional, bajo demanda).
- `system.display` — detectar el segundo monitor para colocar la proyección.
- `activeTab` — acceso a la pestaña activa al invocar la extensión.

No se envía nada a ningún servidor: todo el procesamiento es local en tu equipo.
