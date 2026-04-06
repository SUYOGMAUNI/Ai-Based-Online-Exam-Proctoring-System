import axios from 'axios';

   const API_BASE = 'http://localhost:8000/api';

   const api = axios.create({
     baseURL: API_BASE,
   });

   api.interceptors.request.use(config => {
     const token = localStorage.getItem('token');
     if (token) {
       config.headers.Authorization = `Token ${token}`;
     }
     return config;
   });

   export default api;