import * as core from '@actions/core';
import { run as setupGo } from 'setup-go/src/main';
import { runTests } from './run';
import { getBooleanInput } from './utils';

(async () => {
	try {
		if (!getBooleanInput('skip-go-install')) {
			await setupGo();
			core.info(`Set up Go`);
		}

		await runTests();
	} catch (ex) {
		core.setFailed(`failed to run action: ${ex}`);
	}
})()