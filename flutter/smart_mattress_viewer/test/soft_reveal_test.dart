import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:smart_mattress_viewer/src/rendering/native_backend.dart';
import 'package:smart_mattress_viewer/src/presentation/static_mattress_view.dart';

class _LocalBundle extends CachingAssetBundle {
  @override
  Future<ByteData> load(String key) =>
      rootBundle.load(key.replaceFirst('packages/smart_mattress_viewer/', ''));
}

void main() {
  testWidgets('support scan never mounts transparent cover images',
      (tester) async {
    final backend = NativeBackend.fromCatalog(
        jsonDecode(File('assets/models/catalog.json').readAsStringSync()));
    await backend.request('setModel', ['t12']);
    await tester.pumpWidget(DefaultAssetBundle(
        bundle: _LocalBundle(),
        child: MaterialApp(
            home: NativeMattressView(
                backend: backend,
                visible: false,
                background: const Color(0xff10191d)))));
    List<String> imageNames() => tester
        .widgetList<Image>(find.byType(Image))
        .map((widget) => ((widget.image is ResizeImage
                ? (widget.image as ResizeImage).imageProvider
                : widget.image) as AssetImage)
            .assetName)
        .toList();
    expect(imageNames(), hasLength(1));
    expect(imageNames().single, endsWith('base.png'));
    await backend.request('updateDeviceState', [
      {
        'air': {
          'left.circuit4': {'value': 70, 'status': 'adjusting'}
        }
      },
      {'normalized': true}
    ]);
    for (final progress in [.5, 1.0, 0.0]) {
      backend.reveals['left'] = progress;
      backend.frames.value++;
      await tester.pump();
      expect(imageNames(), hasLength(1));
      expect(imageNames().single, endsWith('base.png'));
    }
    await tester.pumpWidget(const SizedBox());
    backend.dispose();
  });
}
