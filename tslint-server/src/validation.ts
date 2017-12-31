import * as util from 'util';
import * as path from 'path';
import Uri from 'vscode-uri';
import * as server from 'vscode-languageserver';
import { trace, getErrorMessage } from './utils';
import * as minimatch from 'minimatch';
import * as semver from 'semver';

import * as tslint from 'tslint'; // this is a dev dependency only
import { configCache, Configuration, Settings, settingsCache } from './settings';
import { recordCodeAction, resetRuleFailures } from './commands';


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
// if tslint < tslint4 then the linter is the module therefore the type `any`
let path2Library: Map<string, typeof tslint.Linter | any> = new Map();
let globalPackageManagerPath: Map<string, string> = new Map();  // map stores undefined values to represent failed resolutions


export let document2Library: Map<string, Thenable<typeof tslint.Linter | any>> = new Map();



export function validateAllTextDocuments(conn: server.IConnection, documents: server.TextDocument[]): void {
	trace(conn, 'validateAllTextDocuments');
	let tracker = new server.ErrorMessageTracker();
	documents.forEach(document => {
		try {
			validateTextDocument(conn, document);
		} catch (err) {
			tracker.add(getErrorMessage(err, document));
		}
	});
}

export async function validateTextDocument(connection: server.IConnection, document: server.TextDocument) {
	trace(connection, 'start validateTextDocument');

	let uri = document.uri;

	// tslint can only validate files on disk
	if (Uri.parse(uri).scheme !== 'file') {
		return;
	}

	let settings = await settingsCache.get(connection, uri);
	trace(connection, 'validateTextDocument: settings fetched');

	if (settings && !settings.enable) {
		return;
	}

	trace(connection, 'validateTextDocument: about to load tslint library');
	if (!document2Library.has(document.uri)) {
		await loadLibrary(connection, document.uri);
	}
	trace(connection, 'validateTextDocument: loaded tslint library');

	if (!document2Library.has(document.uri)) {
		return;
	}

	document2Library.get(document.uri)!.then(async (library) => {
		if (!library) {
			return;
		}
		try {
			trace(connection, 'validateTextDocument: about to validate ' + document.uri);
			connection.sendNotification(StatusNotification.type, { state: Status.ok });
			let diagnostics = await doValidate(connection, library, document);
			connection.sendDiagnostics({ uri, diagnostics });
		} catch (err) {
			connection.window.showErrorMessage(getErrorMessage(err, document));
		}
	});
}

async function loadLibrary(connection: server.IConnection, docUri: string) {
	const tracer = (message: string) => trace(connection, message);
	function getGlobalPackageManagerPath(packageManager: string): string | undefined {
		trace(connection, `Begin - Resolve Global Package Manager Path for: ${packageManager}`);
	
		if (!globalPackageManagerPath.has(packageManager)) {
			let path: string | undefined;
			if (packageManager === 'npm') {
				path = server.Files.resolveGlobalNodePath(tracer);
			} else if (packageManager === 'yarn') {
				path = server.Files.resolveGlobalYarnPath(tracer);
			}
			globalPackageManagerPath.set(packageManager, path!);
		}
		trace(connection, `Done - Resolve Global Package Manager Path for: ${packageManager}`);
		return globalPackageManagerPath.get(packageManager);
	}
	trace(connection, 'loadLibrary for ' + docUri);

	let uri = Uri.parse(docUri);
	let promise: Thenable<string>;
	let settings = await settingsCache.get(connection, docUri);

	let getGlobalPath = () => getGlobalPackageManagerPath(settings.packageManager);

	if (uri.scheme === 'file') {
		let file = uri.fsPath;
		let directory = path.dirname(file);
		if (settings && settings.nodePath) {
			promise = server.Files.resolve('tslint', settings.nodePath, settings.nodePath!, tracer).then<string, string>(undefined, () => {
				return server.Files.resolve('tslint', getGlobalPath(), directory, tracer);
			});
		} else {
			promise = server.Files.resolve('tslint', undefined, directory, tracer).then<string, string>(undefined, () => {
				return promise = server.Files.resolve('tslint', getGlobalPath(), directory, tracer);
			});
		}
	} else {
		promise = server.Files.resolve('tslint', getGlobalPath(), undefined!, tracer); // cwd argument can be undefined
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
	trace(conn, 'start doValidate ' + document.uri);

	let uri = document.uri;

	let diagnostics: server.Diagnostic[] = [];
	resetRuleFailures(uri);

	let fsPath = server.Files.uriToFilePath(uri);
	if (!fsPath) {
		// tslint can only lint files on disk
		trace(conn, `No linting: file is not saved on disk`);
		return diagnostics;
	}

	let settings = await settingsCache.get(conn, uri);
	if (!settings) {
		trace(conn, 'No linting: settings could not be loaded');
		return diagnostics;
	}

	if (fileIsExcluded(settings, fsPath)) {
		trace(conn, `No linting: file ${fsPath} is excluded`);
		return diagnostics;
	}

	if (settings.workspaceFolderPath) {
		trace(conn, `Changed directory to ${settings.workspaceFolderPath}`);
		process.chdir(settings.workspaceFolderPath);
	}
	let contents = document.getText();
	let configFile = settings.configFile || null;

	let configuration: Configuration | undefined;
	trace(conn, 'validateTextDocument: about to getConfiguration');
	try {
		configuration = await getConfiguration(conn, uri, fsPath, library, configFile);
	} catch (err) {
		// this should not happen since we guard against incorrect configurations
		showConfigurationFailure(conn, err);
		trace(conn, `No linting: exception when getting tslint configuration for ${fsPath}, configFile= ${configFile}`);
		return diagnostics;
	}
	if (!configuration) {
		trace(conn, `No linting: no tslint configuration`);
		return diagnostics;
	}
	trace(conn, 'validateTextDocument: configuration fetched');

	if (isJsDocument(document) && !settings.jsEnable) {
		trace(conn, `No linting: a JS document, but js linting is disabled`);
		return diagnostics;
	}

	if (settings.validateWithDefaultConfig === false && configCache.configuration!.isDefaultLinterConfig) {
		trace(conn, `No linting: linting with default tslint configuration is disabled`);
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
		traceConfigurationFile(conn, configuration.linterConfiguration);
	}

	// tslint writes warnings using console.warn, capture these warnings and send them to the client
	let originalConsoleWarn = console.warn;
	let captureWarnings = (message?: any) => {
		conn.sendNotification(StatusNotification.type, { state: Status.warn });
		originalConsoleWarn(message);
	};
	console.warn = captureWarnings;

	try { // protect against tslint crashes
		let linter = getLinterFromLibrary(library);
		if (isTsLintVersion4(library)) {
			let tslint = new linter(options);
			trace(conn, `Linting: start linting with tslint > version 4`);
			tslint.lint(fsPath, contents, configuration.linterConfiguration);
			result = tslint.getResult();
			trace(conn, `Linting: ended linting`);
		}
		// support for linting js files is only available in tslint > 4.0
		else if (!isJsDocument(document)) {
			(<any>options).configuration = configuration.linterConfiguration;
			trace(conn, `Linting: with tslint < version 4`);
			let tslint = new (<any>linter)(fsPath, contents, options);
			result = tslint.lint();
			trace(conn, `Linting: ended linting`);
		} else {
			trace(conn, `No linting: JS linting not supported in tslint < version 4`);
			return diagnostics;
		}
	} catch (err) {
		console.warn = originalConsoleWarn;
		conn.console.info(getErrorMessage(err, document));
		conn.sendNotification(StatusNotification.type, { state: Status.error });
		trace(conn, `No linting: tslint exception while linting`);
		return diagnostics;
	}

	if (result.failures.length > 0) {
		filterProblemsForDocument(fsPath, result.failures).forEach(problem => {
			let diagnostic = makeDiagnostic(settings, problem);
			diagnostics.push(diagnostic);
			recordCodeAction(document, diagnostic, problem);
		});
	}
	trace(conn, 'doValidate: sending diagnostics: '+ result.failures.length);

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
		return minimatch(path, pattern, { dot: true });
	}


	if (settings.ignoreDefinitionFiles) {
		if (path.endsWith('.d.ts')) {
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

function showConfigurationFailure(conn: server.IConnection, err: any) {
	conn.console.info(getConfigurationFailureMessage(err));
	conn.sendNotification(StatusNotification.type, { state: Status.error });
}


async function getConfiguration(connection: server.IConnection, uri: string, filePath: string, library: any, configFileName: string | null): Promise<Configuration | undefined> {
	trace(connection, 'getConfiguration for' + uri);

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


function isTsLintVersion4(library) {
	let version = '1.0.0';
	try {
		version = library.Linter.VERSION;
	} catch (e) {
	}
	return !(semver.satisfies(version, "<= 3.x.x"));
}
function traceConfigurationFile(connection: server.IConnection, configuration: tslint.Configuration.IConfigurationFile | undefined) {
	if (!configuration) {
		trace(connection, "no tslint configuration");
		return;
	}
	trace(connection, "tslint configuration:", util.inspect(configuration, undefined, 4));
}


function getConfigurationFailureMessage(err: any): string {
	let errorMessage = `unknown error`;
	if (typeof err.message === 'string' || err.message instanceof String) {
		errorMessage = <string>err.message;
	}
	return `vscode-tslint: Cannot read tslint configuration - '${errorMessage}'`;

}

export function tslintConfigurationValid(
	connection: server.IConnection,
	documents: server.TextDocuments
): boolean {
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

