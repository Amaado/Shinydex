# Conectar «Marcar capturado» con Shinydex

Paquete preparado a partir de los dos ZIP que has facilitado. Está implementado y probado con datos sintéticos. Aún debes instalarlo en tu bot y ejecutar el SQL en tu proyecto Supabase; no se ha accedido a tu servidor ni a tu base de datos real.

## Qué hará

Al pulsar **Marcar capturado** en un aviso del bot o en la ficha de **CopyChanel**, el bot guarda la captura y la envía a Supabase. La web la muestra al consultar los datos de nuevo, **cada 10 segundos mientras está visible**. Con conexión normal suele aparecer en unos 10–15 segundos. No hace falta volver a publicar la web después de cada captura.

- Marca todas las categorías compatibles: un shiny 15/15/15 XXS cuenta en «IV 100 · Shiny» y «IV 100 · Shiny · XXS».
- Un doble clic, dos avisos del mismo encuentro o un reintento no añaden duplicados para la misma cuenta.
- Conserva separadas las cuentas, formas y disfraces. Una captura PvP también figura en «Conseguidos», aunque no complete una categoría IV 100/0.
- Al pulsar **Deshacer última captura**, la captura también se retira de la web. Si otra captura sigue cumpliendo el objetivo, ese objetivo permanece conseguido.
- Si se corta la conexión, conserva el envío pendiente en SQLite y lo reintenta. Funciona después de reiniciar el bot.
- Pedir o copiar coordenadas y usar `/cooldown` no registra por sí solo un Pokémon como capturado.

## 1. Preparar Supabase

Entra en **el mismo proyecto Supabase que usa tu web** y abre SQL Editor. Ejecuta completo:

`Shinydex/supabase/conectar_bot.sql`

Puedes repetirlo sin borrar capturas. Crea tablas y funciones con prefijo `shinydex_bot_`. Conserva la función anterior `pokedex_snapshot` y sus tablas: la web combina ambas fuentes si la antigua existe. Si nunca llegaste a crear el esquema anterior, esta conexión funciona por sí sola.

La colección que se crea es `principal`. Mantén ese nombre tanto en el bot como en la web. La colección tiene **lectura pública**, igual que la web recibida: cualquiera con acceso a la página puede consultar las capturas y los alias de cuenta. La escritura se concede exclusivamente al servidor del bot. No se publican coordenadas, Bearers, tokens de Discord ni IDs de Discord.

## 2. Actualizar la web

Sube **el contenido de la carpeta `Shinydex`** a la raíz de tu repositorio `Amaado/Shinydex`, sustituyendo los archivos anteriores. Incluye la carpeta oculta `.github`, porque el flujo de publicación configura el refresco a 10 segundos. No subas una carpeta exterior adicional ni el ZIP.

En GitHub → Settings → Secrets and variables → Actions → Variables deben seguir configuradas:

| Variable pública de GitHub | Valor |
| --- | --- |
| `SUPABASE_URL` | URL de ese proyecto Supabase |
| `SUPABASE_PUBLISHABLE_KEY` | Clave publicable `sb_publishable_…` |

En Settings → Pages, la publicación debe usar GitHub Actions. Al subir los cambios se ejecutará «Publicar Pokédex en GitHub Pages». Espera a que termine correctamente y recarga la página.

No hay que pegar la clave secreta del bot en GitHub ni en `config.js`. Para una prueba local puedes copiar `config.example.js` a `config.js`, poner únicamente los valores públicos y abrir la web mediante un servidor HTTP.

## 3. Actualizar el bot

Descomprime este paquete **fuera de la carpeta donde tienes el bot**. Desde la carpeta que contiene `instalar_bot.py`, ejecuta, sustituyendo la ruta de ejemplo:

```bash
python3 instalar_bot.py /ruta/a/tu/shiny-sniper
```

El instalador guarda una copia de los archivos que sustituye, copia los módulos actualizados y añade al `.env` solamente los nombres de variables que falten. Conserva tus valores existentes, `config.json`, la carpeta `secrets`, los Bearers y la base de datos de `data`. Todavía no reinicia el bot.

Edita el `.env` **en tu servidor** y completa:

```dotenv
SUPABASE_URL=https://TU_PROYECTO.supabase.co
SUPABASE_SECRET_KEY=sb_secret_TU_CLAVE_DE_SERVIDOR
SHINYDEX_COLLECTION=principal
```

La URL debe ser la misma que la de la web. Obtén la clave **secreta** en los ajustes de API del proyecto Supabase. La clave publicable de la web no sirve para enviar capturas. También se admite una clave antigua `service_role` si ya la utilizas. Conserva el valor real solo en el `.env` del servidor; no hace falta compartirlo en el chat.

Ahora, desde la carpeta del bot:

```bash
docker compose up -d --build
```

Es necesario recrear el contenedor con el archivo `compose.yaml` actualizado: un simple `docker restart` no añade las nuevas variables. No se añaden dependencias de Python para esta conexión.

## 4. Comprobarlo

1. En Discord ejecuta **`/shinydex`**. Deberá indicar «Conexión web configurada». Este estado confirma la configuración; el envío se confirma cuando aparece una captura en «Confirmadas por Supabase».
2. En un aviso actual del bot, pide las coordenadas y pulsa **Marcar capturado**, o usa el botón de la ficha de CopyChanel.
3. Consulta `/shinydex`: la captura pasa de pendiente a confirmada cuando Supabase acepta el envío.
4. Abre la web y espera a la siguiente actualización. Puedes comprobar «Conseguidos», la ficha y «Actividad».
5. Para probar la corrección, usa **Deshacer última captura** en el bot y espera la siguiente actualización de la web.

La conexión empieza con las capturas confirmadas **después de instalar esta actualización**. No se importan automáticamente capturas históricas: el bot original elimina detalles de encuentros antiguos y no se inventan los que falten. Las nuevas capturas guardadas mientras falta configurar Supabase permanecen pendientes y se envían al activarlo.

## PvP, disfraces y fondos

Los objetivos PvP se marcan al coincidir **especie de captura, forma, los tres IV y nivel máximo** con el CSV que ya contiene la web. No se da por hecha ninguna evolución ni se comprueban PC que el aviso no proporciona. El bot y la web deben utilizar la misma versión del CSV si lo cambias en el futuro.

Las formas y disfraces siempre se conservan como entradas separadas de la Pokédex principal. En «Disfraces y fondos» solo se marca automáticamente una equivalencia de disfraz contrastada en los archivos recibidos: **Zubat `HALLOWEEN_2026_01` → sombrero de copa de Halloween 2026**. Los demás códigos quedan conservados en su ficha, sin asignarlos por semejanza a otro disfraz del catálogo. Los fondos siguen siendo manuales porque el modelo del bot no recibe ese dato.

Los registros manuales que ya tenías en el navegador, tanto de PvP como de variantes, se conservan. Puedes seguir exportándolos e importándolos. Deshacer una captura del bot no borra una marca manual independiente que hayas guardado en la web.

## Si no aparece la captura

- **`/shinydex` dice «sin configurar»:** comprueba las dos variables del `.env` y recrea el contenedor con `docker compose up -d --build`.
- **Hay capturas pendientes:** ejecuta el SQL en el mismo proyecto. Comprueba la URL y la clave secreta del servidor. Los reintentos son automáticos; si fallan, el intervalo aumenta hasta 5 minutos, o respeta un `Retry-After` mayor del servidor.
- **HTTP 401/403:** la clave de servidor no es válida o los permisos no corresponden al SQL incluido.
- **HTTP 404:** falta la función `shinydex_bot_upsert` o apunta a otro proyecto. Ejecuta el SQL completo.
- **HTTP 400:** comprueba la colección `principal` y que se ha ejecutado la versión completa del SQL.
- **El bot confirma pero la web no cambia:** espera al despliegue de GitHub Actions, recarga la página y verifica que ambas configuraciones usan la misma URL y colección. Una pestaña oculta se actualiza al volver a abrirla.
- **No aparece `/shinydex`:** comprueba que se ha reconstruido el contenedor. El bot sincroniza sus comandos de servidor al conectarse a Discord.

## Validación realizada

Se han probado la cola persistente, doble clic, cuentas separadas, reintentos, deshacer, recaptura, una confirmación antigua durante un cambio nuevo, los botones de captura de avisos PvP y CopyChanel y la ausencia de coordenadas en los datos publicados. Las pruebas de JavaScript comprueban la combinación con datos anteriores, fallos parciales, coincidencias PvP y conservación de marcas manuales. El SQL se ha ejecutado en PostgreSQL mediante PGlite, incluyendo una segunda instalación y pruebas de permisos de `anon` y `service_role`. Se ha comprobado el renderizado y la interacción del documento HTML mediante un DOM simulado con datos generados por ese SQL.

No se ha hecho una captura real en tu Discord ni una llamada con tus credenciales. La suite original ya contenía ocho pruebas fallidas o con errores; al comparar el original con la actualización no aparecen nuevos casos fallidos. El detalle está en `VALIDACION_CONEXION.md`.

Documentación de referencia: [claves de API de Supabase](https://supabase.com/docs/guides/getting-started/api-keys) y [permisos de funciones](https://supabase.com/docs/guides/database/functions).
