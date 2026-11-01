import { ApiError, AiResponseError, AiUnavailableError } from '../../utils/errors.js';

/**
 * OpenAI-compatible chat completions provider. xAI's Grok API and Groq use
 * this protocol, so the same adapter serves both and any compatible endpoint.
 */
export function createChatProvider(config, logger) {
  const { apiKey, baseUrl, model, timeoutMs, maxOutputTokens, temperature, jsonMode, provider } = config.ai;

  return {
    name: provider,
    model,

    async complete({ system, user }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error('ai-timeout')), timeoutMs);
      const startedAt = Date.now();

      try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
            temperature,
            max_tokens: maxOutputTokens,
            ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
          }),
          signal: controller.signal,
        });

        const bodyText = await response.text();

        if (!response.ok) {
          logger.warn('AI provider returned an error status', {
            status: response.status,
            provider,
            latencyMs: Date.now() - startedAt,
          });
          throw new AiUnavailableError(
            response.status === 401 || response.status === 403
              ? 'The analysis provider rejected the configured API key.'
              : response.status === 429
                ? 'The analysis provider is rate limiting requests. Try again shortly.'
                : `The analysis provider returned HTTP ${response.status}.`,
            { status: response.status }
          );
        }

        let payload;
        try {
          payload = JSON.parse(bodyText);
        } catch {
          throw new AiResponseError('The analysis provider returned a non-JSON HTTP response.');
        }

        const content = payload?.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || !content.trim()) {
          throw new AiResponseError('The analysis provider returned an empty message.');
        }

        return {
          content,
          model: payload?.model || model,
          usage: payload?.usage ?? null,
        };
      } catch (error) {
        if (error instanceof ApiError) throw error;
        if (error?.name === 'AbortError' || controller.signal.aborted) {
          throw new AiUnavailableError('The analysis request timed out. Try again, or shorten the speech.', {
            timeoutMs,
          });
        }
        logger.warn('AI request failed', { provider, error: error.message });
        throw new AiUnavailableError('Could not reach the analysis provider. Check your network and API configuration.');
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
