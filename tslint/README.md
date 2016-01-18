# vscode-tslint
Integrates [tslint](https://github.com/palantir/tslint) into VS Code.

Please refer to the tslint [documentation](https://github.com/palantir/tslint) for how to configure it.

# Prerequisites
The extension requires that tslint is installed either locally or globally.

The recommended version of tslint is 3.2.1.

When you are using TypeScript version 1.7 then at least version 3.1.1 is required.

# Configuration options

- `tslint.enable` - enable/disable tslint.
- `tslint.rulesDirectory` - an additional rules directory, for user-created rules.
- `tslint.configFile` - the configuration file that tslint should use instead of the default `tslint.json`.


# Release Notes

## 0.5.14
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
