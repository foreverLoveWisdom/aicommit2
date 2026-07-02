import chalk from 'chalk';
import { execa } from 'execa';
import { ReactiveListChoice } from 'inquirer-reactive-list-prompt';
import { Observable, catchError, concatMap, from, map } from 'rxjs';
import { fromPromise } from 'rxjs/internal/observable/innerFrom';

import { AIResponse, AIService, AIServiceError, AIServiceParams } from './ai.service.js';
import { buildClaudeCodeArgs, classifyClaudeCodeError, normalizeClaudeCodeModel, parseClaudeCodeResponse } from './claude-code.utils.js';
import { RequestType, logAIComplete, logAIError, logAIPayload, logAIPrompt, logAIRequest, logAIResponse } from '../../utils/ai-log.js';
import { codeReviewPrompt, generatePrompt } from '../../utils/prompt.js';

export class ClaudeCodeService extends AIService {
    constructor(protected readonly params: AIServiceParams) {
        super(params);
        this.colors = {
            primary: '#D97757',
            secondary: '#FFF',
        };
        this.serviceName = chalk.bgHex(this.colors.primary).hex(this.colors.secondary).bold(`[Claude Code${this.formatModelSuffix()}]`);
        this.errorPrefix = chalk.red.bold(`[Claude Code${this.formatModelSuffix()}]`);
    }

    protected getServiceSpecificErrorMessage(error: AIServiceError): string | null {
        if (error.code === 'CLI_NOT_INSTALLED') {
            return 'Claude Code CLI not found. Install: npm install -g @anthropic-ai/claude-code';
        }
        if (error.code === 'AUTH_FAILED') {
            return 'Claude Code is not authenticated. Run `claude` once and log in, then retry.';
        }
        if (error.code === 'TIMEOUT') {
            return `Claude Code CLI timed out after ${this.params.config.timeout}ms. Increase CLAUDE_CODE.timeout in your config.`;
        }
        if (error.code === 'NO_CONTENT') {
            return 'Claude Code returned no content.';
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
        const model = normalizeClaudeCodeModel(configuredModel);
        const { logging, timeout } = this.params.config;
        const args = buildClaudeCodeArgs(model, systemPrompt);

        const url = 'claude-code://cli';
        const headers = {
            Authorization: 'Claude Code CLI session',
        };
        const payload = {
            model,
            args,
        };

        logAIRequest(diff, requestType, 'Claude Code', model, url, headers, logging);
        logAIPrompt(diff, requestType, 'Claude Code', systemPrompt, userPrompt, logging);
        logAIPayload(diff, requestType, 'Claude Code', payload, logging);

        const startTime = Date.now();
        try {
            const { stdout } = await execa('claude', args, {
                input: userPrompt,
                timeout,
            });
            const response = parseClaudeCodeResponse(stdout);

            if (response.isError) {
                throw new Error(response.result || 'Claude Code CLI reported an error');
            }
            if (!response.result) {
                const noContentError = new Error('No content in Claude Code response') as AIServiceError;
                noContentError.code = 'NO_CONTENT';
                throw noContentError;
            }

            const duration = Date.now() - startTime;
            logAIResponse(diff, requestType, 'Claude Code', response, logging);
            logAIComplete(diff, requestType, 'Claude Code', duration, response.result, logging);
            return response.result;
        } catch (error) {
            const aiError = classifyClaudeCodeError(error);
            logAIError(diff, requestType, 'Claude Code', aiError, logging);
            throw aiError;
        }
    }
}
