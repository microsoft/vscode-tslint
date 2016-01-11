# vscode-tslint
Integrates [tslint](https://github.com/palantir/tslint) into VS Code.

* When you are using TypeScript version 1.7 then the tslint integration requires at least version 3.1.1 of tslint.*

Please refer to the tslint [documentation](https://github.com/palantir/tslint) for how to configure it.


# Configuration options

- `tslint.enable` - enable/disable tslint.
- `tslint.rulesDirectory` - an additional rules directory, for user-created rules.
- `tslint.configFile` - the configuration file that tslint should use instead of the default `tslint.json`.


# Release Notes

## 0.5.5
- `tslint.json` is now validated using a JSON schema.
- Diagnostic messages produced by tslint are now tagged with `tslint`.

## 0.5.4
- Added the `tslint.configFile` option.
