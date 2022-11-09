import { exec } from '@actions/exec';
import * as core from '@actions/core';
import { env } from 'process';
import path from 'path';
import { atoiOrDefault, parseFloatOrDefault } from './utils';

interface TestAnnotation {
	file: string
	line: number
	text: string
}
interface Test {
	package: string
	elapsed: number
	output: string[]
}

type Nullable<T> = T | null;

const optShowStdOut = core.getBooleanInput('show-stdout'),
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
		processOutput(line);
	}
}

async function getRelativeFilePath(goPkg: string, file: string) : Promise<string> {
	core.debug(`getting package path for ${goPkg}/${file}...`)
	let packagePath = '',
		errorMsg = '';
	const exitCode = await exec('go', ['list', '-f', '{{.Dir}}', goPkg], {
		silent: true,
		ignoreReturnCode: true,
		listeners: {
			stdout: (data: Uint8Array) => {
				packagePath += data.toString();
			},
			stderr: (data: Uint8Array) => {
				errorMsg += data.toString();
			}
		}
	});

	packagePath = packagePath.trim();
	errorMsg = errorMsg.trim();

	if (exitCode !== 0)
		throw new Error(`failed to get package path for ${goPkg}: ${errorMsg}`);
	else if (packagePath === '')
		throw new Error(`failed to get package path for ${goPkg} (empty output)`);
	core.debug(`package path for ${goPkg} is ${packagePath}`);
	const workspace = env['GITHUB_WORKSPACE'];
	let full = path.join(packagePath, file);
	core.debug(`absolute path for ${goPkg}/${file} is ${full}`);
	if (workspace && full.startsWith(workspace)) full = full.slice(workspace.length + 1);
	if (full.startsWith('/')) full = full.slice(1);
	core.debug(`relative path for ${goPkg}/${file} is ${full}`);
	return full;
}

function parseStdErr(data: Uint8Array) {
	if (!data)
		return;

	errout += data.toString();
}

function processOutput(line: string) {
	try {
		const parsed = JSON.parse(line),
			key = `${parsed.Package}${parsed.Test ? '/' + parsed.Test : ''}`;
		let results = testOutput.get(key);

		if (!results)
			results = { package: parsed.Package, elapsed: 0, output: [] };

		switch (parsed.Action) {
		case 'output':
			if (parsed.Output.indexOf('panic: runtime error:') == 0)
				panicked.add(key);
			else if (parsed.Output.indexOf('==ERROR:') !== -1)
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

function processAnnotations(output: string[]) : TestAnnotation[] {
	const goFileRegex = /([a-z_0-9]+.go)\:([0-9]+)/,
		annotations: TestAnnotation[] = [];
	let current: Nullable<TestAnnotation> = null;
	for (const line of output) {
		const normalized = line.trim();
		if (normalized.startsWith('=== RUN') || normalized.startsWith('--- FAIL')) // ignore go test output
			continue;
		else if (line.startsWith('panic:')) { // panics must be handled separately
			break;
		}
		const match = normalized.match(goFileRegex);
		if (match) { // if the output matches, create a new annotation
			if (current) annotations.push(current); // push the current annotation

			current = {
				file: match[1],
				line: parseInt(match[2]),
				text: line
			}
			continue;
		}

		// append the line to the current annotation
		if (current) current.text += line;
	}

	// push the last annotation
	if (current) annotations.push(current);
	return annotations.map(a => ({ ...a, text: a.text.trim()}));
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
		processOutput(buf);

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
	// note: this can include Go package downloads, so it's not always an error
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

			core.startGroup(`Test ${k} output`)
			core.error(`Test ${k} panicked in ${results.elapsed}s:\n`+results.output.join(''));
			core.endGroup();
		});
	}

	// print any errored tests, includes tests with build errors
	if (errored.size > 0) {
		core.setFailed(`${errored.size}/${totalRun} tests errored`);
		errored.forEach((k) => {
			const results = testOutput.get(k);

			if (!results || !results?.output?.length) return;

			core.startGroup(`Test ${k} output`)
			core.error(`Test ${k} errored in ${results.elapsed}s:\n`+results.output.join(''));
			core.endGroup();
		});
	}

	// print any failed tests
	if (failed.size > 0) {
		core.setFailed(`${failed.size}/${totalRun} tests failed`);
		for (const k of failed) {
			const results = testOutput.get(k);

			if (!results || !results?.output?.length) return;

			core.startGroup(`Test ${k} output`)
			// add file annotations
			const annotations = processAnnotations(results.output);
			for (const a of annotations) {
				try {
					core.error(a.text, {
						title: `Test ${k} failed in ${results.elapsed}s`,
						file: await getRelativeFilePath(results.package, a.file),
						startLine: a.line,
					});
				} catch (ex) {
					core.error(`Failed to get relative file path for ${a.file}: ${ex}`);
					continue
				}
			}
			// log the raw output
			core.info(results.output.join(''));
			core.endGroup();
		}
	}

	const passed = totalRun - failed.size - errored.size - panicked.size,
		totalElapsed = (Date.now() - start) / 1000;
	core.info(`\u001b[32m${passed}/${totalRun} tests passed in ${totalElapsed.toFixed(2)}s`);
}
