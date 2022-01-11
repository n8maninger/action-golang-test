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
	panicked: Set<string> = new Set<string>();
let errout: string;
let totalRun = 0;

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

function process(line: string) {
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
			if (results.output.indexOf('panic: runtime error:') == 0)
				panicked.add(key);

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
		core.error(`failed to process line "${line}": ${ex}`);
	}
}

function stderr(data: Uint8Array) {
	if (!data)
		return;

	errout += data.toString();
}

export async function runTests() {
	const args = ['test', '-json', '-v'].concat((core.getInput('args') || '')
			.split(';').map(a => a.trim()).filter(a => a.length > 0).filter(a => a.length > 0));

	args.push(core.getInput('package'));
	core.info(`Running test as "go ${args.join(' ')}"`);

	const exit = await exec('go', args, {
		ignoreReturnCode: true,
		silent: !optShowStdOut,
		listeners: {
			// cannot use stdline or errline, since Go's CLI tools do not behave.
			stdout,
			stderr,
		},
	});

	if (buf.length !== 0)
		process(buf);

	if (exit !== 0) {
		errout = errout
			.split(/\r?\n/)
			.filter(l => l.indexOf('go: downloading ') === -1)
			.join('\n');

		if (errout.length > 0) {
			core.startGroup('stderr')
			core.warning(errout);
			core.endGroup();
		}
	}

	if (panicked.size > 0) {
		core.setFailed(`${panicked.size}/${totalRun} tests panicked`);
		panicked.forEach(k => {
			const results = testOutput.get(k);

			if (!results || !results?.output?.length) return;

			core.startGroup(`test ${k} panicked in ${results.elapsed}s`)
			core.error([
				`test ${k} panicked in ${results.elapsed}s:`,
				results.output.join(''),
			].join('\n'));
			core.endGroup();
		});
	}

	if (failed.length > 0) {
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

	// if no tests failed or panicked, but Go test still returned non-zero,
	// then something went wrong.
	if ((!panicked.size || !failed.length) && exit !== 0) {
		core.setFailed('Go test failed');
	}
}
