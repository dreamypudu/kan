# Documentos de COMPASS a Kan desde Codex

La V1 usa Codex para leer PDF, DOCX, Markdown o texto y las herramientas del MCP
oficial de Kan para consultar y sincronizar tareas. No necesita una nueva API key
de OpenAI, otro servicio en Railway ni cambios en la base de datos.

El tablero seleccionado es **📋 COMPASS: tareas semanales**. La plantilla oficial
se proporciona junto con el primer documento; no se incluye una plantilla supuesta.
La configuración sin secretos está en `tools/compass/workflow.json` y la habilidad
compartida en `.agents/skills/compass-actas-kan/SKILL.md`.

## Conectar en este equipo

1. Compilar la versión local del MCP del fork (incluye las nuevas herramientas de
   adjuntos; `npx @kan.bn/mcp` puede publicar otra versión):

   ```powershell
   pnpm --filter '@kan.bn/mcp' build
   ```

2. Crear una API key en **Settings → API Keys** de tu instancia Kan con una cuenta
   que tenga acceso al tablero. Guardarla como variable de entorno local
   `KAN_API_TOKEN`, por ejemplo desde **Variables de entorno del usuario** en Windows.
   No compartirla en el chat ni guardarla en Git, el frontend o `NEXT_PUBLIC_*`.
3. Añadir este servidor a `~/.codex/config.toml`, conservando los existentes y
   reemplazando la ruta por la ubicación local del repositorio:

   ```toml
   [mcp_servers.compass_kan]
   command = "node"
   args = ["packages/mcp/dist/index.js"]
   cwd = "C:/ruta/al/repositorio/kan"
   env_vars = ["KAN_API_TOKEN"]
   enabled_tools = ["list_workspaces", "get_workspace", "list_boards", "get_board", "get_card", "search_workspace", "get_card_activities", "create_card", "update_card", "add_card_comment", "toggle_card_label", "toggle_card_member", "create_label", "create_list", "prepare_card_attachment_upload", "confirm_card_attachment_upload", "create_checklist", "create_checklist_item", "update_checklist_item"]

   [mcp_servers.compass_kan.env]
   KAN_BASE_URL = "https://tablerocompass.up.railway.app"
   ```

   La lista habilita las operaciones del flujo y excluye herramientas de eliminación,
   invitación y cambios de permisos. No restringe por sí sola los permisos de la API key.

4. Reiniciar Codex para cargar la variable de entorno, el MCP y la habilidad. Trabajar
   desde este repositorio. Si el cliente no descubre habilidades de repositorio,
   copiar la carpeta `compass-actas-kan` a su directorio personal de habilidades.

## Uso

Adjuntar el acta y la plantilla oficial a Codex, o indicar sus rutas locales. Pedir:

> Usa $compass-actas-kan para procesar estos documentos y preparar los cambios
> para el tablero 📋 COMPASS: tareas semanales.

Codex consulta el tablero y sus miembros, normaliza el acta con la plantilla y
presenta las tareas nuevas, actualizaciones, evidencias y dudas. Tras aprobar esa
propuesta, ejecuta las operaciones aprobadas. No crea otro
tablero, inventa responsables/plazos ni da tareas por completadas sin confirmación.

Los originales, documentos estructurados, propuestas y registros se conservan en
`.compass/` (fuera de Git). Respaldar esa carpeta y usar un solo operador a la vez.
Las referencias de operación permiten reconciliar cortes sin repetir creaciones;
esto no reemplaza idempotencia transaccional ni coordina importadores concurrentes.

Para adjuntar documentos en Kan deben estar configurados el bucket de adjuntos y
las variables S3 existentes de `.env.example`. La habilidad solicita una URL de
subida con el MCP, envía el archivo con `tools/compass/upload-file.mjs` y confirma
el adjunto mediante la API existente. El helper compara SHA-256 y tamaño con el
archivo aprobado. Las tareas enlazan la tarjeta documental; sus adjuntos conservan
el original y la versión estructurada. Una ruta local o URL S3 temporal no cuenta
como referencia documental permanente. Sin S3, la publicación queda pendiente.

## Conectar ChatGPT a Railway

El MCP remoto admite OAuth con PKCE S256 y la identidad publicada por ChatGPT
(CIMD). No hay que copiar `KAN_API_TOKEN` ni configurar un secreto de cliente.
Codex local sigue funcionando con su clave API.

### 1. Desplegar el cambio

Subir el commit al repositorio conectado a Railway y esperar un despliegue sano.
El bootstrap Docker ejecuta las migraciones antes de iniciar **solo si
`RUN_MIGRATIONS=true` está configurado en el servicio web de Kan**.
La nueva migración crea `mcp_oauth_grant` y `mcp_oauth_token`; no cambia las tablas
de tarjetas. En despliegues sin ese bootstrap, ejecutar `pnpm db:migrate` antes
de iniciar. Las pruebas locales nunca deben migrar producción.

Mantener las variables existentes en Railway:

- `NEXT_PUBLIC_BASE_URL=https://tablerocompass.up.railway.app`, sin barra final.
- `BETTER_AUTH_SECRET`: el secreto privado y estable que ya usa Kan.
- `POSTGRES_URL`: conexión al PostgreSQL del servicio.
- `RUN_MIGRATIONS=true`: aplica las migraciones pendientes antes de iniciar Kan.
- La configuración del método de inicio de sesión que ya utilizas en Kan.

No hay variables OAuth nuevas. HTTPS es obligatorio en producción. No cambiar
`BETTER_AUTH_SECRET` para conectar ChatGPT ni desactivar controles de Railway.
Estas dos direcciones deben devolver JSON después del despliegue:

```text
https://tablerocompass.up.railway.app/.well-known/oauth-protected-resource/api/mcp
https://tablerocompass.up.railway.app/.well-known/oauth-authorization-server
```

Si `/mcp` devuelve 500 y los logs indican
`relation "mcp_oauth_grant" does not exist`, falta aplicar la migración OAuth.
En Railway, abrir **el servicio web de Kan → Variables**, establecer
`RUN_MIGRATIONS=true` y desplegar los cambios. Comprobar en los logs que la
migración termina antes de que arranque Next.js. Esta migración añade las dos
tablas de autorizaciones; no borra tarjetas ni listas.
Después, iniciar de nuevo la conexión desde ChatGPT: la URL temporal de
consentimiento anterior caduca a los diez minutos.

### 2. Añadir la conexión desde ChatGPT web

1. Abrir ChatGPT en un computador y entrar en Configuración → Aplicaciones.
2. Activar el modo de desarrollador en la configuración avanzada, si la cuenta lo ofrece.
3. Crear una aplicación/conexión MCP personalizada con nombre **COMPASS**.
4. URL del servidor: `https://tablerocompass.up.railway.app/api/mcp`.
5. Elegir autenticación **OAuth** y **CIMD** como identificación del cliente si
   aparece esa opción. Dejar los campos manuales Client ID y Client Secret vacíos.
   ChatGPT publica su propio documento de identidad para esta conexión.
   No elegir DCR: este servidor no publica registro dinámico.
6. Iniciar sesión en Kan y pulsar **Autorizar ChatGPT** en tu dominio de Kan.
7. Seleccionar COMPASS en una conversación nueva y pedir:
   «Consulta mi tablero 📋 COMPASS: tareas semanales y enumera sus listas sin modificar nada».

Los nombres de los menús y la disponibilidad dependen de la cuenta. Si no aparece
crear una conexión MCP o usar CIMD, revisar las opciones admitidas por esa cuenta.
Una API key no sustituye este flujo OAuth.

El callback debe coincidir exactamente con el documento oficial HTTPS publicado
por ChatGPT. No hay que registrar callbacks manualmente en Railway ni en Trello.
El servidor valida PKCE, emisor, recurso, scopes y expiración; usa tokens opacos
ligados a una autorización almacenada, no JWT aportados por el cliente.
Solo consulta documentos CIMD de `https://chatgpt.com/oauth/.../client.json`, sin
redirecciones ni descargas desde hosts arbitrarios. Admite el documento estable
y el documento específico de la conexión. Anuncia RFC 9207 y añade `iss` también
a los errores devueltos al callback. El recurso es el endpoint MCP y el scope
es `kan:mcp`.

### 3. Procesar documentos y gestionar tarjetas/listas

Adjuntar el documento y la plantilla oficial en la conversación y pedir:

> Usa COMPASS. Consulta primero el tablero 📋 COMPASS: tareas semanales. Extrae
> compromisos de este documento, distingue Investigación, Comercial y
> Comunicaciones y presenta los cambios propuestos sin ejecutarlos. No inventes
> responsables ni plazos. Espera mi aprobación y usa checklists reales.

La conexión permite crear, modificar y borrar tarjetas y listas; también consultar
workspaces/tableros, crear tableros y etiquetas, añadir comentarios y gestionar
checklists. Kan comprueba los permisos del usuario y el acceso a cada tablero.
No expone borrado de workspaces/tableros, invitaciones ni cambios de permisos.
La misma restricción se aplica al uso directo de la API REST con estos tokens.
El borrado conserva el comportamiento original de Kan: borrar una lista también
afecta a las tarjetas que contiene. Revisar ese alcance antes de aprobarlo.

**Límites de esta versión:** aprobar cada propuesta, incluidos los borrados, es
parte del flujo de conversación en ChatGPT; Kan no añade una cola transaccional
de propuestas. El consentimiento OAuth autoriza las operaciones indicadas en los
espacios a los que el usuario ya tiene acceso. El servidor no recibe ni interpreta
los documentos directamente: ChatGPT debe poder leer su contenido.
Las habilidades y archivos locales de Codex no se transfieren a ChatGPT.
La conservación del original y la versión estructurada en S3 continúa disponible
en el flujo de Codex, pero **no está implementada en esta conexión de ChatGPT**.
No afirmar que se guardaron archivos si solo se crearon tarjetas.

### Revocar y reconectar

Abrir `https://tablerocompass.up.railway.app/mcp` con la sesión de Kan y
pulsar **Revocar acceso**. Solo se pueden revocar conexiones propias.
Los códigos caducan al minuto y se usan una sola vez. Los access tokens caducan
a la hora; los refresh tokens rotan y caducan a los 30 días desde la autorización
inicial. Reutilizar un código o refresh token consumido revoca toda su autorización.
Las credenciales se guardan como hashes. Tras revocar o caducar el acceso,
volver a conectar la aplicación en ChatGPT.

Referencias: [autenticación MCP de OpenAI](https://developers.openai.com/plugins/build/auth)
y [servidor OAuth del SDK MCP](https://github.com/modelcontextprotocol/typescript-sdk/tree/main/src/server/auth).

## Comprobaciones locales

```powershell
pnpm --filter '@kan.bn/mcp' test
pnpm --filter '@kan.bn/mcp' typecheck
pnpm --filter '@kan/api' test -- integration-tests/mcp-oauth.integration.test.ts integration-tests/mcp-oauth-http.integration.test.ts
pnpm --filter '@kan/web' test -- src/__tests__/mcp.test.ts
node --test tools/compass/upload-file.test.mjs
```

Probar primero con un acta breve: detectar una tarea existente, crear una nueva,
dejar una ambigua en revisión y volver a procesar el mismo archivo sin duplicados.
La operación real requiere la API key, plantilla y documentos del usuario.

La configuración sigue la [referencia oficial de Codex](https://learn.chatgpt.com/docs/config-file/config-reference)
y su mecanismo de [habilidades de repositorio](https://learn.chatgpt.com/docs/build-skills).
