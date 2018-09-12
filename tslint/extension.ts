import * as path from 'path';
import * as fs from 'fs';
import {
	workspace, window, commands, ExtensionContext, StatusBarAlignment, TextEditor, Disposable, TextDocumentSaveReason, Uri,
	ProviderResult, Command, Diagnostic, CodeActionContext, WorkspaceFolder, TextDocument, WorkspaceFolderPickOptions,
	TextDocumentWillSaveEvent, CodeAction
} from 'vscode';
import {
	LanguageClient, LanguageClientOptions, ServerOptions, TextEdit,
	RequestType, TextDocumentIdentifier, State as ClientState, NotificationType, TransportKind,
	CancellationToken, WorkspaceMiddleware, ConfigurationParams
} from 'vscode-languageclient';
import { exec } from 'child_process';

interface AllFixesParams {
	readonly textDocument: TextDocumentIdentifier;
	readonly isOnSave: boolean;
}

interface AllFixesResult {
	readonly documentVersion: number;
	readonly edits: TextEdit[];
	readonly ruleId?: string;
	readonly overlappingFixes: boolean;
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

let willSaveTextDocumentListener: Disposable;
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
	//let debugOptions = { execArgv: ["--nolazy", "--inspect-brk=6010", "--trace-warnings"] };
	let debugOptions = { execArgv: ["--nolazy", "--inspect=6010"], cwd: process.cwd() };
	let runOptions = { cwd: process.cwd() };
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
			provideCodeActions: (document, range, context, token, next): ProviderResult<(Command | CodeAction)[]> => {
				// do not ask server for code action when the diagnostic isn't from tslint
				if (!context.diagnostics || context.diagnostics.length === 0) {
					return [];
				}
				let tslintDiagnostics: Diagnostic[] = [];
				for (let diagnostic of context.diagnostics) {
					if (diagnostic.source === 'tslint') {
						tslintDiagnostics.push(diagnostic);
					}
				}
				if (tslintDiagnostics.length === 0) {
					return [];
				}
				let newContext: CodeActionContext = Object.assign({}, context, { diagnostics: tslintDiagnostics } as CodeActionContext);
				return next(document, range, newContext, token);
			},
			workspace: {
				configuration: (params: ConfigurationParams, token: CancellationToken, next: Function): any[] => {
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

	function getInstallFailureMessage(uri: Uri, workspaceFolder: WorkspaceFolder | undefined, packageManager: string): string {
		let localCommands = {
			npm: 'npm install tslint',
			yarn: 'yarn add tslint'
		};
		let globalCommands = {
			npm: 'npm install -g tslint',
			yarn: 'yarn global add tslint'
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
			return [
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

	function convertAbsolute(file: string, folder: WorkspaceFolder): string {
		if (path.isAbsolute(file)) {
			return file;
		}
		let folderPath = folder.uri.fsPath;
		if (!folderPath) {
			return file;
		}
		return path.join(folderPath, file);
	}

	async function applyTextEdits(uri: string, documentVersion: number, edits: TextEdit[]): Promise<boolean> {
		let textEditor = window.activeTextEditor;
		if (textEditor && textEditor.document.uri.toString() === uri) {
			if (documentVersion !== -1 && textEditor.document.version !== documentVersion) {
				window.showInformationMessage(`TSLint fixes are outdated and can't be applied to the document.`);
				return true;
			}
			return textEditor.edit(mutator => {
				for (let edit of edits) {
					mutator.replace(client.protocol2CodeConverter.asRange(edit.range), edit.newText);
				}
			});
		}
		return true;
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

	function showRuleDocumentation(_uri: string, _documentVersion: number, _edits: TextEdit[], ruleId: string) {
		const tslintDocBaseURL = "https://palantir.github.io/tslint/rules";
		if (!ruleId) {
			return;
		}
		commands.executeCommand('vscode.open', Uri.parse(tslintDocBaseURL + '/' + ruleId));
	}

	function fixAllProblems(): Thenable<any> | undefined {
		// server is not running so there can be no problems to fix
		if (!serverRunning) {
			return;
		}
		let textEditor = window.activeTextEditor;
		if (!textEditor) {
			return;
		}
		return doFixAllProblems(textEditor.document, undefined); // no time budget
	}

	function exists(file: string): Promise<boolean> {
		return new Promise<boolean>((resolve, _reject) => {
			fs.exists(file, (value) => {
				resolve(value);
			});
		});
	}

	async function findTslint(rootPath: string): Promise<string> {
		const platform = process.platform;
		if (platform === 'win32' && await exists(path.join(rootPath, 'node_modules', '.bin', 'tslint.cmd'))) {
			return path.join('.', 'node_modules', '.bin', 'tslint.cmd');
		} else if ((platform === 'linux' || platform === 'darwin') && await exists(path.join(rootPath, 'node_modules', '.bin', 'tslint'))) {
			return path.join('.', 'node_modules', '.bin', 'tslint');
		} else {
			return 'tslint';
		}
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
		const folderPath = folder.uri.fsPath;
		const tslintConfigFile = path.join(folderPath, 'tslint.json');

		if (fs.existsSync(tslintConfigFile)) {
			window.showInformationMessage('A TSLint configuration file already exists.');
			let document = await workspace.openTextDocument(tslintConfigFile);
			window.showTextDocument(document);
		} else {
			const tslintCmd = await findTslint(folderPath);
			const cmd = `${tslintCmd} --init`;
			const p = exec(cmd, { cwd: folderPath, env: process.env });
			p.on('exit', async (code: number, _signal: string) => {
				if (code === 0) {
					let document = await workspace.openTextDocument(tslintConfigFile);
					window.showTextDocument(document);
				} else {
					window.showErrorMessage('Could not run `tslint` to generate a configuration file. Please verify that you have `tslint` and `typescript` installed.');
				}
			});
		}
	}

	function willSaveTextDocument(e: TextDocumentWillSaveEvent) {
		let config = workspace.getConfiguration('tslint', e.document.uri);
		let autoFix = config.get('autoFixOnSave', false);
		if (autoFix) {
			let document = e.document;
			// only auto fix when the document was manually saved by the user
			if (!(isTypeScriptDocument(document) || isEnabledForJavaScriptDocument(document))
				|| e.reason !== TextDocumentSaveReason.Manual) {
				return;
			}
			e.waitUntil(
				doFixAllProblems(document, 500) // total willSave time budget is 1500
			);
		}
	}

	function configurationChanged() {
		updateStatusBarVisibility(window.activeTextEditor);
	}

	function doFixAllProblems(document: TextDocument, timeBudget: number | undefined): Thenable<any> {
		let start = Date.now();
		let loopCount = 0;
		let retry = false;
		let lastVersion = document.version;

		let promise = client.sendRequest(AllFixesRequest.type, { textDocument: { uri: document.uri.toString() }, isOnSave: true }).then(async (result) => {
			while (true) {
				// console.log('duration ', Date.now() - start);
				if (timeBudget && Date.now() - start > timeBudget) {
					console.log(`TSLint auto fix on save maximum time budget (${timeBudget}ms) exceeded.`);
					break;
				}
				if (loopCount++ > 10) {
					console.log(`TSLint auto fix on save maximum retries exceeded.`);
					break;
				}
				if (result) {
					// ensure that document versions on the client are in sync
					if (lastVersion !== document.version) {
						window.showInformationMessage("TSLint: Auto fix on save, fixes could not be applied (client version mismatch).");
						break;
					}
					retry = false;
					if (lastVersion !== result.documentVersion) {
						console.log('TSLint auto fix on save, server document version different than client version');
						retry = true;  // retry to get the fixes matching the document
					} else {
						// try to apply the edits from the server
						let edits = client.protocol2CodeConverter.asTextEdits(result.edits);
						// disable version check by passing -1 as the version, the event loop is blocked during `willSave`
						let success = await applyTextEdits(document.uri.toString(), -1, edits);
						if (!success) {
							window.showInformationMessage("TSLint: Auto fix on save, edits could not be applied");
							break;
						}
					}

					lastVersion = document.version;

					if (result.overlappingFixes || retry) {
						// ask for more non overlapping fixes
						result = await client.sendRequest(AllFixesRequest.type, { textDocument: { uri: document.uri.toString() }, isOnSave: true });
					} else {
						break;
					}
				} else {
					break;
				}
			}
			return null;
		});
		return promise;
	}

	configurationChangedListener = workspace.onDidChangeConfiguration(configurationChanged);
	willSaveTextDocumentListener = workspace.onWillSaveTextDocument(willSaveTextDocument);
	configurationChanged();

	context.subscriptions.push(
		client.start(),
		configurationChangedListener,
		willSaveTextDocumentListener,
		// internal commands
		commands.registerCommand('_tslint.applySingleFix', applyTextEdits),
		commands.registerCommand('_tslint.applySameFixes', applyTextEdits),
		commands.registerCommand('_tslint.applyAllFixes', fixAllProblems),
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

}
