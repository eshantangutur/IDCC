import { publicAiStatus } from '../../config.js';
import { buildAnalysisPrompt, buildRepairPrompt } from './prompt.js';
import { normalizeAnalysis, parseJsonLoose } from './normalize.js';
import { createChatProvider } from './provider.js';
import { generateDemoAnalysis } from './demo.js';

/**
 * Analysis service. Selects the live provider when credentials exist and
 * falls back to the clearly-labelled local heuristic demo analyser otherwise.
 */
export function createAiService({ config, logger }) {
  const provider = config.ai.demoMode ? null : createChatProvider(config, logger);

  async function analyze({ formatSpec, resolution, sideLabel, speechType, content }) {
    const startedAt = Date.now();

    if (!provider) {
      const raw = generateDemoAnalysis({ formatSpec, resolution, sideLabel, speechType, content });
      const analysis = normalizeAnalysis(raw, { formatSpec, content });
      return {
        analysis,
        meta: {
          mode: 'demo',
          provider: 'local-heuristic',
          model: 'demo-structural-heuristics',
          latencyMs: Date.now() - startedAt,
          usage: null,
          attempts: 1,
          demoReason: config.ai.demoReason,
        },
      };
    }

    const prompt = buildAnalysisPrompt({ formatSpec, resolution, sideLabel, speechType, content });
    let completion;
    let attempts = 0;

    try {
      attempts = 1;
      completion = await provider.complete(prompt);
      const analysis = normalizeAnalysis(parseJsonLoose(completion.content), { formatSpec, content });
      return {
        analysis,
        meta: {
          mode: 'live',
          provider: config.ai.provider,
          model: completion.model,
          latencyMs: Date.now() - startedAt,
          usage: completion.usage,
          attempts,
        },
      };
    } catch (error) {
      // A transport failure should not trigger a second paid request.
      if (error.code === 'ai_unavailable') throw error;

      logger.warn('AI response failed validation; requesting one JSON repair', {
        code: error.code || error.name,
      });

      attempts = 2;
      const repair = await provider.complete(
        buildRepairPrompt({ ...prompt, invalidOutput: completion?.content || '' })
      );
      const analysis = normalizeAnalysis(parseJsonLoose(repair.content), { formatSpec, content });
      return {
        analysis,
        meta: {
          mode: 'live',
          provider: config.ai.provider,
          model: repair.model,
          latencyMs: Date.now() - startedAt,
          usage: repair.usage,
          attempts,
        },
      };
    }
  }

  return {
    analyze,
    status: () => publicAiStatus(config),
  };
}
