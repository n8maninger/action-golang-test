import * as core from '@actions/core';

/**
 * getBooleanInput
 * taken from PR https://github.com/actions/toolkit/pull/725 while
 * waiting for merge
 */
 export function getBooleanInput(name: string, options?: core.InputOptions): boolean {
	const trueValue = ['true', 'True', 'TRUE']
	const falseValue = ['false', 'False', 'FALSE']
	const val = core.getInput(name, options)
	if (trueValue.includes(val)) return true
	if (falseValue.includes(val)) return false
	throw new TypeError(
		`Input does not meet YAML 1.2 "Core Schema" specification: ${name}\n` +
		`Support boolean input list: \`true | True | TRUE | false | False | FALSE\``
	)
}

export function atoiOrDefault(s, def = 0) {
	const n = parseInt(s, 10);

	if (!isFinite(n) || isNaN(n))
		return def;

	return n;
}

export function parseFloatOrDefault(s, def = 0) {
	const n = parseFloat(s);

	if (!isFinite(n) || isNaN(n))
		return def;

	return n;
}