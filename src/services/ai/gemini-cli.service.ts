import chalk from 'chalk';
import { execa } from 'execa';
import { ReactiveListChoice } from 'inquirer-reactive-list-prompt';
import { Observable, catchError, concatMap, from, map } from 'rxjs';
import { fromPromise } from 'rxjs/internal/observable/innerFrom';

import { AIResponse, AIService, AIServiceError, AIServiceParams } from './ai.service.js';
import {
    buildGeminiCliArgs,
    buildGeminiCliPrompt,
    classifyGeminiCliError,
    normalizeGeminiCliModel,
    parseGeminiCliResponse,
} from './gemini-cli.utils.js';
import { RequestType, logAIComplete, logAIError, logAIPayload, logAIPrompt, logAIRequest, logAIResponse } from '../../utils/ai-log.js';
import { codeReviewPrompt, generatePrompt } from '../../utils/prompt.js';

export class GeminiCliService extends AIService {
    constructor(protected readonly params: AIServiceParams) {
        super(params);
        this.colors = {
            primary: '#4796E3',
            secondary: '#FFF',
        };
        this.serviceName = chalk.bgHex(this.colors.primary).hex(this.colors.secondary).bold(`[Gemini CLI${this.formatModelSuffix()}]`);
        this.errorPrefix = chalk.red.bold(`[Gemini CLI${this.formatModelSuffix()}]`);
    }

    protected getServiceSpecificErrorMessage(error: AIServiceError): string | null {
        if (error.code === 'CLI_NOT_INSTALLED') {
            return 'Gemini CLI not found. Install: npm install -g @google/gemini-cli';
        }
        if (error.code === 'AUTH_FAILED') {
            return 'Gemini CLI is not authenticated. Run `gemini` once and log in, then retry.';
        }
        if (error.code === 'TIMEOUT') {
            return `Gemini CLI timed out after ${this.params.config.timeout}ms. Increase GEMINI_CLI.timeout in your config.`;
        }
        if (error.code === 'NO_CONTENT') {
            return 'Gemini CLI returned no content.';
        }
        return null;
    }

    generateCommitMessage$(): Observable<ReactiveListChoice> {
        return fromPromise(this.generateMessage('commit')).pipe(
            concatMap(messages => from(messages)),
            map(this.formatAsChoice),
            catchError(this.handleError$)
        );
    }

    generateCodeReview$(): Observable<ReactiveListChoice> {
        return fromPromise(this.generateMessage('review')).pipe(
            concatMap(messages => from(messages)),
            map(this.formatCodeReviewAsChoice),
            catchError(this.handleError$)
        );
    }

    private async generateMessage(requestType: 'commit' | 'review'): Promise<AIResponse[]> {
        const diff = this.params.stagedDiff.diff;
        const { generate, type } = this.params.config;
        const promptOptions = this.buildPromptOptions();
        const generatedSystemPrompt = requestType === 'review' ? codeReviewPrompt(promptOptions) : generatePrompt(promptOptions);
        const userPrompt = this.buildUserPrompt(diff, requestType);
        const content = await this.makeRequest(generatedSystemPrompt, userPrompt, requestType, diff);

        if (requestType === 'review') {
            return this.parseCodeReview(content);
        }
        return this.parseMessage(content, type, generate);
    }

    private async makeRequest(systemPrompt: string, userPrompt: string, requestType: RequestType, diff: string): Promise<string> {
        const configuredModel = Array.isArray(this.params.config.model) ? this.params.config.model[0] : this.params.config.model;
        const model = normalizeGeminiCliModel(configuredModel);
        const { logging, timeout } = this.params.config;
        const args = buildGeminiCliArgs(model);
        const input = buildGeminiCliPrompt(systemPrompt, userPrompt);

        const displayModel = model || 'default';
        const url = 'gemini-cli://cli';
        const headers = {
            Authorization: 'Gemini CLI session',
        };
        const payload = {
            model: displayModel,
            args,
        };

        logAIRequest(diff, requestType, 'Gemini CLI', displayModel, url, headers, logging);
        logAIPrompt(diff, requestType, 'Gemini CLI', systemPrompt, userPrompt, logging);
        logAIPayload(diff, requestType, 'Gemini CLI', payload, logging);

        const startTime = Date.now();
        try {
            const { stdout } = await execa('gemini', args, {
                input,
                timeout,
            });
            const response = parseGeminiCliResponse(stdout);

            if (response.isError) {
                throw new Error(response.result || 'Gemini CLI reported an error');
            }
            if (!response.result) {
                const noContentError = new Error('No content in Gemini CLI response') as AIServiceError;
                noContentError.code = 'NO_CONTENT';
                throw noContentError;
            }

            const duration = Date.now() - startTime;
            logAIResponse(diff, requestType, 'Gemini CLI', response, logging);
            logAIComplete(diff, requestType, 'Gemini CLI', duration, response.result, logging);
            return response.result;
        } catch (error) {
            const aiError = classifyGeminiCliError(error);
            logAIError(diff, requestType, 'Gemini CLI', aiError, logging);
            throw aiError;
        }
    }
}
