import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000/api';

const client = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

export const documentsAPI = {
  list: (params) => client.get('/documents/', { params }),
  get: (id) => client.get(`/documents/${id}/`),
  create: (data) => client.post('/documents/', data),
  update: (id, data) => client.patch(`/documents/${id}/`, data),
  submit: (id) => client.post(`/documents/${id}/submit/`),
  approve: (id, data) => client.post(`/documents/${id}/approve/`, data),
  reject: (id, data) => client.post(`/documents/${id}/reject/`, data),
  stats: () => client.get('/documents/stats/'),
};

export const vocAPI = {
  list: (params) => client.get('/voc/', { params }),
  create: (data) => client.post('/voc/', data),
  get: (id) => client.get(`/voc/${id}/`),
};

export const rfgAPI = {
  list: (params) => client.get('/rfg/', { params }),
  create: (data) => client.post('/rfg/', data),
  get: (id) => client.get(`/rfg/${id}/`),
};

export default client;
