import * as path from 'path';
import * as vscode from "vscode";
import { LanguageClient, LanguageClientOptions, SettingMonitor, ServerOptions } from 'vscode-languageclient';

export function activate(context: vscode.ExtensionContext) {

	// We need to go one level up since an extension compile the js code into
	// the output folder.
	let serverModulePath = path.join(__dirname, '..', 'server', 'server.js');
	let debugOptions = { execArgv: ["--nolazy", "--debug=6004"] };
	let serverOptions: ServerOptions = {
		run: { module: serverModulePath },
		debug: { module: serverModulePath, options: debugOptions }
	};

	let clientOptions: LanguageClientOptions = {
		documentSelector: ['typescript', 'typescriptreact'],
		synchronize: {
			configurationSection: 'tslint',
			fileEvents: vscode.workspace.createFileSystemWatcher('**/tslint.json')
		}
	};

	let client = new LanguageClient('TS Linter', serverOptions, clientOptions);
	context.subscriptions.push(new SettingMonitor(client, 'tslint.enable').start());

	let tsLintHelper = new TsLintHelperProvider();
	tsLintHelper.activate(context.subscriptions);
	vscode.languages.registerCodeActionsProvider('typescript', tsLintHelper);
}

export class TsLintHelperProvider implements vscode.CodeActionProvider {
	private tsLintHelpers: TsLintHelper[] = [];
	private static commandId: string = 'tslint.helper';
	private command: vscode.Disposable;

	public activate(subscriptions: vscode.Disposable[]) {
		this.command = vscode.commands.registerCommand(TsLintHelperProvider.commandId, this.runCodeAction, this);
		subscriptions.push(this);

		let helper: TsLintHelper;
		helper = {
			tsLintCode: "one-line",
			tsLintMessage: "missing whitespace",
			tsLintHelperMessage: "Add a whitespace?",
			runCodeAction: function(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): any {
				console.log("tsLint helper missing whitespace");
				let codeBefore = document.getText(diagnostic.range);
				let codeAfter = " " + codeBefore;
				let edit = new vscode.WorkspaceEdit();
				edit.replace(document.uri, diagnostic.range, codeAfter);
				console.log("Before:>", codeBefore, "< after:>", codeAfter, "<");
				return vscode.workspace.applyEdit(edit);
			}
		}
		this.tsLintHelpers.push(helper);

		helper = {
			tsLintCode: "one-line",
			tsLintMessage: "missing semicolon",
			tsLintHelperMessage: "Add semicolon?",
			runCodeAction: function(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): any {
				console.log("tsLint helper missing semicolon");
				let codeBefore = document.getText(diagnostic.range);
				let codeAfter = codeBefore + ";";
				let edit = new vscode.WorkspaceEdit();
				edit.replace(document.uri, diagnostic.range, codeAfter);
				console.log("Before:>", codeBefore, "< after:>", codeAfter, "<");
				return vscode.workspace.applyEdit(edit);
			}
		}
		this.tsLintHelpers.push(helper);

		helper = {
			tsLintCode: "quotemark",
			tsLintMessage: "' should be \"",
			tsLintHelperMessage: "Replace ' by \" ",
			runCodeAction: function(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): any {
				console.log("tsLint helper replace ' by \"");
				let codeBefore = document.getText(diagnostic.range);
				let codeAfter = "\"" + codeBefore.slice(1, codeBefore.length - 2) + "\"";
				let edit = new vscode.WorkspaceEdit();
				edit.replace(document.uri, diagnostic.range, codeAfter);
				console.log("Before:>", codeBefore, "< after:>", codeAfter, "<");
				return vscode.workspace.applyEdit(edit);
			}
		}
		this.tsLintHelpers.push(helper);
	}

	public dispose(): void {
		this.command.dispose();
	}

	public provideCodeActions(document: vscode.TextDocument, range: vscode.Range, context: vscode.CodeActionContext, token: vscode.CancellationToken): vscode.Command[] {
		let diagnostic: vscode.Diagnostic = context.diagnostics[0];
		console.log("provideCodeActions:", diagnostic);

		let helper = this.tsLintHelpers.find((h: TsLintHelper, index, obj) => { return h.tsLintMessage === diagnostic.message; });
		if (helper !== undefined) {
			return [{
				title: "tsLintHelper:" + helper.tsLintHelperMessage,
				command: TsLintHelperProvider.commandId,
				arguments: [document, diagnostic]
			}];
		} else {
			return null;
		}
	}

	private runCodeAction(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): any {
		console.log("Dans - run - code actions: do something on:", diagnostic);

		let helper = this.tsLintHelpers.find((h: TsLintHelper, index, obj) => { return h.tsLintMessage === diagnostic.message; });
		if (helper !== undefined) {
			helper.runCodeAction(document, diagnostic);
		} else {
			return null;
		}
	}
}

interface TsLintHelper {
	tsLintCode: string;
	tsLintMessage: string;
	tsLintHelperMessage: string;
	runCodeAction(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): any;
}

