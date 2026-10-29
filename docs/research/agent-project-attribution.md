# Atribución del proyecto en la lista de agentes

Registro histórico de la investigación y las decisiones de producto del
2026-10-28, anteriores a la implementación. Las observaciones y alternativas
descritas corresponden a las revisiones inspeccionadas en esa fecha.

## Estado de entrega

La funcionalidad está integrada en el plugin mediante dos entregas:

- El [PR #9](https://github.com/yersonargotev/herdr-tab-git/pull/9) publica
  etiquetas de proyecto por pane al iniciar y al solicitar una actualización.
- El [PR #10](https://github.com/yersonargotev/herdr-tab-git/pull/10) añade
  actualizaciones en segundo plano, pausa y reanudación, aislamiento de fallos y
  caducidad de los metadatos de proyecto.

El [README](../../README.md#show-each-agents-project) documenta la configuración
y el comportamiento vigente. El [glosario](../../GLOSSARY.md) define Agent
Project y Workspace. Esta nota conserva el contexto de esas decisiones.

## Resultado

El subtítulo `dots` corresponde al token configurado `workspace`: Herdr muestra
el nombre del contenedor del agente. No calcula el proyecto del agente para ese
token. La API ya conoce el directorio correcto del pane. Por tanto, el caso
observado es una diferencia entre el significado del token elegido y la
información que se desea ver, no evidencia de un fallo de detección de CWD.
[Renderer v0.9.5](https://github.com/herdrdev/herdr/blob/v0.9.5/src/client/shell/agent_sidebar.rs#L248-L319),
[resolución de tokens](https://github.com/herdrdev/herdr/blob/v0.9.5/src/ui/sidebar/tokens.rs#L57-L119),
[definición oficial de tokens](https://github.com/herdrdev/herdr/blob/v0.9.5/docs/next/website/src/content/docs/configuration.mdx#L382-L404).

## Fuentes y alcance

- Binario instalado: `/opt/homebrew/Cellar/herdr/0.9.5/bin/herdr`.
- Fuente estable inspeccionada: tag `v0.9.5`, commit
  `2ecf19a92fc3a7fff75b6ce3655ef04f4625ec01`.
- Fuente de desarrollo inspeccionada: `origin/master`, commit
  `bc8c28988f75c538d4ca058b702f5adbea30566e`.
- Entrada de documentación oficial: [llms.txt](https://herdr.dev/llms.txt),
  que identifica la documentación estable 0.9.5 y enlaza los archivos versionados.
- La implementación elegida pertenece a `herdr-tab-git`, plugin independiente
  cuyo README explica que publica tokens por Space siguiendo el tab activo.
  El core `herdrdev/herdr` se consultó como fuente de contratos y comportamiento.
  [README del plugin](../../README.md).

El plugin conserva investigación previa en [PROGRESS.md](../../PROGRESS.md).
Esta nota en `docs/research/` registra la investigación sobre la atribución del
proyecto de cada agente.

## Evidencia observada en la sesión packy

Observaciones recogidas por el agente principal mediante comandos de lectura:

| Fuente | Dato relevante |
| --- | --- |
| `herdr --session packy agent list` | Agente Codex `w12:pA`, `workspace_id: w12`; tanto `cwd` como `foreground_cwd` terminan en `/dots-projects/herdr-tab-git`. |
| `herdr --session packy workspace list` | El workspace `w12` tiene `label: dots`. |
| `herdr --session packy tab get w12:tA` | El tab del agente tiene etiqueta `herdr-tab-git  codex`. |
| `~/.config/herdr/config.toml`, líneas 202–208 | La segunda fila de `[ui.sidebar.agents]` usa `{ token = "workspace", fg = "#6c7086" }`. |
| Captura aportada por el usuario | El terminal Codex indica `herdr-tab-git`; la fila de agente muestra `dots`. |

Los valores son una instantánea de una sesión mutable. El agente investigador
no cambió configuración, selección, títulos ni procesos de esa sesión.

## Flujo demostrado en el código

1. `App::agent_info()` copia `cwd` y `foreground_cwd` desde los metadatos del pane
   a `AgentInfo`; ambos son campos opcionales de la API.
   [Construcción](https://github.com/herdrdev/herdr/blob/v0.9.5/src/app/agents.rs#L368-L408),
   [esquema](https://github.com/herdrdev/herdr/blob/v0.9.5/src/api/schema/agents.rs#L219-L229).
2. La proyección para el cliente conserva ambos campos en `ClientShellPane`.
   [Proyección](https://github.com/herdrdev/herdr/blob/v0.9.5/src/server/client_shell.rs#L125-L149).
3. La fila de agente busca su workspace por `agent.workspace_id` y suministra
   `workspace: &workspace.label` al contexto de tokens. Ese contexto no contiene
   CWD ni un proyecto calculado.
   [Fila](https://github.com/herdrdev/herdr/blob/v0.9.5/src/client/shell/agent_sidebar.rs#L248-L319),
   [contexto](https://github.com/herdrdev/herdr/blob/v0.9.5/src/ui/sidebar/tokens.rs#L57-L68).
4. El token `workspace` se resuelve copiando ese nombre. Los tokens `$name`
   proceden del mapa de metadatos del agente/pane.
   [Resolución](https://github.com/herdrdev/herdr/blob/v0.9.5/src/ui/sidebar/tokens.rs#L88-L116).

La documentación define un workspace como contenedor superior que posee tabs y
panes. En ese modelo, cambiar de directorio dentro de un pane no equivale a
renombrar o mover su workspace.
[Conceptos](https://github.com/herdrdev/herdr/blob/v0.9.5/docs/next/website/src/content/docs/concepts.mdx#L8-L24).

El código de desarrollo inspeccionado conserva exactamente los mismos archivos
`src/client/shell/agent_sidebar.rs`, `src/ui/sidebar/tokens.rs` y
`src/config/sidebar.rs` que el tag estable. Se comprobó mediante
`git diff --stat v0.9.5 HEAD -- <esos archivos>` sin diferencias.
[Renderer en el commit inspeccionado](https://github.com/herdrdev/herdr/blob/bc8c28988f75c538d4ca058b702f5adbea30566e/src/client/shell/agent_sidebar.rs#L248-L319).

## Posibilidades evaluadas y límites

- **Solo configuración:** no hay token integrado `cwd` o `project`. La lista
  permitida incluye workspace, tab, pane, agent y títulos de terminal, además de
  estado, máquina y metadatos personalizados. `tab` no demuestra el proyecto de
  cada agente en tabs con varios panes, y un título puede ser manual o variable.
  Por ello no hay una configuración integrada que garantice el proyecto raíz
  de cada agente.
  [Tokens admitidos](https://github.com/herdrdev/herdr/blob/v0.9.5/src/config/sidebar.rs#L108-L125),
  [selección del tab de cada agente](https://github.com/herdrdev/herdr/blob/v0.9.5/src/client/shell/agent_sidebar.rs#L263-L278).
- **Plugin o reporter:** la infraestructura permite publicar un token de pane,
  por ejemplo `$project`, y usarlo en la fila. Requeriría código que lea cada pane
  y resuelva el valor; añadir el nombre a TOML por sí solo no lo produce.
  `herdr pane report-metadata` admite fuente, secuencia y expiración. Esto permite
  evitar valores eternos si el productor deja de actualizar.
  [Personalización y reporter](https://github.com/herdrdev/herdr/blob/v0.9.5/docs/next/website/src/content/docs/configuration.mdx#L458-L478),
  [contrato de metadatos](https://github.com/herdrdev/herdr/blob/v0.9.5/docs/next/website/src/content/docs/cli-reference.mdx#L314-L334).
- **Cambio en core:** podría incorporar una representación explícita del
  directorio o proyecto del agente. Reinterpretar `workspace` cambiaría un token
  documentado; un token distinto mantendría esa semántica. Esta es una alternativa
  de diseño, no una decisión aprobada.
  [Semántica existente](https://github.com/herdrdev/herdr/blob/v0.9.5/docs/next/website/src/content/docs/configuration.mdx#L382-L404).
- **Fuente de directorio:** existe el precedente de usar `foreground_cwd` y
  después `cwd` en navegación del cliente. En Unix, el runtime trata el CWD del
  líder del grupo de procesos de primer plano como autoridad. Eso no determina
  por sí solo si el producto debe mostrar basename del CWD, raíz Git o raíz de
  worktree; esa política necesita definición.
  [Fallback existente](https://github.com/herdrdev/herdr/blob/v0.9.5/src/client/shell/aggregate_navigation.rs#L385-L390),
  [obtención del CWD](https://github.com/herdrdev/herdr/blob/v0.9.5/src/pane.rs#L3863-L3887).

La instalación de `herdr-tab-git` v1.2.0 inspeccionada por el agente principal,
commit `8eb3a68dcf79797593c0eca1bacab2aaa23e05ec`, publica mediante
`workspace report-metadata` (líneas 107–108). `refresh()` selecciona el workspace
enfocado salvo actualización amplia/limpieza (línea 145), su tab activo (línea
152) y `foreground_cwd || cwd` (línea 154). Por ello no se puede reutilizar
directamente el valor de un Space para todos sus agentes. Extender esa política
al proyecto de cada agente exigiría revisar cobertura de panes inactivos y costo
por ciclo.
[Reporte instalado](https://github.com/yersonargotev/herdr-tab-git/blob/8eb3a68dcf79797593c0eca1bacab2aaa23e05ec/tab-git.js#L107-L108),
[selección instalada](https://github.com/yersonargotev/herdr-tab-git/blob/8eb3a68dcf79797593c0eca1bacab2aaa23e05ec/tab-git.js#L140-L165).
El checkout local del plugin estaba en otra revisión
(`48fe5a66c17970a77919dc50a6ab3b6512bc7300`) y no se trató como copia exacta del
runtime.

## Decisiones acordadas en la entrevista

- La fila debe identificar el **proyecto del agente**, independientemente del
  nombre de su workspace.
- Dentro de una subcarpeta de un repositorio, el nombre debe corresponder a la
  **raíz del repositorio**, no al basename de esa subcarpeta.
- Se eligió ampliar **herdr-tab-git** mediante el contrato público de Herdr.
- Fuera de Git, se mostrará el nombre de la carpeta de trabajo. Sin una ruta
  disponible, la línea quedará vacía; no se sustituirá por el workspace.
- El proyecto seguirá la ruta actual que Herdr detecte, también para agentes
  en pestañas inactivas. Esto no promete detectar cambios de directorio internos
  de herramientas ejecutadas por el agente si Herdr no los publica.
- Para un worktree, se mostrará el nombre de su propia raíz: por ejemplo,
  `herdr-fix-sidebar`, aunque el repositorio principal se llame `herdr`.
- Actualización mediante sondeo nominal cada tres segundos y eventos relevantes,
  también para agentes en pestañas inactivas. Es una cadencia de sondeo, no una
  garantía de latencia máxima si una operación falla o tarda.
- Si Git falla temporalmente, se mostrará el nombre de la carpeta detectada por
  Herdr. No se conservará el nombre de un proyecto anterior.
- Dos raíces distintas con el mismo nombre mostrarán ese mismo nombre corto;
  no se añadirá la carpeta padre para desambiguarlas en esta mejora.
- El vocabulario acordado se registra en [GLOSSARY.md](../../GLOSSARY.md).

## Contrato confirmado

La segunda línea de cada agente mostrará el nombre corto de su proyecto actual.
`herdr-tab-git` publicará un token por pane, consumido por el layout de agentes;
la identidad del workspace seguirá representando su contenedor. Un único valor
asociado al tab activo o al workspace no satisface este contrato.

| Escenario | Subtítulo esperado |
| --- | --- |
| Workspace `dots`, agente en `herdr-tab-git` | `herdr-tab-git` |
| Agente en `herdr-tab-git/test` | `herdr-tab-git` |
| Dos agentes del mismo tab en `dots` y `herdr-tab-git` | El proyecto correspondiente a cada uno |
| Worktree `/proyectos/herdr-fix-sidebar` | `herdr-fix-sidebar` |
| Carpeta sin Git `/tmp/experimento` | `experimento` |
| Sin ruta disponible | Línea vacía |
| Git falla; ruta detectada `/repos/herdr/src` | `src` |
| Cambio de proyecto en un tab inactivo | Nuevo nombre mediante sondeo/eventos |
| `/cliente-a/api` y `/cliente-b/api` | `api` en ambos |

El usuario confirmó esta síntesis como entendimiento compartido el 2026-10-28.
La entrevista y la investigación quedan cerradas. La implementación no forma
parte de la investigación realizada.

No se crea ADR: estas decisiones de presentación son reversibles y no justifican
un registro de arquitectura independiente.

## Verificación propuesta durante la investigación

En el plugin, ampliar las pruebas existentes en
[test/tab-git.test.js](../../test/tab-git.test.js), que usan repositorios Git
temporales y un CLI Herdr falso. Cubrir la tabla anterior, el aislamiento de
tokens por pane, la limpieza/expiración del reporter y la cobertura de panes
inactivos. Verificar en una sesión desechable que el layout de agentes consume el
token correcto, sin modificar la sesión `packy` para experimentar.

Como referencia del core, existen pruebas puras en `src/ui/sidebar/tokens.rs` y
pruebas de composición del sidebar en
`src/client/shell/tests/endpoints.rs`, por ejemplo
`aggregate_agents_use_configured_rows_machine_token_and_status_colors`.
[Pruebas de tokens](https://github.com/herdrdev/herdr/blob/v0.9.5/src/ui/sidebar/tokens.rs#L200),
[pruebas de composición](https://github.com/herdrdev/herdr/blob/v0.9.5/src/client/shell/tests/endpoints.rs#L1442).
Durante la investigación no se ejecutó la suite porque no se modificó código
de producción. Las entregas posteriores incorporaron cobertura en
[test/project.test.js](../../test/project.test.js) y
[test/project-lifecycle.test.js](../../test/project-lifecycle.test.js), además
de conservar las pruebas existentes.
