import * as tslint from 'tslint'; // this is a dev dependency only
import * as server from 'vscode-languageserver';
import { createVscFixForRuleFailure, TSLintAutofixEdit } from './fixer';
import { CodeActionParams } from 'vscode-languageserver';
import { settingsCache } from './settings';

export interface AutoFix {
	label: string;
	documentVersion: number;
	problem: tslint.RuleFailure;
	edits: TSLintAutofixEdit[];
}

export interface AllFixesParams {
	textDocument: server.TextDocumentIdentifier;
	isOnSave: boolean;
}

export interface AllFixesResult {
	documentVersion: number;
	edits: server.TextEdit[];
}

export namespace AllFixesRequest {
	export const type = new server.RequestType<AllFixesParams, AllFixesResult, void, void>('textDocument/tslint/allFixes');
}

//let configFileWatchers: Map<string, fs.FSWatcher> = new Map();

let codeFixActions = new Map<string, Map<string, tslint.RuleFailure>>();
let codeDisableRuleActions = new Map<string, Map<string, tslint.RuleFailure>>();

export function resetRuleFailures(uri: string): void {
	delete codeFixActions[uri];
	delete codeDisableRuleActions[uri];
}

export function recordCodeAction(document: server.TextDocument, diagnostic: server.Diagnostic, problem: tslint.RuleFailure): void {
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

export function onCodeAction(params: CodeActionParams): server.Command[] {
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
}

export async function onAllFixesRequest(connection: server.IConnection, params: AllFixesParams): Promise<AllFixesResult | undefined> {
	let result: AllFixesResult | undefined = undefined;
	let uri = params.textDocument.uri;
	let isOnSave = params.isOnSave;
	let documentFixes = codeFixActions[uri];
	let documentVersion: number = -1;
	let settings = await settingsCache.get(connection, uri);

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

function convertReplacementToAutoFix(document: server.TextDocument, repl: tslint.Replacement): TSLintAutofixEdit {
	let start: server.Position = document.positionAt(repl.start);
	let end: server.Position = document.positionAt(repl.end);
	return {
		range: [start, end],
		text: repl.text,
	};
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
		label: `Disable rule "${problem.getRuleName()}" for this line`,
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

function concatenateEdits(fixes: AutoFix[]): server.TextEdit[] {
	let textEdits: server.TextEdit[] = [];
	fixes.forEach(each => {
		textEdits = textEdits.concat(createTextEdit(each));
	});
	return textEdits;
}

function computeKey(diagnostic: server.Diagnostic): string {
	let range = diagnostic.range;
	return `[${range.start.line},${range.start.character},${range.end.line},${range.end.character}]-${diagnostic.code}`;
}

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