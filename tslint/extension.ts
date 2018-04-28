import * as path from 'path';
import * as fs from 'fs';
import { workspace, window, commands, QuickPickItem, ExtensionContext, StatusBarAlignment, TextEditor, ThemeColor, Disposable, TextDocumentSaveReason, Uri, ProviderResult, Command, Diagnostic, CodeActionContext, WorkspaceFolder, TextDocument, WorkspaceFolderPickOptions } from 'vscode';
import {
	LanguageClient, LanguageClientOptions, SettingMonitor, ServerOptions, TextEdit,
	RequestType, TextDocumentIdentifier, ResponseError, InitializeError, State as ClientState, NotificationType, TransportKind,
	Proposed, CancellationToken, WorkspaceMiddleware
} from 'vscode-languageclient';
import { exec }  from 'child_process';

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

interface Settings {
	enable: boolean;
	jsEnable: boolean;
	rulesDirectory: string | string[];
	configFile: string;
	ignoreDefinitionFiles: boolean;
	exclude: string | string[];
	validateWithDefaultConfig: boolean;
	nodePath: string | undefined;
	run: 'onSave' | 'onType';
	alwaysShowRuleFailuresAsWarnings: boolean;
	alwaysShowStatus: boolean;
	autoFixOnSave: boolean | string[];
	packageManager: 'npm' | 'yarn';
	trace: any;
	workspaceFolderPath: string; // 'virtual' setting sent to the server
}

let willSaveTextDocument: Disposable | undefined;
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
		if (tslintStatus !== Status.ok && status === Status.ok) { // an error got addressed fix, write to the output that the status is OK
			client.info('vscode-tslint: Status is OK');
		}
		tslintStatus = status;
		updateStatusBarVisibility(window.activeTextEditor);
	}

	function isTypeScriptDocument(document: TextDocument) {
		return document.languageId === 'typescript' || document.languageId === 'typescriptreact';
	}

	function isJavaScriptDocument(languageId) {
		return languageId === 'javascript' || languageId === 'javascriptreact';
	}

	function isEnabledForJavaScriptDocument(document: TextDocument) {
		let isJsEnable = workspace.getConfiguration('tslint', document.uri).get('jsEnable', true);
		if (isJsEnable && isJavaScriptDocument(document.languageId)) {
			return true;
		}
		return false;
	}

	function updateStatusBarVisibility(editor: TextEditor | undefined): void {

		switch (tslintStatus) {
			case Status.ok:
				statusBarItem.text = 'TSLint';
				break;
			case Status.warn:
				statusBarItem.text = '$(alert) TSLint';
				break;
			case Status.error:
				statusBarItem.text = '$(issue-opened) TSLint';
				break;

		}
		let uri = editor ? editor.document.uri : undefined;
		let enabled = workspace.getConfiguration('tslint', uri)['enable'];
		let alwaysShowStatus = workspace.getConfiguration('tslint', uri)['alwaysShowStatus'];

		if (!editor || !enabled || (tslintStatus === Status.ok && !alwaysShowStatus)) {
			showStatusBarItem(false);
			return;
		}

		showStatusBarItem(
			serverRunning &&
			(isTypeScriptDocument(editor.document) || isEnabledForJavaScriptDocument(editor.document))
		);
	}

	window.onDidChangeActiveTextEditor(updateStatusBarVisibility);
	updateStatusBarVisibility(window.activeTextEditor);

	// We need to go one level up since an extension compile the js code into
	// the output folder.
	let serverModulePath = path.join(__dirname, '..', 'server', 'tslintServer.js');
	// break on start options
	//let debugOptions = { execArgv: ["--nolazy", "--debug=6010", "--debug-brk"] };
	let debugOptions = { execArgv: ["--nolazy", "--inspect=6010"], cwd: process.cwd() };
	let runOptions = {cwd: process.cwd()};
	let serverOptions: ServerOptions = {
		run: { module: serverModulePath, transport: TransportKind.ipc, options: runOptions },
		debug: { module: serverModulePath, transport: TransportKind.ipc, options: debugOptions }
	};

	let clientOptions: LanguageClientOptions = {
		documentSelector: [
			{ language: 'typescript', scheme: 'file' },
			{ language: 'typescriptreact', scheme: 'file' },
			{ language: 'javascript', scheme: 'file' },
			{ language: 'javascriptreact', scheme: 'file' }
		],
		synchronize: {
			configurationSection: 'tslint',
			fileEvents: workspace.createFileSystemWatcher('**/tslint.{json,yml,yaml}')
		},
		diagnosticCollectionName: 'tslint',
		initializationFailedHandler: (error) => {
			client.error('Server initialization failed.', error);
			client.outputChannel.show(true);
			return false;
		},
		middleware: {
			provideCodeActions: (document, range, context, token, next): ProviderResult<Command[]> => {
				// do not ask server for code action when the diagnostic isn't from tslint
				if (!context.diagnostics || context.diagnostics.length === 0) {
					return [];
				}
				let tslintDiagnostics: Diagnostic[] = [];
				for (let diagnostic of context.diagnostics) {
					if (diagnostic.source === 'tslint') {
						tslintDiagnostics.push(diagnostic)
					}
				}
				if (tslintDiagnostics.length === 0) {
					return [];
				}
				let newContext: CodeActionContext = Object.assign({}, context, { diagnostics: tslintDiagnostics } as CodeActionContext);
				return next(document, range, newContext, token);
			},
			workspace: {
				configuration: (params: Proposed.ConfigurationParams, token: CancellationToken, next: Function): any[] => {
					if (!params.items) {
						return [];
					}
					let result = next(params, token, next);
					let scopeUri = "";

					for (let item of params.items) {
						if (!item.scopeUri) {
							continue;
						} else {
							scopeUri = item.scopeUri;
						}
					}
					let resource = client.protocol2CodeConverter.asUri(scopeUri);
					let workspaceFolder = workspace.getWorkspaceFolder(resource);
					if (workspaceFolder) {
						convertToAbsolutePaths(result[0], workspaceFolder);
						if (workspaceFolder.uri.scheme === 'file') {
							result[0].workspaceFolderPath = workspaceFolder.uri.fsPath;
						}
					}
					return result;
				}
			} as WorkspaceMiddleware
		}
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
		updateStatusBarVisibility(window.activeTextEditor);
	});

	client.onReady().then(() => {
		client.onNotification(StatusNotification.type, (params) => {
			updateStatus(params.state);
		});
		client.onRequest(NoTSLintLibraryRequest.type, (params) => {
			let uri: Uri = Uri.parse(params.source.uri);
			let workspaceFolder = workspace.getWorkspaceFolder(uri);
			let packageManager = workspace.getConfiguration('tslint', uri).get('packageManager', 'npm');
			client.info(getInstallFailureMessage(uri, workspaceFolder, packageManager));
			updateStatus(Status.warn);
			return {};
		});
	});

	function getInstallFailureMessage(uri: Uri, workspaceFolder: WorkspaceFolder|undefined, packageManager:string): string {
		let localCommands = {
			npm: 'npm install tslint',
			yarn: 'yarn add tslint'
		};
		let globalCommands = {
			npm: 'npm install -g tslint',
			yarn:'yarn global add tslint'
		};
		if (workspaceFolder) { // workspace opened on a folder
			return [
				'',
				`Failed to load the TSLint library for the document ${uri.fsPath}`,
				'',
				`To use TSLint in this workspace please install tslint using \'${localCommands[packageManager]}\' or globally using \'${globalCommands[packageManager]}\'.`,
				'TSLint has a peer dependency on `typescript`, make sure that `typescript` is installed as well.',
				'You need to reopen the workspace after installing tslint.',
			].join('\n');
		} else {
			return[
				`Failed to load the TSLint library for the document ${uri.fsPath}`,
				`To use TSLint for single file install tslint globally using \'${globalCommands[packageManager]}\'.`,
				'TSLint has a peer dependency on `typescript`, make sure that `typescript` is installed as well.',
				'You need to reopen VS Code after installing tslint.',
			].join('\n');
		}
	}

	function convertToAbsolutePaths(settings: Settings, folder: WorkspaceFolder) {
		let configFile = settings.configFile;
		if (configFile) {
			settings.configFile = convertAbsolute(configFile, folder);
		}
		let nodePath = settings.nodePath;
		if (nodePath) {
			settings.nodePath = convertAbsolute(nodePath, folder);
		}
		if (settings.rulesDirectory) {
			if (Array.isArray(settings.rulesDirectory)) {
				for (let i = 0; i < settings.rulesDirectory.length; i++) {
					settings.rulesDirectory[i] = convertAbsolute(settings.rulesDirectory[i], folder);

				}
			} else {
				settings.rulesDirectory = convertAbsolute(settings.rulesDirectory, folder);
			}
		}
	}

	function convertAbsolute(file: string, folder: WorkspaceFolder):string {
		if (path.isAbsolute(file)) {
			return file;
		}
		let folderPath = folder.uri.fsPath;
		if (!folderPath) {
			return file;
		}
		return path.join(folderPath, file);
	}

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
		commands.executeCommand('vscode.open', Uri.parse(tslintDocBaseURL+'/'+ruleId));
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
		let folder: WorkspaceFolder | undefined = undefined;
		if (!folders) {
			window.showErrorMessage('A TSLint configuration file can only be generated if VS Code is opened on a folder.');
			return;
		}
		if (folders.length === 1) {
			folder = folders[0];
		} else {
			const options: WorkspaceFolderPickOptions = {
				placeHolder: "Select the folder for generating the 'tslint.json' file"
			};
			folder = await window.showWorkspaceFolderPick(options);
			if (!folder) {
				return;
			}
		}
		let tslintConfigFile = path.join(folder.uri.fsPath, 'tslint.json');

		if (fs.existsSync(tslintConfigFile)) {
			window.showInformationMessage('A TSLint configuration file already exists.');
			let document = await workspace.openTextDocument(tslintConfigFile);
			window.showTextDocument(document);
		} else {
			const cmd = 'tslint --init';
			const p = exec(cmd, { cwd: folder.uri.fsPath, env: process.env });
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
				if (!(isTypeScriptDocument(document) || isEnabledForJavaScriptDocument(document))
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
		updateStatusBarVisibility(window.activeTextEditor);
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
