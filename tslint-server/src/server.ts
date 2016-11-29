/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
'use strict';

import * as minimatch from 'minimatch';
import * as server from 'vscode-languageserver';
import * as fs from 'fs';
import * as semver from 'semver';

// import * as vscFixLib from './vscFix';

import * as tslint from 'tslint';

import { Delayer } from './delayer';

// Settings as defined in VS Code
interface Settings {
	tslint: {
		enable: boolean;
		rulesDirectory: string | string[];
		configFile: string;
		ignoreDefinitionFiles: boolean;
		exclude: string | string[];
		validateWithDefaultConfig: boolean;
		run: 'onSave' | 'onType';
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


export interface TSLintAutofixEdit {
	range: [server.Position, server.Position];
	text: string;
}

export interface AutoFix {
	label: string;
	documentVersion: number;
	ruleId: string;
	edits: TSLintAutofixEdit[];
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
	export const type: server.NotificationType<StatusParams> = { get method() { return 'tslint/status'; } };
}

let settings: Settings = null;

let linter: typeof tslint.Linter = null;
let linterConfiguration: typeof tslint.Configuration = null;

let validationDelayer: Map<Delayer<void>> = Object.create(null); // key is the URI of the document

let tslintNotFound =
	`Failed to load tslint library. Please install tslint in your workspace
folder using \'npm install tslint\' or \'npm install -g tslint\' and then press Retry.`;

// Options passed to tslint
let options: tslint.ILinterOptions = {
	formatter: "json",
	fix: false,
	rulesDirectory: undefined,
	formattersDirectory: undefined
};

let configFile: string = null;
let configFileWatcher: fs.FSWatcher = null;
let configuration: tslint.Configuration.IConfigurationFile = null;
let isTsLint4: boolean = true;

let configCache = {
	filePath: <string>null,
	configuration: <any>null,
	isDefaultConfig: false
};

function makeDiagnostic(problem: tslint.RuleFailure): server.Diagnostic {
	let message = (problem.getRuleName() !== null)
		? `${problem.getFailure()} (${problem.getRuleName()})`
		: `${problem.getFailure()}`;
	let diagnostic: server.Diagnostic = {
		severity: server.DiagnosticSeverity.Warning,
		message: message,
		range: {
			start: {
				line: problem.getStartPosition().getLineAndCharacter().line,
				character: problem.getStartPosition().getLineAndCharacter().character
			},
			end: {
				line: problem.getEndPosition().getLineAndCharacter().line,
				character: problem.getEndPosition().getLineAndCharacter().character
			},
		},
		code: problem.getRuleName(),
		source: 'tslint'
	};

	return diagnostic;
}

let codeActions: Map<Map<AutoFix>> = Object.create(null);

/**
 * convert problem in diagnostic
 * add fix if availble fom vsc or tsl
 * in order to support migration (while not all users move to last version of tslint) and exceptional cases (where IDE information may needed) the rule is:
 *  - tsl fix as to be applier versys vsc fix
 *  - a part when vscFix.overrideTslFix = true
 *
 * !! this algo does not support several fixes provided by tslint engine. Only the first element of the innerReplacements array is used
 * !! let's improve when the case will be raised
 */
function recordCodeAction(document: server.TextDocument, diagnostic: server.Diagnostic, problem: tslint.RuleFailure): void {
	function convertReplacementToAutoFix(document: server.TextDocument, repl: tslint.Replacement): TSLintAutofixEdit {
		let start: server.Position = document.positionAt(repl.start);
		let end: server.Position = document.positionAt(repl.end);
		return {
			range: [start, end],
			text: repl.text,
		};
	}

	let fix = problem.getFix();

	// Limitation: can only apply fixes with a single edit
	if (!fix) {
		return;
	}

	// disable the custom vsc fixes for now

	//check vsc fix
	// let vscFix = vscFixLib.vscFixes.filter(fix => fix.tsLintMessage.toLowerCase() === problem.getFailure().toLocaleLowerCase());
	// if ((vscFix.length > 0)) {
	// 	// not tslFix or vscFix.override
	// 	if ((!problem.getFix()) || (vscFix[0].overrideTSLintFix)) {
	// 		fixText = vscFix[0].autoFix(document.getText().slice(problem.startPosition.position, problem.endPosition.position));
	// 		fixStart = problem.getStartPosition().getLineAndCharacter();
	// 		fixEnd = problem.endPosition;
	// 	}
	// }

	let documentAutoFixes: Map<AutoFix> = codeActions[document.uri];
	if (!documentAutoFixes) {
		documentAutoFixes = Object.create(null);
		codeActions[document.uri] = documentAutoFixes;
	}
	let autoFix: AutoFix = {
		label: `Fix this "${problem.getFailure()}" tslint warning?`,
		documentVersion: document.version,
		ruleId: problem.getRuleName(),
		edits: fix.replacements.map(each => convertReplacementToAutoFix(document, each)),
	};
	documentAutoFixes[computeKey(diagnostic)] = autoFix;
}

function getConfiguration(filePath: string, configFileName: string): any {
	if (configCache.configuration && configCache.filePath === filePath) {
		return configCache.configuration;
	}

	let isDefaultConfig = false;
	let configuration;

	if (isTsLint4) {
		if (linterConfiguration.findConfigurationPath) {
			isDefaultConfig = linterConfiguration.findConfigurationPath(configFileName, filePath) === undefined;
		}
		let configurationResult = linterConfiguration.findConfiguration(configFileName, filePath);

		// between tslint 4.0.1 and tslint 4.0.2 the attribute 'error' has been removed from IConfigurationLoadResult
		// in 4.0.2 findConfiguration throws an exception as in version ^3.0.0
		if ((<any>configurationResult).error) {
			throw (<any>configurationResult).error;
		}
		configuration = configurationResult.results;
	} else {
		// prior to tslint 4.0 the findconfiguration functions where attached to the linter function
		if (linter.findConfigurationPath) {
			isDefaultConfig = linter.findConfigurationPath(configFileName, filePath) === undefined;
		}
		configuration = linter.findConfiguration(configFileName, filePath);
	}
	configCache = {
		filePath: filePath,
		isDefaultConfig: isDefaultConfig,
		configuration: configuration
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

function getConfigurationFailureMessage(err: any): string {
	let errorMessage = `unknown error`;
	if (typeof err.message === 'string' || err.message instanceof String) {
		errorMessage = <string>err.message;
	}
	return `vscode-tslint: Cannot read tslint configuration - '${errorMessage}'`;

}
function showConfigurationFailure(conn: server.IConnection, err: any) {
	let message = getConfigurationFailureMessage(err);
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

let connection: server.IConnection = server.createConnection(new server.IPCMessageReader(process), new server.IPCMessageWriter(process));
let documents: server.TextDocuments = new server.TextDocuments();

documents.listen(connection);

function trace(message: string, verbose?: string): void {
	connection.tracer.log(message, verbose);
}

connection.onInitialize((params): Thenable<server.InitializeResult | server.ResponseError<server.InitializeError>> => {
	let rootFolder = params.rootPath;
	let initOptions: {
		nodePath: string;
	} = params.initializationOptions;
	let nodePath = initOptions ? (initOptions.nodePath ? initOptions.nodePath : undefined) : undefined;

	return server.Files.resolveModule2(rootFolder, 'tslint', nodePath, trace).
		then((value): server.InitializeResult | server.ResponseError<server.InitializeError> => {
			linter = value.Linter;
			linterConfiguration = value.Configuration;

			isTsLint4 = isTsLintVersion4(linter);
			// connection.window.showInformationMessage(isTsLint4 ? 'tslint4': 'tslint3');

			if (!isTsLint4) {
				linter = value;
			}
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
			return Promise.reject(
				new server.ResponseError<server.InitializeError>(100,
					null, // do not show an error message
					{ retry: false }));
		});
});

function isTsLintVersion4(linter) {
	let version = '1.0.0';
	try {
		version = linter.VERSION;
	} catch (e) {
	}
	return semver.gte(version, '4.0.0');
}

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
		configuration = getConfiguration(fsPath, configFile);
	} catch (err) {
		// this should not happen since we guard against incorrect configurations
		showConfigurationFailure(conn, err);
		return diagnostics;
	}

	if (settings && settings.tslint && settings.tslint.validateWithDefaultConfig === false && configCache.isDefaultConfig) {
		return diagnostics;
	}

	if (configCache.isDefaultConfig && settings.tslint.validateWithDefaultConfig === false) {
		return;
	}

	let result: tslint.LintResult;
	try { // protect against tslint crashes
		if (isTsLint4) {
			let tslint = new linter(options);
			tslint.lint(fsPath, contents, configuration);
			result = tslint.getResult();
		}
		// support for linting js files is only available in tslint > 4.0
		else if (document.languageId !== "javascript" && document.languageId !== "javascriptreact") {
			(<any>options).configuration = configuration;
			let tslint = new (<any>linter)(fsPath, contents, options);
			result = tslint.lint();
		} else {
			return diagnostics;
		}
	} catch (err) {
		// TO DO show an indication in the workbench
		conn.console.info(getErrorMessage(err, document));
		connection.sendNotification(StatusNotification.type, { state: Status.error });
		return diagnostics;
	}

	if (result.failureCount > 0) {
		result.failures.forEach(problem => {
			let diagnostic = makeDiagnostic(problem);
			diagnostics.push(diagnostic);
			recordCodeAction(document, diagnostic, problem);
		});
	}
	connection.sendNotification(StatusNotification.type, { state: Status.ok });
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
	if (settings.tslint.run === 'onType') {
		triggerValidateDocument(event.document);
	}
});

documents.onDidSave((event) => {
	if (settings.tslint.run === 'onSave') {
		triggerValidateDocument(event.document);
	}
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
		delete validationDelayer[document.uri];
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
		connection.console.info(getConfigurationFailureMessage(err));
		connection.sendNotification(StatusNotification.type, { state: Status.error });
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
	let documentFixes = codeActions[uri];
	let documentVersion: number = -1;
	let ruleId: string;

	if (documentFixes) {
		for (let diagnostic of params.context.diagnostics) {
			let key = computeKey(diagnostic);
			let autoFix = documentFixes[key];
			if (autoFix) {
				documentVersion = autoFix.documentVersion;
				ruleId = autoFix.ruleId;
				result.push(server.Command.create(autoFix.label, 'tslint.applySingleFix', uri, documentVersion, createTextEdit(autoFix)));
			}
		}
		if (result.length > 0) {
			let same: AutoFix[] = [];
			let all: AutoFix[] = [];
			let fixes: AutoFix[] = Object.keys(documentFixes).map(key => documentFixes[key]);

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

			for (let autofix of fixes) {
				if (documentVersion === -1) {
					documentVersion = autofix.documentVersion;
				}
				if (autofix.ruleId === ruleId && !overlaps(getLastEdit(same), autofix)) {
					same.push(autofix);
				}
				if (!overlaps(getLastEdit(all), autofix)) {
					all.push(autofix);
				}
			}

			// if there several time the same rule identified => propose to fix all
			if (same.length > 1) {
				result.push(
					server.Command.create(
						`Fix all "${same[0].ruleId}" tslint warnings?`,
						'tslint.applySameFixes',
						uri,
						documentVersion, concatenateEdits(same)));
			}

			// propose to fix all
			if (all.length > 1) {
				result.push(
					server.Command.create(
						`Fix all auto-fixable problems`,
						'tslint.applyAllFixes',
						uri,
						documentVersion,
						concatenateEdits(all)));
			}
		}
	}
	return result;
});

function overlaps(lastFix: AutoFix, newFix: AutoFix): boolean {
	if (!lastFix) {
		return false;
	}
	let doesOverlap = false;
	lastFix.edits.some(last => {
		return newFix.edits.some(new_ => {
			if (last.range[1].line >= new_.range[0].line && last.range[1].character >= new_.range[0].character) {
				doesOverlap = true;
				return true;
			}
			return false;
		});
	});
	return doesOverlap;
}

function getLastEdit(array: AutoFix[]): AutoFix {
	let length = array.length;
	if (length === 0) {
		return undefined;
	}
	return array[length - 1];
}

function createTextEdit(autoFix: AutoFix): server.TextEdit[] {
	return autoFix.edits.map(each => server.TextEdit.replace(server.Range.create(each.range[0], each.range[1]), each.text || ''));
}

interface AllFixesParams {
	textDocument: server.TextDocumentIdentifier;
}

interface AllFixesResult {
	documentVersion: number;
	edits: server.TextEdit[];
}

namespace AllFixesRequest {
	export const type: server.RequestType<server.CodeActionParams, AllFixesResult, void> = { get method() { return 'textDocument/tslint/allFixes'; } };
}

connection.onRequest(AllFixesRequest.type, (params) => {
	let result: AllFixesResult = null;
	let uri = params.textDocument.uri;
	let documentFixes = codeActions[uri];
	let documentVersion: number = -1;

	if (!documentFixes) {
		return null;
	}

	let fixes: AutoFix[] = Object.keys(documentFixes).map(key => documentFixes[key]);
	for (let fix of fixes) {
		if (documentVersion === -1) {
			documentVersion = fix.documentVersion;
			break;
		}
	}

	result = {
		documentVersion: documentVersion,
		edits: concatenateEdits(fixes)
	};
	return result;
});

function concatenateEdits(fixes: AutoFix[]): server.TextEdit[] {
	let textEdits: server.TextEdit[] = [];
	fixes.forEach(each => {
		textEdits = textEdits.concat(createTextEdit(each));
	});
	return textEdits;
}

connection.listen();
