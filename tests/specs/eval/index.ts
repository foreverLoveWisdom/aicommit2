import { testSuite } from 'manten';

export default testSuite(({ describe }) => {
    describe('Eval', ({ runTestSuite }) => {
        runTestSuite(import('./scorers.js'));
    });
});
