/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
'use strict';

import * as minimatch from 'minimatch';
import * as server from 'vscode-languageserver';
import * as fs from 'fs';
import * as autofix from './tslintAutoFix';
import { Delayer } from './delayer'

// Settings as defined in VS Code
interface Settings {
	tslint: {
		enable: boolean;
		rulesDirectory: string | string[];
		configFile: string;
		ignoreDefinitionFiles: boolean;
		exclude: string | string[];
		validateWithDefaultConfig: boolean;
	};
}

interface Map<V> {
	[key: string]: V;
}

class ID {
	private static base: string = `${Date.now().toString()}-`;
	private static counter: number = 0;
	public static next(): string {
		return `${ID.base}${ID.counter++}`;
	}
}

function computeKey(diagnostic: server.Diagnostic): string {
	let range = diagnostic.range;
	return `[${range.start.line},${range.start.character},${range.end.line},${range.end.character}]-${diagnostic.code}`;
}

export interface TSLintPosition {
	line: number;
	character: number;
	position: number;
}

export interface TSLintAutofixEdit {
	range: [server.Position, server.Position];
	text: string;
}

export interface AutoFix {
	label: string;
	documentVersion: number;
	ruleId: string;
	edit: TSLintAutofixEdit;
}

export interface TSLintProblem {
	fix?: TSLintAutofixEdit;
	failure: string;
	startPosition: TSLintPosition;
	endPosition: TSLintPosition;
	ruleName: string;
}

export interface TSLintDocumentReport {
	filePath: string;
	errorCount: number;
	warningCount: number;
	messages: TSLintProblem[];
	output?: string;
}

export interface TSLintReport {
	errorCount: number;
	warningCount: number;
	results: TSLintDocumentReport[];
}

let settings: Settings = null;

let linter: typeof Lint.Linter = null;

let validationDelayer: Map<Delayer<void>> = Object.create(null); // key is the URI of the document

let tslintNotFound =
	`Failed to load tslint library. Please install tslint in your workspace
folder using \'npm install tslint\' or \'npm install -g tslint\' and then press Retry.`;

// Options passed to tslint
let options: Lint.ILinterOptions = {
	formatter: "json",
	configuration: {},
	rulesDirectory: undefined,
	formattersDirectory: undefined
};
let configFile: string = null;
let configFileWatcher: fs.FSWatcher = null;

let configCache = {
	filePath: <string>null,
	configuration: <any>null,
	isDefaultConfig: false
};

function makeDiagnostic(problem: TSLintProblem): server.Diagnostic {
	let diagnostic: server.Diagnostic = {
		severity: server.DiagnosticSeverity.Warning,
		message: problem.failure,
		range: {
			start: {
				line: problem.startPosition.line,
				character: problem.startPosition.character
			},
			end: {
				line: problem.endPosition.line,
				character: problem.endPosition.character
			},
		},
		code: problem.ruleName,
		source: 'tslint'
	};

	return diagnostic;
}

let codeActions: Map<Map<AutoFix>> = Object.create(null);
function recordCodeAction(document: server.TextDocument, diagnostic: server.Diagnostic, problem: TSLintProblem): void {

	let afix = autofix.tsLintAutoFixes.filter(autoFix => autoFix.tsLintMessage.toLowerCase() === problem.failure.toLocaleLowerCase());
	if (afix.length > 0) {
		// create an autoFixEntry for the document in the codeActions
		let uri = document.uri;
		let edits: Map<AutoFix> = codeActions[uri];
		if (!edits) {
			edits = Object.create(null);
			codeActions[uri] = edits;
		}

		/** temporary variable for debugging purpose
		 * it's not possible to use console.log to trace the autofx rules.
		 * so uncomment the following variable put a break point on the line and check in/out of autofix rules
		*/
		// let debugCodeBefore = document.getText().slice(problem.startPosition.position, problem.endPosition.position);
		// let debugCodeAfter = afix[0].autoFix(document.getText().slice(problem.startPosition.position, problem.endPosition.position));

		edits[computeKey(diagnostic)] = {
			label: `Fix this "${problem.failure}" tslint failure?`,
			documentVersion: document.version,
			ruleId: problem.failure,
			edit: {
				range: [problem.startPosition, problem.endPosition],
				text: afix[0].autoFix(document.getText().slice(problem.startPosition.position, problem.endPosition.position))
			}
		};
	}
}

function getConfiguration(filePath: string, configFileName: string): any {
	if (configCache.configuration && configCache.filePath === filePath) {
		return configCache.configuration;
	}

	let isDefaultConfig = false;
	if (linter.findConfigurationPath) {
		isDefaultConfig = linter.findConfigurationPath(configFileName, filePath) === undefined;
	}
	configCache = {
		filePath: filePath,
		isDefaultConfig: isDefaultConfig,
		configuration: linter.findConfiguration(configFileName, filePath)
	};
	return configCache.configuration;
}

function flushConfigCache() {
	configCache = {
		filePath: null,
		configuration: null,
		isDefaultConfig: false
	};
}

function getErrorMessage(err: any, document: server.TextDocument): string {
	let errorMessage = `unknown error`;
	if (typeof err.message === 'string' || err.message instanceof String) {
		errorMessage = <string>err.message;
	}
	let fsPath = server.Files.uriToFilePath(document.uri);
	let message = `vscode-tslint: '${errorMessage}' while validating: ${fsPath} stacktrace: ${err.stack}`;
	return message;
}

function showConfigurationFailure(conn: server.IConnection, err: any) {
	let errorMessage = `unknown error`;
	if (typeof err.message === 'string' || err.message instanceof String) {
		errorMessage = <string>err.message;
	}
	let message = `vscode-tslint: Cannot read tslint configuration - '${errorMessage}'`;
	conn.window.showInformationMessage(message);
}

function validateAllTextDocuments(connection: server.IConnection, documents: server.TextDocument[]): void {
	let tracker = new server.ErrorMessageTracker();
	documents.forEach(document => {
		try {
			validateTextDocument(connection, document);
		} catch (err) {
			tracker.add(getErrorMessage(err, document));
		}
	});
	tracker.sendErrors(connection);
}

function validateTextDocument(connection: server.IConnection, document: server.TextDocument): void {
	try {
		let uri = document.uri;
		let diagnostics = doValidate(connection, document);
		connection.sendDiagnostics({ uri, diagnostics });
	} catch (err) {
		connection.window.showErrorMessage(getErrorMessage(err, document));
	}
}

let connection: server.IConnection = server.createConnection(process.stdin, process.stdout);
let documents: server.TextDocuments = new server.TextDocuments();

documents.listen(connection);

connection.onInitialize((params): Thenable<server.InitializeResult | server.ResponseError<server.InitializeError>> => {
	let rootFolder = params.rootPath;
	return server.Files.resolveModule(rootFolder, 'tslint').
		then((value): server.InitializeResult | server.ResponseError<server.InitializeError> => {
			linter = value;
			let result: server.InitializeResult = { capabilities: { textDocumentSync: documents.syncKind, codeActionProvider: true } };
			return result;
		}, (error) => {
			// We only want to show the tslint load failed error, when the workspace is configured for tslint.
			// However, only tslint knows whether a config file exists, but since we cannot load it we cannot ask it.
			// For now we hard code a common case and only show the error in this case.
			if (fs.existsSync('tslint.json')) {
				return Promise.reject(
					new server.ResponseError<server.InitializeError>(99,
						tslintNotFound,
						{ retry: true }));
			}
			// Respond that initialization failed silently, without prompting the user.
			connection.console.log('vscode-tslint: could not load tslint');
			return Promise.reject(
				new server.ResponseError<server.InitializeError>(99,
					null, // do not show an error message
					{ retry: false }));
		});
});

function doValidate(conn: server.IConnection, document: server.TextDocument): server.Diagnostic[] {
	let uri = document.uri;
	let diagnostics: server.Diagnostic[] = [];
	// Clean previously computed code actions.
	delete codeActions[uri];

	let fsPath = server.Files.uriToFilePath(uri);
	if (!fsPath) {
		// tslint can only lint files on disk
		return diagnostics;
	}

	if (fileIsExcluded(fsPath)) {
		return diagnostics;
	}

	let contents = document.getText();

	try {
		options.configuration = getConfiguration(fsPath, configFile);
	} catch (err) {
		showConfigurationFailure(conn, err);
		return diagnostics;
	}

	if (settings && settings.tslint && settings.tslint.validateWithDefaultConfig === false && configCache.isDefaultConfig) {
		return diagnostics;
	}

	if (configCache.isDefaultConfig && settings.tslint.validateWithDefaultConfig === false) {
		return;
	}

	let result: Lint.LintResult;
	try { // protect against tslint crashes
		let tslint = new linter(fsPath, contents, options);
		result = tslint.lint();
	} catch (err) {
		// TO DO show an indication in the workbench
		conn.console.error(getErrorMessage(err, document));
		return diagnostics;
	}

	if (result.failureCount > 0) {
		let lintProblems: any[] = JSON.parse(result.output);
		lintProblems.forEach(problem => {
			let diagnostic = makeDiagnostic(problem);
			diagnostics.push(diagnostic);
			recordCodeAction(document, diagnostic, problem);
		});
	}
	return diagnostics;
}

function fileIsExcluded(path: string): boolean {
	function testForExclusionPattern(path: string, pattern: string): boolean {
		return minimatch(path, pattern);
	}

	if (settings && settings.tslint) {
		if (settings.tslint.ignoreDefinitionFiles) {
			if (minimatch(path, "**/*.d.ts")) {
				return true;
			}
		}

		if (settings.tslint.exclude) {
			if (Array.isArray(settings.tslint.exclude)) {
				for (let pattern of settings.tslint.exclude) {
					if (testForExclusionPattern(path, pattern)) {
						return true;
					}
				}
			} else if (testForExclusionPattern(path, <string>settings.tslint.exclude)) {
				return true;
			}
		}
	}
}

// A text document has changed. Validate the document.
documents.onDidChangeContent((event) => {
	// the contents of a text document has changed, trigger a delayed validation
	triggerValidateDocument(event.document);
});

// A text document was closed. Clear the diagnostics .
documents.onDidClose((event) => {
	connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

function triggerValidateDocument(document: server.TextDocument) {
	let d = validationDelayer[document.uri];
	if (!d) {
		d = new Delayer<void>(200);
		validationDelayer[document.uri] = d;
	}
	d.trigger(() => {
		validateTextDocument(connection, document);
		delete validationDelayer[document.uri]
	});
}

function tslintConfigurationValid(): boolean {
	try {
		documents.all().forEach((each) => {
			let fsPath = server.Files.uriToFilePath(each.uri);
			if (fsPath) {
				getConfiguration(fsPath, configFile);
			}
		});
	} catch (err) {
		return false;
	}
	return true;
}

// The VS Code tslint settings have changed. Revalidate all documents.
connection.onDidChangeConfiguration((params) => {
	flushConfigCache();
	settings = params.settings;

	if (settings.tslint) {
		options.rulesDirectory = settings.tslint.rulesDirectory || null;
		let newConfigFile = settings.tslint.configFile || null;
		if (configFile !== newConfigFile) {
			if (configFileWatcher) {
				configFileWatcher.close();
				configFileWatcher = null;
			}
			if (!fs.existsSync(newConfigFile)) {
				connection.window.showWarningMessage(`The file ${newConfigFile} refered to by 'tslint.configFile' does not exist`);
				configFile = null;
				return;
			}
			configFile = newConfigFile;
			if (configFile) {
				configFileWatcher = fs.watch(configFile, { persistent: false }, (event, fileName) => {
					validateAllTextDocuments(connection, documents.all());
				});
			}
		}
	}
	validateAllTextDocuments(connection, documents.all());
});

// The watched tslint.json has changed. Revalidate all documents, IF the configuration is valid.
connection.onDidChangeWatchedFiles((params) => {
	// Tslint 3.7 started to load configuration files using 'require' and they are now
	// cached in the node module cache. To ensure that the extension uses
	// the latest configuration file we remove the config file from the module cache.
	params.changes.forEach(element => {
		let configFilePath = server.Files.uriToFilePath(element.uri);
		let cached = require.cache[configFilePath];
		if (cached) {
			delete require.cache[configFilePath];
		}
	});

	flushConfigCache();
	if (tslintConfigurationValid()) {
		validateAllTextDocuments(connection, documents.all());
	}
});

connection.onCodeAction((params) => {
	let result: server.Command[] = [];
	let uri = params.textDocument.uri;
	let edits = codeActions[uri];
	let documentVersion: number = -1;
	let ruleId: string;
	function createTextEdit(editInfo: AutoFix): server.TextEdit {
		return server.TextEdit.replace(
			server.Range.create(
				editInfo.edit.range[0],
				editInfo.edit.range[1]),
			editInfo.edit.text || '');
	}
	if (edits) {
		for (let diagnostic of params.context.diagnostics) {
			let key = computeKey(diagnostic);
			let editInfo = edits[key];
			if (editInfo) {
				documentVersion = editInfo.documentVersion;
				ruleId = editInfo.ruleId;
				result.push(server.Command.create(editInfo.label, 'tslint.applySingleFix', uri, documentVersion, [
					createTextEdit(editInfo)
				]));
			}
		}
		if (result.length > 0) {
			let same: AutoFix[] = [];
			let all: AutoFix[] = [];
			let fixes: AutoFix[] = Object.keys(edits).map(key => edits[key]);

			// TODO from eslint: why? order the fixes for? overlap?
			// fixes = fixes.sort((a, b) => {
			// 	let d = a.edit.range[0] - b.edit.range[0];
			// 	if (d !== 0) {
			// 		return d;
			// 	}
			// 	if (a.edit.range[1] === 0) {
			// 		return -1;
			// 	}
			// 	if (b.edit.range[1] === 0) {
			// 		return 1;
			// 	}
			// 	return a.edit.range[1] - b.edit.range[1];
			// });

			// check if there are fixes overlaps
			function overlaps(lastEdit: AutoFix, newEdit: AutoFix): boolean {
				return !!lastEdit && lastEdit.edit.range[1] > newEdit.edit.range[0];
			}
			function getLastEdit(array: AutoFix[]): AutoFix {
				let length = array.length;
				if (length === 0) {
					return undefined;
				}
				return array[length - 1];
			}

			for (let editInfo of fixes) {
				if (documentVersion === -1) {
					documentVersion = editInfo.documentVersion;
				}
				if (editInfo.ruleId === ruleId && !overlaps(getLastEdit(same), editInfo)) {
					same.push(editInfo);
				}
				if (!overlaps(getLastEdit(all), editInfo)) {
					all.push(editInfo);
				}
			}

			// if there several time the same rule identified => propose to fix all
			if (same.length > 1) {
				result.push(
					server.Command.create(
						`Fix all "${same[0].ruleId}" tslint failures?`,
						'tslint.applySameFixes',
						uri,
						documentVersion, same.map(createTextEdit)));
			}

			// propose to fix all
			if (all.length > 1) {
				result.push(
					server.Command.create(
						`Fix all auto-fixable problems`,
						'tslint.applyAllFixes',
						uri,
						documentVersion,
						all.map(createTextEdit)));
			}
		}
	}
	return result;
});
connection.listen();
