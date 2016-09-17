import * as path from 'path';
import { workspace, window, commands, ExtensionContext } from 'vscode';
import {
	LanguageClient, LanguageClientOptions, SettingMonitor, ServerOptions, TextEdit, Protocol2Code,
	RequestType, TextDocumentIdentifier, ResponseError, InitializeError
} from 'vscode-languageclient';


interface AllFixesParams {
	textDocument: TextDocumentIdentifier;
}

interface AllFixesResult {
	documentVersion: number,
	edits: TextEdit[]
}

namespace AllFixesRequest {
	export const type: RequestType<AllFixesParams, AllFixesResult, void> = { get method() { return 'textDocument/tslint/allFixes'; } };
}

export function activate(context: ExtensionContext) {

	// We need to go one level up since an extension compile the js code into
	// the output folder.
	let serverModulePath = path.join(__dirname, '..', 'server', 'server.js');
	// break on start options
	//let debugOptions = { execArgv: ["--nolazy", "--debug=6004", "--debug-brk"] };
	let debugOptions = { execArgv: ["--nolazy", "--debug=6004"] };
	let serverOptions: ServerOptions = {
		run: { module: serverModulePath },
		debug: { module: serverModulePath, options: debugOptions }
	};

	let clientOptions: LanguageClientOptions = {
		documentSelector: ['typescript', 'typescriptreact'],
		synchronize: {
			configurationSection: 'tslint',
			fileEvents: workspace.createFileSystemWatcher('**/tslint.json')
		},
		diagnosticCollectionName: 'tslint',
		initializationFailedHandler: (error) => {
			if (error instanceof ResponseError) {
				let responseError = (error as ResponseError<InitializeError>);
				if (responseError.code === 99) {
					if (workspace.rootPath) {
						client.info([
							'Failed to load the TSLint library.',
							'To use TSLint in this workspace please install tslint using \'npm install tslint\' or globally using \'npm install -g tslint\'.',
							'You need to reopen the workspace after installing tslint.',
						].join('\n'));
					} else {
						client.info([
							'Failed to load the TSLint library.',
							'To use TSLint for single TypeScript files install tslint globally using \'npm install -g tslint\'.',
							'You need to reopen VS Code after installing tslint.',
						].join('\n'));
					}
					// actively inform the user in the output channel
					client.outputChannel.show();
				} else if (responseError.code === 100) {
					// inform the user but do not show the output channel
					client.info([
						'Failed to load the TSLint library.',
						'Ignoring the failure since there is no \'tslint.json\' file at the root of this workspace.',
					].join('\n'));
				}
			} else {
				client.error('Server initialization failed.', error);
				client.outputChannel.show();
			}
			return false;
		},
	};

	let client = new LanguageClient('tslint', serverOptions, clientOptions);


	function applyTextEdits(uri: string, documentVersion: number, edits: TextEdit[]) {
		let textEditor = window.activeTextEditor;
		if (textEditor && textEditor.document.uri.toString() === uri) {
			if (textEditor.document.version !== documentVersion) {
				window.showInformationMessage(`TSLint fixes are outdated and can't be applied to the document.`);
			}
			textEditor.edit(mutator => {
				for (let edit of edits) {
					mutator.replace(Protocol2Code.asRange(edit.range), edit.newText);
				}
			}).then((success) => {
				if (!success) {
					window.showErrorMessage('Failed to apply TSLint fixes to the document. Please consider opening an issue with steps to reproduce.');
				}
			});
		}
	}

	function fixAllProblems() {
		let textEditor = window.activeTextEditor;
		if (!textEditor) {
			return;
		}
		let uri: string = textEditor.document.uri.toString();
		client.sendRequest(AllFixesRequest.type, { textDocument: { uri } }).then((result) => {
			if (result) {
				applyTextEdits(uri, result.documentVersion, result.edits);
			}
		}, (error) => {
			window.showErrorMessage('Failed to apply TSLint fixes to the document. Please consider opening an issue with steps to reproduce.');
		});
	}

	context.subscriptions.push(
		new SettingMonitor(client, 'tslint.enable').start(),
		commands.registerCommand('tslint.applySingleFix', applyTextEdits),
		commands.registerCommand('tslint.applySameFixes', applyTextEdits),
		commands.registerCommand('tslint.applyAllFixes', applyTextEdits),
		commands.registerCommand('tslint.fixAllProblems', fixAllProblems)
	);
}
