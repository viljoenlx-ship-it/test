import { parseReaderOutput, type DocumentReader, type ReaderDocument } from './reader';

const MODEL = () => process.env.DOCUMENT_READER_MODEL?.trim() || 'gpt-4o-mini';

const fieldSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    value: { type: 'string' },
    confidence: { type: 'number' },
  },
  required: ['value', 'confidence'],
} as const;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    documentType: { type: 'string', enum: ['tax_invoice', 'delivery_note'] },
    supplierName: fieldSchema,
    supplierVatNumber: fieldSchema,
    documentNumber: fieldSchema,
    documentDate: fieldSchema,
    dueDate: fieldSchema,
    currency: fieldSchema,
    lines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          description: fieldSchema,
          supplierCode: fieldSchema,
          quantity: fieldSchema,
          unit: fieldSchema,
          unitPriceExcl: fieldSchema,
          vat: fieldSchema,
          lineTotal: fieldSchema,
        },
        required: [
          'description',
          'supplierCode',
          'quantity',
          'unit',
          'unitPriceExcl',
          'vat',
          'lineTotal',
        ],
      },
    },
    subtotal: fieldSchema,
    vat: fieldSchema,
    total: fieldSchema,
    pageCount: { type: 'integer' },
  },
  required: [
    'documentType',
    'supplierName',
    'supplierVatNumber',
    'documentNumber',
    'documentDate',
    'dueDate',
    'currency',
    'lines',
    'subtotal',
    'vat',
    'total',
    'pageCount',
  ],
} as const;

function filePart(bytes: Buffer, contentType: string, filename: string) {
  const data = `data:${contentType};base64,${bytes.toString('base64')}`;
  if (contentType === 'application/pdf') {
    return {
      type: 'file',
      file: { filename, file_data: data },
    };
  }
  return {
    type: 'image_url',
    image_url: { url: data },
  };
}

/**
 * Vision reader. The request body is never logged. A non-2xx response becomes
 * a status code only, so document text cannot land in a log line.
 */
export const openaiReader: DocumentReader = {
  name: 'openai',
  async read(input): Promise<ReaderDocument> {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) {
      throw new Error('reader_status_missing_key');
    }
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL(),
        temperature: 0,
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'supplier_document', strict: true, schema: SCHEMA },
        },
        messages: [
          {
            role: 'system',
            content:
              'Read a South African supplier tax invoice or delivery note. Return only the JSON schema. Amounts are decimal strings with a dot and at most two decimal places, without a currency symbol. Unit price is exclusive of VAT. Line total is quantity times the exclusive unit price. VAT is the tax amount. Dates are YYYY-MM-DD. dueDate.value is an empty string when there is no due date. Confidence is a number from 0 to 1. Do not invent lines that are not on the document. Currency is a 3-letter code.',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Read this supplier document.' },
              filePart(input.bytes, input.contentType, input.filename || 'document'),
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      throw new Error(`reader_status_${response.status}`);
    }
    const payload = (await response.json()) as {
      choices?: { message?: { content?: string | null } }[];
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('reader_status_empty');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(content) as unknown;
    } catch {
      throw new Error('reader_status_unparsed');
    }
    const document = parseReaderOutput(parsed);
    if (document.dueDate.value === '') {
      document.dueDate.value = null;
    }
    return document;
  },
};
