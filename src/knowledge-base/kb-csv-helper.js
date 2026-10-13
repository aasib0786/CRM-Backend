/**
 * High-performance RFC-4180 compliant CSV Parser and Serializer for Knowledge Base
 * Handles quotes, commas within fields, escaped quotes (""), newlines, and trims whitespace.
 */

/**
 * Parses CSV string into array of object rows
 * @param {string} text - Raw CSV content
 * @returns {Array<Object>} Array of key-value rows
 */
export function parseCsv(text) {
  if (!text || typeof text !== 'string') return [];

  const cleanText = text.replace(/^\uFEFF/, '').trim(); // Remove UTF-8 BOM
  if (!cleanText) return [];

  const rows = [];
  let currentRow = [];
  let currentField = '';
  let insideQuotes = false;

  for (let i = 0; i < cleanText.length; i++) {
    const char = cleanText[i];
    const nextChar = cleanText[i + 1];

    if (insideQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped quote: "" -> "
          currentField += '"';
          i++;
        } else {
          // End of quoted field
          insideQuotes = false;
        }
      } else {
        currentField += char;
      }
    } else {
      if (char === '"') {
        insideQuotes = true;
      } else if (char === ',') {
        currentRow.push(currentField.trim());
        currentField = '';
      } else if (char === '\r') {
        // Ignore carriage return
        continue;
      } else if (char === '\n') {
        currentRow.push(currentField.trim());
        if (currentRow.some((f) => f.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentField = '';
      } else {
        currentField += char;
      }
    }
  }

  // Push last field & row if present
  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some((f) => f.length > 0)) {
      rows.push(currentRow);
    }
  }

  if (rows.length < 2) return [];

  // Normalize header keys: lowercase, alphanumeric + underscore
  const headers = rows[0].map((h) =>
    h.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
  );

  const results = [];
  for (let r = 1; r < rows.length; r++) {
    const values = rows[r];
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = values[idx] !== undefined ? values[idx] : '';
    });
    results.push(obj);
  }

  return results;
}

/**
 * Escapes a single CSV value according to RFC-4180
 */
function escapeCsvValue(val) {
  if (val === null || val === undefined) return '';
  let str = Array.isArray(val) ? val.join(', ') : String(val);
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Serializes objects into a downloadable CSV string
 * @param {Array<Object>} rows
 * @param {Array<{ key: string, label: string }>} columns
 * @returns {string}
 */
export function toCsv(rows = [], columns = []) {
  if (!columns || columns.length === 0) {
    if (rows.length === 0) return '';
    columns = Object.keys(rows[0]).map((k) => ({ key: k, label: k }));
  }

  const headerLine = columns.map((c) => escapeCsvValue(c.label)).join(',');
  const dataLines = rows.map((row) =>
    columns.map((c) => escapeCsvValue(row[c.key])).join(',')
  );

  return [headerLine, ...dataLines].join('\r\n');
}

/**
 * Generates sample CSV template for users to download
 */
export function getSampleCsvTemplate() {
  const columns = [
    { key: 'category', label: 'category' },
    { key: 'type', label: 'type' },
    { key: 'question', label: 'question' },
    { key: 'answer', label: 'answer' },
    { key: 'keywords', label: 'keywords' },
    { key: 'project_name', label: 'project_name' },
    { key: 'language', label: 'language' },
    { key: 'priority', label: 'priority' },
    { key: 'status', label: 'status' },
  ];

  const sampleRows = [
    {
      category: 'General & Booking Policies',
      type: 'faq',
      question: 'What are the office visiting hours?',
      answer: 'Our sales gallery is open from 9:30 AM to 6:30 PM every day including weekends.',
      keywords: 'timings, office hours, weekend, visit',
      project_name: '',
      language: 'en',
      priority: 5,
      status: 'published',
    },
    {
      category: 'Properties & Amenities',
      type: 'product_info',
      question: 'Is power backup available for all flats?',
      answer: 'Yes, 100% DG power backup is provided for all apartments and common utilities.',
      keywords: 'power backup, generator, electricity, bijli',
      project_name: '',
      language: 'en',
      priority: 5,
      status: 'published',
    },
  ];

  return toCsv(sampleRows, columns);
}
