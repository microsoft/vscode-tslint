# Changelog

## 1.0.24

- Capture warnings that tslint emits to the console and indicate them in the status bar item.
- Improve wording of the "Disable Rule" quick fix [#298](https://github.com/Microsoft/vscode-tslint/issues/298)

## 1.0.23

- Improve the README, document the work arounds for issue [#287](https://github.com/Microsoft/vscode-tslint/issues/287) Huge linting delays

## 1.0.22

- Fix for [#292](https://github.com/Microsoft/vscode-tslint/issues/292) Relative path using nested extension is broken

## 1.0.21

- Fix for [#287](https://github.com/Microsoft/vscode-tslint/issues/287) Huge linting delays

## 1.0.15

- Added the the `"multi-root ready"` keyword.
- Support to load tslint, typescript when they are globally installed using yarn [#178](https://github.com/Microsoft/vscode-tslint/issues/178). To use yarn instead of npm with the tslint extension define `"tslint.packageManager": "yarn"` in your settings. To use npm set the value to `"npm"`.
- Added more trace information to the server

## 1.0.12

- Use icons instead of color to emphasize the tslint status in the status bar.
- When validateOnSave is on, clear warnings when the user makes changes.
- Use the new workspace folder picker API when selecting a target folder for tslint.json generation.

## 1.0.11

- Only show tslint statusbar item when there is an error or warning. Added a setting to control whether the TSLint statusbar item is always shown. The default is false  [#268](https://github.com/Microsoft/vscode-tslint/issues/268)
- remove last reference to `rootPath`.

## 1.0.9

- Fix for [#262](https://github.com/Microsoft/vscode-tslint/issues/262) Rule failures reported on .d.ts file
- Fix for [#269](https://github.com/Microsoft/vscode-tslint/issues/264) Constant yellow TSLint status bar warning in diff editor

## 1.0.8

- Fix for [#259](https://github.com/Microsoft/vscode-tslint/issues/259) Support to define tslint.configFile and rulesDirectories with relative paths is broken
- Fix for [#264](https://github.com/Microsoft/vscode-tslint/issues/264) Support relative nodePath settings

## 1.0.7

- Fix for [#259](https://github.com/Microsoft/vscode-tslint/issues/259) tslint.configFile relative to workspace
- Fix for [#261](https://github.com/Microsoft/vscode-tslint/issues/261) Disabling tslint for .js not honored

## 1.0.6

- Fix for [#257](https://github.com/Microsoft/vscode-tslint/issues/257) tslint broke when using tslint version < 4.0

## 1.0.5

- Added more tracing information when `tslint.trace.server` is set to "verbose"

## 1.0.4

- Fix for [#255](https://github.com/Microsoft/vscode-tslint/issues/255) TSLint status shown even when tslint is disabled
- Added an FAQ section to the README

## 1.0.3

- Added support to theme the warning and error color of the status bar item
- Show a warning in the status bar when the tslint library cannot be loaded

## 1.0.2

- Fix for [#252](https://github.com/Microsoft/vscode-tslint/issues/252) The setting nodePath is no longer honored

## 1.0.1

- Added support linting workspaces with multiple root folders. Scoped the tslint settings so that they can be configured per folder.
- Creating a default `tslint.json` is now using `tslint --init` to create the initial contents.
- Loads the tslint library that is nearest to the linted file.

## 0.17.0

- Added support to define which auto fixes should be applied automatically on save [#152](https://github.com/Microsoft/vscode-tslint/issues/152).

## 0.16.0

- Added quick fix to show the documentation of a rule.
- Added description to the contributed variables `tslint4` and `tslint5`.

## 0.15.0

- fix for [#164](https://github.com/Microsoft/vscode-tslint/issues/164) Auto fixer for ordered-imports does not work with multiline named imports
- fix for [#183](https://github.com/Microsoft/vscode-tslint/issues/183) Overlapping fix ranges cause errors which eventually disables `autoFixOnSave`
- fix for [#202](https://github.com/Microsoft/vscode-tslint/issues/202) In TSLint section for settings.json, explain that TSLint settings are configured in tslint.json
- fix for [#206](https://github.com/Microsoft/vscode-tslint/issues/202) Tslint failed to load error should mention that TypeScript is a peer dependency to tslint

## 0.14.0

- fix for [#163](https://github.com/Microsoft/vscode-tslint/issues/163) tslint.autoFixOnSave often goes rogue and adds semi-colons everywhere.
  - Auto fix is now only run when the user manually saves a file.
- added a setting to always show rule failures as warnings, independent of the severity configuration in the `tslint.json` configuration [#199](https://github.com/Microsoft/vscode-tslint/issues/199).
- fix for [#103](https://github.com/Microsoft/vscode-tslint/issues/103) After correcting errors in tslint.json, output channel doesn't reflect "ok" state
- fix for [#194](https://github.com/Microsoft/vscode-tslint/issues/194) 'null: Error: null' in devtools console
- fix for [#197](https://github.com/Microsoft/vscode-tslint/issues/197) Spamed by cannot read tslint configuration

## 0.12.0

- support configurable rule severities introduced in [tslint 5.0](https://github.com/palantir/tslint/releases/tag/5.0.0).
- added a ProblemPattern and ProblemMatcher for `tslint5` which matches the reported severities properly.

## 0.11.0

- support [tslint 5.0](https://github.com/palantir/tslint/releases/tag/5.0.0).

## 0.10.0

- contribute a `tslint4` ProblemPattern and a `tslint4` ProblemMatcher.
- updated the task documentation to use the `tslint4` ProblemMatcher.

## 0.9.0

- updated to version 3.0.2 of the language-client and language-server libraries.
- fix for [#174](https://github.com/Microsoft/vscode-tslint/issues/174) error when using tslint 5.0.0-dev.0
- fix for [#180](https://github.com/Microsoft/vscode-tslint/issues/180) tslint.applyAllFixes should not appear in the list of available commands

## 0.8.1

- added a setting to enable/disable the linting of `.js` files with tslint. The default is `false`. **Previously** tslint was enabled by default for `.js` files.
- fix for [#153](https://github.com/Microsoft/vscode-tslint/issues/153) Error shown in wrong file when using rules that lints external html templates

## 0.7.1

- Revived VS Code quick fixes for some additional rules: `comment-format`, `triple-equals`, `whitespace`

## 0.7.0

- Added quickfixes to disable a rule [#110](https://github.com/Microsoft/vscode-tslint/issues/110)
- Bring back the VS Code provided fix for the `quotemark` rule (e.g. ' should be") [#144](https://github.com/Microsoft/vscode-tslint/issues/144)

## 0.6.7

- Support tslint versions < 3.15.0 [#143](https://github.com/Microsoft/vscode-tslint/issues/143)

## 0.6.6

- Support all tslint autofixes [#135](https://github.com/Microsoft/vscode-tslint/issues/135)

## 0.6.0

- Support tslint >= 4.0

## 0.5.41

- Enable linting of `.js` files.
- Extract the release notes into CHANGELOG.md

## 0.5.40

- Add `tslint.autoFixOnSave` setting which enables fixing auto fixable warnings on file save.
- Added support for auto fixes provided by the tslint library.

## 0.5.39

- The status of the TSLint linter is now shown in the status line.
- Add `tslint.nodePath` setting, which enables to load tslint from a different location than the current workspace or the globally installed npm modules`.
- Added command to create an initial `tslint.json` file.
- Added command to show the tslint output channel.

## 0.5.38

- Warnings are now created into a diagnostic collection `tslint` this improves the integration with tslint warnings generated by a [problem matcher](https://code.visualstudio.com/docs/editor/tasks#_processing-task-output-with-problem-matchers).

## 0.5.35

- Added a command `Fix all auto-fixable problems`.

## 0.5.34

- Add a setting to lint on save only.

## 0.5.33

- Only prompt for installing tslint, when the workspace root includes a `tslint.json` file.

## 0.5.32

- Clear errors when document is closed.

## 0.5.30

- More quick fixes.

## 0.5.25

- Add support for quick fixing some warnings.

## 0.5.23

- Updated to version 2.0 of the vscode language protocol.

## 0.5.21

- Added the setting `tslint.validateWithDefaultConfig`.

## 0.5.17

- Added setting `tslint.validateWithDefaultConfig`.
- Added setting `tslint.ignoreDefinitionFiles`.

## 0.5.15

- Watch for changes in the tslint.json when the file is located outside of the workspace.

## 0.5.13

- Handle the case where a user edits a `tslint.json` configuration file and it is in an intermediate inconsistent state gracefully.

## 0.5.8

- protect against exceptions thrown by tslint.

## 0.5.5

- `tslint.json` is now validated using a JSON schema.
- Diagnostic messages produced by tslint are now tagged with `tslint`.

## 0.5.4

- Added the `tslint.configFile` option.
