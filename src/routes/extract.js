import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import { extractTextFromFile } from '../services/file-extract.js';
import { ApiError, badRequest } from '../utils/errors.js';

function uploadSizeLabel(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export function createExtractRouter({ config, logger }) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: config.upload.maxBytes,
      files: 1,
      fields: 4,
      parts: 6,
    },
  });

  function acceptFile(req, res, next) {
    upload.single('file')(req, res, (error) => {
      if (!error) return next();
      if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
          return next(
            new ApiError(
              413,
              `That file is larger than ${uploadSizeLabel(config.upload.maxBytes)}.`,
              'file_too_large'
            )
          );
        }
        return next(badRequest('Attach one file at a time using the file field.'));
      }
      return next(badRequest('The upload could not be read. Choose the file again.'));
    });
  }

  const router = Router();
  router.use(requireAuth);

  router.post('/', acceptFile, async (req, res, next) => {
    try {
      if (!req.file) throw badRequest('Choose a file to upload.');

      const extracted = await extractTextFromFile(req.file, {
        maxChars: config.ai.maxSpeechChars,
      });

      logger.debug('Extracted speech text from file', {
        userId: req.user.id,
        kind: extracted.kind,
        bytes: extracted.bytes,
        characters: extracted.characters,
      });

      res.json(extracted);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
