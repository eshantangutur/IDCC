import path from 'node:path';
import { isUtf8 } from 'node:buffer';
import mammoth from 'mammoth';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { ApiError, badRequest } from '../utils/errors.js';

const MAX_DOCX_UNCOMPRESSED_BYTES = 25 * 1024 * 1024;

const FILE_TYPES = new Map([
  ['.txt', { kind: 'text', label: 'Plain text' }],
  ['.md', { kind: 'markdown', label: 'Markdown' }],
  ['.markdown', { kind: 'markdown', label: 'Markdown' }],
  ['.docx', { kind: 'docx', label: 'Word document' }],
  ['.pdf', { kind: 'pdf', label: 'PDF' }],
]);

function cleanFilename(filename) {
  const base = path.basename(String(filename || 'upload'));
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 180);
  return cleaned || 'upload';
}

function normalizeText(value) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function countWords(text) {
  return text ? text.split(/\s+/).length : 0;
}

function hasZipSignature(buffer) {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  );
}

function hasPdfSignature(buffer) {
  return buffer.subarray(0, 1024).toString('latin1').includes('%PDF-');
}

function assertSafeDocxArchive(buffer) {
  const eocdMinimum = Math.max(0, buffer.length - 22 - 0xffff);
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= eocdMinimum; offset -= 1) {
    if (offset + 22 <= buffer.length && buffer.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd === -1) {
    throw badRequest('That Word document is not a valid .docx file.');
  }

  const entryCount = buffer.readUInt16LE(eocd + 10);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  if (directoryOffset >= buffer.length || entryCount > 10000) {
    throw badRequest('That Word document is not a valid .docx file.');
  }

  let offset = directoryOffset;
  let uncompressedTotal = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw badRequest('That Word document is not a valid .docx file.');
    }
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new ApiError(413, 'That Word document uses unsupported ZIP64 compression.', 'file_too_large');
    }
    uncompressedTotal += uncompressedSize;
    if (uncompressedTotal > MAX_DOCX_UNCOMPRESSED_BYTES) {
      throw new ApiError(
        413,
        'That Word document expands to more than 25 MB and cannot be read.',
        'file_too_large'
      );
    }
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    offset += 46 + nameLength + extraLength + commentLength;
  }
}

async function extractPdf(buffer) {
  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true,
    verbosity: 0,
  });

  let document;
  try {
    document = await loadingTask.promise;
    const pages = [];

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      let pageText = '';
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        pageText += item.str;
        pageText += item.hasEOL ? '\n' : ' ';
      }
      pages.push(pageText);
      page.cleanup();
    }

    return pages.join('\n\n');
  } catch {
    throw badRequest('That PDF could not be read. If it is password protected or image only, export it as text or Word and try again.');
  } finally {
    await loadingTask.destroy().catch(() => {});
  }
}

async function extractDocx(buffer) {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } catch {
    throw badRequest('That Word document could not be read. Save it as a .docx file and try again.');
  }
}

export function describeFileType(filename) {
  return FILE_TYPES.get(path.extname(String(filename || '')).toLowerCase()) || null;
}

/**
 * Extracts speech text from an uploaded file without writing the file to disk.
 * The caller is responsible for enforcing the multipart byte limit.
 */
export async function extractTextFromFile(file, { maxChars = 20000 } = {}) {
  if (!file?.buffer || !file.originalname) {
    throw badRequest('Choose a file to upload.');
  }

  const type = describeFileType(file.originalname);
  if (!type) {
    throw badRequest('Upload a .txt, .md, .docx, or .pdf file.');
  }

  if (file.buffer.length === 0) {
    throw badRequest('That file is empty.');
  }

  if (type.kind === 'pdf' && !hasPdfSignature(file.buffer)) {
    throw badRequest('That file is named .pdf but is not a PDF.');
  }
  if (type.kind === 'docx' && !hasZipSignature(file.buffer)) {
    throw badRequest('That file is named .docx but is not a Word document.');
  }
  if (type.kind === 'docx') assertSafeDocxArchive(file.buffer);
  if ((type.kind === 'text' || type.kind === 'markdown') && !isUtf8(file.buffer)) {
    throw badRequest('That text file is not UTF-8. Save it as UTF-8 plain text and try again.');
  }

  let rawText;
  if (type.kind === 'pdf') rawText = await extractPdf(file.buffer);
  else if (type.kind === 'docx') rawText = await extractDocx(file.buffer);
  else rawText = file.buffer.toString('utf8').replace(/^\uFEFF/, '');

  const text = normalizeText(rawText);
  if (!text) {
    throw badRequest(
      type.kind === 'pdf'
        ? 'That PDF has no selectable text. Export it as text or paste the speech instead.'
        : 'No readable text was found in that file.'
    );
  }

  if (text.length > maxChars) {
    const limit = new Intl.NumberFormat('en-US').format(maxChars);
    const actual = new Intl.NumberFormat('en-US').format(text.length);
    throw new ApiError(
      413,
      `That file contains ${actual} characters. The limit is ${limit}. Split the speech into shorter sections.`,
      'file_text_too_long'
    );
  }

  return {
    text,
    filename: cleanFilename(file.originalname),
    kind: type.kind,
    format: type.label,
    bytes: file.buffer.length,
    characters: text.length,
    words: countWords(text),
  };
}
