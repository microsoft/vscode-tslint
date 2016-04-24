
// import * as server from 'vscode-languageserver';


export interface TsLintAutoFix {
	tsLintCode: string;
	tsLintMessage: string;
	autoFixMessage: string;
	// runCodeAction(document: server.TextDocument, diagnostic: server.Diagnostic): any;
	// fix(codeBefore: string, diagnostic: server.Diagnostic): any;
	fix(codeBefore: string): string;
}
export let tsLintAutoFixes: TsLintAutoFix[] = [];

let autoFix: TsLintAutoFix;
autoFix = {
	tsLintCode: "one-line",
	tsLintMessage: "missing whitespace",
	autoFixMessage: "Add a whitespace",
	// runCodeAction: function (document: server.TextDocument, diagnostic: server.Diagnostic): any {
	// fix: function (codeBefore: string, diagnostic: server.Diagnostic): any {
	fix: function (codeBefore: string): string {
		// console.log("tsLint helper missing whitespace");
		// server.TextDocuments .create()
		// let codeBefore = document.getText(diagnostic.range);
		let codeAfter = " " + codeBefore;
		// let edit = new server.WorkspaceEdit() WorkspaceEdit();
		// edit.replace(document.uri, diagnostic.range, codeAfter);
		// console.log("Before:>", codeBefore, "< after:>", codeAfter, "<");
		// return server.workspace.applyEdit(edit);
		return codeAfter;
	}
};
this.tsLintAutoFixes.push(autoFix);

autoFix = {
	tsLintCode: "one-line",
	tsLintMessage: "missing semicolon",
	autoFixMessage: "Add semicolon",
	// runCodeAction: function (document: server.TextDocument, diagnostic: server.Diagnostic): any {
	// fix: function (codeBefore: string, diagnostic: server.Diagnostic): any {
	fix: function (codeBefore: string): string {
		// console.log("tsLint helper missing semicolon");
		// let codeBefore = document.getText(diagnostic.range);
		let codeAfter = codeBefore + ";";
		// let edit = new server.WorkspaceEdit();
		// edit.replace(document.uri, diagnostic.range, codeAfter);
		// console.log("Before:>", codeBefore, "< after:>", codeAfter, "<");
		// return server.workspace.applyEdit(edit);

		return codeAfter;
	}
};
this.tsLintAutoFixes.push(autoFix);

autoFix = {
	tsLintCode: "quotemark",
	tsLintMessage: "' should be \"",
	autoFixMessage: "Replace ' by \" ",
	// runCodeAction: function (document: server.TextDocument, diagnostic: server.Diagnostic): any {
	// fix: function (codeBefore: string, diagnostic: server.Diagnostic): any {
	fix: function (codeBefore: string): string {
		// console.log("tsLint helper replace ' by \"");
		// let codeBefore = document.getText(diagnostic.range);
		let codeAfter = "\"" + codeBefore.slice(1, codeBefore.length - 1) + "\"";
		// let edit = new server.WorkspaceEdit();
		// edit.replace(document.uri, diagnostic.range, codeAfter);
		// console.log("Before:>", codeBefore, "< after:>", codeAfter, "<");
		// return server.workspace.applyEdit(edit);
		return codeAfter;
	}
};
this.tsLintAutoFixes.push(autoFix);

autoFix = {
	tsLintCode: "no-trailing-whitespace",
	tsLintMessage: "trailing whitespace",
	autoFixMessage: "Trim whitespace",
	// runCodeAction: function (document: server.TextDocument, diagnostic: server.Diagnostic): any {
	// fix: function (codeBefore: string, diagnostic: server.Diagnostic): any {
	fix: function (codeBefore: string): string {
		// console.log("tsLint helper trim whitespace");
		// let codeBefore = document.getText(diagnostic.range);
		let codeAfter = "";
		// let edit = new server.WorkspaceEdit();
		// edit.replace(document.uri, diagnostic.range, codeAfter);
		// console.log("Before:>", codeBefore, "< after:>", codeAfter, "<");
		// return server.workspace.applyEdit(edit);
		return codeAfter;
	}
};
this.tsLintAutoFixes.push(autoFix);
