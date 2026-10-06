/**
 * Development only (npm start): send every /api request to the backend on port 5000.
 *
 * Why not the simpler "proxy" field in package.json: that one skips requests that ask for HTML,
 * which includes clicking a download link — so Excel/CSV downloads got the React page instead of
 * the file. This proxy forwards everything under /api, so downloads stream straight from the backend.
 *
 * Create React App loads this file automatically. Production builds ignore it.
 */

const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function setupProxy(app) {
  app.use(
    '/api',
    createProxyMiddleware({
      target: process.env.MIS_BACKEND_URL || 'http://localhost:5000',
      changeOrigin: true,
    })
  );
};
