# Glossary

This plugin describes the projects associated with terminals in Herdr. An agent's
project and the workspace containing it are distinct concepts.

## Agent Project

The project in which an agent is currently working. Inside Git, its checkout
root identifies it. This includes agents in a repository subdirectory or a
linked worktree. Outside Git, its reported working directory identifies it.

The pane-scoped `$project` token displays the project's short name. See the
[Agents sidebar configuration](README.md#show-each-agents-project).

## Workspace

A named container of tabs and panes. Agents in the same workspace can work on
different projects.
