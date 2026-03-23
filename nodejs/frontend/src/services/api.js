import axios from 'axios';

// Auto-detect API URL based on environment or current hostname
const getApiUrl = () => {
  const envApiUrl = process.env.REACT_APP_API_URL;
  
  // If explicitly set and it's a full URL, use it
  if (envApiUrl && !envApiUrl.startsWith('/')) {
    return envApiUrl;
  }
  
  // If relative URL or not set, use current hostname with port 5000
  // This works for both localhost and remote IPs
  if (envApiUrl && envApiUrl.startsWith('/')) {
    // Use proxy (for local development)
    return envApiUrl;
  }
  
  // Auto-detect: use same hostname as frontend but port 5000
  const hostname = window.location.hostname;
  const protocol = window.location.protocol;
  return `${protocol}//${hostname}:5000/api`;
};

const API_URL = getApiUrl();

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json'
  },
  withCredentials: true // Important for session cookies
});

// Auth API
export const login = async (password) => {
  const response = await api.post('/auth/login', { password });
  return response.data;
};

export const logout = async () => {
  const response = await api.post('/auth/logout');
  return response.data;
};

export const checkAuth = async () => {
  const response = await api.get('/auth/check');
  return response.data;
};

// Upload API
export const uploadPDF = async (file) => {
  const formData = new FormData();
  formData.append('file', file);
  
  const response = await api.post('/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data'
    }
  });
  return response.data;
};

// Loads API
export const getLoads = async (filters = {}) => {
  const response = await api.get('/loads', { params: filters });
  return response.data;
};

export const createLoad = async (loadData) => {
  const response = await api.post('/loads', loadData);
  return response.data;
};

export const getLoadsGrouped = async (params = {}) => {
  const response = await api.get('/loads/grouped', { params });
  return response.data;
};

export const searchInvoicedLoads = async (filters = {}) => {
  const response = await api.get('/loads/invoiced', { params: filters });
  return response.data;
};

export const getLoadsLog = async (carrierId, dateFrom, dateTo) => {
  const params = { carrier_id: carrierId };
  if (dateFrom) params.date_from = dateFrom;
  if (dateTo) params.date_to = dateTo;
  const response = await api.get('/loads/log', { params });
  return response.data;
};

export const getSubDispatcherReport = async (subDispatcherId, dateFrom, dateTo) => {
  const params = { sub_dispatcher_id: subDispatcherId };
  if (dateFrom) params.date_from = dateFrom;
  if (dateTo) params.date_to = dateTo;
  const response = await api.get('/loads/sub-dispatcher-report', { params });
  return response.data;
};

export const getLoad = async (id) => {
  const response = await api.get(`/loads/${id}`);
  return response.data;
};

export const getLoadRateConfirmationUrl = (id) => {
  return `${API_URL}/loads/${id}/rate-confirmation`;
};

export const updateLoad = async (id, data) => {
  const response = await api.put(`/loads/${id}`, data);
  return response.data;
};

export const patchLoadDriver = async (id, driverId) => {
  const response = await api.patch(`/loads/${id}`, { driver_id: driverId });
  return response.data;
};

export const deleteLoad = async (id) => {
  const response = await api.delete(`/loads/${id}`);
  return response.data;
};

export const cancelLoad = async (id, cancelled) => {
  const response = await api.patch(`/loads/${id}/cancel`, { cancelled });
  return response.data;
};

export const confirmLoad = async (id) => {
  const response = await api.patch(`/loads/${id}/confirm`);
  return response.data;
};

export const updateLoadCarrier = async (id, carrierId, saveAlias = false) => {
  const response = await api.patch(`/loads/${id}/carrier`, {
    carrier_id: carrierId,
    save_alias: saveAlias
  });
  return response.data;
};

export const markLoadAsInvoiced = async (id, invoiced) => {
  const response = await api.patch(`/loads/${id}/invoiced`, { invoiced });
  return response.data;
};

export const patchLoadSubDispatcher = async (id, subDispatcherId) => {
  const response = await api.patch(`/loads/${id}/sub-dispatcher`, {
    sub_dispatcher_id: subDispatcherId || null
  });
  return response.data;
};

export const getLoadConflicts = async (id) => {
  const response = await api.get(`/loads/${id}/conflicts`);
  return response.data;
};

// Carriers API
export const getCarriers = async () => {
  const response = await api.get('/carriers');
  return response.data;
};

export const getCarrier = async (id) => {
  const response = await api.get(`/carriers/${id}`);
  return response.data;
};

export const createCarrier = async (carrierData) => {
  const response = await api.post('/carriers', carrierData);
  return response.data;
};

export const updateCarrier = async (id, carrierData) => {
  const response = await api.put(`/carriers/${id}`, carrierData);
  return response.data;
};

export const deleteCarrier = async (id) => {
  const response = await api.delete(`/carriers/${id}`);
  return response.data;
};

// Drivers API
export const getDrivers = async () => {
  const response = await api.get('/drivers');
  return response.data;
};

export const getDriversByCarrier = async (carrierId) => {
  const response = await api.get('/drivers', { params: { carrier_id: carrierId } });
  return response.data;
};

export const getDriver = async (id) => {
  const response = await api.get(`/drivers/${id}`);
  return response.data;
};

export const createDriver = async (driverData) => {
  const response = await api.post('/drivers', driverData);
  return response.data;
};

export const updateDriver = async (id, driverData) => {
  const response = await api.put(`/drivers/${id}`, driverData);
  return response.data;
};

export const deleteDriver = async (id) => {
  const response = await api.delete(`/drivers/${id}`);
  return response.data;
};

// Rules API
export const getRules = async () => {
  const response = await api.get('/rules');
  return response.data;
};

export const createRule = async (ruleData) => {
  const response = await api.post('/rules', ruleData);
  return response.data;
};

export const updateRule = async (id, ruleData) => {
  const response = await api.put(`/rules/${id}`, ruleData);
  return response.data;
};

export const deleteRule = async (id) => {
  const response = await api.delete(`/rules/${id}`);
  return response.data;
};

// Invoices API
export const getInvoices = async (filters = {}) => {
  const params = {};
  if (filters.carrier != null && String(filters.carrier).trim()) params.carrier = filters.carrier.trim();
  if (filters.dateFrom) params.dateFrom = filters.dateFrom;
  if (filters.dateTo) params.dateTo = filters.dateTo;
  const response = await api.get('/invoices', { params });
  return response.data;
};

export const uploadOldInvoice = async (file) => {
  const formData = new FormData();
  formData.append('file', file);
  const response = await api.post('/invoices/upload-old', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  return response.data;
};

export const extractOldInvoice = async (file) => {
  const formData = new FormData();
  formData.append('file', file);
  const response = await api.post('/invoices/extract-old-invoice', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 90000
  });
  return response.data;
};

export const saveExtractedInvoice = async (file, data) => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('data', JSON.stringify(data));
  const response = await api.post('/invoices/save-extracted', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000
  });
  return response.data;
};

export const getInvoice = async (id) => {
  const response = await api.get(`/invoices/${id}`);
  return response.data;
};

export const generateInvoice = async (invoiceData) => {
  const response = await api.post('/invoices/generate', invoiceData);
  return response.data;
};

export const markInvoiceAsPaid = async (id, paid, paidDate = null) => {
  const payload = { paid };
  if (paid && paidDate) {
    payload.paid_date = paidDate;
  }
  const response = await api.patch(`/invoices/${id}/paid`, payload);
  return response.data;
};

export const deleteInvoice = async (id) => {
  const response = await api.delete(`/invoices/${id}`);
  return response.data;
};

export const downloadInvoicePDF = async (id) => {
  const response = await api.get(`/invoices/${id}/pdf`, {
    responseType: 'blob'
  });
  
  // Create download link
  const url = window.URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `invoice-${id}.pdf`);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
};

export const getInvoicePDFUrl = (id) => {
  return `${API_URL}/invoices/${id}/pdf`;
};

// Dispatchers API
export const getDispatchers = async () => {
  const response = await api.get('/dispatchers');
  return response.data;
};

export const getActiveDispatcher = async () => {
  const response = await api.get('/dispatchers/active');
  return response.data;
};

export const getDispatcher = async (id) => {
  const response = await api.get(`/dispatchers/${id}`);
  return response.data;
};

export const createDispatcher = async (dispatcherData) => {
  const response = await api.post('/dispatchers', dispatcherData);
  return response.data;
};

export const updateDispatcher = async (id, dispatcherData) => {
  const response = await api.put(`/dispatchers/${id}`, dispatcherData);
  return response.data;
};

export const activateDispatcher = async (id) => {
  const response = await api.patch(`/dispatchers/${id}/activate`);
  return response.data;
};

export const deleteDispatcher = async (id) => {
  const response = await api.delete(`/dispatchers/${id}`);
  return response.data;
};

// Settings API
export const getSettings = async () => {
  const response = await api.get('/settings');
  return response.data;
};

export const updateSettings = async (settingsData) => {
  const response = await api.put('/settings', settingsData);
  return response.data;
};

