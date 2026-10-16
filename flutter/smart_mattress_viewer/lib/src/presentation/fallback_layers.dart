import 'dart:ui' as ui;
import 'package:flutter/widgets.dart';

/// 降级二维中取自 3D 渲染的图层：左右侧揭开后的透视层，以及每一路气囊的调节光效层
/// （白色 + alpha 表示加色光量，运行时按状态着色）。按型号加载并缓存，图片到达后通知重绘；
/// 加载失败的图层由绘制端回退为程序绘制。
class FallbackLayers extends ChangeNotifier {
  String? _key;
  bool _syncing = false, _disposed = false;
  final Map<String, ImageInfo> _infos = {};
  final Set<String> _failed = {};
  final List<(ImageStream, ImageStreamListener)> _streams = [];

  ui.Image? reveal(String side) => _infos['reveal:$side']?.image;
  ui.Image? glow(String regionId) => _infos['glow:$regionId']?.image;
  bool failed(String name) => _failed.contains(name);

  /// 型号、修订或透视层解码宽度变化时重新加载；同一配置重复调用不做任何事。
  void sync(BuildContext context, Map<String, dynamic> profile, int revealWidth,
      void Function(String code) onError) {
    final fallback = profile['fallback'];
    if (fallback is! Map) return;
    final key = '${profile['id']}/${profile['revision']}/$revealWidth';
    if (key == _key) return;
    _reset();
    _key = key;
    final configuration = createLocalImageConfiguration(context);
    void load(String name, ImageProvider provider) {
      final stream = provider.resolve(configuration);
      final listener = ImageStreamListener((info, _) {
        if (_disposed || _key != key) {
          info.dispose();
          return;
        }
        _infos.remove(name)?.dispose();
        _infos[name] = info;
        if (!_syncing) notifyListeners();
      }, onError: (error, stack) {
        if (_disposed || _key != key || !_failed.add(name)) return;
        onError('FALLBACK_ASSET_MISSING');
        if (!_syncing) notifyListeners();
      });
      stream.addListener(listener);
      _streams.add((stream, listener));
    }

    _syncing = true;
    try {
      final layers = fallback['layers'];
      if (layers is Map) {
        for (final side in ['left', 'right']) {
          final path = layers[side];
          if (path is String) {
            load(
                'reveal:$side',
                ResizeImage.resizeIfNeeded(
                    revealWidth, null, AssetImage(path)));
          }
        }
      }
      final glow = fallback['glow'];
      if (glow is Map) {
        for (final entry in glow.entries) {
          if (entry.value is String) {
            load('glow:${entry.key}', AssetImage(entry.value as String));
          }
        }
      }
    } finally {
      _syncing = false;
    }
  }

  void _reset() {
    for (final (stream, listener) in _streams) {
      stream.removeListener(listener);
    }
    _streams.clear();
    for (final info in _infos.values) {
      info.dispose();
    }
    _infos.clear();
    _failed.clear();
    _key = null;
  }

  @override
  void dispose() {
    _disposed = true;
    _reset();
    super.dispose();
  }
}
