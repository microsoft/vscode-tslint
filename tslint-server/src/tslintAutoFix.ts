export interface TsLintAutoFix {
	tsLintCode: string;
	tsLintMessage: string;
	autoFixMessage: string;
	autoFix(codeBefore: string): string;
}
export let tsLintAutoFixes: TsLintAutoFix[] = [];


let autoFix: TsLintAutoFix;
autoFix = {
	tsLintCode: "one-line",
	tsLintMessage: "missing whitespace",
	autoFixMessage: "Add a whitespace",
	autoFix: (codeBefore: string): string => {
		let codeAfter = " " + codeBefore;
		return codeAfter;
	}
};
this.tsLintAutoFixes.push(autoFix);

autoFix = {
	tsLintCode: "one-line",
	tsLintMessage: "missing semicolon",
	autoFixMessage: "Add semicolon",
	autoFix: (codeBefore: string): string => {
		let codeAfter = codeBefore + ";";
		return codeAfter;
	}
};
this.tsLintAutoFixes.push(autoFix);

autoFix = {
	tsLintCode: "quotemark",
	tsLintMessage: "' should be \"",
	autoFixMessage: "Replace ' by \" ",
	autoFix: (codeBefore: string): string => {
		let codeAfter = "\"" + codeBefore.slice(1, codeBefore.length - 1) + "\"";
		return codeAfter;
	}
};
this.tsLintAutoFixes.push(autoFix);

autoFix = {
	tsLintCode: "no-trailing-whitespace",
	tsLintMessage: "trailing whitespace",
	autoFixMessage: "Trim whitespace",
	autoFix: (codeBefore: string): string => {
		let codeAfter = "";
		return codeAfter;
	}
};
this.tsLintAutoFixes.push(autoFix);

autoFix = {
	tsLintCode: "no-trailing-whitespace",
	tsLintMessage: "trailing whitespace",
	autoFixMessage: "Trim whitespace",
	autoFix: (codeBefore: string): string => {
		let codeAfter = "";
		return codeAfter;
	}
};
this.tsLintAutoFixes.push(autoFix);
