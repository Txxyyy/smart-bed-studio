import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:smart_mattress_viewer/src/rendering/native_backend.dart';
import 'package:smart_mattress_viewer/src/presentation/static_mattress_view.dart';
import 'package:smart_mattress_viewer/src/state/native_profile.dart';
import 'package:smart_mattress_viewer/src/types.dart';

class _LocalBundle extends CachingAssetBundle {
  @override
  Future<ByteData> load(String key) =>
      rootBundle.load(key.replaceFirst('packages/smart_mattress_viewer/', ''));
}

Map<String, dynamic> _catalog() =>
    jsonDecode(File('assets/models/catalog.json').readAsStringSync())
        as Map<String, dynamic>;

void main() {
  testWidgets(
      'adjusting side shows the 3D reveal layer and the tinted circuit glow',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(600, 900));
    final backend = NativeBackend.fromCatalog(_catalog());
    addTearDown(backend.dispose);
    await backend.request('setModel', ['t12']);
    final key = GlobalKey();
    await tester.pumpWidget(DefaultAssetBundle(
        bundle: _LocalBundle(),
        child: MaterialApp(
            home: RepaintBoundary(
                key: key,
                child: NativeMattressView(
                    backend: backend,
                    visible: false,
                    background: const Color(0xff10191d))))));
    await tester.runAsync(() async {
      for (final e in find.byType(Image).evaluate()) {
        await precacheImage((e.widget as Image).image, e);
      }
      // 透视层与光效层由绘制端以图片解码，等待其到达。
      await Future<void>.delayed(const Duration(milliseconds: 600));
    });
    await tester.pump();
    Future<ByteData> capture() async {
      late ByteData bytes;
      await tester.runAsync(() async {
        final boundary =
            key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
        final image = await boundary.toImage();
        bytes = (await image.toByteData(format: ui.ImageByteFormat.rawRgba))!;
        image.dispose();
      });
      return bytes;
    }

    final view = tester.getSize(find.byType(NativeMattressView));
    final metadata = ((backend.profile!['fallback'] as Map)['regions'] as Map);
    final glow = (metadata['regions'] as List)
        .cast<Map<dynamic, dynamic>>()
        .firstWhere((r) => r['id'] == 'left.circuit4')['glow'] as Map;
    // 底图按宽度缩放后居中；在光效层中心取样，另在右半侧取一个对照点。
    final width = (metadata['width'] as num).toDouble(),
        height = (metadata['height'] as num).toDouble();
    final viewport = tester.getSize(find.byType(LayoutBuilder).first);
    final scale = viewport.width / width < viewport.height / height
        ? viewport.width / width
        : viewport.height / height;
    final origin = Offset((viewport.width - width * scale) / 2,
        (viewport.height - height * scale) / 2);
    Offset at(num x, num y) => origin + Offset(x * scale, y * scale);
    final lit = at((glow['x'] as num) + (glow['width'] as num) * .6,
        (glow['y'] as num) + (glow['height'] as num) * .08);
    final control = at(width * .3, (glow['y'] as num) + 20);
    List<int> pixel(ByteData data, Offset p) {
      final i = (p.dy.round() * view.width.round() + p.dx.round()) * 4;
      return [data.getUint8(i), data.getUint8(i + 1), data.getUint8(i + 2)];
    }

    final closed = await capture();
    // 只挂载完整外罩底图一张图片组件；透视层与光效层由绘制端按扫描进度绘制。
    expect(find.byType(Image), findsOneWidget);

    await backend.request('updateDeviceState', [
      {
        'air': {
          'left.circuit4': {'value': 70, 'status': 'inflating'}
        }
      },
      {'normalized': true}
    ]);
    backend.motions.remove('scan:left');
    backend.reveals['left'] = 1;
    backend.frames.value++;
    await tester.pump();
    final open = await capture();
    final before = pixel(closed, lit), after = pixel(open, lit);
    // 调节侧换成透视层并叠加青色充气光效：该点变亮且偏青（绿、蓝高于红）。
    expect(after[1] + after[2], greaterThan(before[1] + before[2] + 40));
    expect(after[2], greaterThan(after[0] + 30));
    // 另一侧保持完整外罩。
    expect(pixel(open, control), pixel(closed, control));

    await tester.pumpWidget(const SizedBox());
  });

  test('asset revision 3 requires a packaged glow layer for every circuit', () {
    final model = (_catalog()['models'] as List)
        .cast<Map<String, dynamic>>()
        .firstWhere((m) => m['id'] == 't11-plus');
    validateNativeAssets(model);
    final broken = jsonDecode(jsonEncode(model)) as Map<String, dynamic>;
    ((broken['fallback'] as Map)['glow'] as Map).remove('left.lumbar');
    expect(
        () => validateNativeAssets(broken),
        throwsA(isA<MattressException>()
            .having((e) => e.code, 'code', 'FALLBACK_ASSET_INVALID')));
  });
}
