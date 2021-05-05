import { exec } from '@actions/exec';
import * as core from '@actions/core';
import { getBooleanInput, atoiOrDefault, parseFloatOrDefault } from './utils';

interface Test {
	elapsed: number
	output: string[]
}

const optShowStdOut = getBooleanInput('show-stdout'),
	optShowPackageOut = getBooleanInput('show-package-output'),
	optShowPassedTests = getBooleanInput('show-passed-tests'),
	optLongRunningTestDuration = atoiOrDefault(core.getInput('show-long-running-tests'), 15);

const testOutput: Map<string, Test> = new Map<string, Test>(),
	failed: string[] = [];
let totalRun = 0;

function process(line: string) {
	try {
		const parsed = JSON.parse(line);

		if (!optShowPackageOut && !parsed.Test)
			return;

		const key = `${parsed.Package}${parsed.Test ? '/' + parsed.Test : ''}`;
		let results = testOutput.get(key);

		if (!results)
			results = { elapsed: 0, output: [] };

		let elapsed;
		switch (parsed.Action) {
		case 'output':
			results.output.push(parsed.Output);
			break;
		case 'fail':
			elapsed = parseFloatOrDefault(parsed.Elapsed);
			totalRun++;
			failed.push(key);
			results.elapsed = elapsed;

			if (optLongRunningTestDuration !== -1 && elapsed >= optLongRunningTestDuration)
				core.info(`\u001b[33m${key} took ${elapsed}s to fail`);

			if (!optShowStdOut)
				core.info(`\u001b[31m${key} failed in ${elapsed}s`);
			break;
		case 'pass':
			elapsed = parseFloatOrDefault(parsed.Elapsed);
			totalRun++;
			results.elapsed = elapsed;

			if (optLongRunningTestDuration !== -1 && elapsed >= optLongRunningTestDuration)
				core.info(`\u001b[33m${key} took ${elapsed}s to pass`);

			if (!optShowStdOut && optShowPassedTests)
				core.info(`\u001b[32m${key} passed in ${elapsed}s`);
			break;
		}

		testOutput.set(key, results);
	} catch (ex) {
		core.debug(`failed to process line "${line}": ${ex}`);
	}
}

const newLineReg = new RegExp(/\r?\n/);
let buf: string = '';
function stdout(data: Uint8Array) {
	let result: RegExpExecArray | null;
	buf += data.toString();
	while ((result = newLineReg.exec(buf)) !== null) {
		const line = buf.slice(0, result.index)
		buf = buf.slice(result.index + result[0].length);
		process(line);
	}
}

export async function runTests() {
	const args = ['test', '-json', '-v'].concat(
		core.getInput('args').split(';').map((a) => a.trim())
	);

	args.push(core.getInput('package'));
	core.info(`Running test as "go ${args.join(' ')}"`);

	await exec('go', args, {
		ignoreReturnCode: true,
		silent: !optShowStdOut,
		listeners: {
			stdout,
		},
	});

	if (buf.length !== 0) process(buf);
	if (failed.length === 0) return;

	core.warning

	core.setFailed(`${failed.length}/${totalRun} tests failed`);
	failed.forEach((k) => {
		const results = testOutput.get(k);

		if (!results || !results?.output?.length) return;

		core.startGroup(`test ${k} failed in ${results.elapsed}s`)
		core.error([
			`test ${k} failed in ${results.elapsed}s:`,
			results.output.join(''),
		].join('\n'));
		core.endGroup();
	});
}
