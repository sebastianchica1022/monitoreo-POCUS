# POCUS Hemodinámico

PWA offline-first para diligenciar la evaluación cardiopulmonar con ultrasonido a la cabecera del paciente (derrame pericárdico, VCI, función VI, volumen sistólico, contractilidad segmentaria, función diastólica, VD, sobrecarga de presión del VD, choque por TEP, Doppler valvular y pulmones), con interpretación automática del perfil hemodinámico y resumen copiable.

## Publicar en GitHub Pages

1. Crea un repositorio nuevo, por ejemplo `pocus-hemo`.
2. Sube estos archivos a la raíz del repositorio: `index.html`, `style.css`, `app.js`, `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png`.
3. En **Settings → Pages**, selecciona la rama `main` y la carpeta `/root`.
4. La app quedará disponible en `https://<tu-usuario>.github.io/pocus-hemo/`.
5. Desde el iPhone, abre esa URL en Safari y usa "Añadir a pantalla de inicio" para instalarla como app.

## Notas

- Todos los datos se guardan solo en el dispositivo (localStorage), no se envían a ningún servidor.
- El botón "Nuevo caso" borra el formulario para empezar con otro paciente.
- El perfil hemodinámico sugerido es una ayuda de organización basada en reglas simples (VCI/precarga, función sistólica de VI, signos de sobrecarga del VD, patrón pulmonar, taponamiento y TEP); siempre requiere correlación clínica.
