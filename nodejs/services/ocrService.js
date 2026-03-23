const axios = require('axios');

const OCR_SERVICE_URL =
  process.env.FASTAPI_SERVICE_URL ||
  process.env.PYTHON_SERVICE_URL ||
  'http://python-scripts:8000';

const OCR_TIMEOUT_MS = Number(process.env.OCR_SERVICE_TIMEOUT_MS) || 120000;
const OCR_HTTP_MAX_ATTEMPTS = Math.max(1, Number(process.env.OCR_HTTP_MAX_ATTEMPTS) || 3);
const OCR_HTTP_RETRY_BASE_MS = Number(process.env.OCR_HTTP_RETRY_BASE_MS) || 1500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Map axios errors from the FastAPI AI/OCR service to clear user-facing messages.
 */
function mapOcrAxiosError(error) {
  if (error.response) {
    const d = error.response.data || {};
    if (error.response.status === 429 || d.code === 'rate_limit_exceeded') {
      const msg = d.error || 'AI processing rate limit exceeded.';
      const sec = d.retry_after_seconds;
      return new Error(
        sec != null ? `${msg} Retry after about ${sec} seconds.` : msg
      );
    }
    const errorMsg = d.error || d.message || error.message;
    return new Error(`OCR service error: ${errorMsg}`);
  }
  if (error.request) {
    return new Error(
      'OCR service is not responding (timeout or network). Please check if the FastAPI service is running.'
    );
  }
  return new Error(`OCR request error: ${error.message}`);
}

/**
 * POST to FastAPI OCR with retries on transient failures (timeouts, 502/503/504).
 * Does not retry 429 rate limit responses from the AI document limiter.
 */
async function postPythonOcr(url, data, options = {}) {
  const { isForm = false } = options;
  const config = {
    timeout: OCR_TIMEOUT_MS,
    headers: isForm ? data.getHeaders() : { 'Content-Type': 'application/json' }
  };

  let lastError;
  for (let attempt = 1; attempt <= OCR_HTTP_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await axios.post(url, data, config);
    } catch (error) {
      lastError = error;
      if (error.response?.status === 429 || error.response?.data?.code === 'rate_limit_exceeded') {
        throw mapOcrAxiosError(error);
      }
      const st = error.response?.status;
      const retryable =
        !error.response ||
        st === 502 ||
        st === 503 ||
        st === 504 ||
        st === 408 ||
        error.code === 'ECONNABORTED' ||
        error.code === 'ETIMEDOUT';
      if (!retryable || attempt === OCR_HTTP_MAX_ATTEMPTS) {
        throw mapOcrAxiosError(error);
      }
      const wait = OCR_HTTP_RETRY_BASE_MS * 2 ** (attempt - 1);
      console.warn(
        `[ocrService] Retry ${attempt}/${OCR_HTTP_MAX_ATTEMPTS} for ${url} (${error.message}); waiting ${wait}ms`
      );
      await sleep(wait);
    }
  }
  throw mapOcrAxiosError(lastError);
}

/**
 * Send PDF file to OCR service for processing
 * @param {string} filePath - Path to the PDF file
 * @returns {Promise<Object>} Extracted load data
 */
async function processPDF(filePath) {
  try {
    const response = await postPythonOcr(
      `${OCR_SERVICE_URL}/process-pdf`,
      { file_path: filePath }
    );

    if (response.data.success) {
      return response.data.data;
    }
    throw new Error(response.data.error || 'OCR processing failed');
  } catch (error) {
    console.error('OCR Service Error (processPDF):', error.message);
    throw error;
  }
}

/**
 * Send PDF file buffer to OCR service for processing
 * @param {Buffer} fileBuffer - PDF file buffer
 * @param {string} filename - Original filename
 * @returns {Promise<Object>} Extracted load data
 */
async function processPDFBuffer(fileBuffer, filename) {
  try {
    const FormData = require('form-data');
    const form = new FormData();
    form.append('file', fileBuffer, {
      filename: filename,
      contentType: 'application/pdf'
    });

    const response = await postPythonOcr(`${OCR_SERVICE_URL}/process-pdf`, form, {
      isForm: true
    });

    if (response.data.success) {
      return response.data.data;
    }
    throw new Error(response.data.error || 'OCR processing failed');
  } catch (error) {
    console.error('OCR Service Error (processPDFBuffer):', error.message);
    throw error;
  }
}

/**
 * Check if OCR service is healthy
 * @returns {Promise<boolean>}
 */
async function checkHealth() {
  try {
    const response = await axios.get(`${OCR_SERVICE_URL}/health`, {
      timeout: 5000
    });
    return response.data.status === 'ok';
  } catch (error) {
    return false;
  }
}

/**
 * Extract structured data from an old invoice PDF (carrier, dates, driver sections, load lines).
 * @param {string} filePath - Absolute path to PDF (must be readable by OCR service, e.g. /app/uploads/old-invoices/xxx.pdf)
 * @returns {Promise<Object>} Extracted invoice data (carrierName, invoiceNumber, groups, etc.)
 */
async function extractOldInvoice(filePath) {
  try {
    const response = await postPythonOcr(`${OCR_SERVICE_URL}/extract-old-invoice`, {
      file_path: filePath
    });
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.error || 'Extract failed');
  } catch (error) {
    console.error('OCR Service Error (extractOldInvoice):', error.message);
    throw error;
  }
}

module.exports = {
  processPDF,
  processPDFBuffer,
  checkHealth,
  extractOldInvoice
};
