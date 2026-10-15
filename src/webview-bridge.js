import { invokeModel } from './model-dispatch.js';
export const BRIDGE_VERSION = 1;
export const RESOURCE_VERSION = '1.1.0';
const globalMethods = new Set([
  'listModels',
  'registerModel',
  'setModel',
  'setVisible',
  'setPerformanceMode',
  'getPerformanceStats',
  'resize',
  'dispose',
]);
const fail = (code, message) => {
  throw Object.assign(new Error(message), { code });
};

export class WebViewBridge {
  constructor(viewer, { send, instanceId, configure = () => {}, cacheLimit = 128 } = {}) {
    this.viewer = viewer;
    this.send = send;
    this.instanceId = instanceId;
    this.configure = configure;
    this.cache = new Map();
    this.cacheLimit = cacheLimit;
    this.modelToken = null;
    this.loading = false;
    this.generation = 0;
    this.disposed = false;
    this.unsubscribe = viewer.on('*', (event) =>
      this.event(event.type, event, event.modelToken ?? this.modelToken),
    );
  }
  info() {
    return {
      protocolVersion: BRIDGE_VERSION,
      resourceVersion: RESOURCE_VERSION,
      instanceId: this.instanceId,
      modelToken: this.modelToken,
      loading: this.loading,
      capabilities: { webgl2: true, offlineBundle: true, presentationBarrier: true },
    };
  }
  post(message) {
    this.send({ ...message, protocolVersion: BRIDGE_VERSION, instanceId: this.instanceId });
  }
  event(name, data = {}, modelToken = this.modelToken) {
    this.post({ type: 'event', name, data, modelToken });
  }
  ready() {
    this.event('bridge.ready', this.info());
  }
  async receive(request) {
    let response;
    try {
      if (
        !request ||
        typeof request !== 'object' ||
        typeof request.requestId !== 'string' ||
        !request.requestId ||
        request.requestId.length > 160
      )
        fail('INVALID_REQUEST', '请求需要 requestId');
      if (request.protocolVersion !== BRIDGE_VERSION)
        fail('PROTOCOL_MISMATCH', '桥接协议版本不兼容');
      if (request.method !== 'bridge.hello' && request.instanceId !== this.instanceId)
        fail('STALE_INSTANCE', '网页实例已更换');
      const key = request.requestId,
        fingerprint = JSON.stringify(request);
      const cached = this.cache.get(key);
      if (cached) {
        if (cached.fingerprint !== fingerprint)
          fail('REQUEST_CONFLICT', '同一请求编号不能复用于不同内容');
        response = await cached.promise;
      } else {
        // Store the promise before invoking the SDK, so concurrent retries run once.
        const promise = Promise.resolve()
          .then(() => this.execute(request))
          .then(
            (result) => ({ type: 'response', requestId: key, ok: true, result: result ?? null }),
            (error) => ({
              type: 'response',
              requestId: key,
              ok: false,
              error: { code: error.code || 'MODEL_ERROR', message: error.message },
            }),
          );
        this.cache.set(key, { fingerprint, promise });
        response = await promise;
        while (this.cache.size > this.cacheLimit) this.cache.delete(this.cache.keys().next().value);
      }
    } catch (error) {
      response = {
        type: 'response',
        requestId: request?.requestId ?? null,
        ok: false,
        error: { code: error.code || 'MODEL_ERROR', message: error.message },
      };
    }
    this.post(response);
    return response;
  }
  async execute({ method, args = [], modelToken }) {
    if (this.disposed) fail('DISPOSED', '组件已销毁');
    if (!Array.isArray(args)) fail('INVALID_REQUEST', 'args 必须为数组');
    if (method === 'bridge.hello') return this.info();
    if (method === 'bridge.configure') return this.configure(args[0] ?? {});
    if (method === 'setModel') {
      const generation = ++this.generation;
      this.loading = true;
      this.modelToken = null;
      try {
        const info = await invokeModel(this.viewer, method, args);
        if (generation !== this.generation) fail('MODEL_SUPERSEDED', '已被后续型号请求替代');
        this.modelToken = info.modelToken;
        return info;
      } finally {
        if (generation === this.generation) this.loading = false;
      }
    }
    if (!globalMethods.has(method)) {
      if (this.loading) fail('MODEL_LOADING', '型号正在切换');
      if (!this.modelToken) fail('MODEL_NOT_READY', '请先设置型号');
      if (modelToken !== this.modelToken) fail('STALE_MODEL', '调用属于已切换的型号会话');
    }
    if (method === 'bridge.present')
      return this.viewer.requestPresentation({ ...args[0], modelToken });
    if (method === 'dispose') {
      this.disposed = true;
      ++this.generation;
      this.unsubscribe();
    }
    return invokeModel(this.viewer, method, args);
  }
}
