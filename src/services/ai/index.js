import { publicAiStatus } from '../../config.js';
import { buildAnalysisPrompt, buildRepairPrompt } from './prompt.js';
import { normalizeAnalysis, parseJsonLoose } from './normalize.js';
import { buildRoundPrompt, buildRoundRepairPrompt } from './round-prompt.js';
import { normalizeRoundAnalysis } from './round-normalize.js';
import { generateDemoRoundAnalysis } from './round-demo.js';
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

  /**
   * Round analysis. Uses the configured provider when available; otherwise the
   * deterministic heuristic analyser, which is labelled as demo mode.
   */
  async function analyzeRound({ formatSpec, resolution, sideLabel, speeches }) {
    const startedAt = Date.now();

    if (!provider) {
      const raw = generateDemoRoundAnalysis({ formatSpec, resolution, speeches });
      const analysis = normalizeRoundAnalysis(raw, { formatSpec, speeches });
      return {
        analysis,
        meta: {
          mode: 'demo',
          provider: 'local-heuristic',
          model: 'demo-round-heuristics',
          latencyMs: Date.now() - startedAt,
          usage: null,
          attempts: 1,
          demoReason: config.ai.demoReason,
        },
      };
    }

    const prompt = buildRoundPrompt({ formatSpec, resolution, sideLabel, speeches });
    let completion;
    let attempts = 0;

    try {
      attempts = 1;
      completion = await provider.complete(prompt);
      const analysis = normalizeRoundAnalysis(parseJsonLoose(completion.content), { formatSpec, speeches });
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
      if (error.code === 'ai_unavailable') throw error;

      logger.warn('Round analysis failed validation; requesting one JSON repair', {
        code: error.code || error.name,
      });

      attempts = 2;
      const repair = await provider.complete(
        buildRoundRepairPrompt({ ...prompt, invalidOutput: completion?.content || '' })
      );
      const analysis = normalizeRoundAnalysis(parseJsonLoose(repair.content), { formatSpec, speeches });
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
    analyzeRound,
    status: () => publicAiStatus(config),
  };
}
