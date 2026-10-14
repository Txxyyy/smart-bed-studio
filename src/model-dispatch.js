// Shared by the showroom page and the native bridge. Never resolve arbitrary paths.
export const MODEL_METHODS = Object.freeze([
  'setVisible',
  'setPerformanceMode',
  'getPerformanceStats',
  'setModel',
  'updateDeviceState',
  'setAirState',
  'setPose',
  'setDataAvailable',
  'adjustment.begin',
  'adjustment.end',
  'adjustment.cancel',
  'air.moveTo',
  'air.stop',
  'pose.moveTo',
  'pose.stop',
  'heating.setState',
  'body.setState',
  'tidal.setWaistCircuit',
  'massage.setState',
  'getModelInfo',
  'getState',
  'listModels',
  'registerModel',
  'resize',
  'suspend',
  'resume',
  'dispose',
  'camera.setPreset',
  'camera.focusRegion',
  'camera.focusSide',
  'camera.setPose',
  'camera.fit',
  'camera.reset',
  'camera.pause',
  'camera.resume',
  'camera.cancel',
  'camera.setFollow',
  'camera.setAutoRotate',
  'camera.setPreferredSide',
  'animation.setPolicy',
  'animation.pause',
  'animation.resume',
  'animation.cancel',
  'effects.scanIn',
  'effects.scanOut',
  'effects.setReveal',
  'effects.setSideReveal',
  'effects.setHighlight',
  'effects.setHeatingStyle',
  'effects.setPoseSpeed',
  'view.setMode',
  'view.focusLayer',
  'view.setBedStyle',
  'view.setHeadboardStyle',
  'camera.setZoom',
  'setInteractionEnabled',
]);
export function invokeModel(viewer, method, args = []) {
  if (!viewer || !MODEL_METHODS.includes(method) || !Array.isArray(args))
    throw Object.assign(new Error('不支持的模型接口'), { code: 'INVALID_METHOD' });
  const parts = method.split('.'),
    name = parts.pop(),
    owner = parts.reduce((object, key) => object[key], viewer);
  return owner[name](...args);
}
export async function dispatchModel(viewer, request = {}) {
  const { requestId, method, args = [] } = request || {};
  try {
    return { requestId, ok: true, result: (await invokeModel(viewer, method, args)) ?? null };
  } catch (error) {
    return {
      requestId,
      ok: false,
      error: { code: error.code || 'MODEL_ERROR', message: error.message },
    };
  }
}
