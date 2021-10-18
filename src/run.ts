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
	failed: string[] = [],
	errout: string[] = [];
let totalRun = 0;

function stdline(line: string) {
	try {
		const parsed = JSON.parse(line);

		if (!optShowPackageOut && !parsed.Test)
			return;

		const key = `${parsed.Package}${parsed.Test ? '/' + parsed.Test : ''}`;
		let results = testOutput.get(key);

		if (!results)
			results = { elapsed: 0, output: [] };

		switch (parsed.Action) {
		case 'output':
			results.output.push(parsed.Output);
			break;
		case 'fail':
			totalRun++;
			results.elapsed = parseFloatOrDefault(parsed.Elapsed);
			failed.push(key);

			if (optLongRunningTestDuration !== -1 && results.elapsed >= optLongRunningTestDuration)
				core.info(`\u001b[33m${key} took ${results.elapsed}s to fail`);

			if (!optShowStdOut)
				core.info(`\u001b[31m${key} failed in ${results.elapsed}s`);
			break;
		case 'pass':
			totalRun++;
			results.elapsed = parseFloatOrDefault(parsed.Elapsed);

			if (optLongRunningTestDuration !== -1 && results.elapsed >= optLongRunningTestDuration)
				core.info(`\u001b[33m${key} took ${results.elapsed}s to pass`);

			if (!optShowStdOut && optShowPassedTests)
				core.info(`\u001b[32m${key} passed in ${results.elapsed}s`);
			break;
		}

		testOutput.set(key, results);
	} catch (ex) {
		core.debug(`failed to process line "${line}": ${ex}`);
	}
}

function errline(line: string) {
	// ignore go module output
	if (line.indexOf('go: downloading') === 0)
		return;

	errout.push(line);
}

export async function runTests() {
	const args = ['test', '-json', '-v'].concat(
		core.getInput('args').split(';').map((a) => a.trim())
	);

	args.push(core.getInput('package'));
	core.info(`Running test as "go ${args.join(' ')}"`);

	const exit = await exec('go', args, {
		ignoreReturnCode: true,
		silent: !optShowStdOut,
		listeners: {
			stdline,
			errline,
		},
	});

	if (exit !== 0) {
		core.startGroup('stderr')
		if (errout.length > 0)
			core.error(errout.join('\n'));
		else
			core.setFailed('Tests failed');
		core.endGroup();
	} else if (failed.length === 0) return;

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
