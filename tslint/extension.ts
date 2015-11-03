import * as path from 'path';
import { workspace, Disposable, ExtensionContext } from 'vscode';
import { LanguageClient, LanguageClientOptions, SettingMonitor, ServerOptions } from 'vscode-languageclient';

export function activate(context: ExtensionContext) {

	// We need to go one level up since an extension compile the js code into
	// the output folder.
	let serverModulePath = path.join(__dirname, '..', 'server', 'server.js');
	let debugOptions = { execArgv: ["--nolazy", "--debug=6004"] };
	let serverOptions: ServerOptions = {
		run: { module: serverModulePath },
		debug: { module: serverModulePath, options: debugOptions}
	};

	let clientOptions: LanguageClientOptions = {
		documentSelector: ['typescript', 'typescriptreact'],
		synchronize: {
			configurationSection: 'tslint',
			fileEvents: workspace.createFileSystemWatcher('**/tslint.json')
		}
	}

	let client = new LanguageClient('TS Linter', serverOptions, clientOptions);
	context.subscriptions.push(new SettingMonitor(client, 'tslint.enable').start());
}