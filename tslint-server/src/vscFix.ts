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
	tsLintMessage: "missing whitespace",
	autoFix: (codeBefore: string): string => {
		let codeAfter = " " + codeBefore;
		return codeAfter;
	},
	overrideTSLintFix: false
};
this.vscFixes.push(vscFix);

vscFix = {
	tsLintMessage: "Missing semicolon",
	autoFix: (codeBefore: string): string => {
		let codeAfter = codeBefore + ";";
		return codeAfter;
	},
	overrideTSLintFix: false
};
this.vscFixes.push(vscFix);

vscFix = {
	tsLintMessage: "missing trailing comma",
	autoFix: (codeBefore: string): string => {
		let codeAfter = codeBefore + ",";
		return codeAfter;
	},
	overrideTSLintFix: false
};
this.vscFixes.push(vscFix);

vscFix = {
	tsLintMessage: "' should be \"",
	autoFix: (codeBefore: string): string => {
		let codeAfter = "\"" + codeBefore.slice(1, codeBefore.length - 1) + "\"";
		return codeAfter;
	},
	overrideTSLintFix: false
};
this.vscFixes.push(vscFix);

vscFix = {
	tsLintMessage: "\" should be '",
	autoFix: (codeBefore: string): string => {
		let codeAfter = "'" + codeBefore.slice(1, codeBefore.length - 1) + "'";
		return codeAfter;
	},
	overrideTSLintFix: false
};
this.vscFixes.push(vscFix);

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
	tsLintMessage: "tab indentation expected",
	autoFix: (codeBefore: string): string => {
		let howManySpaces = codeBefore.length;
		let codeAfter = Array(Math.round(howManySpaces / 4) + 1).join(" ");
		return codeAfter;
	},
	overrideTSLintFix: false
};
this.vscFixes.push(vscFix);

vscFix = {
	tsLintMessage: "space indentation expected",
	autoFix: (codeBefore: string): string => {
		let howManyTabs = codeBefore.length;
		let codeAfter = Array(howManyTabs + 1).join("	");
		return codeAfter;
	},
	overrideTSLintFix: false
};
this.vscFixes.push(vscFix);

vscFix = {
	tsLintMessage: "Forbidden 'var' keyword, use 'let' or 'const' instead",
	autoFix: (codeBefore: string): string => {
		let codeAfter = "let";
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
	tsLintMessage: "Forbidden 'var' keyword, use 'let' or 'const' instead",
	autoFix: (codeBefore: string): string => {
		let codeAfter = "let";
		return codeAfter;
	},
	overrideTSLintFix: false
};
this.vscFixes.push(vscFix);

vscFix = {
	tsLintMessage: "== should be ===",
	autoFix: (codeBefore: string): string => {
		let codeAfter = "===";
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