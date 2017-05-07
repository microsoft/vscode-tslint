import * as path from 'path';
import * as fs from 'fs';
import { workspace, window, commands, ExtensionContext, StatusBarAlignment, TextEditor, Disposable, TextDocumentSaveReason } from 'vscode';
import {
	LanguageClient, LanguageClientOptions, SettingMonitor, ServerOptions, TextEdit,
	RequestType, TextDocumentIdentifier, ResponseError, InitializeError, State as ClientState, NotificationType, TransportKind
} from 'vscode-languageclient';

const tslintConfig: string = [
	'{',
	'	"rules": {',
	'		"no-unused-expression": true,',
	'		"no-duplicate-variable": true,',
	'		"no-unused-variable": true,',
	'		"curly": true,',
	'		"class-name": true,',
	'		"semicolon": ["always"],',
	'		"triple-equals": true',
	'	}',
	'}'
].join(process.platform === 'win32' ? '\r\n' : '\n');

interface AllFixesParams {
	textDocument: TextDocumentIdentifier;
}

interface AllFixesResult {
	documentVersion: number;
	edits: TextEdit[];
}

namespace AllFixesRequest {
	export const type = new RequestType<AllFixesParams, AllFixesResult, void, void>('textDocument/tslint/allFixes');
}

enum Status {
	ok = 1,
	warn = 2,
	error = 3
}

interface StatusParams {
	state: Status;
}

namespace StatusNotification {
	export const type = new NotificationType<StatusParams, void>('tslint/status');
}

let willSaveTextDocument: Disposable;
let configurationChangedListener: Disposable;

export function activate(context: ExtensionContext) {

	let statusBarItem = window.createStatusBarItem(StatusBarAlignment.Right, 0);
	let tslintStatus: Status = Status.ok;
	let serverRunning: boolean = false;

	statusBarItem.text = 'TSLint';
	statusBarItem.command = 'tslint.showOutputChannel';

	function showStatusBarItem(show: boolean): void {
		if (show) {
			statusBarItem.show();
		} else {
			statusBarItem.hide();
		}
	}

	function updateStatus(status: Status) {
		switch (status) {
			case Status.ok:
				statusBarItem.color = undefined;
				break;
			case Status.warn:
				statusBarItem.color = 'yellow';
				break;
			case Status.error:
				statusBarItem.color = 'yellow'; // darkred doesn't work
				break;
		}
		if (tslintStatus !== Status.ok && status == Status.ok) { // an error got addressed fix, write to the output that the status is OK
			client.info('vscode-tslint: Status is OK');
		}
		tslintStatus = status;
		udpateStatusBarVisibility(window.activeTextEditor);
	}

	function isTypeScriptDocument(languageId) {
		return languageId === 'typescript' || languageId === 'typescriptreact';
	}

	function isJavaScriptDocument(languageId) {
		return languageId === 'javascript' || languageId === 'javascriptreact';
	}

	function isEnableForJavaScriptDocument(languageId) {
		let isJsEnable = workspace.getConfiguration('tslint').get('jsEnable', true);
		if (isJsEnable && isJavaScriptDocument(languageId)) {
			return true;
		}
		return false;
	}

	function udpateStatusBarVisibility(editor: TextEditor): void {
		//statusBarItem.text = tslintStatus === Status.ok ? 'TSLint' : 'TSLint!';

		switch (tslintStatus) {
			case Status.ok:
				statusBarItem.text = 'TSLint';
				break;
			case Status.warn:
				statusBarItem.text = 'TSLint: Warning';
				break;
			case Status.error:
				statusBarItem.text = 'TSLint: Error';
				break;

		}
		showStatusBarItem(
			serverRunning &&
			(
				tslintStatus !== Status.ok ||
				(editor && (isTypeScriptDocument(editor.document.languageId) || isEnableForJavaScriptDocument(editor.document.languageId)))
			)
		);
	}

	window.onDidChangeActiveTextEditor(udpateStatusBarVisibility);
	udpateStatusBarVisibility(window.activeTextEditor);

	// We need to go one level up since an extension compile the js code into
	// the output folder.
	let serverModulePath = path.join(__dirname, '..', 'server', 'server.js');
	// break on start options
	//let debugOptions = { execArgv: ["--nolazy", "--debug=6010", "--debug-brk"] };
	let debugOptions = { execArgv: ["--nolazy", "--debug=6010"] };
	let serverOptions: ServerOptions = {
		run: { module: serverModulePath, transport: TransportKind.ipc },
		debug: { module: serverModulePath, transport: TransportKind.ipc, options: debugOptions }
	};

	let clientOptions: LanguageClientOptions = {
		documentSelector: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'],
		synchronize: {
			configurationSection: 'tslint',
			fileEvents: workspace.createFileSystemWatcher('**/tslint.json')
		},
		diagnosticCollectionName: 'tslint',
		initializationOptions: () => {
			let configuration = workspace.getConfiguration('tslint');
			return {
				nodePath: configuration ? configuration.get('nodePath', undefined) : undefined
			};
		},
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
					client.outputChannel.show(true);
				} else if (responseError.code === 100) {
					// inform the user but do not show the output channel
					client.info([
						'Failed to load the TSLint library.',
						'Ignoring the failure since there is no \'tslint.json\' file at the root of this workspace.',
					].join('\n'));
				} else if (responseError.code === 101) {
					if (workspace.rootPath) {
						client.error([
							'The extension requires at least version 4.0.0 of tslint.',
							'Please install the latest version of tslint using \'npm install tslint\' or globally using \'npm install -g tslint\'.',
							'You need to reopen the workspace after installing tslint.',
						].join('\n'));
					} else {
						client.error([
							'The extension requires at least version 4.0.0 of tslint.',
							'Please install the latest version of tslint globally using \'npm install -g tslint\'.',
							'You need to reopen VS Code after installing tslint.',
						].join('\n'));
					}
					// actively inform the user in the output channel
					client.outputChannel.show(true);
				}
			} else {
				client.error('Server initialization failed.', error);
				client.outputChannel.show(true);
			}
			return false;
		},
	};

	let client = new LanguageClient('tslint', serverOptions, clientOptions);

	const running = 'Linter is running.';
	const stopped = 'Linter has stopped.';

	client.onDidChangeState((event) => {
		if (event.newState === ClientState.Running) {
			client.info(running);
			statusBarItem.tooltip = running;
			serverRunning = true;
		} else {
			client.info(stopped);
			statusBarItem.tooltip = stopped;
			serverRunning = false;
		}
		udpateStatusBarVisibility(window.activeTextEditor);
	});

	client.onReady().then(() => {
		client.onNotification(StatusNotification.type, (params) => {
			updateStatus(params.state);
		});
	});

	function applyTextEdits(uri: string, documentVersion: number, edits: TextEdit[]) {
		let textEditor = window.activeTextEditor;
		if (textEditor && textEditor.document.uri.toString() === uri) {
			if (textEditor.document.version !== documentVersion) {
				window.showInformationMessage(`TSLint fixes are outdated and can't be applied to the document.`);
			}
			textEditor.edit(mutator => {
				for (let edit of edits) {
					mutator.replace(client.protocol2CodeConverter.asRange(edit.range), edit.newText);
				}
			}).then((success) => {
				if (!success) {
					window.showErrorMessage('Failed to apply TSLint fixes to the document. Please consider opening an issue with steps to reproduce.');
				}
			});
		}
	}

	function applyDisableRuleEdit(uri: string, documentVersion: number, edits: TextEdit[]) {
		let textEditor = window.activeTextEditor;
		if (textEditor && textEditor.document.uri.toString() === uri) {
			if (textEditor.document.version !== documentVersion) {
				window.showInformationMessage(`TSLint fixes are outdated and can't be applied to the document.`);
			}
			// prefix disable comment with same indent as line with the diagnostic
			let edit = edits[0];
			let ruleLine = textEditor.document.lineAt(edit.range.start.line);
			let prefixIndex = ruleLine.firstNonWhitespaceCharacterIndex;
			let prefix = ruleLine.text.substr(0, prefixIndex);
			edit.newText = prefix + edit.newText;
			applyTextEdits(uri, documentVersion, edits);
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

	function createDefaultConfiguration(): void {
		if (!workspace.rootPath) {
			window.showErrorMessage('A TSLint configuration file can only be generated if VS Code is opened on a folder.');
		}
		let tslintConfigFile = path.join(workspace.rootPath, 'tslint.json');

		if (fs.existsSync(tslintConfigFile)) {
			window.showInformationMessage('A TSLint configuration file already exists.');
		} else {
			fs.writeFileSync(tslintConfigFile, tslintConfig, { encoding: 'utf8' });
		}
	}

	function configurationChanged() {
		let config = workspace.getConfiguration('tslint');
		let autoFix = config.get('autoFixOnSave', false);
		if (autoFix && !willSaveTextDocument) {
			willSaveTextDocument = workspace.onWillSaveTextDocument((event) => {
				let document = event.document;
				// only auto fix when the document was manually saved by the user
				if (!(isTypeScriptDocument(document.languageId) || isEnableForJavaScriptDocument(document.languageId))
					|| event.reason !== TextDocumentSaveReason.Manual) {
					return;
				}
				const version = document.version;
				event.waitUntil(
					client.sendRequest(AllFixesRequest.type, { textDocument: { uri: document.uri.toString() } }).then((result) => {
						if (result && version === result.documentVersion) {
							return client.protocol2CodeConverter.asTextEdits(result.edits);
						} else {
							return [];
						}
					})
				);
			});
		} else if (!autoFix && willSaveTextDocument) {
			willSaveTextDocument.dispose();
			willSaveTextDocument = undefined;
		}
	}

	configurationChangedListener = workspace.onDidChangeConfiguration(configurationChanged);
	configurationChanged();

	context.subscriptions.push(
		new SettingMonitor(client, 'tslint.enable').start(),
		configurationChangedListener,
		// internal commands
		commands.registerCommand('_tslint.applySingleFix', applyTextEdits),
		commands.registerCommand('_tslint.applySameFixes', applyTextEdits),
		commands.registerCommand('_tslint.applyAllFixes', applyTextEdits),
		commands.registerCommand('_tslint.applyDisableRule', applyDisableRuleEdit),
		// user commands
		commands.registerCommand('tslint.fixAllProblems', fixAllProblems),
		commands.registerCommand('tslint.createConfig', createDefaultConfiguration),
		commands.registerCommand('tslint.showOutputChannel', () => { client.outputChannel.show(); }),
		statusBarItem
	);
}

export function deactivate() {
	if (willSaveTextDocument) {
		willSaveTextDocument.dispose();
		willSaveTextDocument = undefined;
	}
}