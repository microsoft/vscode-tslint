import * as path from 'path';
import * as fs from 'fs';
import { workspace, window, commands, QuickPickItem, ExtensionContext, StatusBarAlignment, TextEditor,ThemeColor, Disposable, TextDocumentSaveReason, Uri } from 'vscode';
import {
	LanguageClient, LanguageClientOptions, SettingMonitor, ServerOptions, TextEdit,
	RequestType, TextDocumentIdentifier, ResponseError, InitializeError, State as ClientState, NotificationType, TransportKind,
	Proposed
} from 'vscode-languageclient';
import { exec }  from 'child_process';
import * as open from 'open';

interface AllFixesParams {
	readonly textDocument: TextDocumentIdentifier;
	readonly isOnSave: boolean;
}

interface AllFixesResult {
	readonly documentVersion: number;
	readonly edits: TextEdit[];
	readonly ruleId?: string;
}

namespace AllFixesRequest {
	export const type = new RequestType<AllFixesParams, AllFixesResult, void, void>('textDocument/tslint/allFixes');
}

interface NoTSLintLibraryParams {
	readonly source: TextDocumentIdentifier;
}

interface NoTSLintLibraryResult {
}

namespace NoTSLintLibraryRequest {
	export const type = new RequestType<NoTSLintLibraryParams, NoTSLintLibraryResult, void, void>('tslint/noLibrary');
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

let willSaveTextDocument: Disposable | undefined;
let configurationChangedListener: Disposable;

export function activate(context: ExtensionContext) {

	let statusBarItem = window.createStatusBarItem(StatusBarAlignment.Right, 0);
	let tslintStatus: Status = Status.ok;
	let serverRunning: boolean = false;

	statusBarItem.text = 'TSLint';
	statusBarItem.command = 'tslint.showOutputChannel';
	let errorColor = new ThemeColor('tslint.error');
	let warningColor = new ThemeColor('tslint.warning');

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
				statusBarItem.color = warningColor;
				break;
			case Status.error:
				statusBarItem.color = errorColor; // darkred doesn't work
				break;
		}
		if (tslintStatus !== Status.ok && status === Status.ok) { // an error got addressed fix, write to the output that the status is OK
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

	function udpateStatusBarVisibility(editor: TextEditor | undefined): void {

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

		let enabled = workspace.getConfiguration('tslint')['enable'];

		if (!editor || !enabled) {
			showStatusBarItem(false);
			return;
		}
		showStatusBarItem(
			serverRunning &&
			(
				tslintStatus !== Status.ok ||
				((isTypeScriptDocument(editor.document.languageId) || isEnableForJavaScriptDocument(editor.document.languageId)))
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
	let debugOptions = { execArgv: ["--nolazy", "--inspect=6010"], cwd: process.cwd() };
	let runOptions = {cwd: process.cwd()};
	let serverOptions: ServerOptions = {
		run: { module: serverModulePath, transport: TransportKind.ipc, options: runOptions },
		debug: { module: serverModulePath, transport: TransportKind.ipc, options: debugOptions }
	};

	let clientOptions: LanguageClientOptions = {
		documentSelector: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'],
		synchronize: {
			configurationSection: 'tslint',
			fileEvents: workspace.createFileSystemWatcher('**/tslint.json')
		},
		diagnosticCollectionName: 'tslint',
		initializationFailedHandler: (error) => {
			client.error('Server initialization failed.', error);
			client.outputChannel.show(true);
			return false;
		},
	};

	let client = new LanguageClient('tslint', serverOptions, clientOptions);
	client.registerProposedFeatures();

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
		client.onRequest(NoTSLintLibraryRequest.type, (params) => {
			let uri: Uri = Uri.parse(params.source.uri);
			if (workspace.rootPath) {
				client.info([
					'',
					`Failed to load the TSLint library for the document ${uri.fsPath}`,
					'',
					'To use TSLint in this workspace please install tslint using \'npm install tslint\' or globally using \'npm install -g tslint\'.',
					'TSLint has a peer dependency on `typescript`, make sure that `typescript` is installed as well.',
					'You need to reopen the workspace after installing tslint.',
				].join('\n'));
			} else {
				client.info([
					`Failed to load the TSLint library for the document ${uri.fsPath}`,
					'To use TSLint for single file install tslint globally using \'npm install -g tslint\'.',
					'TSLint has a peer dependency on `typescript`, make sure that `typescript` is installed as well.',
					'You need to reopen VS Code after installing tslint.',
				].join('\n'));
			}
			updateStatus(Status.warn);
			return {};
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

	function showRuleDocumentation(uri: string, documentVersion: number, edits: TextEdit[], ruleId: string) {
		const tslintDocBaseURL = "https://palantir.github.io/tslint/rules";
		if (!ruleId) {
			return;
		}
		open(tslintDocBaseURL+'/'+ruleId);
	}

	function fixAllProblems() {
		// server is not running so there can be no problems to fix
		if (!serverRunning) {
			return;
		}
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

	async function createDefaultConfiguration() {
		let folders = workspace.workspaceFolders;
		if (!folders) {
			window.showErrorMessage('A TSLint configuration file can only be generated if VS Code is opened on a folder.');
			return;
		}
		let folderPicks = folders.map(each => {
			return {label: each.name, description: each.uri.fsPath};
		});
		let selection;
		if (folderPicks.length === 1) {
			selection = folderPicks[0];
		} else {
			selection = await window.showQuickPick(folderPicks, {placeHolder: 'Select the target folder for the tslint.json'});
		}
		if(!selection) {
			return;
		}
		let tslintConfigFile = path.join(selection.description, 'tslint.json');

		if (fs.existsSync(tslintConfigFile)) {
			window.showInformationMessage('A TSLint configuration file already exists.');
			let document = await workspace.openTextDocument(tslintConfigFile);
			window.showTextDocument(document);
		} else {
			const cmd = 'tslint --init';
			const p = exec(cmd, { cwd: selection.description, env: process.env });
			p.on('exit', async (code: number, signal: string) => {
				if (code === 0) {
					let document = await workspace.openTextDocument(tslintConfigFile);
					window.showTextDocument(document);
				}
			});
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
					client.sendRequest(AllFixesRequest.type, { textDocument: { uri: document.uri.toString() }, isOnSave: true }).then((result) => {
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
		udpateStatusBarVisibility(window.activeTextEditor);
	}

	configurationChangedListener = workspace.onDidChangeConfiguration(configurationChanged);
	configurationChanged();

	context.subscriptions.push(
		client.start(),
		configurationChangedListener,
		// internal commands
		commands.registerCommand('_tslint.applySingleFix', applyTextEdits),
		commands.registerCommand('_tslint.applySameFixes', applyTextEdits),
		commands.registerCommand('_tslint.applyAllFixes', applyTextEdits),
		commands.registerCommand('_tslint.applyDisableRule', applyDisableRuleEdit),
		commands.registerCommand('_tslint.showRuleDocumentation', showRuleDocumentation),
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
