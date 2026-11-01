import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers/test-server.js';

let ctx;
let alice;
let aliceEmail;

const SPEECH = `Resolved: The United States should substantially increase funding for public transit.
First, expanding transit reduces congestion because commuters switch modes when service is frequent.
Second, transit spending creates construction and operations jobs across the region.`;

function fileForm(buffer, filename, type = 'application/octet-stream') {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type }), filename);
  return form;
}

function makePdf(text) {
  const escaped = text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const stream = `BT\n/F1 12 Tf\n72 720 Td\n(${escaped}) Tj\nET\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let output = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    output += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output, 'latin1');
}

async function register(client, email) {
  await client.get('/api/meta');
  const response = await client.post('/api/auth/register', {
    email,
    password: 'StrongPass123',
    displayName: 'Upload Tester',
  });
  assert.equal(response.status, 201);
}

before(async () => {
  ctx = await startTestServer();
  alice = ctx.client();
  aliceEmail = `upload.${Date.now()}@example.com`;
  await register(alice, aliceEmail);
});

after(async () => {
  await ctx.close();
});

test('upload endpoint requires authentication and a CSRF token', async () => {
  const anonymous = ctx.client();
  await anonymous.get('/api/meta');
  const anonymousUpload = await anonymous.postForm('/api/extract', fileForm(SPEECH, 'speech.txt', 'text/plain'));
  assert.equal(anonymousUpload.status, 401);

  const noCsrf = await alice.postForm('/api/extract', fileForm(SPEECH, 'speech.txt', 'text/plain'), {
    csrf: false,
  });
  assert.equal(noCsrf.status, 403);
  assert.equal(noCsrf.data.error.code, 'csrf_failed');
});

test('plain text files are extracted and counted', async () => {
  const response = await alice.postForm(
    '/api/extract',
    fileForm(SPEECH, 'transit-case.txt', 'text/plain')
  );

  assert.equal(response.status, 200);
  assert.equal(response.data.kind, 'text');
  assert.equal(response.data.filename, 'transit-case.txt');
  assert.equal(response.data.text, SPEECH);
  assert.equal(response.data.characters, SPEECH.length);
  assert.ok(response.data.words > 20);
  assert.ok(response.data.bytes > 0);
});

test('markdown and PDF files are extracted', async () => {
  const markdown = `# Transit case\n\n${SPEECH}`;
  const markdownResponse = await alice.postForm(
    '/api/extract',
    fileForm(markdown, 'case.md', 'text/markdown')
  );
  assert.equal(markdownResponse.status, 200);
  assert.equal(markdownResponse.data.kind, 'markdown');
  assert.ok(markdownResponse.data.text.includes('Transit case'));

  const pdfText = 'First, transit reduces congestion and creates jobs.';
  const pdfResponse = await alice.postForm(
    '/api/extract',
    fileForm(makePdf(pdfText), 'case.pdf', 'application/pdf')
  );
  assert.equal(pdfResponse.status, 200);
  assert.equal(pdfResponse.data.kind, 'pdf');
  assert.ok(pdfResponse.data.text.includes('transit reduces congestion'));
});

test('invalid extensions, mismatched signatures and non-UTF-8 text are rejected', async () => {
  const extension = await alice.postForm('/api/extract', fileForm(SPEECH, 'speech.exe'));
  assert.equal(extension.status, 400);
  assert.match(extension.data.error.message, /\.txt, \.md, \.docx, or \.pdf/);

  const fakePdf = await alice.postForm('/api/extract', fileForm('not a pdf', 'speech.pdf', 'application/pdf'));
  assert.equal(fakePdf.status, 400);
  assert.match(fakePdf.data.error.message, /not a PDF/);

  const fakeDocx = await alice.postForm(
    '/api/extract',
    fileForm('not a docx', 'speech.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  );
  assert.equal(fakeDocx.status, 400);
  assert.match(fakeDocx.data.error.message, /not a Word document/);

  const binaryText = await alice.postForm(
    '/api/extract',
    fileForm(Buffer.from([0xff, 0xfe, 0x00, 0x00]), 'speech.txt', 'text/plain')
  );
  assert.equal(binaryText.status, 400);
  assert.match(binaryText.data.error.message, /UTF-8/);

  const empty = await alice.postForm('/api/extract', fileForm(Buffer.alloc(0), 'empty.txt', 'text/plain'));
  assert.equal(empty.status, 400);
  assert.match(empty.data.error.message, /empty/);
});

test('extracted text over the analysis limit is rejected', async () => {
  const response = await alice.postForm(
    '/api/extract',
    fileForm('x'.repeat(20001), 'too-long.txt', 'text/plain')
  );
  assert.equal(response.status, 413);
  assert.equal(response.data.error.code, 'file_text_too_long');
  assert.match(response.data.error.message, /20,000/);
});

test('oversized uploads are rejected before extraction', async () => {
  const small = await startTestServer({ upload: { maxBytes: 128 } });
  try {
    const client = small.client();
    await register(client, `small.${Date.now()}@example.com`);
    const response = await client.postForm(
      '/api/extract',
      fileForm('x'.repeat(256), 'too-large.txt', 'text/plain')
    );
    assert.equal(response.status, 413);
    assert.equal(response.data.error.code, 'file_too_large');
    assert.match(response.data.error.message, /1 KB/);
  } finally {
    await small.close();
  }
});
