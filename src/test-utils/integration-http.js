'use strict';

const request = require('supertest');
const { app } = require('../app');

/**
 * @param {string} email
 * @param {string} password
 * @returns {Promise<string>}
 */
async function loginAccessToken(email, password) {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200) {
    const msg = res.body?.error?.message || res.body?.message || res.text;
    throw new Error(`login failed (${res.status}): ${msg}`);
  }
  const tok = res.body?.data?.accessToken;
  if (!tok) throw new Error('login response missing accessToken');
  return tok;
}

function authReq(method, path, token) {
  const req = request(app)[method.toLowerCase()](path).set('Authorization', `Bearer ${token}`);
  return req;
}

module.exports = { app, request, loginAccessToken, authReq };
