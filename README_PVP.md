> **Actualización de conexión:** Las capturas del bot ahora marcan objetivos compatibles en todos los dispositivos. Las marcas manuales de la web siguen siendo locales. Consulta [README_CONEXION_BOT.md](README_CONEXION_BOT.md).

# Shinydex — categorías PvP

Esta actualización conserva intactas las ocho categorías previas (`shundo`, `snundo`, tamaños, nivel 1) y mantiene **Superliga** y **Ultraliga** y añade **Baby League**, correspondiente a **Little Cup (500 PC)** del CSV suministrado.

## Datos del CSV

- Superliga: **189 destinos** de 355 filas de posibles capturas.
- Ultraliga: **185 destinos** de 376 filas de posibles capturas.
- Baby League (Little Cup): **116 destinos** de 116 filas de capturas directas (no requieren evolución); puestos entre #2 y #200. Incluye formas regionales y cuatro tamaños de Pumpkaboo por separado.
- **121** destinos aparecen en ambas ligas (distintos objetivos por liga); **253** destinos únicos.
- Se agrupan por Pokémon **destino**, por forma y por liga. Las posibles preevoluciones se muestran dentro del destino; no aumentan artificialmente los objetivos.
- El JSON de datos, derivado sin consultar otros rankings, está en `assets/pvp-targets.json`. El CSV proporcionado se incluye en `data/pvpoke_capturas_shiny_y_evoluciones.csv`.
- Se respetan los IV, el puesto y el nivel copiado del destino proporcionados por el CSV. **El nivel indicado no se exige al Pokémon capturado**: es referencia para el destino una vez evolucionado/subido de nivel.
- Algunas formas regionales se identifican por separado; cuando no hay un sprite verificado de la forma, se muestra un símbolo en vez de una imagen que pudiera inducir a error.
- Ranking, disponibilidad salvaje, posibilidad shiny e IV **no se han contrastado externamente**: se muestran los datos aportados y pueden cambiar con temporadas, movimientos, formato del PvP o actualizaciones.

## Registro y almacenamiento

1. Abre Superliga, Ultraliga o Baby League en el menú.
2. Elige un **destino** y pulsa **Registrar shiny conseguido**.
3. Elige qué Pokémon capturaste de los candidatos y **escribe los tres IV reales**.
4. La web solo permite registrar IV **idénticos a los del destino** del CSV. Confirma que el ejemplar es shiny.
5. El progreso se guarda con `localStorage`, separado por colección y URL de Supabase.
6. Usa **Exportar progreso** periódicamente. **Importar progreso** combina registros guardados de la misma colección y versión.

**Limitación importante:** el frontend web permanece de **solo lectura** hacia Supabase. Estos nuevos registros PvP todavía **NO** se escriben en Supabase y **NO** se sincronizan con el bot de Discord o con otros dispositivos. Los datos de las ocho categorías anteriores siguen sincronizándose como antes. Una copia de seguridad exportada permite trasladar los marcados PvP a otro dispositivo. No se ha creado ninguna política RLS de escritura pública, para no exponer la base de datos.

Para sincronizar el registro PvP desde Discord hay que modificar **el bot** (y definir el esquema de escritura autorizado); esta entrega modifica únicamente la web. No se debe implementar escritura anónima desde GitHub Pages usando una clave `sb_secret_` ni `service_role`.

## Publicación en GitHub Pages

1. Sube a tu repositorio, en la rama `main`, el **contenido** del ZIP. Incluye los archivos de la carpeta oculta `.github` y el JSON `assets/pvp-targets.json`.
2. No subas `config.js` ni `config.json`. `.gitignore` los excluye al usar Git localmente; en la subida por navegador verifica manualmente que no se adjunten.
3. Conserva `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` en `Settings → Secrets and variables → Actions → Variables`.
4. En `Settings → Pages` elige **GitHub Actions**. El archivo `.github/workflows/pages.yml` genera `config.js` **solo en el artefacto publicado** y permite `workflow_dispatch`.
5. Comprueba la ejecución en `Actions`. Una clave publicable es visible para quien visita la página y requiere políticas RLS correctas. Una clave secreta nunca debe llegar al navegador.

## Incorporación de Baby League (octubre de 2026)

El CSV completo incluye 847 filas: 355 Great League, 376 Ultra League y 116 Little Cup. No se alteró el conjunto previo de Superliga/Ultraliga, por lo que las claves locales `great:` y `ultra:` existentes siguen siendo válidas. Los nuevos registros usan `baby:` en el mismo esquema JSON, sin interferir con las otras categorías.

**Alcance:** El nombre «Baby League» es la etiqueta solicitada; la fuente indica «Little Cup». No se equipara a una categoría limitada exclusivamente a Pokémon bebé. En la Copa Pequeña clásica de Pokémon GO se admiten Pokémon que puedan evolucionar y nunca hayan evolucionado; se exige un máximo de 500 PC. Esta web muestra los IV y niveles del CSV, pero NO calcula el PC y NO verifica que un ejemplar concreto sea elegible ni que los datos PvP sigan actualizados. Tampoco se confirma aquí que cada especie pueda salir shiny salvaje a fecha de publicación.
