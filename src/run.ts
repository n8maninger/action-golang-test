import { exec } from '@actions/exec';
import * as core from '@actions/core';
import { atoiOrDefault, parseFloatOrDefault } from './utils';

interface Test {
	elapsed: number
	output: string[]
}

const optShowStdOut = core.getBooleanInput('show-stdout'),
	optShowPackageOut = core.getBooleanInput('show-package-output'),
	optShowPassedTests = core.getBooleanInput('show-passed-tests'),
	optLongRunningTestDuration = atoiOrDefault(core.getInput('show-long-running-tests'), 15);

const testOutput: Map<string, Test> = new Map<string, Test>(),
	failed: Set<string> = new Set<string>(),
	panicked: Set<string> = new Set<string>(),
	errored: Set<string> = new Set<string>();
let errout: string = '',
	stdout: string = '';
let totalRun = 0;

const newLineReg = new RegExp(/\r?\n/);
let buf: string = '';
function parseStdout(data: Uint8Array) {
	if (!data)
		return;

	let result: RegExpExecArray | null;
	stdout += data.toString();
	buf += data.toString();
	while ((result = newLineReg.exec(buf)) !== null) {
		const line = buf.slice(0, result.index)
		buf = buf.slice(result.index + result[0].length);
		process(line);
	}
}

function parseStdErr(data: Uint8Array) {
	if (!data)
		return;

	errout += data.toString();
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
			if (parsed.Output.indexOf('panic: runtime error:') == 0)
				panicked.add(key);
			else if (parsed.Output.indexOf('==ERROR:') != -1)
				errored.add(key);

			results.output.push(parsed.Output);
			break;
		case 'fail':
			totalRun++;
			results.elapsed = parseFloatOrDefault(parsed.Elapsed);
			failed.add(key);

			if (optLongRunningTestDuration !== -1 && results.elapsed >= optLongRunningTestDuration)
				core.info(`\u001b[33m${key} took ${results.elapsed}s to fail`);

			if (!optShowStdOut)
				core.info(`\u001b[31m${key} failed in ${results.elapsed}s`);
			break;
		case 'pass':
			totalRun++;
			results.elapsed = parseFloatOrDefault(parsed.Elapsed);

			if (optLongRunningTestDuration !== -1 && results.elapsed >= optLongRunningTestDuration)
				core.info(`\u001b[33m${key} passed in ${results.elapsed}s`);
			else if (!optShowStdOut && optShowPassedTests)
				core.info(`\u001b[32m${key} passed in ${results.elapsed}s`);
			break;
		}

		testOutput.set(key, results);
	} catch (ex) {
		core.error(`failed to process line "${line}": ${ex}`);
	}
}

export async function runTests() {
	const args = ['test', '-json', '-v'].concat((core.getInput('args') || '')
			.split(';').map(a => a.trim()).filter(a => a.length > 0).filter(a => a.length > 0)),
		start = Date.now();

	args.push(core.getInput('package'));
	core.info(`Running test as "go ${args.join(' ')}"`);

	const exit = await exec('go', args, {
		ignoreReturnCode: true,
		silent: !optShowStdOut && !core.isDebug(),
		listeners: {
			// cannot use stdline or errline because Go's CLI tools do not behave.
			stdout: parseStdout,
			stderr: parseStdErr,
		},
	});

	if (buf.length !== 0)
		process(buf);

	// If go test returns a non-zero exit code with no failed tests, something
	// went wrong.
	if (exit !== 0 && panicked.size === 0 && failed.size === 0 && errored.size === 0) {
		core.setFailed(`go test failed with exit code ${exit}, but no tests failed. Check output for more details`);
		core.startGroup('stdout');
		core.info(stdout);
		core.endGroup();

		core.startGroup('stderr');
		core.info(errout);
		core.endGroup();
		return
	} 
	
	// if something was written to stderr, print it
	// note: this includes Go package downloads, so it's not always an error
	if (errout.length > 0) {
		core.startGroup('stderr');
		core.info(errout);
		core.endGroup();
	}

	// print any panicked tests
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

	// print any errored tests, includes tests with build errors
	if (errored.size > 0) {
		core.setFailed(`${errored.size}/${totalRun} tests errored`);
		errored.forEach((k) => {
			const results = testOutput.get(k);

			if (!results || !results?.output?.length) return;

			core.startGroup(`test ${k} errored in ${results.elapsed}s`)
			core.error([
				`test ${k} errored in ${results.elapsed}s:`,
				results.output.join(''),
			].join('\n'));
			core.endGroup();
		});
	}

	// print any failed tests
	if (failed.size > 0) {
		core.setFailed(`${failed.size}/${totalRun} tests failed`);
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

	const passed = totalRun - failed.size - errored.size - panicked.size,
		totalElapsed = (Date.now() - start) / 1000;
	core.info(`\u001b[32m${passed}/${totalRun} tests passed in ${totalElapsed.toFixed(2)}s`);
}
