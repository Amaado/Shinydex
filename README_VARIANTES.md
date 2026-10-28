# Shinydex — Disfraces, fondos y combinaciones

## Funcionamiento

Se ha añadido «Disfraces y fondos» a la navegación, sin alterar las 8 categorías originales ni las dos ligas PvP. Los objetivos se dividen en tres tipos:

1. **Con disfraz**: un Pokémon con un disfraz concreto, sin exigir un fondo.
2. **Con fondo**: un Pokémon con una ilustración de fondo concreta (de ubicación o especial), sin requerir un disfraz.
3. **Disfraz + fondo**: ese Pokémon con el disfraz **y** el fondo concretos a la vez.

Cada combinación de fondo y Pokémon/formato es un objetivo independiente, identificado por el identificador del fondo y el de la variante. Los filtros incluyen especie, disfraz, nombre del evento, tipo, estado, y disponibilidad shiny documentada. La lista se amplía automáticamente al hacer scroll, en bloques de 24, con botón manual de respaldo.

Al registrar, se exige marcar que realmente se posee el **shiny de la combinación exacta**, con fecha y nota opcional. La copia local se puede exportar/importar en JSON. No se escribe en Supabase y no se consulta el inventario de ShinyChecker: el usuario es quien confirma cada registro. Este progreso es independiente del de las categorías originales y PvP.

## Fuentes de datos e imágenes

- Catálogo primario de fondos: https://github.com/psoren/pogo-bg — archivo `docs/data/data.json` (datos combinados de Serebii y Dittobase, sprites y arte recuperados de PokeMiners).
- Serebii, fondos de Pokémon GO: https://www.serebii.net/pokemongo/backgrounds.shtml
- Dittobase, catálogo de fondos: https://www.dittobase.com/pokemon-go/backgrounds
- Selección de disfraces históricos: https://www.wikidex.net/wiki/Lista_de_Pok%C3%A9mon_de_Pok%C3%A9mon_GO
- Halloween 2026, tres estrenos shiny expresamente anunciados: https://pokemongo.com/news/halloween-part-1-2026
- Imágenes de variante: https://github.com/PokeMiners/pogo_assets — se muestran mediante URLs del catálogo `pogo-bg`, **no** están incrustadas en este ZIP. Se muestra una imagen genérica de la especie con un aviso si no hay icono del disfraz.

**Limitación importante:** la lista local de disfraces es una selección contrastada, no un inventario exhaustivo de todos los disfraces históricos. El archivo remoto amplía los disfraces presentes en eventos con fondos. Un Pokémon que figura en la lista de elegibles para un fondo **no necesariamente pudo obtenerse shiny con ese fondo**. Solo se etiqueta «shiny documentado» si Dittobase lo especifica para un evento de ese fondo, o si existe una confirmación expresa de Pokémon GO (Halloween 2026). Los demás se etiquetan «Shiny no verificado». La existencia de una imagen shiny no demuestra por sí sola que la variante haya estado disponible.

Las imágenes y nombres de Pokémon y Pokémon GO pertenecen a sus respectivos titulares. Proyecto personal sin afiliación.

## Disponibilidad y mantenimiento

La aplicación pide `https://raw.githubusercontent.com/psoren/pogo-bg/main/docs/data/data.json` al entrar. Es un catálogo externo y puede tener actualizaciones o dejar de estar disponible. Si falla, la web **no se rompe**: permite usar la selección local de disfraces (`assets/variants-seed.json`) e informa de que el catálogo remoto no se ha podido cargar. Se recomienda exportar el progreso después de registrar capturas.

En el `index.html` se ha añadido `https://raw.githubusercontent.com` a `connect-src` para permitir la descarga con CSP. No se necesita ninguna credencial externa. No se ha añadido código de escritura pública en Supabase. GitHub Actions publica también `js/variants.mjs`, `assets/variants.css` y `assets/variants-seed.json` al copiar las carpetas completas.

## Publicación

Descomprimir y subir todo el contenido a la **raíz** del repositorio `Amaado/Shinydex`, sustituyendo archivos existentes. Conservar `config.js` fuera del repositorio; el flujo de GitHub Actions ya lo genera a partir de las variables públicas.

Al desplegar, ir a «Disfraces y fondos». Si hay advertencia de fuente, pulsar «Actualizar fuentes». El catálogo de fondos necesita acceso de red al servidor de GitHub.
