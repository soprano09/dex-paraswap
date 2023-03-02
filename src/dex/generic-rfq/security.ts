import {
  RequestConfig,
  RequestHeaders,
} from '../../dex-helper/irequest-wrapper';
import { createHmac } from 'crypto';
import { RFQSecret } from './types';

function authByParams(
  url: string,
  method: string,
  body: any,
  secret: RFQSecret,
  pathToRemove?: string,
): RequestHeaders {
  const headers: RequestHeaders = {};
  const timestamp = Date.now().toString();

  const _url = new URL(url);
  if (pathToRemove && pathToRemove !== '') {
    _url.pathname = _url.pathname.replace(`/${pathToRemove}`, '');
  }
  const payload = `${timestamp}${method.toUpperCase()}${_url.pathname}${
    _url.search
  }${method === 'POST' ? JSON.stringify(body) : ''}`;
  const signature = createHmac('sha256', secret.secretKey);
  signature.update(payload);

  headers['X-AUTH-TIMESTAMP'] = timestamp;
  headers['X-AUTH-SIGNATURE'] = signature.digest('hex');

  return headers;
}

export const genericRFQAuthHttp =
  (pathToRemove?: string) =>
  (secret: RFQSecret) =>
  (options: RequestConfig): RequestConfig => {
    let { data: body, method, url } = options;
    if (!options.headers) {
      options.headers = {};
    }
    method = method || 'GET';
    if (!url) {
      throw new Error('missing url');
    }

    const headers = authByParams(url, method, body, secret, pathToRemove);
    for (const [header, value] of Object.entries(headers)) {
      options.headers[header] = value;
    }

    options.headers['X-AUTH-DOMAIN'] = secret.domain;
    options.headers['X-AUTH-ACCESS-KEY'] = secret.accessKey;
    return options;
  };
