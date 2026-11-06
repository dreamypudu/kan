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
   enabled_tools = ["list_workspaces", "get_workspace", "list_boards", "get_board", "get_card", "search_workspace", "get_card_activities", "create_card", "update_card", "add_card_comment", "toggle_card_label", "toggle_card_member", "create_label", "create_list", "prepare_card_attachment_upload", "confirm_card_attachment_upload"]

   [mcp_servers.compass_kan.env]
   KAN_BASE_URL = "https://kan-production-1507.up.railway.app"
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

## Comprobaciones

```powershell
pnpm --filter '@kan.bn/mcp' test
pnpm --filter '@kan.bn/mcp' typecheck
node --test tools/compass/upload-file.test.mjs
```

Probar primero con un acta breve: detectar una tarea existente, crear una nueva,
dejar una ambigua en revisión y volver a procesar el mismo archivo sin duplicados.
La operación real requiere la API key, plantilla y documentos del usuario.

La configuración sigue la [referencia oficial de Codex](https://learn.chatgpt.com/docs/config-file/config-reference)
y su mecanismo de [habilidades de repositorio](https://learn.chatgpt.com/docs/build-skills).
