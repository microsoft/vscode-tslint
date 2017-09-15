/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
'use strict';

import * as minimatch from 'minimatch';
import * as server from 'vscode-languageserver';
import { ConfigurationRequest } from 'vscode-languageserver-protocol/lib/protocol.configuration.proposed';
import * as fs from 'fs';
import * as path from 'path';
import * as semver from 'semver';
import Uri from 'vscode-uri';
import * as util from 'util';

import * as tslint from 'tslint'; // this is a dev dependency only

import { Delayer } from './delayer';
import { createVscFixForRuleFailure, TSLintAutofixEdit } from './fixer';

// Settings as defined in VS Code
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
	autoFixOnSave: boolean | string[];
	trace: any;
	workspaceFolder: server.Proposed.WorkspaceFolder | undefined;
}

interface Configuration {
	linterConfiguration: tslint.Configuration.IConfigurationFile | undefined;
	isDefaultLinterConfig: boolean;
}

class ConfigCache {
	filePath: string | undefined;
	configuration: Configuration  | undefined;

	constructor() {
		this.filePath = undefined;
		this.configuration = undefined;
	}

	set(path: string, configuration:Configuration) {
		this.filePath = path;
		this.configuration = configuration;
	}

	get(forPath:string): Configuration | undefined {
		if (forPath === this.filePath) {
			return this.configuration;
		}
		return undefined;
	}

	isDefaultLinterConfig(): boolean {
		if (this.configuration) {
			return this.configuration.isDefaultLinterConfig;
		}
		return false;
	}

	flush() {
		this.filePath = undefined;
		this.configuration = undefined;
	}
}

class SettingsCache {
	uri: string | undefined;
	settings: Settings | undefined;

	constructor() {
		this.uri = undefined;
		this.settings = undefined;
	}

	async get(uri:string): Promise<Settings | undefined> {
		if (uri === this.uri) {
			return this.settings;
		}
		if (scopedSettingsSupport) {
			let configRequestParam = { items: [{ scopeUri: uri, section: 'tslint' }] };
			let settings = await connection.sendRequest(ConfigurationRequest.type, configRequestParam);
			this.settings = settings[0];
			this.uri = uri;
			return this.settings;
		}
		return globalSettings;
	}

	flush() {
		this.uri = undefined;
		this.settings = undefined;
	}
}

let configCache = new ConfigCache();
let settingsCache = new SettingsCache();
let globalSettings: Settings = <Settings> {};
let scopedSettingsSupport = false;

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
	export const type = new server.NotificationType<StatusParams, void>('tslint/status');
}

interface NoTSLintLibraryParams {
	source: server.TextDocumentIdentifier;
}

interface NoTSLintLibraryResult {
}

namespace NoTSLintLibraryRequest {
	export const type = new server.RequestType<NoTSLintLibraryParams, NoTSLintLibraryResult, void, void>('tslint/noLibrary');
}

let globalNodePath: string | undefined = undefined;

// if tslint < tslint4 then the linter is the module therefore the type `any`
let path2Library: Map<string, typeof tslint.Linter | any> = new Map();
let document2Library: Map<string, Thenable<typeof tslint.Linter | any>> = new Map();

let validationDelayer = new Map<string, Delayer<void>>(); // key is the URI of the document

let tslintNotFound =
	`Failed to load tslint library. Please install tslint in your workspace
folder using \'npm install tslint\' or \'npm install -g tslint\' and then press Retry.`;

let tslintNotFoundIgnored =
	`[vscode-tslint] Failed to load tslint library. This failure is not reported to the user since there is no \'tslint.json\' in the workspace`;



let configFileWatchers: Map<string, fs.FSWatcher> = new Map();

function makeDiagnostic(settings: Settings | undefined, problem: tslint.RuleFailure): server.Diagnostic {
	let message = (problem.getRuleName())
		? `${problem.getFailure()} (${problem.getRuleName()})`
		: `${problem.getFailure()}`;

	let severity;
	let alwaysWarning = settings && settings.alwaysShowRuleFailuresAsWarnings;
	// tslint5 supports to assign severities to rules
	if (!alwaysWarning && problem.getRuleSeverity && problem.getRuleSeverity() === 'error') {
		severity = server.DiagnosticSeverity.Error;
	} else {
		severity = server.DiagnosticSeverity.Warning;
	}

	let diagnostic: server.Diagnostic = {
		severity: severity,
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

let codeFixActions = new Map<string, Map<string, tslint.RuleFailure>>();
let codeDisableRuleActions = new Map<string, Map<string, tslint.RuleFailure>>();

function recordCodeAction(document: server.TextDocument, diagnostic: server.Diagnostic, problem: tslint.RuleFailure): void {
	let documentDisableRuleFixes: Map<string, AutoFix> = codeDisableRuleActions[document.uri];
	if (!documentDisableRuleFixes) {
		documentDisableRuleFixes = Object.create(null);
		codeDisableRuleActions[document.uri] = documentDisableRuleFixes;
	}
	documentDisableRuleFixes[computeKey(diagnostic)] = createDisableRuleFix(problem, document);

	let fix: AutoFix | undefined = undefined;


	// tslint can return a fix with an empty replacements array, these fixes are ignored
	if (problem.getFix && problem.getFix() && !replacementsAreEmpty(problem.getFix())) { // tslint fixes are not available in tslint < 3.17
		fix = createAutoFix(problem, document, problem.getFix()!);
	}
	if (!fix) {
		let vscFix = createVscFixForRuleFailure(problem, document);
		if (vscFix) {
			fix = createAutoFix(problem, document, vscFix);
		}
	}
	if (!fix) {
		return;
	}

	let documentAutoFixes: Map<string, AutoFix> = codeFixActions[document.uri];
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

async function getConfiguration(uri: string, filePath: string, library: any, configFileName: string | null): Promise<Configuration | undefined> {
	let config = configCache.get(filePath);
	if (config) {
		return config;
	}

	let isDefaultConfig = false;
	let linterConfiguration: tslint.Configuration.IConfigurationFile | undefined;

	let linter = getLinterFromLibrary(library);
	if (isTsLintVersion4(library)) {
		if (linter.findConfigurationPath) {
			isDefaultConfig = linter.findConfigurationPath(configFileName, filePath) === undefined;
		}
		let configurationResult = linter.findConfiguration(configFileName, filePath);

		// between tslint 4.0.1 and tslint 4.0.2 the attribute 'error' has been removed from IConfigurationLoadResult
		// in 4.0.2 findConfiguration throws an exception as in version ^3.0.0
		if ((<any>configurationResult).error) {
			throw (<any>configurationResult).error;
		}
		linterConfiguration = configurationResult.results;
	} else {
		// prior to tslint 4.0 the findconfiguration functions where attached to the linter function
		if (linter.findConfigurationPath) {
			isDefaultConfig = linter.findConfigurationPath(configFileName, filePath) === undefined;
		}
		linterConfiguration = <tslint.Configuration.IConfigurationFile>linter.findConfiguration(configFileName, filePath);
	}

	let configuration: Configuration = {
		isDefaultLinterConfig: isDefaultConfig,
		linterConfiguration: linterConfiguration,
	};

	configCache.set(filePath, configuration);
	return configCache.configuration;
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
	conn.console.info(getConfigurationFailureMessage(err));
	conn.sendNotification(StatusNotification.type, { state: Status.error });
}

function validateAllTextDocuments(conn: server.IConnection, documents: server.TextDocument[]): void {
	let tracker = new server.ErrorMessageTracker();
	documents.forEach(document => {
		try {
			validateTextDocument(conn, document);
		} catch (err) {
			tracker.add(getErrorMessage(err, document));
		}
	});
}

function getLinterFromLibrary(library): typeof tslint.Linter {
	let isTsLint4 = isTsLintVersion4(library);
	let linter;
	if (!isTsLint4) {
		linter = library;
	} else {
		linter = library.Linter;
	}
	return linter;
}

async function validateTextDocument(connection: server.IConnection, document: server.TextDocument) {
	let uri = document.uri;

	let settings = await settingsCache.get(uri);

	if (settings && !settings.enable) {
		return;
	}

	if (!document2Library.has(document.uri)) {
		await loadLibrary(document.uri);
	}

	if (!document2Library.has(document.uri)) {
		return;
	}

	document2Library.get(document.uri)!.then(async (library) => {
		if (!library) {
			return;
		}
		try {
			let diagnostics = await doValidate(connection, library, document);
			connection.sendDiagnostics({ uri, diagnostics });
		} catch (err) {
			connection.window.showErrorMessage(getErrorMessage(err, document));
		}
	});
}

let connection: server.IConnection = server.createConnection(new server.IPCMessageReader(process), new server.IPCMessageWriter(process));
let documents: server.TextDocuments = new server.TextDocuments();

documents.listen(connection);

function trace(message: string, verbose?: string): void {
	connection.tracer.log(message, verbose);
}

connection.onInitialize((params) => {
	function hasClientCapability(name: string) {
		let keys = name.split('.');
		let c = params.capabilities;
		for (let i = 0; c && i < keys.length; i++) {
			c = c[keys[i]];
		}
		return !!c;
	}
	scopedSettingsSupport = hasClientCapability('workspace.configuration');
	globalNodePath = server.Files.resolveGlobalNodePath();
	return {
		capabilities: {
			textDocumentSync: documents.syncKind,
			codeActionProvider: true
		}
	};
});

function isTsLintVersion4(library) {
	let version = '1.0.0';
	try {
		version = library.Linter.VERSION;
	} catch (e) {
	}
	return !(semver.satisfies(version, "<= 3.x.x"));
}

async function loadLibrary(docUri: string) {
	let uri = Uri.parse(docUri);
	let promise: Thenable<string>;
	let settings = await settingsCache.get(docUri);

	if (uri.scheme === 'file') {
		let file = uri.fsPath;
		let directory = path.dirname(file);
		if (settings && settings.nodePath) {
			 promise = server.Files.resolve('tslint', settings.nodePath, settings.nodePath!, trace).then<string, string>(undefined, () => {
				 return server.Files.resolve('tslint', globalNodePath, directory, trace);
			 });
		} else {
			promise = server.Files.resolve('tslint', globalNodePath, directory, trace);
		}
	} else {
		promise = server.Files.resolve('tslint', globalNodePath, undefined!, trace); // cwd argument can be  undefined
	}
	document2Library.set(docUri, promise.then((path) => {
		let library;
		if (!path2Library.has(path)) {
			library = require(path);
			connection.console.info(`TSLint library loaded from: ${path}`);
			path2Library.set(path, library);
		}
		return path2Library.get(path);
	}, () => {
		connection.sendRequest(NoTSLintLibraryRequest.type, { source: { uri: docUri } });
		return undefined;
	}));
}

async function doValidate(conn: server.IConnection, library: any, document: server.TextDocument): Promise<server.Diagnostic[]> {
	let uri = document.uri;

	let diagnostics: server.Diagnostic[] = [];
	delete codeFixActions[uri];
	delete codeDisableRuleActions[uri];

	let fsPath = server.Files.uriToFilePath(uri);
	if (!fsPath) {
		// tslint can only lint files on disk
		trace(`No linting: file is not saved on disk`);
		return diagnostics;
	}

	let settings = await settingsCache.get(uri);
	if (!settings) {
		trace('No linting: settings could not be loaded');
		return diagnostics;
	}

	if (fileIsExcluded(settings, fsPath)) {
		trace(`No linting: file ${fsPath} is excluded`);
		return diagnostics;
	}

	let contents = document.getText();
	let configFile = settings.configFile || null;
	if (configFile && settings.workspaceFolder) {
		configFile = resolveConfigFile(configFile, settings.workspaceFolder);
	}

	let configuration: Configuration | undefined;

	try {
		configuration = await getConfiguration(uri, fsPath, library, configFile);
	} catch (err) {
		// this should not happen since we guard against incorrect configurations
		showConfigurationFailure(conn, err);
		trace(`No linting: exception when getting tslint configuration for ${fsPath}, configFile= ${configFile}`);
		return diagnostics;
	}
	if (!configuration) {
		trace(`No linting: no tslint configuration`);
		return diagnostics;
	}
	if (isJsDocument(document) && !settings.jsEnable) {
		trace(`No linting: a JS document, but js linting is disabled`);
		return diagnostics;
	}


	if (settings.validateWithDefaultConfig === false && configCache.configuration!.isDefaultLinterConfig) {
		trace(`No linting: linting with default tslint configuration is disabled`);
		return diagnostics;
	}

	let result: tslint.LintResult;
	let options: tslint.ILinterOptions = {
		formatter: "json",
		fix: false,
		rulesDirectory: settings.rulesDirectory || undefined,
		formattersDirectory: undefined
	};

	if (settings.trace && settings.trace.server === 'verbose') {
		traceConfigurationFile(configuration.linterConfiguration);
	}

	try { // protect against tslint crashes
		let linter = getLinterFromLibrary(library);
		if (isTsLintVersion4(library)) {
			let tslint = new linter(options);
			trace(`Linting: start linting with tslint > version 4`);
			tslint.lint(fsPath, contents, configuration.linterConfiguration);
			result = tslint.getResult();
			trace(`Linting: ended linting`);
		}
		// support for linting js files is only available in tslint > 4.0
		else if (!isJsDocument(document)) {
			(<any>options).configuration = configuration.linterConfiguration;
			trace(`Linting: with tslint < version 4`);
			let tslint = new (<any>linter)(fsPath, contents, options);
			result = tslint.lint();
			trace(`Linting: ended linting`);
		} else {
			trace(`No linting: JS linting not supported in tslint < version 4`);
			return diagnostics;
		}
	} catch (err) {
		conn.console.info(getErrorMessage(err, document));
		connection.sendNotification(StatusNotification.type, { state: Status.error });
		trace(`No linting: tslint exception while linting`);
		return diagnostics;
	}

	if (result.failures.length > 0) {
		filterProblemsForDocument(fsPath, result.failures).forEach(problem => {
			let diagnostic = makeDiagnostic(settings, problem);
			diagnostics.push(diagnostic);
			recordCodeAction(document, diagnostic, problem);
		});
	}
	connection.sendNotification(StatusNotification.type, { state: Status.ok });
	return diagnostics;
}

/**
 * Filter failures for the given document
 */
function filterProblemsForDocument(documentPath: string, failures: tslint.RuleFailure[]): tslint.RuleFailure[] {
	let normalizedPath = path.normalize(documentPath);
	// we only show diagnostics targetting this open document, some tslint rule return diagnostics for other documents/files
	let normalizedFiles = {};
	return failures.filter(each => {
		let fileName = each.getFileName();
		if (!normalizedFiles[fileName]) {
			normalizedFiles[fileName] = path.normalize(fileName);
		}
		return normalizedFiles[fileName] === normalizedPath;
	});
}

function isJsDocument(document: server.TextDocument) {
	return (document.languageId === "javascript" || document.languageId === "javascriptreact");
}

function fileIsExcluded(settings: Settings, path: string): boolean {
	function testForExclusionPattern(path: string, pattern: string): boolean {
		return minimatch(path, pattern);
	}


	if (settings.ignoreDefinitionFiles) {
		if (minimatch(path, "**/*.d.ts")) {
			return true;
		}
	}

	if (settings.exclude) {
		if (Array.isArray(settings.exclude)) {
			for (let pattern of settings.exclude) {
				if (testForExclusionPattern(path, pattern)) {
					return true;
				}
			}
		} else if (testForExclusionPattern(path, <string>settings.exclude)) {
			return true;
		}
	}
	return false;
}

documents.onDidChangeContent(async (event) => {
	let settings = await settingsCache.get(event.document.uri);
	if (settings && settings.run === 'onType') {
		triggerValidateDocument(event.document);
	}
});

documents.onDidSave(async (event) => {
	let settings = await settingsCache.get(event.document.uri);
	if (settings && settings.run === 'onSave') {
		triggerValidateDocument(event.document);
	}
});

documents.onDidClose((event) => {
	// A text document was closed we clear the diagnostics
	connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
	document2Library.delete(event.document.uri);
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
				// TODO getConfiguration(fsPath, configFile);
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
	globalSettings = params.settings;
	configCache.flush();
	settingsCache.flush();
	validateAllTextDocuments(connection, documents.all());
});

// The watched tslint.json has changed. Revalidate all documents, IF the configuration is valid.
connection.onDidChangeWatchedFiles((params) => {
	// Tslint 3.7 started to load configuration files using 'require' and they are now
	// cached in the node module cache. To ensure that the extension uses
	// the latest configuration file we remove the config file from the module cache.
	params.changes.forEach(element => {
		let configFilePath = server.Files.uriToFilePath(element.uri);
		if (configFilePath) {
			let cached = require.cache[configFilePath];
			if (cached) {
				delete require.cache[configFilePath];
			}
		}
	});

	configCache.flush();
	if (tslintConfigurationValid()) {
		validateAllTextDocuments(connection, documents.all());
	}
});

connection.onCodeAction((params) => {
	let result: server.Command[] = [];
	let uri = params.textDocument.uri;
	let documentVersion: number = -1;
	let ruleId: string | undefined = undefined;

	let documentFixes = codeFixActions[uri];
	if (documentFixes) {
		for (let diagnostic of params.context.diagnostics) {
			let autoFix = documentFixes[computeKey(diagnostic)];
			if (autoFix) {
				documentVersion = autoFix.documentVersion;
				ruleId = autoFix.problem.getRuleName();
				result.push(server.Command.create(autoFix.label, '_tslint.applySingleFix', uri, documentVersion, createTextEdit(autoFix)));
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
						`Fix all: ${same[0].problem.getFailure()}`,
						'_tslint.applySameFixes',
						uri,
						documentVersion, concatenateEdits(same)));
			}

			// create a command to fix all the warnings with fixes
			if (all.length > 1) {
				result.push(
					server.Command.create(
						`Fix all auto-fixable problems`,
						'_tslint.applyAllFixes',
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
				result.push(server.Command.create(autoFix.label, '_tslint.applyDisableRule', uri, documentVersion, createTextEdit(autoFix)));
			}
		}
	}
	// quick fix to show the rule documentation
	if (documentFixes) {
		for (let diagnostic of params.context.diagnostics) {
			let autoFix = disableRuleFixes[computeKey(diagnostic)];
			if (autoFix) {
				documentVersion = autoFix.documentVersion;
				let ruleId = autoFix.problem.getRuleName();
				result.push(server.Command.create(`Show documentation for "${ruleId}"`, '_tslint.showRuleDocumentation', uri, documentVersion, undefined, ruleId));
			}
		}
	}

	return result;
});


function replacementsAreEmpty(fix: tslint.Fix | undefined): boolean {
	// in tslint 4 a Fix has a replacement property witht the Replacements
	if ((<any>fix).replacements) {
		return (<any>fix).replacements.length === 0;
	}
	// tslint 5
	if (Array.isArray(fix)) {
		return fix.length === 0;
	}
	return false;
}

function createAutoFix(problem: tslint.RuleFailure, document: server.TextDocument, fix: tslint.Fix | TSLintAutofixEdit): AutoFix {
	let edits: TSLintAutofixEdit[] = [];

	function isTslintAutofixEdit(fix: tslint.Fix | TSLintAutofixEdit | undefined): fix is TSLintAutofixEdit {
		return (<TSLintAutofixEdit>fix).range !== undefined;
	}

	if (isTslintAutofixEdit(fix)) {
		edits = [fix];
	} else {
		let ff: any = fix;
		// in tslint4 a Fix has a replacement property with the Replacements
		if (ff.replacements) {
			// tslint4
			edits = ff.replacements.map(each => convertReplacementToAutoFix(document, each));
		} else {
			// in tslint 5 a Fix is a Replacment | Replacement[]
			if (!Array.isArray(fix)) {
				fix = [fix];
			}
			edits = fix.map(each => convertReplacementToAutoFix(document, each));
		}
	}

	let autofix: AutoFix = {
		label: `Fix: ${problem.getFailure()}`,
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

export function overlaps(lastFix: AutoFix | undefined, nextFix: AutoFix): boolean {
	if (!lastFix) {
		return false;
	}
	let doesOverlap = false;
	lastFix.edits.some(last => {
		return nextFix.edits.some(next => {
			if (last.range[1].line > next.range[0].line) {
				doesOverlap = true;
				return true;
			} else if (last.range[1].line < next.range[0].line) {
				return false;
			} else if (last.range[1].character >= next.range[0].character) {
				doesOverlap = true;
				return true;
			}
			return false;
		});
	});
	return doesOverlap;
}

function getLastEdit(array: AutoFix[]): AutoFix | undefined {
	let length = array.length;
	if (length === 0) {
		return undefined;
	}
	return array[length - 1];
}

export function getAllNonOverlappingFixes(fixes: AutoFix[]): AutoFix[] {
	let nonOverlapping: AutoFix[] = [];
	fixes = sortFixes(fixes);
	for (let autofix of fixes) {
		if (!overlaps(getLastEdit(nonOverlapping), autofix)) {
			nonOverlapping.push(autofix);
		}
	}
	return nonOverlapping;
}

function createTextEdit(autoFix: AutoFix): server.TextEdit[] {
	return autoFix.edits.map(each => server.TextEdit.replace(server.Range.create(each.range[0], each.range[1]), each.text || ''));
}

interface AllFixesParams {
	textDocument: server.TextDocumentIdentifier;
	isOnSave: boolean;
}

interface AllFixesResult {
	documentVersion: number;
	edits: server.TextEdit[];
}

namespace AllFixesRequest {
	export const type = new server.RequestType<AllFixesParams, AllFixesResult, void, void>('textDocument/tslint/allFixes');
}

connection.onRequest(AllFixesRequest.type, async (params) => {
	let result: AllFixesResult | undefined = undefined;
	let uri = params.textDocument.uri;
	let isOnSave = params.isOnSave;
	let documentFixes = codeFixActions[uri];
	let documentVersion: number = -1;
	let settings = await settingsCache.get(uri);

	if (!documentFixes) {
		return undefined;
	}

	let fixes: AutoFix[] = Object.keys(documentFixes).map(key => documentFixes[key]);

	for (let fix of fixes) {
		if (documentVersion === -1) {
			documentVersion = fix.documentVersion;
			break;
		}
	}

	// Filter out fixes for problems that aren't defined to be autofixable on save
	if (isOnSave && settings && Array.isArray(settings.autoFixOnSave)) {
		const autoFixOnSave = settings.autoFixOnSave as Array<string>;
		fixes = fixes.filter(fix => autoFixOnSave.indexOf(fix.problem.getRuleName()) > -1);
	}

	let allFixes = getAllNonOverlappingFixes(fixes);

	result = {
		documentVersion: documentVersion,
		edits: concatenateEdits(allFixes)
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

function resolveConfigFile(configFile: string, folder: server.Proposed.WorkspaceFolder):string {
	if (path.isAbsolute(configFile)) {
		return configFile;
	}
	let folderPath = server.Files.uriToFilePath(folder.uri);
	if (!folderPath) {
		return configFile;
	}
	return path.join(folderPath, configFile);
}

function traceConfigurationFile(configuration: tslint.Configuration.IConfigurationFile | undefined) {
	if (!configuration) {
		trace("no tslint configuration");
		return;
	}
	trace("tslint configuration:", util.inspect(configuration, undefined, 4));
}

connection.listen();
