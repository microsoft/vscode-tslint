/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
'use strict';

import * as minimatch from 'minimatch';
import * as server from 'vscode-languageserver';
import * as fs from 'fs';
import * as semver from 'semver';

import * as tslint from 'tslint'; // dev dependency only

import { Delayer } from './delayer';


// Settings as defined in VS Code
interface Settings {
	tslint: {
		enable: boolean;
		jsEnable: boolean;
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
	problem: tslint.RuleFailure;
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

interface FixCreator {
	(problem: tslint.RuleFailure, document: server.TextDocument): TSLintAutofixEdit;
}

let fixes: Map<FixCreator> = Object.create(null);

let quoteFixCreator: FixCreator = (problem: tslint.RuleFailure, document: server.TextDocument): TSLintAutofixEdit => {
	// error message: ' should be "   or " should be '
	const wrongQuote = problem.getFailure()[0];
	const fixedQuote = wrongQuote === "'" ? '"' : "'";
	const contents = document.getText().slice(problem.getStartPosition().getPosition() + 1, problem.getEndPosition().getPosition() - 1);
	return {
		range: convertProblemPositionsToRange(problem),
		text: `${fixedQuote}${contents}${fixedQuote}`
	};
};
fixes['quotemark'] = quoteFixCreator;

let whiteSpaceFixCreator: FixCreator = (problem: tslint.RuleFailure, document: server.TextDocument): TSLintAutofixEdit => {
	// error message: 'missing whitespace'
	if (problem.getFailure() !== 'missing whitespace') {
		return null;
	}
	const contents = document.getText().slice(problem.getStartPosition().getPosition(), problem.getEndPosition().getPosition());
	return {
		range: convertProblemPositionsToRange(problem),
		text: ` ${contents}`
	};
};
fixes['whitespace'] = whiteSpaceFixCreator;

let tripleEqualsFixCreator: FixCreator = (problem: tslint.RuleFailure, document: server.TextDocument): TSLintAutofixEdit => {
	// error message: '== should be ===' or '!= should be !=='
	let contents = null;
	if (problem.getFailure() === '== should be ===') {
		contents = '===';
	} else if (problem.getFailure() === '!= should be !==') {
		contents = '!==';
	} else {
		return null;
	}
	return {
		range: convertProblemPositionsToRange(problem),
		text: `${contents}`
	};
};
fixes['triple-equals'] = tripleEqualsFixCreator;

let commentFormatFixCreator: FixCreator = (problem: tslint.RuleFailure, document: server.TextDocument): TSLintAutofixEdit => {
	// error messages:
	//   'comment must start with a space'
	//   'comment must start with lowercase letter'
	//   'comment must start with uppercase letter'
	function swapCase(contents: string, toLower: boolean): string {
		let i = contents.search(/\S/);
		if (i === -1) {
			return contents;
		}
		let prefix = contents.substring(0, i);
		let swap = toLower ? contents[i].toLowerCase(): contents[i].toUpperCase();
		let suffix = contents.substring(i+1);
		return `${prefix}${swap}${suffix}`;
	}

	let replacement;
	const contents = document.getText().slice(problem.getStartPosition().getPosition(), problem.getEndPosition().getPosition());

	switch (problem.getFailure()) {
		case 'comment must start with a space':
			replacement = ` ${contents}`;
			break;
		case 'comment must start with lowercase letter':
			replacement = swapCase(contents, true);
			break;
		case 'comment must start with uppercase letter':
			replacement = swapCase(contents, false);
			break;
		default:
			return null;
	}
	return {
		range: convertProblemPositionsToRange(problem),
		text: replacement
	};
};
fixes['comment-format'] = commentFormatFixCreator;

function convertToServerPosition(position: tslint.RuleFailurePosition): server.Position {
	return {
		character: position.getLineAndCharacter().character,
		line: position.getLineAndCharacter().line
	};
}

function convertProblemPositionsToRange(problem: tslint.RuleFailure): [server.Position, server.Position] {
	let startPosition = convertToServerPosition(problem.getStartPosition());
	let endPosition = convertToServerPosition(problem.getEndPosition());
	return [startPosition, endPosition];
}

export function createVscFixForRuleFailure(problem: tslint.RuleFailure, document: server.TextDocument): TSLintAutofixEdit | undefined {
	let creator = fixes[problem.getRuleName()];
	if (creator) {
		return creator(problem, document);
	}
	return undefined;
}

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

let codeFixActions: Map<Map<AutoFix>> = Object.create(null);
let codeDisableRuleActions: Map<Map<AutoFix>> = Object.create(null);

function recordCodeAction(document: server.TextDocument, diagnostic: server.Diagnostic, problem: tslint.RuleFailure): void {
	let documentDisableRuleFixes: Map<AutoFix> = codeDisableRuleActions[document.uri];
	if (!documentDisableRuleFixes) {
		documentDisableRuleFixes = Object.create(null);
		codeDisableRuleActions[document.uri] = documentDisableRuleFixes;
	}
	documentDisableRuleFixes[computeKey(diagnostic)] = createDisableRuleFix(problem, document);

	let fix: AutoFix = null;
	if (problem.getFix && problem.getFix()) { // tslint fixes are not available in tslint < 3.17
		fix = createAutoFix(problem, document, problem.getFix());
	}
	let vscFix = createVscFixForRuleFailure(problem, document);
	if (vscFix) {
		fix = createAutoFix(problem, document, vscFix);
	}
	if (!fix) {
		return;
	}

	let documentAutoFixes: Map<AutoFix> = codeFixActions[document.uri];
	if (!documentAutoFixes) {
		documentAutoFixes = Object.create(null);
		codeFixActions[document.uri] = documentAutoFixes;
	}
	documentAutoFixes[computeKey(diagnostic)] = fix;
}

function convertReplacementToAutoFix(document: server.TextDocument, repl: tslint.Replacement): TSLintAutofixEdit {
	let start: server.Position = document.positionAt(repl.start);
	let end: server.Position = document.positionAt(repl.end);
	return {
		range: [start, end],
		text: repl.text,
	};
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
	return semver.satisfies(version, ">= 4.0.0 || >= 4.0.0-dev");
}

function doValidate(conn: server.IConnection, document: server.TextDocument): server.Diagnostic[] {
	let uri = document.uri;
	let diagnostics: server.Diagnostic[] = [];
	delete codeFixActions[uri];
	delete codeDisableRuleActions[uri];

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

	if (settings && settings.tslint && !settings.tslint.jsEnable &&
	   (document.languageId === "javascript" || document.languageId === "javascriptreact")) {
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

documents.onDidClose((event) => {
	// A text document was closed we clear the diagnostics
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
	let documentVersion: number = -1;
	let ruleId: string;

	let documentFixes = codeFixActions[uri];
	if (documentFixes) {
		for (let diagnostic of params.context.diagnostics) {
			let autoFix = documentFixes[computeKey(diagnostic)];
			if (autoFix) {
				documentVersion = autoFix.documentVersion;
				ruleId = autoFix.problem.getRuleName();
				result.push(server.Command.create(autoFix.label, 'tslint.applySingleFix', uri, documentVersion, createTextEdit(autoFix)));
			}
		}
		if (result.length > 0) {
			let same: AutoFix[] = [];
			let all: AutoFix[] = [];
			let fixes: AutoFix[] = Object.keys(documentFixes).map(key => documentFixes[key]);

			fixes = sortFixes(fixes);

			for (let autofix of fixes) {
				if (documentVersion === -1) {
					documentVersion = autofix.documentVersion;
				}
				if (autofix.problem.getRuleName() === ruleId && !overlaps(getLastEdit(same), autofix)) {
					same.push(autofix);
				}
				if (!overlaps(getLastEdit(all), autofix)) {
					all.push(autofix);
				}
			}

			// if the same rule warning exists more than once, provide a command to fix all these warnings
			if (same.length > 1) {
				result.push(
					server.Command.create(
						`Fix all "${same[0].problem.getRuleName()}" tslint warnings`,
						'tslint.applySameFixes',
						uri,
						documentVersion, concatenateEdits(same)));
			}

			// create a command to fix all the warnings with fixes
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
	// add the fix to disable the rule
	let disableRuleFixes = codeDisableRuleActions[uri];
	if (disableRuleFixes) {
		for (let diagnostic of params.context.diagnostics) {
			let autoFix = disableRuleFixes[computeKey(diagnostic)];
			if (autoFix) {
				documentVersion = autoFix.documentVersion;
				ruleId = autoFix.problem.getRuleName();
				result.push(server.Command.create(autoFix.label, 'tslint.applyDisableRule', uri, documentVersion, createTextEdit(autoFix)));
			}
		}
	}
	return result;
});

function createAutoFix(problem: tslint.RuleFailure, document: server.TextDocument, fix: tslint.Fix | TSLintAutofixEdit): AutoFix {
	let edits: TSLintAutofixEdit[] = null;

	function isTslintFix(fix: tslint.Fix | TSLintAutofixEdit): fix is tslint.Fix {
		return (<tslint.Fix>fix).replacements !== undefined;
	}

	if (isTslintFix(fix)) {
		edits = fix.replacements.map(each => convertReplacementToAutoFix(document, each));
	} else {
		edits = [fix];
	}

	let autofix: AutoFix = {
		label: `Fix "${problem.getFailure()}"`,
		documentVersion: document.version,
		problem: problem,
		edits: edits,
	};
	return autofix;
}

function createDisableRuleFix(problem: tslint.RuleFailure, document: server.TextDocument): AutoFix {

	let pos: server.Position = {
		character: 0,
		line: problem.getStartPosition().getLineAndCharacter().line
	};

	let disableEdit: TSLintAutofixEdit = {
		range: [pos, pos],
		// prefix to the text will be inserted on the client
		text: `// tslint:disable-next-line:${problem.getRuleName()}\n`
	};

	let disableFix: AutoFix = {
		label: `Disable rule "${problem.getRuleName()}"`,
		documentVersion: document.version,
		problem: problem,
		edits: [disableEdit]
	};
	return disableFix;
}

function sortFixes(fixes: AutoFix[]): AutoFix[] {
	// The AutoFix.edits are sorted, so we sort on the first edit
	return fixes.sort((a, b) => {
		let editA: TSLintAutofixEdit = a.edits[0];
		let editB: TSLintAutofixEdit = b.edits[0];

		if (editA.range[0] < editB.range[0]) {
			return -1;
		}
		if (editA.range[0] > editB.range[0]) {
			return 1;
		}
		// lines are equal
		if (editA.range[1] < editB.range[1]) {
			return -1;
		}
		if (editA.range[1] > editB.range[1]) {
			return 1;
		}
		// characters are equal
		return 0;
	});
}

function overlaps(lastFix: AutoFix, nextFix: AutoFix): boolean {
	if (!lastFix) {
		return false;
	}
	let doesOverlap = false;
	lastFix.edits.some(last => {
		return nextFix.edits.some(next => {
			if (last.range[1].line >= next.range[0].line && last.range[1].character >= next.range[0].character) {
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
	let documentFixes = codeFixActions[uri];
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
