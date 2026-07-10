import { testSuite } from 'manten';

export default testSuite(({ describe }) => {
    describe('Gemini CLI', ({ runTestSuite }) => {
        runTestSuite(import('./utils.js'));
        runTestSuite(import('./service.js'));
    });
});
