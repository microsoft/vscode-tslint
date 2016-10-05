# vscode-tslint
![Marketplace Version](http://vsmarketplacebadge.apphb.com/version/eg2.tslint.svg "Current Version") ![Market Place Installs](http://vsmarketplacebadge.apphb.com/installs/eg2.tslint.svg "Number of Installs")

VSCode extension to support tslint

## Development setup
- run npm install inside the `tslint` and `tslint-server` folders
- open VS Code on `tslint` and `tslint-server`

## Developing the server
- open VS Code on `tslint-server`
- run `npm run compile` or `npm run watch` to build the server and copy it into the `tslint` folder
- to debug press F5 which attaches a debugger to the server
- to trace the server communication you can enable the setting: "tslint.trace.server": "verbose" 

## Developing the extension/client
- open VS Code on `tslint`
- run F5 to build and debug the extension

> If you want to debug server and extension at the same time; 1st debug extension and then start server debugging