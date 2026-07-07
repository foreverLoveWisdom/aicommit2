import { testSuite } from 'manten';

export default testSuite(({ describe }) => {
    describe('Claude Code', ({ runTestSuite }) => {
        runTestSuite(import('./utils.js'));
        runTestSuite(import('./service.js'));
    });
});
