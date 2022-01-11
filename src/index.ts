import * as core from '@actions/core';
import { runTests } from './run';

(async () => {
	try {
		await runTests();
	} catch (ex) {
		core.setFailed(`failed to run action: ${ex}`);
	}
})()