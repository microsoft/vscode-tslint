# vscode-tslint
Integrates [tslint](https://github.com/palantir/tslint) into VS Code.

Please refer to the tslint [documentation](https://github.com/palantir/tslint) for how to configure it.

# Prerequisites
The extension requires that tslint is installed either locally or globally.

>Tip: if you get the error that "failed to load tslint", but you have tslint installed locally,
then try to install tslint and its typescript dependency globally using `npm install -g tslint typescript`.

The recommended version of tslint is 3.2.1.

# Configuration options

- `tslint.enable` - enable/disable tslint.
- `tslint.rulesDirectory` - an additional rules directory, for user-created rules.
- `tslint.configFile` - the configuration file that tslint should use instead of the default `tslint.json`.
- `tslint.ignoreDefinitionFiles` - control if TypeScript definition files should be ignored.
- `tslint.exclude` - configure glob patterns of file paths to exclude from linting.
- `tslint.validateWithDefaultConfig` - validate a file for which there was no custom tslint confguration found. The default is `false`.

# Quick fixes

The extension supports some quick fixing of warnings. For warnings which support a quick fix a light bulp is shown when the cursor is positioned inside the warning's range. You can apply the quick fix by either clicking the light bulp or by executing the `Quick Fix` command. The following quick fixes are currently supported:
- missing whitespace
- missing semicolon
- ' should be "
- " sould be '
- trailing whitespace
- file should end with a newline

# Release Notes
## 0.5.25
- Add support for quick fixing some warnings.

## 0.5.23
- Updated to version 2.0 of the vscode language protocol.

## 0.5.21
- Added the setting `tslint.validateWithDefaultConfig`.

# Release Notes
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
