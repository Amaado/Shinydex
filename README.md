> **Actualización PvP:** consulta [README_PVP.md](README_PVP.md) para las dos nuevas categorías, el método de registro y la limitación actual de sincronización (progreso solo en este navegador).

# Pokédex shiny · publicación segura en GitHub Pages

Web estática HTML/CSS/JS en modo oscuro. Esta versión **no contiene `config.js` ni claves reales**. La configuración pública se genera durante el despliegue mediante GitHub Actions. Las claves secretas y los tokens del bot nunca deben estar en el repositorio ni en la web.

## 1. Crear el repositorio

1. Descomprime este ZIP. **Sube los archivos de su interior a la raíz del repositorio** (no el ZIP y no una carpeta exterior). Importante: incluye `.github/workflows/pages.yml` y `.gitignore`, aunque sean ocultos.
2. En GitHub, crea un repositorio (por ejemplo, `pokedex-shiny`) y sube el contenido a la rama `main`.
3. Si ya habías subido `config.js`/`config.json`, deja de seguirlos mediante `git rm --cached config.js` (o `git rm --cached config.json`) antes de hacer commit. El `.gitignore` **no** borra del historial los archivos publicados anteriormente.

### Subida desde Git (si es un repositorio nuevo)

```bash
git init
git branch -M main
git add .
git commit -m "Publicar Pokédex"
git remote add origin https://github.com/TU_USUARIO/pokedex-shiny.git
git push -u origin main
```

## 2. Añadir las dos variables públicas de Supabase

En el repositorio de GitHub, abre **Settings → Secrets and variables → Actions → Variables → New repository variable** y crea:

| Nombre | Valor |
| --- | --- |
| `SUPABASE_URL` | La URL del proyecto, por ejemplo `https://tu-proyecto.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | La clave **publicable**, que empieza por `sb_publishable_` |

Puedes consultar ambas en tu `config.js` **original** (no está incluido en este ZIP). **No uses ninguna clave `sb_secret_`, `service_role` ni token de Discord**. Este despliegue requiere una clave del formato nuevo `sb_publishable_`, no una clave `anon` antigua.

Estas variables no se guardan en el código del repositorio. **Pero sí se incrustan en el `config.js` de la web publicada y los visitantes pueden verlas.** Esto es normal y seguro únicamente si Supabase aplica los permisos adecuados.

## 3. Activar la publicación

En GitHub: **Settings → Pages → Build and deployment → Source → GitHub Actions**. Abre **Actions**, entra en «Publicar Pokédex en GitHub Pages» y usa **Run workflow** si la publicación inicial falló por no haber configurado las variables todavía. Los siguientes `git push` a `main` publican automáticamente.

Dirección habitual: `https://TU_USUARIO.github.io/pokedex-shiny/`.

## 4. Comprobar la seguridad de Supabase (imprescindible)

Abre Supabase → SQL Editor y ejecuta **solo consultas de lectura** del archivo `COMPROBAR_SEGURIDAD_SUPABASE.sql`. Debes verificar los resultados: **RLS activado** donde corresponda, `anon` sin permisos de inserción/modificación/borrado de capturas y función RPC `pokedex_snapshot` expuesta solo para lectura del contenido que deseas hacer público. Comprueba las políticas; las consultas de auditoría no sustituyen las pruebas reales.

**La web de esta versión tiene lectura pública**: los datos devueltos por `pokedex_snapshot`, incluidos los alias de cuentas o la actividad si los incorpora, serán accesibles a cualquiera que tenga el enlace. Para una Pokédex privada necesitas autenticación o un backend que controle el acceso.

El bot de Discord debe conservar la clave secreta solo en su servidor o en sus variables de entorno. Si algún secreto real se ha publicado alguna vez, hay que revocarlo/rotarlo: borrarlo del commit actual no lo elimina del historial.

## 5. Probar localmente

Para uso local, copia `config.example.js` a `config.js`, rellena solo la URL y la clave publicable y ejecuta un servidor HTTP local (por ejemplo `python -m http.server 8000` desde esta carpeta). `config.js` está ignorado por Git.

## Desplazamiento suave y carga automática

- Lenis **1.3.27** se carga desde jsDelivr mediante CSS/JS fijados a una versión concreta. No requiere npm ni proceso de compilación. Para que Lenis funcione, el navegador debe poder acceder a `cdn.jsdelivr.net`; si no puede, se conserva el scroll nativo y la Pokédex funciona igual.
- Un `IntersectionObserver` precarga automáticamente el siguiente bloque de **24** Pokémon/objetivos cuando el botón de «Cargar más» se aproxima a **600 px** del área visible. Si el navegador no admite `IntersectionObserver`, los botones siguen funcionando manualmente.
- La ampliación de los listados añade solo nuevas tarjetas o filas (no vuelve a pintar todo el catálogo) y respeta los filtros, el orden, el formato tabla y la navegación por ligas.
- Los diálogos mantienen desplazamiento nativo; Lenis respeta la preferencia de movimiento reducido.
- La política CSP permite jsDelivr exclusivamente para Lenis; la URL de Supabase y su clave publicable permanecen configuradas como antes. No hay credenciales privadas en el ZIP.

## Archivos

- `.github/workflows/pages.yml`: publica la web y genera la configuración pública.
- `.gitignore`: excluye configuración local y archivos sensibles.
- `config.example.js`: ejemplo sin datos reales.
- `COMPROBAR_SEGURIDAD_SUPABASE.sql`: comprobaciones de lectura de seguridad (no modifica la base de datos).
- `index.html`, `styles.css`, `js/`, `assets/`: aplicación original.

**Nota**: El `supabase/schema.sql` al que se refiere la instalación original no estaba incluido en el ZIP recibido; la estructura de la base de datos no ha podido auditarse desde estos archivos. Datos de catálogo y sprites: PokéAPI. Proyecto no oficial.
