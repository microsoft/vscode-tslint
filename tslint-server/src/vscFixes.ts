export interface VSCFix {
	tsLintMessage: string;
	autoFix(codeBefore: string): string;
	overrideTSLintFix: boolean; //This for cases where tslint does not have all information, i.e.: tabulation/space replacement should be linked to the configguration of IDE
}
export let vscFixes: VSCFix[] = [];

/**
 * AutoFix rules are all in this file
 * each autoFix should support the interface TsLintAutoFix and added in this.tsLintAutoFixes
 *
 * the key to map tsLint problem and autofix rules is => tsLintMessage
 */
let vscFix: VSCFix;


vscFix = {
	tsLintMessage: "trailing whitespace",
	autoFix: (codeBefore: string): string => {
		let codeAfter = "";
		return codeAfter;
	},
	overrideTSLintFix: false
};
this.vscFixes.push(vscFix);

vscFix = {
	tsLintMessage: "file should end with a newline",
	autoFix: (codeBefore: string): string => {
		let codeAfter = "\n";
		return codeAfter;
	},
	overrideTSLintFix: false
};
this.vscFixes.push(vscFix);

vscFix = {
	tsLintMessage: "Comment must start with a space",
	autoFix: (codeBefore: string): string => {
		let codeAfter = " " + codeBefore;
		return codeAfter;
	},
	overrideTSLintFix: false
};
this.vscFixes.push(vscFix);